import { resolveEmpowerRevoteVersion } from "@influence/engine/empower-revote-rules";
import { isSpectatorHuddleSpeech } from "@influence/engine";
import { loadPayloads } from "./payload-storage.js";
import { LEGACY_FORMAT_MANIFEST, Phase, replayCanonicalEvents, resolveFormatManifest, resolveGameKernel } from "@influence/engine";
import { validHeadRectangle, type CharacterHeadPosition, type HeadRectangle } from "@influence/engine/character-portrait";
import { assembleProductionCatalog, type ProductionCatalog } from "@influence/engine/production-moments";
import { buildInfluenceProductionSources, type InfluenceProductionThought } from "@influence/engine/production-moments/influence-source";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getGameWatchReplayFrames } from "./game-watch-state.js";
import { readGameExecutionState } from "./game-turn-commit.js";
import { sha256StableJson } from "./stable-hash.js";
import { readViewerMedia } from "./visual-media-viewer.js";
import { readInfluenceVisualPause } from "./visual-policy.js";

type SourceDB = Pick<DrizzleDB, "select">;
export class InfluenceProductionSourceError extends Error {}
export interface InfluenceProductionMediaReferences {
  portraits: Record<string, string>;
  fullBodies: Record<string, string>;
  fullBodyHeads: Record<string, HeadRectangle>;
  sceneIds: string[];
}
export interface InfluenceProductionSnapshot {
  gameId: string;
  gameKind: "influence";
  audience: "public";
  projectionVersion: 3;
  throughEventSequence: number;
  throughTurnSequence: number | null;
  transcriptPrefix: { maxId: number; maxEntrySequence: number };
  acceptedCutoff: string;
  acceptedSourceHash: string;
  mediaReferences: InfluenceProductionMediaReferences;
  publicationCutoff: string;
  sourceHash: string;
}
export interface InfluenceProductionSourceOptions {
  snapshot?: InfluenceProductionSnapshot;
  /** Explicit publication refresh preserves accepted history and transcript identity. */
  refreshVisuals?: boolean;
}
export interface InfluenceProductionPageOptions extends InfluenceProductionSourceOptions {
  afterSequence?: number;
  offset?: number;
  catalogOffset?: number;
  thoughtOffset?: number;
  visualOffset?: number;
  limit?: number;
}

/** A supplied descriptor is a bound to validate, never authority for a moment. */
export function decodeInfluenceProductionSnapshot(value: unknown): InfluenceProductionSnapshot {
  const fail = () => { throw new InfluenceProductionSourceError("Invalid Influence production snapshot"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "acceptedCutoff,acceptedSourceHash,audience,gameId,gameKind,mediaReferences,projectionVersion,publicationCutoff,sourceHash,throughEventSequence,throughTurnSequence,transcriptPrefix"
    || row.gameKind !== "influence" || row.audience !== "public" || row.projectionVersion !== 3
    || typeof row.gameId !== "string" || !row.gameId || row.gameId.length > 200
    || !Number.isSafeInteger(row.throughEventSequence) || Number(row.throughEventSequence) < 0
    || row.throughTurnSequence !== null && (!Number.isSafeInteger(row.throughTurnSequence) || Number(row.throughTurnSequence) < 0)
    || typeof row.publicationCutoff !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.publicationCutoff)
    || !Number.isFinite(Date.parse(row.publicationCutoff)) || Date.parse(row.publicationCutoff) > Date.now()
    || typeof row.acceptedCutoff !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.acceptedCutoff)
    || !Number.isFinite(Date.parse(row.acceptedCutoff)) || Date.parse(row.acceptedCutoff) > Date.parse(row.publicationCutoff)
    || typeof row.acceptedSourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.acceptedSourceHash)
    || typeof row.sourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.sourceHash)) return fail();
  const prefix = row.transcriptPrefix;
  if (!prefix || typeof prefix !== "object" || Array.isArray(prefix)) return fail();
  const bound = prefix as Record<string, unknown>;
  if (Object.keys(bound).sort().join() !== "maxEntrySequence,maxId" || !Number.isSafeInteger(bound.maxId) || Number(bound.maxId) < 0
    || !Number.isSafeInteger(bound.maxEntrySequence) || Number(bound.maxEntrySequence) < 0) return fail();
  const media = record(row.mediaReferences);
  if (Object.keys(media).sort().join() !== "fullBodies,fullBodyHeads,portraits,sceneIds" || !Array.isArray(media.sceneIds)
    || media.sceneIds.length > 10_000 || media.sceneIds.some(id => typeof id !== "string" || !id || id.length > 200)
    || new Set(media.sceneIds).size !== media.sceneIds.length) return fail();
  const portraits = record(media.portraits), bodies = record(media.fullBodies), heads = record(media.fullBodyHeads);
  if ([portraits, bodies, heads].some(map => Object.keys(map).length > 256)
    || [...Object.values(portraits), ...Object.values(bodies)].some(url => !reference(url))
    || Object.values(heads).some(head => !validHeadRectangle(head as HeadRectangle))) return fail();
  return { gameId: row.gameId, gameKind: "influence", audience: "public", projectionVersion: 3,
    throughEventSequence: Number(row.throughEventSequence), throughTurnSequence: row.throughTurnSequence === null ? null : Number(row.throughTurnSequence),
    transcriptPrefix: { maxId: Number(bound.maxId), maxEntrySequence: Number(bound.maxEntrySequence) },
    acceptedCutoff: row.acceptedCutoff, acceptedSourceHash: row.acceptedSourceHash,
    mediaReferences: { portraits: portraits as Record<string, string>, fullBodies: bodies as Record<string, string>, fullBodyHeads: heads as Record<string, HeadRectangle>, sceneIds: media.sceneIds as string[] },
    publicationCutoff: row.publicationCutoff, sourceHash: row.sourceHash };
}

function reference(value: unknown): string | undefined {
  return typeof value === "string" && (/^https?:\/\//.test(value) || value.startsWith("/")) ? value : undefined;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InfluenceProductionSourceError("Invalid saved production metadata");
  return value as Record<string, unknown>;
}
function roomMetadata(value: string | null) {
  if (value === null) return undefined;
  const parsed = record(JSON.parse(value));
  if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.excluded)) throw new InfluenceProductionSourceError("Invalid saved room metadata");
  const rooms = parsed.rooms.map(value => {
    const room = record(value);
    if (![room.roomId, room.round, room.beat].every(Number.isSafeInteger) || !Array.isArray(room.playerIds) || room.playerIds.some(id => typeof id !== "string"))
      throw new InfluenceProductionSourceError("Invalid saved room metadata");
    return { roomId: Number(room.roomId), round: Number(room.round), beat: Number(room.beat), playerIds: room.playerIds as string[] };
  });
  if (parsed.excluded.some(id => typeof id !== "string")) throw new InfluenceProductionSourceError("Invalid saved room metadata");
  return { rooms, excluded: parsed.excluded as string[] };
}
function stringArray(value: string | null): string[] | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(id => typeof id !== "string")) throw new InfluenceProductionSourceError("Invalid saved transcript audience");
  return parsed;
}

/** Caller owns a repeatable-read transaction when composing annotations/selection.
 * Read the complete accepted prefix before enumerating or paging its presentation.
 * This service never returns native provider evidence, media bytes, or game config. */
export async function buildInfluenceProductionSourceSnapshot(db: SourceDB, idOrSlug: string, options: InfluenceProductionSourceOptions = {}) {
  if (options.refreshVisuals && !options.snapshot) throw new InfluenceProductionSourceError("Refreshing visuals requires the pinned source snapshot");
  const supplied = options.snapshot ? decodeInfluenceProductionSnapshot(options.snapshot) : undefined;
  const [game] = await db.select({ id: schema.games.id, slug: schema.games.slug, kind: schema.games.gameKind,
    status: schema.games.status, config: schema.games.config, gameKernel: schema.games.gameKernel })
    .from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))).limit(1);
  if (!game || game.kind !== "influence") throw new InfluenceProductionSourceError("Influence game not found");
  if (game.status !== "completed" && (game.status !== "suspended" || !await readInfluenceVisualPause(db, game.id)))
    throw new InfluenceProductionSourceError("Production preview requires a completed game or a validated visual pause");
  if (supplied && supplied.gameId !== game.id) throw new InfluenceProductionSourceError("Production snapshot belongs to another game");
  const config = record(JSON.parse(game.config));
  const [history, execution, seats, rows, committedTurns] = await loadPayloads(Promise.all([
    getPersistedGameEvents(db, game.id), readGameExecutionState(db, game.id),
    db.select({ id: schema.gamePlayers.id, persona: schema.gamePlayers.persona }).from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id)).orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id)),
    db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, game.id))
      .orderBy(asc(schema.transcripts.timestamp), asc(schema.transcripts.id)),
    db.select({ id: schema.gameTurns.id, sequence: schema.gameTurns.turnSequence, result: schema.gameTurns.commitResult })
      .from(schema.gameTurns).where(and(eq(schema.gameTurns.gameId, game.id), eq(schema.gameTurns.status, "committed"))),
  ]));
  if (history.status === "invalid") throw new InfluenceProductionSourceError("Influence accepted history is invalid");
  if (execution && execution.heads.eventSequence !== history.lastTrustedSequence)
    throw new InfluenceProductionSourceError("Influence accepted event head changed");
  const throughEventSequence = supplied?.throughEventSequence ?? history.lastTrustedSequence;
  const complete = history.events.length ? replayCanonicalEvents(history.events.map(event => event.envelope)) : null;
  const enteredRetrospective = Boolean(complete?.retrospective)
    || history.events.some(({ envelope }) => envelope.phase === Phase.RETROSPECTIVE);
  if (game.status === "completed" && enteredRetrospective
    && (!complete?.retrospective?.completedAtEventSequence || complete.phase !== Phase.END))
    throw new InfluenceProductionSourceError("Completed game has no retrospective completion proof");
  if (throughEventSequence > history.lastTrustedSequence || throughEventSequence !== 0 && !history.events.some(event => event.sequence === throughEventSequence))
    throw new InfluenceProductionSourceError("Production snapshot is outside the accepted event prefix");
  const throughTurnSequence = supplied ? supplied.throughTurnSequence : execution?.heads.turnSequence ?? null;
  if (execution) {
    const expectedHead = throughTurnSequence === execution.heads.turnSequence ? execution.heads.eventSequence
      : throughTurnSequence === 0 ? 0 : committedTurns.find(turn => turn.sequence === throughTurnSequence)?.result?.state.heads.eventSequence;
    if (throughTurnSequence === null || expectedHead !== throughEventSequence)
      throw new InfluenceProductionSourceError("Production snapshot is not an accepted turn boundary");
  } else if (throughTurnSequence !== null) throw new InfluenceProductionSourceError("Production snapshot has no accepted turn authority");
  else if (throughEventSequence !== history.lastTrustedSequence) throw new InfluenceProductionSourceError("Historical production source has no earlier accepted turn boundary");
  const committed = new Map(committedTurns.map(turn => [turn.id, turn.sequence]));
  const acceptedRows = rows.filter(row => {
    if (row.scope === "huddle" && !isSpectatorHuddleSpeech({ ...row, dialogueContext: row.safeContext })) return false;
    if (row.gameTurnId && (!committed.has(row.gameTurnId) || throughTurnSequence !== null && committed.get(row.gameTurnId)! > throughTurnSequence)) return false;
    if (row.firstDurableEventSequence !== null && row.firstDurableEventSequence > throughEventSequence) return false;
    // Modern scratch dialogue without an accepted event boundary never enters a paused prefix.
    if (game.status === "suspended" && !row.gameTurnId && row.firstDurableEventSequence === null) return false;
    return true;
  });
  const latestPrefix = { maxId: Math.max(0, ...acceptedRows.map(row => row.id)), maxEntrySequence: Math.max(0, ...acceptedRows.map(row => row.entrySequence ?? 0)) };
  const transcriptPrefix = supplied?.transcriptPrefix ?? latestPrefix;
  if (transcriptPrefix.maxId > latestPrefix.maxId || transcriptPrefix.maxEntrySequence > latestPrefix.maxEntrySequence
    || transcriptPrefix.maxId && !acceptedRows.some(row => row.id === transcriptPrefix.maxId))
    throw new InfluenceProductionSourceError("Production snapshot is outside the accepted transcript prefix");
  const selectedRows = acceptedRows.filter(row => row.id <= transcriptPrefix.maxId && (row.entrySequence ?? 0) <= transcriptPrefix.maxEntrySequence);
  const retrospectiveByEntry = new Map(history.events.flatMap(({ envelope }) => envelope.sequence <= throughEventSequence && envelope.type === "retrospective.statement_recorded"
    ? envelope.sourcePointers.filter(pointer => pointer.kind === "transcript_entry").map(pointer => [pointer.sequence, { eventSequence: envelope.sequence, ...envelope.payload }] as const) : []));
  const acceptedRetrospectives = history.events.filter(event => event.sequence <= throughEventSequence && event.envelope.type === "retrospective.statement_recorded");
  if (acceptedRetrospectives.some(({envelope}) => envelope.sourcePointers.filter(pointer => pointer.kind === "transcript_entry").length !== 1)
    || retrospectiveByEntry.size !== acceptedRetrospectives.length || [...retrospectiveByEntry.keys()].some(sequence => !selectedRows.some(row => row.entrySequence === sequence)))
    throw new InfluenceProductionSourceError("Accepted retrospective speech is missing its captured dialogue");
  const publicationCutoff = options.refreshVisuals || !supplied ? new Date().toISOString() : supplied.publicationCutoff;
  const acceptedCutoff = supplied?.acceptedCutoff ?? publicationCutoff;
  const artifactUrl = (id: string) => `/api/admin/production/games/${encodeURIComponent(game.id)}/visual/artifacts/${encodeURIComponent(id)}`;
  const frozen = new Map(seats.map(seat => {
    const persona = record(JSON.parse(seat.persona));
    return [seat.id, { persona, player: { id: seat.id, name: typeof persona.name === "string" ? persona.name : "Unknown",
      persona: typeof persona.personalityBlurb === "string" ? persona.personalityBlurb : typeof persona.personality === "string" ? persona.personality : "Unknown",
      ...(typeof persona.personaKey === "string" && { personaKey: persona.personaKey }), ...(reference(persona.avatarUrl) && { avatarUrl: reference(persona.avatarUrl) }),
    } }];
  }));
  const allFrames = await getGameWatchReplayFrames(db, game.id);
  const acceptedEnvelopes = new Map(history.events.filter(event => event.sequence <= throughEventSequence).map(event => [event.sequence, event.envelope]));
  const frames = (allFrames ?? []).filter(frame => frame.sequence <= throughEventSequence).map(frame => {
    const event = acceptedEnvelopes.get(frame.sequence);
    const productionBallot = event?.type === "endgame.elimination_vote_cast" ? { kind: "eliminate" as const, voterId: event.payload.voterId }
      : event?.type === "jury.vote_cast" ? { kind: "winner" as const, voterId: event.payload.jurorId }
      : event?.type === "council.vote_cast" ? { kind: "council" as const, voterId: event.payload.voterId } : undefined;
    return { ...frame, ...(productionBallot ? { productionBallot } : {}),
    players: frame.players.map(player => {
      const seat = frozen.get(player.id);
      if (!seat) throw new InfluenceProductionSourceError("Accepted replay actor has no frozen game identity");
      return { ...seat.player, status: player.status, shielded: player.shielded, currentAgent: null,
        ...(player.pressureStatus && { pressureStatus: player.pressureStatus }), ...(player.exposeScore !== undefined && { exposeScore: player.exposeScore }) };
    }),
  }; });
  if (frames.length !== throughEventSequence) throw new InfluenceProductionSourceError("Influence source has an incomplete accepted prefix");
  const messages = selectedRows.map(row => {
    if (!Object.values(Phase).includes(row.phase as Phase)) throw new InfluenceProductionSourceError("Unknown accepted transcript phase");
    const anonymous = row.safeContext?.anonymous === true;
    const fromPlayerId = anonymous ? null : row.fromPlayerId;
    const retrospective = row.entrySequence === null ? undefined : retrospectiveByEntry.get(row.entrySequence);
    if (row.phase === Phase.RETROSPECTIVE && !retrospective || retrospective && (row.phase !== Phase.RETROSPECTIVE || anonymous
      || (row.speakerPlayerId ?? row.fromPlayerId) !== retrospective.actorId || row.text !== retrospective.speech || row.thinking !== null || row.firstDurableEventSequence !== retrospective.eventSequence))
      throw new InfluenceProductionSourceError("Retrospective dialogue does not match its canonical speech");
    return { id: row.id, gameId: game.id, round: row.round, phase: row.phase as Phase, scope: row.scope,
      entrySequence: row.entrySequence ?? undefined, dialogueKind: row.dialogueKind,
      firstDurableEventSequence: row.firstDurableEventSequence, speakerPlayerId: anonymous ? null : row.speakerPlayerId,
      anonymous, presentationPurpose: row.safeContext?.presentationPurpose, acceptedBallot: row.safeContext?.acceptedBallot,
        decisionSpeech: row.safeContext?.decisionSpeech,
      ...(retrospective ? { retrospectiveSource: { eventSequence: retrospective.eventSequence, ordinal: retrospective.ordinal } } : {}),
      visualScene: row.safeContext?.visualScene, fromPlayerId, fromPlayerName: fromPlayerId ? frozen.get(fromPlayerId)?.player.name ?? null : null,
      toPlayerIds: stringArray(row.toPlayerIds), ...(row.roomId !== null && { roomId: row.roomId }),
      ...(row.roomMetadata !== null && { roomMetadata: roomMetadata(row.roomMetadata) }), text: row.text, thinking: row.thinking, timestamp: row.timestamp };
  });
  const [cognition, assets, publications, sceneRows, episode] = await loadPayloads(Promise.all([
    db.select({ eventSequence: schema.gameCognitiveArtifacts.eventSequence, actorId: schema.gameCognitiveArtifacts.actorPlayerId,
      action: schema.gameCognitiveArtifacts.action, decisionId: schema.gameCognitiveArtifacts.decisionId, payload: schema.gameCognitiveArtifacts.payload }).from(schema.gameCognitiveArtifacts).where(and(
      eq(schema.gameCognitiveArtifacts.gameId, game.id), eq(schema.gameCognitiveArtifacts.artifactType, "thinking"),
      eq(schema.gameCognitiveArtifacts.visibilityStatus, "active"), eq(schema.gameCognitiveArtifacts.redactionStatus, "active"),
      lte(schema.gameCognitiveArtifacts.eventSequence, throughEventSequence), sql`${schema.gameCognitiveArtifacts.createdAt}::timestamptz <= ${acceptedCutoff}::timestamptz`,
      or(eq(schema.gameCognitiveArtifacts.actorRole, "player"), eq(schema.gameCognitiveArtifacts.actorRole, "juror")),
    )).orderBy(asc(schema.gameCognitiveArtifacts.eventSequence), asc(schema.gameCognitiveArtifacts.id)),
    db.select({ portraits: schema.visualGameAssets.portraits, cast: schema.visualGameAssets.cast }).from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, game.id)),
    db.select({ sceneId: schema.visualMediaPublications.sceneId, revision: schema.visualMediaPublications.revision,
      versionId: schema.visualMediaVersions.id, versionGameId: schema.visualMediaVersions.gameId, versionSceneId: schema.visualMediaVersions.sceneId })
      .from(schema.visualMediaPublications).innerJoin(schema.visualMediaVersions, eq(schema.visualMediaVersions.id, schema.visualMediaPublications.versionId))
      .where(and(eq(schema.visualMediaPublications.gameId, game.id), eq(schema.visualMediaPublications.audience, "public"),
        sql`${schema.visualMediaPublications.createdAt}::timestamptz <= ${publicationCutoff}::timestamptz`)).orderBy(asc(schema.visualMediaPublications.revision)),
    db.select({ id: schema.visualScenes.id, boundarySequence: schema.visualScenes.boundarySequence, afterDialogueSequence: schema.visualScenes.afterDialogueSequence })
      .from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, game.id), sql`${schema.visualScenes.createdAt}::timestamptz <= ${publicationCutoff}::timestamptz`)),
    db.select({ title: schema.gameEpisodePresentations.title }).from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, game.id)),
  ]));
  const thoughts: InfluenceProductionThought[] = [];
  const thoughtKeys = new Set<string>();
  for (const row of cognition) {
    if (!row.eventSequence || !row.actorId || typeof row.payload.thinking !== "string" || !row.payload.thinking.trim()) continue;
    if (!frozen.has(row.actorId)) throw new InfluenceProductionSourceError("Accepted thinking actor has no frozen game identity");
    const dialogue = row.decisionId ? selectedRows.findIndex(message => message.safeContext?.decisionId === row.decisionId) : -1;
    if (dialogue >= 0) {
      // Exact modern response provenance joins one thought to its speech row; no heuristic prose/actor aggregation.
      const message = messages[dialogue]!, speaker = message.speakerPlayerId ?? message.fromPlayerId;
      if (message.anonymous || speaker !== row.actorId && speaker !== frozen.get(row.actorId)!.player.name)
        throw new InfluenceProductionSourceError("Accepted thinking response has inconsistent actor provenance");
      if (!messages[dialogue]!.thinking) messages[dialogue]!.thinking = row.payload.thinking;
      continue;
    }
    // Conversation passes/unavailable offers have private evidence but no watch moment.
    if (["lobby", "lobby-message", "mingle-turn", "alliance-huddle-turn"].includes(row.action)) continue;
    const key = `${row.eventSequence}:${row.actorId}`;
    if (thoughtKeys.has(key)) throw new InfluenceProductionSourceError("Ambiguous accepted thinking provenance");
    thoughtKeys.add(key);
    const frame = frames.find(frame => frame.sequence === row.eventSequence);
    // The existing full export fetched exact accepted evidence for spoken format pleas.
    const defaultThinking = frame?.viewerDecisionEvent?.type === "format.two_names_plea_recorded";
    thoughts.push({ eventSequence: row.eventSequence, actorId: row.actorId, thinking: row.payload.thinking, defaultThinking });
  }
  const gameKernel = resolveGameKernel({ stored: game.gameKernel, events: history.events.filter(event => event.sequence <= throughEventSequence).map(event => event.envelope) }).kernel;
  const sources = buildInfluenceProductionSources({ gameId: game.id, gameKernel, transcripts: messages, frames, thoughts });
  const catalog = assembleProductionCatalog({ gameId: game.id, gameKind: "influence", audience: "public", sources });
  const acceptedThoughts = thoughts.filter(thought => sources.some(source => source.kind === "influence-thinking" && source.eventSequence === thought.eventSequence && source.actorId === thought.actorId));
  const permittedScenes = new Set(sceneRows.filter(scene => scene.afterDialogueSequence <= transcriptPrefix.maxEntrySequence
    && (throughTurnSequence === null || scene.boundarySequence <= throughTurnSequence)).map(scene => scene.id));
  const pinnedMedia = supplied && !options.refreshVisuals ? supplied.mediaReferences : undefined;
  if (pinnedMedia?.sceneIds.some(id => !permittedScenes.has(id))) throw new InfluenceProductionSourceError("Pinned scene is outside the accepted production prefix");
  const sceneIds = pinnedMedia?.sceneIds ?? [...permittedScenes];
  const publicationSnapshot: Record<string, number> = {};
  for (const publication of publications) {
    if (publication.versionGameId !== game.id || publication.versionSceneId !== publication.sceneId) throw new InfluenceProductionSourceError("Published visual version has invalid source identity");
    if (sceneIds.includes(publication.sceneId)) publicationSnapshot[publication.sceneId] = publication.revision;
  }
  const media = await readViewerMedia(db, game.id, publicationSnapshot, { includeHidden: true, artifactUrl, sceneIds });
  const fullBodies: Record<string, string> = {}, fullBodyHeads: Record<string, HeadRectangle> = {};
  for (const [id, seat] of frozen) {
    const url = reference(seat.persona.fullBodyReferenceUrl);
    if (url) fullBodies[id] = url;
    const head = seat.persona.headPosition as CharacterHeadPosition | undefined;
    if (head?.confirmation && head.sourceUrl === url && validHeadRectangle(head.rect)) fullBodyHeads[id] = head.rect;
  }
  for (const member of assets[0]?.cast ?? []) if (!member.portraitFallback && frozen.has(member.id)) {
    fullBodies[member.id] = artifactUrl(member.referenceArtifactId); delete fullBodyHeads[member.id];
    if (validHeadRectangle(member.headRectangle)) fullBodyHeads[member.id] = member.headRectangle;
  }
  const portraits = Object.fromEntries(Object.entries(assets[0]?.portraits ?? {}).filter(([id]) => frozen.has(id)).map(([id, artifact]) => [id, artifactUrl(artifact)]));
  if (pinnedMedia) {
    for (const [id, url] of Object.entries(pinnedMedia.portraits)) if (!frozen.has(id) || portraits[id] !== url)
      throw new InfluenceProductionSourceError("Pinned portrait is not a frozen reference for this actor");
    for (const [id, url] of Object.entries(pinnedMedia.fullBodies)) if (!frozen.has(id) || fullBodies[id] !== url && reference(frozen.get(id)!.persona.fullBodyReferenceUrl) !== url)
      throw new InfluenceProductionSourceError("Pinned fullbody is not a frozen reference for this actor");
    for (const [id, head] of Object.entries(pinnedMedia.fullBodyHeads)) {
      const personaHead = frozen.get(id)?.persona.headPosition as CharacterHeadPosition | undefined;
      const expected = pinnedMedia.fullBodies[id] === reference(frozen.get(id)?.persona.fullBodyReferenceUrl) ? personaHead?.rect : fullBodyHeads[id];
      if (!expected || sha256StableJson(head) !== sha256StableJson(expected)) throw new InfluenceProductionSourceError("Pinned head rectangle does not match its frozen reference");
    }
  }
  const mediaReferences: InfluenceProductionMediaReferences = pinnedMedia ?? { portraits, fullBodies, fullBodyHeads, sceneIds: media.scenes.map(scene => scene.id) };
  const visibleSceneIds = new Set(mediaReferences.sceneIds);
  const visual = { enabled: config.visualMode === true || media.scenes.length > 0, status: null,
    portraits: mediaReferences.portraits, fullBodies: mediaReferences.fullBodies, fullBodyHeads: mediaReferences.fullBodyHeads,
    publicationSnapshot: Object.fromEntries(Object.entries(media.publicationSnapshot).filter(([sceneId]) => visibleSceneIds.has(sceneId))),
    bindings: Object.fromEntries(Object.entries(media.bindings).filter(([sequence, sceneId]) => Number(sequence) <= transcriptPrefix.maxEntrySequence && visibleSceneIds.has(sceneId))),
    scenes: media.scenes.filter(scene => visibleSceneIds.has(scene.id)) };
  const players = [...frozen.values()].map(seat => {
    const final = frames.at(-1)?.players.find(player => player.id === seat.player.id);
    return { ...seat.player, status: final?.status === "eliminated" ? "eliminated" as const : "alive" as const, shielded: final?.shielded ?? false };
  });
  const exportGame = { id: game.id, slug: game.slug, status: game.status, players, gameKernel,
    // Preserve historical pinned source hashes: an absent version already means v1.
    ...(config.empowerRevoteVersion === undefined ? {} : { empowerRevoteVersion: resolveEmpowerRevoteVersion(config.empowerRevoteVersion) }),
    formatManifest: resolveFormatManifest(config.formatManifest ?? LEGACY_FORMAT_MANIFEST) };
  const acceptedBoundary = { gameId: game.id, gameKind: "influence" as const, audience: "public" as const, projectionVersion: 3 as const,
    throughEventSequence, throughTurnSequence, transcriptPrefix, acceptedCutoff };
  const acceptedSourceHash = sha256StableJson({ acceptedBoundary, game: { ...exportGame, status: undefined }, messages, frames, acceptedThoughts, catalog });
  if (supplied && supplied.acceptedSourceHash !== acceptedSourceHash) throw new InfluenceProductionSourceError("Pinned Influence accepted source changed; reload the source explicitly");
  const boundary = { ...acceptedBoundary, acceptedSourceHash, publicationCutoff, mediaReferences };
  const sourceHash = sha256StableJson({ boundary, visual });
  if (supplied && !options.refreshVisuals && supplied.sourceHash !== sourceHash) throw new InfluenceProductionSourceError("Pinned Influence production source changed; reload the source explicitly");
  const snapshot: InfluenceProductionSnapshot = { ...boundary, sourceHash };
  return { snapshot, status: game.status, title: episode[0]?.title ?? undefined, game: exportGame, visual, messages, frames,
    thoughts: {} as Record<string, string>, acceptedThoughts, sources, catalog };
}

export async function readInfluenceProductionCatalog(db: SourceDB, id: string, options: InfluenceProductionSourceOptions = {}): Promise<ProductionCatalog> {
  return (await buildInfluenceProductionSourceSnapshot(db, id, options)).catalog;
}

/** Source/cognition/catalog lanes are independently bounded; roster/media metadata is byte-free. */
export async function readInfluenceProductionSource(db: DrizzleDB, id: string, options: InfluenceProductionPageOptions = {}) {
  const limit = options.limit ?? 256;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new InfluenceProductionSourceError("Production page limit must be from 1 to 256");
  const afterSequence = options.afterSequence ?? 0, offset = options.offset ?? 0, catalogOffset = options.catalogOffset ?? 0, thoughtOffset = options.thoughtOffset ?? 0, visualOffset = options.visualOffset ?? 0;
  if ([afterSequence, offset, catalogOffset, thoughtOffset, visualOffset].some(value => !Number.isSafeInteger(value) || value < 0)) throw new InfluenceProductionSourceError("Invalid production page position");
  return db.transaction(async tx => {
    const source = await buildInfluenceProductionSourceSnapshot(tx, id, options);
    const frames = source.frames.filter(frame => frame.sequence > afterSequence).slice(0, limit);
    const messages = source.messages.slice(offset, offset + limit), moments = source.catalog.moments.slice(catalogOffset, catalogOffset + limit);
    const acceptedThoughts = source.acceptedThoughts.slice(thoughtOffset, thoughtOffset + limit);
    const scenes = source.visual.scenes.slice(visualOffset, visualOffset + limit);
    const messageSequences = new Set(messages.map(message => String(message.entrySequence)));
    const visual = { ...source.visual, scenes, bindings: Object.fromEntries(Object.entries(source.visual.bindings).filter(([sequence]) => messageSequences.has(sequence))) };
    return { snapshot: source.snapshot, status: source.status, title: source.title, game: source.game, visual, messages, frames,
      thoughts: source.thoughts, acceptedThoughts, catalog: { ...source.catalog, moments },
      totalFrames: source.frames.length, totalMessages: source.messages.length, totalMoments: source.catalog.moments.length, totalThoughts: source.acceptedThoughts.length, totalScenes: source.visual.scenes.length,
      nextSequence: frames.length && frames.at(-1)!.sequence < source.snapshot.throughEventSequence ? frames.at(-1)!.sequence : null,
      nextMessageOffset: offset + messages.length < source.messages.length ? offset + messages.length : null,
      nextCatalogOffset: catalogOffset + moments.length < source.catalog.moments.length ? catalogOffset + moments.length : null,
      nextThoughtOffset: thoughtOffset + acceptedThoughts.length < source.acceptedThoughts.length ? thoughtOffset + acceptedThoughts.length : null,
      nextVisualOffset: visualOffset + scenes.length < source.visual.scenes.length ? visualOffset + scenes.length : null };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
