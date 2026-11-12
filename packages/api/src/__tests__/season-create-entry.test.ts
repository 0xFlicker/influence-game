import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import { setupTestDB, acceptTestAgent } from "./test-utils.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { closeSeason, createSeason } from "../services/seasons.js";
import { contentImageFixture, headPositionFixture } from "./content-image-fixture.js";

test("create then season entry recovers duplicate responses and cannot spill into the next season", async()=>{
  const db=await setupTestDB();
  process.env.JWT_SECRET="disposable-season-create-test";
  const userId=randomUUID();
  await db.insert(schema.users).values({id:userId,displayName:"Season fixture",walletAddress:"0x1234567890123456789012345678901234567890"});
  await grantTestAuthority(db,userId,["join_game"],"player");
  const token=await createSessionToken(userId);
  const app=new Hono();app.route("/",createAgentProfileRoutes(db));app.route("/",createFreeQueueRoutes(db));
  const post=(url:string,body:unknown)=>app.request(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  const season=await createSeason(db,{slug:"entry-target",name:"Entry target"});
  const fullBodyReferenceUrl = await contentImageFixture("pfp/season-newcomer.png");
  const body={creationRequestId:randomUUID(),name:"Season Newcomer",gender:"non-binary",personality:"Patient",personaKey:"strategic",
    fullBodyReferenceUrl,headPosition:await headPositionFixture(fullBodyReferenceUrl)};
  const created=await post("/api/agent-profiles",body);
  expect(created.status).toBe(201);
  const agent=await created.json() as {id:string};
  // Creation itself never enrolls unrelated management flows.
  expect(await db.select().from(schema.freeGameQueue)).toHaveLength(0);
  const duplicate=await post("/api/agent-profiles",body);
  expect(duplicate.status).toBe(201);expect((await duplicate.json() as {id:string}).id).toBe(agent.id);
  const entry={agentProfileId:agent.id,expectedSeasonId:season.id};
  expect((await post("/api/free-queue/join",entry)).status).toBe(404);
  await acceptTestAgent(db,agent.id);
  expect((await post("/api/free-queue/join",entry)).status).toBe(201);
  expect((await post("/api/free-queue/join",entry)).status).toBe(200);
  expect(await db.select().from(schema.agentProfiles)).toHaveLength(1);
  expect(await db.select().from(schema.freeGameQueue)).toHaveLength(1);
  await closeSeason(db,season.id);
  await createSeason(db,{slug:"next-entry-target",name:"Next season"});
  expect((await post("/api/free-queue/join",entry)).status).toBe(409);
  expect(await db.select().from(schema.agentProfiles)).toHaveLength(1);
  expect(await db.select().from(schema.freeGameQueue)).toHaveLength(0);
});
