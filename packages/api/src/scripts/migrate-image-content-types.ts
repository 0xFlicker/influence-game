import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { parseProviderImageUri } from "@influence/engine/provider-images";
import { objectStorageBucket, objectStorageClient, objectStorageClientConfig, objectStorageProvider, privateEvidenceReadBucket } from "../lib/object-storage-config.js";
import { imagePayloadInventorySql, isImagePayloadColumn } from "../services/image-payload-inventory.js";
import { imageObjectReceipt, inspectImageObject, replaceImageContentType, verifyResumedImageCopy } from "../services/image-payload-metadata.js";
import { assertStoredPayload, payloadHash, readText, type StoredPayload } from "../services/payload-storage.js";
import { isImageContentType, type ImageContentType } from "../lib/image-content-type.js";

type SnapshotRow =
  | { kind: "database"; name: string }
  | { kind: "image"; source: string; row: string[]; ref: StoredPayload }
  | { kind: "outbox"; row: string[]; ref: StoredPayload<string> }
  | { kind: "attempt"; row: string[]; bucket: string; key: string; sha256: string; length: number };
type Image = { ref: StoredPayload; sources: string[] };
type Inspection = { kind: "inspection"; key: string; sources: string[]; result: string; type?: ImageContentType; before?: ReturnType<typeof imageObjectReceipt>; error?: string };
type EvidenceInventory = { kind: "evidence"; id: string; refs?: StoredPayload[]; error?: string };
type CopyReceipt = { kind: "intent" | "verified" | "exception"; key: string; result?: string; type?: ImageContentType; error?: string; tagSha256?: string };
type Receipt = Inspection | EvidenceInventory | CopyReceipt;

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  const remote = error as Error & { $metadata?: { httpStatusCode?: number }; code?: string };
  if (remote.$metadata?.httpStatusCode) return `${error.name} HTTP ${remote.$metadata.httpStatusCode}`;
  if (remote.code) return String(remote.code).replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
  // Only known messages from our own validation. Never print request URLs, XML, or headers.
  if (/^(Object |Storage did |Incomplete |Unexpected |Metadata copy |Previous version |Evidence |Invalid private |Missing private )/.test(error.message)
    && /^[a-z0-9 ;.-]+$/i.test(error.message)) return error.message;
  return error.name;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function attachmentRefs(document: string): StoredPayload[] {
  const root = record(JSON.parse(document));
  const attempt = record(root?.attempt);
  if (!attempt) throw new Error("Evidence is missing its attempt record");
  const refs = new Map<string, StoredPayload>();
  function visit(value: unknown) {
    if (typeof value === "string") {
      const image = parseProviderImageUri(value);
      if (!image) return;
      const ref: StoredPayload = { storage: "private-payload-v1", codec: "binary", key: `payloads/v1/binary/${image.sha256}`,
        sha256: image.sha256, storedSha256: image.sha256, byteLength: image.byteLength, storedByteLength: image.byteLength };
      refs.set(ref.key, ref);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) Object.values(value as Record<string, unknown>).forEach(visit);
  }
  // These are the fields sanitized by ProviderImageAttachments before evidence is committed.
  for (const field of ["preparedRequest", "rawRequest", "rawResponse"]) visit(attempt[field]);
  return [...refs.values()];
}

async function readAttempt(row: Extract<SnapshotRow, { kind: "attempt" }>) {
  const sha256 = row.sha256?.replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(row.length) || row.length < 1) throw new Error("Evidence receipt is invalid");
  const result = await objectStorageClient("evidence").send(new GetObjectCommand({
    Bucket: privateEvidenceReadBucket(row.bucket, row.key), Key: row.key,
  }), { abortSignal: AbortSignal.timeout(30_000) });
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes || bytes.length !== row.length || payloadHash(bytes) !== sha256) throw new Error("Evidence hash or length mismatch");
  return Buffer.from(bytes).toString("utf8");
}

async function readRecords<T>(path: string, optional = false): Promise<T[]> {
  const file = Bun.file(path);
  if (optional && !await file.exists()) return [];
  return (await file.text()).split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
}

async function main() {
  const [mode, snapshotPath, journalPath, database, provider, endpoint, bucket, max = "100", delay = "100", parallel] = Bun.argv.slice(2);
  if (mode === "sql") { console.log(imagePayloadInventorySql()); return; }
  if ((mode !== "dry-run" && mode !== "apply") || !snapshotPath || !journalPath || !database || !provider || !endpoint || !bucket) {
    throw new Error("Usage: migrate-image-content-types.ts sql | dry-run|apply SNAPSHOT JOURNAL DATABASE PROVIDER ENDPOINT BUCKET [LIMIT] [DELAY_MS] [CONCURRENCY]");
  }
  const limit = Number(max), pause = Number(delay), concurrency = Number(parallel ?? (mode === "dry-run" ? 4 : 1));
  if (!Number.isInteger(limit) || limit < 1 || limit > 50_000 || !Number.isInteger(pause) || pause < 0
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("Invalid limit, delay or concurrency");
  const target = { database, provider, endpoint, bucket, snapshotSha256: createHash("sha256").update(await Bun.file(snapshotPath).arrayBuffer().then(Buffer.from)).digest("hex") };
  if (provider !== objectStorageProvider() || endpoint !== objectStorageClientConfig("data").endpoint || bucket !== objectStorageBucket("data")
    || bucket === process.env.LINODE_OBJ_BUCKET || bucket === process.env.HOUSE_PUBLIC_BUCKET) throw new Error("Configured data storage does not match the explicit private target");
  const rows = await readRecords<SnapshotRow>(snapshotPath);
  if (rows.filter(row => row.kind === "database").length !== 1 || rows.find(row => row.kind === "database")?.name !== database) throw new Error("Snapshot database identity mismatch");

  // Exclusive operator lock avoids competing writers and interleaved receipts on this machine.
  const lock = await open(`${journalPath}.lock`, "wx", 0o600);
  try {
    const previous = await readRecords<Receipt | typeof target>(journalPath, true);
    if (previous.length && JSON.stringify(previous[0]) !== JSON.stringify(target)) throw new Error("Journal target or snapshot changed");
    const journal = await open(journalPath, "a", 0o600);
    try {
      let pending = Promise.resolve();
      const save = (data: unknown) => {
        pending = pending.then(async () => {
          await journal.appendFile(JSON.stringify(data) + "\n");
          await journal.sync();
        });
        return pending;
      };
      if (!previous.length) await save(target);
      const receipts = previous.slice(1) as Receipt[];
      const evidence = new Map(receipts.filter((row): row is EvidenceInventory => row.kind === "evidence").map(row => [row.id, row]));
      const inspections = new Map(receipts.filter((row): row is Inspection => row.kind === "inspection").map(row => [row.key, row]));
      const applied = new Set(receipts.flatMap(row => row.kind === "verified" ? [row.key] : []));
      const images = new Map<string, Image>();
      const add = (ref: StoredPayload, source: string) => {
        assertStoredPayload(ref);
        if (ref.codec !== "binary" || ref.storedSha256 !== ref.sha256 || ref.byteLength !== ref.storedByteLength) throw new Error("Image snapshot contains an invalid binary reference");
        const known = images.get(ref.key);
        if (known && known.ref.byteLength !== ref.byteLength) throw new Error("Image references disagree on length");
        if (known) known.sources.push(source);
        else images.set(ref.key, { ref, sources: [source] });
      };
      for (const row of rows) {
        if (row.kind !== "image") continue;
        const [table, column] = row.source.split(".");
        if (!table || !column || !isImagePayloadColumn(table, column)) throw new Error("Snapshot contains a non-image column");
        add(row.ref, `${row.source}:${JSON.stringify(row.row)}`);
      }
      const attachments = rows.filter(row => row.kind === "attempt" || row.kind === "outbox");
      if (mode === "dry-run") {
        const remaining = attachments.filter(row => !evidence.has(`${row.kind}:${JSON.stringify(row.row)}`)).slice(0, limit);
        for (let start = 0; start < remaining.length; start += concurrency) {
          await Promise.all(remaining.slice(start, start + concurrency).map(async row => {
            const id = `${row.kind}:${JSON.stringify(row.row)}`;
            let entry: EvidenceInventory;
            try {
              const body = row.kind === "attempt" ? await readAttempt(row) : await readText(row.ref);
              entry = { kind: "evidence", id, refs: attachmentRefs(body) };
            } catch (error) { entry = { kind: "evidence", id, error: safeError(error) }; }
            await save(entry);
            evidence.set(id, entry);
          }));
          if (pause) await Bun.sleep(pause);
        }
      }
      for (const row of attachments) {
        const id = `${row.kind}:${JSON.stringify(row.row)}`;
        for (const ref of evidence.get(id)?.refs ?? []) add(ref, id);
      }
      const client = objectStorageClient("data");
      const sorted = [...images.values()].sort((a, b) => a.ref.key.localeCompare(b.ref.key));
      if (mode === "dry-run") {
        const remaining = sorted.filter(({ ref }) => !inspections.has(ref.key)).slice(0, limit);
        for (let start = 0; start < remaining.length; start += concurrency) {
          await Promise.all(remaining.slice(start, start + concurrency).map(async ({ ref, sources }) => {
            let entry: Inspection;
            try {
              const { head, type } = await inspectImageObject(client, bucket, ref);
              const result = !type ? "unrecognized" : type === head.ContentType ? "correct" : "incorrect";
              entry = { kind: "inspection", key: ref.key, sources, result, type, before: imageObjectReceipt(head) };
            } catch (error) {
              const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
              entry = { kind: "inspection", key: ref.key, sources, result: status === 404 ? "missing" : "error", error: safeError(error) };
            }
            await save(entry);
            inspections.set(ref.key, entry);
          }));
          if (pause) await Bun.sleep(pause);
        }
      } else {
        if (evidence.size !== attachments.length || inspections.size !== sorted.length) throw new Error("Complete the dry-run inventory before applying");
        const attempted = new Set(receipts.flatMap(row => row.kind === "exception" ? [row.key] : []));
        const intents = new Map(receipts.flatMap(row => row.kind === "intent" ? [[row.key, row.tagSha256] as const] : []));
        const todo = sorted.filter(({ ref }) => inspections.get(ref.key)?.result === "incorrect" && !applied.has(ref.key));
        todo.sort((a, b) => Number(attempted.has(a.ref.key)) - Number(attempted.has(b.ref.key)));
        const batch = todo.slice(0, limit);
        const apply = async ({ ref }: Image) => {
          const plan = inspections.get(ref.key)!;
          const type = plan.type;
          if (!isImageContentType(type) || !plan.before) throw new Error("Invalid dry-run entry");
          try {
            const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: ref.key }), { abortSignal: AbortSignal.timeout(15_000) });
            const current = imageObjectReceipt(head);
            if (head.ContentType === type) {
              const sha256 = await verifyResumedImageCopy(client, bucket, ref, plan.before, head, intents.get(ref.key));
              await save({ kind: "verified", key: ref.key, type, result: "already-correct", before: plan.before, after: current, sha256 });
            } else {
              if (JSON.stringify(current) !== JSON.stringify(plan.before)) throw new Error("Object changed after dry run");
              const result = await replaceImageContentType(client, bucket, ref, head, type,
                (before, access) => save({ kind: "intent", key: ref.key, type, before, ...access }));
              await save({ kind: "verified", key: ref.key, type, result: "updated", ...result });
            }
            applied.add(ref.key);
          } catch (error) {
            await save({ kind: "exception", key: ref.key, type, error: safeError(error) });
          }
        };
        for (let start = 0; start < batch.length; start += concurrency) {
          await Promise.all(batch.slice(start, start + concurrency).map(apply));
          if (pause) await Bun.sleep(pause);
        }
      }
      const counts: Record<string, number> = {};
      for (const row of inspections.values()) {
        const label = `${row.result}:${row.type ?? "unknown"}`;
        counts[label] = (counts[label] ?? 0) + 1;
      }
      console.log(JSON.stringify({ database, provider, endpoint, bucket, references: rows.filter(row => row.kind === "image").length,
        evidenceTotal: attachments.length, evidenceRead: evidence.size, evidenceExceptions: [...evidence.values()].filter(entry => entry.error).length,
        images: images.size, inspected: inspections.size, verified: applied.size, counts }));
    } finally { await journal.close(); }
  } finally { await lock.close(); await Bun.file(`${journalPath}.lock`).delete(); }
}

try { await main(); } catch (error) {
  // CLI validation errors contain only constant messages.
  console.error(error instanceof Error && /^(Usage:|Invalid limit|Configured data|Snapshot |Journal |Complete the dry-run|Invalid dry-run|Image snapshot |Image references)/.test(error.message)
    ? error.message : safeError(error));
  process.exitCode = 1;
}
