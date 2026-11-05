import { acceptedCaptureProvenance, captureProvenanceKey } from "./accepted-capture-provenance.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { acceptedActionDecisionRefs } from "./accepted-action-correlation.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { assertPrivateContentStoragePointer } from "./game-evidence.js";
import { buildTraceMetadata, PRIVATE_TRACE_EVIDENCE_TYPE } from "./private-trace-writer.js";
import { createPrivateTraceStorageAdapter, getPrivateTraceBucket, PRIVATE_TRACE_STORAGE_PROVIDER, type PrivateTraceStorageAdapter } from "./private-trace-storage.js";
import { retryEvidenceTransaction } from "./evidence-errors.js";

export class PrivateTraceIndexRecoveryError extends Error {}

/**
 * Explicit operator repair, never called by gameplay or a public endpoint.
 * Default is a read-only plan. Apply requires a separately reviewed object key
 * and SHA-256; it restores only the index, never regenerates model content.
 */
export async function recoverPrivateTraceIndex(
  db: DrizzleDB,
  input: { gameId: string; key: string; expectedSha256: string; apply?: boolean; reason?: string },
  storage: PrivateTraceStorageAdapter = createPrivateTraceStorageAdapter(),
) {
  if (input.apply && !input.reason?.trim()) throw new PrivateTraceIndexRecoveryError("Reviewed recovery reason required for apply");
  if (!/^sha256:[a-f0-9]{64}$/.test(input.expectedSha256)) throw new PrivateTraceIndexRecoveryError("Expected trace hash required");
  const pointer = { provider: PRIVATE_TRACE_STORAGE_PROVIDER, bucket: getPrivateTraceBucket(), key: input.key };
  assertPrivateContentStoragePointer(pointer);
  if (!input.key.startsWith(`content/${input.gameId}/private-traces/`)) throw new PrivateTraceIndexRecoveryError("Trace belongs to another game or evidence class");
  const object = await storage.getObject({ bucket: pointer.bucket, key: pointer.key });
  const body = object.body ?? (object.bodyBytes ? new TextDecoder("utf-8", { fatal: true }).decode(object.bodyBytes) : undefined);
  if (body === undefined || `sha256:${createHash("sha256").update(body).digest("hex")}` !== input.expectedSha256) throw new PrivateTraceIndexRecoveryError("Trace integrity mismatch");
  let trace: PrivateDecisionTrace;
  try { trace = JSON.parse(body) as PrivateDecisionTrace; } catch { throw new PrivateTraceIndexRecoveryError("Invalid private trace JSON"); }
  if (!trace || trace.gameId !== input.gameId || typeof trace.ownerEpoch !== "string" || typeof trace.decisionId !== "string" || typeof trace.action !== "string" || typeof trace.createdAt !== "string") throw new PrivateTraceIndexRecoveryError("Trace identity incomplete");
  const { ownerEpoch, decisionId } = trace;
  // Also validates the fields used by existing private trace readers. No body is
  // copied to PostgreSQL, returned to the operator, or logged.
  const metadata = buildTraceMetadata(trace, body, trace.createdAt);
  return retryEvidenceTransaction(() => db.transaction(async tx => {
    if (input.apply) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('private_trace_index_recovery'), hashtext(${input.gameId}))`);
    } else {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
    }
    const refs = acceptedActionDecisionRefs((await getPersistedGameEvents(tx, input.gameId)).events);
    const ref = refs.find(ref => ref.decisionId === decisionId && ref.traceAction === trace.action && !ref.canonicalConflict);
    const provenance = ref ? (await acceptedCaptureProvenance(tx, [ref])).get(captureProvenanceKey(ref)) : undefined;
    if (!ref || !provenance || provenance.ownerEpoch !== ownerEpoch) throw new PrivateTraceIndexRecoveryError("Trace has no matching accepted journal and canonical event");
    const [sourceOwner] = await tx.select({ status: schema.gameRunOwners.status }).from(schema.gameRunOwners).where(and(
      eq(schema.gameRunOwners.gameId, input.gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
    ));
    if (!sourceOwner || sourceOwner.status === "active") throw new PrivateTraceIndexRecoveryError("Historical index recovery requires an inactive original owner");
    const existing = await tx.select().from(schema.gameEvidenceManifests).where(and(
      eq(schema.gameEvidenceManifests.gameId, input.gameId),
      eq(schema.gameEvidenceManifests.ownerEpoch, ownerEpoch),
      eq(schema.gameEvidenceManifests.decisionId, decisionId),
      eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
    ));
    if (existing.some(row => row.storageProvider !== pointer.provider || row.storageBucket !== pointer.bucket || row.storageKey !== pointer.key || row.metadata.sha256 !== input.expectedSha256 || (row.eventSequence !== null && row.eventSequence !== ref.eventSequence))) throw new PrivateTraceIndexRecoveryError("Existing trace index conflicts with recovery evidence");
    const plan = { gameId: input.gameId, ownerEpoch, decisionId, eventSequence: ref.eventSequence, sha256: input.expectedSha256, alreadyIndexed: existing.length > 0 };
    if (!input.apply || existing.length) return { ...plan, applied: false };
    const audit = await tx.execute<{ role: string }>(sql`SELECT current_user AS role`);
    await tx.insert(schema.gameEvidenceManifests).values({
      id: randomUUID(), gameId: input.gameId, ownerEpoch,
      decisionId, eventSequence: ref.eventSequence,
      evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE, retentionClass: "debug", accessScope: "producer_admin",
      storageProvider: pointer.provider, storageBucket: pointer.bucket, storageKey: pointer.key,
      metadata: { ...metadata, indexRecovery: { version: 1, recoveredAt: new Date().toISOString(), source: "verified_original_object", databaseRole: audit[0]?.role, reason: input.reason } },
      sourcePointers: [{ kind: "accepted_trace_index_recovery", decisionId, attemptId: provenance.attemptId, eventSequence: ref.eventSequence }],
    });
    return { ...plan, applied: true };
  }));
}
