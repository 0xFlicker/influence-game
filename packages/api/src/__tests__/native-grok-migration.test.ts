import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { setupTestDB } from "./test-utils";
import { gameModelPolicy, sealGameModelRouting } from "@influence/engine";

test("Grok cutover upgrades mutable preferences and waiting games, preserves frozen history, and is idempotent", async () => {
  const db = await setupTestDB();
  const namespace = `grok_${randomUUID().replaceAll("-", "")}`;
  const tables = ["games", "agent_profiles", "game_players", "werewolf_lobby_seats"];
  let migration = await Bun.file(new URL("../../drizzle/0141_native_grok_selections.sql", import.meta.url)).text();
  for (const table of tables) migration = migration.replaceAll(`"${table}"`, `"${namespace}"."${table}"`);
  const choice = (model: string) => ({ catalogId: model, reasoningPolicy: "low" });
  const old = choice("katana:grok-4-3");
  const routing = { version: 1, defaultManifest: [old, { ...choice("xai:grok-4.3"), maxCallsPerGame: 3 },
    { ...choice("katana:grok-4-5"), maxCallsPerGame: 7 }], houseManifest: [choice("katana:grok-4-6")],
    overrides: { override: choice("katana:grok-4-20-multi-agent") }, excludedCatalogIds: ["xai:grok-4.3", "katana:kimi-k3"] };
  const config = { modelRouting: routing, modelSelection: old, providerManifest: [old], unrelated: "katana:grok-4-3" };
  await db.execute(sql.raw(`CREATE SCHEMA "${namespace}";
    CREATE TABLE "${namespace}"."games" (id text PRIMARY KEY, status text, config text);
    CREATE TABLE "${namespace}"."agent_profiles" (id text PRIMARY KEY, model_preference jsonb);
    CREATE TABLE "${namespace}"."game_players" (id text PRIMARY KEY, game_id text, model_preference jsonb);
    CREATE TABLE "${namespace}"."werewolf_lobby_seats" (id text PRIMARY KEY, game_id text, model_preference jsonb);`));
  const table = (name: string) => sql.raw(`"${namespace}"."${name}"`);
  const snapshot = async () => {
    const result: Record<string, unknown[]> = {};
    for (const name of tables) result[name] = [...await db.execute(sql`SELECT * FROM ${table(name)} ORDER BY id`)];
    return result;
  };
  const apply = async () => db.transaction(async tx => {
    for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
  });
  try {
    for (const [id, status] of [["waiting", "waiting"], ["running", "in_progress"], ["done", "completed"], ["paused", "suspended"], ["sealed", "waiting"], ["frozenOnly", "waiting"]]) {
      const stored = id === "frozenOnly" ? { modelRouting: { ...routing, frozenRoutes: {} } } : id === "sealed" ? { modelRouting: { ...routing, contestants: {} } } : config;
      await db.execute(sql`INSERT INTO ${table("games")} VALUES (${id}, ${status}, ${JSON.stringify(stored)})`);
      for (const name of ["game_players", "werewolf_lobby_seats"]) await db.execute(sql`INSERT INTO ${table(name)} VALUES (${id}, ${id}, ${JSON.stringify(old)}::jsonb)`);
    }
    for (const id of ["katana:grok-4-3", "katana:grok-4-5", "katana:grok-4-6", "katana:grok-4-20-multi-agent", "openai:gpt-6-luna"])
      await db.execute(sql`INSERT INTO ${table("agent_profiles")} VALUES (${id}, ${JSON.stringify(choice(id))}::jsonb)`);
    const before = await snapshot();
    await apply();
    const after = await snapshot();
    for (const name of ["games", "game_players", "werewolf_lobby_seats"]) {
      for (const row of before[name] as Array<{ id: string }>) if (row.id !== "waiting") expect(after[name]).toContainEqual(row);
    }
    const games = await db.execute<{ config: string }>(sql`SELECT config FROM ${table("games")} WHERE id = 'waiting'`);
    const updated = JSON.parse(games[0]!.config);
    expect(updated.unrelated).toBe(config.unrelated);
    expect(updated.modelSelection).toEqual(choice("xai:grok-4.3"));
    expect(updated.providerManifest).toEqual([choice("xai:grok-4.3")]);
    expect(updated.modelRouting.defaultManifest).toEqual([choice("xai:grok-4.3"), { ...choice("xai:grok-4.5"), maxCallsPerGame: 7 }]);
    expect(updated.modelRouting.houseManifest).toEqual([choice("xai:grok-4.6")]);
    expect(updated.modelRouting.overrides.override).toEqual(choice("xai:grok-4.20-multi-agent-0309"));
    expect(updated.modelRouting.excludedCatalogIds).toEqual(["katana:kimi-k3"]);
    expect(() => sealGameModelRouting(gameModelPolicy(updated), [{ id: "override" }])).not.toThrow();
    for (const name of ["game_players", "werewolf_lobby_seats"]) expect(after[name]).toContainEqual({ id: "waiting", game_id: "waiting", model_preference: choice("xai:grok-4.3") });
    const profiles = after.agent_profiles as Array<{ id: string; model_preference: unknown }>;
    expect(profiles.map(row => row.model_preference)).toEqual(expect.arrayContaining([
      choice("xai:grok-4.3"), choice("xai:grok-4.5"), choice("xai:grok-4.6"), choice("xai:grok-4.20-multi-agent-0309"), choice("openai:gpt-6-luna"),
    ]));
    await apply();
    expect(await snapshot()).toEqual(after);
    await db.execute(sql`INSERT INTO ${table("agent_profiles")} VALUES ('unknown', ${JSON.stringify(choice("katana:grok-unknown"))}::jsonb)`);
    const beforeRejectedCutover = await snapshot();
    await expect(apply()).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Unaudited Katana Grok selection") },
    });
    expect(await snapshot()).toEqual(beforeRejectedCutover);
  } finally { await db.execute(sql.raw(`DROP SCHEMA "${namespace}" CASCADE`)); }
});

