import {beforeEach,expect,test} from "bun:test";
import {eq, gt} from "drizzle-orm";
import {completedWerewolfResultsFixture as werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {createGameRoutes} from "../routes/games.js";
import {createWerewolfRoutes} from "../routes/werewolf.js";
import type {readHouseGameResults} from "../services/house-game-results.js";
import {createCompletedCanonicalEventFixture,createCanonicalEventFixture,withJuryWinner,insertCanonicalEventRows,insertOwner} from "./durable-run-test-utils.js";
import { Phase } from "@influence/engine";
import { readHouseGameRetrospective } from "../services/house-game-retrospective.js";
import { readInfluenceProductionSource } from "../services/influence-production-source.js";
import { getGameWatchState } from "../services/game-watch-state.js";
import { werewolfResultsFixture as outcomeOnlyWerewolfFixture } from "@influence/engine/fixtures/werewolf-results";
import { readWerewolfProductionSource } from "../services/werewolf-production-source.js";
import { loadWerewolfTrailerSnapshot } from "../services/werewolf-trailer-snapshot.js";
type WolfResponse = Extract<Awaited<ReturnType<typeof readHouseGameResults>>, {gameKind:"werewolf"}>;
let db:DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();});
async function fixture(){
 const id="results-id",slug="results-slug",events=await werewolfResultsFixture("village",id);
 await db.insert(schema.games).values({id,slug,gameKind:"werewolf",status:"completed",config:'{"visibility":"public"}'});
 await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
 return {id,slug,events};
}
test("shared results route dispatches before Influence guard; anonymous Public and Unlisted work",async()=>{
 const {id,slug,events}=await fixture(),app=createGameRoutes(db);
 for(const visibility of ["public","unlisted"]){
  await db.update(schema.games).set({config:JSON.stringify({visibility})}).where(eq(schema.games.id,id));
  for(const key of [id,slug]){
   const response=await app.request(`/api/games/${key}/results`);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
   const body=await response.json() as WolfResponse;expect(body.gameKind).toBe("werewolf");expect(body.results.outcome.faction).toBe("village");expect(body.results.players).toHaveLength(6);
   const encoded=JSON.stringify(body);for(const secret of ["SECRET_SEED","SECRET_THINKING","SECRET_STRATEGY","SECRET_PACK"])expect(encoded).not.toContain(secret);
  }
 }
 expect((await db.select().from(schema.werewolfEvents)).map(r=>r.event)).toHaveLength(events.length);
 expect(await db.select().from(schema.gameResults)).toHaveLength(0);
 // Other Influence APIs keep their own kind guard.
 expect((await app.request(`/api/games/${id}/transcript`)).status).toBe(409);
 const body=await (await app.request(`/api/games/${id}/results`)).json() as WolfResponse;
 await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,id));
 expect((await app.request(`/api/games/${id}/results`)).status).toBe(404);
 expect((await createWerewolfRoutes(db).request(body.results.players[0]!.avatarUrl)).status).toBe(404);
 await db.update(schema.games).set({hiddenAt:null,config:'{"visibility":"invalid"}'}).where(eq(schema.games.id,id));
 expect((await app.request(`/api/games/${id}/results`)).status).toBe(404);
});
test("results lifecycle never converts active, stopped or corrupt games into an outcome",async()=>{
 const {id,events}=await fixture(),app=createGameRoutes(db);
 const outcome=events.find(event=>event.type === "werewolf.completed")!;
 await db.delete(schema.werewolfEvents).where(gt(schema.werewolfEvents.sequence,outcome.sequence - 1));
 for(const status of ["waiting","in_progress","cancelled","suspended"] as const){
  await db.update(schema.games).set({status}).where(eq(schema.games.id,id));
  const res=await app.request(`/api/games/${id}/results`);expect(res.status).toBe(409);const body=await res.json();expect(body).toMatchObject({status:"not_completed",gameStatus:status});expect(body).not.toHaveProperty("results");
 }
 await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,id));
 await db.insert(schema.werewolfEvents).values(events.filter(event=>event.sequence>=outcome.sequence).map(event=>({gameId:id,sequence:event.sequence,event})));
 await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence,events.length));
 const res=await app.request(`/api/games/${id}/results`);expect(res.status).toBe(409);expect(await res.json()).toMatchObject({status:"unavailable"});
 expect((await app.request('/api/games/missing/results')).status).toBe(404);
});
test("Influence keeps its existing results payload with a House kind discriminator",async()=>{
 await db.insert(schema.games).values({id:"influence",slug:"influence",status:"completed",config:'{"visibility":"unlisted"}'});
 await db.insert(schema.gameResults).values({id:"influence-result",gameId:"influence",winnerId:null,roundsPlayed:1,finishedAt:new Date().toISOString(),tokenUsage:JSON.stringify({promptTokens:0,completionTokens:0,totalTokens:0,estimatedCost:0})});
 const owner=await insertOwner(db,"influence");
 await insertCanonicalEventRows(db,"influence",owner,createCompletedCanonicalEventFixture("influence"));
 const response=await createGameRoutes(db).request('/api/games/influence/results');
 expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({gameKind:"influence"});expect(body).toHaveProperty("results.availability");
});

test("completed Influence without retrospectives retains results, retrospective reads and Studio source", async () => {
 const id = "no-retrospective";
 await db.insert(schema.games).values({id,slug:id,status:"completed",config:'{"visibility":"public"}'});
 await db.insert(schema.gamePlayers).values(["atlas","echo","mira","nyx"].map(playerId => ({id:playerId,gameId:id,persona:JSON.stringify({name:playerId,personality:"Fixture"}),agentConfig:"{}"})));
 const events = withJuryWinner(createCanonicalEventFixture(id), "atlas");
 await insertCanonicalEventRows(db,id,await insertOwner(db,id),events);
 const response = await createGameRoutes(db).request(`/api/games/${id}/results`);
 expect(response.status).toBe(200);
 const body = await response.json();
 expect(body).toMatchObject({gameKind:"influence",retrospective:{status:"unavailable",requiredStatements:0}});
 expect(body).toMatchObject({results:{summary:{winner:{id:"atlas"}}}});
 const page = await readHouseGameRetrospective(db,{gameIdOrSlug:id});
 expect(page.progress).toMatchObject({status:"unavailable",requiredStatements:0});
 expect(page.statements).toEqual([]);
 expect(page.recovery).toBeNull();
 expect(page.pollCursor).toBeNull();
 const source = await readInfluenceProductionSource(db,id);
 expect(source.catalog.moments.some(moment => moment.purpose === "retrospective")).toBe(false);
 expect((await getGameWatchState(db,id))?.retrospective).toMatchObject({status:"unavailable",requiredStatements:0});
});

test("rules-v7 Werewolf without retrospectives retains results, Studio and trailer reads", async () => {
 const id = "no-retrospective-v7", events = await outcomeOnlyWerewolfFixture("saved",id);
 const first = events[0]!;
 if (first.type !== "werewolf.started") throw new Error("Expected start event");
 first.payload.config.rulesVersion = 7;
 await db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",startedAt:"2026-10-01T00:00:00.000Z",config:'{"visibility":"public"}'});
 await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
 const response = await createGameRoutes(db).request(`/api/games/${id}/results`);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({gameKind:"werewolf",retrospective:{status:"unavailable",requiredStatements:0}});
 const page = await readHouseGameRetrospective(db,{gameIdOrSlug:id});
 expect(page.progress).toMatchObject({status:"unavailable",requiredStatements:0});
 expect(page.statements).toEqual([]);
 expect((await readWerewolfProductionSource(db,id,{audience:"mystery",thinking:false})).catalog.moments.length).toBeGreaterThan(0);
 await db.insert(schema.houseCutJobs).values({gameId:id,audience:"mystery",status:"ready",publication:{version:"v1",audience:"mystery",cuts:[]}});
 expect(await loadWerewolfTrailerSnapshot(db,id)).toBeDefined();
});

test.each(["phase", "started", "statements"] as const)("completed Influence with an unfinished retrospective (%s) is still invalid", async stage => {
 const id = `unfinished-${stage}`, events = createCompletedCanonicalEventFixture(id);
 const boundary = stage === "phase" ? events.find(event => event.phase === Phase.RETROSPECTIVE)!
  : stage === "started" ? events.find(event => event.type === "retrospective.started")!
  : events.filter(event => event.type === "retrospective.statement_recorded").at(-1)!;
 await db.insert(schema.games).values({id,slug:id,status:"completed",config:'{}'});
 await insertCanonicalEventRows(db,id,await insertOwner(db,id),events.filter(event => event.sequence <= boundary.sequence));
 const response = await createGameRoutes(db).request(`/api/games/${id}/results`);
 expect(response.status).toBe(409);
 expect(await response.json()).toMatchObject({status:"unavailable"});
 await expect(readHouseGameRetrospective(db,{gameIdOrSlug:id})).rejects.toThrow("unavailable or invalid");
});
