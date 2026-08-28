import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATHS = [
  new URL("../../drizzle/0070_durable_game_turns.sql", import.meta.url),
  new URL("../../drizzle/0071_durable_game_turn_pacing.sql", import.meta.url),
];

describe("durable game turn migration", () => {
  test("is additive over populated ownership and provider journal rows", async () => {
    const db = await setupTestDB();
    const testSchema = `durable_turn_${randomUUID().replaceAll("-", "")}`;
    await createPopulatedFixture(db, testSchema);

    try {
      await applyScopedMigration(db, testSchema);
      const tables = await db.execute<{ table_name: string }>(sql.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${testSchema}'
          AND table_name IN ('game_execution_states', 'game_turns', 'game_publications')
        ORDER BY table_name
      `));
      expect([...tables].map((row) => row.table_name)).toEqual([
        "game_execution_states",
        "game_publications",
        "game_turns",
      ]);

      const pacingColumns = await db.execute<{ column_name: string }>(sql.raw(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = '${testSchema}'
          AND table_name = 'game_execution_states'
          AND column_name IN ('last_presentation_phase', 'next_publication_available_at')
        ORDER BY column_name
      `));
      expect([...pacingColumns].map((row) => row.column_name)).toEqual([
        "last_presentation_phase",
        "next_publication_available_at",
      ]);

      const existing = await db.execute<{
        id: string;
        game_turn_id: string | null;
        game_turn_subcall_slot: number | null;
      }>(sql.raw(`
        SELECT id, game_turn_id, game_turn_subcall_slot
        FROM "${testSchema}"."provider_logical_calls"
      `));
      expect(existing[0]).toEqual({
        id: "logical-existing",
        game_turn_id: null,
        game_turn_subcall_slot: null,
      });

      const executionRows = await db.execute<{ count: number }>(sql.raw(`
        SELECT count(*)::int AS count
        FROM "${testSchema}"."game_execution_states"
      `));
      expect(executionRows[0]?.count).toBe(0);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});

async function createPopulatedFixture(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE SCHEMA "${testSchema}";
    CREATE TABLE "${testSchema}"."games" (
      "id" text PRIMARY KEY
    );
    CREATE TABLE "${testSchema}"."game_run_owners" (
      "game_id" text NOT NULL,
      "owner_epoch" text NOT NULL,
      UNIQUE ("game_id", "owner_epoch")
    );
    CREATE TABLE "${testSchema}"."provider_logical_calls" (
      "id" text PRIMARY KEY,
      "game_id" text NOT NULL
    );
    CREATE TABLE "${testSchema}"."transcripts" (
      "id" serial PRIMARY KEY,
      "game_id" text NOT NULL
    );
    INSERT INTO "${testSchema}"."games" ("id") VALUES ('game-existing');
    INSERT INTO "${testSchema}"."game_run_owners" ("game_id", "owner_epoch")
      VALUES ('game-existing', 'owner-existing');
    INSERT INTO "${testSchema}"."provider_logical_calls" ("id", "game_id")
      VALUES ('logical-existing', 'game-existing');
  `));
}

async function applyScopedMigration(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const migrationPath of MIGRATION_PATHS) {
      let migration = await Bun.file(migrationPath).text();
      for (const table of [
        "game_execution_states",
        "game_turns",
        "game_publications",
        "provider_logical_calls",
        "transcripts",
      ]) {
        migration = migration.replaceAll(`"${table}"`, `"${testSchema}"."${table}"`);
      }
      migration = migration.replaceAll(`"public"."${testSchema}".`, `"${testSchema}".`);
      for (const table of ["games", "game_run_owners"]) {
        migration = migration.replaceAll(`"public"."${table}"`, `"${testSchema}"."${table}"`);
      }
      const statements = migration
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await tx.execute(sql.raw(statement));
    }
  });
}
