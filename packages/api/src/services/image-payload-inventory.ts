import { STORAGE_PAYLOAD_COLUMNS } from "./storage-payload-inventory.js";

// Binary payload columns with image writers. Audio uses the same key namespace.
const imageColumns = new Set([
  "agent_content_assets.bytes",
  "championship_artwork.avatar",
  "championship_artwork.body",
  "character_cutouts.source",
  "character_cutouts.image",
  "visual_artifacts.image",
  "visual_render_attempts.image",
  "visual_room_library.image",
]);

export function isImagePayloadColumn(table: string, column: string) {
  return imageColumns.has(`${table}.${column}`);
}

/** Read-only snapshot. It can run inside the application's DB network without storage credentials. */
export function imagePayloadInventorySql() {
  const sources = STORAGE_PAYLOAD_COLUMNS.filter(entry => entry.kind === "binary" && isImagePayloadColumn(entry.table, entry.column));
  if (sources.length !== imageColumns.size) throw new Error("Image payload inventory does not match the storage inventory");
  const images = sources.map(({ table, column, primaryKey }) => {
    const reference = `"${column}_object"`;
    const row = `jsonb_build_array(${primaryKey.map(key => `"${key}"`).join(", ")})`;
    return `SELECT jsonb_build_object('kind', 'image', 'source', '${table}.${column}', 'row', ${row}, 'ref', ${reference}) AS record
      FROM "${table}" WHERE ${reference} IS NOT NULL`;
  });
  return [
    "SELECT jsonb_build_object('kind', 'database', 'name', current_database()) AS record",
    ...images,
    `SELECT jsonb_build_object('kind', 'attempt', 'row', jsonb_build_array(id), 'bucket', storage_bucket,
      'key', storage_key, 'sha256', metadata->>'sha256', 'length', metadata->'byteLength')
      FROM game_evidence_manifests WHERE evidence_type = 'provider_attempt_failure'
      AND redaction_status = 'active' AND storage_key IS NOT NULL`,
    `SELECT jsonb_build_object('kind', 'outbox', 'row', jsonb_build_array(attempt_id), 'ref', body_object)
      FROM provider_attempt_evidence_outbox`,
  ].join("\nUNION ALL\n");
}
