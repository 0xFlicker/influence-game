import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {drizzle} from "drizzle-orm/postgres-js";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { readProductionScene, readProductionScenes } from "../services/production-scenes.js";
import {readProductionRecovery} from "../services/production-recovery.js";
import { sha256StableJson } from "../services/stable-hash.js";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });

test("game recovery receipts are bounded and omit scene evidence, image bytes and request prompts",async () => {
  const gameId=await fixture();
  for(const [id,sceneId] of [["a",null],["b",null],["scene-attempt","scene-0"]] as const) {
    await db.insert(schema.visualRenderOperations).values({id:`operation-${id}`,gameId,sceneId,operationKey:`wolf-form:${id}`,inputHash:"PRIVATE_HASH",request:{prompt:"SECRET_PROVIDER_PROMPT"}});
    await db.insert(schema.visualRenderAttempts).values({id,operationId:`operation-${id}`,generation:1,provider:"openai",model:"fixture",requestHash:"PRIVATE_REQUEST_HASH"});
  }
  const first=await readProductionRecovery(db,gameId,0,1);
  expect(first.attempts).toHaveLength(1);expect(first.nextOffset).toBe(1);expect(first.recovery).toBeNull();
  const second=await readProductionRecovery(db,gameId,1,1);
  expect(second.attempts).toHaveLength(1);expect(second.nextOffset).toBeNull();
  expect(new Set([...first.attempts,...second.attempts].map(attempt=>attempt.id))).toEqual(new Set(["a","b"]));
  expect(JSON.stringify(first)).not.toMatch(/SECRET_|PRIVATE_|scene-attempt|imageHash|"request"/);
  await expect(readProductionRecovery(db,gameId,0,51)).rejects.toThrow("1 to 50");
  await db.update(schema.games).set({gameKind:"werewolf",status:"in_progress"}).where(eq(schema.games.id,gameId));
  expect(await readProductionRecovery(db,gameId)).toMatchObject({status:"in_progress",recovery:null});
});

async function fixture() {
  const gameId = "scene-metadata";
  await db.insert(schema.games).values({ id: gameId, slug: gameId, status: "completed", config: "{}" });
  await db.insert(schema.visualArtifacts).values({ id: "artifact", gameId, contentHash: "fixture", image: Buffer.from("PRIVATE_IMAGE_BYTES"), width: 1, height: 1 });
  for (const [index, roomId] of ["lobby", "mingle-1"].entries()) {
    if (roomId !== "lobby" && roomId !== "mingle-1") throw new Error("Invalid fixture room");
    const plan = planVisualScene({ roomId, backgroundArtifactId: null, cast: [{ id: "player", name: "Fixture", referenceArtifactId: "artifact", performanceInstructions: "SECRET_RENDER_PROMPT" }] });
    await db.insert(schema.visualScenes).values({ id: `scene-${index}`, gameId, roomId, boundarySequence: index, plan, planHash: sha256StableJson(plan), status: "ready", imageArtifactId: "artifact", annotatedArtifactId: "artifact", anchors: [] });
  }
  return gameId;
}

test("scene index is bounded metadata and detail selects an exact game-owned version", async () => {
  const gameId = await fixture();
  const first = await readProductionScenes(db, gameId, { limit: 1, audience: "public" });
  expect(first.items).toHaveLength(1); expect(first.total).toBe(2); expect(first.nextOffset).toBe(1);
  const second = await readProductionScenes(db, gameId, { offset: first.nextOffset!, limit: 1 });
  expect(second.items).toHaveLength(1); expect(second.nextOffset).toBeNull();
  expect(new Set([...first.items, ...second.items].map(scene => scene.key)).size).toBe(2);
  expect(JSON.stringify(first)).not.toMatch(/SECRET_|plan|cast|bytes|base64|artifact|provider|requestHash/);
  const plan = (await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id, "scene-0")))[0]!.plan;
  await db.insert(schema.visualMediaVersions).values({ id: "version", gameId, sceneId: "scene-0", version: 1, plan, imageArtifactId: "artifact", annotatedArtifactId: "artifact", verificationVersion: "fixture", localization: { count: 1, verifiedParticipantIds: ["player"], anchors: [] }, createdAt: "2026-09-01T00:00:00.000Z" });
  const detail = await readProductionScene(db, gameId, first.items[0]!.key, { versionId: "original:scene-0", limit: 1 });
  expect(detail.scene.sceneId).toBe("scene-0"); expect(detail.selectedVersion!.version).toBe(0);
  expect(detail.media.versions.some(version => version.id === "original:scene-0")).toBe(true);
  expect(detail.media.versions.every(version => version.sceneId === "scene-0")).toBe(true);
  expect(JSON.stringify(detail)).not.toMatch(/SECRET_|performanceInstructions|backgroundArtifactId|placements|image\/png;base64|PRIVATE_IMAGE_BYTES|"bytes"/);
  await expect(readProductionScene(db, gameId, first.items[0]!.key, { versionId: "original:scene-1" })).rejects.toThrow("for this scene");
  await expect(readProductionScenes(db, gameId, { limit: 51 })).rejects.toThrow("1 to 50");
  await expect(readProductionScenes(db, gameId, { audience: "omniscient" })).rejects.toThrow("audience");
});

test("bounded scene receipts retain the complete exact uncertain-attempt acknowledgement set", async () => {
  const gameId = await fixture();
  const index = await readProductionScenes(db, gameId);
  for (const id of ["old-uncertain", "new-uncertain"]) {
    await db.insert(schema.visualRenderOperations).values({ id: `${id}-operation`, gameId, sceneId: "scene-0", operationKey: `scene-0:render:${id}`, inputHash: "PRIVATE_HASH", request: { prompt: "SECRET_PROVIDER_PROMPT", references: ["BASE64_PRIVATE_CAST"] } });
    await db.insert(schema.visualRenderAttempts).values({ id, operationId: `${id}-operation`, generation: 1, provider: "openai", model: "fixture", requestHash: "PRIVATE_REQUEST_HASH" });
  }
  const detail = await readProductionScene(db, gameId, index.items[0]!.key, { limit: 1 });
  expect(detail.attempts).toHaveLength(1);
  expect(new Set(detail.uncertainAttemptIds)).toEqual(new Set(["old-uncertain", "new-uncertain"]));
  expect(detail.pages.nextAttemptOffset).toBe(1);
  expect(JSON.stringify(detail)).not.toMatch(/SECRET_|BASE64_PRIVATE_CAST|PRIVATE_REQUEST_HASH|PRIVATE_HASH|"request"|"usage"/);
  await db.insert(schema.visualMediaRequests).values({ id: "ack", gameId, operatorId: "operator", requestId: "ack-request", inputHash: "hash", input: { action: "regenerate", sceneId: "scene-0", acknowledgeUncertainAttempts: ["old-uncertain"], private: "SECRET_REQUEST_EXTRA" }, receipt: { accepted: true, code: "queued", message: "Fixture accepted" }, createdAt: "2026-09-01T00:00:00.000Z" });
  const acknowledged = await readProductionScene(db, gameId, index.items[0]!.key, { limit: 1 });
  expect(acknowledged.uncertainAttemptIds).toEqual(["new-uncertain"]);
  expect(acknowledged.media.requests[0]!.input.acknowledgeUncertainAttempts).toEqual(["old-uncertain"]);
  expect(JSON.stringify(acknowledged)).not.toContain("SECRET_REQUEST_EXTRA");
});

test("Mystery scene discovery and handcrafted scene keys reject canonical pack and hunt evidence", async () => {
  const gameId = "private-scene-catalog", events = await werewolfResultsFixture("saved", gameId, 2);
  await db.insert(schema.games).values({ id: gameId, slug: gameId, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId, sequence: event.sequence, event })));
  const omniscient = await readProductionScenes(db, gameId, { audience: "omniscient", limit: 50 });
  const privateScene = omniscient.items.find(scene => scene.purpose === "pack" || scene.purpose === "hunt")!;
  expect(privateScene).toBeDefined();
  const mystery = await readProductionScenes(db, gameId, { audience: "mystery", limit: 50 });
  expect(mystery.items.every(scene => scene.purpose === "village" && scene.audience === "public")).toBe(true);
  expect(mystery.total).toBeLessThan(omniscient.total);
  expect(JSON.stringify(mystery)).not.toMatch(/SECRET_|wolfIds|"pack"|"hunt"/);
  await expect(readProductionScene(db, gameId, privateScene.key, { audience: "mystery" })).rejects.toThrow("not found");
  expect((await readProductionScene(db, gameId, privateScene.key, { audience: "omniscient" })).scene.key).toBe(privateScene.key);
});

test("more than 100 uncertain requests preserves bounded receipt pages for reconciliation",async () => {
  const gameId=await fixture(),operationId="many-uncertain-operation";
  await db.insert(schema.visualRenderOperations).values({id:operationId,gameId,sceneId:"scene-0",operationKey:"scene-0:render:many",inputHash:"PRIVATE_HASH",request:{prompt:"SECRET_PROMPT"}});
  await db.insert(schema.visualRenderAttempts).values(Array.from({length:101},(_,index)=>({id:`uncertain-${String(index).padStart(3,"0")}`,operationId,generation:index+1,provider:"openai" as const,model:"fixture",requestHash:"PRIVATE_HASH"})));
  const scene=(await readProductionScenes(db,gameId)).items[0]!,detail=await readProductionScene(db,gameId,scene.key,{offset:50,limit:2});
  expect(detail.requiresReconciliation).toBe(true);expect(detail.uncertainAttemptIds).toHaveLength(100);
  expect(detail.uncertainAttemptIds[0]).toBe("uncertain-000");expect(detail.uncertainAttemptIds.at(-1)).toBe("uncertain-099");
  expect(detail.attempts).toHaveLength(2);expect(detail.pages.nextAttemptOffset).toBe(52);expect(detail.selectedVersion?.version).toBe(0);
  expect(JSON.stringify(detail)).not.toMatch(/SECRET_|PRIVATE_HASH/);
});

test("scene SQL reads scope and page metadata while exact selected and current publication versions remain inspectable",async () => {
  const gameId=await fixture(),plan=(await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id,"scene-0")))[0]!.plan;
  for (const sceneId of ["scene-0","scene-1"]) {
    await db.insert(schema.visualRepairJobs).values(Array.from({length:60},(_,index)=>({id:`${sceneId}-job-${index+1}`,gameId,sceneId,version:index+1,operatorId:"operator",mode:"review" as const,plan,
      renderContext:{style:"SECRET_STYLE",roomName:"Fixture",roomDirection:"SECRET_DIRECTION"},status:"ready" as const,createdAt:"2026-09-01T00:00:00.000Z"})));
    await db.insert(schema.visualMediaVersions).values(Array.from({length:60},(_,index)=>({id:`${sceneId}-version-${index+1}`,gameId,sceneId,jobId:`${sceneId}-job-${index+1}`,version:index+1,plan,
      imageArtifactId:"artifact",annotatedArtifactId:"artifact",localization:{count:1,verifiedParticipantIds:["player"],anchors:[]},verificationVersion:"fixture",createdAt:"2026-09-01T00:00:00.000Z"})));
    await db.insert(schema.visualMediaRequests).values(Array.from({length:60},(_,index)=>({id:`${sceneId}-request-${index+1}`,gameId,operatorId:"operator",requestId:`${sceneId}-${index+1}`,inputHash:"PRIVATE_HASH",
      input:{sceneId,action:"review",review:{images:"BASE64_PRIVATE_CAST",private:"SECRET_REQUEST"}},receipt:{accepted:true,code:"reviewed",message:"Fixture"},createdAt:"2026-09-01T00:00:00.000Z"})));
  }
  await db.insert(schema.visualMediaPublications).values([
    {id:"public-old",gameId,sceneId:"scene-0",versionId:"scene-0-version-1",revision:1,audience:"public",operatorId:"operator",createdAt:"2026-09-01T00:00:00.000Z"},
    {id:"private-old",gameId,sceneId:"scene-0",versionId:"scene-0-version-2",revision:2,audience:"private",operatorId:"operator",createdAt:"2026-09-01T00:00:00.000Z"},
    {id:"public-published",gameId,sceneId:"scene-0",versionId:"scene-0-version-3",revision:3,audience:"public",operatorId:"operator",createdAt:"2026-09-01T00:00:00.000Z"},
    {id:"private-published",gameId,sceneId:"scene-0",versionId:"scene-0-version-4",revision:4,audience:"private",operatorId:"operator",createdAt:"2026-09-01T00:00:00.000Z"},
  ]);
  const queries:{query:string;params:unknown[]}[]=[],logged=drizzle(db.$client,{schema,logger:{logQuery(query,params){queries.push({query,params});}}});
  const index=await readProductionScenes(logged,gameId,{limit:1});
  expect(index.items[0]).toMatchObject({sceneId:"scene-0",latestVersion:60,publishedVersion:3});
  expect(queries.some(({query})=>/from "visual_media_requests"|from "visual_render_attempts"/.test(query))).toBe(false);
  const summaryQueries=queries.filter(({query})=>/from "visual_repair_jobs"|from "visual_media_publications"/.test(query));
  expect(summaryQueries.length).toBeGreaterThan(0);
  expect(summaryQueries.every(({query,params})=>query.includes("limit") && params.includes("scene-0") && !params.includes("scene-1"))).toBe(true);
  queries.length=0;
  const detail=await readProductionScene(logged,gameId,index.items[0]!.key,{offset:30,limit:2,versionId:"scene-0-version-1"});
  expect(detail.selectedVersion?.id).toBe("scene-0-version-1");
  expect(new Set(detail.media.versions.map(version=>version.id))).toEqual(new Set(["scene-0-version-30","scene-0-version-29","scene-0-version-1","scene-0-version-3","scene-0-version-4"]));
  expect(detail.media.jobs).toHaveLength(2);expect(detail.media.requests).toHaveLength(2);expect(detail.pages.nextVersionOffset).toBe(32);
  expect(JSON.stringify(detail)).not.toMatch(/SECRET_|BASE64_PRIVATE_CAST|PRIVATE_HASH|scene-1-/);
  const evidenceQueries=queries.filter(({query})=>/from "visual_media_versions"|from "visual_repair_jobs"|from "visual_media_publications"|from "visual_media_requests"|from "visual_render_attempts"/.test(query));
  expect(evidenceQueries.every(({query,params})=>params.includes("scene-0") && (query.includes("limit") || query.includes("count(*)")))).toBe(true);
  expect(queries.every(({query})=>!query.includes('"visual_render_operations"."request"') && !query.includes('"visual_render_attempts"."image"') && !query.includes('"visual_render_attempts"."request_hash"'))).toBe(true);
  const original=await readProductionScene(logged,gameId,index.items[0]!.key,{offset:60,limit:1,versionId:"original:scene-0"});
  expect(original.selectedVersion?.version).toBe(0);expect(original.media.versions.some(version=>version.version===0)).toBe(true);expect(original.pages.nextVersionOffset).toBeNull();
  const older=await readProductionScene(logged,gameId,index.items[0]!.key,{offset:2,limit:1});
  expect(older.media.publications).toHaveLength(3);
  expect(older.media.publications.find(publication=>publication.audience==="public")).toMatchObject({versionId:"scene-0-version-3",revision:3});
  expect(older.media.publications.find(publication=>publication.audience==="private")).toMatchObject({versionId:"scene-0-version-4",revision:4});
  expect(older.pages.nextPublicationOffset).toBe(3);
});

test("scene uncertainty SQL includes historical job bindings outside the page and excludes live/acknowledged/foreign attempts",async () => {
  const gameId=await fixture(),plan=(await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id,"scene-0")))[0]!.plan;
  await db.insert(schema.visualRepairJobs).values([
    {id:"old-job",gameId,sceneId:"scene-0",version:1,operatorId:"operator",mode:"regenerate",plan,renderContext:{style:"Fixture",roomName:"Fixture",roomDirection:"Fixture"},status:"failed",createdAt:"2026-09-01T00:00:00.000Z"},
    {id:"running-job",gameId,sceneId:"scene-0",version:2,operatorId:"operator",mode:"regenerate",plan,renderContext:{style:"Fixture",roomName:"Fixture",roomDirection:"Fixture"},status:"rendering",leaseUntil:"2999-01-01T00:00:00.000Z",createdAt:"2026-09-01T00:00:00.000Z"},
  ]);
  for (const [id,sceneId,repairJobId,operationKey] of [
    ["old-prefix",null,null,"media:old-job:render"],["old-job-binding",null,"old-job","historical-binding"],
    ["live",null,"running-job","pending-binding"],["foreign","scene-1",null,"scene-1:render:1"],
    ["acknowledged","scene-0",null,"scene-0:render:ack"],
  ] as const) {
    await db.insert(schema.visualRenderOperations).values({id:`operation-${id}`,gameId,sceneId,repairJobId,operationKey,inputHash:"PRIVATE_HASH",request:{prompt:"SECRET_PROMPT"}});
    await db.insert(schema.visualRenderAttempts).values({id,operationId:`operation-${id}`,generation:1,provider:"openai",model:"fixture",requestHash:"PRIVATE_REQUEST_HASH"});
  }
  await db.insert(schema.visualMediaRequests).values({id:"old-ack",gameId,operatorId:"operator",requestId:"old-ack",inputHash:"hash",input:{sceneId:"scene-0",action:"regenerate",acknowledgeUncertainAttempts:["acknowledged"]},receipt:{accepted:true,code:"queued",message:"Fixture"},createdAt:"2026-09-01T00:00:00.000Z"});
  const index=await readProductionScenes(db,gameId),detail=await readProductionScene(db,gameId,index.items[0]!.key,{offset:2,limit:1});
  expect(detail.attempts).toHaveLength(1);expect(detail.pages.nextAttemptOffset).toBe(3);
  expect(new Set(detail.uncertainAttemptIds)).toEqual(new Set(["old-prefix","old-job-binding"]));
  expect(JSON.stringify(detail)).not.toMatch(/SECRET_|PRIVATE_|"foreign"/);
});
