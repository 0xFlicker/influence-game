import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL(
  "../../drizzle/0054_handy_luke_cage.sql",
  import.meta.url,
);

describe("legal acceptance deployment provenance migration", () => {
  test("marks historical rows unknown and requires provenance on new rows", async () => {
    const db = await setupTestDB();
    const testSchema = `legal_acceptance_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${testSchema}";
      CREATE TABLE "${testSchema}"."legal_acceptances" (
        "id" integer PRIMARY KEY,
        "source" text NOT NULL
      );
      INSERT INTO "${testSchema}"."legal_acceptances" ("id", "source")
      VALUES (1, 'existing_account');
    `));

    try {
      await applyMigration(db, testSchema);
      const historical = await db.execute<{ deploymentSha: string }>(sql.raw(`
        SELECT "deployment_sha" AS "deploymentSha"
        FROM "${testSchema}"."legal_acceptances"
        WHERE "id" = 1
      `));
      expect(historical[0]?.deploymentSha).toBe("unknown");

      const column = await db.execute<{
        columnDefault: string | null;
        isNullable: "YES" | "NO";
      }>(sql.raw(`
        SELECT
          "column_default" AS "columnDefault",
          "is_nullable" AS "isNullable"
        FROM information_schema.columns
        WHERE "table_schema" = '${testSchema}'
          AND "table_name" = 'legal_acceptances'
          AND "column_name" = 'deployment_sha'
      `));
      expect(column[0]).toEqual({ columnDefault: null, isNullable: "NO" });

      await expect(async () => {
        await db.execute(sql.raw(`
          INSERT INTO "${testSchema}"."legal_acceptances" ("id", "source")
          VALUES (2, 'existing_account')
        `));
      }).toThrow();
      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."legal_acceptances"
          ("id", "source", "deployment_sha")
        VALUES (2, 'existing_account', '0123456789abcdef0123456789abcdef01234567')
      `));
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});

async function applyMigration(db: DrizzleDB, testSchema: string): Promise<void> {
  const scopedMigration = (await Bun.file(MIGRATION_PATH).text()).replaceAll(
    '"legal_acceptances"',
    `"${testSchema}"."legal_acceptances"`,
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
