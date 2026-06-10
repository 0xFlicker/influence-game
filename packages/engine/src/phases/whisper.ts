import type {
  UUID,
  MingleTurnActionRecord,
  RoomAllocation,
  WhisperRoomChoiceRecord,
  WhisperRoomPlayerRef,
  WhisperRoomChoiceStatus,
  WhisperRoomCount,
  WhisperSessionDiagnostics,
} from "../types";
import { Phase } from "../types";
import type { MingleTurnAction } from "../game-runner.types";
import type { GameState } from "../game-state";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

export interface RoomAllocationOptions {
  rawChoices?: Map<UUID, number | null>;
  cooldownPairKeys?: ReadonlySet<string>;
}

/**
 * Neutral open rooms replace pair matching. Rooms are available only while the
 * normal social game has at least five alive players.
 */
export function computeRoomCount(aliveCount: number): number {
  if (aliveCount < 5) return 0;
  return Math.ceil(aliveCount / 3);
}

function buildPlayerRef(
  playerById: Map<UUID, { id: UUID; name: string }>,
  playerId: UUID,
): WhisperRoomPlayerRef {
  return {
    id: playerId,
    name: playerById.get(playerId)?.name ?? playerId,
  };
}

function normalizeRoomChoice(choice: number | null | undefined, roomCount: number): {
  roomId: number;
  status: WhisperRoomChoiceRecord["status"];
} {
  if (choice == null) return { roomId: 1, status: "missing" };
  if (!Number.isInteger(choice) || choice < 1 || choice > roomCount) {
    return { roomId: 1, status: "invalid" };
  }
  return { roomId: choice, status: "valid" };
}

function pairKey(a: UUID, b: UUID): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function addRoomPairKeys(keys: Set<string>, rooms: readonly RoomAllocation[]): void {
  for (const room of rooms) {
    for (let i = 0; i < room.playerIds.length; i++) {
      for (let j = i + 1; j < room.playerIds.length; j++) {
        const first = room.playerIds[i];
        const second = room.playerIds[j];
        if (first && second) keys.add(pairKey(first, second));
      }
    }
  }
}

function buildRecentCooldownPairKeys(
  gameState: GameState,
  cooldownRounds: number,
): Set<string> {
  const keys = new Set<string>();
  if (cooldownRounds < 1) return keys;

  const firstRound = Math.max(1, gameState.round - cooldownRounds);
  for (let round = firstRound; round < gameState.round; round++) {
    const allocations = gameState.getRoomAllocations(round);
    if (allocations) addRoomPairKeys(keys, allocations.rooms);
  }

  return keys;
}

function countCooldownPairConflicts(
  rooms: readonly RoomAllocation[],
  cooldownPairKeys: ReadonlySet<string>,
): number {
  let conflicts = 0;
  for (const room of rooms) {
    for (let i = 0; i < room.playerIds.length; i++) {
      for (let j = i + 1; j < room.playerIds.length; j++) {
        const first = room.playerIds[i];
        const second = room.playerIds[j];
        if (first && second && cooldownPairKeys.has(pairKey(first, second))) {
          conflicts += 1;
        }
      }
    }
  }
  return conflicts;
}

function movePlayerToRoom(
  rooms: readonly RoomAllocation[],
  playerId: UUID,
  toRoomId: number,
): RoomAllocation[] {
  return rooms.map((room) => {
    if (room.playerIds.includes(playerId)) {
      return { ...room, playerIds: room.playerIds.filter((id) => id !== playerId) };
    }
    if (room.roomId === toRoomId) {
      return { ...room, playerIds: [...room.playerIds, playerId] };
    }
    return { ...room, playerIds: [...room.playerIds] };
  });
}

function applyPairCooldown(
  rooms: RoomAllocation[],
  roomCount: number,
  cooldownPairKeys: ReadonlySet<string> | undefined,
): RoomAllocation[] {
  if (!cooldownPairKeys || cooldownPairKeys.size === 0 || roomCount < 2) {
    return rooms;
  }

  let adjusted = rooms.map((room) => ({ ...room, playerIds: [...room.playerIds] }));
  let currentConflicts = countCooldownPairConflicts(adjusted, cooldownPairKeys);
  const maxIterations = adjusted.reduce((sum, room) => sum + room.playerIds.length, 0) * roomCount;

  for (let iteration = 0; iteration < maxIterations && currentConflicts > 0; iteration++) {
    let bestMove:
      | { playerId: UUID; fromRoomId: number; toRoomId: number; conflicts: number; destinationSize: number }
      | null = null;

    for (const room of adjusted) {
      for (const playerId of room.playerIds) {
        for (let toRoomId = 1; toRoomId <= roomCount; toRoomId++) {
          if (toRoomId === room.roomId) continue;

          const candidate = movePlayerToRoom(adjusted, playerId, toRoomId);
          const conflicts = countCooldownPairConflicts(candidate, cooldownPairKeys);
          if (conflicts >= currentConflicts) continue;

          const destinationSize = adjusted.find((candidateRoom) => candidateRoom.roomId === toRoomId)?.playerIds.length ?? 0;
          if (
            !bestMove ||
            conflicts < bestMove.conflicts ||
            (conflicts === bestMove.conflicts && destinationSize < bestMove.destinationSize) ||
            (conflicts === bestMove.conflicts &&
              destinationSize === bestMove.destinationSize &&
              `${playerId}:${toRoomId}` < `${bestMove.playerId}:${bestMove.toRoomId}`)
          ) {
            bestMove = { playerId, fromRoomId: room.roomId, toRoomId, conflicts, destinationSize };
          }
        }
      }
    }

    if (!bestMove) break;
    adjusted = movePlayerToRoom(adjusted, bestMove.playerId, bestMove.toRoomId);
    currentConflicts = bestMove.conflicts;
  }

  return adjusted;
}

function syncRoomAssignments(
  roomByPlayerId: Map<UUID, number>,
  rooms: readonly RoomAllocation[],
): void {
  roomByPlayerId.clear();
  for (const room of rooms) {
    for (const playerId of room.playerIds) {
      roomByPlayerId.set(playerId, room.roomId);
    }
  }
}

export function allocateRooms(
  choices: Map<UUID, number | null>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCount: number,
  round: number,
  beat = 1,
  options: RoomAllocationOptions = {},
): {
  rooms: RoomAllocation[];
  diagnostics: WhisperSessionDiagnostics;
} {
  const rooms: RoomAllocation[] = Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    round,
    beat,
    playerIds: [],
  }));
  const playerById = new Map(alivePlayers.map((player) => [player.id, player]));
  const choiceRecords: WhisperRoomChoiceRecord[] = [];

  if (roomCount < 1) {
    return {
      rooms,
      diagnostics: {
        round,
        beat,
        roomCount,
        eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
        choices: [],
        allocatedRooms: [],
      },
    };
  }

  for (const player of alivePlayers) {
    const rawChoice = choices.get(player.id);
    const normalized = normalizeRoomChoice(rawChoice, roomCount);
    rooms[normalized.roomId - 1]?.playerIds.push(player.id);
    choiceRecords.push({
      player: buildPlayerRef(playerById, player.id),
      requestedRoomId: rawChoice ?? null,
      assignedRoomId: normalized.roomId,
      status: normalized.status,
    });
  }

  const adjustedRooms = applyPairCooldown(rooms, roomCount, options.cooldownPairKeys);
  const assignedRoomByPlayerId = new Map<UUID, number>();
  for (const room of adjustedRooms) {
    for (const playerId of room.playerIds) {
      assignedRoomByPlayerId.set(playerId, room.roomId);
    }
  }

  return {
    rooms: adjustedRooms,
    diagnostics: {
      round,
      beat,
      roomCount,
      eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
      choices: choiceRecords.map((choice) => ({
        ...choice,
        assignedRoomId: assignedRoomByPlayerId.get(choice.player.id) ?? choice.assignedRoomId,
      })),
      allocatedRooms: adjustedRooms.map((room) => ({
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

function buildRoomCounts(localRooms: RoomAllocation[]): WhisperRoomCount[] {
  return localRooms.map((room) => ({ roomId: room.roomId, count: room.playerIds.length }));
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

function assignGlobalRoomIds(
  localRooms: RoomAllocation[],
  firstRoomId: number,
): { rooms: RoomAllocation[]; roomIdByLocalRoomId: Map<number, number>; nextRoomId: number } {
  let nextRoomId = firstRoomId;
  const roomIdByLocalRoomId = new Map<number, number>();
  const rooms = localRooms.map((room) => {
    const globalRoomId = nextRoomId++;
    roomIdByLocalRoomId.set(room.roomId, globalRoomId);
    return { ...room, roomId: globalRoomId };
  });
  return { rooms, roomIdByLocalRoomId, nextRoomId };
}

function createChoiceRecordsFromAssignments(
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomByPlayerId: Map<UUID, number>,
): WhisperRoomChoiceRecord[] {
  return alivePlayers.map((player) => {
    const assignedRoomId = roomByPlayerId.get(player.id) ?? 1;
    return {
      player: { id: player.id, name: player.name },
      requestedRoomId: assignedRoomId,
      assignedRoomId,
      status: "valid",
    };
  });
}

function remapDiagnostics(
  diagnostics: WhisperSessionDiagnostics,
  roomIdByLocalRoomId: Map<number, number>,
): WhisperSessionDiagnostics {
  return {
    ...diagnostics,
    allocatedRooms: diagnostics.allocatedRooms.map((room) => ({
      ...room,
      roomId: roomIdByLocalRoomId.get(room.roomId) ?? room.roomId,
    })),
    choices: diagnostics.choices.map((choice) => ({
      ...choice,
      assignedRoomId: roomIdByLocalRoomId.get(choice.assignedRoomId) ?? choice.assignedRoomId,
    })),
  };
}

function normalizeGotoRoomId(
  gotoRoomId: number | null | undefined,
  currentRoomId: number,
  roomCount: number,
): { roomId: number; status: WhisperRoomChoiceStatus; requestedRoomId: number | null } {
  if (gotoRoomId == null) {
    return { roomId: currentRoomId, status: "missing", requestedRoomId: null };
  }
  if (!Number.isInteger(gotoRoomId) || gotoRoomId < 1 || gotoRoomId > roomCount) {
    return { roomId: currentRoomId, status: "invalid", requestedRoomId: gotoRoomId };
  }
  return { roomId: gotoRoomId, status: "valid", requestedRoomId: gotoRoomId };
}

async function runMingleTurn(
  ctx: PhaseRunnerContext,
  localRooms: RoomAllocation[],
  globalRooms: RoomAllocation[],
  roomCounts: WhisperRoomCount[],
  roomByPlayerId: Map<UUID, number>,
  roomCount: number,
): Promise<MingleTurnActionRecord[]> {
  const { agents, logger, contextBuilder, gameState } = ctx;
  const nextRoomByPlayerId = new Map(roomByPlayerId);
  const globalRoomByLocalId = new Map(localRooms.map((room, index) => [room.roomId, globalRooms[index]?.roomId ?? room.roomId]));
  const actionRecords: MingleTurnActionRecord[] = [];

  for (const room of localRooms) {
    if (room.playerIds.length === 0) continue;

    const globalRoomId = globalRoomByLocalId.get(room.roomId) ?? room.roomId;
    const roomMates = room.playerIds.map((id) => gameState.getPlayerName(id));
    const conversationHistory: Array<{ from: string; text: string }> = [];

    for (const playerId of room.playerIds) {
      const agent = agents.get(playerId)!;
      const fromName = gameState.getPlayerName(playerId);
      const recipientIds = room.playerIds.filter((id) => id !== playerId);
      const phaseCtx = contextBuilder.buildPhaseContext(playerId, Phase.WHISPER, undefined, undefined, {
        roomCount,
        roomCounts,
        currentRoomId: room.roomId,
        roomMates,
      });

      let resolvedAction: MingleTurnAction;
      if (agent.takeMingleTurn) {
        resolvedAction = await agent.takeMingleTurn(phaseCtx, roomMates, conversationHistory);
      } else {
        const response = await agent.sendRoomMessage(phaseCtx, roomMates, conversationHistory);
        resolvedAction = response
          ? { ...response, noReply: false, gotoRoomId: null }
          : { thinking: "", message: null, noReply: true, gotoRoomId: null };
      }

      const normalizedGoto = normalizeGotoRoomId(resolvedAction.gotoRoomId, room.roomId, roomCount);
      nextRoomByPlayerId.set(playerId, normalizedGoto.roomId);

      const message = resolvedAction.noReply ? null : resolvedAction.message?.trim();
      const messageSent = Boolean(message && recipientIds.length > 0);
      if (messageSent && message) {
        for (const recipientId of recipientIds) {
          const inbox = ctx.whisperInbox.get(recipientId) ?? [];
          inbox.push({ from: fromName, text: message });
          ctx.whisperInbox.set(recipientId, inbox);
        }

        conversationHistory.push({ from: fromName, text: message });
        logger.logWhisper(playerId, recipientIds, message, globalRoomId, resolvedAction.thinking);
      }

      actionRecords.push({
        player: { id: playerId, name: fromName },
        turn: room.beat,
        fromRoomId: room.roomId,
        toRoomId: normalizedGoto.roomId,
        moved: normalizedGoto.roomId !== room.roomId,
        action: messageSent ? "talk" : "no_reply",
        gotoRoomId: normalizedGoto.requestedRoomId,
        gotoStatus: normalizedGoto.status,
      });
    }
  }

  roomByPlayerId.clear();
  for (const [playerId, localRoomId] of nextRoomByPlayerId) {
    roomByPlayerId.set(playerId, localRoomId);
  }

  return actionRecords;
}

export async function runWhisperPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;

  logger.emitPhaseChange(Phase.WHISPER);
  logger.logSystem("=== WHISPER PHASE ===", Phase.WHISPER);
  const alivePlayers = gameState.getAlivePlayers();

  ctx.whisperInbox.clear();
  for (const player of alivePlayers) {
    ctx.whisperInbox.set(player.id, []);
  }
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];
  contextBuilder.currentRoomCounts = [];

  const rawRoomCount = computeRoomCount(alivePlayers.length);
  const forceMingle = config.mingleUntilPlayers != null && alivePlayers.length >= config.mingleUntilPlayers;

  let roomCount = rawRoomCount;
  if (roomCount === 0 && forceMingle) {
    // Force at least a couple of rooms so Mingle testing can continue down to the target count (e.g. 4).
    roomCount = Math.max(2, Math.ceil(alivePlayers.length / 2));
  }

  if (roomCount === 0) {
    logger.logSystem("Open whisper rooms are skipped with fewer than five players alive.", Phase.WHISPER);
    gameState.recordRoomAllocations([], []);
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    return;
  }

  const beats = config.whisperSessionsPerRound ?? 2;
  const allRooms: RoomAllocation[] = [];
  let nextGlobalRoomId = 1;
  const initialRoomCounts: WhisperRoomCount[] = Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    count: 0,
  }));
  contextBuilder.currentRoomCounts = initialRoomCounts;
  const cooldownRounds = config.minglePairCooldownRounds ?? 0;
  const cooldownPairKeys = buildRecentCooldownPairKeys(gameState, cooldownRounds);

  const choices = new Map<UUID, number | null>();
  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, {
        roomCount,
        roomCounts: initialRoomCounts,
      });
      choices.set(player.id, await agent.chooseWhisperRoom(phaseCtx));
    }),
  );

  const initialAllocation = allocateRooms(choices, alivePlayers, roomCount, gameState.round, 1, {
    cooldownPairKeys,
  });
  const roomByPlayerId = new Map<UUID, number>();
  for (const room of initialAllocation.rooms) {
    for (const playerId of room.playerIds) {
      roomByPlayerId.set(playerId, room.roomId);
    }
  }

  for (let beat = 1; beat <= beats; beat++) {
    let localRooms = beat === 1
      ? initialAllocation.rooms
      : buildRoomsFromAssignments(roomByPlayerId, alivePlayers, roomCount, gameState.round, beat);
    if (beat > 1 && cooldownRounds > 0) {
      localRooms = applyPairCooldown(localRooms, roomCount, cooldownPairKeys);
      syncRoomAssignments(roomByPlayerId, localRooms);
    }
    const roomCounts = buildRoomCounts(localRooms);
    const globalAssignment = assignGlobalRoomIds(localRooms, nextGlobalRoomId);
    nextGlobalRoomId = globalAssignment.nextRoomId;
    const beatRooms = globalAssignment.rooms;
    const beatDiagnostics: WhisperSessionDiagnostics = beat === 1
      ? remapDiagnostics(initialAllocation.diagnostics, globalAssignment.roomIdByLocalRoomId)
      : {
          round: gameState.round,
          beat,
          roomCount,
          eligiblePlayers: alivePlayers.map((player) => ({ id: player.id, name: player.name })),
          choices: createChoiceRecordsFromAssignments(alivePlayers, roomByPlayerId).map((choice) => ({
            ...choice,
            assignedRoomId: globalAssignment.roomIdByLocalRoomId.get(choice.assignedRoomId) ?? choice.assignedRoomId,
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
    const allocationEntry = logger.logRoomAllocation(allocationText, beatRooms, [], beatDiagnostics);
    const actions = await runMingleTurn(ctx, localRooms, beatRooms, roomCounts, roomByPlayerId, roomCount);
    if (cooldownRounds > 0) {
      addRoomPairKeys(cooldownPairKeys, localRooms);
    }
    if (allocationEntry.roomMetadata?.diagnostics) {
      allocationEntry.roomMetadata.diagnostics.actions = actions;
    }
  }

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [];
  contextBuilder.currentRoomCounts = buildRoomCounts(
    buildRoomsFromAssignments(roomByPlayerId, alivePlayers, roomCount, gameState.round, beats),
  );
  gameState.recordRoomAllocations(allRooms, []);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runReckoningWhisper(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  await runWhisperPhase(ctx, actor);
}
