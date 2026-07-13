import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("game slug migrations", () => {
  test("backfills game slugs before enforcing the non-null contract", () => {
    const sql = readFileSync(join(import.meta.dir, "../../drizzle/0034_premium_mantis.sql"), "utf8");
    const backfill = sql.indexOf("'legacy-' || \"id\"");
    const constraint = sql.indexOf('ALTER COLUMN "slug" SET NOT NULL');

    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(sql).toContain('WHERE "slug" IS NULL');
    expect(sql).toContain('WITH RECURSIVE "slug_candidates"');
    expect(sql).toContain('"slug_candidates"."suffix" + 1');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(constraint).toBeGreaterThan(backfill);
  });

  test("repairs cached watch-summary identities before enforcing non-null slugs", () => {
    const sql = readFileSync(join(import.meta.dir, "../../drizzle/0035_big_human_robot.sql"), "utf8");
    const backfill = sql.indexOf('SET "slug" = "games"."slug"');
    const constraint = sql.indexOf('ALTER COLUMN "slug" SET NOT NULL');

    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThan(backfill);
  });
});
