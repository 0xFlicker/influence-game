import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { setupTestDB } from "./test-utils.js";
import { testPayloadStore } from "./payload-test-store.js";
import { STORAGE_PAYLOAD_COLUMNS } from "../services/storage-payload-inventory.js";
import { copyPayloads, inventoryPayloads, verifyPayloads } from "../services/storage-payload-migration.js";
import { payloadHash, readPayload } from "../services/payload-storage.js";

const client = postgres(process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test", { max: 1, onnotice: () => {} });
const migration = ["0119_private_payload_storage.sql", "0120_private_auxiliary_documents.sql", "0121_visual_request_query_metadata.sql"].map(file => readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")).join("\n--> statement-breakpoint\n");
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
      columns.set(entry.column, entry.kind === "binary" ? "bytea" : entry.kind === "text" ? "text" : "jsonb");
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
    await client`INSERT INTO account_text_operations(id,result) VALUES ('account','{"text":"draft"}')`;
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
    expect(first.verified).toBe(29);
    await copyPayloads(client);
    expect((await verifyPayloads(client)).verified).toBe(29);
    await cutover();
    expect((await inventoryPayloads(client)).every(row => row.state === "cut_over")).toBe(true);
    expect((await verifyPayloads(client)).verified).toBe(29);
    const [metadata] = await client`SELECT scene_id,action,acknowledged_attempt_ids FROM visual_media_requests`;
    expect(metadata).toEqual({ scene_id: "scene", action: "regenerate", acknowledged_attempt_ids: ["attempt"] });
    const [retro] = await client`SELECT input_object FROM game_retrospective_inputs`;
    expect(payloadHash(await readPayload(retro!.input_object))).toBe(before!.hash);
    const images = await client`SELECT id,image_object FROM visual_artifacts ORDER BY id`;
    expect(images).toHaveLength(19);
    for (const row of images) expect(await readPayload(row.image_object)).toEqual(Buffer.from([Number(row.id) % 3, 255, 0, 13, 10]));
    expect((await client`SELECT snapshot_object FROM game_checkpoints`)[0]!.snapshot_object).toBeNull();
    expect(await client`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND data_type='bytea'`).toHaveLength(0);
    // A rerun cannot rewrite already-cut-over rows.
    await copyPayloads(client);
    expect((await verifyPayloads(client)).verified).toBe(29);
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
  test("rejects changed sources and corrupt objects, then resumes after recopy", async () => fixture(async () => {
    await copyPayloads(client);
    await client`UPDATE visual_artifacts SET image=${Buffer.from("changed")} WHERE id='00'`;
    await expect(verifyPayloads(client)).rejects.toThrow("changed payloads");
    await client`SAVEPOINT stale_cutover`;
    await expect(cutover()).rejects.toThrow("Unverified or changed storage payload");
    await client`ROLLBACK TO SAVEPOINT stale_cutover`;
    await copyPayloads(client);
    const [receipt] = await client`SELECT object_reference FROM storage_payload_migration_receipts WHERE source_table='visual_artifacts' AND row_key='{"id":"00"}'::jsonb`;
    const key = receipt!.object_reference.key, bytes = testPayloadStore.objects.get(key)!;
    testPayloadStore.objects.set(key, Buffer.from("corruption"));
    await expect(verifyPayloads(client)).rejects.toThrow("integrity mismatch");
    testPayloadStore.objects.set(key, bytes);
    expect((await verifyPayloads(client)).verified).toBe(29);
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
    await expect(copyPayloads(client)).rejects.toThrow("Unclassified embedded binary");
  }));
  test("refuses an unclassified binary column", async () => fixture(async () => {
    await client`CREATE TABLE forgotten_binary(id text, content bytea)`;
    await expect(copyPayloads(client)).rejects.toThrow("Unclassified binary column");
  }));
});
