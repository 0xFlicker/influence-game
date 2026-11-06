import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { schema } from "../db/index.js";
import { createGameRoutes } from "../routes/games.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { readPublicInfluenceSummaries, readPublicWerewolfSummaries } from "../services/public-library-summaries.js";
import { setupTestDB } from "./test-utils.js";

test("selected public-summary readers preserve both existing list responses", async () => {
  const db = await setupTestDB();
  const config = JSON.stringify({ visibility: "public", providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  await db.insert(schema.games).values([
    { id: "influence-one", slug: "influence-one", gameKind: "influence", status: "waiting", config },
    { id: "influence-two", slug: "influence-two", gameKind: "influence", status: "waiting", config },
    { id: "werewolf-one", slug: "werewolf-one", gameKind: "werewolf", status: "waiting", config },
    { id: "werewolf-two", slug: "werewolf-two", gameKind: "werewolf", status: "waiting", config },
  ]);
  const [influence] = await db.select().from(schema.games).where(eq(schema.games.id, "influence-one"));
  const [werewolf] = await db.select().from(schema.games).where(eq(schema.games.id, "werewolf-one"));
  const directInfluence = await readPublicInfluenceSummaries(db, [influence!], { includeEpisodeNumbers: true });
  const directWerewolf = await readPublicWerewolfSummaries(db, [{
    id: werewolf!.id, slug: werewolf!.slug, status: werewolf!.status, gameKind: werewolf!.gameKind,
    seasonId: werewolf!.seasonId, config: werewolf!.config, createdAt: werewolf!.createdAt, playerCount: werewolf!.maxPlayers,
  }], { includeEpisodeNumbers: true });
  const influenceResponse = await createGameRoutes(db).request("/api/games");
  const werewolfResponse = await createWerewolfRoutes(db).request("/api/werewolf");
  expect(influenceResponse.status).toBe(200);
  expect(werewolfResponse.status).toBe(200);
  // HTTP serialization omits undefined fields, so compare the JSON shapes.
  const influenceList = await influenceResponse.json() as Array<{ id: string }>;
  const werewolfList = await werewolfResponse.json() as Array<{ id: string }>;
  expect(influenceList).toHaveLength(2);
  expect(werewolfList).toHaveLength(2);
  expect(influenceList.filter(game => game.id === "influence-one")).toEqual(JSON.parse(JSON.stringify(directInfluence)));
  expect(werewolfList.filter(game => game.id === "werewolf-one")).toEqual(JSON.parse(JSON.stringify(directWerewolf)));
  expect(directInfluence).toMatchObject([{ id: "influence-one", status: "waiting", visibility: "public", episode: { title: "influence-one", cast: [] } }]);
  expect(directWerewolf).toMatchObject([{ id: "werewolf-one", gameKind: "werewolf", status: "waiting", joinedPlayers: 0, episode: { title: "werewolf-one", cast: [] } }]);
});

test("Werewolf search source includes public games older than the legacy 100 without exposing hidden games", async () => {
  const db = await setupTestDB();
  const config = JSON.stringify({ visibility: "public", providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  await db.insert(schema.games).values(Array.from({length: 125}, (_, i) => ({
    id: `search-wolf-${String(i).padStart(3, "0")}`, slug: `search-wolf-${String(i).padStart(3, "0")}`,
    gameKind: "werewolf" as const, status: "completed" as const, config,
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
  })));
  await db.insert(schema.games).values([
    { id: "search-hidden", slug: "search-hidden", gameKind: "werewolf", config, hiddenAt: "2026-01-01", createdAt: "2030-01-01T00:00:00.000Z" },
    { id: "search-unlisted", slug: "search-unlisted", gameKind: "werewolf", config: JSON.stringify({visibility:"unlisted",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]}), createdAt: "2030-01-01T00:00:00.000Z" },
  ]);
  await db.insert(schema.gameEpisodePresentations).values({gameId:"search-wolf-000",title:"Ancient moon",description:"An older public game"});
  const app = createWerewolfRoutes(db);
  const legacyResponse = await app.request("/api/werewolf");
  const searchResponse = await app.request("/api/werewolf-search");
  expect(legacyResponse.status).toBe(200); expect(searchResponse.status).toBe(200);
  expect(searchResponse.headers.get("cache-control")).toContain("no-store");
  const legacy = await legacyResponse.json() as Array<{id:string}>;
  const search = await searchResponse.json() as Array<{id:string;config?:unknown;episode?:{title:string}}>;
  expect(legacy).toHaveLength(100); expect(legacy.some(game=>game.id==="search-wolf-000")).toBe(false);
  expect(search).toHaveLength(125); expect(legacy).toEqual(search.slice(0, 100));
  expect(search.find(game=>game.id==="search-wolf-000")?.episode?.title).toBe("Ancient moon");
  expect(search.some(game=>game.id==="search-hidden" || game.id==="search-unlisted")).toBe(false);
  expect(search.every(game=>!("config" in game))).toBe(true);
  const enabled = process.env.NEXT_PUBLIC_ENABLED_GAMES;
  try {
    process.env.NEXT_PUBLIC_ENABLED_GAMES = "influence";
    expect(await (await app.request("/api/werewolf-search")).json()).toEqual([]);
  } finally {
    if (enabled === undefined) delete process.env.NEXT_PUBLIC_ENABLED_GAMES;
    else process.env.NEXT_PUBLIC_ENABLED_GAMES = enabled;
  }
});
