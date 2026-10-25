import {and, eq, inArray} from "drizzle-orm";
import {schema, type DrizzleDB} from "../db/index.js";
import {audioRecipe, audioSourceHash, readAudioSource} from "./audio-source.js";
import {audioCharacters, audioEstimateUsd} from "./audio-provider.js";
import {AudioTrackConflict} from "./audio-tracks.js";
import {readJson, readPayload, storeJson} from "./payload-storage.js";
import {sha256StableJson} from "./stable-hash.js";

/** Completed-game presentation repair. Accepted player recordings and gameplay are immutable. */
async function refreshState(db: DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0], gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const [track] = await db.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId, gameId), eq(schema.gameAudioTracks.active, true)));
  if (game?.gameKind !== "werewolf" || game.status !== "completed" || track?.status !== "ready") throw new AudioTrackConflict("House refresh requires a completed Werewolf game with a ready voice track");
  const [pending] = await db.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.predecessorId, track.id), inArray(schema.gameAudioTracks.status, ["queued", "running", "failed"])));
  if (pending) throw new AudioTrackConflict("A refresh already exists; inspect or retry that track");
  const source = await readAudioSource(db, gameId), voices = await readJson(track.voices);
  const prior = await db.select({clip: schema.gameAudioClips, version: schema.gameAudioVersions}).from(schema.gameAudioClips)
    .leftJoin(schema.gameAudioVersions, eq(schema.gameAudioClips.activeVersionId, schema.gameAudioVersions.id)).where(eq(schema.gameAudioClips.trackId, track.id));
  const rows = await Promise.all(source.lines.map(async line => {
    const voice = voices[line.speakerId ?? "house"];
    if (!voice) throw new AudioTrackConflict("A source speaker has no frozen voice");
    const recipe = audioRecipe(line, voice), recipeHash = sha256StableJson(recipe);
    const previous = prior.find(row => row.clip.momentId === line.momentId);
    const reuse = previous?.version && previous.version.clipId === previous.clip.id && previous.version.recipeHash === recipeHash ? previous.version : null;
    if (line.speakerId !== null && !reuse) throw new AudioTrackConflict("House refresh cannot change or regenerate contestant audio");
    return {line, recipe, recipeHash, reuse};
  }));
  const ids = new Set(source.lines.map(line => line.momentId));
  for (const {clip} of prior) if (!ids.has(clip.momentId) && (await readJson(clip.recipe)).speakerId !== null) throw new AudioTrackConflict("House refresh cannot remove contestant audio");
  const characters = rows.reduce((sum, row) => sum + (row.reuse ? 0 : audioCharacters(row.recipe.synthesisText)), 0);
  const previewHash = sha256StableJson({source, voices, trackId: track.id, rows: rows.map(row => ({recipeHash: row.recipeHash, versionId: row.reuse?.id}))});
  return {track, source, rows, characters, previewHash};
}

export async function previewHouseAudioRefresh(db: DrizzleDB, gameId: string) {
  const state = await refreshState(db, gameId);
  return {gameId, predecessorId: state.track.id, previewHash: state.previewHash, reuse: state.rows.filter(row => row.reuse).length,
    generate: state.rows.filter(row => !row.reuse).map(row => ({text: row.line.text, audiences: row.line.audiences})),
    characters: state.characters, estimateUsd: audioEstimateUsd(state.characters), retryBudgetUsd: audioEstimateUsd(state.characters * 3)};
}

export async function queueHouseAudioRefresh(db: DrizzleDB, gameId: string, previewHash: string) {
  return db.transaction(async tx => {
    await tx.select({id: schema.games.id}).from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const state = await refreshState(tx, gameId);
    if (state.previewHash !== previewHash) throw new AudioTrackConflict("House refresh preview changed");
    if (!state.characters) throw new AudioTrackConflict("House audio is already current");
    const manifest = await storeJson(state.source);
    const prepared = await Promise.all(state.rows.map(async row => {
      if (row.reuse) await readPayload(row.reuse.audio);
      return {...row, stored: await storeJson(row.recipe)};
    }));
    const [track] = await tx.insert(schema.gameAudioTracks).values({gameId, mode: "backfill", predecessorId: state.track.id,
      voices: state.track.voices, manifest, throughEventSequence: state.source.throughEventSequence,
      budgetUsd: audioEstimateUsd(state.characters * 3)}).returning();
    for (const row of prepared) {
      const [clip] = await tx.insert(schema.gameAudioClips).values({trackId: track!.id, momentId: row.line.momentId,
        sourceHash: audioSourceHash(row.line), recipeHash: row.recipeHash, recipe: row.stored}).returning();
      if (row.reuse) {
        const [version] = await tx.insert(schema.gameAudioVersions).values({clipId: clip!.id, recipeHash: row.recipeHash,
          audio: row.reuse.audio, durationMs: row.reuse.durationMs, contentType: row.reuse.contentType}).returning();
        await tx.update(schema.gameAudioClips).set({status: "ready", activeVersionId: version!.id}).where(eq(schema.gameAudioClips.id, clip!.id));
      }
    }
    return track!.id;
  });
}
