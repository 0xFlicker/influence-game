import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL(
  "../../drizzle/0059_sealed_provider_manifest.sql",
  import.meta.url,
);

describe("sealed provider manifest migration", () => {
  test("does not take an explicit table-wide games lock", async () => {
    const migration = await Bun.file(MIGRATION_PATH).text();
    expect(migration).not.toMatch(/\bLOCK\s+TABLE\s+"games"\b/i);
  });

  test("backfills the exact legacy selection and preserves an existing ordered manifest", async () => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("provider_manifest");
    await createFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."games" ("id", "config") VALUES
        ('legacy', '{"modelSelection":{"catalogId":"openai:gpt-5.6-luna","reasoningPolicy":"medium"},"maxRounds":10}'),
        ('sealed', '{"modelSelection":{"catalogId":"openai:gpt-5.6-luna","reasoningPolicy":"medium"},"providerManifest":[{"catalogId":"openai:gpt-5.6-luna","reasoningPolicy":"medium"},{"catalogId":"katana:grok-4-5","reasoningPolicy":"action-policy","maxCallsPerGame":12}]}');
    `));

    try {
      await applyMigration(db, testSchema);
      const once = await readConfigs(db, testSchema);
      expect(once.legacy).toEqual({
        maxRounds: 10,
        modelSelection: {
          catalogId: "openai:gpt-5.6-luna",
          reasoningPolicy: "medium",
        },
        providerManifest: [{
          catalogId: "openai:gpt-5.6-luna",
          reasoningPolicy: "medium",
        }],
      });
      expect(once.sealed).toEqual({
        modelSelection: {
          catalogId: "openai:gpt-5.6-luna",
          reasoningPolicy: "medium",
        },
        providerManifest: [
          { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "medium" },
          {
            catalogId: "katana:grok-4-5",
            reasoningPolicy: "action-policy",
            maxCallsPerGame: 12,
          },
        ],
      });

      await applyMigration(db, testSchema);
      expect(await readConfigs(db, testSchema)).toEqual(once);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test.each([
    ["malformed JSON", "not-json"],
    ["missing legacy selection", '{"maxRounds":10}'],
    ["empty manifest", '{"modelSelection":{"catalogId":"openai:gpt-5-nano"},"providerManifest":[]}'],
    [
      "mismatched primary projection",
      '{"modelSelection":{"catalogId":"openai:gpt-5-nano"},"providerManifest":[{"catalogId":"katana:grok-4-5"}]}',
    ],
  ])("rejects %s without partially backfilling other games", async (_label, invalidConfig) => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("provider_manifest_rejection");
    await createFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."games" ("id", "config") VALUES
        ('valid', '{"modelSelection":{"catalogId":"openai:gpt-5-nano","reasoningPolicy":"low"}}'),
        ('invalid', '${invalidConfig.replaceAll("'", "''")}');
    `));

    try {
      await expect(applyMigration(db, testSchema)).rejects.toThrow();
      expect(await readConfigText(db, testSchema)).toEqual({
        invalid: invalidConfig,
        valid: '{"modelSelection":{"catalogId":"openai:gpt-5-nano","reasoningPolicy":"low"}}',
      });
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});

function uniqueSchema(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function createFixture(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE SCHEMA "${testSchema}";
    CREATE TABLE "${testSchema}"."games" (
      "id" text PRIMARY KEY,
      "config" text NOT NULL
    );
  `));
}

async function applyMigration(db: DrizzleDB, testSchema: string): Promise<void> {
  const scopedMigration = (await Bun.file(MIGRATION_PATH).text()).replaceAll(
    '"games"',
    `"${testSchema}"."games"`,
  );
  const statements = scopedMigration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
}

async function readConfigs(
  db: DrizzleDB,
  testSchema: string,
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.execute<{ id: string; config: string }>(sql.raw(`
    SELECT "id", "config" FROM "${testSchema}"."games" ORDER BY "id"
  `));
  return Object.fromEntries([...rows].map((row) => [row.id, JSON.parse(row.config)]));
}

async function readConfigText(
  db: DrizzleDB,
  testSchema: string,
): Promise<Record<string, string>> {
  const rows = await db.execute<{ id: string; config: string }>(sql.raw(`
    SELECT "id", "config" FROM "${testSchema}"."games" ORDER BY "id"
  `));
  return Object.fromEntries([...rows].map((row) => [row.id, row.config]));
}
