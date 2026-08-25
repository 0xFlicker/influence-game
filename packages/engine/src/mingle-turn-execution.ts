import { createUUID } from "./game-state";
import type { MingleTurnAction, MingleIntentSummary } from "./game-runner.types";
import { formatMingleTurnOperatorText } from "./operator-turn-text";
import {
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseRunnerContext,
} from "./phases/phase-runner-context";
import {
  Phase,
  PlayerStatus,
  type MingleRoomChoiceStatus,
  type MingleRoomCount,
  type MingleTurnActionRecord,
  type RoomAllocation,
  type UUID,
} from "./types";

export type MingleExecutionPhase =
  | Phase.MINGLE
  | Phase.MINGLE_I
  | Phase.POST_VOTE_MINGLE
  | Phase.FORMAT_MINGLE;

export type MingleMovementMode = "live" | "evaluation_frozen_schedule";
export const DEFAULT_MINGLE_BEATS = 3;

export interface InitializedMingleExecution {
  alivePlayers: Array<{ id: UUID; name: string }>;
  roomCount: number;
  initialRoomCounts: MingleRoomCount[];
}

export interface CollectedMingleTurn {
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

export interface MingleTurnExecutionRecord extends MingleTurnActionRecord {
  requestedToRoomId?: number;
  movementApplied?: false;
}

interface MingleMovementResolution {
  toRoomId: number;
  gotoRoomId: number | null;
  gotoPlayerName: string | null;
  gotoRoomIgnored: boolean;
  gotoStatus: MingleRoomChoiceStatus;
}

export function computeMingleRoomCount(aliveCount: number): number {
  if (aliveCount < 5) return 0;
  return Math.ceil(aliveCount / 3) + 1;
}

export function initializeMingleExecution(
  ctx: PhaseRunnerContext,
  phase: MingleExecutionPhase,
): InitializedMingleExecution {
  const { gameState, logger, contextBuilder } = ctx;
  logger.emitPhaseChange(phase);
  logger.logSystem(
    phase === Phase.POST_VOTE_MINGLE
      ? "=== POST-VOTE MINGLE PHASE ==="
      : phase === Phase.FORMAT_MINGLE
        ? "=== FORMAT MINGLE PHASE ==="
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

  const roomCount = computeMingleRoomCount(alivePlayers.length);
  const initialRoomCounts = Array.from({ length: roomCount }, (_, index) => ({
    roomId: index + 1,
    count: 0,
  }));
  contextBuilder.currentRoomCounts = initialRoomCounts;
  return { alivePlayers, roomCount, initialRoomCounts };
}

export async function executeMingleTurn(input: {
  ctx: PhaseRunnerContext;
  phase: MingleExecutionPhase;
  room: RoomAllocation;
  playerId: UUID;
  roomCount: number;
  roomCounts: MingleRoomCount[];
  mingleIntent: MingleIntentSummary | null;
  totalBeats: number;
  conversationHistory: Array<{ from: string; text: string }>;
}): Promise<CollectedMingleTurn> {
  const {
    ctx,
    phase,
    room,
    playerId,
    roomCount,
    roomCounts,
    mingleIntent,
    totalBeats,
    conversationHistory,
  } = input;
  if (!room.playerIds.includes(playerId)) {
    throw new Error(`Mingle actor ${playerId} is not in Room ${room.roomId}`);
  }
  const { agents, logger, gameState } = ctx;
  const agent = agents.get(playerId);
  if (!agent) throw new Error(`Missing Mingle agent ${playerId}`);
  const fromName = gameState.getPlayerName(playerId);
  const recipientIds = room.playerIds.filter((id) => id !== playerId);
  const recipientNames = recipientIds.map((id) => gameState.getPlayerName(id));
  const roomMates = room.playerIds.map((id) => gameState.getPlayerName(id));
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    agent,
    playerId,
    phase,
    "ordinary_speech",
    undefined,
    undefined,
    {
      roomCount,
      roomCounts,
      currentRoomId: room.roomId,
      roomMates,
      mingleIntent,
    },
  );
  phaseCtx.mingleBeat = room.beat;
  phaseCtx.mingleTotalBeats = totalBeats;

  let resolvedAction: MingleTurnAction;
  if (agent.takeMingleTurn) {
    resolvedAction = await agent.takeMingleTurn(
      phaseCtx,
      roomMates,
      conversationHistory,
    );
  } else {
    const response = await agent.sendRoomMessage(
      phaseCtx,
      roomMates,
      conversationHistory,
    );
    resolvedAction = response
      ? { ...response, noReply: false, gotoRoomId: null, gotoPlayerName: null }
      : {
          thinking: "",
          message: null,
          noReply: true,
          gotoRoomId: null,
          gotoPlayerName: null,
        };
  }

  await assertCanAcceptCommit(ctx);
  if (resolvedAction.providerAbsence) {
    return {
      playerId,
      fromName,
      recipientNames,
      roomId: room.roomId,
      turn: room.beat,
      action: resolvedAction,
      message: null,
      messageSent: false,
      turnAction: "no_reply",
    };
  }
  const receipt = resolvedAction.coordinationReceipt;
  if (
    receipt
    && (
      receipt.proposedTarget
      || receipt.proposedAction
      || receipt.commitment
      || receipt.noProposalReason
    )
  ) {
    gameState.recordMingleCoordinationReceipt({
      id: createUUID(),
      round: gameState.round,
      phase,
      actorId: playerId,
      audiencePlayerIds: [...room.playerIds],
      roomId: room.roomId,
      proposedTargetName: receipt.proposedTarget,
      proposedAction: receipt.proposedAction,
      commitment: receipt.commitment,
      noProposalReason: receipt.noProposalReason,
      createdAt: new Date().toISOString(),
    });
  }
  resolveActionStrategyCandidate(
    agent,
    resolvedAction,
    resolvedAction.strategyGameplayAccepted !== false,
  );

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
    const transcriptThinking = transcriptThinkingFor(
      agent,
      resolvedAction.thinking,
      resolvedAction.reasoningContext,
    );
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

  return {
    playerId,
    fromName,
    recipientNames,
    roomId: room.roomId,
    turn: room.beat,
    action: resolvedAction,
    message: message ?? null,
    messageSent,
    turnAction,
  };
}

export function commitMingleTurnMovements(input: {
  ctx: PhaseRunnerContext;
  turns: readonly CollectedMingleTurn[];
  roomByPlayerId: Map<UUID, number>;
  roomCount: number;
  phase: MingleExecutionPhase;
  mode: MingleMovementMode;
}): MingleTurnExecutionRecord[] {
  const {
    ctx,
    turns,
    roomByPlayerId,
    roomCount,
    phase,
    mode,
  } = input;
  const { gameState, logger } = ctx;
  const requestedMovements = resolveMingleMovements(
    turns,
    gameState,
    roomByPlayerId,
    roomCount,
  );
  const nextRoomByPlayerId = new Map(roomByPlayerId);
  const records: MingleTurnExecutionRecord[] = [];

  for (const turn of turns) {
    if (turn.action.providerAbsence) continue;
    const requested = requestedMovements.get(turn.playerId) ?? {
      toRoomId: turn.roomId,
      gotoRoomId: null,
      gotoPlayerName: null,
      gotoRoomIgnored: false,
      gotoStatus: "missing" as const,
    };
    const movement = mode === "live"
      ? requested
      : { ...requested, toRoomId: turn.roomId };
    if (mode === "live") nextRoomByPlayerId.set(turn.playerId, movement.toRoomId);

    const moved = movement.toRoomId !== turn.roomId;
    const operatorText = formatMingleTurnOperatorText({
      playerName: turn.fromName,
      roomId: turn.roomId,
      message: turn.message,
      messageSent: turn.messageSent,
      toRoomId: movement.toRoomId,
      moved,
      gotoRoomId: requested.gotoRoomId,
      gotoPlayerName: requested.gotoPlayerName,
      gotoStatus: requested.gotoStatus,
    });
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
        moved,
        gotoRoomId: requested.gotoRoomId,
        gotoPlayerName: requested.gotoPlayerName,
        gotoRoomIgnored: requested.gotoRoomIgnored,
        gotoStatus: requested.gotoStatus,
        coordinationReceipt: turn.action.coordinationReceipt,
        ...(mode === "evaluation_frozen_schedule" && {
          requestedToRoomId: requested.toRoomId,
          movementApplied: false,
        }),
        ...strategicDecisionResponse(turn.action),
      },
      thinking: turn.action.thinking,
      reasoningContext: turn.action.reasoningContext,
      scope: "mingle",
      text: operatorText,
      to: turn.recipientNames,
      roomId: turn.roomId,
    });

    records.push({
      player: { id: turn.playerId, name: turn.fromName },
      turn: turn.turn,
      fromRoomId: turn.roomId,
      toRoomId: movement.toRoomId,
      moved,
      action: turn.messageSent ? "talk" : "no_reply",
      gotoRoomId: requested.gotoRoomId,
      gotoPlayerName: requested.gotoPlayerName,
      gotoRoomIgnored: requested.gotoRoomIgnored,
      gotoStatus: requested.gotoStatus,
      ...(mode === "evaluation_frozen_schedule" && {
        requestedToRoomId: requested.toRoomId,
        movementApplied: false as const,
      }),
    });
  }

  if (mode === "live") {
    roomByPlayerId.clear();
    for (const [playerId, roomId] of nextRoomByPlayerId) {
      roomByPlayerId.set(playerId, roomId);
    }
  }
  return records;
}

function normalizeGotoRoomId(
  gotoRoomId: number | null | undefined,
  currentRoomId: number,
  roomCount: number,
): {
  roomId: number;
  status: MingleRoomChoiceStatus;
  requestedRoomId: number | null;
} {
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

function resolveMingleMovements(
  turns: readonly CollectedMingleTurn[],
  gameState: PhaseRunnerContext["gameState"],
  roomByPlayerId: ReadonlyMap<UUID, number>,
  roomCount: number,
): Map<UUID, MingleMovementResolution> {
  const turnByPlayerId = new Map(turns.map((turn) => [turn.playerId, turn]));
  const playerByName = new Map(
    gameState.getAllPlayers().map((player) => [player.name.toLowerCase(), player]),
  );
  const alivePlayerIds = new Set(
    gameState.getAlivePlayers().map((player) => player.id),
  );
  const resolved = new Map<UUID, MingleMovementResolution>();

  const resolvePlayer = (
    playerId: UUID,
    stack: Set<UUID>,
  ): MingleMovementResolution => {
    const cached = resolved.get(playerId);
    if (cached) return cached;
    const turn = turnByPlayerId.get(playerId);
    const currentRoomId = roomByPlayerId.get(playerId) ?? 1;
    const gotoPlayerName = normalizePlayerName(turn?.action.gotoPlayerName);
    const gotoRoomIgnored =
      gotoPlayerName !== null && turn?.action.gotoRoomId != null;

    if (gotoPlayerName) {
      const target = playerByName.get(gotoPlayerName.toLowerCase());
      if (!target) {
        const resolution = {
          toRoomId: currentRoomId,
          gotoRoomId: null,
          gotoPlayerName,
          gotoRoomIgnored,
          gotoStatus: "player_unknown" as const,
        };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (target.id === playerId) {
        const resolution = {
          toRoomId: currentRoomId,
          gotoRoomId: null,
          gotoPlayerName,
          gotoRoomIgnored,
          gotoStatus: "player_self" as const,
        };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (target.status !== PlayerStatus.ALIVE || !alivePlayerIds.has(target.id)) {
        const resolution = {
          toRoomId: currentRoomId,
          gotoRoomId: null,
          gotoPlayerName,
          gotoRoomIgnored,
          gotoStatus: "player_dead" as const,
        };
        resolved.set(playerId, resolution);
        return resolution;
      }
      if (stack.has(target.id)) {
        const resolution = {
          toRoomId: currentRoomId,
          gotoRoomId: null,
          gotoPlayerName,
          gotoRoomIgnored,
          gotoStatus: "player_cycle" as const,
        };
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
        gotoStatus: gotoRoomIgnored
          ? "player_valid_room_ignored" as const
          : "player_valid" as const,
      };
      resolved.set(playerId, resolution);
      return resolution;
    }

    const normalized = normalizeGotoRoomId(
      turn?.action.gotoRoomId,
      currentRoomId,
      roomCount,
    );
    const resolution = {
      toRoomId: normalized.roomId,
      gotoRoomId: normalized.requestedRoomId,
      gotoPlayerName: null,
      gotoRoomIgnored: false,
      gotoStatus: normalized.status,
    };
    resolved.set(playerId, resolution);
    return resolution;
  };

  for (const turn of turns) resolvePlayer(turn.playerId, new Set());
  return resolved;
}
