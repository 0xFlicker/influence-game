import { and, desc, eq } from "drizzle-orm";
import { assignPlayerVoice, HOUSE_VOICE } from "@influence/engine/voice-catalog";
import { schema, type DrizzleDB } from "../db/index.js";
import { gameVoiceRoster } from "./audio-voices.js";
import { audioRecipe, type AudioClipRecipe } from "./audio-source.js";
import { readJson, readPayload, storeJson } from "./payload-storage.js";
import { sha256StableJson } from "./stable-hash.js";
import { audioCharacters, audioEstimateUsd } from "./audio-provider.js";
import { AudioTrackConflict } from "./audio-tracks.js";

type Reader = Pick<DrizzleDB,"select">;
const tracks = schema.gameAudioTracks, clips = schema.gameAudioClips;

async function recoveryState(db: Reader, gameId: string, selections: Record<string,string>) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id,gameId));
  const [track] = await db.select().from(tracks).where(and(eq(tracks.gameId,gameId),eq(tracks.active,true),eq(tracks.mode,"live")));
  const [owner] = await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId,gameId)).orderBy(desc(schema.gameRunOwners.createdAt)).limit(1);
  if (!game || !track || !owner || !["in_progress","suspended"].includes(game.status)
    || game.status === "suspended" && owner.failureReason !== "required_audio_failed") {
    throw new AudioTrackConflict("Voice recovery requires a live audio game or its audio suspension");
  }
  // A running audio request must settle before its track can be replaced. Never
  // abandon an unknown paid response or silently acknowledge an interrupted call.
  if (track.status === "running") throw new AudioTrackConflict("Stop and settle the audio worker before replacing voices");
  const roster = await gameVoiceRoster(db,gameId);
  const ids = new Set(roster.map(player=>player.agentId));
  if (ids.has(null) || ids.size !== Object.keys(selections).length || Object.keys(selections).some(id=>!ids.has(id))) {
    throw new AudioTrackConflict("Provide exactly one explicit voice for every roster agent ID");
  }
  const voices: Record<string,ReturnType<typeof assignPlayerVoice>> = {house:HOUSE_VOICE};
  const assignments: {agentProfileId:string;assignment:ReturnType<typeof assignPlayerVoice>}[] = [];
  for (const player of roster) {
    const id=player.agentId!;
    const [profile]=await db.select({id:schema.agentProfiles.id,gender:schema.agentProfiles.gender}).from(schema.agentProfiles).where(eq(schema.agentProfiles.id,id));
    if (!profile) throw new AudioTrackConflict("A roster agent profile is missing");
    if (typeof selections[id]!=="string") throw new AudioTrackConflict("Every roster agent requires an explicit stock voice");
    const assignment=assignPlayerVoice(id,profile.gender ?? null,selections[id]);
    voices[player.id]=assignment;assignments.push({agentProfileId:id,assignment});
  }
  const prior = await db.select().from(clips).where(eq(clips.trackId,track.id));
  if (prior.some(clip=>clip.status === "generating")) throw new AudioTrackConflict("Resolve interrupted audio attempts before replacing voices");
  const replacements = await Promise.all(prior.map(async clip=>{
    const oldRecipe=await readJson(clip.recipe);
    if (sha256StableJson(oldRecipe)!==clip.recipeHash) throw new Error("Audio recipe integrity mismatch");
    const voice=voices[oldRecipe.speakerId ?? "house"];
    if (!voice) throw new AudioTrackConflict("A clip speaker is absent from the frozen roster");
    const recipe=audioRecipe(oldRecipe,voice), recipeHash=sha256StableJson(recipe);
    const [version]=clip.activeVersionId ? await db.select().from(schema.gameAudioVersions).where(and(eq(schema.gameAudioVersions.id,clip.activeVersionId),eq(schema.gameAudioVersions.clipId,clip.id))) : [];
    const reuse=version && version.recipeHash===clip.recipeHash && deliveryHash(oldRecipe)===deliveryHash(recipe) ? version : null;
    return {clip,recipe,recipeHash,reuse};
  }));
  const characters=replacements.reduce((sum,row)=>sum+(row.reuse ? 0 : audioCharacters(row.recipe.synthesisText)),0);
  const previewHash=sha256StableJson({gameId,trackId:track.id,ownerEpoch:owner.ownerEpoch,voices,manifest:track.manifest?.sha256,
    clips:replacements.map(row=>({id:row.clip.id,recipe:row.clip.recipeHash,version:row.clip.activeVersionId,reuse:row.reuse?.id}))});
  return {game,track,owner,voices,assignments,replacements,characters,previewHash};
}

// Assignment provenance does not change delivery. Reusing the exact provider
// bytes still creates a new version with the successor recipe and identity.
function deliveryHash(recipe:AudioClipRecipe) {
  return sha256StableJson({...recipe,voice:{provider:recipe.voice.provider,voiceId:recipe.voice.voiceId}});
}

export async function previewLiveVoiceRecovery(db:DrizzleDB,gameId:string,selections:Record<string,string>) {
  const state=await recoveryState(db,gameId,selections);
  return {gameId,trackId:state.track.id,ownerEpoch:state.owner.ownerEpoch,previewHash:state.previewHash,voices:state.voices,
    regenerate:state.replacements.filter(row=>!row.reuse).length,reuse:state.replacements.filter(row=>row.reuse).length,
    characters:state.characters,estimateUsd:audioEstimateUsd(state.characters),retryBudgetUsd:audioEstimateUsd(state.characters*3)};
}

/** Operator-only repair. Does not invoke providers, queue paid work, rewrite
 * accepted gameplay, or resume execution. Caller must stop execution first. */
export async function prepareLiveVoiceRecovery(db:DrizzleDB,gameId:string,selections:Record<string,string>,previewHash:string) {
  return db.transaction(async tx=>{
    await tx.select({id:schema.games.id}).from(schema.games).where(eq(schema.games.id,gameId)).for("update");
    await tx.select({id:schema.gameRunOwners.id}).from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId,gameId)).for("update");
    await tx.select({id:tracks.id}).from(tracks).where(and(eq(tracks.gameId,gameId),eq(tracks.active,true))).for("update");
    const state=await recoveryState(tx,gameId,selections);
    if (state.previewHash!==previewHash) throw new AudioTrackConflict("Recovery preview changed; review again");
    const voices=await storeJson(state.voices);
    const recipes=await Promise.all(state.replacements.map(async row=>{
      if (row.reuse) await readPayload(row.reuse.audio);
      return {...row,stored:await storeJson(row.recipe)};
    }));
    const now=new Date().toISOString();
    await tx.update(schema.games).set({status:"suspended"}).where(eq(schema.games.id,gameId));
    await tx.update(schema.gameRunOwners).set({status:"revoked",revokedAt:now,closedAt:now,kernelHealth:"suspended",failureReason:"required_audio_failed"}).where(eq(schema.gameRunOwners.id,state.owner.id));
    await tx.update(tracks).set({active:false,status:"failed",leaseId:null,leaseExpiresAt:null,error:"Superseded by explicit voice correction",updatedAt:new Date()}).where(eq(tracks.id,state.track.id));
    const [next]=await tx.insert(tracks).values({gameId,mode:"live",active:true,status:"failed",predecessorId:state.track.id,
      voices,manifest:state.track.manifest,throughEventSequence:state.track.throughEventSequence,readyEventSequence:0,
      budgetUsd:audioEstimateUsd(state.characters*3),error:"Voice correction prepared. Explicitly retry missing clips before resuming."}).returning();
    for (const row of recipes) {
      const [clip]=await tx.insert(clips).values({trackId:next!.id,momentId:row.clip.momentId,sourceHash:row.clip.sourceHash,recipeHash:row.recipeHash,recipe:row.stored}).returning();
      if (row.reuse) {
        const [version]=await tx.insert(schema.gameAudioVersions).values({clipId:clip!.id,recipeHash:row.recipeHash,audio:row.reuse.audio,durationMs:row.reuse.durationMs,contentType:row.reuse.contentType}).returning();
        await tx.update(clips).set({status:"ready",activeVersionId:version!.id}).where(eq(clips.id,clip!.id));
      }
    }
    for (const assignment of state.assignments) await tx.insert(schema.agentVoices).values(assignment).onConflictDoUpdate({target:schema.agentVoices.agentProfileId,set:{assignment:assignment.assignment,updatedAt:new Date()}});
    return {trackId:next!.id,predecessorId:state.track.id,ownerEpoch:state.owner.ownerEpoch,status:next!.status};
  });
}
