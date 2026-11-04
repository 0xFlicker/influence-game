import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";

const migration = readFileSync(new URL("../../drizzle/0150_championship_corrections.sql", import.meta.url), "utf8");
for (const missingGame of [false, true]) {
  test(`0150 preserves correction evidence; invalid legacy game=${missingGame}`, async () => {
    const db = await setupTestDB();
    const name = `correction_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`CREATE SCHEMA "${name}"`));
    try {
      await db.transaction(async tx => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${name}"`));
        await tx.execute(sql.raw(`
          CREATE TABLE games (id text PRIMARY KEY);
          CREATE TABLE championship_matches (id text PRIMARY KEY, game_id text REFERENCES games(id));
          CREATE TABLE championship_results (match_id text REFERENCES championship_matches(id), entry_id text, points double precision, PRIMARY KEY(match_id,entry_id));
          CREATE TABLE championship_award_allocations (id text PRIMARY KEY, event_id text, phase text, CONSTRAINT championship_awards_phase UNIQUE(event_id,phase));
          CREATE TABLE award_grants (id text PRIMARY KEY);
          CREATE TABLE competition_audit (request_id text, action text, grant_id text);
          INSERT INTO games VALUES ('original'),('replacement');
          INSERT INTO championship_matches VALUES ('match',${missingGame ? "NULL" : "'original'"});
          INSERT INTO championship_results VALUES ('match','entry',0.5);
          INSERT INTO championship_award_allocations VALUES ('allocation','event','final');
          INSERT INTO award_grants VALUES ('grant');
          INSERT INTO competition_audit VALUES ('allocation:0','award_granted','grant');
        `));
      });
      const upgrade = () => db.transaction(async tx => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${name}"`));
        for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
      });
      if (missingGame) {
        await expect(upgrade()).rejects.toThrow();
        const columns = await db.execute(sql.raw(`SELECT column_name FROM information_schema.columns WHERE table_schema='${name}' AND table_name='championship_matches'`));
        expect(columns.map(row => row.column_name)).not.toContain("result_revision");
        expect((await db.execute(sql.raw(`SELECT points FROM "${name}".championship_results`)))[0]?.points).toBe(0.5);
      } else {
        await upgrade();
        await db.transaction(async tx => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${name}"`));
          expect([...(await tx.execute(sql.raw("SELECT * FROM championship_results")))]).toEqual([
            {match_id:"match",entry_id:"entry",points:0.5,revision:0,game_id:"original"},
          ]);
          expect((await tx.execute(sql.raw("SELECT allocation_id FROM award_grants")))[0]?.allocation_id).toBe("allocation");
          await tx.execute(sql.raw("INSERT INTO championship_results VALUES ('match','entry',1,1,'replacement'); INSERT INTO championship_award_allocations (id,event_id,phase,generation) VALUES ('correction','event','final',1)"));
          await tx.execute(sql.raw("INSERT INTO championship_results VALUES ('match','entry',0,1,'replacement') ON CONFLICT DO NOTHING; INSERT INTO championship_award_allocations (id,event_id,phase,generation) VALUES ('duplicate','event','final',1) ON CONFLICT DO NOTHING"));
          expect(await tx.execute(sql.raw("SELECT * FROM championship_results"))).toHaveLength(2);
          expect(await tx.execute(sql.raw("SELECT * FROM championship_award_allocations"))).toHaveLength(2);
          expect((await tx.execute(sql.raw("SELECT points FROM championship_results WHERE revision=1")))[0]?.points).toBe(1);
        });
      }
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA "${name}" CASCADE`));
    }
  });
}
