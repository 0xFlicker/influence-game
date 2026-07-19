import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const DRIZZLE_DIRECTORY = new URL("../../drizzle/", import.meta.url);
const PREVIOUS_SNAPSHOT_PATH = new URL("../../drizzle/meta/0042_snapshot.json", import.meta.url);
const CURRENT_SNAPSHOT_PATH = new URL("../../drizzle/meta/0043_snapshot.json", import.meta.url);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test";
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("layered authentication migration", () => {
  test("keeps generated schema metadata aligned with the credential and claim authority", async () => {
    const migrationNames = (await readdir(DRIZZLE_DIRECTORY))
      .filter((name) => /^0043_.*\.sql$/.test(name));
    expect(migrationNames).toHaveLength(1);

    const previous = await readSnapshot(PREVIOUS_SNAPSHOT_PATH);
    const current = await readSnapshot(CURRENT_SNAPSHOT_PATH);
    expect(current.tables["public.users"]).toEqual(previous.tables["public.users"]);

    for (const [name, table] of Object.entries(previous.tables)) {
      expect(current.tables[name]?.foreignKeys).toEqual(table.foreignKeys);
    }

    const credentials = current.tables["public.authentication_credentials"];
    expect(credentials?.columns).toMatchObject({
      id: { type: "uuid", primaryKey: true, notNull: true, default: "gen_random_uuid()" },
      user_id: { type: "text", notNull: true },
      provider: { type: "text", notNull: true },
      provider_subject: { type: "text", notNull: true },
      created_at: { type: "text", notNull: true, default: "now()::text" },
      retired_at: { type: "text", notNull: false },
    });
    expect(credentials?.indexes.authentication_credentials_provider_subject_unique)
      .toMatchObject({ isUnique: true });
    expect(credentials?.indexes.authentication_credentials_active_user_id_idx)
      .toMatchObject({ isUnique: false, where: "\"authentication_credentials\".\"retired_at\" IS NULL" });
    expect(credentials?.checkConstraints.authentication_credentials_provider_check?.value)
      .toContain("IN ('privy', 'clerk')");

    const claims = current.tables["public.verified_email_claims"];
    expect(claims?.columns).toMatchObject({
      normalized_email: { type: "text", primaryKey: true, notNull: true },
      user_id: { type: "text", notNull: false },
      state: { type: "text", notNull: true },
      created_at: { type: "text", notNull: true, default: "now()::text" },
      updated_at: { type: "text", notNull: true, default: "now()::text" },
    });
    expect(claims?.indexes.verified_email_claims_active_user_id_unique)
      .toMatchObject({ isUnique: true, where: "\"verified_email_claims\".\"state\" = 'active'" });
    expect(claims?.checkConstraints.verified_email_claims_state_check?.value)
      .toContain("IN ('active', 'conflict')");
    expect(claims?.checkConstraints.verified_email_claims_state_user_check?.value)
      .toContain("state");
    expect(claims?.checkConstraints.verified_email_claims_normalized_email_canonical_check?.value)
      .toContain("lower(btrim");

    const migrationSql = await Bun.file(new URL(migrationNames[0]!, DRIZZLE_DIRECTORY)).text();
    for (const authorityName of [
      "authentication_credentials_provider_subject_unique",
      "authentication_credentials_active_user_id_idx",
      "authentication_credentials_provider_check",
      "verified_email_claims_active_user_id_unique",
      "verified_email_claims_state_check",
      "verified_email_claims_state_user_check",
      "verified_email_claims_normalized_email_canonical_check",
    ]) {
      expect(migrationSql).toContain(`"${authorityName}"`);
    }
  });

  test("enforces provider subjects and canonical email claims without rewriting identifiers", async () => {
    await withMigrationFixture(async ({ db, migrateAuthentication }) => {
      await migrateAuthentication();

      const privySubject = "did:privy:cm123.subject.with.punctuation";
      const credential = await db<{
        user_id: string;
        provider_subject: string;
      }[]>`
        INSERT INTO "authentication_credentials" ("user_id", "provider", "provider_subject")
        VALUES ('did:privy:legacy-user', 'privy', ${privySubject})
        RETURNING "user_id", "provider_subject"
      `;
      expect(credential[0]).toEqual({
        user_id: "did:privy:legacy-user",
        provider_subject: privySubject,
      });

      await db`
        UPDATE "authentication_credentials"
        SET "retired_at" = '2026-07-19T00:00:00Z'
        WHERE "provider_subject" = ${privySubject}
      `;
      await expectRejected(() => db`
        INSERT INTO "authentication_credentials" ("user_id", "provider", "provider_subject")
        VALUES ('legacy-text-user', 'privy', ${privySubject})
      `);
      await expectRejected(() => db`
        INSERT INTO "authentication_credentials" ("user_id", "provider", "provider_subject")
        VALUES ('legacy-text-user', 'other', 'subject')
      `);

      for (const normalizedEmail of [
        "first.last@example.com",
        "first.last+house@example.com",
      ]) {
        await db`
          INSERT INTO "verified_email_claims" ("normalized_email", "user_id", "state")
          VALUES (${normalizedEmail}, 'did:privy:legacy-user', 'active')
        `;
        if (normalizedEmail === "first.last@example.com") {
          await db`
            UPDATE "verified_email_claims"
            SET "state" = 'conflict', "user_id" = NULL
            WHERE "normalized_email" = ${normalizedEmail}
          `;
        }
      }
      expect((await db<{ normalized_email: string }[]>`
        SELECT "normalized_email" FROM "verified_email_claims" ORDER BY "normalized_email"
      `).map((row) => row.normalized_email).sort()).toEqual([
        "first.last+house@example.com",
        "first.last@example.com",
      ]);

      for (const [email, userId, state] of [
        [" Upper@example.com", null, "conflict"],
        ["upper@EXAMPLE.com", null, "conflict"],
        ["active-without-user@example.com", null, "active"],
        ["conflict-with-user@example.com", "legacy-text-user", "conflict"],
      ] as const) {
        await expectRejected(() => db`
          INSERT INTO "verified_email_claims" ("normalized_email", "user_id", "state")
          VALUES (${email}, ${userId}, ${state})
        `);
      }
      await expectRejected(() => db`
        INSERT INTO "verified_email_claims" ("normalized_email", "user_id", "state")
        VALUES ('second-active@example.com', 'did:privy:legacy-user', 'active')
      `);
      await expectRejected(() => db`DELETE FROM "users" WHERE "id" = 'did:privy:legacy-user'`);
    });
  });

  test("preserves every existing users foreign key and rolls back a failed migration before rerun", async () => {
    await withMigrationFixture(async ({
      admin,
      db,
      migrateAuthentication,
      schema,
    }) => {
      const foreignKeysBefore = await usersForeignKeys(admin, schema, false);
      const ownershipBefore = await ownershipValues(admin, schema);
      const userIdsBefore = await db<{ id: string }[]>`SELECT "id" FROM "users" ORDER BY "id"`;

      await expect(migrateAuthentication({
        injectFailure: true,
        migrationsSchema: `drizzle_failed_${schema}`,
      })).rejects.toThrow();
      expect(await usersForeignKeys(admin, schema, false)).toEqual(foreignKeysBefore);
      expect(await ownershipValues(admin, schema)).toEqual(ownershipBefore);
      expect(await db<{ id: string }[]>`SELECT "id" FROM "users" ORDER BY "id"`)
        .toEqual(userIdsBefore);
      expect(await relationCount(admin, schema, [
        "authentication_credentials",
        "verified_email_claims",
      ])).toBe(0);

      const migrationsSchema = `drizzle_retry_${schema}`;
      await migrateAuthentication({ migrationsSchema });
      await migrateAuthentication({ migrationsSchema });
      expect(await usersForeignKeys(admin, schema, false)).toEqual(foreignKeysBefore);
      expect(await ownershipValues(admin, schema)).toEqual(ownershipBefore);
      expect(await db<{ id: string }[]>`SELECT "id" FROM "users" ORDER BY "id"`)
        .toEqual(userIdsBefore);
      expect(await relationCount(admin, schema, [
        "authentication_credentials",
        "verified_email_claims",
      ])).toBe(2);
    });
  });
});

async function withMigrationFixture(
  run: (fixture: MigrationFixture) => Promise<void>,
): Promise<void> {
  const schema = `layered_auth_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  const db = postgres(TEST_DATABASE_URL, {
    connection: { search_path: schema },
    max: 1,
    onnotice: () => {},
  });

  try {
    const previous = await readSnapshot(PREVIOUS_SNAPSHOT_PATH);
    const fixtureDirectory = await createMigrationsDirectory(previous);
    await migrate(drizzle(db), {
      migrationsFolder: fixtureDirectory,
      migrationsSchema: `drizzle_fixture_${schema}`,
    });
    await run({
      admin,
      db,
      schema,
      migrateAuthentication: async (options = {}) => {
        const directory = await createMigrationsDirectory(previous, {
          includeFixture: false,
          injectFailure: options.injectFailure,
        });
        await migrate(drizzle(db), {
          migrationsFolder: directory,
          migrationsSchema: options.migrationsSchema ?? `drizzle_auth_${schema}`,
        });
      },
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
  migrateAuthentication: (options?: {
    injectFailure?: boolean;
    migrationsSchema?: string;
  }) => Promise<void>;
  schema: string;
}

interface DrizzleSnapshot {
  tables: Record<string, {
    columns: Record<string, {
      type: string;
      primaryKey: boolean;
      notNull: boolean;
      default?: string;
    }>;
    indexes: Record<string, {
      isUnique: boolean;
      where?: string;
    }>;
    foreignKeys: Record<string, SnapshotForeignKey>;
    checkConstraints: Record<string, {
      value: string;
    }>;
  }>;
}

interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
}

async function readSnapshot(path: URL): Promise<DrizzleSnapshot> {
  return JSON.parse(await Bun.file(path).text()) as DrizzleSnapshot;
}

async function createMigrationsDirectory(
  previous: DrizzleSnapshot,
  options: {
    includeFixture?: boolean;
    injectFailure?: boolean;
  } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "influence-layered-auth-migrations-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "meta"));
  const includeFixture = options.includeFixture ?? true;
  const tag = includeFixture ? "0000_layered_auth_fixture" : "0043_layered_authentication";

  let migrationSql = includeFixture
    ? buildFixtureMigration(previous)
    : await readGeneratedMigration();
  if (!includeFixture) {
    migrationSql = migrationSql.replaceAll(
      'REFERENCES "public"."users"("id")',
      'REFERENCES "users"("id")',
    );
  }
  if (options.injectFailure) {
    migrationSql += '\n--> statement-breakpoint\nSELECT * FROM "injected_migration_failure";\n';
  }

  await writeFile(join(directory, `${tag}.sql`), migrationSql);
  await writeFile(join(directory, "meta", "_journal.json"), JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: [{
      idx: 0,
      version: "7",
      when: includeFixture ? 1 : 2,
      tag,
      breakpoints: true,
    }],
  }));
  return directory;
}

async function readGeneratedMigration(): Promise<string> {
  const migrationNames = (await readdir(DRIZZLE_DIRECTORY))
    .filter((name) => /^0043_.*\.sql$/.test(name));
  expect(migrationNames).toHaveLength(1);
  return Bun.file(new URL(migrationNames[0]!, DRIZZLE_DIRECTORY)).text();
}

function buildFixtureMigration(snapshot: DrizzleSnapshot): string {
  const foreignKeys = existingUsersForeignKeys(snapshot);
  const byTable = Map.groupBy(foreignKeys, (foreignKey) => foreignKey.tableFrom);
  const statements = ['CREATE TABLE "users" ("id" text PRIMARY KEY)'];

  for (const [tableName, tableForeignKeys] of byTable) {
    const columns = [...new Set(tableForeignKeys.flatMap((foreignKey) => foreignKey.columnsFrom))];
    statements.push(`CREATE TABLE ${quoteIdentifier(tableName)} (${
      columns.map((column) => `${quoteIdentifier(column)} text`).join(", ")
    })`);
    for (const foreignKey of tableForeignKeys) {
      statements.push(
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} `
        + `FOREIGN KEY (${foreignKey.columnsFrom.map(quoteIdentifier).join(", ")}) `
        + `REFERENCES "users" (${foreignKey.columnsTo.map(quoteIdentifier).join(", ")}) `
        + `ON DELETE ${foreignKey.onDelete.toUpperCase()} ON UPDATE ${foreignKey.onUpdate.toUpperCase()}`,
      );
    }
  }

  statements.push(
    "INSERT INTO \"users\" (\"id\") VALUES ('did:privy:legacy-user'), ('legacy-text-user')",
  );
  for (const [tableName, tableForeignKeys] of byTable) {
    const columns = [...new Set(tableForeignKeys.flatMap((foreignKey) => foreignKey.columnsFrom))];
    statements.push(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${
        columns.map((_, index) => index % 2 === 0
          ? "'did:privy:legacy-user'"
          : "'legacy-text-user'").join(", ")
      })`,
    );
  }
  return statements.join(";\n--> statement-breakpoint\n") + ";\n";
}

function existingUsersForeignKeys(snapshot: DrizzleSnapshot): SnapshotForeignKey[] {
  return Object.values(snapshot.tables)
    .flatMap((table) => Object.values(table.foreignKeys))
    .filter((foreignKey) => foreignKey.tableTo === "users"
      && foreignKey.columnsTo.length === 1
      && foreignKey.columnsTo[0] === "id")
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function usersForeignKeys(
  admin: ReturnType<typeof postgres>,
  schema: string,
  includeNewTables: boolean,
): Promise<unknown[]> {
  return admin.unsafe(`
    SELECT source.relname AS table_name, constraint_row.conname AS constraint_name,
           pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS source ON source.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace ON source_namespace.oid = source.relnamespace
    JOIN pg_class AS target ON target.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace ON target_namespace.oid = target.relnamespace
    WHERE constraint_row.contype = 'f'
      AND source_namespace.nspname = '${schema}'
      AND target_namespace.nspname = '${schema}'
      AND target.relname = 'users'
      ${includeNewTables ? "" : "AND source.relname NOT IN ('authentication_credentials', 'verified_email_claims')"}
    ORDER BY source.relname, constraint_row.conname
  `);
}

async function ownershipValues(
  admin: ReturnType<typeof postgres>,
  schema: string,
): Promise<Record<string, unknown[]>> {
  const snapshot = await readSnapshot(PREVIOUS_SNAPSHOT_PATH);
  const result: Record<string, unknown[]> = {};
  for (const tableName of new Set(existingUsersForeignKeys(snapshot).map((key) => key.tableFrom))) {
    result[tableName] = await admin.unsafe(
      `SELECT to_jsonb(source) AS row FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)} AS source`,
    );
  }
  return result;
}

async function relationCount(
  admin: ReturnType<typeof postgres>,
  schema: string,
  relationNames: string[],
): Promise<number> {
  const rows = await admin<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = ${schema}
      AND pg_class.relname IN ${admin(relationNames)}
      AND pg_class.relkind = 'r'
  `;
  return rows[0]?.count ?? 0;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
