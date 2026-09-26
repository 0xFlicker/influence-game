import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { GameState, Phase, selectActiveJury } from "@influence/engine";
import { VISUAL_ROOMS, visualRoomForPhase, type FrozenVisualProfile, type VisualRoomId } from "@influence/engine/visual-mode";
import { planVisualScene, type VisualCastMember, type VisualPlacement } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { readVisualProfileImage } from "./visual-game-assets.js";
import { storeVisualArtifact } from "./visual-scene-store.js";
import { controlVisualMedia, readVisualMedia } from "./visual-media-repair.js";
import { readVisualRenderAccounting } from "./visual-render-journal.js";
import { sha256StableJson } from "./stable-hash.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { readEpisodePresentations } from "./episode-presentation.js";
import { getGameSeasonIdentityMap } from "../lib/game-season.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import { buildGameCompletionSettlementSummary, getGameCompletionSettlementSummaryMap } from "./game-completion-settlement.js";

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
const sameCast = (ids: readonly string[], scene: Scene) => ids.length === scene.plan.cast.length && scene.plan.cast.every(member => ids.includes(member.id));

/** Read-only discovery uses committed metadata and canonical prefixes, never dialogue prose. */
export async function readReplayVisualProduction(db: DrizzleDB, gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (!game) throw new ReplayVisualError("Game not found", "game_missing", 404);
  if (game.status !== "completed") throw new ReplayVisualError("Replay image production requires a completed game", "game_not_completed");
  const [scenes, dialogue, events, media, accounting] = await Promise.all([
    db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, gameId)).orderBy(asc(schema.visualScenes.boundarySequence)),
    db.select({ sequence: schema.transcripts.entrySequence, phase: schema.transcripts.phase, scope: schema.transcripts.scope,
      speaker: schema.transcripts.speakerPlayerId, audience: schema.transcripts.audiencePlayerIds, context: schema.transcripts.safeContext,
      turn: schema.gameTurns.turnSequence, baseEvents: schema.gameTurns.baseEventSequence, baseDialogue: schema.gameTurns.baseDialogueSequence })
      .from(schema.transcripts).innerJoin(schema.gameTurns, eq(schema.transcripts.gameTurnId, schema.gameTurns.id))
      .where(and(eq(schema.transcripts.gameId, gameId), eq(schema.gameTurns.status, "committed"))).orderBy(asc(schema.transcripts.entrySequence)),
    getPersistedGameEvents(db, gameId),
    readVisualMedia(db, gameId), readVisualRenderAccounting(db, gameId),
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
  const publishedIds = new Set(media.publications.map(publication => publication.sceneId));
  return { gameId, slug: game.slug, warnings: [
    ...(events.status === "invalid" ? ["Some canonical records are invalid. Only the trusted prefix can be staged."] : []),
    ...(unsupported ? [`${unsupported} dialogue beats lack enough canonical evidence to stage an image.`] : []),
  ],
    scenes: [...candidates.values()].sort((a, b) => a.boundarySequence - b.boundarySequence || a.roomId.localeCompare(b.roomId)).map(data => ({ ...data,
      available: Boolean(data.sceneId && (publishedIds.has(data.sceneId) || scenes.find(scene => scene.id === data.sceneId)?.status === "ready")),
      originalFailed: scenes.find(scene => scene.id === data.sceneId)?.status === "failed" })), media, attempts: accounting.attempts };
}

/** Copies saved game-start references; this never generates a new character or background. */
async function freezeReplayReferences(db: DrizzleDB, gameId: string, participants: Candidate["participants"]) {
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
  const plan = planVisualScene({ roomId: selected.roomId, backgroundArtifactId: assets?.backgrounds[selected.roomId] ?? null,
    cast, roles: selected.roles, allianceGroups: selected.allianceGroups, cues: selected.cues });
  const scene = await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (game?.status !== "completed") throw new ReplayVisualError("Replay image production requires a completed game", "game_not_completed");
    await tx.insert(schema.visualScenes).values({ id: randomUUID(), gameId, roomId: selected.roomId, boundarySequence: selected.boundarySequence,
      afterDialogueSequence: selected.afterDialogueSequence, plan, planHash: sha256StableJson(plan) }).onConflictDoNothing();
    const [stored] = await tx.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.roomId, selected.roomId), eq(schema.visualScenes.boundarySequence, selected.boundarySequence)));
    if (!stored || stored.planHash !== sha256StableJson(plan)) throw new ReplayVisualError("Scene plan changed. Refresh before rendering.", "stale_preview");
    return stored;
  });
  return controlVisualMedia(db, gameId, operatorId, { sceneId: scene.id, requestId: input.requestId, expectedVersion: 0, action: "regenerate",
    previewKey: input.key, previewHash: input.previewHash }, { oneAtATime: true });
}

/** Producer-only accounts use the same Production rows without broader admin access. */
export async function listReplayVisualGames(db: DrizzleDB) {
  const games = await db.select().from(schema.games).where(eq(schema.games.status, "completed")).orderBy(desc(schema.games.createdAt), asc(schema.games.id));
  if (!games.length) return [];
  const ids = games.map(game => game.id);
  const [episodes, seasons, settlements, players, results] = await Promise.all([
    readEpisodePresentations(db, games),
    getGameSeasonIdentityMap(db, games.map(game => game.seasonId)),
    getGameCompletionSettlementSummaryMap(db, ids),
    db.select({ id: schema.gamePlayers.id, gameId: schema.gamePlayers.gameId, persona: schema.gamePlayers.persona }).from(schema.gamePlayers).where(inArray(schema.gamePlayers.gameId, ids)),
    db.select({ gameId: schema.gameResults.gameId, winnerId: schema.gameResults.winnerId }).from(schema.gameResults).where(inArray(schema.gameResults.gameId, ids)),
  ]);
  return games.map(game => {
    const config = JSON.parse(game.config);
    const cast = players.filter(player => player.gameId === game.id);
    const winnerId = results.find(result => result.gameId === game.id)?.winnerId;
    const winner = cast.find(player => player.id === winnerId);
    return {
      id: game.id, slug: game.slug, status: game.status, hidden: Boolean(game.hiddenAt),
      episode: episodes.get(game.id), season: game.seasonId ? seasons.get(game.seasonId) : undefined,
      playerCount: game.maxPlayers ?? config.maxPlayers ?? cast.length, modelLabel: modelLabelFromConfig(config),
      winner: winner ? JSON.parse(winner.persona).name : undefined,
      completionSettlement: settlements.get(game.id) ?? buildGameCompletionSettlementSummary(null),
    };
  });
}
