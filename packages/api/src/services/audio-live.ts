import { and, desc, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { freezeLiveVoices } from "./audio-voices.js";
import { readJson, storeJson } from "./payload-storage.js";
import { audioRecipe, audioSourceHash, readAudioSource } from "./audio-source.js";
import { audioCharacters, audioEstimateUsd } from "./audio-provider.js";
import { sha256StableJson } from "./stable-hash.js";

export class LiveAudioBlocked extends Error {}
/** Voice snapshot is established once, before the first accepted turn. */
export async function freezeLiveAudio(db: DrizzleDB, gameId: string) {
  await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id,gameId)).for("update");
    if (game && JSON.parse(game.config).audioMode === true) await freezeLiveVoices(tx,gameId);
  });
}

export async function ensureLiveAudio(db: DrizzleDB, gameId: string, ownerEpoch: string, signal?: AbortSignal) {
  try { await generateRequiredLiveAudio(db,gameId,ownerEpoch,signal); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw error instanceof LiveAudioBlocked ? error : new LiveAudioBlocked(error instanceof Error ? error.message : "Required audio could not be prepared");
  }
}

/** Required post-acceptance boundary. Failure propagates outside projection callbacks. */
async function generateRequiredLiveAudio(db: DrizzleDB, gameId: string, ownerEpoch: string, signal?: AbortSignal) {
  const tracks = schema.gameAudioTracks, clips = schema.gameAudioClips;
  const [track] = await db.select().from(tracks).where(and(eq(tracks.gameId, gameId), eq(tracks.mode, "live"), eq(tracks.active,true)));
  if (!track) throw new LiveAudioBlocked("Audio Mode has no frozen voice track");
  if (track.status === "failed") throw new LiveAudioBlocked(track.error ?? "Required audio is unavailable");
  const source = await readAudioSource(db, gameId, true);
  if (track.readyEventSequence >= source.throughEventSequence) return;
  const voices = await readJson(track.voices), manifest = await storeJson(source);
  const existing = new Map((await db.select().from(clips).where(eq(clips.trackId, track.id))).map(clip => [clip.momentId, clip]));
  const additions: (typeof clips.$inferInsert)[] = [];
  let characters = 0;
  for (const line of source.lines) {
    const voice = voices[line.speakerId ?? "house"];
    if (!voice) throw new LiveAudioBlocked("A required speaker has no frozen voice");
    const recipe = audioRecipe(line, voice), recipeHash = sha256StableJson(recipe);
    const prior = existing.get(line.momentId);
    if (prior) {
      if (prior.recipeHash !== recipeHash) throw new LiveAudioBlocked("An accepted audio source changed");
      continue;
    }
    characters += audioCharacters(recipe.synthesisText) * 3;
    additions.push({ trackId: track.id, momentId: line.momentId, sourceHash: audioSourceHash(line), recipeHash, recipe: await storeJson(recipe) });
  }
  await db.transaction(async tx => {
    const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch), eq(schema.gameRunOwners.status, "active"))).for("update");
    if (!owner || !owner.expiresAt || Date.parse(owner.expiresAt) <= Date.now()) throw new LiveAudioBlocked("Audio execution owner changed");
    const [current] = await tx.select().from(tracks).where(eq(tracks.id, track.id)).for("update");
    if (current?.status !== "ready" || !current.active) return;
    if (additions.length) await tx.insert(clips).values(additions);
    await tx.update(tracks).set({ manifest, throughEventSequence: source.throughEventSequence,
      status: additions.length ? "queued" : "ready", readyEventSequence: additions.length ? current.readyEventSequence : source.throughEventSequence,
      budgetUsd: current.budgetUsd + audioEstimateUsd(characters), updatedAt: new Date() }).where(eq(tracks.id, track.id));
  });
  for (;;) {
    signal?.throwIfAborted();
    const [owner] = await db.select({status:schema.gameRunOwners.status,expiresAt:schema.gameRunOwners.expiresAt}).from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId,gameId),eq(schema.gameRunOwners.ownerEpoch,ownerEpoch)));
    if (owner?.status !== "active" || !owner.expiresAt || Date.parse(owner.expiresAt) <= Date.now()) throw new LiveAudioBlocked("Audio execution owner changed");
    const [current] = await db.select().from(tracks).where(eq(tracks.id, track.id));
    if (!current || !current.active || current.status === "failed") throw new LiveAudioBlocked(current?.error ?? "Required audio track unavailable");
    if (current.readyEventSequence >= source.throughEventSequence) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 500);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

export async function pauseLiveAudio(db: DrizzleDB, gameId: string, ownerEpoch: string) {
  await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch), eq(schema.gameRunOwners.status, "active"))).for("update");
    if (!game || game.status !== "in_progress" || !owner) return;
    await tx.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, gameId));
    const now = new Date().toISOString();
    await tx.update(schema.gameRunOwners).set({ status: "revoked", revokedAt: now, closedAt: now, kernelHealth: "suspended", failureReason: "required_audio_failed" }).where(eq(schema.gameRunOwners.id, owner.id));
    if (game.gameKind === "influence") await tx.update(schema.gameExecutionStates).set({ updatedAt: now }).where(and(eq(schema.gameExecutionStates.gameId, gameId), eq(schema.gameExecutionStates.ownerEpoch, ownerEpoch)));
  });
}

/** Explicit producer recovery; accepted engine state is adopted by the normal worker. */
export async function resumeLiveAudio(db:DrizzleDB,gameId:string,expectedOwnerEpoch:string) {
  await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id,gameId)).for("update");
    const [owner] = await tx.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId,gameId)).orderBy(desc(schema.gameRunOwners.createdAt)).limit(1);
    const [track] = await tx.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId,gameId),eq(schema.gameAudioTracks.mode,"live"),eq(schema.gameAudioTracks.active,true))).for("update");
    if (!game || game.status !== "suspended" || owner?.ownerEpoch !== expectedOwnerEpoch || owner.failureReason !== "required_audio_failed" || track?.status !== "ready") throw new LiveAudioBlocked("Audio recovery state changed. Refresh before resuming.");
    await tx.update(schema.games).set({status:"in_progress",endedAt:null}).where(eq(schema.games.id,gameId));
  });
}
