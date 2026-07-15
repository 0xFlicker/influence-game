import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { HOUSE_AGENT_NAMES } from "@influence/engine";
import { sql } from "drizzle-orm";
import { createDB, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const DEFERRED_PREFLIGHT_PATH = new URL("../../drizzle/0036_global_agent_name_uniqueness.sql", import.meta.url);
const DROP_INDEX_PATH = new URL("../../drizzle/0037_defer_agent_name_uniqueness.sql", import.meta.url);
const REPAIR_PATH = new URL("../../drizzle/0038_repair_agent_name_uniqueness.sql", import.meta.url);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test";

describe("global agent-name uniqueness repair migration", () => {
  test("repairs normalized and House collisions while preserving identity and historical state", async () => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("agent_name_repair");
    const longName = "A".repeat(80);
    await createMigrationFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."agent_profiles"
        ("id", "user_id", "name", "current_revision_id", "games_played", "games_won", "created_at", "updated_at")
      VALUES
        ('lyra-old', 'user-a', 'Lyra', 'revision-lyra', 7, 2, '2025-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
        ('lyra-new', 'user-b', '  LYRA  ', NULL, 1, 0, '2025-02-01T00:00:00Z', '2025-06-02T00:00:00Z'),
        ('rook-old', 'user-c', 'Rook', NULL, 0, 0, '2025-01-01T00:00:00Z', '2025-06-03T00:00:00Z'),
        ('rook-new', 'user-d', ' rook ', NULL, 0, 0, '2025-02-01T00:00:00Z', '2025-06-04T00:00:00Z'),
        ('rook-suffix', 'user-e', 'Rook II', NULL, 0, 0, '2025-03-01T00:00:00Z', '2025-06-05T00:00:00Z'),
        ('crow-1', 'user-f', 'Crow', NULL, 0, 0, '2025-01-01T00:00:00Z', '2025-06-06T00:00:00Z'),
        ('crow-2', 'user-g', 'CROW', NULL, 0, 0, '2025-02-01T00:00:00Z', '2025-06-07T00:00:00Z'),
        ('crow-3', 'user-h', ' crow ', NULL, 0, 0, '2025-03-01T00:00:00Z', '2025-06-08T00:00:00Z'),
        ('crow-4', 'user-i', 'Crow', NULL, 0, 0, '2025-04-01T00:00:00Z', '2025-06-09T00:00:00Z'),
        ('crow-5', 'user-j', 'Crow', NULL, 0, 0, '2025-05-01T00:00:00Z', '2025-06-10T00:00:00Z'),
        ('long-old', 'user-k', '${longName}', NULL, 0, 0, '2025-01-01T00:00:00Z', '2025-06-11T00:00:00Z'),
        ('long-new', 'user-l', '${longName}', NULL, 0, 0, '2025-02-01T00:00:00Z', '2025-06-12T00:00:00Z'),
        ('chronos-old', 'user-m', 'Chronos', NULL, 0, 0, '2025-01-01T01:00:00Z', '2025-06-13T00:00:00Z'),
        ('chronos-new', 'user-n', 'chronos', NULL, 0, 0, '2025-01-01 23:00:00+00', '2025-06-14T00:00:00Z'),
        ('tie-a', 'user-o', 'Tiebreak', NULL, 0, 0, '2025-01-02T00:00:00Z', '2025-06-15T00:00:00Z'),
        ('tie-b', 'user-p', 'tiebreak', NULL, 0, 0, '2025-01-02T00:00:00Z', '2025-06-16T00:00:00Z');

      INSERT INTO "${testSchema}"."games" ("id", "status", "started_at") VALUES
        ('waiting-game', 'waiting', NULL),
        ('started-waiting-game', 'waiting', '2025-07-01T00:00:00Z'),
        ('active-game', 'in_progress', '2025-07-01T00:00:00Z'),
        ('completed-game', 'completed', '2025-07-01T00:00:00Z'),
        ('cancelled-game', 'cancelled', NULL),
        ('suspended-game', 'suspended', '2025-07-01T00:00:00Z'),
        ('malformed-waiting-game', 'waiting', NULL),
        ('scalar-waiting-game', 'waiting', NULL);

      INSERT INTO "${testSchema}"."game_players"
        ("id", "game_id", "agent_profile_id", "agent_revision_id", "persona", "joined_at")
      SELECT
        'seat-' || "id",
        "id",
        'lyra-old',
        'revision-lyra',
        '{"name":"Lyra","personality":"Patient","strategyHints":"Observe"}',
        '2025-06-15T00:00:00Z'
      FROM "${testSchema}"."games";

      INSERT INTO "${testSchema}"."game_players"
        ("id", "game_id", "agent_profile_id", "agent_revision_id", "persona", "joined_at")
      VALUES (
        'seat-unowned-name-conflict',
        'waiting-game',
        NULL,
        NULL,
        '{"name":"Lyra II","personality":"Historical unowned seat"}',
        '2025-06-15T00:00:00Z'
      );

      UPDATE "${testSchema}"."game_players"
      SET "persona" = 'not-json'
      WHERE "game_id" = 'malformed-waiting-game';
      UPDATE "${testSchema}"."game_players"
      SET "persona" = '"legacy-scalar"'
      WHERE "game_id" = 'scalar-waiting-game';

      INSERT INTO "${testSchema}"."agent_revisions" ("id", "agent_profile_id", "fingerprint")
      VALUES ('revision-lyra', 'lyra-old', 'fingerprint-before');
      INSERT INTO "${testSchema}"."agent_competition_ratings" ("agent_profile_id", "mu", "sigma")
      VALUES ('lyra-old', 27.5, 7.25);
      INSERT INTO "${testSchema}"."free_game_queue" ("agent_profile_id", "entered_at")
      VALUES ('lyra-old', '2025-06-10T00:00:00Z');
    `));

    try {
      await applyDeferredMigrations(db, testSchema);
      await applyRepairMigration(db, testSchema);

      const names = await db.execute(sql.raw(`
        SELECT "id", "name"
        FROM "${testSchema}"."agent_profiles"
        ORDER BY "id"
      `));
      const byId = Object.fromEntries([...names].map((row) => [row.id, row.name]));
      expect(byId).toMatchObject({
        "lyra-old": "Lyra III",
        "lyra-new": "Lyra IV",
        "rook-old": "Rook",
        "rook-new": "Rook III",
        "rook-suffix": "Rook II",
        "crow-1": "Crow",
        "crow-2": "Crow II",
        "crow-3": "Crow III",
        "crow-4": "Crow IV",
        "crow-5": "Crow V",
        "long-old": longName,
        "chronos-old": "Chronos",
        "chronos-new": "Chronos II",
        "tie-a": "Tiebreak",
        "tie-b": "Tiebreak II",
      });
      expect(typeof byId["long-new"]).toBe("string");
      expect((byId["long-new"] as string).endsWith(" II")).toBe(true);
      expect((byId["long-new"] as string).length).toBe(80);

      const profile = await db.execute(sql.raw(`
        SELECT "user_id", "current_revision_id", "games_played", "games_won", "created_at", "updated_at"
        FROM "${testSchema}"."agent_profiles"
        WHERE "id" = 'lyra-old'
      `));
      expect(profile[0]).toEqual({
        user_id: "user-a",
        current_revision_id: "revision-lyra",
        games_played: 7,
        games_won: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-06-01T00:00:00Z",
      });

      const seats = await db.execute(sql.raw(`
        SELECT game."id" AS "game_id", player."agent_revision_id", player."joined_at", player."persona"
        FROM "${testSchema}"."game_players" player
        JOIN "${testSchema}"."games" game ON game."id" = player."game_id"
        WHERE player."agent_profile_id" = 'lyra-old'
        ORDER BY game."id"
      `));
      const seatNames = Object.fromEntries([...seats].map((seat) => [
        seat.game_id,
        seat.game_id === "malformed-waiting-game" || seat.game_id === "scalar-waiting-game"
          ? seat.persona
          : (JSON.parse(seat.persona as string) as { name: string }).name,
      ]));
      expect(seatNames).toEqual({
        "active-game": "Lyra",
        "cancelled-game": "Lyra",
        "completed-game": "Lyra",
        "malformed-waiting-game": "not-json",
        "scalar-waiting-game": '"legacy-scalar"',
        "started-waiting-game": "Lyra",
        "suspended-game": "Lyra",
        "waiting-game": "Lyra III",
      });
      expect([...seats].every((seat) => seat.agent_revision_id === "revision-lyra")).toBe(true);
      expect([...seats].every((seat) => seat.joined_at === "2025-06-15T00:00:00Z")).toBe(true);
      const unownedSeat = await db.execute(sql.raw(`
        SELECT "persona"
        FROM "${testSchema}"."game_players"
        WHERE "id" = 'seat-unowned-name-conflict'
      `));
      expect(JSON.parse(unownedSeat[0]!.persona as string).name).toBe("Lyra II");

      const preserved = await db.execute(sql.raw(`
        SELECT
          (SELECT count(*)::int FROM "${testSchema}"."agent_profiles") AS profiles,
          (SELECT count(*)::int FROM "${testSchema}"."agent_revisions") AS revisions,
          (SELECT count(*)::int FROM "${testSchema}"."agent_competition_ratings") AS ratings,
          (SELECT count(*)::int FROM "${testSchema}"."free_game_queue") AS queue_entries,
          (SELECT "fingerprint" FROM "${testSchema}"."agent_revisions" WHERE "id" = 'revision-lyra') AS fingerprint,
          (SELECT "mu" FROM "${testSchema}"."agent_competition_ratings" WHERE "agent_profile_id" = 'lyra-old') AS mu,
          (SELECT "sigma" FROM "${testSchema}"."agent_competition_ratings" WHERE "agent_profile_id" = 'lyra-old') AS sigma
      `));
      expect(preserved[0]).toEqual({
        profiles: 16,
        revisions: 1,
        ratings: 1,
        queue_entries: 1,
        fingerprint: "fingerprint-before",
        mu: 27.5,
        sigma: 7.25,
      });
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("installs database authority for normalized uniqueness and every House name", async () => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("agent_name_constraints");
    await createMigrationFixture(db, testSchema);

    try {
      await applyRepairMigration(db, testSchema);

      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."agent_profiles"
          ("id", "user_id", "name", "created_at", "updated_at")
        VALUES ('unique-profile', 'user-a', 'Distinct Name', '2025-01-01', '2025-01-01')
      `));
      await expectRejected(db, `
        INSERT INTO "${testSchema}"."agent_profiles"
          ("id", "user_id", "name", "created_at", "updated_at")
        VALUES ('duplicate-profile', 'user-b', '  DISTINCT NAME  ', '2025-01-02', '2025-01-02')
      `);

      for (const [index, houseName] of HOUSE_AGENT_NAMES.entries()) {
        await expectRejected(db, `
          INSERT INTO "${testSchema}"."agent_profiles"
            ("id", "user_id", "name", "created_at", "updated_at")
          VALUES ('house-${index}', 'user-${index}', '  ${houseName.toUpperCase()}  ', '2025-01-02', '2025-01-02')
        `);
      }

      const reservedNames = await db.execute<{ reserved_name: string }>(sql.raw(`
        SELECT matches[1] AS reserved_name
        FROM pg_constraint constraint_record
        JOIN pg_namespace namespace_record
          ON namespace_record.oid = constraint_record.connamespace
        CROSS JOIN LATERAL regexp_matches(
          pg_get_constraintdef(constraint_record.oid),
          '''([^'']+)''',
          'g'
        ) matches
        WHERE namespace_record.nspname = '${testSchema}'
          AND constraint_record.conname = 'agent_profiles_name_not_house_reserved'
        ORDER BY matches[1]
      `));
      expect([...reservedNames].map((row) => row.reserved_name)).toEqual(
        HOUSE_AGENT_NAMES.map((name) => name.toLowerCase()).sort(),
      );

      const authority = await db.execute(sql.raw(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = '${testSchema}'
              AND indexname = 'agent_profiles_normalized_name_unique'
          ) AS unique_index,
          EXISTS (
            SELECT 1
            FROM pg_constraint constraint_record
            JOIN pg_namespace namespace_record
              ON namespace_record.oid = constraint_record.connamespace
            WHERE namespace_record.nspname = '${testSchema}'
              AND constraint_record.conname = 'agent_profiles_name_not_house_reserved'
          ) AS house_constraint
      `));
      expect(authority[0]).toEqual({ unique_index: true, house_constraint: true });
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("converges after an earlier unique index was applied and then deferred", async () => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("agent_name_migration_state");
    await createMigrationFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."agent_profiles"
        ("id", "user_id", "name", "created_at", "updated_at")
      VALUES ('profile-a', 'user-a', 'Existing', '2025-01-01', '2025-01-01');
      CREATE UNIQUE INDEX "agent_profiles_normalized_name_unique"
        ON "${testSchema}"."agent_profiles" (lower(btrim("name")));
    `));

    try {
      await applyDeferredMigrations(db, testSchema);
      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."agent_profiles"
          ("id", "user_id", "name", "created_at", "updated_at")
        VALUES ('profile-b', 'user-b', ' existing ', '2025-02-01', '2025-02-01')
      `));
      await applyRepairMigration(db, testSchema);

      const rows = await db.execute(sql.raw(`
        SELECT "id", "name"
        FROM "${testSchema}"."agent_profiles"
        ORDER BY "id"
      `));
      expect([...rows]).toEqual([
        { id: "profile-a", name: "Existing" },
        { id: "profile-b", name: "Existing II" },
      ]);

      await expectRejected(db, `
        INSERT INTO "${testSchema}"."agent_profiles"
          ("id", "user_id", "name", "created_at", "updated_at")
        VALUES ('profile-c', 'user-c', 'EXISTING', '2025-03-01', '2025-03-01')
      `);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("waits for profile writers before acquiring weaker roster locks", async () => {
    const db = await setupTestDB();
    const blockerDb = createDB(TEST_DATABASE_URL);
    const migrationDb = createDB(TEST_DATABASE_URL);
    const testSchema = uniqueSchema("agent_name_lock_order");
    await createMigrationFixture(db, testSchema);
    const blockerReady = Promise.withResolvers<void>();
    const releaseBlocker = Promise.withResolvers<void>();
    const blocker = blockerDb.transaction(async (tx) => {
      await tx.execute(sql.raw(`
        LOCK TABLE "${testSchema}"."agent_profiles" IN ROW EXCLUSIVE MODE
      `));
      blockerReady.resolve();
      await releaseBlocker.promise;
    });
    let migration: Promise<void> | undefined;

    try {
      await blockerReady.promise;
      migration = applyRepairMigration(migrationDb, testSchema);
      const lockState = await waitForProfileNamespaceLock(db, testSchema);
      expect(lockState.roster_locks_acquired).toBe(false);
    } finally {
      releaseBlocker.resolve();
      await blocker;
      await migration;
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});

function uniqueSchema(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function createMigrationFixture(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE SCHEMA "${testSchema}";
    CREATE TABLE "${testSchema}"."agent_profiles" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL,
      "name" text NOT NULL,
      "current_revision_id" text,
      "games_played" integer NOT NULL DEFAULT 0,
      "games_won" integer NOT NULL DEFAULT 0,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL
    );
    CREATE TABLE "${testSchema}"."games" (
      "id" text PRIMARY KEY,
      "status" text NOT NULL,
      "started_at" text
    );
    CREATE TABLE "${testSchema}"."game_players" (
      "id" text PRIMARY KEY,
      "game_id" text NOT NULL,
      "agent_profile_id" text,
      "agent_revision_id" text,
      "persona" text NOT NULL,
      "joined_at" text NOT NULL
    );
    CREATE TABLE "${testSchema}"."agent_revisions" (
      "id" text PRIMARY KEY,
      "agent_profile_id" text NOT NULL,
      "fingerprint" text NOT NULL
    );
    CREATE TABLE "${testSchema}"."agent_competition_ratings" (
      "agent_profile_id" text PRIMARY KEY,
      "mu" double precision NOT NULL,
      "sigma" double precision NOT NULL
    );
    CREATE TABLE "${testSchema}"."free_game_queue" (
      "agent_profile_id" text PRIMARY KEY,
      "entered_at" text NOT NULL
    );
  `));
}

async function applyDeferredMigrations(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(await Bun.file(DEFERRED_PREFLIGHT_PATH).text()));
  const dropIndex = (await Bun.file(DROP_INDEX_PATH).text()).replace(
    '"agent_profiles_normalized_name_unique"',
    `"${testSchema}"."agent_profiles_normalized_name_unique"`,
  );
  await db.execute(sql.raw(dropIndex));
}

async function applyRepairMigration(db: DrizzleDB, testSchema: string): Promise<void> {
  const scopedMigration = (await Bun.file(REPAIR_PATH).text())
    .replaceAll('"agent_profiles"', `"${testSchema}"."agent_profiles"`)
    .replaceAll('"game_players"', `"${testSchema}"."game_players"`)
    .replaceAll('"games"', `"${testSchema}"."games"`);
  const statements = scopedMigration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await db.transaction(async (tx) => {
    for (const statement of statements) {
      await tx.execute(sql.raw(statement));
    }
  });
}

async function expectRejected(db: DrizzleDB, statement: string): Promise<void> {
  let rejected = false;
  try {
    await db.execute(sql.raw(statement));
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

async function waitForProfileNamespaceLock(
  db: DrizzleDB,
  testSchema: string,
): Promise<{ roster_locks_acquired: boolean }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await db.execute<{ roster_locks_acquired: boolean }>(sql.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks roster_lock
        JOIN pg_class roster_relation ON roster_relation.oid = roster_lock.relation
        JOIN pg_namespace roster_namespace ON roster_namespace.oid = roster_relation.relnamespace
        WHERE roster_lock.pid = waiting_lock.pid
          AND roster_lock.granted
          AND roster_lock.mode = 'ShareRowExclusiveLock'
          AND roster_namespace.nspname = '${testSchema}'
          AND roster_relation.relname IN ('games', 'game_players')
      ) AS roster_locks_acquired
      FROM pg_locks waiting_lock
      JOIN pg_class profile_relation ON profile_relation.oid = waiting_lock.relation
      JOIN pg_namespace profile_namespace ON profile_namespace.oid = profile_relation.relnamespace
      WHERE NOT waiting_lock.granted
        AND waiting_lock.mode = 'ExclusiveLock'
        AND profile_namespace.nspname = '${testSchema}'
        AND profile_relation.relname = 'agent_profiles'
      LIMIT 1
    `));
    if (rows[0]) return rows[0];
    await Bun.sleep(20);
  }
  throw new Error("Migration did not wait on the profile namespace lock");
}
