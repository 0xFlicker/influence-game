import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL(
  "../../drizzle/0058_gorgeous_infant_terrible.sql",
  import.meta.url,
);

describe("provider call journal migration", () => {
  test("applies over populated pre-U2 game ownership data", async () => {
    const db = await setupTestDB();
    const testSchema = `provider_journal_${randomUUID().replaceAll("-", "")}`;
    await createPopulatedFixture(db, testSchema);

    try {
      await applyScopedMigration(db, testSchema);
      const parents = await db.execute<{ game_count: number; owner_count: number }>(
        sql.raw(`
          SELECT
            (SELECT count(*)::int FROM "${testSchema}"."games") AS game_count,
            (SELECT count(*)::int FROM "${testSchema}"."game_run_owners") AS owner_count
        `),
      );
      expect(parents[0]).toEqual({ game_count: 1, owner_count: 1 });

      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."provider_logical_calls" (
          "id", "game_id", "actor_name", "actor_role", "action", "logical_call_ordinal"
        ) VALUES ('logical-1', 'game-1', 'Atlas', 'player', 'vote', 1);
        INSERT INTO "${testSchema}"."provider_call_attempts" (
          "id", "logical_call_id", "game_id", "owner_epoch", "attempt_ordinal",
          "transport_attempt_id", "reservation_hash", "status", "request_shape",
          "provider_profile_id", "model_name", "started_at", "indeterminate_at",
          "indeterminate_reason", "evidence_state"
        ) VALUES (
          'attempt-1', 'logical-1', 'game-1', 'owner-1', 1,
          'transport-1', 'reservation-1', 'indeterminate', 'responses',
          'openai', 'gpt-test', '2026-08-23T00:00:00.000Z',
          '2026-08-23T00:01:00.000Z', 'owner_lost_before_terminal', 'not_required'
        );
      `));

      const attempt = await db.execute<{
        status: string;
        indeterminate_reason: string;
      }>(sql.raw(`
        SELECT "status", "indeterminate_reason"
        FROM "${testSchema}"."provider_call_attempts"
      `));
      expect(attempt[0]).toEqual({
        status: "indeterminate",
        indeterminate_reason: "owner_lost_before_terminal",
      });
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
    CREATE TABLE "${testSchema}"."game_evidence_manifests" (
      "id" text PRIMARY KEY
    );
    INSERT INTO "${testSchema}"."games" ("id") VALUES ('game-1');
    INSERT INTO "${testSchema}"."game_run_owners" ("game_id", "owner_epoch")
      VALUES ('game-1', 'owner-1');
  `));
}

async function applyScopedMigration(db: DrizzleDB, testSchema: string): Promise<void> {
  let migration = await Bun.file(MIGRATION_PATH).text();
  for (const table of [
    "provider_attempt_evidence_outbox",
    "provider_call_attempts",
    "provider_logical_calls",
  ]) {
    migration = migration.replaceAll(`"${table}"`, `"${testSchema}"."${table}"`);
  }
  migration = migration.replaceAll(`"public"."${testSchema}".`, `"${testSchema}".`);
  for (const table of ["games", "game_run_owners", "game_evidence_manifests"]) {
    migration = migration.replaceAll(`"public"."${table}"`, `"${testSchema}"."${table}"`);
  }
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
}
