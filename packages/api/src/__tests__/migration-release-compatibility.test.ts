import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  calculateMigrationSet,
  inspectReleaseMigrationFiles,
  inspectReleaseMigrationSql,
} from "../db/migrate.js";

describe("release migration identity", () => {
  test("keeps already-published provider migrations byte-identical", () => {
    const publishedMigrations = new Map([
      [
        "0058_gorgeous_infant_terrible.sql",
        "6d0b1c986c4d6f053debc8c06535359c2bac9389d4d4f099324dfe8131238791",
      ],
      [
        "0059_sealed_provider_manifest.sql",
        "2202f1d0d3a67e7358720bf0eed1e5f8dc431aa910adbf6bebd0519a09f90c80",
      ],
    ]);

    for (const [file, expectedHash] of publishedMigrations) {
      const migration = readFileSync(
        path.resolve(import.meta.dir, "../../drizzle", file),
      );
      expect(createHash("sha256").update(migration).digest("hex")).toBe(
        expectedHash,
      );
    }
  });

  test("is deterministic, path-sensitive, and compatible with the release-manifest format", () => {
    const root = mkdtempSync(path.join(tmpdir(), "influence-migration-set-"));
    const migrations = path.join(root, "drizzle");
    mkdirSync(path.join(migrations, "meta"), { recursive: true });
    writeFileSync(
      path.join(migrations, "0001_additive.sql"),
      "CREATE TABLE example (id uuid);\n",
    );
    writeFileSync(path.join(migrations, "meta", "journal.json"), "{}\n");

    const first = calculateMigrationSet(migrations);
    const repeated = calculateMigrationSet(migrations);
    writeFileSync(
      path.join(migrations, "meta", "journal.json"),
      '{"changed":true}\n',
    );
    const changed = calculateMigrationSet(migrations);

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  test("the current admission migration remains additive", () => {
    const migration = path.resolve(
      import.meta.dir,
      "../../drizzle/0058_gorgeous_infant_terrible.sql",
    );
    expect(readFileSync(migration, "utf8").length).toBeGreaterThan(0);
    expect(inspectReleaseMigrationFiles([migration])).toEqual([]);
  });

  test("the provider-resilience runtime migrations remain additive", () => {
    const migrations = [
      "0058_gorgeous_infant_terrible.sql",
      "0059_sealed_provider_manifest.sql",
      "0060_provider_health.sql",
      "0061_provider_resilience_runtime_upgrade.sql",
      "0062_provider_native_transports.sql",
      "0070_durable_game_turns.sql",
      "0071_durable_game_turn_pacing.sql",
      "0072_provider_logical_call_ordinal_bigint.sql",
    ].map((file) => path.resolve(import.meta.dir, "../../drizzle", file));
    for (const migration of migrations) {
      expect(readFileSync(migration, "utf8").length).toBeGreaterThan(0);
    }
    expect(inspectReleaseMigrationFiles(migrations)).toEqual([]);
  });
});

describe("expand-contract release migration policy", () => {
  test("allows additive tables, columns, indexes, and nullable widening", () => {
    expect(
      inspectReleaseMigrationSql(
        "additive.sql",
        `
      CREATE TABLE release_receipts (id uuid PRIMARY KEY);
      ALTER TABLE games ADD COLUMN release_id uuid;
      ALTER TABLE games ALTER COLUMN legacy_note DROP NOT NULL;
      CREATE INDEX release_receipts_id_idx ON release_receipts (id);
    `,
      ),
    ).toEqual([]);
  });

  test("allows an integer column to widen to bigint", () => {
    expect(
      inspectReleaseMigrationSql(
        "widen-integer.sql",
        'ALTER TABLE "provider_logical_calls" ALTER COLUMN "logical_call_ordinal" TYPE bigint;',
      ),
    ).toEqual([]);
  });

  test("requires a default when an added column is immediately NOT NULL", () => {
    expect(
      inspectReleaseMigrationSql(
        "unsafe-not-null.sql",
        "ALTER TABLE games ADD COLUMN release_id uuid NOT NULL;",
      ),
    ).toEqual([
      expect.objectContaining({
        rule: "add-not-null-without-default",
        file: "unsafe-not-null.sql",
      }),
    ]);
    expect(
      inspectReleaseMigrationSql(
        "safe-not-null.sql",
        "ALTER TABLE games ADD COLUMN release_state text DEFAULT 'pending' NOT NULL;",
      ),
    ).toEqual([]);
  });

  test("allows a named check constraint to be replaced for a compatible widening", () => {
    expect(
      inspectReleaseMigrationSql(
        "widen-check.sql",
        `
      ALTER TABLE provider_calls DROP CONSTRAINT provider_calls_outcome_check;
      ALTER TABLE provider_calls ADD CONSTRAINT provider_calls_outcome_check
        CHECK (outcome IN ('usable', 'request_error'));
    `,
      ),
    ).toEqual([]);
  });

  test("allows a same-named index replacement", () => {
    expect(
      inspectReleaseMigrationSql(
        "replace-index.sql",
        `
      DROP INDEX agent_learning_review_calls_ordinal_unique;
      CREATE UNIQUE INDEX agent_learning_review_calls_ordinal_unique
        ON agent_learning_review_calls (review_id, ordinal, attempt_ordinal);
    `,
      ),
    ).toEqual([]);
  });

  test("rejects DROP, rename, narrowing, truncation, and data deletion", () => {
    const cases = [
      ["drop-column", "ALTER TABLE games DROP COLUMN legacy_note;"],
      [
        "drop-constraint",
        "ALTER TABLE games DROP CONSTRAINT games_status_check;",
      ],
      ["drop-index", "DROP INDEX games_slug_unique;"],
      ["rename-column", "ALTER TABLE games RENAME COLUMN slug TO game_slug;"],
      ["rename-table", "ALTER TABLE games RENAME TO archived_games;"],
      ["narrow-type", "ALTER TABLE games ALTER COLUMN slug TYPE varchar(80);"],
      ["set-not-null", "ALTER TABLE games ALTER COLUMN slug SET NOT NULL;"],
      ["drop-default", "ALTER TABLE games ALTER COLUMN status DROP DEFAULT;"],
      ["truncate", "TRUNCATE TABLE game_events;"],
      ["delete", "DELETE FROM game_events;"],
    ] as const;

    for (const [rule, sql] of cases) {
      expect(inspectReleaseMigrationSql(`${rule}.sql`, sql)).toEqual([
        expect.objectContaining({ rule, file: `${rule}.sql` }),
      ]);
    }
  });

  test("ignores policy words inside SQL comments", () => {
    expect(
      inspectReleaseMigrationSql(
        "comments.sql",
        `
      -- Do not DROP COLUMN while the prior release is a rollback target.
      /* A future migration may RENAME COLUMN after contraction. */
      ALTER TABLE games ADD COLUMN release_note text;
    `,
      ),
    ).toEqual([]);
  });
});
