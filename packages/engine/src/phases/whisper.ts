import type { UUID, RoomAllocation } from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

/**
 * Compute the number of whisper rooms for the current round.
 * Formula: max(1, floor(alivePlayers / 2) - 1)
 */
export function computeRoomCount(aliveCount: number): number {
  return Math.max(1, Math.floor(aliveCount / 2) - 1);
}

/**
 * Allocate rooms based on player preferences using mutual-match-first logic.
 */
export function allocateRooms(
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCountLimit: number,
  round: number,
): { rooms: RoomAllocation[]; excluded: UUID[] } {
  const rooms: RoomAllocation[] = [];
  const paired = new Set<UUID>();

  // Step 1: Mutual matches first
  for (const [playerId, partnerId] of requests) {
    if (paired.has(playerId) || paired.has(partnerId)) continue;
    if (rooms.length >= roomCountLimit) break;
    if (requests.get(partnerId) === playerId) {
      rooms.push({ roomId: rooms.length + 1, playerA: playerId, playerB: partnerId, round });
      paired.add(playerId);
      paired.add(partnerId);
    }
  }

  // Step 2: Remaining requests by order
  for (const [playerId, partnerId] of requests) {
    if (rooms.length >= roomCountLimit) break;
    if (paired.has(playerId)) continue;
    if (paired.has(partnerId)) continue;
    rooms.push({ roomId: rooms.length + 1, playerA: playerId, playerB: partnerId, round });
    paired.add(playerId);
    paired.add(partnerId);
  }

  const excluded = alivePlayers
    .filter((p) => !paired.has(p.id))
    .map((p) => p.id);

  return { rooms, excluded };
}

/**
 * Run a turn-based conversation in a single whisper room.
 */
async function runRoomConversation(
  ctx: PhaseRunnerContext,
  room: RoomAllocation,
  roomCountForContext: number,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;
  const MAX_MESSAGES_PER_AGENT = config.maxWhisperExchanges ?? 2;
  const nameA = gameState.getPlayerName(room.playerA);
  const nameB = gameState.getPlayerName(room.playerB);

  const conversationHistory: Array<{ from: string; text: string }> = [];
  const msgCount = new Map<UUID, number>([[room.playerA, 0], [room.playerB, 0]]);
  let consecutivePasses = 0;

  let currentPlayerId: UUID = room.playerA;

  while (consecutivePasses < 2) {
    const partnerId = currentPlayerId === room.playerA ? room.playerB : room.playerA;
    const partnerName = currentPlayerId === room.playerA ? nameB : nameA;
    const currentName = currentPlayerId === room.playerA ? nameA : nameB;

    if ((msgCount.get(currentPlayerId) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
      consecutivePasses++;
      currentPlayerId = partnerId;
      continue;
    }

    const agent = agents.get(currentPlayerId)!;
    const phaseCtx = contextBuilder.buildPhaseContext(currentPlayerId, Phase.WHISPER, undefined, undefined, {
      roomCount: roomCountForContext,
      roomPartner: partnerName,
    });

    const text = await agent.sendRoomMessage(phaseCtx, partnerName, conversationHistory);

    if (text === null || text === "") {
      consecutivePasses++;
    } else {
      consecutivePasses = 0;
      msgCount.set(currentPlayerId, (msgCount.get(currentPlayerId) ?? 0) + 1);

      const inbox = ctx.whisperInbox.get(partnerId) ?? [];
      inbox.push({ from: currentName, text });
      ctx.whisperInbox.set(partnerId, inbox);

      conversationHistory.push({ from: currentName, text });
      logger.logWhisper(currentPlayerId, [partnerId], text, room.roomId);
    }

    if ((msgCount.get(room.playerA) ?? 0) >= MAX_MESSAGES_PER_AGENT &&
        (msgCount.get(room.playerB) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
      break;
    }

    currentPlayerId = partnerId;
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

  const maxPairsPerAgent = config.maxWhisperPairsPerAgent ?? 3;
  const sessionsPerRound = config.whisperSessionsPerRound ?? 2;

  const conversationCount = new Map<UUID, number>(alivePlayers.map((p) => [p.id, 0]));
  const allRooms: RoomAllocation[] = [];
  const allExcluded = new Set<UUID>();
  let globalRoomId = 0;

  for (let session = 0; session < sessionsPerRound; session++) {
    const eligible = alivePlayers.filter(
      (p) => (conversationCount.get(p.id) ?? 0) < maxPairsPerAgent,
    );
    if (eligible.length < 2) break;

    const roomCount = computeRoomCount(eligible.length);

    const requests = new Map<UUID, UUID>();
    await Promise.all(
      eligible.map(async (player) => {
        const agent = agents.get(player.id)!;
        const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
        const partnerId = await agent.requestRoom(phaseCtx);
        if (partnerId && eligible.some((p) => p.id === partnerId)) {
          requests.set(player.id, partnerId);
        }
      }),
    );

    const { rooms, excluded } = allocateRooms(requests, eligible, roomCount, gameState.round);

    const sessionRooms = rooms.map((r) => {
      globalRoomId++;
      return { ...r, roomId: globalRoomId };
    });

    for (const room of sessionRooms) {
      conversationCount.set(room.playerA, (conversationCount.get(room.playerA) ?? 0) + 1);
      conversationCount.set(room.playerB, (conversationCount.get(room.playerB) ?? 0) + 1);
    }

    allRooms.push(...sessionRooms);
    for (const id of excluded) allExcluded.add(id);

    const roomDescriptions = sessionRooms.map((r) => {
      const nameA = gameState.getPlayerName(r.playerA);
      const nameB = gameState.getPlayerName(r.playerB);
      return `Room ${r.roomId}: ${nameA} & ${nameB}`;
    });
    const excludedNames = excluded.map((id) => gameState.getPlayerName(id));
    const sessionLabel = sessionsPerRound > 1 ? ` (session ${session + 1})` : "";
    const allocationText = roomDescriptions.join(" | ") +
      (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "") +
      sessionLabel;
    logger.logRoomAllocation(allocationText, sessionRooms, excludedNames);

    await Promise.all(sessionRooms.map((room) => runRoomConversation(ctx, room, roomCount)));
  }

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [...allExcluded];
  gameState.recordRoomAllocations(allRooms, [...allExcluded]);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runReckoningWhisper(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.WHISPER);
  logger.logSystem("=== RECKONING: WHISPER PHASE ===", Phase.WHISPER);
  const alivePlayers = gameState.getAlivePlayers();

  ctx.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];

  const roomCount = computeRoomCount(alivePlayers.length);

  const requests = new Map<UUID, UUID>();
  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
      const partnerId = await agent.requestRoom(phaseCtx);
      if (partnerId) {
        requests.set(player.id, partnerId);
      }
    }),
  );

  const { rooms, excluded } = allocateRooms(requests, alivePlayers, roomCount, gameState.round);
  contextBuilder.currentRoomAllocations = rooms;
  contextBuilder.currentExcludedPlayerIds = excluded;
  gameState.recordRoomAllocations(rooms, excluded);

  const roomDescriptions = rooms.map((r) => {
    const nameA = gameState.getPlayerName(r.playerA);
    const nameB = gameState.getPlayerName(r.playerB);
    return `Room ${r.roomId}: ${nameA} & ${nameB}`;
  });
  const excludedNames = excluded.map((id) => gameState.getPlayerName(id));
  const allocationText = roomDescriptions.join(" | ") +
    (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "");
  logger.logRoomAllocation(allocationText, rooms, excludedNames);

  await Promise.all(rooms.map((room) => runRoomConversation(ctx, room, roomCount)));

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
