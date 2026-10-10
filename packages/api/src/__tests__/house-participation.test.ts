import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { replayWerewolf } from "@influence/engine/werewolf";
import type { HouseParticipation } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import type { PublicPlayerProfileEnvelope } from "../services/public-player-profile.js";
import { readHouseParticipation } from "../services/house-participation.js";
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
async function wolf(id:string, scenario:Parameters<typeof werewolfResultsFixture>[0]="village", visibility="public", date="2026-10-05T12:00:00.000Z", allSeats=false) {
  const events = await werewolfResultsFixture(scenario,id);
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
  expect(history[2]).toMatchObject({gameKind:"influence",result:{outcome:"win",placement:1,totalPoints:null}});
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
test("historical Influence nonwinners do not receive invented last place", async () => {
  await influence("historical","2026-10-01T00:00:00.000Z");
  await db.insert(schema.gamePlayers).values({id:"winner",gameId:"historical",persona:JSON.stringify({name:"Winner"}),agentConfig:"{}"});
  await db.update(schema.gameResults).set({winnerId:"winner"}).where(eq(schema.gameResults.gameId,"historical"));
  const rows=await readHouseParticipation(db,"owner");
  expect(rows[0]).toMatchObject({gameKind:"influence",totalPlayers:2,result:{outcome:"loss",placement:null,eliminated:null}});
});
