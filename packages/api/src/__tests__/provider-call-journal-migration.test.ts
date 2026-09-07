import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const BASE_MIGRATION_PATH = new URL(
  "../../drizzle/0058_gorgeous_infant_terrible.sql",
  import.meta.url,
);
const UPGRADE_MIGRATION_PATH = new URL(
  "../../drizzle/0061_provider_resilience_runtime_upgrade.sql",
  import.meta.url,
);
const NATIVE_TRANSPORT_MIGRATION_PATH = new URL(
  "../../drizzle/0062_provider_native_transports.sql",
  import.meta.url,
);
const BUDGET_INDEX_MIGRATION_PATH = new URL(
  "../../drizzle/0063_provider_call_attempts_game_catalog_index.sql",
  import.meta.url,
);
const SEMANTIC_COORDINATE_MIGRATION_PATH = new URL(
  "../../drizzle/0075_provider_semantic_coordinates.sql",
  import.meta.url,
);

describe("provider call journal migration", () => {
  test("applies over populated pre-U2 game ownership data", async () => {
    const db = await setupTestDB();
    const testSchema = `provider_journal_${randomUUID().replaceAll("-", "")}`;
    await createPopulatedFixture(db, testSchema);

    try {
      await applyScopedMigration(db, testSchema, BASE_MIGRATION_PATH);
      const parents = await db.execute<{
        game_count: number;
        owner_count: number;
      }>(
        sql.raw(`
          SELECT
            (SELECT count(*)::int FROM "${testSchema}"."games") AS game_count,
            (SELECT count(*)::int FROM "${testSchema}"."game_run_owners") AS owner_count
        `),
      );
      expect(parents[0]).toEqual({ game_count: 1, owner_count: 1 });

      await db.execute(
        sql.raw(`
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
      `),
      );

      const attempt = await db.execute<{
        status: string;
        indeterminate_reason: string;
      }>(
        sql.raw(`
        SELECT "status", "indeterminate_reason"
        FROM "${testSchema}"."provider_call_attempts"
      `),
      );
      expect(attempt[0]).toEqual({
        status: "indeterminate",
        indeterminate_reason: "owner_lost_before_terminal",
      });
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("upgrades an already-applied provider journal without rebuilding it", async () => {
    const db = await setupTestDB();
    const testSchema = `provider_journal_upgrade_${randomUUID().replaceAll("-", "")}`;
    await createPopulatedFixture(db, testSchema);

    try {
      await applyScopedMigration(db, testSchema, BASE_MIGRATION_PATH);
      await db.execute(
        sql.raw(`
        INSERT INTO "${testSchema}"."provider_logical_calls" (
          "id", "game_id", "actor_name", "actor_role", "action", "logical_call_ordinal"
        ) VALUES ('logical-upgrade', 'game-1', 'Atlas', 'player', 'vote', 1);
        INSERT INTO "${testSchema}"."provider_call_attempts" (
          "id", "logical_call_id", "game_id", "owner_epoch", "attempt_ordinal",
          "transport_attempt_id", "reservation_hash", "status", "request_shape",
          "provider_profile_id", "model_name", "started_at", "evidence_state"
        ) VALUES (
          'attempt-upgrade', 'logical-upgrade', 'game-1', 'owner-1', 1,
          'transport-upgrade', 'reservation-upgrade', 'reserved', 'responses',
          'openai', 'gpt-test', '2026-08-23T00:00:00.000Z', 'not_required'
        );
      `),
      );

      await applyScopedMigration(db, testSchema, UPGRADE_MIGRATION_PATH);
      await applyScopedMigration(db, testSchema, NATIVE_TRANSPORT_MIGRATION_PATH);
      await applyScopedMigration(db, testSchema, BUDGET_INDEX_MIGRATION_PATH);

      const transports = await db.execute<{ transport: string }>(sql.raw(`
        SELECT "request_shape" AS "transport"
        FROM "${testSchema}"."provider_call_attempts"
      `));
      expect(transports[0]).toEqual({ transport: "openai.responses" });

      const columns = await db.execute<{
        table_name: string;
        column_name: string;
      }>(
        sql.raw(`
        SELECT "table_name", "column_name"
        FROM information_schema.columns
        WHERE "table_schema" = '${testSchema}'
          AND (
            ("table_name" = 'provider_logical_calls' AND "column_name" LIKE 'accepted_%')
            OR ("table_name" = 'provider_attempt_evidence_outbox' AND "column_name" IN (
              'reconciliation_attempt_count', 'next_reconciliation_at',
              'claim_token', 'claim_expires_at'
            ))
          )
        ORDER BY "table_name", "column_name"
      `),
      );
      expect([...columns]).toEqual([
        {
          table_name: "provider_attempt_evidence_outbox",
          column_name: "claim_expires_at",
        },
        {
          table_name: "provider_attempt_evidence_outbox",
          column_name: "claim_token",
        },
        {
          table_name: "provider_attempt_evidence_outbox",
          column_name: "next_reconciliation_at",
        },
        {
          table_name: "provider_attempt_evidence_outbox",
          column_name: "reconciliation_attempt_count",
        },
        { table_name: "provider_logical_calls", column_name: "accepted_at" },
        {
          table_name: "provider_logical_calls",
          column_name: "accepted_attempt_id",
        },
        {
          table_name: "provider_logical_calls",
          column_name: "accepted_catalog_id",
        },
        { table_name: "provider_logical_calls", column_name: "accepted_value" },
        {
          table_name: "provider_logical_calls",
          column_name: "accepted_value_sha256",
        },
      ]);

      const constraints = await db.execute<{ definition: string }>(
        sql.raw(`
        SELECT pg_get_constraintdef(oid) AS "definition"
        FROM pg_constraint
        WHERE connamespace = '${testSchema}'::regnamespace
          AND conname = 'provider_call_attempts_outcome_check'
      `),
      );
      expect(constraints[0]?.definition).toContain("request_error");

      const indexes = await db.execute<{ indexname: string }>(
        sql.raw(`
        SELECT "indexname"
        FROM pg_indexes
        WHERE "schemaname" = '${testSchema}'
          AND "tablename" = 'provider_attempt_evidence_outbox'
        ORDER BY "indexname"
      `),
      );
      expect([...indexes].map((row) => row.indexname)).toContain(
        "provider_attempt_evidence_outbox_created_idx",
      );
      expect([...indexes].map((row) => row.indexname)).toContain(
        "provider_attempt_evidence_outbox_ready_idx",
      );

      const attemptIndexes = await db.execute<{
        indexname: string;
        indexdef: string;
      }>(
        sql.raw(`
        SELECT "indexname", "indexdef"
        FROM pg_indexes
        WHERE "schemaname" = '${testSchema}'
          AND "tablename" = 'provider_call_attempts'
      `),
      );
      const budgetIndex = [...attemptIndexes].find(
        (row) => row.indexname === "provider_call_attempts_game_catalog_idx",
      );
      expect(budgetIndex?.indexdef.replaceAll('"', "")).toContain(
        "USING btree (game_id, catalog_id)",
      );

      await db.execute(
        sql.raw(`
        UPDATE "${testSchema}"."provider_logical_calls"
        SET
          "accepted_attempt_id" = 'attempt-upgrade',
          "accepted_catalog_id" = 'openai:gpt-test',
          "accepted_value" = '{"target":"mira"}'::jsonb,
          "accepted_value_sha256" = 'sha256:accepted',
          "accepted_at" = '2026-08-24T00:00:00.000Z'
        WHERE "id" = 'logical-upgrade';
      `),
      );
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("moves populated journals to nullable legacy ordinals and semantic-coordinate storage", async () => {
    const db = await setupTestDB();
    const testSchema = `provider_journal_bigint_${randomUUID().replaceAll("-", "")}`;
    await createPopulatedFixture(db, testSchema);

    try {
      await applyScopedMigration(db, testSchema, BASE_MIGRATION_PATH);
      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."provider_logical_calls" (
          "id", "game_id", "actor_name", "actor_role", "action", "logical_call_ordinal"
        ) VALUES ('logical-wide', 'game-1', 'The House', 'house', 'house-question', 1)
      `));

      await applyScopedMigration(db, testSchema, SEMANTIC_COORDINATE_MIGRATION_PATH);
      const columns = await db.execute<{
        column_name: string;
        is_nullable: string;
      }>(sql.raw(`
        SELECT "column_name", "is_nullable"
        FROM information_schema.columns
        WHERE "table_schema" = '${testSchema}'
          AND "table_name" = 'provider_logical_calls'
          AND "column_name" IN (
            'logical_call_ordinal', 'semantic_coordinate', 'semantic_coordinate_hash'
          )
        ORDER BY "column_name"
      `));
      expect([...columns]).toEqual([
        { column_name: "logical_call_ordinal", is_nullable: "YES" },
        { column_name: "semantic_coordinate", is_nullable: "YES" },
        { column_name: "semantic_coordinate_hash", is_nullable: "YES" },
      ]);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});

async function createPopulatedFixture(
  db: DrizzleDB,
  testSchema: string,
): Promise<void> {
  await db.execute(
    sql.raw(`
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
  `),
  );
}

async function applyScopedMigration(
  db: DrizzleDB,
  testSchema: string,
  migrationPath: URL,
): Promise<void> {
  let migration = await Bun.file(migrationPath).text();
  for (const table of [
    "provider_attempt_evidence_outbox",
    "provider_call_attempts",
    "provider_logical_calls",
  ]) {
    migration = migration.replaceAll(
      `"${table}"`,
      `"${testSchema}"."${table}"`,
    );
  }
  migration = migration.replaceAll(
    `"public"."${testSchema}".`,
    `"${testSchema}".`,
  );
  for (const table of ["games", "game_run_owners", "game_evidence_manifests"]) {
    migration = migration.replaceAll(
      `"public"."${table}"`,
      `"${testSchema}"."${table}"`,
    );
  }
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
}
