import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";

const DEFERRED_PREFLIGHT_PATH = new URL("../../drizzle/0036_global_agent_name_uniqueness.sql", import.meta.url);
const DROP_INDEX_PATH = new URL("../../drizzle/0037_defer_agent_name_uniqueness.sql", import.meta.url);

describe("deferred global agent-name uniqueness migrations", () => {
  test("advances over normalized duplicates without mutating profiles", async () => {
    const db = await setupTestDB();
    const testSchema = `agent_name_deferred_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${testSchema}";
      CREATE TABLE "${testSchema}"."agent_profiles" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL
      );
      INSERT INTO "${testSchema}"."agent_profiles" ("id", "name") VALUES
        ('profile-a', 'Lyra'),
        ('profile-b', '  LYRA  ');
    `));

    try {
      await db.execute(sql.raw(await Bun.file(DEFERRED_PREFLIGHT_PATH).text()));
      const dropIndex = (await Bun.file(DROP_INDEX_PATH).text()).replace(
        '"agent_profiles_normalized_name_unique"',
        `"${testSchema}"."agent_profiles_normalized_name_unique"`,
      );
      await db.execute(sql.raw(dropIndex));

      const rows = await db.execute(sql.raw(
        `SELECT "id", "name" FROM "${testSchema}"."agent_profiles" ORDER BY "id"`,
      ));
      expect([...rows]).toEqual([
        { id: "profile-a", name: "Lyra" },
        { id: "profile-b", name: "  LYRA  " },
      ]);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });

  test("removes an already-applied normalized-name index", async () => {
    const db = await setupTestDB();
    const testSchema = `agent_name_index_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${testSchema}";
      CREATE TABLE "${testSchema}"."agent_profiles" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL
      );
      CREATE UNIQUE INDEX "agent_profiles_normalized_name_unique"
        ON "${testSchema}"."agent_profiles" (lower(btrim("name")));
      INSERT INTO "${testSchema}"."agent_profiles" ("id", "name") VALUES
        ('profile-a', 'Lyra');
    `));

    try {
      const dropIndex = (await Bun.file(DROP_INDEX_PATH).text()).replace(
        '"agent_profiles_normalized_name_unique"',
        `"${testSchema}"."agent_profiles_normalized_name_unique"`,
      );
      await db.execute(sql.raw(dropIndex));
      await db.execute(sql.raw(`
        INSERT INTO "${testSchema}"."agent_profiles" ("id", "name")
        VALUES ('profile-b', ' lyra ');
      `));

      const count = await db.execute(sql.raw(
        `SELECT count(*)::int AS count FROM "${testSchema}"."agent_profiles"`,
      ));
      expect(count[0]?.count).toBe(2);
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
    }
  });
});
