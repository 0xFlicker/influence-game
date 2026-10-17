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

export async function inventoryPayloads(client: postgres.Sql) {
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
      coalesce(sum(octet_length(${payloadSourceBytes(entry)})),0)::text AS bytes
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
  await inventoryPayloads(client);
  await auditEmbeddedBinaries(client);
  await client.unsafe(STORAGE_RECEIPTS_DDL);
  await client`ALTER TABLE storage_payload_migration_receipts ADD COLUMN IF NOT EXISTS query_metadata jsonb`;
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    const present = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=${entry.table} AND column_name=${entry.column}`;
    if (!present.length) continue;
    let cursor: Record<string, string | number> | null = null;
    let count = 0;
    while (true) {
      const page = keyset(entry, cursor);
      const rows: { row_key: Record<string, string | number>; body: string }[] = await client.unsafe(`SELECT ${payloadRowKey(entry)} AS row_key,
        encode(${payloadSourceBytes(entry)}, 'base64') AS body
        FROM ${quote(entry.table)} WHERE ${quote(entry.column)} IS NOT NULL
        AND ${page.condition} ORDER BY ${page.order} LIMIT 8`, page.parameters);
      if (!rows.length) break;
      await Promise.all(rows.map(async row => {
        const bytes = Buffer.from(row.body, "base64"), sourceHash = payloadHash(bytes);
        const [prior] = await client`SELECT source_sha256,object_reference FROM storage_payload_migration_receipts
          WHERE source_table=${entry.table} AND source_column=${entry.column} AND row_key=${client.json(row.row_key)}`;
        let ref: StoredPayload;
        if (prior?.source_sha256 === sourceHash) {
          ref = prior.object_reference;
          await readPayload(ref); // a receipt alone is never proof that the object still exists
        } else {
          ref = await storePayload(bytes, entry.kind === "binary" ? "binary" : entry.kind === "text" ? "text-gzip" : "json-gzip");
        }
        await client`INSERT INTO storage_payload_migration_receipts (source_table,source_column,row_key,source_sha256,object_reference)
          VALUES (${entry.table},${entry.column},${client.json(row.row_key)},${sourceHash},${client.json({
            storage: ref.storage, key: ref.key, codec: ref.codec, sha256: ref.sha256, byteLength: ref.byteLength,
            storedSha256: ref.storedSha256, storedByteLength: ref.storedByteLength,
          })})
          ON CONFLICT (source_table,source_column,row_key) DO UPDATE SET
          source_sha256=excluded.source_sha256,object_reference=excluded.object_reference,verified_at=now()`;
      }));
      cursor = rows.at(-1)!.row_key;
      count += rows.length;
      progress(`${entry.table}.${entry.column}: ${count} verified`);
    }
  }
  // Also supports resuming after the body-column transaction has already committed.
  // No original document is ever copied back into PostgreSQL.
  const [queryColumns] = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name='visual_media_requests' AND column_name='scene_id'`;
  if (queryColumns) return;
  const [oldColumn] = await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name='visual_media_requests' AND column_name='input'`;
  let after: string | null = null;
  while (true) {
    const rows: Array<{ id: string; document: unknown }> = await client.unsafe(`SELECT id, ${oldColumn ? "input" : "input_object"} AS document
      FROM visual_media_requests WHERE ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 32`, [after]);
    if (!rows.length) break;
    for (const row of rows) {
      const body = oldColumn ? row.document : await readJson(decodePayloadReference(row.document));
      const updated = await client`UPDATE storage_payload_migration_receipts SET query_metadata=${client.json(visualRequestQueryMetadata(body))}
        WHERE source_table='visual_media_requests' AND source_column='input' AND row_key=${client.json({ id: row.id })}
        RETURNING source_sha256`;
      if (updated.length !== 1) throw new Error(`Missing visual request copy receipt: ${row.id}`);
      after = row.id;
    }
  }
}

/** Re-read every object; also rejects missing/stale receipts while original columns exist. */
export async function verifyPayloads(client: postgres.Sql) {
  const inventory = await inventoryPayloads(client);
  let verified = 0;
  for (const entry of STORAGE_PAYLOAD_COLUMNS) {
    const sourceExists = inventory.some(row => row.table === entry.table && row.column === entry.column && row.state === "database");
    if (sourceExists) {
      const [missing] = await client.unsafe(`SELECT count(*)::int AS count FROM ${quote(entry.table)} t
        LEFT JOIN storage_payload_migration_receipts r ON r.source_table=$1 AND r.source_column=$2
          AND r.row_key=${payloadRowKey(entry)}
          AND r.source_sha256=encode(sha256(${payloadSourceBytes(entry)}),'hex')
        WHERE ${quote(entry.column)} IS NOT NULL AND r.row_key IS NULL`, [entry.table, entry.column]);
      if (missing?.count) throw new Error(`Uncopied or changed payloads: ${entry.table}.${entry.column}: ${missing.count}`);
    }
    let cursor: Record<string, string | number> | null = null;
    while (true) {
      const column = quote(`${entry.column}_object`);
      const page = keyset(entry, cursor);
      const rows: { row_key: Record<string, string | number>; object_reference: StoredPayload }[] = sourceExists
        ? await client`SELECT row_key, object_reference FROM storage_payload_migration_receipts WHERE source_table=${entry.table}
          AND source_column=${entry.column} AND (${cursor ? client.json(cursor) : null}::jsonb IS NULL OR row_key > ${cursor ? client.json(cursor) : null}::jsonb)
          ORDER BY row_key LIMIT 32`
        : await client.unsafe(`SELECT ${payloadRowKey(entry)} AS row_key, ${column} AS object_reference
          FROM ${quote(entry.table)} WHERE ${column} IS NOT NULL
          AND ${page.condition} ORDER BY ${page.order} LIMIT 32`, page.parameters);
      if (!rows.length) break;
      for (const row of rows) { await readPayload(row.object_reference); cursor = row.row_key; verified++; }
    }
  }
  return { verified, inventory };
}
