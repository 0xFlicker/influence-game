import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";

test.each([
  "game_evidence_owner_epoch_fk",
  "game_evidence_manifests_owner_epoch_game_run_owners_owner_epoch",
])("upgrades applied routing with %s, preserving journal rows and game-owner constraints", async (ownerConstraint) => {
  const db = await setupTestDB();
  const schema = `routing_migration_${randomUUID().replaceAll("-", "")}`;
  const migration128 = await Bun.file(new URL("../../drizzle/0128_game_model_routing.sql", import.meta.url)).text();
  const migration129 = await Bun.file(new URL("../../drizzle/0129_provider_journal_house_authority.sql", import.meta.url)).text();

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
    await tx.execute(sql.raw(`
      CREATE TABLE agent_profiles (id text PRIMARY KEY);
      CREATE TABLE game_players (id text PRIMARY KEY);
      CREATE TABLE werewolf_lobby_seats (id text PRIMARY KEY);
      CREATE TABLE game_run_owners (game_id text, owner_epoch text UNIQUE, PRIMARY KEY (game_id, owner_epoch));
      CREATE TABLE provider_logical_calls (id text PRIMARY KEY);
      INSERT INTO game_run_owners VALUES ('game', 'owner');
      INSERT INTO provider_logical_calls VALUES ('call');
    `));
    for (const table of ["provider_call_attempts", "provider_attempt_evidence_outbox", "game_evidence_manifests"]) {
      await tx.execute(sql.raw(`
        CREATE TABLE ${table} (
          id text PRIMARY KEY, game_id text NOT NULL, owner_epoch text NOT NULL,
          CONSTRAINT ${table}_game_owner_fk FOREIGN KEY (game_id, owner_epoch) REFERENCES game_run_owners (game_id, owner_epoch)
        );
        INSERT INTO ${table} VALUES ('existing', 'game', 'owner');
      `));
    }
    await tx.execute(sql.raw(`ALTER TABLE game_evidence_manifests ADD CONSTRAINT ${ownerConstraint} FOREIGN KEY (owner_epoch) REFERENCES game_run_owners (owner_epoch)`));
    for (const migration of [migration128, migration129]) {
      for (const statement of migration.split("--> statement-breakpoint").filter(s => s.trim())) {
        await tx.execute(sql.raw(statement));
      }
    }

    for (const table of ["provider_call_attempts", "provider_attempt_evidence_outbox", "game_evidence_manifests"]) {
      expect([...await tx.execute(sql.raw(`SELECT * FROM ${table}`))]).toEqual([
        expect.objectContaining({ id: "existing", game_id: "game", owner_epoch: "owner", authority_kind: "game", game_owner_epoch: "owner" }),
      ]);
      await tx.execute(sql.raw(`INSERT INTO ${table} (id, game_id, owner_epoch, authority_kind) VALUES ('episode', 'game', 'episode-lease', 'episode_copy')`));
      expect([...await tx.execute(sql.raw(`SELECT game_owner_epoch FROM ${table} WHERE id = 'episode'`))]).toEqual([{ game_owner_epoch: null }]);
      // A savepoint lets the enclosing fixture survive the expected FK failure.
      await expect(tx.transaction(async (savepoint) => {
        await savepoint.execute(sql.raw(`INSERT INTO ${table} (id, game_id, owner_epoch) VALUES ('invalid', 'game', 'missing-owner')`));
      })).rejects.toThrow();
    }
    expect([...await tx.execute(sql.raw("SELECT rate_card FROM provider_call_attempts WHERE id = 'existing'"))]).toEqual([{ rate_card: null }]);
    expect([...await tx.execute(sql.raw("SELECT preferred_catalog_id FROM provider_logical_calls"))]).toEqual([{ preferred_catalog_id: null }]);
    await tx.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`));
  });
});
