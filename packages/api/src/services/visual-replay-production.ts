import { readWerewolfVisualPause } from "./werewolf-visual-policy.js";
import { planWerewolfProduction } from "./werewolf-production-plan.js";
import { freezeWerewolfReferences, readWerewolfProduction, readWerewolfProductionSceneCatalog, WerewolfReferenceError } from "./werewolf-production.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { GameState, Phase, selectActiveJury } from "@influence/engine";
import { VISUAL_ROOMS, visualRoomForPhase, type FrozenVisualProfile, type VisualRoomId } from "@influence/engine/visual-mode";
import { planVisualScene, type VisualCastMember, type VisualPlacement } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { storeVisualArtifact } from "./visual-scene-store.js";
import { controlVisualMedia, readVisualMedia, readVisualSceneStaging } from "./visual-media-repair.js";
import { readVisualRenderAccounting } from "./visual-render-journal.js";
import { sha256StableJson } from "./stable-hash.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { readInfluenceVisualPause } from "./visual-policy.js";

export class ReplayVisualError extends Error {
  constructor(message: string, readonly code: string, readonly status: 400 | 404 | 409 = 409) { super(message); }
}

type Scene = typeof schema.visualScenes.$inferSelect;
type Candidate = {
  key: string; previewHash: string; sceneId: string | null; roomId: VisualRoomId; roomName: string;
  round: number | null; boundarySequence: number; afterDialogueSequence: number;
  participants: Array<{ id: string; name: string }>;
  roles: Record<string, VisualPlacement["role"]>; allianceGroups: readonly (readonly string[])[];
  cues: Scene["plan"]["cues"];
};
const keyFor = (gameId: string, roomId: VisualRoomId, boundarySequence: number) => sha256StableJson({ gameId, roomId, boundarySequence });
function candidate(gameId: string, data: Omit<Candidate, "key" | "previewHash" | "roomName">): Candidate {
  return { ...data, key: keyFor(gameId, data.roomId, data.boundarySequence), roomName: VISUAL_ROOMS[data.roomId].name,
    previewHash: sha256StableJson({ ...data, sceneId: undefined }) };
}
const sameCast = (ids: readonly string[], scene: { plan: { cast: readonly { id: string }[] } }) => ids.length === scene.plan.cast.length && scene.plan.cast.every(member => ids.includes(member.id));

/** Read-only discovery uses committed metadata and canonical prefixes, never dialogue prose. */
async function readProductionGame(db: DrizzleDB, gameId: string) {
  const [game] = await db.select({slug:schema.games.slug,gameKind:schema.games.gameKind,status:schema.games.status}).from(schema.games).where(eq(schema.games.id, gameId));
  if (!game) throw new ReplayVisualError("Game not found", "game_missing", 404);
  if (game.status !== "completed" && !(game.gameKind === "werewolf" ? await readWerewolfVisualPause(db, gameId) : await readInfluenceVisualPause(db, gameId))) throw new ReplayVisualError("Image production requires a completed game or a visual-repair pause", "game_not_completed");
  return game;
}

/** Full accepted canonical history is projected before paging scene metadata. */
export async function readReplayVisualSceneCatalog(db: DrizzleDB, gameId: string) {
  const game = await readProductionGame(db,gameId);
  if (game.gameKind === "werewolf") {
    const catalog = await readWerewolfProductionSceneCatalog(db,gameId,game.slug);
    return {gameId,slug:game.slug,gameKind:game.gameKind,scenes:catalog.scenes,warnings:[]};
  }
  return {...await readInfluenceProductionSceneCatalog(db,gameId,game.slug),gameKind:game.gameKind};
}

async function readInfluenceProductionSceneCatalog(db:DrizzleDB,gameId:string,slug:string) {
  const [scenes, dialogue, events] = await Promise.all([
    readVisualSceneStaging(db,gameId),
    db.select({ sequence: schema.transcripts.entrySequence, phase: schema.transcripts.phase, scope: schema.transcripts.scope,
      speaker: schema.transcripts.speakerPlayerId, audience: schema.transcripts.audiencePlayerIds, context: schema.transcripts.safeContext,
      turn: schema.gameTurns.turnSequence, baseEvents: schema.gameTurns.baseEventSequence, baseDialogue: schema.gameTurns.baseDialogueSequence })
      .from(schema.transcripts).innerJoin(schema.gameTurns, eq(schema.transcripts.gameTurnId, schema.gameTurns.id))
      .where(and(eq(schema.transcripts.gameId, gameId), eq(schema.gameTurns.status, "committed"))).orderBy(asc(schema.transcripts.entrySequence)),
    getPersistedGameEvents(db, gameId),
  ]);
  const candidates = new Map<string, Candidate>();
  for (const scene of scenes) {
    const data = candidate(gameId, { sceneId: scene.id, roomId: scene.roomId, round: null, boundarySequence: scene.boundarySequence,
      afterDialogueSequence: scene.afterDialogueSequence, participants: scene.plan.cast.map(({ id, name }) => ({ id, name })),
      roles: Object.fromEntries(scene.plan.placements.map(p => [p.playerId, p.role])), allianceGroups: scene.plan.allianceGroups, cues: scene.plan.cues });
    candidates.set(data.key, data);
  }
  const prior = new Map<VisualRoomId, string>();
  let unsupported = 0;
  for (const row of dialogue) {
    if (!row.sequence || !row.speaker || row.scope === "diary" || row.scope === "thinking" || row.context?.acceptedBallot || row.context?.presentationPurpose === "farewell") continue;
    if ([Phase.MINGLE, Phase.MINGLE_I, Phase.POST_VOTE_MINGLE, Phase.FORMAT_MINGLE].includes(row.phase as Phase) && row.context?.roomId == null) { unsupported++; continue; }
    const prefix = events.events.filter(event => event.sequence <= row.baseEvents).map(event => event.envelope);
    if (!prefix.length || prefix.at(-1)!.sequence !== row.baseEvents) { unsupported++; continue; }
    const state = GameState.fromCanonicalEvents(prefix);
    const roomId = visualRoomForPhase(row.phase as Phase, row.context?.roomId, state.endgameStage ?? undefined);
    if (!roomId) continue;
    const alive = state.getAlivePlayerIds();
    const ids = roomId.startsWith("mingle-") ? [...new Set([row.speaker, ...(row.audience ?? [])])]
      : [...new Set([...alive, ...(roomId === "finals" ? selectActiveJury(state.jury, state.getAllPlayers().length).map(member => member.playerId) : [])])];
    if (!ids.includes(row.speaker) || roomId.startsWith("mingle-") && ids.some(id => !alive.includes(id))) { unsupported++; continue; }
    // Speaker/audience order changes between turns; seating follows the canonical roster.
    if (roomId.startsWith("mingle-")) ids.sort((a, b) => alive.indexOf(a) - alive.indexOf(b));
    const roles: Candidate["roles"] = roomId === "finals" ? Object.fromEntries(ids.map(id => [id, alive.includes(id) ? "finalist" : "juror"])) : {};
    if (roomId === "tribunal") for (const event of prefix) {
      if (event.type === "endgame.speech_recorded" && event.round === state.round && event.payload.speechKind === "accusation" && event.payload.targetId) roles[event.payload.targetId] = "addressing";
    }
    const allianceGroups = state.getHuddleEligibleAlliances().map(alliance => alliance.memberIds);
    const signature = sha256StableJson({ ids, roles, allianceGroups });
    if (prior.get(roomId) === signature) continue;
    prior.set(roomId, signature);
    const existing = row.context?.visualScene ? scenes.find(scene => scene.id === row.context!.visualScene!.id)
      : scenes.filter(scene => scene.roomId === roomId && scene.boundarySequence < row.turn && scene.afterDialogueSequence < row.sequence! && sameCast(ids, scene)).at(-1);
    if (existing && existing.boundarySequence !== row.turn - 1) continue;
    const data = candidate(gameId, { sceneId: existing?.id ?? null, roomId, round: state.round, boundarySequence: row.turn - 1, afterDialogueSequence: row.baseDialogue,
      participants: ids.map(id => ({ id, name: state.getPlayerName(id) })), roles, allianceGroups, cues: existing?.plan.cues ?? [] });
    candidates.set(data.key, data);
  }
  return { gameId, slug, warnings: [
    ...(events.status === "invalid" ? ["Some canonical records are invalid. Only the trusted prefix can be staged."] : []),
    ...(unsupported ? [`${unsupported} dialogue beats lack enough canonical evidence to stage an image.`] : []),
  ],
    scenes: [...candidates.values()].sort((a, b) => a.boundarySequence - b.boundarySequence || a.roomId.localeCompare(b.roomId)).map(data => ({ ...data,
      available: Boolean(data.sceneId && scenes.find(scene => scene.id === data.sceneId)?.status === "ready"),
      originalFailed: scenes.find(scene => scene.id === data.sceneId)?.status === "failed" })) };
}

/** Existing single-game repair inventory retains its evidence owner. Studio pages use the catalog above. */
export async function readReplayVisualProduction(db:DrizzleDB,gameId:string) {
  const game = await readProductionGame(db,gameId);
  if (game.gameKind === "werewolf") return readWerewolfProduction(db,gameId,game.slug);
  const [catalog,media,accounting] = await Promise.all([
    readInfluenceProductionSceneCatalog(db,gameId,game.slug),readVisualMedia(db,gameId),readVisualRenderAccounting(db,gameId),
  ]);
  const published = new Set(media.publications.map(publication => publication.sceneId));
  return {...catalog,scenes:catalog.scenes.map(scene => ({...scene,available:scene.available || Boolean(scene.sceneId && published.has(scene.sceneId))})),media,attempts:accounting.attempts};
}

/** Copies saved game-start references; this never generates a new character or background. */
async function freezeReplayReferences(db: DrizzleDB, gameId: string, participants: Candidate["participants"]) {
  const [game] = await db.select({ kind: schema.games.gameKind }).from(schema.games).where(eq(schema.games.id, gameId));
  if (game?.kind === "werewolf") {
    try { return await freezeWerewolfReferences(db, gameId, participants); }
    catch (error) {
      if (error instanceof WerewolfReferenceError) throw new ReplayVisualError(error.message, "references_missing");
      throw error;
    }
  }
  const players = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  const profiles: FrozenVisualProfile[] = players.map(player => {
    const persona = JSON.parse(player.persona) as Record<string, unknown>;
    const string = (field: string) => typeof persona[field] === "string" ? persona[field] : null;
    return { id: player.id, name: string("name") ?? player.id, personaKey: string("personaKey") ?? "", avatarUrl: string("avatarUrl"),
      fullBodyReferenceUrl: string("fullBodyReferenceUrl"), performanceInstructions: string("performanceInstructions") ?? "" };
  });
  await db.insert(schema.visualGameAssets).values({ gameId, profiles }).onConflictDoNothing();
  const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  if (!assets) throw new ReplayVisualError("Frozen character references are unavailable", "references_missing");
  const cast: VisualCastMember[] = [];
  for (const participant of participants) {
    const saved = assets.cast.find(member => member.id === participant.id);
    if (saved) {
      if (saved.name !== participant.name) throw new ReplayVisualError("Recorded cast does not match the frozen character profiles", "cast_mismatch");
      cast.push(saved); continue;
    }
    const profile = assets.profiles.find(member => member.id === participant.id);
    if (!profile || profile.name !== participant.name) throw new ReplayVisualError("Recorded cast does not match the frozen character profiles", "cast_mismatch");
    const referenceArtifactId = await storeVisualArtifact(db, gameId, await readVisualProfileImage(profile.fullBodyReferenceUrl ?? profile.avatarUrl, profile));
    cast.push({ id: profile.id, name: profile.name, referenceArtifactId, performanceInstructions: profile.performanceInstructions, portraitFallback: !profile.fullBodyReferenceUrl });
  }
  await db.transaction(async tx => {
    const [current] = await tx.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId)).for("update");
    if (!current) throw new ReplayVisualError("Frozen character references are unavailable", "references_missing");
    await tx.update(schema.visualGameAssets).set({ cast: [...current.cast, ...cast.filter(member => !current.cast.some(saved => saved.id === member.id))] }).where(eq(schema.visualGameAssets.gameId, gameId));
  });
  return { cast };
}

export async function renderMissingReplayScene(db: DrizzleDB, gameId: string, operatorId: string, input: { key: string; previewHash: string; requestId: string }) {
  const [prior] = await db.select().from(schema.visualMediaRequests).where(and(eq(schema.visualMediaRequests.gameId, gameId), eq(schema.visualMediaRequests.operatorId, operatorId), eq(schema.visualMediaRequests.requestId, input.requestId)));
  if (prior) {
    if (prior.input.previewKey !== input.key || prior.input.previewHash !== input.previewHash) throw new ReplayVisualError("Request ID belongs to another scene preview", "request_conflict");
    return prior.receipt;
  }
  const inventory = await readReplayVisualProduction(db, gameId);
  const selected = inventory.scenes.find(scene => scene.key === input.key);
  if (!selected || selected.previewHash !== input.previewHash) throw new ReplayVisualError("Scene evidence changed. Refresh the scene list before rendering.", "stale_preview");
  const { cast } = await freezeReplayReferences(db, gameId, selected.participants);
  const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
  const [gameKind] = await db.select({ kind: schema.games.gameKind }).from(schema.games).where(eq(schema.games.id, gameId));
  const plan = gameKind?.kind === "werewolf" ? await planWerewolfProduction(db, gameId, selected.roomId, selected.boundarySequence) : planVisualScene({ roomId: selected.roomId, backgroundArtifactId: assets?.backgrounds[selected.roomId] ?? null,
    cast, roles: selected.roles, allianceGroups: selected.allianceGroups, cues: selected.cues });
  const scene = await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (game?.status !== "completed") {
      const pause = await readWerewolfVisualPause(tx, gameId);
      if (pause?.work.kind !== "scene" || pause.work.descriptor.roomId !== selected.roomId || pause.work.descriptor.boundarySequence !== selected.boundarySequence)
        throw new ReplayVisualError("Only the paused visual boundary can be repaired", "stale_preview");
    }
    await tx.insert(schema.visualScenes).values({ id: randomUUID(), gameId, roomId: selected.roomId, boundarySequence: selected.boundarySequence,
      afterDialogueSequence: selected.afterDialogueSequence, plan, planHash: sha256StableJson(plan) }).onConflictDoNothing();
    const [stored] = await tx.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.roomId, selected.roomId), eq(schema.visualScenes.boundarySequence, selected.boundarySequence)));
    if (!stored || stored.planHash !== sha256StableJson(plan)) throw new ReplayVisualError("Scene plan changed. Refresh before rendering.", "stale_preview");
    return stored;
  });
  return controlVisualMedia(db, gameId, operatorId, { sceneId: scene.id, requestId: input.requestId, expectedVersion: 0, action: "regenerate",
    previewKey: input.key, previewHash: input.previewHash }, { oneAtATime: true });
}
