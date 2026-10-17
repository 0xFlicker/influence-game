import type postgres from "postgres";
import { STORAGE_PAYLOAD_COLUMNS, type StoragePayloadColumn } from "./storage-payload-inventory.js";
import { decodePayloadReference, payloadHash, readJson, readPayload, storePayload, type StoredPayload } from "./payload-storage.js";

export const STORAGE_RECEIPTS_DDL = `CREATE TABLE IF NOT EXISTS storage_payload_migration_receipts (
  source_table text NOT NULL, source_column text NOT NULL, row_key jsonb NOT NULL,
  source_sha256 text NOT NULL, object_reference jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_column, row_key)
)`;

/** Small relational fields used by Studio's SQL filters, never the document body. */
function visualRequestQueryMetadata(body: unknown) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return { sceneId: typeof input.sceneId === "string" ? input.sceneId : null,
    action: typeof input.action === "string" ? input.action : null,
    acknowledgedAttemptIds: Array.isArray(input.acknowledgeUncertainAttempts)
      ? input.acknowledgeUncertainAttempts.filter((id): id is string => typeof id === "string") : [] };
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function payloadRowKey(entry: StoragePayloadColumn): string {
  return `jsonb_build_object(${entry.primaryKey.flatMap(key => [`'${key}'`, quote(key)]).join(",")})`;
}
export function payloadSourceBytes(entry: StoragePayloadColumn): string {
  return entry.kind === "binary" ? quote(entry.column) : `convert_to(${quote(entry.column)}::text, 'UTF8')`;
}
function keyset(entry: StoragePayloadColumn, cursor: Record<string, string | number> | null) {
  const columns = entry.primaryKey.map(quote).join(",");
  return { order: columns,
    condition: cursor ? `(${columns}) > (${entry.primaryKey.map((_, i) => `$${i + 1}`).join(",")})` : "TRUE",
    parameters: cursor ? entry.primaryKey.map(key => cursor[key]!) : [],
  };
}

export async function inventoryPayloads(client: postgres.Sql, includeSizes = true) {
  const inventory = [];
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    const present = await client`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name=${entry.table} AND column_name=${entry.column}`;
    if (!present.length) {
      const reference = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
        AND table_name=${entry.table} AND column_name=${`${entry.column}_object`}`;
      if (!reference.length) throw new Error(`Missing payload column: ${entry.table}.${entry.column}`);
      inventory.push({ table: entry.table, column: entry.column, state: "cut_over" });
      continue;
    }
    const [sizes] = await client.unsafe(`SELECT count(*)::text AS rows,
      ${includeSizes ? `coalesce(sum(octet_length(${payloadSourceBytes(entry)})),0)::text` : "NULL::text"} AS bytes
      FROM ${quote(entry.table)} WHERE ${quote(entry.column)} IS NOT NULL`);
    inventory.push({ table: entry.table, column: entry.column, state: "database", ...sizes });
  }
  // Unknown binary columns must be classified before the cutover, never skipped.
  const binaries = await client`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND data_type='bytea'`;
  for (const column of binaries) {
    if (!STORAGE_PAYLOAD_COLUMNS.some(entry => entry.table === column.table_name && entry.column === column.column_name)) {
      throw new Error(`Unclassified binary column: ${column.table_name}.${column.column_name}`);
    }
  }
  return inventory;
}

/** Detect common embedded-binary encodings outside the explicitly migrated bodies. */
export async function auditEmbeddedBinaries(client: postgres.Sql) {
  const columns = await client`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND data_type IN ('jsonb','json','text','character varying')`;
  for (const column of columns) {
    if (column.table_name === "storage_payload_migration_receipts"
      || STORAGE_PAYLOAD_COLUMNS.some(entry => entry.table === column.table_name && entry.column === column.column_name)) continue;
    const [found] = await client.unsafe(`SELECT count(*)::int AS count FROM ${quote(column.table_name)}
      WHERE ${quote(column.column_name)}::text ~ $1`, [
      'data:[^;[:space:]]+;base64,[A-Za-z0-9+/]{128}|"(b64_json|imageBase64|base64)"[[:space:]]*:[[:space:]]*"[A-Za-z0-9+/]{128}|"type"[[:space:]]*:[[:space:]]*"Buffer"',
    ]);
    if (found?.count) throw new Error(`Unclassified embedded binary: ${column.table_name}.${column.column_name}: ${found.count} rows`);
  }
}

/** Copy only. Database bodies and application behavior remain unchanged. Safe to rerun. */
export async function copyPayloads(client: postgres.Sql, progress: (message: string) => void = () => {}) {
  await inventoryPayloads(client, false);
  await client.unsafe(STORAGE_RECEIPTS_DDL);
  await client`ALTER TABLE storage_payload_migration_receipts ADD COLUMN IF NOT EXISTS query_metadata jsonb`;
  await client`ALTER TABLE storage_payload_migration_receipts ADD COLUMN IF NOT EXISTS source_version text`;
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    const present = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=${entry.table} AND column_name=${entry.column}`;
    if (!present.length) continue;
    let cursor: Record<string, string | number> | null = null;
    let count = 0;
    while (true) {
      const page = keyset(entry, cursor);
      const rows: { row_key: Record<string, string | number>; body: string; source_version: string }[] = await client.unsafe(`SELECT ${payloadRowKey(entry)} AS row_key,
        encode(${payloadSourceBytes(entry)}, 'base64') AS body, xmin::text || ':' || ctid::text AS source_version
        FROM ${quote(entry.table)} t WHERE ${quote(entry.column)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM storage_payload_migration_receipts r
          WHERE r.source_table='${entry.table}' AND r.source_column='${entry.column}'
          AND r.row_key=${payloadRowKey(entry)} AND (r.source_version IS NULL OR r.source_version=t.xmin::text || ':' || t.ctid::text))
        AND ${page.condition} ORDER BY ${page.order} LIMIT 16`, page.parameters);
      if (!rows.length) break;
      const results = await Promise.allSettled(rows.map(async row => {
        const bytes = Buffer.from(row.body, "base64"), sourceHash = payloadHash(bytes);
        const [prior] = await client`SELECT source_sha256,object_reference FROM storage_payload_migration_receipts
          WHERE source_table=${entry.table} AND source_column=${entry.column} AND row_key=${client.json(row.row_key)}`;
        let ref: StoredPayload;
        if (prior?.source_sha256 === sourceHash) {
          ref = prior.object_reference;
        } else {
          ref = await storePayload(bytes, entry.kind === "binary" ? "binary" : entry.kind === "text" ? "text-gzip" : "json-gzip");
        }
        await client`INSERT INTO storage_payload_migration_receipts (source_table,source_column,row_key,source_sha256,source_version,object_reference)
          VALUES (${entry.table},${entry.column},${client.json(row.row_key)},${sourceHash},${row.source_version},${client.json({
            storage: ref.storage, key: ref.key, codec: ref.codec, sha256: ref.sha256, byteLength: ref.byteLength,
            storedSha256: ref.storedSha256, storedByteLength: ref.storedByteLength,
          })})
          ON CONFLICT (source_table,source_column,row_key) DO UPDATE SET
          source_sha256=excluded.source_sha256,source_version=excluded.source_version,object_reference=excluded.object_reference,query_metadata=NULL,verified_at=now()`;
      }));
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      cursor = rows.at(-1)!.row_key;
      count += rows.length;
      progress(`${entry.table}.${entry.column}: ${count} uploaded or reused`);
    }
  }
  // Also supports resuming after the body-column transaction has already committed.
  // No original document is ever copied back into PostgreSQL.
  for (const projection of [
    { table: "visual_media_requests", column: "input", queryColumn: "scene_id", metadata: visualRequestQueryMetadata },
    { table: "account_text_operations", column: "result", queryColumn: "failed_before_dispatch", metadata: (body: unknown) => {
      const failure = body && typeof body === "object" && "failure" in body ? body.failure : null;
      const before = failure && typeof failure === "object" && "beforeDispatch" in failure ? failure.beforeDispatch : false;
      return { failedBeforeDispatch: before === true || before === "true" };
    } },
  ]) {
    const [queryColumn] = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=${projection.table} AND column_name=${projection.queryColumn}`;
    if (queryColumn) continue;
    const [oldColumn] = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=${projection.table} AND column_name=${projection.column}`;
    let after: string | null = null;
    const bodyColumn = quote(oldColumn ? projection.column : `${projection.column}_object`);
    while (true) {
      const rows: Array<{ id: string; document: unknown }> = await client.unsafe(`SELECT id, ${bodyColumn} AS document
        FROM ${quote(projection.table)} WHERE ${bodyColumn} IS NOT NULL
        AND EXISTS (SELECT 1 FROM storage_payload_migration_receipts r WHERE r.source_table='${projection.table}'
          AND r.source_column='${projection.column}' AND r.row_key=jsonb_build_object('id',${quote(projection.table)}.id) AND r.query_metadata IS NULL)
        AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 32`, [after]);
      if (!rows.length) break;
      for (const row of rows) {
        const body = oldColumn ? row.document : await readJson(decodePayloadReference(row.document));
        const updated = await client`UPDATE storage_payload_migration_receipts SET query_metadata=${client.json(projection.metadata(body))}
          WHERE source_table=${projection.table} AND source_column=${projection.column} AND row_key=${client.json({ id: row.id })}
          RETURNING source_sha256`;
        if (updated.length !== 1) throw new Error(`Missing query metadata copy receipt: ${projection.table}.${row.id}`);
        after = row.id;
      }
    }
  }
}

/** Coverage is relational. The conversion transaction alone checks source hashes.
 * Legacy receipts remain usable; no retry downloads or rehashes completed objects.
 */
export async function verifyPayloads(client: postgres.Sql) {
  const inventory = await inventoryPayloads(client, false);
  let covered = 0;
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    const sourceExists = inventory.some(row => row.table === entry.table && row.column === entry.column && row.state === "database");
    const column = quote(sourceExists ? entry.column : `${entry.column}_object`);
    const [coverage] = await client.unsafe(`SELECT count(*)::int AS required,
      count(*) FILTER (WHERE r.row_key IS NULL OR r.object_reference->>'sha256' IS DISTINCT FROM r.source_sha256
        ${sourceExists ? "" : `OR r.object_reference IS DISTINCT FROM t.${column}`})::int AS missing
      FROM ${quote(entry.table)} t LEFT JOIN storage_payload_migration_receipts r
        ON r.source_table=$1 AND r.source_column=$2 AND r.row_key=${payloadRowKey(entry)}
      WHERE t.${column} IS NOT NULL`, [entry.table, entry.column]);
    if (coverage?.missing) throw new Error(`Missing or mismatched payload receipts: ${entry.table}.${entry.column}: ${coverage.missing}`);
    covered += coverage!.required;
  }
  return { covered, verification: "database-receipt-coverage", inventory };
}

/** After SQL has rolled back, make only its rejected legacy row eligible for retry.
 * This is the diagnostic contract of the pinned 0119/0120 SQL, not a payload scan.
 * Preserve the original receipt and object; copy will replace it after upload.
 */
export async function retryRejectedLegacyReceipt(client: postgres.Sql, error: unknown): Promise<boolean> {
  // Drizzle wraps driver errors with the failed query; use its original cause.
  if (error instanceof Error && "cause" in error && !("code" in error)) {
    return retryRejectedLegacyReceipt(client, error.cause);
  }
  if (!(error instanceof Error) || !("code" in error) || error.code !== "P0001") return false;
  const match = /^Unverified or changed storage payload (\w+)\.(\w+) \((\{.*\})\)$/.exec(error.message);
  if (!match) return false;
  const entry = STORAGE_PAYLOAD_COLUMNS.find(column => column.table === match[1] && column.column === match[2]);
  if (!entry) return false;
  let key: unknown;
  try { key = JSON.parse(match[3]!); } catch { return false; }
  if (!key || typeof key !== "object" || Array.isArray(key)
    || Object.keys(key).sort().join() !== [...entry.primaryKey].sort().join()
    || Object.values(key).some(value => typeof value !== "string" && typeof value !== "number")) return false;
  const updated = await client`UPDATE storage_payload_migration_receipts SET source_version='retry-rejected'
    WHERE source_table=${entry.table} AND source_column=${entry.column}
      AND row_key=${client.json(key as Record<string, string | number>)} AND source_version IS NULL
    RETURNING row_key`;
  return updated.length === 1;
}

/** Exercise the candidate's actual document reader on two converted rows at most. */
export async function smokePayloadDocuments(client: postgres.Sql) {
  const samples: Array<{ table: string; column: string; codec: string }> = [];
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    if (entry.kind === "binary") continue;
    const column = quote(`${entry.column}_object`);
    const rows = await client.unsafe(`SELECT ${column} AS reference FROM ${quote(entry.table)}
      WHERE ${column} IS NOT NULL ORDER BY ${entry.primaryKey.map(quote).join(",")} LIMIT 1`);
    for (const row of rows) {
      const reference = decodePayloadReference(row.reference);
      if (reference.codec === "json-gzip") await readJson(reference);
      else await readPayload(reference);
      samples.push({ table: entry.table, column: entry.column, codec: reference.codec });
    }
    if (samples.length === 2) break;
  }
  return { readExistingDocuments: samples.length, samples };
}
