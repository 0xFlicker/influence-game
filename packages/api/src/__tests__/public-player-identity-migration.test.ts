import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  PUBLIC_PLAYER_HANDLE_RESERVED_NAMES,
  isPublicPlayerHandleConflict,
  normalizePublicPlayerHandle,
  suggestPublicPlayerHandle,
} from "../lib/public-player-identity.js";
import { isPostgresCheckViolation } from "../lib/postgres-errors.js";

const MIGRATION_PATH = new URL("../../drizzle/0041_public_player_identity.sql", import.meta.url);
const PREVIOUS_SNAPSHOT_PATH = new URL("../../drizzle/meta/0040_snapshot.json", import.meta.url);
const CURRENT_SNAPSHOT_PATH = new URL("../../drizzle/meta/0041_snapshot.json", import.meta.url);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test";
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("public player identity migration", () => {
  test("backfills immutable public UUIDs and preserves every internal ownership reference", async () => {
    await withMigrationFixture(async ({ admin, db, migrateIdentity, schema }) => {
      const before = await ownershipSnapshot(admin, schema);
      await migrateIdentity();

      const users = await db<{
        id: string;
        public_id: string;
        handle: string | null;
      }[]>`
        SELECT "id", "public_id"::text, "handle"
        FROM "users"
        ORDER BY "id"
      `;
      expect(users).toHaveLength(4);
      expect(new Set(users.map((user) => user.public_id)).size).toBe(4);
      expect(users.every((user) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(user.public_id)))
        .toBe(true);
      expect(users.every((user) => user.public_id !== user.id)).toBe(true);
      expect(users.every((user) => user.handle === null)).toBe(true);
      expect(await ownershipSnapshot(admin, schema)).toEqual(before);

      const inserted = await db<{ id: string; public_id: string }[]>`
        INSERT INTO "users" ("id", "wallet_address", "display_name", "created_at")
        VALUES ('future-user', '0xfuture', 'Future', '2026-07-16T18:30:00Z')
        RETURNING "id", "public_id"::text
      `;
      expect(inserted[0]?.public_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inserted[0]?.public_id).not.toBe(inserted[0]?.id);

      await db`
        INSERT INTO "users" ("id", "display_name", "created_at")
        VALUES
          ('null-handle-a', 'Null A', '2026-07-16T18:30:00Z'),
          ('null-handle-b', 'Null B', '2026-07-16T18:30:00Z')
      `;
      const nullHandles = await db<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "users" WHERE "handle" IS NULL
      `;
      expect(nullHandles[0]?.count).toBe(7);

      const authority = await db<{
        public_id_not_null: boolean;
        public_id_default: boolean;
        public_id_unique: boolean;
        handle_unique: boolean;
        public_id_guard: boolean;
        handle_guard: boolean;
      }[]>`
        SELECT
          (
            SELECT "is_nullable" = 'NO'
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = 'users'
              AND column_name = 'public_id'
          ) AS public_id_not_null,
          (
            SELECT "column_default" LIKE '%gen_random_uuid%'
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = 'users'
              AND column_name = 'public_id'
          ) AS public_id_default,
          to_regclass(${`${schema}.users_public_id_unique`}) IS NOT NULL AS public_id_unique,
          to_regclass(${`${schema}.users_handle_lower_unique`}) IS NOT NULL AS handle_unique,
          EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = ${`${schema}.users`}::regclass
              AND tgname = 'users_public_id_immutable'
              AND NOT tgisinternal
          ) AS public_id_guard,
          EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = ${`${schema}.users`}::regclass
              AND tgname = 'users_handle_claimed_not_null'
              AND NOT tgisinternal
          ) AS handle_guard
      `;
      expect(authority[0]).toEqual({
        public_id_not_null: true,
        public_id_default: true,
        public_id_unique: true,
        handle_unique: true,
        public_id_guard: true,
        handle_guard: true,
      });
    });
  });

  test("enforces canonical handles, atomic replacement, and immutable identity at the database", async () => {
    await withMigrationFixture(async ({ db, migrateIdentity }) => {
      await migrateIdentity();

      await db`UPDATE "users" SET "handle" = 'flick' WHERE "id" = 'user-a'`;
      const before = await db<{ id: string; public_id: string; wallet_address: string }[]>`
        SELECT "id", "public_id"::text, "wallet_address"
        FROM "users"
        WHERE "id" = 'user-a'
      `;

      await expectRejected(() => db`UPDATE "users" SET "handle" = ${null} WHERE "id" = 'user-a'`);
      await expectRejected(() => db`UPDATE "users" SET "public_id" = gen_random_uuid() WHERE "id" = 'user-a'`);
      await expectRejected(() => db`
        UPDATE "users"
        SET "public_id" = "id"::uuid
        WHERE "id" = '00000000-0000-4000-8000-000000000001'
      `);

      for (const invalidHandle of [
        "ab",
        "a".repeat(31),
        "Flick",
        "flick-",
        "flick_name",
        "house",
        "6f1c40ae-1f13-4ae8-9b9e-00f62517c1d0",
      ]) {
        await expectRejected(() => db`
          UPDATE "users" SET "handle" = ${invalidHandle} WHERE "id" = 'user-b'
        `);
      }

      await db`UPDATE "users" SET "handle" = 'other' WHERE "id" = 'user-b'`;
      await expectRejected(() => db`UPDATE "users" SET "handle" = 'other' WHERE "id" = 'user-a'`);
      expect((await db<{ handle: string }[]>`
        SELECT "handle" FROM "users" WHERE "id" = 'user-a'
      `)[0]?.handle).toBe("flick");

      await db`UPDATE "users" SET "handle" = 'oxflick' WHERE "id" = 'user-a'`;
      await db`UPDATE "users" SET "handle" = 'flick' WHERE "id" = 'user-c'`;
      expect([...(await db<{ id: string; handle: string }[]>`
        SELECT "id", "handle" FROM "users" WHERE "handle" IN ('flick', 'oxflick') ORDER BY "id"
      `)]).toEqual([
        { id: "user-a", handle: "oxflick" },
        { id: "user-c", handle: "flick" },
      ]);

      expect((await db<{ id: string; public_id: string; wallet_address: string }[]>`
        SELECT "id", "public_id"::text, "wallet_address"
        FROM "users"
        WHERE "id" = 'user-a'
      `)[0]).toEqual(before[0]);
    });
  });

  test("makes one concurrent claimant authoritative and identifies only the named conflict", async () => {
    await withMigrationFixture(async ({ db, migrateIdentity, openClient }) => {
      await migrateIdentity();
      const left = openClient();
      const right = openClient();
      const canonicalLeft = normalizePublicPlayerHandle("Flick");
      const canonicalRight = normalizePublicPlayerHandle("FLICK");

      try {
        const results = await Promise.allSettled([
          left`UPDATE "users" SET "handle" = ${canonicalLeft} WHERE "id" = 'user-a'`,
          right`UPDATE "users" SET "handle" = ${canonicalRight} WHERE "id" = 'user-b'`,
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected?.status).toBe("rejected");
        expect(isPublicPlayerHandleConflict(
          rejected?.status === "rejected" ? rejected.reason : null,
        )).toBe(true);

        const suggestion = await suggestPublicPlayerHandle("Flick", async (candidate) => {
          const rows = await db<{ available: boolean }[]>`
            SELECT NOT EXISTS (
              SELECT 1 FROM "users" WHERE lower("handle") = lower(${candidate})
            ) AS available
          `;
          return rows[0]?.available ?? false;
        });
        expect(suggestion).toBe("flick-2");
      } finally {
        await Promise.all([left.end(), right.end()]);
      }
    });
  });

  test("rolls back an injected migrator failure and reruns without regenerating identity", async () => {
    await withMigrationFixture(async ({
      admin,
      db,
      migrateIdentity,
      schema,
    }) => {
      const before = await ownershipSnapshot(admin, schema);
      await expect(migrateIdentity({
        injectFailure: true,
        migrationsSchema: `drizzle_failed_${schema}`,
      })).rejects.toThrow();

      expect(await ownershipSnapshot(admin, schema)).toEqual(before);
      const rolledBackColumns = await admin<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = 'users'
          AND column_name IN ('public_id', 'handle')
      `;
      expect(rolledBackColumns[0]?.count).toBe(0);

      await migrateIdentity({ migrationsSchema: `drizzle_retry_${schema}` });
      const first = await db<{ id: string; public_id: string }[]>`
        SELECT "id", "public_id"::text FROM "users" ORDER BY "id"
      `;
      await migrateIdentity({ migrationsSchema: `drizzle_retry_${schema}` });
      const second = await db<{ id: string; public_id: string }[]>`
        SELECT "id", "public_id"::text FROM "users" ORDER BY "id"
      `;
      expect(second).toEqual(first);
      expect(await ownershipSnapshot(admin, schema)).toEqual(before);

      const migrationSql = await Bun.file(MIGRATION_PATH).text();
      expect(migrationSql).toContain('WHERE "public_id" IS NULL');
      expect(migrationSql).not.toContain("CONCURRENTLY");
    });
  });

  test("fails the rollout preflight for timezone-free or invalid legacy createdAt rows", async () => {
    await withMigrationFixture(async ({
      admin,
      db,
      migrateIdentity,
      schema,
    }) => {
      for (const [index, createdAt] of [
        "2026-07-16 18:29:59",
        "not-a-timestamp",
      ].entries()) {
        await db`UPDATE "users" SET "created_at" = ${createdAt} WHERE "id" = 'user-a'`;
        let error: unknown;
        try {
          await migrateIdentity({
            migrationsSchema: `drizzle_preflight_${index}_${schema}`,
          });
        } catch (caught) {
          error = caught;
        }
        expect(isPostgresCheckViolation(error, "users_created_at_offset_preflight")).toBe(true);

        const columns = await admin<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM information_schema.columns
          WHERE table_schema = ${schema}
            AND table_name = 'users'
            AND column_name IN ('public_id', 'handle')
        `;
        expect(columns[0]?.count).toBe(0);
      }
    });
  });

  test("keeps generated metadata aligned with exactly two persisted user fields", async () => {
    const previous = JSON.parse(await Bun.file(PREVIOUS_SNAPSHOT_PATH).text()) as DrizzleSnapshot;
    const current = JSON.parse(await Bun.file(CURRENT_SNAPSHOT_PATH).text()) as DrizzleSnapshot;
    const previousUsers = previous.tables["public.users"]!;
    const currentUsers = current.tables["public.users"]!;
    const addedColumns = Object.keys(currentUsers.columns)
      .filter((column) => !(column in previousUsers.columns))
      .sort();

    expect(addedColumns).toEqual(["handle", "public_id"]);
    expect(currentUsers.columns.public_id).toMatchObject({
      type: "uuid",
      notNull: true,
      default: "gen_random_uuid()",
    });
    expect(currentUsers.columns.handle).toMatchObject({
      type: "text",
      notNull: false,
    });

    const migrationSql = await Bun.file(MIGRATION_PATH).text();
    for (const authorityName of [
      "users_public_id_unique",
      "users_handle_lower_unique",
      ...Object.keys(currentUsers.checkConstraints),
    ]) {
      expect(migrationSql).toContain(`"${authorityName}"`);
    }
    const reservedCheck = currentUsers.checkConstraints.users_handle_not_reserved_check?.value ?? "";
    for (const reservedName of PUBLIC_PLAYER_HANDLE_RESERVED_NAMES) {
      expect(reservedCheck).toContain(`'${reservedName}'`);
      expect(migrationSql).toContain(`'${reservedName}'`);
    }
  });
});

async function withMigrationFixture(
  run: (fixture: MigrationFixture) => Promise<void>,
): Promise<void> {
  const schema = `public_identity_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);

  const openClient = () => postgres(TEST_DATABASE_URL, {
    connection: { search_path: schema },
    max: 1,
    onnotice: () => {},
  });
  const db = openClient();

  try {
    const fixtureDirectory = await createMigrationsDirectory();
    await migrate(drizzle(db), {
      migrationsFolder: fixtureDirectory,
      migrationsSchema: `drizzle_fixture_${schema}`,
    });
    await run({
      admin,
      db,
      migrateIdentity: async (options = {}) => {
        const directory = await createMigrationsDirectory({
          includeFixture: false,
          injectFailure: options.injectFailure,
        });
        await migrate(drizzle(db), {
          migrationsFolder: directory,
          migrationsSchema: options.migrationsSchema ?? `drizzle_identity_${schema}`,
        });
      },
      openClient,
      schema,
    });
  } finally {
    await db.end();
    await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

interface MigrationFixture {
  admin: ReturnType<typeof postgres>;
  db: ReturnType<typeof postgres>;
  migrateIdentity: (options?: {
    injectFailure?: boolean;
    migrationsSchema?: string;
  }) => Promise<void>;
  openClient: () => ReturnType<typeof postgres>;
  schema: string;
}

interface DrizzleSnapshot {
  tables: Record<string, {
    columns: Record<string, {
      type: string;
      notNull: boolean;
      default?: string;
    }>;
    checkConstraints: Record<string, {
      value: string;
    }>;
  }>;
}

async function createMigrationsDirectory(options: {
  includeFixture?: boolean;
  injectFailure?: boolean;
} = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "influence-public-identity-migrations-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "meta"));

  const includeFixture = options.includeFixture ?? true;
  const entries = includeFixture
    ? [{
        idx: 0,
        version: "7",
        when: 1,
        tag: "0000_public_identity_fixture",
        breakpoints: true,
      }]
    : [{
        idx: 0,
        version: "7",
        when: 2,
        tag: "0041_public_player_identity",
        breakpoints: true,
      }];

  if (includeFixture) {
    await writeFile(join(directory, "0000_public_identity_fixture.sql"), FIXTURE_MIGRATION);
  } else {
    const migration = await Bun.file(MIGRATION_PATH).text();
    await writeFile(
      join(directory, "0041_public_player_identity.sql"),
      options.injectFailure
        ? `${migration}\n--> statement-breakpoint\nSELECT * FROM "injected_migration_failure";\n`
        : migration,
    );
  }
  await writeFile(join(directory, "meta", "_journal.json"), JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries,
  }));
  return directory;
}

const FIXTURE_MIGRATION = `
CREATE TABLE "users" (
  "id" text PRIMARY KEY,
  "wallet_address" text UNIQUE,
  "display_name" text,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE TABLE "games" (
  "id" text PRIMARY KEY,
  "created_by_id" text REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE TABLE "competition_receipts" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "game_id" text NOT NULL REFERENCES "games"("id")
);
--> statement-breakpoint
INSERT INTO "users" ("id", "wallet_address", "display_name", "created_at") VALUES
  ('user-a', '0xa', 'Flick', '2025-01-01 00:00:00+00'),
  ('user-b', '0xb', 'Other', '2025-01-02T00:00:00Z'),
  ('user-c', '0xc', 'Third', '2025-01-03T00:00:00+00:00'),
  ('00000000-0000-4000-8000-000000000001', '0xuuid', 'UUID ID', '2025-01-04T00:00:00Z');
--> statement-breakpoint
INSERT INTO "agent_profiles" ("id", "user_id") VALUES
  ('agent-a', 'user-a'),
  ('agent-b', 'user-b');
--> statement-breakpoint
INSERT INTO "games" ("id", "created_by_id") VALUES
  ('game-a', 'user-a');
--> statement-breakpoint
INSERT INTO "competition_receipts" ("id", "user_id", "game_id") VALUES
  ('receipt-a', 'user-a', 'game-a');
`;

async function ownershipSnapshot(
  admin: ReturnType<typeof postgres>,
  schema: string,
): Promise<Record<string, number | string | null>> {
  const rows = await admin<Record<string, number | string | null>[]>`
    SELECT
      (SELECT count(*)::int FROM ${admin(schema)}."users") AS users,
      (SELECT count(*)::int FROM ${admin(schema)}."agent_profiles") AS agents,
      (SELECT count(*)::int FROM ${admin(schema)}."games") AS games,
      (SELECT count(*)::int FROM ${admin(schema)}."competition_receipts") AS receipts,
      (SELECT "user_id" FROM ${admin(schema)}."agent_profiles" WHERE "id" = 'agent-a') AS agent_owner,
      (SELECT "created_by_id" FROM ${admin(schema)}."games" WHERE "id" = 'game-a') AS game_owner,
      (SELECT "user_id" FROM ${admin(schema)}."competition_receipts" WHERE "id" = 'receipt-a') AS receipt_owner
  `;
  return rows[0] ?? {};
}

async function expectRejected(run: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}
