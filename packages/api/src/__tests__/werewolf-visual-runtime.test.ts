import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { advanceWerewolf, replayWerewolf, nextWerewolfStep, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore, readWerewolfEvents } from "../services/werewolf-games.js";
import { readWerewolfProduction, WEREWOLF_AUTO_PUBLISHER } from "../services/werewolf-production.js";
import { createWerewolfVisualPreparation as createPreparation } from "../services/werewolf-visual-runtime.js";
import { acceptVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { readWerewolfWatch, readWerewolfPresentation } from "../services/werewolf-presentation.js";
const createWerewolfVisualPreparation = (...[db, gameId, owner, signal, render]: Parameters<typeof createPreparation>) => createPreparation(db, gameId, owner, signal, render, async (_db, _game, plan) => plan);
let db: DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();await db.insert(schema.users).values({id:"owner"});});
async function fixture(preset: "one_wolf" | "two_wolves" = "two_wolves") {
  const game=await createWerewolfGame(db,"owner",{preset,maxDays:1,agentProfileIds:[]});
  const claim=await claimWerewolfGame(db,game.id);
  if(!claim.ok)throw new Error(claim.error);
  const store=createWerewolfStore(db,game.id,claim.claim.ownerEpoch);
  const controller=new AbortController();
  return {game,store,controller,epoch:claim.claim.ownerEpoch};
}
const agent:WerewolfAgent={async decide({request}){
  if(request.action==="open_thread")return {kind:"opening",text:null,cue:null,recipientIds:[]};
  if(request.legalTargetIds.length)return {kind:"target",targetId:request.legalTargetIds[0]!,thinking:"Fixture"};
  return {kind:"speech",text:"Fixture contribution",cue:null};
}};

test("automatic scenes publish once, recover without another render, and respect Mystery pack boundaries",async()=>{
  const f=await fixture();let renders=0;
  const render:NonNullable<Parameters<typeof createWerewolfVisualPreparation>[4]>=async(db,scene,guard)=>{
    if(scene.status==="ready")return scene;
    renders++;
    const image=await sharp({create:{width:160,height:90,channels:3,background:scene.roomId === "lobby" ? "#445566" : "#665544"}}).png().toBuffer();
    const id=await storeVisualArtifact(db,f.game.id,image);
    return acceptVisualScene(db,{sceneId:scene.id,planHash:scene.planHash,imageArtifactId:id,anchors:[],verifiedParticipantIds:scene.plan.cast.map(p=>p.id),assertBoundary:guard});
  };
  let prepare=createWerewolfVisualPreparation(db,f.game.id,f.epoch,f.controller.signal,render);
  const original=f.store.prepare!;
  f.store.prepare=async(state,request,sequence)=>{await original(state,request,sequence);await prepare(state,request);};
  await advanceWerewolf(f.store,agent);
  expect(renders).toBe(0);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
  await advanceTo(f, "pack_talk");
  await advanceWerewolf(f.store,agent);
  expect(renders).toBe(1);
  const state=replayWerewolf(await f.store.read()),step=nextWerewolfStep(state);
  if(step.kind!=="action")throw new Error("Expected next pack contribution");
  // A restarted process reuses the same pack scene.
  prepare=createWerewolfVisualPreparation(db,f.game.id,f.epoch,f.controller.signal,render);
  await prepare(state,step.request);
  expect(renders).toBe(1);
  await advanceTo(f, "open_thread");
  const living=replayWerewolf(await f.store.read()).aliveIds;
  await advanceWerewolf(f.store,agent);
  expect(renders).toBe(2);
  const [lobby]=await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.roomId,"lobby"));
  expect(lobby!.plan.cast.map(p=>p.id)).toEqual(living);
  const publications=await db.select().from(schema.visualMediaPublications);
  expect(publications).toHaveLength(2);
  expect(publications.every(p=>p.operatorId===WEREWOLF_AUTO_PUBLISHER&&p.revision===1)).toBe(true);
  // A live session opened before either image was ready still receives original scenes.
  const cutoff="2000-01-01T00:00:00.000Z";
  const omni=await readWerewolfWatch(db,f.game.id,"omniscient",1,64,cutoff);
  expect(Object.values(omni.media).some(s=>s.roomId==="mingle-1")).toBe(true);
  const mystery=await readWerewolfWatch(db,f.game.id,"mystery",1,64,cutoff);
  expect(Object.values(mystery.media).some(s=>s.roomId==="lobby")).toBe(true);
  expect(mystery.moments.filter(m=>m.entry.day===0).every(m=>m.mediaKey===null)).toBe(true);
  expect((await readWerewolfPresentation(db,f.game.id,"mystery",2)).presentation.scene).toBeNull();
  expect(Object.values(mystery.media).some(s=>s.roomId==="mingle-1")).toBe(false);
  const routes=(await import("../routes/werewolf.js")).createWerewolfRoutes(db);
  const pack=Object.values(omni.media).find(s=>s.roomId==="mingle-1")!;
  expect((await routes.request(pack.imageUrl.replace("audience=omniscient","audience=mystery"))).status).toBe(404);
});

test("aborted preparation cannot publish or commit a fallback contribution",async()=>{
  const f=await fixture();
  const prepare=createWerewolfVisualPreparation(db,f.game.id,f.epoch,f.controller.signal,async()=>{f.controller.abort();throw new Error("stopped");});
  await advanceTo(f,"pack_talk");
  const before=await readWerewolfEvents(db,f.game.id);
  const state=replayWerewolf(before),step=nextWerewolfStep(state);
  if(step.kind!=="action")throw new Error("Expected introduction");
  await expect(prepare(state,step.request)).rejects.toThrow();
  expect(await db.select().from(schema.visualMediaPublications)).toHaveLength(0);
  expect(await readWerewolfEvents(db,f.game.id)).toEqual(before);
});

test("missing renderer continues with character art and does not retry each speech",async()=>{
  const f=await fixture();let attempts=0;
  const prepare=createWerewolfVisualPreparation(db,f.game.id,f.epoch,f.controller.signal,async()=>{attempts++;throw new Error("Renderer unavailable");});
  await advanceTo(f,"pack_talk");
  const state=replayWerewolf(await f.store.read()),step=nextWerewolfStep(state);
  if(step.kind!=="action")throw new Error("Expected pack turn");
  await prepare(state,step.request);await prepare(state,step.request);
  expect(attempts).toBe(1);
  expect(await db.select().from(schema.visualMediaPublications).where(eq(schema.visualMediaPublications.gameId,f.game.id))).toHaveLength(0);
});

async function advanceTo(f: Awaited<ReturnType<typeof fixture>>, action: "pack_talk" | "open_thread" | "attack") {
  for (let n=0;n<100;n++) {
    const state=replayWerewolf(await f.store.read()), step=nextWerewolfStep(state);
    if(step.kind==="action" && step.request.action===action)return;
    await advanceWerewolf(f.store,agent);
  }
  throw new Error(`Never reached ${action}`);
}

for (const protectedTarget of [true,false]) test(`first daytime lobby uses ${protectedTarget ? "the full protected cast" : "only night survivors"}`,async()=>{
  const f=await fixture();let target:string|null=null;
  const nightAgent:WerewolfAgent={async decide(input){
    if(input.request.action==="attack")target=input.request.legalTargetIds[0]!;
    if(input.request.action==="protect")return {kind:"target",targetId:protectedTarget ? target : input.request.legalTargetIds.find(id=>id!==target)!,thinking:"Fixture protection"};
    return agent.decide(input);
  }};
  for(let n=0;n<100;n++){
    const step=nextWerewolfStep(replayWerewolf(await f.store.read()));
    if(step.kind==="action" && step.request.action==="open_thread")break;
    await advanceWerewolf(f.store,nightAgent);
  }
  const state=replayWerewolf(await f.store.read()),step=nextWerewolfStep(state);
  if(step.kind!=="action" || step.request.action!=="open_thread")throw new Error("Expected first day opening");
  expect(state.aliveIds).toHaveLength(protectedTarget ? 8 : 7);
  const prepare=createWerewolfVisualPreparation(db,f.game.id,f.epoch,f.controller.signal,async(db,scene,guard)=>{
    expect(scene.plan.cast.map(p=>p.id)).toEqual(state.aliveIds);
    const bytes=await sharp({create:{width:160,height:90,channels:3,background:"#445566"}}).png().toBuffer();
    const id=await storeVisualArtifact(db,f.game.id,bytes);
    return acceptVisualScene(db,{sceneId:scene.id,planHash:scene.planHash,imageArtifactId:id,anchors:[],verifiedParticipantIds:state.aliveIds,assertBoundary:guard});
  });
  await prepare(state,step.request);
  await advanceWerewolf(f.store,nightAgent);
  const inventory=await readWerewolfProduction(db,f.game.id,f.game.slug);
  expect(inventory.scenes.every(s=>s.round>0)).toBe(true);
  expect(inventory.scenes.find(s=>s.roomId==="lobby")!.participants.map(p=>p.id)).toEqual(state.aliveIds);
  if(protectedTarget){
    // Simulate a previously published full-roster introduction image. It may
    // still serve daytime discussion, but must never replace solo introductions.
    await db.update(schema.visualScenes).set({boundarySequence:0}).where(eq(schema.visualScenes.gameId,f.game.id));
    for(const audience of ["mystery","omniscient"] as const){
      const watch=await readWerewolfWatch(db,f.game.id,audience,1,64);
      expect(watch.moments.filter(m=>m.entry.day===0).every(m=>m.mediaKey===null)).toBe(true);
      expect(Object.values(watch.media)).toHaveLength(1);
      const intro=await readWerewolfPresentation(db,f.game.id,audience,2);
      expect(intro.presentation.scene).toBeNull();expect(intro.permitted.size).toBe(0);
    }
  }
});


test("a lone wolf prepares a form before targeting without creating a meeting scene", async () => {
  const f = await fixture("one_wolf");
  await advanceTo(f, "attack");
  const state = replayWerewolf(await f.store.read()), step = nextWerewolfStep(state);
  if (step.kind !== "action") throw new Error("Expected attack");
  const forms: string[][] = [];
  const prepare = createPreparation(db, f.game.id, f.epoch, f.controller.signal,
    async () => { throw new Error("Must not render a lone-wolf meeting"); },
    async (_db, _game, plan) => { forms.push(plan.cast.map(member => member.id)); return plan; });
  await prepare(state, step.request);
  await prepare(state, step.request);
  expect(forms).toEqual([[step.request.actorId]]);
  expect(await db.select().from(schema.visualScenes)).toHaveLength(0);
});
