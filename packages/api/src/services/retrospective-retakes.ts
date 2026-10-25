import {and, desc, eq, inArray, isNotNull, lte} from "drizzle-orm";
import {compileWerewolfRetrospective, materializeRetrospectiveContext, retrospectiveSpeechArtifact, type RetrospectiveSpeakerContext} from "@influence/engine";
import {replayWerewolf} from "@influence/engine/werewolf";
import type {WerewolfEvent} from "@influence/engine/werewolf";
import type {WerewolfRetrospectivePresentation} from "@influence/engine/werewolf/watch";
import {compileAudioDelivery} from "@influence/engine/audio-delivery";
import {schema, type DrizzleDB} from "../db/index.js";
import {readJson, readPayload, storeJson} from "./payload-storage.js";
import {readWerewolfEvents} from "./werewolf-games.js";
import {sha256StableJson} from "./stable-hash.js";
import {audioRecipe, audioSourceHash} from "./audio-source.js";
import {audioCharacters, audioEstimateUsd} from "./audio-provider.js";
import {AudioTrackConflict} from "./audio-tracks.js";

type DB = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export interface RetrospectiveRetakeDocument {
  version: 1;
  context: RetrospectiveSpeakerContext;
  catalogId: string;
  speech: string;
  /** Complete sanitized provider journal; private bucket only, never a watch DTO. */
  evidence: unknown;
}

/** Canonical original and exact earlier statements, never a later speaker's retrospective. */
export async function prepareRetrospectiveRetake(db: DB, gameId: string, actorId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (game?.gameKind !== "werewolf" || game.status !== "completed") throw new AudioTrackConflict("Retake requires a completed Werewolf game");
  const events = await readWerewolfEvents(db, gameId);
  const original = events.find(event => event.type === "werewolf.retrospective_statement_recorded" && event.payload.actorId === actorId);
  if (!original || original.type !== "werewolf.retrospective_statement_recorded") throw new AudioTrackConflict("No accepted retrospective for this actor");
  const source = compileWerewolfRetrospective(events);
  const before = replayWerewolf(events.filter(event => event.sequence < original.sequence)).retrospective;
  if (!source.definition || !before) throw new AudioTrackConflict("Retrospective source is unavailable");
  const context = materializeRetrospectiveContext({input: source.input, definition: source.definition, speakers: source.speakers}, before);
  const [track] = await db.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId, gameId), eq(schema.gameAudioTracks.active, true)));
  if (track?.status !== "ready" || !track.manifest) throw new AudioTrackConflict("Retake requires a ready voice track");
  const [pending] = await db.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.predecessorId, track.id), inArray(schema.gameAudioTracks.status, ["queued", "running", "failed"])));
  if (pending) throw new AudioTrackConflict("An audio successor already exists; inspect or retry it");
  const manifest = await readJson(track.manifest);
  const lines = manifest.lines.filter(line => line.eventSequence === original.sequence && line.speakerId === actorId && line.context === "speech");
  if (lines.length !== 1) throw new AudioTrackConflict("Retrospective must have exactly one existing speech clip");
  const previewHash = sha256StableJson({original, context, trackId: track.id, manifestHash: track.manifest.sha256});
  return {gameId, actorId, original, context, track, manifest, line: lines[0]!, previewHash};
}

/** Queue one new recording; keep the original active until speech and audio publish together. */
export async function queueRetrospectiveRetake(db: DrizzleDB, input: {gameId: string; actorId: string; previewHash: string; document: RetrospectiveRetakeDocument; userId: string}) {
  return db.transaction(async tx => {
    await tx.select({id: schema.games.id}).from(schema.games).where(eq(schema.games.id, input.gameId)).for("update");
    const state = await prepareRetrospectiveRetake(tx, input.gameId, input.actorId);
    if (state.previewHash !== input.previewHash) throw new AudioTrackConflict("Retake source changed; review again");
    const doc = input.document;
    const speech = retrospectiveSpeechArtifact.decodeAcceptedValue({speech: doc.speech});
    if (doc.version !== 1 || !doc.catalogId || !doc.evidence || speech.status !== "valid" || sha256StableJson(doc.context) !== sha256StableJson(state.context)) throw new AudioTrackConflict("Retake does not match its frozen source or speech contract");
    const voices = await readJson(state.track.voices);
    const source = {...state.manifest, lines: state.manifest.lines.map(line => line.momentId === state.line.momentId
      ? {...line, text: doc.speech, synthesisText: compileAudioDelivery(doc.speech, "speech").synthesisText} : line)};
    const old = await tx.select({clip: schema.gameAudioClips, version: schema.gameAudioVersions}).from(schema.gameAudioClips)
      .leftJoin(schema.gameAudioVersions, eq(schema.gameAudioClips.activeVersionId, schema.gameAudioVersions.id)).where(eq(schema.gameAudioClips.trackId, state.track.id));
    const rows = await Promise.all(source.lines.map(async line => {
      const prior = old.find(row => row.clip.momentId === line.momentId);
      if (!prior?.version || prior.version.clipId !== prior.clip.id) throw new AudioTrackConflict("Original audio is incomplete");
      const voice = voices[line.speakerId ?? "house"];
      if (!voice) throw new AudioTrackConflict("Speaker has no frozen voice");
      const changed = line.momentId === state.line.momentId;
      // Preserve the exact original recipe/delivery for every other clip.
      const recipe = changed ? audioRecipe(line, voice) : await readJson(prior.clip.recipe);
      if (!changed && sha256StableJson(recipe) !== prior.version.recipeHash) throw new AudioTrackConflict("Original audio recipe failed integrity validation");
      if (!changed) await readPayload(prior.version.audio);
      return {line, recipe, prior, changed, stored: changed ? await storeJson(recipe) : prior.clip.recipe};
    }));
    const document = await storeJson(doc), manifest = await storeJson(source);
    const characters = audioCharacters(rows.find(row => row.changed)!.recipe.synthesisText);
    const [track] = await tx.insert(schema.gameAudioTracks).values({gameId: input.gameId, mode: "backfill", predecessorId: state.track.id,
      voices: state.track.voices, manifest, throughEventSequence: state.track.throughEventSequence,
      budgetUsd: audioEstimateUsd(characters * 3), createdById: input.userId}).returning();
    for (const row of rows) {
      const [clip] = await tx.insert(schema.gameAudioClips).values({trackId: track!.id, momentId: row.line.momentId,
        sourceHash: row.changed ? audioSourceHash(row.line) : row.prior.clip.sourceHash,
        recipeHash: sha256StableJson(row.recipe), recipe: row.stored}).returning();
      if (!row.changed) {
        const oldVersion = row.prior.version!;
        const [version] = await tx.insert(schema.gameAudioVersions).values({clipId: clip!.id, recipeHash: oldVersion.recipeHash,
          audio: oldVersion.audio, durationMs: oldVersion.durationMs, contentType: oldVersion.contentType}).returning();
        await tx.update(schema.gameAudioClips).set({status: "ready", activeVersionId: version!.id}).where(eq(schema.gameAudioClips.id, clip!.id));
      }
    }
    const [retake] = await tx.insert(schema.productionRetrospectiveRetakes).values({gameId: input.gameId, actorId: input.actorId,
      sourceEventSequence: state.original.sequence, sourceEventHash: sha256StableJson(state.original), trackId: track!.id, document}).returning();
    return {retakeId: retake!.id, trackId: track!.id, reusedClips: rows.length - 1, generatedClips: 1, estimateUsd: audioEstimateUsd(characters)};
  });
}

/** Read only published retakes at the presentation pin; original canonical events stay untouched. */
export async function readRetrospectivePresentation(db: Pick<DrizzleDB, "select">, gameId: string, events: readonly WerewolfEvent[], cutoff: string): Promise<WerewolfRetrospectivePresentation> {
  const rows = await db.select().from(schema.productionRetrospectiveRetakes).where(and(eq(schema.productionRetrospectiveRetakes.gameId, gameId),
    isNotNull(schema.productionRetrospectiveRetakes.publishedAt), lte(schema.productionRetrospectiveRetakes.publishedAt, new Date(cutoff))))
    .orderBy(desc(schema.productionRetrospectiveRetakes.publishedAt), desc(schema.productionRetrospectiveRetakes.id));
  const result: WerewolfRetrospectivePresentation = new Map();
  for (const row of rows) {
    if (result.has(row.sourceEventSequence)) continue;
    const original = events.find(event => event.sequence === row.sourceEventSequence);
    if (!original) continue; // Outside the requested canonical prefix.
    if (original.type !== "werewolf.retrospective_statement_recorded" || original.payload.actorId !== row.actorId || sha256StableJson(original) !== row.sourceEventHash) throw new Error("Retake canonical source integrity mismatch");
    const doc = await readJson(row.document);
    if (doc.version !== 1 || retrospectiveSpeechArtifact.decodeAcceptedValue({speech: doc.speech}).status !== "valid" || doc.context.self.id !== row.actorId) throw new Error("Invalid stored retrospective retake");
    result.set(row.sourceEventSequence, {id: row.id, actorId: row.actorId, speech: doc.speech});
  }
  return result;
}
