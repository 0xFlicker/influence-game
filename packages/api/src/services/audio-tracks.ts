import { reserveLocalTaskAudio } from "@influence/engine";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readAudioSource, audioRecipe, audioSourceHash } from "./audio-source.js";
import { previewGameVoices, persistGameVoiceDefaults } from "./audio-voices.js";
import { readJson, storeJson, storeBinary, readPayload } from "./payload-storage.js";
import { sha256StableJson } from "./stable-hash.js";
import { audioCharacters, audioEstimateUsd, generateXaiAudio, measureAudio, AudioProviderFailure, type AudioProvider } from "./audio-provider.js";

const tracks = schema.gameAudioTracks, clips = schema.gameAudioClips, versions = schema.gameAudioVersions;
export class AudioTrackConflict extends Error {}
export async function previewAudioTrack(db: DrizzleDB, gameId: string) {
  const existingRows = await db.select().from(tracks).where(eq(tracks.gameId,gameId));
  const stored = existingRows.find(track => track.active) ?? existingRows[0];
  const source = stored?.manifest ? await readJson(stored.manifest) : await readAudioSource(db, gameId);
  const voices = stored ? await readJson(stored.voices) : await previewGameVoices(db, gameId);
  for (const line of source.lines) if (!voices[line.speakerId ?? "house"]) throw new Error("Audio speaker has no frozen game identity");
  const characters = source.lines.reduce((sum, line) => sum + audioCharacters(line.synthesisText), 0);
  const [game] = await db.select({status:schema.games.status}).from(schema.games).where(eq(schema.games.id,gameId));
  const [owner] = await db.select({epoch:schema.gameRunOwners.ownerEpoch,reason:schema.gameRunOwners.failureReason}).from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId,gameId)).orderBy(desc(schema.gameRunOwners.createdAt)).limit(1);
  const resumeOwnerEpoch = game?.status === "suspended" && owner?.reason === "required_audio_failed" && stored?.mode === "live" && stored.status === "ready" ? owner.epoch : null;
  const existing = existingRows.map(({id,status,active,error,reservedCharacters}) => ({id,status,active,error,reservedCharacters}));
  return { gameId, source, voices, resumeOwnerEpoch, characters, estimateUsd: audioEstimateUsd(characters), retryBudgetUsd: audioEstimateUsd(characters * 3),
    previewHash: sha256StableJson({ source, voices }), existing };
}

/** Exact preview comparison prevents changing the cast/source between approval and dispatch. */
export async function queueAudioBackfill(db: DrizzleDB, gameId: string, userId: string, previewHash: string) {
  const preview = await previewAudioTrack(db, gameId);
  if (preview.previewHash !== previewHash) throw new AudioTrackConflict("Source or voices changed. Review a fresh audio preview.");
  if (!preview.source.lines.length) throw new AudioTrackConflict("This source has no eligible spoken or thinking moments");
  const voices = await storeJson(preview.voices), manifest = await storeJson(preview.source);
  const recipes = await Promise.all(preview.source.lines.map(async line => {
    const recipe = audioRecipe(line, preview.voices[line.speakerId ?? "house"]!);
    return { momentId: line.momentId, sourceHash: audioSourceHash(line), recipeHash: sha256StableJson(recipe), recipe: await storeJson(recipe) };
  }));
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (!game || game.status !== "completed") throw new AudioTrackConflict("Historical audio requires a completed game");
    const [prior] = await tx.select().from(tracks).where(eq(tracks.gameId, gameId));
    if (prior?.mode === "backfill" && prior.manifest?.sha256 === manifest.sha256 && prior.voices.sha256 === voices.sha256) return prior.id;
    if (prior) throw new AudioTrackConflict("A track already exists. Retry its missing clips; replacement is a separate producer action.");
    await persistGameVoiceDefaults(tx,gameId,preview.voices);
    const [track] = await tx.insert(tracks).values({ gameId, mode: "backfill", voices, manifest,
      budgetUsd: preview.retryBudgetUsd, throughEventSequence: preview.source.throughEventSequence, createdById: userId }).returning();
    await tx.insert(clips).values(recipes.map(recipe => ({ ...recipe, trackId: track!.id })));
    return track!.id;
  });
}
export async function retryAudioTrack(db: DrizzleDB, gameId: string, trackId: string) {
  await db.transaction(async tx => {
    const [track] = await tx.select().from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.gameId, gameId))).for("update");
    if (!track || track.status !== "failed") throw new AudioTrackConflict("Only a failed audio track can be retried");
    const missing = await tx.select().from(clips).where(and(eq(clips.trackId, trackId), sql`${clips.activeVersionId} IS NULL`));
    let characters = 0;
    for (const clip of missing) characters += audioCharacters((await readJson(clip.recipe)).synthesisText) * 3;
    await tx.update(clips).set({ status: "pending", attempts: 0, error: null }).where(and(eq(clips.trackId, trackId), sql`${clips.activeVersionId} IS NULL`));
    await tx.update(tracks).set({ status: "queued", error: null, leaseId: null, leaseExpiresAt: null,
      budgetUsd: audioEstimateUsd(track.reservedCharacters + characters), updatedAt: new Date() }).where(eq(tracks.id, trackId));
  });
}

/** One fenced track, durable dispatch intent, three bounded attempts per clip.
 * Failed/ambiguous storage never triggers more paid work. Ready clips are reused. */
export async function runAudioTrack(db: DrizzleDB, provider: AudioProvider = generateXaiAudio, signal?: AbortSignal): Promise<boolean> {
  const track = await db.transaction(async tx => {
    const [next] = await tx.select().from(tracks).where(sql`${tracks.status} = 'queued' OR (${tracks.status} = 'running' AND ${tracks.leaseExpiresAt} < now())`)
      .orderBy(asc(tracks.createdAt)).for("update", { skipLocked: true }).limit(1);
    if (!next) return null;
    const [claimed] = await tx.update(tracks).set({ status: "running", leaseId: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 300_000), updatedAt: new Date() }).where(eq(tracks.id, next.id)).returning();
    return claimed!;
  });
  if (!track) return false;
  const guard = and(eq(tracks.id, track.id), eq(tracks.leaseId, track.leaseId!), eq(tracks.status, "running"));
  const fence = async (tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0], allowCancelled = false) => {
    const [owned] = await tx.select({ id: tracks.id }).from(tracks).where(and(guard,sql`${tracks.leaseExpiresAt} > now()`)).for("update");
    if (!owned) throw new Error("Audio worker lease lost");
    const [game] = await tx.select({status:schema.games.status}).from(schema.games).where(eq(schema.games.id,track.gameId));
    if (!game || !allowCancelled && game.status === "cancelled") throw new Error("Audio generation stopped because the game was cancelled");
  };
  try {
    const pending = await db.select().from(clips).where(and(eq(clips.trackId, track.id), sql`${clips.activeVersionId} IS NULL`)).orderBy(asc(clips.id));
    for (const clip of pending) {
      if (clip.status === "generating") throw new Error("Prior audio dispatch has an unknown outcome. Inspect and explicitly retry.");
      const recipe = await readJson(clip.recipe);
      if (sha256StableJson(recipe) !== clip.recipeHash) throw new Error("Audio recipe integrity mismatch");
      const characters = audioCharacters(recipe.synthesisText);
      let succeeded = false;
      for (let attempt = clip.attempts; attempt < 3; attempt++) {
        signal?.throwIfAborted();
        const requestEvidence = await storeJson({ recipeHash: clip.recipeHash, request: recipe });
        const attemptId = await db.transaction(async tx => {
          await fence(tx);
          const [budget] = await tx.select().from(tracks).where(eq(tracks.id, track.id));
          if (audioEstimateUsd(budget!.reservedCharacters + characters) > budget!.budgetUsd + 1e-8) throw new Error("Audio spending allowance exhausted");
          await tx.update(tracks).set({ reservedCharacters: sql`${tracks.reservedCharacters} + ${characters}`, leaseExpiresAt: new Date(Date.now() + 300_000), updatedAt: new Date() }).where(guard);
          await tx.update(clips).set({ status: "generating", attempts: attempt + 1 }).where(eq(clips.id, clip.id));
          const [row] = await tx.insert(schema.gameAudioAttempts).values({ clipId: clip.id, leaseId: track.leaseId!, status: "dispatched", billableCharacters: characters, evidence: requestEvidence }).returning({ id: schema.gameAudioAttempts.id });
          return row!.id;
        });
        let result;
        try { await reserveLocalTaskAudio(attemptId, recipe.synthesisText, track.gameId); result = await provider(recipe, signal); }
        catch (error) {
          const evidence = await storeJson(error instanceof AudioProviderFailure ? error.evidence : { failure: error instanceof Error ? error.message : "Audio generation failed" });
          await db.transaction(async tx => {
            await fence(tx,true);
            await tx.update(schema.gameAudioAttempts).set({ status: "failed", evidence }).where(eq(schema.gameAudioAttempts.id, attemptId));
            await tx.update(clips).set({ status: "failed", error: error instanceof Error ? error.message : "Audio generation failed" }).where(eq(clips.id, clip.id));
          });
          if (!(error instanceof AudioProviderFailure) || !error.retryable || attempt === 2) throw error;
          // Backoff is abortable; the durable attempt count survives process restarts.
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal?.reason); };
            const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 1000 * 2 ** attempt);
            signal?.addEventListener("abort", abort, { once: true });
          });
          continue;
        }
        if (!result.bytes.byteLength) throw new Error("Empty audio provider artifact");
        const audio = await storeBinary(result.bytes);
        await readPayload(audio);
        const evidence = await storeJson(result.evidence);
        // Preserve every delivered provider body before probing or accepting playback.
        await db.transaction(async tx => {
          await fence(tx,true);
          await tx.update(schema.gameAudioAttempts).set({responseAudio:audio,evidence}).where(eq(schema.gameAudioAttempts.id,attemptId));
        });
        const durationMs = result.durationMs ?? await measureAudio(result.bytes);
        if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Invalid audio provider duration");
        await db.transaction(async tx => {
          await fence(tx);
          const [version] = await tx.insert(versions).values({ clipId: clip.id, recipeHash: clip.recipeHash, audio, durationMs }).returning({ id: versions.id });
          await tx.update(clips).set({ status: "ready", activeVersionId: version!.id, error: null }).where(eq(clips.id, clip.id));
          await tx.update(schema.gameAudioAttempts).set({ status: "succeeded", evidence }).where(eq(schema.gameAudioAttempts.id, attemptId));
        });
        succeeded = true;
        break;
      }
      if (!succeeded) throw new Error("Audio clip exhausted its attempts");
    }
    await db.transaction(async tx => {
      await fence(tx);
      const [missing] = await tx.select({ id: clips.id }).from(clips).where(and(eq(clips.trackId, track.id), sql`${clips.activeVersionId} IS NULL`)).limit(1);
      if (missing) throw new Error("Audio track still has missing clips");
      await tx.update(tracks).set({ status: "ready", active: true, readyEventSequence: track.throughEventSequence, leaseId: null, leaseExpiresAt: null, updatedAt: new Date(), error: null }).where(guard);
    });
  } catch (error) {
    await db.update(tracks).set({ status: "failed", leaseId: null, leaseExpiresAt: null, updatedAt: new Date(), error: error instanceof Error ? error.message : "Audio generation failed" }).where(guard);
  }
  return true;
}
export function startAudioWorker(db: DrizzleDB, canClaim: () => boolean) {
  const controller = new AbortController();
  let pending: Promise<unknown> | null = null;
  const tick = () => {
    if (controller.signal.aborted || pending || !canClaim()) return;
    pending = runAudioTrack(db, generateXaiAudio, controller.signal).catch(error => console.error("[audio] Worker unavailable", error instanceof Error ? error.name : "unknown")).finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 2000); timer.unref(); tick();
  return { async stop() { clearInterval(timer); controller.abort(); await pending; } };
}
