import type {
  UUID,
  MingleTurnActionRecord,
  RoomAllocation,
  MingleRoomAssignmentRecord,
  MingleRoomAssignmentSource,
  MingleRoomPlayerRef,
  MingleRoomCount,
  MingleIntentSummary,
  MingleSessionDiagnostics,
} from "../types";
import { Phase } from "../types";
import { formatMingleRoomAssignmentOperatorText } from "../operator-turn-text";
import type { HouseMingleAssignmentResult } from "../house-interviewer";
import {
  assertCanAcceptCommit,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
import {
  commitMingleTurnMovements,
  computeMingleRoomCount,
  DEFAULT_MINGLE_BEATS,
  executeMingleTurn,
  initializeMingleExecution,
  type CollectedMingleTurn,
} from "../mingle-turn-execution";

/**
 * Neutral open rooms replace pair matching. Rooms are available only while the
 * normal social game has at least five alive players.
 */
export function computeRoomCount(aliveCount: number): number {
  return computeMingleRoomCount(aliveCount);
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
): MingleRoomAssignmentRecord[] {
  return alivePlayers.map((player) => {
    const assignedRoomId = roomByPlayerId.get(player.id) ?? 1;
    return {
      player: { id: player.id, name: player.name },
      assignedRoomId,
      source: "movement",
    };
  });
}

async function runMingleTurn(
  ctx: PhaseRunnerContext,
  localRooms: RoomAllocation[],
  roomCounts: MingleRoomCount[],
  roomByPlayerId: Map<UUID, number>,
  roomCount: number,
  totalBeats: number,
  phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE | Phase.FORMAT_MINGLE,
): Promise<MingleTurnActionRecord[]> {
  const collectedTurns: CollectedMingleTurn[] = [];

  for (const room of localRooms) {
    if (room.playerIds.length === 0) continue;

    const conversationHistory: Array<{ from: string; text: string }> = [];

    for (const playerId of room.playerIds) {
      collectedTurns.push(await executeMingleTurn({
        ctx,
        phase,
        room,
        playerId,
        roomCount,
        roomCounts,
        mingleIntent: null,
        totalBeats,
        conversationHistory,
      }));
    }
  }
  return commitMingleTurnMovements({
    ctx,
    turns: collectedTurns,
    roomByPlayerId,
    roomCount,
    phase,
    mode: "live",
  });
}

/** Serializable phase-local state; no closures, Maps or model clients cross a beat boundary. */
export interface MingleWindowState {
  phase: Phase.MINGLE | Phase.MINGLE_I | Phase.POST_VOTE_MINGLE | Phase.FORMAT_MINGLE;
  alivePlayers: Array<{ id: UUID; name: string }>;
  roomCount: number;
  beats: number;
  nextBeat: number;
  initialAllocation: ReturnType<typeof allocateRooms>;
  roomByPlayerId: Record<UUID, number>;
  allRooms: RoomAllocation[];
}

export async function beginMingleWindow(
  ctx: PhaseRunnerContext,
  phase: MingleWindowState["phase"],
): Promise<MingleWindowState | null> {
  const { gameState, logger, config } = ctx;
  const {
    alivePlayers,
    roomCount,
  } = initializeMingleExecution(ctx, phase);
  if (roomCount === 0) {
    logger.logSystem("Open rooms are skipped with fewer than five players alive.", phase);
    await assertCanAcceptCommit(ctx);
    gameState.recordRoomAllocations([], [], [], phase);
    return null;
  }

  const beats = config.mingleSessionsPerRound ?? DEFAULT_MINGLE_BEATS;
  const pressure = ctx.formatKernelState.pressure;
  const houseAssignment = await ctx.houseInterviewer.assignMingleRooms({
    round: gameState.round,
    phase,
    roomCount,
    selectedFormatId: pressure?.selectedFormat ?? null,
    formatRuleSummary: pressure?.ruleSheetSummary ?? null,
    players: alivePlayers.map((player) => ({ id: player.id, name: player.name })),
  });

  const initialAllocation = allocateRooms(houseAssignment, alivePlayers, roomCount, gameState.round, 1);
  await assertCanAcceptCommit(ctx);
  const roommatesByPlayer = new Map<UUID, string[]>();
  for (const room of initialAllocation.rooms) {
    const names = room.playerIds.map((id) => gameState.getPlayerName(id));
    for (const playerId of room.playerIds) {
      roommatesByPlayer.set(
        playerId,
        names.filter((name) => name !== gameState.getPlayerName(playerId)),
      );
    }
  }
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
        roommates: roommatesByPlayer.get(assignment.player.id) ?? [],
        ...(assignment.intent && { intent: assignment.intent }),
        ...(houseAssignment.rationale && { houseRationale: houseAssignment.rationale }),
      },
      thinking: houseAssignment.thinking,
      reasoningContext: houseAssignment.reasoningContext,
      text: formatMingleRoomAssignmentOperatorText({
        playerName: assignment.player.name,
        assignedRoomId: assignment.assignedRoomId,
        assignmentSource: assignment.source,
        roommateNames: roommatesByPlayer.get(assignment.player.id) ?? [],
        repairNotes: assignment.repairNotes,
      }),
    });
  }
  const roomByPlayerId = new Map<UUID, number>();
  for (const room of initialAllocation.rooms) {
    for (const playerId of room.playerIds) {
      roomByPlayerId.set(playerId, room.roomId);
    }
  }

  return { phase, alivePlayers: alivePlayers.map(({ id, name }) => ({ id, name })), roomCount, beats, nextBeat: 1, initialAllocation,
    roomByPlayerId: Object.fromEntries(roomByPlayerId), allRooms: [] };
}

/** Current committed arrangement, including empty rooms. */
export function mingleWindowRooms(state: MingleWindowState): RoomAllocation[] {
  if (state.nextBeat > state.beats) return [];
  return state.nextBeat === 1 ? structuredClone(state.initialAllocation.rooms)
    : buildRoomsFromAssignments(new Map(Object.entries(state.roomByPlayerId)), state.alivePlayers, state.roomCount, state.initialAllocation.diagnostics.round, state.nextBeat);
}

/** Collect a whole beat before applying its simultaneous movement decisions. */
export async function advanceMingleWindow(ctx: PhaseRunnerContext, state: MingleWindowState): Promise<MingleWindowState> {
  assertMingleWindowRoster(ctx, state);
  state = structuredClone(state);
  if (state.nextBeat < 1 || state.nextBeat > state.beats) throw new Error("Mingle window has no pending beat");
  const { gameState, logger, contextBuilder } = ctx;
  const { phase, alivePlayers, roomCount, beats, initialAllocation } = state;
  const beat = state.nextBeat;
  const allRooms = [...state.allRooms];
  const roomByPlayerId = new Map(Object.entries(state.roomByPlayerId));
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
        assignments: createAssignmentRecordsFromAssignments(alivePlayers, roomByPlayerId).map((assignment) => ({
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
  const actions = await runMingleTurn(ctx, localRooms, roomCounts, roomByPlayerId, roomCount, beats, phase);
  if (allocationEntry.roomMetadata?.diagnostics) {
    allocationEntry.roomMetadata.diagnostics.actions = actions;
  }
  return { ...state, nextBeat: beat + 1, allRooms, roomByPlayerId: Object.fromEntries(roomByPlayerId) };
}

export async function finishMingleWindow(ctx: PhaseRunnerContext, state: MingleWindowState): Promise<void> {
  assertMingleWindowRoster(ctx, state);
  if (state.nextBeat !== state.beats + 1) throw new Error("Cannot finish Mingle before every beat completes");
  const { gameState, contextBuilder } = ctx;
  const { phase, alivePlayers, roomCount, beats, allRooms } = state;
  const roomByPlayerId = new Map(Object.entries(state.roomByPlayerId));

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [];
  contextBuilder.currentRoomCounts = buildRoomCounts(
    buildRoomsFromAssignments(roomByPlayerId, alivePlayers, roomCount, gameState.round, beats),
  );
  await assertCanAcceptCommit(ctx);
  gameState.recordRoomAllocations(allRooms, [], [], phase);

}

function assertMingleWindowRoster(ctx: PhaseRunnerContext, state: MingleWindowState): void {
  const alive = ctx.gameState.getAlivePlayers();
  if (state.initialAllocation.diagnostics.round !== ctx.gameState.round
    || alive.length !== state.alivePlayers.length
    || state.alivePlayers.some((player) => !alive.some((current) => current.id === player.id && current.name === player.name))) {
    throw new Error("Mingle window does not match the canonical round and roster");
  }
}

export async function runMinglePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  options: { phase?: MingleWindowState["phase"]; completePhase?: boolean } = {},
): Promise<void> {
  let window = await beginMingleWindow(ctx, options.phase ?? Phase.MINGLE);
  if (window) {
    while (window.nextBeat <= window.beats) window = await advanceMingleWindow(ctx, window);
    await finishMingleWindow(ctx, window);
  }
  if (options.completePhase ?? true) {
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
