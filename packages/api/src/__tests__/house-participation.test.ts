import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { replayWerewolf } from "@influence/engine/werewolf";
import type { HouseParticipation } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import type { PublicPlayerProfileEnvelope } from "../services/public-player-profile.js";
import { readHouseParticipation, readHouseParticipationPage } from "../services/house-participation.js";
import { createGameRoutes } from "../routes/games.js";
import { createPublicPlayerRoutes } from "../routes/public-players.js";
import { assertPublicPlayerProfileEnvelope } from "../game-mcp/public-player-tool-schema.js";
import { createSessionToken } from "../middleware/auth.js";
let db: DrizzleDB;
const savedSecret = process.env.JWT_SECRET;
afterAll(() => { if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret; });
beforeEach(async () => {
  process.env.JWT_SECRET = "history-test-secret";
  db = await setupTestDB();
  await db.insert(schema.users).values([{id:"owner",handle:"history-owner"},{id:"other"}]);
  await db.insert(schema.agentProfiles).values([
    {id:"mine",userId:"owner",name:"Current name",personality:"PRIVATE_CURRENT"},
    {id:"other-agent",userId:"other",name:"Other",personality:"Other"},
  ]);
});
async function wolf(id:string, scenario:Parameters<typeof completedWerewolfResultsFixture>[0]="village", visibility="public", date="2026-10-05T12:00:00.000Z", allSeats=false) {
  const events = await completedWerewolfResultsFixture(scenario,id);
  const opening = events[0]!;
  if (opening.type !== "werewolf.started") throw new Error("fixture");
  const end = replayWerewolf(events);
  const deadWinner = end.players.find(p => end.outcome!.winnerIds.includes(p.id) && !end.aliveIds.includes(p.id));
  for(const player of opening.payload.players) player.agentProfileId = allSeats || player.id === (deadWinner?.id ?? opening.payload.players[0]!.id) ? "mine" : "other-agent";
  await db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",config:JSON.stringify({visibility}),endedAt:date});
  await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
  return events;
}
async function influence(id:string,date:string) {
  await db.insert(schema.games).values({id,slug:id,status:"completed",config:"{}",endedAt:date});
  await db.insert(schema.gamePlayers).values({id:`${id}-seat`,gameId:id,userId:"owner",agentProfileId:"mine",persona:JSON.stringify({name:"Frozen Influence"}),agentConfig:"{}"});
  await db.insert(schema.gameResults).values({id:`${id}-result`,gameId:id,winnerId:`${id}-seat`,roundsPlayed:3,finishedAt:date,tokenUsage:"{}"});
}
test("owner/public routes share frozen participation, enforce discovery visibility and never export private evidence", async () => {
  await influence("influence","2026-10-04T12:00:00.000Z");
  await wolf("public"); await wolf("unlisted","village","unlisted"); await wolf("hidden");
  await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,"hidden"));
  await db.update(schema.agentProfiles).set({name:"Renamed",archivedAt:new Date().toISOString()}).where(eq(schema.agentProfiles.id,"mine"));
  const token = await createSessionToken("owner",{roles:["player"],permissions:[]});
  const owner = await createGameRoutes(db).request("/api/player/games",{headers:{Authorization:`Bearer ${token}`}});
  expect(owner.status).toBe(200);
  const history = await owner.json() as HouseParticipation[];
  expect(history.map(h=>h.gameSlug)).toEqual(["unlisted","public","influence"]);
  expect(history[1]).toMatchObject({gameKind:"werewolf",result:{outcome:"win",faction:"village",alive:false}});
  expect(history[2]).toMatchObject({gameKind:"influence",result:null}); // A terminal row alone is not canonical outcome evidence.
  expect(await db.select().from(schema.gamePlayers)).toHaveLength(1); // no Werewolf lobby seats
  const response = await createPublicPlayerRoutes(db).request("/api/players/history-owner");
  expect(response.status).toBe(200);
  const body = await response.json() as Extract<PublicPlayerProfileEnvelope, {status:"found"}>;
  expect(body.profile.recentResults.map((h:HouseParticipation)=>h.gameSlug)).toEqual(["public","influence"]);
  expect(body.profile.career.gamesPlayed).toBe(0);
  expect(() => assertPublicPlayerProfileEnvelope(body)).not.toThrow();
  const injected = structuredClone(body);
  Object.assign(injected.profile.recentResults[0]!.result!, {thinking:"PRIVATE"});
  expect(() => assertPublicPlayerProfileEnvelope(injected)).toThrow("exactly");
  const badKind = structuredClone(body);
  Object.assign(badKind.profile.recentResults[0]!, {gameKind:"third-game"});
  expect(() => assertPublicPlayerProfileEnvelope(badKind)).toThrow();
  for(const secret of ["SECRET_","PRIVATE_CURRENT","Renamed","strategy","thinking","nightActions","role\"", "other-agent"]) expect(JSON.stringify(history)).not.toContain(secret);
  expect(await db.select().from(schema.competitionReceipts)).toHaveLength(0);
  expect((await db.select().from(schema.users).where(eq(schema.users.id,"owner")))[0]!.gamesPlayed).toBe(0);
});
test("game filter precedes public five-row limit; outcomes remain per seat, including opposing factions and draws", async () => {
  await influence("older-influence","2026-10-01T00:00:00.000Z");
  await wolf("many-seats","wolves","public","2026-10-05T00:00:00.000Z",true);
  const all = await readHouseParticipation(db,"owner");
  expect(all).toHaveLength(9);
  const wolfRows = all.filter(r=>r.gameKind === "werewolf");
  expect(wolfRows.some(r=>r.result?.outcome === "win")).toBe(true);
  expect(wolfRows.some(r=>r.result?.outcome === "loss")).toBe(true);
  expect(await readHouseParticipation(db,"owner",{publicOnly:true,limit:5})).toHaveLength(5);
  const filtered = await (await createPublicPlayerRoutes(db).request("/api/players/history-owner?game=influence")).json() as Extract<PublicPlayerProfileEnvelope, {status:"found"}>;
  expect(filtered.profile.recentResults.map((r:HouseParticipation)=>r.gameSlug)).toEqual(["older-influence"]);
  await wolf("draw","saved");
  expect((await readHouseParticipation(db,"owner")).find(r=>r.gameId === "draw")?.result?.outcome).toBe("draw");
  expect((await createPublicPlayerRoutes(db).request("/api/players/history-owner?game=other")).status).toBe(400);
});
test("invalid terminal evidence is unavailable and unfinished games never become historical results", async () => {
  const events = await wolf("corrupt");
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence,events.length));
  expect((await readHouseParticipation(db,"owner"))[0]?.result).toBeNull();
  for(const status of ["waiting","in_progress","cancelled","suspended"] as const) {
    await db.update(schema.games).set({status}).where(eq(schema.games.id,"corrupt"));
    expect(await readHouseParticipation(db,"owner")).toEqual([]);
  }
});
test("historical Influence without canonical evidence does not invent an outcome or placement", async () => {
  await influence("historical","2026-10-01T00:00:00.000Z");
  await db.insert(schema.gamePlayers).values({id:"winner",gameId:"historical",persona:JSON.stringify({name:"Winner"}),agentConfig:"{}"});
  await db.update(schema.gameResults).set({winnerId:"winner"}).where(eq(schema.gameResults.gameId,"historical"));
  const rows=await readHouseParticipation(db,"owner");
  expect(rows[0]).toMatchObject({gameKind:"influence",totalPlayers:2,result:null});
});

test("paged Werewolf history follows current profile ownership for every owned seat", async () => {
  await wolf("transferred-wolf", "wolves", "public", "2026-10-05T00:00:00.000Z", true);
  const before = await readHouseParticipationPage(db, "owner", 20, null, "werewolf");
  expect(before.items.length).toBeGreaterThan(1);
  await db.update(schema.agentProfiles).set({ userId: "other" }).where(eq(schema.agentProfiles.id, "mine"));
  const former = await readHouseParticipationPage(db, "owner", 20, null, "werewolf");
  const current = await readHouseParticipationPage(db, "other", 20, null, "werewolf");
  expect(former.items).toEqual([]);
  expect(current.items.map(item => item.playerId)).toEqual(before.items.map(item => item.playerId));
});

test("legacy pages fail closed when duplicate Werewolf seat IDs cross a cursor boundary", async () => {
  const savedMode = process.env.HOUSE_OWNER_HISTORY_READ_MODE;
  process.env.HOUSE_OWNER_HISTORY_READ_MODE = "legacy";
  try {
    await influence("newer", "2026-10-06T00:00:00.000Z");
    const events = await wolf("duplicate-seats", "wolves", "public", "2026-10-05T00:00:00.000Z", true);
    const opening = events[0];
    if (!opening || opening.type !== "werewolf.started") throw new Error("fixture opening missing");
    for (const player of opening.payload.players) player.id = "duplicate";
    await db.update(schema.werewolfEvents).set({ event: opening }).where(eq(schema.werewolfEvents.sequence, 1));
    const headers = { Authorization: `Bearer ${await createSessionToken("owner", { roles: ["player"], permissions: [] })}` };
    const app = createGameRoutes(db);
    const first = await app.request("/api/player/games-page?limit=1", { headers });
    expect(first.status).toBe(200);
    const page = await first.json() as { items: HouseParticipation[]; nextCursor: string };
    expect(page.items.map(item => item.gameId)).toEqual(["newer"]);
    expect(page.nextCursor).toBeTruthy();
    const response = await app.request(`/api/player/games-page?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, { headers });
    const body = await response.json() as { items?: HouseParticipation[]; error?: string; nextCursor?: string };
    expect({ status: response.status, itemCount: body.items?.length ?? null }).toEqual({ status: 503, itemCount: null });
    expect(body.error).toBe("Game history is temporarily unavailable.");
    expect(body.nextCursor).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const template = opening.payload.players[0]!;
    opening.payload.players = Array.from({ length: 1001 }, (_, index) => ({ ...template, id: `seat-${index}` }));
    await db.update(schema.werewolfEvents).set({ event: opening }).where(eq(schema.werewolfEvents.sequence, 1));
    const oversized = await app.request(`/api/player/games-page?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, { headers });
    expect(oversized.status).toBe(503);
    expect((await oversized.json()) as { items?: unknown[] }).not.toHaveProperty("items");
    const influenceOnly = await app.request("/api/player/games-page?game=influence&limit=1", { headers });
    expect(influenceOnly.status).toBe(200);
    expect(((await influenceOnly.json()) as { items: HouseParticipation[] }).items).toHaveLength(1);
  } finally {
    if (savedMode === undefined) delete process.env.HOUSE_OWNER_HISTORY_READ_MODE; else process.env.HOUSE_OWNER_HISTORY_READ_MODE = savedMode;
  }
});

test("owner history cursor applies visibility and ownership before paging, including tied multi-seat games", async () => {
  await influence("old", "2026-10-01T00:00:00.000Z");
  await influence("tied-influence", "2026-10-05T00:00:00.000Z");
  await wolf("tied-wolf", "wolves", "unlisted", "2026-10-05T00:00:00.000Z", true);
  await wolf("hidden", "village", "public", "2026-10-06T00:00:00.000Z", true);
  await db.update(schema.games).set({ hiddenAt: "2026-10-07T00:00:00.000Z" }).where(eq(schema.games.id, "hidden"));
  await influence("bad-config", "2026-10-07T00:00:00.000Z");
  await db.update(schema.games).set({ config: "{broken" }).where(eq(schema.games.id, "bad-config"));
  const token = await createSessionToken("owner", { roles: ["player"], permissions: [] });
  const headers = { Authorization: `Bearer ${token}` };
  const app = createGameRoutes(db);
  const collected: HouseParticipation[] = [];
  let cursor: string | null = null;
  do {
    const response = await app.request(`/api/player/games-page?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const page = await response.json() as {items: HouseParticipation[]; nextCursor: string | null};
    expect(page.items.length).toBeLessThanOrEqual(3);
    collected.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const expected = await readHouseParticipation(db, "owner");
  expect(collected).toEqual(expected);
  expect(collected.filter(row => row.gameId === "tied-wolf")).toHaveLength(8);
  expect(new Set(collected.map(row => `${row.gameId}:${row.playerId}`)).size).toBe(collected.length);
  expect((await app.request("/api/player/games-page?limit=51", { headers })).status).toBe(400);
  expect((await app.request("/api/player/games-page?cursor=broken", { headers })).status).toBe(400);
  expect((await app.request("/api/player/games-page")).status).toBe(401);
  const otherToken = await createSessionToken("other", { roles: ["player"], permissions: [] });
  const other = await app.request("/api/player/games-page", { headers: { Authorization: `Bearer ${otherToken}` } });
  expect(((await other.json()) as {items: HouseParticipation[]}).items).toEqual([]);
  const influencePage = await (await app.request("/api/player/games-page?game=influence&limit=1", { headers })).json() as {items: HouseParticipation[]; nextCursor: string};
  expect(influencePage.items.map(row => row.gameId)).toEqual(["tied-influence"]);
  expect(influencePage.nextCursor).toBeTruthy();
  expect((await app.request(`/api/player/games-page?game=werewolf&cursor=${encodeURIComponent(influencePage.nextCursor)}`, { headers })).status).toBe(400);
  const wolfPage = await (await app.request("/api/player/games-page?game=werewolf&limit=2", { headers })).json() as {items: HouseParticipation[]};
  expect(wolfPage.items.map(row => row.gameKind)).toEqual(["werewolf", "werewolf"]);
  expect((await app.request("/api/player/games-page?game=other", { headers })).status).toBe(400);
});

test("a newly completed game ahead of a cursor appears on the next refresh, not twice in the current traversal", async () => {
  await influence("older", "2026-10-01T00:00:00.000Z");
  await influence("newer", "2026-10-02T00:00:00.000Z");
  const headers = { Authorization: `Bearer ${await createSessionToken("owner", { roles: ["player"], permissions: [] })}` };
  const app = createGameRoutes(db);
  const first = await (await app.request("/api/player/games-page?limit=1", { headers })).json() as {items: HouseParticipation[]; nextCursor: string};
  expect(first.items.map(row => row.gameId)).toEqual(["newer"]);
  await influence("latest", "2026-10-03T00:00:00.000Z");
  const second = await (await app.request(`/api/player/games-page?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, { headers })).json() as {items: HouseParticipation[]; nextCursor: string | null};
  expect(second.items.map(row => row.gameId)).toEqual(["older"]);
  expect(second.nextCursor).toBeNull();
  const refreshed = await (await app.request("/api/player/games-page?limit=1", { headers })).json() as {items: HouseParticipation[]};
  expect(refreshed.items.map(row => row.gameId)).toEqual(["latest"]);
});

test("cursor orders mixed timestamp offsets by actual instant and keeps invalid timestamps after valid ones", async () => {
  await influence("a-utc", "2026-10-01T12:00:00Z");
  await influence("z-earlier-offset", "2026-10-01T13:00:00+02:00");
  await influence("b-equal-offset", "2026-10-01T08:00:00-04:00");
  await influence("future-naive", "2026-10-01T12:00:01");
  await influence("invalid", "not-a-timestamp");
  const headers = { Authorization: `Bearer ${await createSessionToken("owner", { roles: ["player"], permissions: [] })}` };
  const app = createGameRoutes(db);
  let cursor: string | null = null;
  const games: string[] = [];
  do {
    const response = await app.request(`/api/player/games-page?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json() as {items: HouseParticipation[]; nextCursor: string | null};
    games.push(...body.items.map(row => row.gameId));
    cursor = body.nextCursor;
  } while (cursor);
  expect(games).toEqual(["future-naive", "b-equal-offset", "a-utc", "z-earlier-offset", "invalid"]);
});
