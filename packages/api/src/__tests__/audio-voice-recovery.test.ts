import {beforeEach,expect,test} from "bun:test";
import {eq} from "drizzle-orm";
import {assignPlayerVoice,HOUSE_VOICE} from "@influence/engine/voice-catalog";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {audioRecipe,audioSourceHash,type AudioSourceManifest} from "../services/audio-source.js";
import {storeJson,readJson} from "../services/payload-storage.js";
import {sha256StableJson} from "../services/stable-hash.js";
import {runAudioTrack,retryAudioTrack,previewAudioTrack} from "../services/audio-tracks.js";
import {prepareLiveVoiceRecovery,previewLiveVoiceRecovery} from "../services/audio-voice-recovery.js";
import {resumeLiveAudio,freezeLiveAudio} from "../services/audio-live.js";
import {readAudioPublication} from "../services/audio-publication.js";
import {audioReadySequence} from "../services/audio-frontier.js";
import type {AudioProvider} from "../services/audio-provider.js";

let db:DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();});
const provider:AudioProvider=async recipe=>({bytes:new TextEncoder().encode(`${recipe.voice.voiceId}:${recipe.synthesisText}`),durationMs:1000,evidence:{status:200}});

for (const gameKind of ["influence","werewolf"] as const) test(`${gameKind} voice correction preserves history and evidence, reuses House and requires explicit retry/resume`,async()=>{
  const gameId=`recover-${gameKind}`,epoch=crypto.randomUUID();
  const events=gameKind==="werewolf" ? await completedCurrentWerewolfFixture(gameId,10) : [];
  const start=events[0];
  if (start && start.type!=="werewolf.started") throw new Error("Expected initial roster");
  const cast=start?.type==="werewolf.started" ? start.payload.players.map(player=>({id:player.id,profileId:`profile-${player.id}`})) : [{id:"seat",profileId:"profile"}];
  const selections=Object.fromEntries(cast.map(player=>[player.profileId,"sal"]));
  await db.insert(schema.users).values({id:"operator"});
  await db.insert(schema.agentProfiles).values(cast.map(player=>({id:player.profileId,userId:"operator",name:player.id,personality:"Test",gender:"male" as const,avatarUrl:"https://example.test/unchanged.png"})));
  await db.insert(schema.agentVoices).values(cast.map(player=>({agentProfileId:player.profileId,assignment:assignPlayerVoice(player.profileId,"male","ara")})));
  await db.insert(schema.games).values({id:gameId,slug:gameId,gameKind,status:"in_progress",config:'{"audioMode":true}'});
  if (start?.type==="werewolf.started") {
    for (const player of start.payload.players) player.agentProfileId=`profile-${player.id}`;
    await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId,sequence:event.sequence,event})));
  } else await db.insert(schema.gamePlayers).values(cast.map(player=>({id:player.id,gameId,agentProfileId:player.profileId,persona:"{}",agentConfig:"{}"})));
  await db.insert(schema.gameRunOwners).values({id:crypto.randomUUID(),gameId,ownerEpoch:epoch,processId:"test",expiresAt:new Date(Date.now()+60000).toISOString()});
  const voices:Record<string,ReturnType<typeof assignPlayerVoice>>={house:HOUSE_VOICE,...Object.fromEntries(cast.map(player=>[player.id,assignPlayerVoice(player.profileId,"male","ara")]))};
  const source:AudioSourceManifest={version:1,gameId,throughEventSequence:3,lines:[
    {momentId:"house",speakerId:null,text:"Day begins.",synthesisText:"Day begins.",context:"speech",eventSequence:1,audiences:["public","omniscient","mystery"]},
    {momentId:"speech",speakerId:cast[0]!.id,text:"I suspect a wolf.",synthesisText:"<soft>I suspect a wolf.</soft>",context:"speech",eventSequence:2,audiences:["public","omniscient"]},
    {momentId:"thinking",speakerId:cast[0]!.id,text:"I must be careful.",synthesisText:"<higher-pitch>I must be careful.</higher-pitch>",context:"thinking",eventSequence:3,audiences:["public","omniscient"]},
  ]};
  const [old]=await db.insert(schema.gameAudioTracks).values({gameId,mode:"live",active:true,voices:await storeJson(voices),manifest:await storeJson(source),throughEventSequence:3,budgetUsd:1}).returning();
  for (const line of source.lines) {
    const recipe=audioRecipe(line,voices[line.speakerId ?? "house"]!);
    await db.insert(schema.gameAudioClips).values({trackId:old!.id,momentId:line.momentId,sourceHash:audioSourceHash(line),recipeHash:sha256StableJson(recipe),recipe:await storeJson(recipe)});
  }
  await runAudioTrack(db,provider);
  const oldVersions=await db.select().from(schema.gameAudioVersions),oldAttempts=await db.select().from(schema.gameAudioAttempts);
  const history=await db.select().from(schema.werewolfEvents);
  const preview=await previewLiveVoiceRecovery(db,gameId,selections);
  expect(preview.regenerate).toBe(2);expect(preview.reuse).toBe(1);
  await expect(previewLiveVoiceRecovery(db,gameId,{})).rejects.toThrow("exactly one");
  await expect(previewLiveVoiceRecovery(db,gameId,{...selections,[cast[0]!.profileId]:"helios"})).rejects.toThrow("reserved");
  await db.update(schema.gameAudioTracks).set({status:"running"}).where(eq(schema.gameAudioTracks.id,old!.id));
  await expect(previewLiveVoiceRecovery(db,gameId,selections)).rejects.toThrow("settle");
  await db.update(schema.gameAudioTracks).set({status:"ready"}).where(eq(schema.gameAudioTracks.id,old!.id));
  await expect(prepareLiveVoiceRecovery(db,gameId,selections,"stale")).rejects.toThrow("preview changed");
  const repaired=await prepareLiveVoiceRecovery(db,gameId,selections,preview.previewHash);
  expect(repaired.predecessorId).toBe(old!.id);
  await freezeLiveAudio(db,gameId);
  expect(await db.select().from(schema.gameAudioTracks)).toHaveLength(2);
  expect(await audioReadySequence(db,gameId)).toBe(0);
  const audience=gameKind==="werewolf" ? "omniscient" : "public";
  expect((await readAudioPublication(db,gameId,audience,true))!.clips).toEqual([]);
  const trackPreview=await previewAudioTrack(db,gameId);
  expect(trackPreview.voices[cast[0]!.id]!.voiceId).toBe("sal");
  expect(trackPreview.existing.find(track=>track.id===old!.id)!.retryable).toBe(false);
  expect((await db.select().from(schema.games))[0]!.status).toBe("suspended");
  expect(await db.select().from(schema.werewolfEvents)).toEqual(history);
  expect((await db.select().from(schema.gameAudioAttempts))).toEqual(oldAttempts);
  for (const version of oldVersions) expect((await db.select().from(schema.gameAudioVersions).where(eq(schema.gameAudioVersions.id,version.id)))[0]).toEqual(version);
  const [retired]=await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id,old!.id));
  expect(retired!.voices).toEqual(old!.voices);expect(retired!.active).toBe(false);
  expect(await runAudioTrack(db,provider)).toBe(false);
  await expect(retryAudioTrack(db,gameId,old!.id)).rejects.toThrow("superseded");
  await expect(resumeLiveAudio(db,gameId,epoch)).rejects.toThrow("changed");
  await retryAudioTrack(db,gameId,repaired.trackId);
  const delivered:string[]=[];
  await runAudioTrack(db,async recipe=>{delivered.push(recipe.voice.voiceId);return provider(recipe);});
  expect(delivered).toEqual(["sal","sal"]);
  expect(await audioReadySequence(db,gameId)).toBe(3);
  expect((await previewAudioTrack(db,gameId)).resumeOwnerEpoch).toBe(epoch);
  const publication=(await readAudioPublication(db,gameId,audience,true))!;
  expect(publication.id).toBe(repaired.trackId);expect(publication.clips).toHaveLength(3);
  expect(publication.clips.some(clip=>oldVersions.some(version=>version.id===clip.versionId))).toBe(false);
  await resumeLiveAudio(db,gameId,epoch);
  expect((await db.select().from(schema.games))[0]!.status).toBe("in_progress");
  for (const voice of await db.select().from(schema.agentVoices)) expect(voice.assignment.voiceId).toBe("sal");
  for (const profile of await db.select().from(schema.agentProfiles)) expect(profile.avatarUrl).toBe("https://example.test/unchanged.png");
  const successorClips=await db.select().from(schema.gameAudioClips).where(eq(schema.gameAudioClips.trackId,repaired.trackId));
  for (const clip of successorClips) {
    expect(oldVersions.some(version=>version.id===clip.activeVersionId)).toBe(false);
    expect((await readJson(clip.recipe)).voice.voiceId).toBe(clip.momentId==="house" ? "helios" : "sal");
  }
  await expect(prepareLiveVoiceRecovery(db,gameId,selections,preview.previewHash)).rejects.toThrow("preview changed");
},30000);
