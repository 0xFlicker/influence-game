import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";

const MIGRATION_PATH = new URL("../../drizzle/0036_global_agent_name_uniqueness.sql", import.meta.url);

describe("global agent-name uniqueness migration", () => {
  test("reports normalized duplicates without mutating owned profiles", async () => {
    const db = await setupTestDB();
    const testSchema = `agent_name_migration_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${testSchema}";
      CREATE TABLE "${testSchema}"."agent_profiles" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL
      );
      INSERT INTO "${testSchema}"."agent_profiles" ("id", "name") VALUES
        ('profile-a', 'Lillith Voss'),
        ('profile-b', '  LILLITH VOSS  '),
        ('profile-c', 'Distinct Name');
    `));

    try {
      const migration = await Bun.file(MIGRATION_PATH).text();
      const [preflight] = migration.split("--> statement-breakpoint");
      const scopedPreflight = preflight!.replaceAll(
        '"agent_profiles"',
        `"${testSchema}"."agent_profiles"`,
      );

      let failure: unknown;
      try {
        await db.execute(sql.raw(scopedPreflight));
      } catch (error) {
        failure = error;
      }

      const cause = failure && typeof failure === "object"
        ? (failure as { cause?: { message?: string; hint?: string } }).cause
        : undefined;
      expect(cause?.message).toContain("duplicate normalized names: lillith voss (2 profiles)");
      expect(cause?.hint).toContain("No profiles were renamed or deleted");

      const rows = await db.execute(sql.raw(
        `SELECT "id", "name" FROM "${testSchema}"."agent_profiles" ORDER BY "id"`,
      ));
      expect([...rows]).toEqual([
        { id: "profile-a", name: "Lillith Voss" },
        { id: "profile-b", name: "  LILLITH VOSS  " },
        { id: "profile-c", name: "Distinct Name" },
      ]);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});
