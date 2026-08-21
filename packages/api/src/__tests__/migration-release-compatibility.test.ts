import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  calculateMigrationSet,
  inspectReleaseMigrationFiles,
  inspectReleaseMigrationSql,
} from "../db/migrate.js";

describe("release migration identity", () => {
  test("is deterministic, path-sensitive, and compatible with the release-manifest format", () => {
    const root = mkdtempSync(path.join(tmpdir(), "influence-migration-set-"));
    const migrations = path.join(root, "drizzle");
    mkdirSync(path.join(migrations, "meta"), { recursive: true });
    writeFileSync(path.join(migrations, "0001_additive.sql"), "CREATE TABLE example (id uuid);\n");
    writeFileSync(path.join(migrations, "meta", "journal.json"), "{}\n");

    const first = calculateMigrationSet(migrations);
    const repeated = calculateMigrationSet(migrations);
    writeFileSync(path.join(migrations, "meta", "journal.json"), "{\"changed\":true}\n");
    const changed = calculateMigrationSet(migrations);

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  test("the current admission migration remains additive", () => {
    const migration = path.resolve(import.meta.dir, "../../drizzle/0057_married_mojo.sql");
    expect(readFileSync(migration, "utf8").length).toBeGreaterThan(0);
    expect(inspectReleaseMigrationFiles([migration])).toEqual([]);
  });
});

describe("expand-contract release migration policy", () => {
  test("allows additive tables, columns, indexes, and nullable widening", () => {
    expect(inspectReleaseMigrationSql("additive.sql", `
      CREATE TABLE release_receipts (id uuid PRIMARY KEY);
      ALTER TABLE games ADD COLUMN release_id uuid;
      ALTER TABLE games ALTER COLUMN legacy_note DROP NOT NULL;
      CREATE INDEX release_receipts_id_idx ON release_receipts (id);
    `)).toEqual([]);
  });

  test("requires a default when an added column is immediately NOT NULL", () => {
    expect(inspectReleaseMigrationSql(
      "unsafe-not-null.sql",
      "ALTER TABLE games ADD COLUMN release_id uuid NOT NULL;",
    )).toEqual([expect.objectContaining({
      rule: "add-not-null-without-default",
      file: "unsafe-not-null.sql",
    })]);
    expect(inspectReleaseMigrationSql(
      "safe-not-null.sql",
      "ALTER TABLE games ADD COLUMN release_state text DEFAULT 'pending' NOT NULL;",
    )).toEqual([]);
  });

  test("rejects DROP, rename, narrowing, truncation, and data deletion", () => {
    const cases = [
      ["drop-column", "ALTER TABLE games DROP COLUMN legacy_note;"],
      ["rename-column", "ALTER TABLE games RENAME COLUMN slug TO game_slug;"],
      ["rename-table", "ALTER TABLE games RENAME TO archived_games;"],
      ["narrow-type", "ALTER TABLE games ALTER COLUMN slug TYPE varchar(80);"],
      ["set-not-null", "ALTER TABLE games ALTER COLUMN slug SET NOT NULL;"],
      ["drop-default", "ALTER TABLE games ALTER COLUMN status DROP DEFAULT;"],
      ["truncate", "TRUNCATE TABLE game_events;"],
      ["delete", "DELETE FROM game_events;"],
    ] as const;

    for (const [rule, sql] of cases) {
      expect(inspectReleaseMigrationSql(`${rule}.sql`, sql))
        .toEqual([expect.objectContaining({ rule, file: `${rule}.sql` })]);
    }
  });

  test("ignores policy words inside SQL comments", () => {
    expect(inspectReleaseMigrationSql("comments.sql", `
      -- Do not DROP COLUMN while the prior release is a rollback target.
      /* A future migration may RENAME COLUMN after contraction. */
      ALTER TABLE games ADD COLUMN release_note text;
    `)).toEqual([]);
  });
});
