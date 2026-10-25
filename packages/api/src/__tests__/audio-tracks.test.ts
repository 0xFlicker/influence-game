import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { HOUSE_VOICE, assignPlayerVoice } from "@influence/engine/voice-catalog";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { storeJson, readPayload } from "../services/payload-storage.js";
import { audioRecipe, audioSourceHash, type AudioSourceManifest } from "../services/audio-source.js";
import { sha256StableJson } from "../services/stable-hash.js";
import { runAudioTrack, retryAudioTrack } from "../services/audio-tracks.js";
import { AudioProviderFailure, type AudioProvider } from "../services/audio-provider.js";
import { audioRange, readAudioPublication, readPublishedAudioBytes } from "../services/audio-publication.js";
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function fixture() {
  const gameId = "audio-fixture";
  await db.insert(schema.games).values({ id: gameId, slug: gameId, gameKind: "werewolf", status: "completed", config: '{"visibility":"public"}' });
  const voices = { house: HOUSE_VOICE, player: assignPlayerVoice("agent", "female", "ara") };
  const source: AudioSourceManifest = { version: 1, gameId, throughEventSequence: 20, lines: [
    { momentId: "speech", speakerId: "player", text: "I saw a wolf.", synthesisText: "<soft>I saw a wolf.</soft>", context: "speech", eventSequence: 10, audiences: ["mystery", "omniscient"] },
    { momentId: "thought", speakerId: "player", text: "I should tell them.", synthesisText: "<higher-pitch>I should tell them.</higher-pitch>", context: "thinking", eventSequence: 10, audiences: ["omniscient"] },
  ] };
  const [track] = await db.insert(schema.gameAudioTracks).values({ gameId, mode: "backfill", voices: await storeJson(voices), manifest: await storeJson(source), budgetUsd: 1, throughEventSequence: 20 }).returning();
  for (const line of source.lines) {
    const recipe = audioRecipe(line, voices.player);
    await db.insert(schema.gameAudioClips).values({ trackId: track!.id, momentId: line.momentId, sourceHash: audioSourceHash(line), recipeHash: sha256StableJson(recipe), recipe: await storeJson(recipe) });
  }
  return track!;
}
const success: AudioProvider = async recipe => ({ bytes: new TextEncoder().encode(`mock MP3 ${recipe.synthesisText}`), durationMs: 1234, evidence: { status: 200 } });
test("complete tracks publish durable bytes with audience and thinking filtering", async () => {
  const track = await fixture();
  expect(await readAudioPublication(db, track.gameId, "omniscient", true)).toBeNull();
  expect(await runAudioTrack(db, success)).toBe(true);
  expect(await runAudioTrack(db, success)).toBe(false);
  const full = await readAudioPublication(db, track.gameId, "omniscient", true, true);
  expect(full?.clips).toHaveLength(2);
  expect((await readAudioPublication(db, track.gameId, "mystery", false, true))?.clips.map(c => c.momentId)).toEqual(["speech"]);
  const thought = full!.clips.find(c => c.momentId === "thought")!;
  expect(await readPublishedAudioBytes(db, track.gameId, thought.versionId, "mystery", false)).toBeNull();
  expect(await readPublishedAudioBytes(db, track.gameId, thought.versionId, "omniscient", false)).toBeNull();
  expect(await readPublishedAudioBytes(db, track.gameId, thought.versionId, "omniscient", true)).not.toBeNull();
  const [version] = await db.select().from(schema.gameAudioVersions);
  expect(version!.audio.storage).toBe("private-payload-v1");
  expect((await readPayload(version!.audio)).length).toBeGreaterThan(0);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, track.gameId));
  expect(await readPublishedAudioBytes(db, track.gameId, thought.versionId, "omniscient", true)).toBeNull();
});
test("terminal failure preserves ready clips and explicit retry generates only missing audio", async () => {
  const track = await fixture(); let calls = 0;
  await runAudioTrack(db, async recipe => { if (++calls === 2) throw new AudioProviderFailure("unavailable", false, { status: 400 }); return success(recipe); });
  expect((await db.select().from(schema.gameAudioVersions))).toHaveLength(1);
  expect(await readAudioPublication(db, track.gameId, "omniscient", true)).toBeNull();
  expect((await db.select().from(schema.games))[0]!.status).toBe("completed");
  await retryAudioTrack(db, track.gameId, track.id);
  await runAudioTrack(db, async recipe => { calls++; return success(recipe); });
  expect(calls).toBe(3);
  expect((await db.select().from(schema.gameAudioVersions))).toHaveLength(2);
});
test("unknown dispatch after lease expiry does not automatically spend again", async () => {
  const track = await fixture();
  await db.update(schema.gameAudioTracks).set({ status: "running", leaseId: crypto.randomUUID(), leaseExpiresAt: new Date(0) }).where(eq(schema.gameAudioTracks.id, track.id));
  await db.update(schema.gameAudioClips).set({ status: "generating", attempts: 1 }).where(eq(schema.gameAudioClips.trackId, track.id));
  let calls = 0; await runAudioTrack(db, async recipe => { calls++; return success(recipe); });
  expect(calls).toBe(0);
  expect((await db.select().from(schema.gameAudioTracks))[0]!.status).toBe("failed");
});
test("concurrent workers cannot dispatch the same track", async () => {
  const track = await fixture(); let release!: () => void; let enter!: () => void;
  const entered = new Promise<void>(r => { enter = r; }); const gate = new Promise<void>(r => { release = r; });
  const first = runAudioTrack(db, async recipe => { enter(); await gate; return success(recipe); });
  await entered;
  expect(await runAudioTrack(db, success)).toBe(false);
  release(); await first;
  expect((await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id, track.id)))[0]!.status).toBe("ready");
});
test("single byte ranges support offsets, suffixes and reject malformed requests", () => {
  expect(audioRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
  expect(audioRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  expect(audioRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
  for (const range of ["bytes=-0", "bytes=20-", "bytes=4-2", "bytes=0-2,4-5", "bytes=-"]) expect(audioRange(range, 10)).toBeNull();
});

test("real Werewolf production moments produce a complete frozen audio backfill", async () => {
  const { completedWerewolfResultsFixture } = await import("@influence/engine/fixtures/werewolf-results");
  const { previewAudioTrack, queueAudioBackfill } = await import("../services/audio-tracks.js");
  const gameId = "audio-source-wolf", events = await completedWerewolfResultsFixture("saved",gameId,2);
  await db.insert(schema.users).values({id:"producer"});
  await db.insert(schema.games).values({id:gameId,slug:gameId,gameKind:"werewolf",status:"completed",startedAt:"2026-10-24T00:00:00.000Z",config:"{}"});
  await db.insert(schema.werewolfEvents).values(events.map(event => ({gameId,sequence:event.sequence,event})));
  const preview = await previewAudioTrack(db,gameId);
  expect(preview.source.lines.length).toBeGreaterThan(1);
  expect(preview.voices.house!.voiceId).toBe("helios");
  expect(Object.entries(preview.voices).filter(([id]) => id !== "house").every(([,voice]) => voice.voiceId !== "helios")).toBe(true);
  expect((await db.select().from(schema.gameAudioTracks))).toHaveLength(0);
  await expect(queueAudioBackfill(db,gameId,"producer","stale")).rejects.toThrow("changed");
  const id = await queueAudioBackfill(db,gameId,"producer",preview.previewHash);
  expect(await queueAudioBackfill(db,gameId,"producer",preview.previewHash)).toBe(id);
  await runAudioTrack(db,success);
  expect((await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id,id)))[0]!.status).toBe("ready");
  expect((await readAudioPublication(db,gameId,"omniscient",true))!.clips).toHaveLength(preview.source.lines.length);
}, 30_000);

test("live final audio failure holds the accepted game, retries missing clips and resumes explicitly", async () => {
  const {completedWerewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const {freezeLiveAudio,ensureLiveAudio,pauseLiveAudio,resumeLiveAudio} = await import("../services/audio-live.js");
  const {completeWerewolfAudioGame} = await import("../services/werewolf-games.js");
  const {audioReadySequence} = await import("../services/audio-frontier.js");
  const gameId="audio-live-final",epoch=crypto.randomUUID(),events=await completedWerewolfResultsFixture("saved",gameId,2);
  await db.insert(schema.games).values({id:gameId,slug:gameId,gameKind:"werewolf",status:"in_progress",startedAt:new Date().toISOString(),config:'{"audioMode":true}'});
  await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId,sequence:event.sequence,event})));
  await db.insert(schema.gameRunOwners).values({id:crypto.randomUUID(),gameId,ownerEpoch:epoch,processId:"audio-test",expiresAt:new Date(Date.now()+60_000).toISOString()});
  await freezeLiveAudio(db,gameId);
  let finished=false;
  const boundary=ensureLiveAudio(db,gameId,epoch).then(()=>{finished=true;return null;},error=>error);
  for (let i=0;i<100;i++) {
    const [track]=await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.gameId,gameId));
    if (track?.status==="queued") break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(finished).toBe(false);
  expect(await audioReadySequence(db,gameId)).toBe(0);
  const {readWerewolfWatch}=await import("../services/werewolf-presentation.js");
  const held=await readWerewolfWatch(db,gameId,"mystery",1,32);
  expect(held.moments).toEqual([]);expect(held.latestCursor).toBe(0);expect(held.playback).toEqual([]);
  await runAudioTrack(db,async()=>{throw new AudioProviderFailure("provider down",false,{status:400});});
  expect((await boundary)?.message).toBe("provider down");
  await pauseLiveAudio(db,gameId,epoch);
  expect((await db.select().from(schema.games).where(eq(schema.games.id,gameId)))[0]!.status).toBe("suspended");
  expect((await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId,gameId)))).toHaveLength(events.length);
  await expect(resumeLiveAudio(db,gameId,epoch)).rejects.toThrow("changed");
  const [track]=await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.gameId,gameId));
  await retryAudioTrack(db,gameId,track!.id);await runAudioTrack(db,success);
  expect(await audioReadySequence(db,gameId)).toBe(events.at(-1)!.sequence);
  expect((await db.select().from(schema.games).where(eq(schema.games.id,gameId)))[0]!.status).toBe("suspended");
  await resumeLiveAudio(db,gameId,epoch);
  const {claimWerewolfGame}=await import("../services/werewolf-games.js");
  const claimed=await claimWerewolfGame(db,gameId,"recovery-test");
  expect(claimed.ok).toBe(true);if(!claimed.ok) throw new Error(claimed.error);
  await ensureLiveAudio(db,gameId,claimed.claim.ownerEpoch);
  await completeWerewolfAudioGame(db,gameId,claimed.claim.ownerEpoch);
  expect((await db.select().from(schema.games).where(eq(schema.games.id,gameId)))[0]!.status).toBe("completed");
  expect((await db.select().from(schema.gameAudioTracks))).toHaveLength(1);
}, 30_000);

test("cancellation stops a claimed track before another paid dispatch",async()=>{
  const track=await fixture();let calls=0;
  await runAudioTrack(db,async recipe=>{calls++;await db.update(schema.games).set({status:"cancelled"}).where(eq(schema.games.id,track.gameId));return success(recipe);});
  expect(calls).toBe(1);
  expect((await db.select().from(schema.gameAudioTracks))[0]!.status).toBe("failed");
});

test("HTTP ranges recheck audience permissions for every media request",async()=>{
 const {createAudioRoutes}=await import("../routes/audio.js");
 const track=await fixture();await runAudioTrack(db,success);const app=createAudioRoutes(db);
 const full=(await readAudioPublication(db,track.gameId,"omniscient",true,true))!;
 const publicClip=full.clips.find(c=>c.momentId==="speech")!,privateClip=full.clips.find(c=>c.momentId==="thought")!;
 const response=await app.request(publicClip.url,{headers:{Range:"bytes=2-5"}});
 expect(response.status).toBe(206);expect(response.headers.get("content-length")).toBe("4");expect((await response.arrayBuffer()).byteLength).toBe(4);
 expect((await app.request(privateClip.url.replace("omniscient","mystery"))).status).toBe(404);
 expect((await app.request(privateClip.url.replace("thinking=on","thinking=off"))).status).toBe(404);
 expect((await app.request(publicClip.url,{headers:{Range:"bytes=99999-"}})).status).toBe(416);
});

test("audio source keeps accepted night speech tags at their later reveal",async()=>{
 const {completedCurrentWerewolfFixture}=await import("@influence/engine/fixtures/werewolf-results");
 const {readAudioSource}=await import("../services/audio-source.js");
 const {compileAudioDelivery}=await import("@influence/engine/audio-delivery");
 const gameId="audio-tag-source",events=await completedCurrentWerewolfFixture(gameId,10);
 await db.insert(schema.games).values({id:gameId,slug:gameId,gameKind:"werewolf",status:"completed",startedAt:new Date().toISOString(),config:"{}"});
 await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId,sequence:event.sequence,event})));
 const before=await readAudioSource(db,gameId);
 const line=before.lines.find(line=>line.context==="night-speech" && line.annotationSequence!==line.eventSequence);
 if (!line) throw new Error("Fixture must include a spoken private night decision");
 const delivery=compileAudioDelivery(`<soft>${line.text}</soft>`,"night-speech");
 await db.insert(schema.providerLogicalCalls).values({id:"night-call",gameId,actorId:line.speakerId,actorName:"Player",actorRole:"player",action:"werewolf.protect",semanticCoordinate:{version:1,kind:"werewolf_action",eventSequence:line.annotationSequence},semanticCoordinateHash:"fixture",acceptedAttemptId:"fixture-attempt",acceptedCatalogId:"openai:gpt-6-sol",acceptedValue:await storeJson({text:line.text}),acceptedValueSha256:sha256StableJson({text:line.text}),acceptedAt:new Date().toISOString(),audioDelivery:await storeJson({version:1,fields:[{path:["text"],delivery}]})});
 const after=await readAudioSource(db,gameId);
 expect(after.lines.find(row=>row.momentId===line.momentId)?.synthesisText).toBe(delivery.synthesisText);
 expect(after.lines.find(row=>row.momentId===line.momentId)?.text).toBe(line.text);
});

test("a newly started Influence audio game can pass its empty accepted prefix",async()=>{
 const {insertGame,insertOwner}=await import("./durable-run-test-utils.js");
 const {freezeLiveAudio,ensureLiveAudio}=await import("../services/audio-live.js");
 const gameId=await insertGame(db,{id:"audio-empty-prefix",status:"in_progress"});
 await db.update(schema.games).set({config:'{"audioMode":true}'}).where(eq(schema.games.id,gameId));
 const epoch=await insertOwner(db,gameId);await freezeLiveAudio(db,gameId);
 await ensureLiveAudio(db,gameId,epoch);
 expect((await db.select().from(schema.gameAudioTracks))[0]!.readyEventSequence).toBe(0);
 expect((await db.select().from(schema.gameAudioClips))).toHaveLength(0);
});
