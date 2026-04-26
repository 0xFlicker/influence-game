import type { UUID, RoomAllocation } from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

export interface BrokenWhisperRoomPreference {
  playerId: UUID;
  requestedPartnerId: UUID;
}

export interface RoomAllocationOptions {
  avoidRepeatPairs?: boolean;
  priorRooms?: RoomAllocation[];
}

/**
 * Compute the number of whisper rooms for the current round.
 * Formula: max(1, floor(alivePlayers / 2) - 1)
 */
export function computeRoomCount(aliveCount: number): number {
  return Math.max(1, Math.floor(aliveCount / 2) - 1);
}

function pairKey(playerA: UUID, playerB: UUID): string {
  return [playerA, playerB].sort().join(":");
}

function buildPriorPairKeys(priorRooms: RoomAllocation[]): Set<string> {
  return new Set(priorRooms.map((room) => pairKey(room.playerA, room.playerB)));
}

function getRecordedPriorRooms(ctx: PhaseRunnerContext, currentRoundRooms: RoomAllocation[]): RoomAllocation[] {
  const priorRooms: RoomAllocation[] = [...currentRoundRooms];
  for (let priorRound = 1; priorRound < ctx.gameState.round; priorRound++) {
    const allocation = ctx.gameState.getRoomAllocations(priorRound);
    if (allocation) priorRooms.push(...allocation.rooms);
  }
  return priorRooms;
}

function logBrokenRepeatPreferences(
  ctx: PhaseRunnerContext,
  brokenPreferences: BrokenWhisperRoomPreference[],
): void {
  if (brokenPreferences.length === 0) return;

  const brokenText = brokenPreferences
    .map((preference) =>
      `${ctx.gameState.getPlayerName(preference.playerId)} -> ${ctx.gameState.getPlayerName(preference.requestedPartnerId)}`,
    )
    .join(", ");

  ctx.logger.logSystem(
    `Anti-repeat whisper experiment: The House broke repeat room preference(s): ${brokenText}.`,
    Phase.WHISPER,
  );
}

/**
 * Allocate rooms based on player preferences using mutual-match-first logic.
 */
export function allocateRooms(
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCountLimit: number,
  round: number,
  options: RoomAllocationOptions = {},
): { rooms: RoomAllocation[]; excluded: UUID[]; brokenPreferences: BrokenWhisperRoomPreference[] } {
  const rooms: RoomAllocation[] = [];
  const paired = new Set<UUID>();
  const repeatedPairKeys = options.avoidRepeatPairs
    ? buildPriorPairKeys(options.priorRooms ?? [])
    : new Set<string>();
  const isAvoidedRepeatPair = (playerId: UUID, partnerId: UUID): boolean =>
    options.avoidRepeatPairs === true && repeatedPairKeys.has(pairKey(playerId, partnerId));

  // Step 1: Mutual matches first
  for (const [playerId, partnerId] of requests) {
    if (paired.has(playerId) || paired.has(partnerId)) continue;
    if (rooms.length >= roomCountLimit) break;
    if (isAvoidedRepeatPair(playerId, partnerId)) continue;
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
    if (isAvoidedRepeatPair(playerId, partnerId)) continue;
    rooms.push({ roomId: rooms.length + 1, playerA: playerId, playerB: partnerId, round });
    paired.add(playerId);
    paired.add(partnerId);
  }

  const excluded = alivePlayers
    .filter((p) => !paired.has(p.id))
    .map((p) => p.id);

  const brokenPreferences = options.avoidRepeatPairs === true
    ? Array.from(requests)
      .filter(([playerId, partnerId]) =>
        isAvoidedRepeatPair(playerId, partnerId) &&
        !rooms.some((room) => pairKey(room.playerA, room.playerB) === pairKey(playerId, partnerId)),
      )
      .map(([playerId, requestedPartnerId]) => ({ playerId, requestedPartnerId }))
    : [];

  return { rooms, excluded, brokenPreferences };
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

    const response = await agent.sendRoomMessage(phaseCtx, partnerName, conversationHistory);

    if (response === null) {
      consecutivePasses++;
    } else {
      consecutivePasses = 0;
      msgCount.set(currentPlayerId, (msgCount.get(currentPlayerId) ?? 0) + 1);

      const inbox = ctx.whisperInbox.get(partnerId) ?? [];
      inbox.push({ from: currentName, text: response.message });
      ctx.whisperInbox.set(partnerId, inbox);

      conversationHistory.push({ from: currentName, text: response.message });
      logger.logWhisper(currentPlayerId, [partnerId], response.message, room.roomId, response.thinking);
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

    const { rooms, excluded, brokenPreferences } = allocateRooms(
      requests,
      eligible,
      roomCount,
      gameState.round,
      config.experimentalAntiRepeatWhisperRooms
        ? { avoidRepeatPairs: true, priorRooms: getRecordedPriorRooms(ctx, allRooms) }
        : undefined,
    );

    const sessionRooms = rooms.map((r) => {
      globalRoomId++;
      return { ...r, roomId: globalRoomId };
    });

    logBrokenRepeatPreferences(ctx, brokenPreferences);

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

  const { rooms, excluded, brokenPreferences } = allocateRooms(
    requests,
    alivePlayers,
    roomCount,
    gameState.round,
    ctx.config.experimentalAntiRepeatWhisperRooms
      ? { avoidRepeatPairs: true, priorRooms: getRecordedPriorRooms(ctx, []) }
      : undefined,
  );
  contextBuilder.currentRoomAllocations = rooms;
  contextBuilder.currentExcludedPlayerIds = excluded;
  gameState.recordRoomAllocations(rooms, excluded);
  logBrokenRepeatPreferences(ctx, brokenPreferences);

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
