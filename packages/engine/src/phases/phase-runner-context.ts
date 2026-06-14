/**
 * Shared context interface passed to all phase handler functions.
 * Provides access to game state, agents, logging, and context building.
 */

import type { createActor } from "xstate";
import type { GameState } from "../game-state";
import type { CanonicalSourcePointer } from "../canonical-events";
import type { TranscriptLogger } from "../transcript-logger";
import type { ContextBuilder } from "../context-builder";
import type { DiaryRoom } from "../diary-room";
import type { IHouseInterviewer } from "../house-interviewer";
import type { createPhaseMachine } from "../phase-machine";
import type { UUID, GameConfig, Phase } from "../types";
import type { IAgent, StrategyPacketUseMarker } from "../game-runner.types";

export type PhaseActor = ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>;

export interface PhaseRunnerContext {
  gameState: GameState;
  agents: Map<UUID, IAgent>;
  config: GameConfig;
  logger: TranscriptLogger;
  contextBuilder: ContextBuilder;
  diaryRoom: DiaryRoom;
  houseInterviewer: IHouseInterviewer;
  mingleInbox: Map<UUID, Array<{ from: string; text: string }>>;
  eliminationOrder: string[];
  beforeAcceptedCommit?: () => Promise<void> | void;
}

export function agentTurnSourcePointer(
  actorId: UUID,
  action: string,
  round: number,
  phase: Phase,
): CanonicalSourcePointer {
  return {
    kind: "agent_turn",
    actorId,
    action,
    round,
    phase,
  };
}

export async function assertCanAcceptCommit(ctx: PhaseRunnerContext): Promise<void> {
  await ctx.beforeAcceptedCommit?.();
}

export function transcriptThinkingFor(
  agent: IAgent,
  thinking?: string,
  reasoningContext?: string,
): { thinking?: string; reasoningContext?: string } {
  if (agent.getStrategyPacket?.()) {
    return {};
  }
  return {
    ...(thinking && { thinking }),
    ...(reasoningContext && { reasoningContext }),
  };
}

export function strategyPacketUseResponse(
  marker?: StrategyPacketUseMarker,
): { strategyPacketUse?: StrategyPacketUseMarker } {
  return marker ? { strategyPacketUse: marker } : {};
}
