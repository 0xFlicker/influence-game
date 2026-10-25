import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { setupTestDB } from "./test-utils.js";
import { testPayloadStore } from "./payload-test-store.js";
import { STORAGE_PAYLOAD_COLUMNS } from "../services/storage-payload-inventory.js";
import { auditEmbeddedBinaries, copyPayloads, inventoryPayloads, retryRejectedLegacyReceipt, smokePayloadDocuments, verifyPayloads } from "../services/storage-payload-migration.js";
import { payloadHash, readPayload } from "../services/payload-storage.js";

const client = postgres(process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test", { max: 1, onnotice: () => {} });
const migration = ["0119_private_payload_storage.sql", "0120_private_auxiliary_documents.sql", "0121_visual_request_query_metadata.sql", "0122_text_operation_query_metadata.sql"].map(file => readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")).join("\n--> statement-breakpoint\n");
const quote = (s: string) => `"${s}"`;
beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await client.end(); });

async function fixture(run: () => Promise<void>) {
  await client`BEGIN`;
  try {
    await client`CREATE SCHEMA storage_migration_fixture`;
    await client`SET LOCAL influence.storage_cutover='writers-stopped'`;
    await client`SET LOCAL search_path=storage_migration_fixture,public`;
    const tables = new Map<string, Map<string, string>>();
    for (const entry of STORAGE_PAYLOAD_COLUMNS) {
      const columns = tables.get(entry.table) ?? new Map<string, string>();
      for (const key of entry.primaryKey) columns.set(key, key === "version" ? "integer" : "text");
      // These payloads were introduced after cutover and have never held inline bodies.
      const bucketOnly = entry.table === "character_cutouts" || entry.table.startsWith("game_audio_") || entry.table === "agent_screenings" || entry.table === "agent_screening_attempts" || (entry.table === "provider_logical_calls" && entry.column === "audio_delivery");
      const column = bucketOnly ? `${entry.column}_object` : entry.column;
      columns.set(column, bucketOnly ? "jsonb" : entry.kind === "binary" ? "bytea" : entry.kind === "text" ? "text" : "jsonb");
      tables.set(entry.table, columns);
    }
    for (const [table, columns] of tables) {
      const pk = STORAGE_PAYLOAD_COLUMNS.find(e => e.table === table)!.primaryKey;
      await client.unsafe(`CREATE TABLE ${quote(table)} (${[...columns].map(([key, type]) => `${quote(key)} ${type}`).join(",")}, PRIMARY KEY (${pk.map(quote).join(",")}))`);
    }
    await client`ALTER TABLE game_retrospective_inputs ADD CONSTRAINT game_retrospective_inputs_shape_check CHECK (input IS NULL OR jsonb_typeof(input)='object')`;
    // More than one copy page and shared images exercise cursor progression and deduplication.
    for (let i = 0; i < 19; i++) await client`INSERT INTO visual_artifacts(id,image) VALUES (${String(i).padStart(2, "0")},${Buffer.from([i % 3, 255, 0, 13, 10])})`;
    await client`INSERT INTO visual_room_library(room_id,version,image) VALUES ('room',1,${Buffer.from("version one")}),('room',2,${Buffer.from("version two")})`;
    await client`INSERT INTO game_retrospective_inputs(game_id,input) VALUES ('game',${client.json({ transcript: "large context ".repeat(30_000), outcome: { winner: "A" } })})`;
    await client`INSERT INTO provider_attempt_evidence_outbox(attempt_id,body) VALUES ('attempt',${"raw\r\nUnicode 雪"})`;
    await client`INSERT INTO game_checkpoints(id,snapshot) VALUES ('nullable',NULL)`;
    await client`INSERT INTO agent_revisions(id,behavior_snapshot,effective_runtime_snapshot) VALUES ('revision','{"strategy":"preserved"}','{"model":"preserved"}')`;
    await client`INSERT INTO account_text_operations(id,result) VALUES ('account','{"failure":{"beforeDispatch":true}}')`;
    await client`INSERT INTO anonymous_text_operations(id,result) VALUES ('anonymous','{"text":"draft"}')`;
    await client`INSERT INTO visual_media_requests(id,input) VALUES ('request','{"command":"saved","sceneId":"scene","action":"regenerate","acknowledgeUncertainAttempts":["attempt"]}')`;
    await client`INSERT INTO provider_health_probe_evidence(id,record) VALUES ('probe','{"request":"saved"}')`;
    await run();
  } finally { await client`ROLLBACK`; }
}
async function cutover() { for (const statement of migration.split("--> statement-breakpoint")) await client.unsafe(statement); }

describe("existing payload migration", () => {
  test("copies resumably and cuts over all columns without losing bytes or rows", async () => fixture(async () => {
    const [before] = await client`SELECT encode(sha256(convert_to(input::text,'UTF8')),'hex') AS hash FROM game_retrospective_inputs`;
    await copyPayloads(client);
    const first = await verifyPayloads(client);
    expect(first.covered).toBe(29);
    const uploads = spyOn(testPayloadStore, "putIfAbsent"), downloads = spyOn(testPayloadStore, "get");
    try {
      await copyPayloads(client);
      expect((await verifyPayloads(client)).covered).toBe(29);
      expect(uploads).not.toHaveBeenCalled();
      expect(downloads).not.toHaveBeenCalled();
    } finally { uploads.mockRestore(); downloads.mockRestore(); }
    await cutover();
    expect((await inventoryPayloads(client)).every(row => row.state === "cut_over")).toBe(true);
    expect((await verifyPayloads(client)).covered).toBe(29);
    const [metadata] = await client`SELECT scene_id,action,acknowledged_attempt_ids FROM visual_media_requests`;
    expect(metadata).toEqual({ scene_id: "scene", action: "regenerate", acknowledged_attempt_ids: ["attempt"] });
    expect((await client`SELECT failed_before_dispatch FROM account_text_operations`)[0]!.failed_before_dispatch).toBe(true);
    const [retro] = await client`SELECT input_object FROM game_retrospective_inputs`;
    expect(payloadHash(await readPayload(retro!.input_object))).toBe(before!.hash);
    const images = await client`SELECT id,image_object FROM visual_artifacts ORDER BY id`;
    expect(images).toHaveLength(19);
    for (const row of images) expect(await readPayload(row.image_object)).toEqual(Buffer.from([Number(row.id) % 3, 255, 0, 13, 10]));
    expect((await client`SELECT snapshot_object FROM game_checkpoints`)[0]!.snapshot_object).toBeNull();
    expect(await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND data_type='bytea'`).toHaveLength(0);
    // A rerun cannot rewrite already-cut-over rows.
    await copyPayloads(client);
    expect((await verifyPayloads(client)).covered).toBe(29);
    await client`SAVEPOINT invalid_body`;
    await expect(Promise.resolve(client`UPDATE visual_artifacts SET image_object='{"body":"embedded"}'::jsonb`)).rejects.toThrow();
    await client`ROLLBACK TO SAVEPOINT invalid_body`;
  }), 30_000);
  test("refuses missing receipts and leaves original data intact", async () => fixture(async () => {
    await client`SAVEPOINT cutover_attempt`;
    await expect(cutover()).rejects.toThrow("Unverified or changed storage payload");
    await client`ROLLBACK TO SAVEPOINT cutover_attempt`;
    expect((await client`SELECT count(*)::int AS n FROM visual_artifacts WHERE image IS NOT NULL`)[0]!.n).toBe(19);
  }));
  test("transaction rejects stale sources; recopy processes only changed rows", async () => fixture(async () => {
    await copyPayloads(client);
    await client`UPDATE visual_artifacts SET image=${Buffer.from("changed")} WHERE id='00'`;
    // Coverage intentionally does not hash source bodies. SQL conversion owns that check.
    expect((await verifyPayloads(client)).covered).toBe(29);
    await client`SAVEPOINT stale_cutover`;
    await expect(cutover()).rejects.toThrow("Unverified or changed storage payload");
    await client`ROLLBACK TO SAVEPOINT stale_cutover`;
    await copyPayloads(client);
    expect((await verifyPayloads(client)).covered).toBe(29);
  }));
  test("failed uploads leave no receipt and resume only unfinished rows", async () => fixture(async () => {
    const upload = spyOn(testPayloadStore, "putIfAbsent").mockRejectedValue(new Error("upload unavailable"));
    try { await expect(copyPayloads(client)).rejects.toThrow("upload unavailable"); }
    finally { upload.mockRestore(); }
    expect((await client`SELECT count(*)::int AS n FROM storage_payload_migration_receipts`)[0]!.n).toBe(0);
    await copyPayloads(client);
    await client`DELETE FROM storage_payload_migration_receipts WHERE source_table='visual_artifacts' AND row_key='{"id":"00"}'`;
    await expect(verifyPayloads(client)).rejects.toThrow("Missing or mismatched");
    const retry = spyOn(testPayloadStore, "putIfAbsent");
    try { await copyPayloads(client); expect(retry).toHaveBeenCalledTimes(1); }
    finally { retry.mockRestore(); }
    expect((await verifyPayloads(client)).covered).toBe(29);
  }));
  test("bounded batches retain successful siblings when one upload fails", async () => fixture(async () => {
    const original = testPayloadStore.putIfAbsent.bind(testPayloadStore);
    const failedKey = `payloads/v1/binary/${payloadHash(Buffer.from([0, 255, 0, 13, 10]))}`;
    let active = 0, peak = 0;
    const upload = spyOn(testPayloadStore, "putIfAbsent").mockImplementation(async (key, bytes) => {
      active++; peak = Math.max(peak, active);
      try {
        await Bun.sleep(10);
        if (key === failedKey) throw new Error("one destination unavailable");
        return await original(key, bytes);
      } finally { active--; }
    });
    try {
      await expect(copyPayloads(client)).rejects.toThrow("one destination unavailable");
      expect(active).toBe(0);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(16);
      expect((await client`SELECT count(*)::int AS n FROM storage_payload_migration_receipts WHERE source_table='visual_artifacts'`)[0]!.n).toBe(10);
    } finally { upload.mockRestore(); }
    await copyPayloads(client);
    expect((await verifyPayloads(client)).covered).toBe(29);
  }));
  test("a SQL-rejected legacy receipt resumes only that row, without rescanning completed objects", async () => fixture(async () => {
    await copyPayloads(client);
    await client`UPDATE storage_payload_migration_receipts SET source_version=NULL`;
    await client`UPDATE visual_artifacts SET image=${Buffer.from("legacy changed")} WHERE id='00'`;
    await copyPayloads(client); // Legacy receipts are preserved until SQL identifies a stale source.
    await client`SAVEPOINT legacy_cutover`;
    let rejected: unknown;
    try { await cutover(); } catch (error) { rejected = error; }
    expect(rejected).toBeInstanceOf(Error);
    await client`ROLLBACK TO SAVEPOINT legacy_cutover`;
    expect(await retryRejectedLegacyReceipt(client, new Error("Drizzle query failed", { cause: rejected }))).toBe(true);
    expect((await client`SELECT count(*)::int AS n FROM storage_payload_migration_receipts WHERE source_version='retry-rejected'`)[0]!.n).toBe(1);
    const upload = spyOn(testPayloadStore, "putIfAbsent"), download = spyOn(testPayloadStore, "get");
    try {
      await copyPayloads(client);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(download).not.toHaveBeenCalled();
      await cutover();
      expect((await verifyPayloads(client)).covered).toBe(29);
    } finally { upload.mockRestore(); download.mockRestore(); }
  }));
  test("unrelated database errors do not mark receipts for retry", async () => fixture(async () => {
    await copyPayloads(client);
    await client`UPDATE storage_payload_migration_receipts SET source_version=NULL`;
    expect(await retryRejectedLegacyReceipt(client, new Error("connection lost"))).toBe(false);
    expect((await client`SELECT count(*)::int AS n FROM storage_payload_migration_receipts WHERE source_version IS NOT NULL`)[0]!.n).toBe(0);
  }));
  test("document smoke reads at most two actual migrated documents and propagates read errors", async () => fixture(async () => {
    await copyPayloads(client);
    await cutover();
    const read = spyOn(testPayloadStore, "get");
    try {
      expect((await smokePayloadDocuments(client)).readExistingDocuments).toBe(2);
      expect(read).toHaveBeenCalledTimes(2);
      read.mockRejectedValue(new Error("bucket unavailable"));
      await expect(smokePayloadDocuments(client)).rejects.toThrow("bucket unavailable");
    } finally { read.mockRestore(); }
  }));
  test("ordinary startup cannot cut over populated data even with complete receipts", async () => fixture(async () => {
    await copyPayloads(client);
    await client`SET LOCAL influence.storage_cutover=''`;
    await client`SAVEPOINT unattended_cutover`;
    await expect(cutover()).rejects.toThrow("coordinated storage:cutover");
    await client`ROLLBACK TO SAVEPOINT unattended_cutover`;
    expect((await client`SELECT count(*)::int AS n FROM visual_artifacts WHERE image IS NOT NULL`)[0]!.n).toBe(19);
  }));
  test("preflight catches embedded images outside registered body columns", async () => fixture(async () => {
    await client`CREATE TABLE forgotten_document(id text, document jsonb)`;
    await client`INSERT INTO forgotten_document VALUES ('id',${client.json({ image: `data:image/png;base64,${"A".repeat(256)}` })})`;
    await expect(auditEmbeddedBinaries(client)).rejects.toThrow("Unclassified embedded binary");
  }));
  test("refuses an unclassified binary column", async () => fixture(async () => {
    await client`CREATE TABLE forgotten_binary(id text, content bytea)`;
    await expect(copyPayloads(client)).rejects.toThrow("Unclassified binary column");
  }));
});
