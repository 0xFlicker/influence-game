import type {
  UUID,
  MingleTurnActionRecord,
  RoomAllocation,
  MingleRoomAssignmentRecord,
  MingleRoomAssignmentSource,
  MingleRoomPlayerRef,
  MingleRoomChoiceStatus,
  MingleRoomCount,
  MingleIntentSummary,
  MingleSessionDiagnostics,
} from "../types";
import { Phase } from "../types";
import type { MingleIntentAction, MingleTurnAction } from "../game-runner.types";
import type { HouseMingleAssignmentResult } from "../house-interviewer";
import { assertCanAcceptCommit, strategicDecisionResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";
import { PlayerStatus } from "../types";

/**
 * Neutral open rooms replace pair matching. Rooms are available only while the
 * normal social game has at least five alive players.
 */
export function computeRoomCount(aliveCount: number): number {
  if (aliveCount < 5) return 0;
  return Math.ceil(aliveCount / 3) + 1;
}

function buildPlayerRef(
  playerById: Map<UUID, { id: UUID; name: string }>,
  playerId: UUID,
): MingleRoomPlayerRef {
  return {
    id: playerId,
    name: playerById.get(playerId)?.name ?? playerId,
  };
}

function buildLocalRooms(
  roomCount: number,
  round: number,
  beat: number,
): RoomAllocation[] {
  return Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    round,
    beat,
    playerIds: [],
  }));
}

function namesToIds(
  names: readonly string[] | undefined,
  playerIdByName: ReadonlyMap<string, UUID>,
): UUID[] {
  if (!names) return [];
  return names
    .map((name) => playerIdByName.get(name.toLowerCase()))
    .filter((id): id is UUID => id !== undefined);
}

function preferredSizeScore(intent: MingleIntentSummary | null | undefined, currentSize: number): number {
  switch (intent?.preferredRoomSize) {
    case "solo":
      return currentSize === 0 ? 5 : -4 * currentSize;
    case "pair":
      return currentSize === 1 ? 5 : currentSize === 0 ? 1 : -2 * Math.abs(currentSize - 1);
    case "small_group":
      return currentSize >= 1 && currentSize <= 3 ? 4 : currentSize === 0 ? 1 : -2;
    case "large_group":
      return currentSize >= 3 ? 4 : currentSize;
    case "any":
    default:
      return 0;
  }
}

function roomAffinityScore(
  playerId: UUID,
  room: RoomAllocation,
  intents: ReadonlyMap<UUID, MingleIntentSummary | null>,
  playerIdByName: ReadonlyMap<string, UUID>,
  roomCount: number,
  aliveCount: number,
): number {
  const intent = intents.get(playerId) ?? null;
  const seekIds = new Set(namesToIds(intent?.seekPlayers, playerIdByName));
  const avoidIds = new Set(namesToIds(intent?.avoidPlayers, playerIdByName));
  let score = 0;

  if (aliveCount >= roomCount && room.playerIds.length === 0) score += 12;
  score -= room.playerIds.length * 2;
  score += preferredSizeScore(intent, room.playerIds.length);

  for (const occupantId of room.playerIds) {
    if (seekIds.has(occupantId)) score += 6;
    if (avoidIds.has(occupantId)) score -= 9;

    const occupantIntent = intents.get(occupantId) ?? null;
    const occupantSeekIds = new Set(namesToIds(occupantIntent?.seekPlayers, playerIdByName));
    const occupantAvoidIds = new Set(namesToIds(occupantIntent?.avoidPlayers, playerIdByName));
    if (occupantSeekIds.has(playerId)) score += 3;
    if (occupantAvoidIds.has(playerId)) score -= 6;
  }

  return score;
}

function bestRoomIdForPlayer(
  playerId: UUID,
  rooms: readonly RoomAllocation[],
  intents: ReadonlyMap<UUID, MingleIntentSummary | null>,
  playerIdByName: ReadonlyMap<string, UUID>,
  roomCount: number,
  aliveCount: number,
): number {
  let bestRoom = rooms[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const room of rooms) {
    const score = roomAffinityScore(playerId, room, intents, playerIdByName, roomCount, aliveCount);
    if (
      !bestRoom ||
      score > bestScore ||
      (score === bestScore && room.playerIds.length < bestRoom.playerIds.length) ||
      (score === bestScore && room.playerIds.length === bestRoom.playerIds.length && room.roomId < bestRoom.roomId)
    ) {
      bestRoom = room;
      bestScore = score;
    }
  }
  return bestRoom?.roomId ?? 1;
}

function addPlayerToRoom(rooms: RoomAllocation[], playerId: UUID, roomId: number): void {
  rooms[roomId - 1]?.playerIds.push(playerId);
}

function setAssignment(
  records: Map<UUID, MingleRoomAssignmentRecord>,
  player: { id: UUID; name: string },
  roomId: number,
  source: MingleRoomAssignmentSource,
  intent: MingleIntentSummary | null,
  repairNote?: string,
): void {
  const existing = records.get(player.id);
  records.set(player.id, {
    player: { id: player.id, name: player.name },
    assignedRoomId: roomId,
    source,
    intent,
    repairNotes: [...(existing?.repairNotes ?? []), ...(repairNote ? [repairNote] : [])],
  });
}

function lowestAffinityMovablePlayer(
  room: RoomAllocation,
  intents: ReadonlyMap<UUID, MingleIntentSummary | null>,
  playerIdByName: ReadonlyMap<string, UUID>,
  roomCount: number,
  aliveCount: number,
): UUID | null {
  if (room.playerIds.length <= 1) return null;

  let lowestPlayer: UUID | null = null;
  let lowestScore = Number.POSITIVE_INFINITY;
  for (const playerId of room.playerIds) {
    const score = roomAffinityScore(playerId, room, intents, playerIdByName, roomCount, aliveCount);
    if (score < lowestScore || (score === lowestScore && playerId < (lowestPlayer ?? playerId))) {
      lowestPlayer = playerId;
      lowestScore = score;
    }
  }
  return lowestPlayer;
}

function fillEmptyRooms(
  rooms: RoomAllocation[],
  alivePlayers: Array<{ id: UUID; name: string }>,
  intents: ReadonlyMap<UUID, MingleIntentSummary | null>,
  playerIdByName: ReadonlyMap<string, UUID>,
  assignmentRecords: Map<UUID, MingleRoomAssignmentRecord>,
): void {
  if (alivePlayers.length < rooms.length) return;

  for (const emptyRoom of rooms.filter((room) => room.playerIds.length === 0)) {
    const sourceRoom = [...rooms]
      .filter((room) => room.playerIds.length > 1)
      .sort((a, b) => b.playerIds.length - a.playerIds.length || a.roomId - b.roomId)[0];
    if (!sourceRoom) return;

    const movedPlayerId = lowestAffinityMovablePlayer(sourceRoom, intents, playerIdByName, rooms.length, alivePlayers.length);
    if (!movedPlayerId) return;

    sourceRoom.playerIds = sourceRoom.playerIds.filter((id) => id !== movedPlayerId);
    emptyRoom.playerIds.push(movedPlayerId);
    const player = alivePlayers.find((candidate) => candidate.id === movedPlayerId);
    if (player) {
      setAssignment(
        assignmentRecords,
        player,
        emptyRoom.roomId,
        "repaired",
        intents.get(player.id) ?? null,
        `Moved from Room ${sourceRoom.roomId} to fill empty Room ${emptyRoom.roomId}.`,
      );
    }
  }
}

export function allocateRooms(
  houseAssignment: HouseMingleAssignmentResult | null | undefined,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCount: number,
  round: number,
  beat = 1,
  mingleIntents: ReadonlyMap<UUID, MingleIntentSummary | null> = new Map(),
): {
  rooms: RoomAllocation[];
  diagnostics: MingleSessionDiagnostics;
} {
  const rooms = buildLocalRooms(roomCount, round, beat);
  const playerById = new Map(alivePlayers.map((player) => [player.id, player]));
  const playerIdByName = new Map(alivePlayers.map((player) => [player.name.toLowerCase(), player.id]));
  const assignmentRecords = new Map<UUID, MingleRoomAssignmentRecord>();

  if (roomCount < 1) {
    return {
      rooms,
      diagnostics: {
        round,
        beat,
        roomCount,
        eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
        assignments: [],
        allocatedRooms: [],
      },
    };
  }

  const seenPlayerIds = new Set<UUID>();
  const rejectedAssignmentNotesByPlayerId = new Map<UUID, string[]>();
  let validHousePlacements = 0;

  for (const proposedRoom of houseAssignment?.rooms ?? []) {
    if (!Number.isInteger(proposedRoom.roomId) || proposedRoom.roomId < 1 || proposedRoom.roomId > roomCount) {
      for (const playerId of proposedRoom.playerIds) {
        if (playerById.has(playerId) && !seenPlayerIds.has(playerId)) {
          const notes = rejectedAssignmentNotesByPlayerId.get(playerId) ?? [];
          notes.push(`House proposed invalid Room ${proposedRoom.roomId}; repaired placement.`);
          rejectedAssignmentNotesByPlayerId.set(playerId, notes);
        }
      }
      continue;
    }

    for (const playerId of proposedRoom.playerIds) {
      const player = playerById.get(playerId);
      if (!player) continue;
      if (seenPlayerIds.has(playerId)) {
        const existing = assignmentRecords.get(playerId);
        if (existing) {
          existing.repairNotes = [
            ...(existing.repairNotes ?? []),
            `Ignored duplicate House placement in Room ${proposedRoom.roomId}.`,
          ];
        }
        continue;
      }

      seenPlayerIds.add(playerId);
      addPlayerToRoom(rooms, playerId, proposedRoom.roomId);
      setAssignment(assignmentRecords, player, proposedRoom.roomId, "house", mingleIntents.get(playerId) ?? null);
      validHousePlacements += 1;
    }
  }

  const initialSource: MingleRoomAssignmentSource = validHousePlacements > 0 ? "repaired" : "fallback";
  for (const player of alivePlayers) {
    if (seenPlayerIds.has(player.id)) continue;

    const assignedRoomId = bestRoomIdForPlayer(player.id, rooms, mingleIntents, playerIdByName, roomCount, alivePlayers.length);
    addPlayerToRoom(rooms, player.id, assignedRoomId);
    seenPlayerIds.add(player.id);
    setAssignment(
      assignmentRecords,
      player,
      assignedRoomId,
      initialSource,
      mingleIntents.get(player.id) ?? null,
      [
        ...(rejectedAssignmentNotesByPlayerId.get(player.id) ?? []),
        validHousePlacements > 0 ? "Filled missing House assignment." : "No usable House assignment; deterministic fallback placed player.",
      ].join(" "),
    );
  }

  fillEmptyRooms(rooms, alivePlayers, mingleIntents, playerIdByName, assignmentRecords);

  const assignments = alivePlayers.map((player) => {
    const assignedRoomId = rooms.find((room) => room.playerIds.includes(player.id))?.roomId ?? 1;
    const record = assignmentRecords.get(player.id);
    return record ?? {
      player: buildPlayerRef(playerById, player.id),
      assignedRoomId,
      source: "fallback" as const,
      intent: mingleIntents.get(player.id) ?? null,
      repairNotes: ["Assignment record missing; deterministic fallback recorded final room."],
    };
  });

  return {
    rooms,
    diagnostics: {
      round,
      beat,
      roomCount,
      eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
      assignments,
      allocatedRooms: rooms.map((room) => ({
        roomId: room.roomId,
        beat: room.beat,
        players: room.playerIds.map((playerId) => buildPlayerRef(playerById, playerId)),
        conversationRan: room.playerIds.length >= 2,
      })),
    },
  };
}

function describeRoom(ctx: PhaseRunnerContext, room: RoomAllocation): string {
  const occupantNames = room.playerIds.map((id) => ctx.gameState.getPlayerName(id));
  return `Room ${room.roomId}: ${occupantNames.length > 0 ? occupantNames.join(", ") : "Empty"}`;
}

function buildRoomCounts(localRooms: RoomAllocation[]): MingleRoomCount[] {
  return localRooms.map((room) => ({ roomId: room.roomId, count: room.playerIds.length }));
}

function summarizeMingleIntent(intent: MingleIntentAction | null | undefined): MingleIntentSummary | null {
  if (!intent) return null;
  const { thinking: _thinking, reasoningContext: _reasoningContext, ...summary } = intent;
  return {
    ...summary,
    seekPlayers: [...summary.seekPlayers],
    avoidPlayers: [...summary.avoidPlayers],
  };
}

function normalizeMingleIntentForAlive(
  intent: MingleIntentAction | null,
  player: { id: UUID; name: string },
  alivePlayers: Array<{ id: UUID; name: string }>,
): { intent: MingleIntentAction | null; repairNotes: string[] } {
  if (!intent) return { intent: null, repairNotes: [] };

  const aliveByName = new Map(alivePlayers.map((alive) => [alive.name.toLowerCase(), alive]));
  const repairNotes: string[] = [];
  const normalizePlayerList = (names: readonly string[], fieldName: "seekPlayers" | "avoidPlayers"): string[] => {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      const candidate = aliveByName.get(name.toLowerCase());
      if (!candidate) {
        repairNotes.push(`Removed stale or unknown ${fieldName} name "${name}".`);
        continue;
      }
      if (candidate.id === player.id) {
        repairNotes.push(`Removed self from ${fieldName}.`);
        continue;
      }
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      normalized.push(candidate.name);
    }
    return normalized;
  };

  let provisionalTarget = intent.provisionalTarget;
  let noTargetReason = intent.noTargetReason;
  if (provisionalTarget) {
    const target = aliveByName.get(provisionalTarget.toLowerCase());
    if (!target || target.id === player.id) {
      repairNotes.push(`Cleared stale or invalid provisionalTarget "${provisionalTarget}".`);
      noTargetReason = noTargetReason
        ? `${noTargetReason} Stale provisional target "${provisionalTarget}" was cleared because active targets must be living other players.`
        : `Stale provisional target "${provisionalTarget}" was cleared because active targets must be living other players.`;
      provisionalTarget = null;
    } else {
      provisionalTarget = target.name;
    }
  }

  return {
    intent: {
      ...intent,
      seekPlayers: normalizePlayerList(intent.seekPlayers, "seekPlayers"),
      avoidPlayers: normalizePlayerList(intent.avoidPlayers, "avoidPlayers"),
      provisionalTarget,
      noTargetReason,
    },
    repairNotes,
  };
}

function buildRoomsFromAssignments(
  roomByPlayerId: Map<UUID, number>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCount: number,
  round: number,
  beat: number,
): RoomAllocation[] {
  const rooms: RoomAllocation[] = Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    round,
    beat,
    playerIds: [],
  }));

  for (const player of alivePlayers) {
    const localRoomId = roomByPlayerId.get(player.id) ?? 1;
    rooms[localRoomId - 1]?.playerIds.push(player.id);
  }

  return rooms;
}

function createAssignmentRecordsFromAssignments(
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomByPlayerId: Map<UUID, number>,
  mingleIntents: ReadonlyMap<UUID, MingleIntentAction | null>,
): MingleRoomAssignmentRecord[] {
  return alivePlayers.map((player) => {
    const assignedRoomId = roomByPlayerId.get(player.id) ?? 1;
    return {
      player: { id: player.id, name: player.name },
      assignedRoomId,
      source: "movement",
      intent: summarizeMingleIntent(mingleIntents.get(player.id) ?? null),
    };
  });
}

function normalizeGotoRoomId(
  gotoRoomId: number | null | undefined,
  currentRoomId: number,
  roomCount: number,
): { roomId: number; status: MingleRoomChoiceStatus; requestedRoomId: number | null } {
  if (gotoRoomId == null) {
    return { roomId: currentRoomId, status: "missing", requestedRoomId: null };
  }
  if (!Number.isInteger(gotoRoomId) || gotoRoomId < 1 || gotoRoomId > roomCount) {
    return { roomId: currentRoomId, status: "invalid", requestedRoomId: gotoRoomId };
  }
  return { roomId: gotoRoomId, status: "valid", requestedRoomId: gotoRoomId };
}

function normalizePlayerName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

interface CollectedMingleTurn {
  playerId: UUID;
  fromName: string;
  recipientNames: string[];
  roomId: number;
  turn: number;
  action: MingleTurnAction;
  message: string | null;
  messageSent: boolean;
  turnAction: "talk" | "no_reply";
}

interface MingleMovementResolution {
  toRoomId: number;
  gotoRoomId: number | null;
  gotoPlayerName: string | null;
  gotoRoomIgnored: boolean;
  gotoStatus: MingleRoomChoiceStatus;
}

function resolveMingleMovements(
  turns: readonly CollectedMingleTurn[],
  gameState: PhaseRunnerContext["gameState"],
  roomByPlayerId: ReadonlyMap<UUID, number>,
  roomCount: number,
): Map<UUID, MingleMovementResolution> {
  const turnByPlayerId = new Map(turns.map((turn) => [turn.playerId, turn]));
  const playerByName = new Map(gameState.getAllPlayers().map((player) => [player.name.toLowerCase(), player]));
  const alivePlayerIds = new Set(gameState.getAlivePlayers().map((player) => player.id));
  const resolved = new Map<UUID, MingleMovementResolution>();

  const resolvePlayer = (playerId: UUID, stack: Set<UUID>): MingleMovementResolution => {
    const cached = resolved.get(playerId);
    if (cached) return cached;

    const turn = turnByPlayerId.get(playerId);
    const currentRoomId = roomByPlayerId.get(playerId) ?? 1;
    const gotoPlayerName = normalizePlayerName(turn?.action.gotoPlayerName);
    const gotoRoomIgnored = gotoPlayerName !== null && turn?.action.gotoRoomId != null;

    if (gotoPlayerName) {
      const target = playerByName.get(gotoPlayerName.toLowerCase());
      if (!target) {
        const resolution = { toRoomId: currentRoomId, gotoRoomId: null, gotoPlayerName, gotoRoomIgnored, gotoStatus: "player_unknown" as const };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (target.id === playerId) {
        const resolution = { toRoomId: currentRoomId, gotoRoomId: null, gotoPlayerName, gotoRoomIgnored, gotoStatus: "player_self" as const };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (target.status !== PlayerStatus.ALIVE || !alivePlayerIds.has(target.id)) {
        const resolution = { toRoomId: currentRoomId, gotoRoomId: null, gotoPlayerName, gotoRoomIgnored, gotoStatus: "player_dead" as const };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (stack.has(target.id)) {
        const resolution = { toRoomId: currentRoomId, gotoRoomId: null, gotoPlayerName, gotoRoomIgnored, gotoStatus: "player_cycle" as const };
        resolved.set(playerId, resolution);
        return resolution;
      }

      stack.add(playerId);
      const targetResolution = resolvePlayer(target.id, stack);
      stack.delete(playerId);
      const resolution = {
        toRoomId: targetResolution.toRoomId,
        gotoRoomId: null,
        gotoPlayerName,
        gotoRoomIgnored,
        gotoStatus: gotoRoomIgnored ? "player_valid_room_ignored" as const : "player_valid" as const,
      };
      resolved.set(playerId, resolution);
      return resolution;
    }

    const normalizedGoto = normalizeGotoRoomId(turn?.action.gotoRoomId, currentRoomId, roomCount);
    const resolution = {
      toRoomId: normalizedGoto.roomId,
      gotoRoomId: normalizedGoto.requestedRoomId,
      gotoPlayerName: null,
      gotoRoomIgnored: false,
      gotoStatus: normalizedGoto.status,
    };
    resolved.set(playerId, resolution);
    return resolution;
  };

  for (const turn of turns) {
    resolvePlayer(turn.playerId, new Set());
  }

  return resolved;
}

async function runMingleTurn(
  ctx: PhaseRunnerContext,
  localRooms: RoomAllocation[],
  roomCounts: MingleRoomCount[],
  roomByPlayerId: Map<UUID, number>,
  roomCount: number,
  mingleIntents: ReadonlyMap<UUID, MingleIntentAction | null>,
  totalBeats: number,
  phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE,
): Promise<MingleTurnActionRecord[]> {
  const { agents, logger, contextBuilder, gameState } = ctx;
  const collectedTurns: CollectedMingleTurn[] = [];

  for (const room of localRooms) {
    if (room.playerIds.length === 0) continue;

    const roomMates = room.playerIds.map((id) => gameState.getPlayerName(id));
    const conversationHistory: Array<{ from: string; text: string }> = [];

    for (const playerId of room.playerIds) {
      const agent = agents.get(playerId)!;
      const fromName = gameState.getPlayerName(playerId);
      const recipientIds = room.playerIds.filter((id) => id !== playerId);
      const recipientNames = recipientIds.map((id) => gameState.getPlayerName(id));
      const phaseCtx = contextBuilder.buildPhaseContext(playerId, phase, undefined, undefined, {
        roomCount,
        roomCounts,
        currentRoomId: room.roomId,
        roomMates,
        mingleIntent: summarizeMingleIntent(mingleIntents.get(playerId) ?? null),
      });
      phaseCtx.mingleBeat = room.beat;
      phaseCtx.mingleTotalBeats = totalBeats;

      let resolvedAction: MingleTurnAction;
      if (agent.takeMingleTurn) {
        resolvedAction = await agent.takeMingleTurn(phaseCtx, roomMates, conversationHistory);
      } else {
        const response = await agent.sendRoomMessage(phaseCtx, roomMates, conversationHistory);
        resolvedAction = response
          ? { ...response, noReply: false, gotoRoomId: null, gotoPlayerName: null }
          : { thinking: "", message: null, noReply: true, gotoRoomId: null, gotoPlayerName: null };
      }

      await assertCanAcceptCommit(ctx);

      const message = resolvedAction.noReply ? null : resolvedAction.message?.trim();
      const messageSent = Boolean(message && recipientIds.length > 0);
      const turnAction = message ? "talk" : "no_reply";
      if (messageSent && message) {
        for (const recipientId of recipientIds) {
          const inbox = ctx.mingleInbox.get(recipientId) ?? [];
          inbox.push({ from: fromName, text: message });
          ctx.mingleInbox.set(recipientId, inbox);
        }

        conversationHistory.push({ from: fromName, text: message });
        const transcriptThinking = transcriptThinkingFor(agent, resolvedAction.thinking, resolvedAction.reasoningContext);
        logger.logMingleMessage(
          playerId,
          recipientIds,
          message,
          room.roomId,
          transcriptThinking.thinking,
          transcriptThinking.reasoningContext,
          phase,
          transcriptThinking.decisionId,
        );
      }

      collectedTurns.push({
        playerId,
        fromName,
        recipientNames,
        roomId: room.roomId,
        turn: room.beat,
        action: resolvedAction,
        message: message ?? null,
        messageSent,
        turnAction,
      });
    }
  }

  const movementResolutions = resolveMingleMovements(collectedTurns, gameState, roomByPlayerId, roomCount);
  const nextRoomByPlayerId = new Map(roomByPlayerId);
  const actionRecords: MingleTurnActionRecord[] = [];

  for (const turn of collectedTurns) {
    const movement = movementResolutions.get(turn.playerId) ?? {
      toRoomId: turn.roomId,
      gotoRoomId: null,
      gotoPlayerName: null,
      gotoRoomIgnored: false,
      gotoStatus: "missing" as const,
    };
    nextRoomByPlayerId.set(turn.playerId, movement.toRoomId);

    logger.emitAgentTurn({
      phase,
      action: "mingle-turn",
      actor: { id: turn.playerId, name: turn.fromName, role: "player" },
      visibility: "private",
      response: {
        action: turn.turnAction,
        message: turn.message,
        noReply: turn.action.noReply ?? !turn.message,
        messageDelivered: turn.messageSent,
        fromRoomId: turn.roomId,
        roomId: turn.roomId,
        toRoomId: movement.toRoomId,
        moved: movement.toRoomId !== turn.roomId,
        gotoRoomId: movement.gotoRoomId,
        gotoPlayerName: movement.gotoPlayerName,
        gotoRoomIgnored: movement.gotoRoomIgnored,
        gotoStatus: movement.gotoStatus,
        ...strategicDecisionResponse(turn.action),
      },
      thinking: turn.action.thinking,
      reasoningContext: turn.action.reasoningContext,
      scope: "mingle",
      ...(turn.message && { text: turn.message }),
      to: turn.recipientNames,
      roomId: turn.roomId,
    });

    actionRecords.push({
      player: { id: turn.playerId, name: turn.fromName },
      turn: turn.turn,
      fromRoomId: turn.roomId,
      toRoomId: movement.toRoomId,
      moved: movement.toRoomId !== turn.roomId,
      action: turn.messageSent ? "talk" : "no_reply",
      gotoRoomId: movement.gotoRoomId,
      gotoPlayerName: movement.gotoPlayerName,
      gotoRoomIgnored: movement.gotoRoomIgnored,
      gotoStatus: movement.gotoStatus,
    });
  }

  roomByPlayerId.clear();
  for (const [playerId, localRoomId] of nextRoomByPlayerId) {
    roomByPlayerId.set(playerId, localRoomId);
  }

  return actionRecords;
}

export async function runMinglePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  options: { phase?: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE; completePhase?: boolean } = {},
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;
  const phase = options.phase ?? Phase.MINGLE;
  const completePhase = options.completePhase ?? true;

  logger.emitPhaseChange(phase);
  logger.logSystem(
    phase === Phase.POST_VOTE_MINGLE
      ? "=== POST-VOTE MINGLE PHASE ==="
      : phase === Phase.MINGLE_I
        ? "=== MINGLE I: PRIVATE ROOMS ==="
        : "=== MINGLE PHASE ===",
    phase,
  );
  const alivePlayers = gameState.getAlivePlayers();

  ctx.mingleInbox.clear();
  for (const player of alivePlayers) {
    ctx.mingleInbox.set(player.id, []);
  }
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];
  contextBuilder.currentRoomCounts = [];

  const roomCount = computeRoomCount(alivePlayers.length);
  if (roomCount === 0) {
    logger.logSystem("Open rooms are skipped with fewer than five players alive.", phase);
    await assertCanAcceptCommit(ctx);
    gameState.recordRoomAllocations([], [], [], phase);
    if (completePhase) {
      actor.send({ type: "PHASE_COMPLETE" });
      await new Promise((r) => setTimeout(r, 0));
    }
    return;
  }

  const beats = config.mingleSessionsPerRound ?? 3;
  const allRooms: RoomAllocation[] = [];
  const initialRoomCounts: MingleRoomCount[] = Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    count: 0,
  }));
  contextBuilder.currentRoomCounts = initialRoomCounts;

  const mingleIntents = new Map<UUID, MingleIntentAction | null>();
  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, phase, undefined, undefined, {
        roomCount,
        roomCounts: initialRoomCounts,
      });
      const intent = agent.getMingleIntent ? await agent.getMingleIntent(phaseCtx) : null;
      const normalizedIntent = normalizeMingleIntentForAlive(intent, player, alivePlayers);
      mingleIntents.set(player.id, normalizedIntent.intent);
      if (normalizedIntent.intent) {
        const intentSummary = summarizeMingleIntent(normalizedIntent.intent);
        await assertCanAcceptCommit(ctx);
        logger.emitAgentTurn({
          phase,
          action: "mingle-intent",
          actor: { id: player.id, name: player.name, role: "player" },
          visibility: "private",
          response: {
            ...intentSummary,
            ...(normalizedIntent.repairNotes.length > 0 ? { repairNotes: normalizedIntent.repairNotes } : {}),
            ...strategicDecisionResponse(normalizedIntent.intent),
          },
          thinking: normalizedIntent.intent.thinking,
          reasoningContext: normalizedIntent.intent.reasoningContext,
        });
      }
    }),
  );

  const houseAssignment = await ctx.houseInterviewer.assignMingleRooms({
    round: gameState.round,
    roomCount,
    players: alivePlayers.map((player) => ({
      id: player.id,
      name: player.name,
      intent: summarizeMingleIntent(mingleIntents.get(player.id) ?? null),
    })),
  });

  const intentSummaries = new Map<UUID, MingleIntentSummary | null>(
    alivePlayers.map((player) => [player.id, summarizeMingleIntent(mingleIntents.get(player.id) ?? null)]),
  );
  const initialAllocation = allocateRooms(houseAssignment, alivePlayers, roomCount, gameState.round, 1, intentSummaries);
  await assertCanAcceptCommit(ctx);
  for (const assignment of initialAllocation.diagnostics.assignments) {
    logger.emitAgentTurn({
      phase,
      action: "mingle-room-assignment",
      actor: { id: assignment.player.id, name: assignment.player.name, role: "player" },
      visibility: "private",
      response: {
        assignedRoomId: assignment.assignedRoomId,
        assignmentSource: assignment.source,
        repairNotes: assignment.repairNotes ?? [],
        roomCount,
        ...(assignment.intent && { intent: assignment.intent }),
        ...(houseAssignment.rationale && { houseRationale: houseAssignment.rationale }),
      },
      thinking: houseAssignment.thinking,
      reasoningContext: houseAssignment.reasoningContext,
    });
  }
  const roomByPlayerId = new Map<UUID, number>();
  for (const room of initialAllocation.rooms) {
    for (const playerId of room.playerIds) {
      roomByPlayerId.set(playerId, room.roomId);
    }
  }

  for (let beat = 1; beat <= beats; beat++) {
    const localRooms = beat === 1
      ? initialAllocation.rooms
      : buildRoomsFromAssignments(roomByPlayerId, alivePlayers, roomCount, gameState.round, beat);
    const roomCounts = buildRoomCounts(localRooms);
    const beatRooms = localRooms;
    const beatDiagnostics: MingleSessionDiagnostics = beat === 1
      ? initialAllocation.diagnostics
      : {
          round: gameState.round,
          beat,
          roomCount,
          eligiblePlayers: alivePlayers.map((player) => ({ id: player.id, name: player.name })),
          assignments: createAssignmentRecordsFromAssignments(alivePlayers, roomByPlayerId, mingleIntents).map((assignment) => ({
            ...assignment,
          })),
          allocatedRooms: beatRooms.map((room) => ({
            roomId: room.roomId,
            beat: room.beat,
            players: room.playerIds.map((playerId) => ({
              id: playerId,
              name: gameState.getPlayerName(playerId),
            })),
            conversationRan: room.playerIds.length >= 2,
          })),
        };

    contextBuilder.currentRoomCounts = roomCounts;
    contextBuilder.currentRoomAllocations = beatRooms;
    allRooms.push(...beatRooms);

    const allocationText = `Turn ${beat}: ${beatRooms.map((room) => describeRoom(ctx, room)).join(" | ")}`;
    await assertCanAcceptCommit(ctx);
    const allocationEntry = logger.logRoomAllocation(allocationText, beatRooms, [], beatDiagnostics, phase);
    const actions = await runMingleTurn(ctx, localRooms, roomCounts, roomByPlayerId, roomCount, mingleIntents, beats, phase);
    if (allocationEntry.roomMetadata?.diagnostics) {
      allocationEntry.roomMetadata.diagnostics.actions = actions;
    }
  }

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [];
  contextBuilder.currentRoomCounts = buildRoomCounts(
    buildRoomsFromAssignments(roomByPlayerId, alivePlayers, roomCount, gameState.round, beats),
  );
  await assertCanAcceptCommit(ctx);
  gameState.recordRoomAllocations(allRooms, [], [], phase);

  if (completePhase) {
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }
}
