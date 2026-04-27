import type {
  UUID,
  RoomAllocation,
  WhisperRoomChoiceRecord,
  WhisperRoomPlayerRef,
  WhisperSessionDiagnostics,
} from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

export interface RoomAllocationOptions {
  rawChoices?: Map<UUID, number | null>;
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

export function allocateRooms(
  choices: Map<UUID, number | null>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCount: number,
  round: number,
  beat = 1,
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

  return {
    rooms,
    diagnostics: {
      round,
      beat,
      roomCount,
      eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
      choices: choiceRecords,
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

async function runRoomConversation(
  ctx: PhaseRunnerContext,
  room: RoomAllocation,
  roomCountForContext: number,
): Promise<void> {
  if (room.playerIds.length < 2) return;

  const { agents, logger, contextBuilder, gameState } = ctx;
  const roomMates = room.playerIds.map((id) => gameState.getPlayerName(id));
  const conversationHistory: Array<{ from: string; text: string }> = [];

  for (const playerId of room.playerIds) {
    const agent = agents.get(playerId)!;
    const fromName = gameState.getPlayerName(playerId);
    const recipientIds = room.playerIds.filter((id) => id !== playerId);
    const phaseCtx = contextBuilder.buildPhaseContext(playerId, Phase.WHISPER, undefined, undefined, {
      roomCount: roomCountForContext,
      roomMates,
    });
    const response = await agent.sendRoomMessage(phaseCtx, roomMates, conversationHistory);
    if (!response) continue;

    for (const recipientId of recipientIds) {
      const inbox = ctx.whisperInbox.get(recipientId) ?? [];
      inbox.push({ from: fromName, text: response.message });
      ctx.whisperInbox.set(recipientId, inbox);
    }

    conversationHistory.push({ from: fromName, text: response.message });
    logger.logWhisper(playerId, recipientIds, response.message, room.roomId, response.thinking);
  }
}

export async function runWhisperPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;

  logger.emitPhaseChange(Phase.WHISPER);
  logger.logSystem("=== WHISPER PHASE ===", Phase.WHISPER);
  const alivePlayers = gameState.getAlivePlayers();

  ctx.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];

  const roomCount = computeRoomCount(alivePlayers.length);
  if (roomCount === 0) {
    logger.logSystem("Open whisper rooms are skipped with fewer than five players alive.", Phase.WHISPER);
    gameState.recordRoomAllocations([], []);
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    return;
  }

  const beats = config.whisperSessionsPerRound ?? 2;
  const allRooms: RoomAllocation[] = [];
  let globalRoomId = 0;

  for (let beat = 1; beat <= beats; beat++) {
    const choices = new Map<UUID, number | null>();
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = agents.get(player.id)!;
        const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
        choices.set(player.id, await agent.chooseWhisperRoom(phaseCtx));
      }),
    );

    const { rooms, diagnostics } = allocateRooms(choices, alivePlayers, roomCount, gameState.round, beat);
    const beatRooms = rooms.map((room) => {
      globalRoomId++;
      return { ...room, roomId: globalRoomId };
    });
    const beatDiagnostics: WhisperSessionDiagnostics = {
      ...diagnostics,
      allocatedRooms: diagnostics.allocatedRooms.map((room, index) => ({
        ...room,
        roomId: beatRooms[index]?.roomId ?? room.roomId,
      })),
      choices: diagnostics.choices.map((choice) => ({
        ...choice,
        assignedRoomId: beatRooms[choice.assignedRoomId - 1]?.roomId ?? choice.assignedRoomId,
      })),
    };

    contextBuilder.currentRoomAllocations = beatRooms;
    allRooms.push(...beatRooms);

    const allocationText = `Beat ${beat}: ${beatRooms.map((room) => describeRoom(ctx, room)).join(" | ")}`;
    logger.logRoomAllocation(allocationText, beatRooms, [], beatDiagnostics);
    await Promise.all(beatRooms.map((room) => runRoomConversation(ctx, room, roomCount)));
  }

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [];
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
