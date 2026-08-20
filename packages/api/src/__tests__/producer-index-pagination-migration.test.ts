import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL(
  "../../drizzle/0057_married_mojo.sql",
  import.meta.url,
);

test("producer index pagination migration preserves evidence and adds insertion defaults without backfill", async () => {
  const db = await setupTestDB();
  const testSchema = `producer_index_${randomUUID().replaceAll("-", "")}`;
  await createPreMigrationFixture(db, testSchema);

  try {
    const migrationStatements = readFileSync(MIGRATION_PATH, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => statement
        .replaceAll(
          '"game_cognitive_artifacts"',
          `"${testSchema}"."game_cognitive_artifacts"`,
        )
        .replaceAll(
          '"game_evidence_manifests"',
          `"${testSchema}"."game_evidence_manifests"`,
        ));
    for (const statement of migrationStatements) {
      await db.execute(sql.raw(statement));
    }

    const counts = await db.execute<{
      cognitive_count: number;
      trace_count: number;
    }>(sql.raw(`
      SELECT
        (SELECT count(*)::int FROM "${testSchema}"."game_cognitive_artifacts") AS cognitive_count,
        (SELECT count(*)::int FROM "${testSchema}"."game_evidence_manifests") AS trace_count
    `));
    expect(counts[0]).toEqual({ cognitive_count: 2, trace_count: 3 });

    const historicalXids = await db.execute<{
      cognitive_null_count: number;
      trace_null_count: number;
    }>(sql.raw(`
      SELECT
        (SELECT count(*)::int FROM "${testSchema}"."game_cognitive_artifacts"
          WHERE index_insert_xid IS NULL) AS cognitive_null_count,
        (SELECT count(*)::int FROM "${testSchema}"."game_evidence_manifests"
          WHERE index_insert_xid IS NULL) AS trace_null_count
    `));
    expect(historicalXids[0]).toEqual({ cognitive_null_count: 2, trace_null_count: 3 });

    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."game_cognitive_artifacts" (id, game_id, created_at)
        VALUES ('cognition-new', 'game-1', '2026-08-19T12:00:00Z');
      INSERT INTO "${testSchema}"."game_evidence_manifests" (id, game_id, evidence_type, created_at)
        VALUES ('trace-new', 'game-1', 'private_agent_trace', '2026-08-19T12:00:00Z');
    `));
    const newXids = await db.execute<{
      cognitive_xid: string;
      trace_xid: string;
    }>(sql.raw(`
      SELECT
        (SELECT index_insert_xid FROM "${testSchema}"."game_cognitive_artifacts"
          WHERE id = 'cognition-new') AS cognitive_xid,
        (SELECT index_insert_xid FROM "${testSchema}"."game_evidence_manifests"
          WHERE id = 'trace-new') AS trace_xid
    `));
    expect(newXids[0]?.cognitive_xid).toMatch(/^\d+$/);
    expect(newXids[0]?.trace_xid).toMatch(/^\d+$/);

    const indexes = await db.execute<{ indexname: string; indexdef: string }>(sql.raw(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = '${testSchema}'
      ORDER BY indexname
    `));
    const definitions = Object.fromEntries(
      [...indexes].map(({ indexname, indexdef }) => [indexname, indexdef.replaceAll('"', "")]),
    );
    expect(definitions).toHaveProperty("game_evidence_manifests_game_id_idx");
    expect(definitions).not.toHaveProperty("game_cognitive_artifacts_game_created_id_idx");
    expect(definitions).not.toHaveProperty("game_evidence_manifests_game_evidence_created_id_idx");
  } finally {
    await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
  }
});

async function createPreMigrationFixture(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE SCHEMA "${testSchema}";
    CREATE TABLE "${testSchema}"."game_cognitive_artifacts" (
      id text PRIMARY KEY,
      game_id text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE "${testSchema}"."game_evidence_manifests" (
      id text PRIMARY KEY,
      game_id text NOT NULL,
      evidence_type text NOT NULL,
      created_at text NOT NULL
    );
    CREATE INDEX "game_evidence_manifests_game_id_idx"
      ON "${testSchema}"."game_evidence_manifests" (game_id);
    INSERT INTO "${testSchema}"."game_cognitive_artifacts" (id, game_id, created_at)
      VALUES ('cognition-1', 'game-1', '2026-08-19T12:00:00Z'),
             ('cognition-2', 'game-1', '2026-08-19T12:00:00Z');
    INSERT INTO "${testSchema}"."game_evidence_manifests" (id, game_id, evidence_type, created_at)
      VALUES ('trace-1', 'game-1', 'private_agent_trace', '2026-08-19T12:00:00Z'),
             ('trace-2', 'game-1', 'private_agent_trace', '2026-08-19T12:00:00Z'),
             ('trace-3', 'game-1', 'other', '2026-08-19T12:00:00Z');
  `));
}
