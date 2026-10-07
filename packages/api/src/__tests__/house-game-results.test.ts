import {beforeEach,expect,test} from "bun:test";
import {eq} from "drizzle-orm";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {createGameRoutes} from "../routes/games.js";
import {createWerewolfRoutes} from "../routes/werewolf.js";
import type {readHouseGameResults} from "../services/house-game-results.js";
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
 for(const status of ["waiting","in_progress","cancelled","suspended"] as const){
  await db.update(schema.games).set({status}).where(eq(schema.games.id,id));
  const res=await app.request(`/api/games/${id}/results`);expect(res.status).toBe(409);const body=await res.json();expect(body).toMatchObject({status:"not_completed",gameStatus:status});expect(body).not.toHaveProperty("results");
 }
 await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,id));
 await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence,events.length));
 const res=await app.request(`/api/games/${id}/results`);expect(res.status).toBe(409);expect(await res.json()).toMatchObject({status:"unavailable"});
 expect((await app.request('/api/games/missing/results')).status).toBe(404);
});
test("Influence keeps its existing results payload with a House kind discriminator",async()=>{
 await db.insert(schema.games).values({id:"influence",slug:"influence",status:"completed",config:'{"visibility":"unlisted"}'});
 await db.insert(schema.gameResults).values({id:"influence-result",gameId:"influence",winnerId:null,roundsPlayed:1,finishedAt:new Date().toISOString(),tokenUsage:JSON.stringify({promptTokens:0,completionTokens:0,totalTokens:0,estimatedCost:0})});
 const response=await createGameRoutes(db).request('/api/games/influence/results');
 expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({gameKind:"influence"});expect(body).toHaveProperty("results.availability");
});
