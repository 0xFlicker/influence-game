import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL(
  "../../drizzle/0049_explicit_game_model_selection.sql",
  import.meta.url,
);

describe("explicit game model selection migration", () => {
  test("maps every legacy tier, preserves explicit selections, removes tiers, and is idempotent", async () => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("game_model_selection");
    await createFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."games" ("id", "status", "config") VALUES
        ('budget', 'waiting', '{"modelTier":"budget","maxRounds":5}'),
        ('standard', 'in_progress', '{"modelTier":"standard"}'),
        ('premium', 'completed', '{"modelTier":"premium"}'),
        ('explicit', 'suspended', '{"modelTier":"budget","modelSelection":{"catalogId":"anthropic:claude-haiku-4.5","reasoningPolicy":{"type":"fixed","effort":"low"}}}');
    `));

    try {
      await applyMigration(db, testSchema);
      const once = await readConfigs(db, testSchema);

      expect(once).toEqual({
        budget: {
          maxRounds: 5,
          modelSelection: {
            catalogId: "openai:gpt-5-nano",
            reasoningPolicy: { type: "action-policy" },
          },
        },
        explicit: {
          modelSelection: {
            catalogId: "anthropic:claude-haiku-4.5",
            reasoningPolicy: { type: "fixed", effort: "low" },
          },
        },
        premium: {
          modelSelection: {
            catalogId: "openai:gpt-5.4-mini",
            reasoningPolicy: { type: "action-policy" },
          },
        },
        standard: {
          modelSelection: {
            catalogId: "openai:gpt-5-mini",
            reasoningPolicy: { type: "action-policy" },
          },
        },
      });

      await applyMigration(db, testSchema);
      expect(await readConfigs(db, testSchema)).toEqual(once);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test.each([
    ["malformed JSON", "not-json"],
    ["unknown legacy tier", '{"modelTier":"economy"}'],
    ["missing selection and tier", '{"maxRounds":5}'],
  ])("rejects %s without partially updating games", async (_label, invalidConfig) => {
    const db = await setupTestDB();
    const testSchema = uniqueSchema("game_model_selection_rejection");
    await createFixture(db, testSchema);
    await db.execute(sql.raw(`
      INSERT INTO "${testSchema}"."games" ("id", "status", "config") VALUES
        ('valid', 'waiting', '{"modelTier":"budget"}'),
        ('invalid', 'cancelled', '${invalidConfig.replaceAll("'", "''")}');
    `));

    try {
      await expect(applyMigration(db, testSchema)).rejects.toThrow();
      const configs = await readConfigsAsText(db, testSchema);
      expect(configs).toEqual({ invalid: invalidConfig, valid: '{"modelTier":"budget"}' });
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
      "status" text NOT NULL,
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
    for (const statement of statements) {
      await tx.execute(sql.raw(statement));
    }
  });
}

async function readConfigs(db: DrizzleDB, testSchema: string): Promise<Record<string, unknown>> {
  const rows = await db.execute<{ id: string; config: string }>(sql.raw(`
    SELECT "id", "config" FROM "${testSchema}"."games" ORDER BY "id"
  `));
  return Object.fromEntries([...rows].map((row) => [row.id, JSON.parse(row.config)]));
}

async function readConfigsAsText(
  db: DrizzleDB,
  testSchema: string,
): Promise<Record<string, string>> {
  const rows = await db.execute<{ id: string; config: string }>(sql.raw(`
    SELECT "id", "config" FROM "${testSchema}"."games" ORDER BY "id"
  `));
  return Object.fromEntries([...rows].map((row) => [row.id, row.config]));
}
