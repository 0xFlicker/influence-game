import { beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { contentImageFixture, headPositionFixture } from "./content-image-fixture.js";
import { readAgentVisualUpdate, requestAgentVisualUpdate, processAgentVisualUpdate } from "../services/agent-visual-updates.js";
import { decodeVisualDetails, visualUpdateDependencies, type VisualUpdateDependencies } from "../services/agent-visual-update-generation.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";
import { createSessionToken } from "../middleware/auth.js";
import { GenerationAdmissionError } from "../services/generation-admission-error.js";
import { readAgentTransparentBodies } from "../services/agent-transparent-bodies.js";
import { storeJson, storeBinary } from "../services/payload-storage.js";
let db:DrizzleDB,userId:string,agentId:string,body:string,head:string;
let calls:string[];
let deps:VisualUpdateDependencies;
beforeEach(async()=>{
 db=await setupTestDB();userId=randomUUID();agentId=randomUUID();calls=[];
 await db.insert(schema.users).values({id:userId,displayName:"Visual fixture"});
 body=await contentImageFixture(`pfp/generated/${randomUUID()}.png`);head=await contentImageFixture(`pfp/generated/${randomUUID()}.png`);
 await db.insert(schema.agentProfiles).values({id:agentId,userId,name:"Original identity",personality:"Patient",personaKey:"strategic",strategyStyle:"Private influence strategy",werewolfStrategyStyle:"Private wolf strategy",avatarUrl:head,fullBodyReferenceUrl:body});
 deps={...visualUpdateDependencies,
 details:async()=>{calls.push("details");return {visualDesign:"Original appearance",performanceInstructions:"Calm voice"};},
 body:async()=>{calls.push("body");return body;},head:async()=>{calls.push("head");return headPositionFixture(body);},
 portrait:async()=>{calls.push("portrait");return {avatarUrl:head,portraitCrop:{sourceUrl:body,x:0,y:0,width:1,height:1}};},
 };
});
test("reads and processor do nothing before explicit action; duplicate requests converge and real save preserves identity",async()=>{
 expect((await readAgentVisualUpdate(db,userId,agentId)).job).toBeNull();await processAgentVisualUpdate(db,userId,agentId,deps);expect(calls).toEqual([]);
 const [a,b]=await Promise.all([requestAgentVisualUpdate(db,userId,agentId),requestAgentVisualUpdate(db,userId,agentId)]);expect(a.job?.id).toBe(b.job?.id);
 await Promise.all([processAgentVisualUpdate(db,userId,agentId,deps),processAgentVisualUpdate(db,userId,agentId,deps)]);
 expect(calls).toEqual(["details"]);expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("completed");
 const [saved]=await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id,agentId));
 expect(saved).toMatchObject({name:"Original identity",strategyStyle:"Private influence strategy",werewolfStrategyStyle:"Private wolf strategy",avatarUrl:head,fullBodyReferenceUrl:body,visualDesign:"Original appearance"});
 expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(1);
 await requestAgentVisualUpdate(db,userId,agentId);await processAgentVisualUpdate(db,userId,agentId,deps);expect(calls).toEqual(["details"]);
});
test("failure retains checkpoint; explicit retry reuses body and resumes missing portrait",async()=>{
 await db.update(schema.agentProfiles).set({avatarUrl:null,fullBodyReferenceUrl:null}).where(eq(schema.agentProfiles.id,agentId));
 const good=deps.portrait;deps.portrait=async()=>{calls.push("portrait-failure");throw new Error("interrupted");};
 await requestAgentVisualUpdate(db,userId,agentId);await processAgentVisualUpdate(db,userId,agentId,deps);
 expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("failed");
 await processAgentVisualUpdate(db,userId,agentId,deps);expect(calls.filter(x=>x==="body")).toHaveLength(1);
 deps.portrait=good;await requestAgentVisualUpdate(db,userId,agentId);await processAgentVisualUpdate(db,userId,agentId,deps);
 expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("completed");expect(calls).toEqual(["details","body","head","portrait-failure","portrait"]);
});
test("concurrent owner edits fence the update without overwriting",async()=>{
 await requestAgentVisualUpdate(db,userId,agentId);
 deps.details=async()=>{await db.update(schema.agentProfiles).set({name:"New name",updatedAt:"2099-01-01T00:00:00.000Z"}).where(eq(schema.agentProfiles.id,agentId));return {visualDesign:"Old details",performanceInstructions:"Old voice"};};
 await processAgentVisualUpdate(db,userId,agentId,deps);
 expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("conflict");
 expect((await db.select().from(schema.agentProfiles))[0]!.name).toBe("New name");expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(0);
});
test("lost save response replays the committed submission exactly once",async()=>{
 const apply=deps.apply;let first=true;deps.apply=async(...args)=>{const result=await apply(...args);if(first){first=false;throw new Error("response lost");}return result;};
 await requestAgentVisualUpdate(db,userId,agentId);await processAgentVisualUpdate(db,userId,agentId,deps);
 expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("completed");
 expect((await db.select().from(schema.agentVisualUpdates))[0]!.status).toBe("completed");
 // The saved profile is complete: status reads must recognize the committed receipt.
 expect((await readAgentVisualUpdate(db,userId,agentId)).needsUpdate).toBe(false);
 expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(1);
});
test("owner API is private, GET never creates work and POST resumes only its authorized job",async()=>{
 process.env.JWT_SECRET="visual-update-test";let resumes=0;
 const app=new Hono();app.route("/",createAgentProfileRoutes(db,{resumeVisualUpdate:()=>{resumes++;}}));
 const url=`/api/agent-profiles/${agentId}/visual-update`;
 expect((await app.request(url)).status).toBe(401);
 const other=randomUUID();await db.insert(schema.users).values({id:other,displayName:"Other"});
 expect((await app.request(url,{headers:{Authorization:`Bearer ${await createSessionToken(other)}`}})).status).toBe(404);
 const headers={Authorization:`Bearer ${await createSessionToken(userId)}`};
 expect((await app.request(url,{headers})).status).toBe(200);expect(resumes).toBe(0);
 const response=await app.request(url,{method:"POST",headers});expect(response.status).toBe(200);expect(resumes).toBe(1);
 expect(await response.text()).not.toContain("Private influence strategy");
});
test("transparent body lookup matches current image, never an old revision body, and creates no cutouts",async()=>{
 const hash="a".repeat(64),revision=randomUUID();
 await db.insert(schema.agentContentAssets).values({hash,bytes:await storeBinary(Buffer.from("fixture")),transparentUrl:"/characters/cutout.png"});
 await db.insert(schema.agentContentRevisions).values({id:revision,agentProfileId:agentId,userId,fingerprint:"test",snapshot:await storeJson({assets:{[body]:hash}})});
 await db.update(schema.agentProfiles).set({contentRevisionId:revision}).where(eq(schema.agentProfiles.id,agentId));
 const profiles=await db.select().from(schema.agentProfiles);expect((await readAgentTransparentBodies(db,profiles)).get(agentId)).toBe("/characters/cutout.png");
 expect((await readAgentTransparentBodies(db,[{...profiles[0]!,fullBodyReferenceUrl:"/different.png"}])).get(agentId)).toBeNull();
 expect(await db.select().from(schema.characterCutouts)).toHaveLength(0);
});
test("strict details decoder accepts complete fenced JSON but rejects extra keys and empty values",()=>{
 expect(decodeVisualDetails('```json\n{"visualDesign":"Blue robot","performanceInstructions":"Calm voice"}\n```').visualDesign).toBe("Blue robot");
 expect(()=>decodeVisualDetails('{"visualDesign":"x","performanceInstructions":"y","strategy":"override"}')).toThrow();
 expect(()=>decodeVisualDetails('{"visualDesign":" ","performanceInstructions":"y"}')).toThrow();
});

test("expired processing leases resume the authorized job after interruption",async()=>{
 const requested=await requestAgentVisualUpdate(db,userId,agentId);
 await db.update(schema.agentVisualUpdates).set({status:"processing",leaseId:"abandoned",leaseUntil:"2000-01-01T00:00:00.000Z"}).where(eq(schema.agentVisualUpdates.id,requested.job!.id));
 await processAgentVisualUpdate(db,userId,agentId,deps);
 expect((await readAgentVisualUpdate(db,userId,agentId)).job?.status).toBe("completed");expect(calls).toEqual(["details"]);
});
test("a lost lease cannot checkpoint or save over its successor",async()=>{
 const requested=await requestAgentVisualUpdate(db,userId,agentId);
 deps.details=async()=>{await db.update(schema.agentVisualUpdates).set({leaseId:"successor",leaseUntil:"2099-01-01T00:00:00.000Z"}).where(eq(schema.agentVisualUpdates.id,requested.job!.id));return {visualDesign:"Old worker",performanceInstructions:"Old voice"};};
 await processAgentVisualUpdate(db,userId,agentId,deps);
 const [job]=await db.select().from(schema.agentVisualUpdates);expect(job?.leaseId).toBe("successor");expect(job?.stage).toBe("details");
 expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(0);
});

test("existing account admission failures retain their truthful reason",async()=>{
 deps.details=async()=>{throw new GenerationAdmissionError("generation_busy","Another generation is still running",429);};
 await requestAgentVisualUpdate(db,userId,agentId);await processAgentVisualUpdate(db,userId,agentId,deps);
 const result=await readAgentVisualUpdate(db,userId,agentId);expect(result.job?.errorCode).toBe("generation_busy");expect(result.job?.message).toContain("Another generation");
 expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(0);
});
