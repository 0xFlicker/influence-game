/**
 * Shared context interface passed to all phase handler functions.
 * Provides access to game state, agents, logging, and context building.
 */

import type { createActor } from "xstate";
import type { GameState } from "../game-state";
import type { CanonicalSourcePointer } from "../canonical-events";
import type { TranscriptLogger } from "../transcript-logger";
import type {
  ContextBuilder,
  PhaseContextBuildExtra,
  PhaseContextRoomInfo,
} from "../context-builder";
import { emptyRecallContinuitySnapshot } from "../context-recall-plan";
import type { DiaryRoom } from "../diary-room";
import type { IHouseInterviewer } from "../house-interviewer";
import type { createPhaseMachine } from "../phase-machine";
import type { UUID, GameConfig, Phase } from "../types";
import type {
  CompactStrategyApplicationResult,
  IAgent,
  PhaseContext,
  RecallPromptClass,
  StrategicDecisionMetadata,
} from "../game-runner.types";
import {
  discardUnacceptedStrategyCandidate,
  hasCompactStrategyCandidate,
} from "../strategy-state";
import type { FormatPressureProjection } from "../format-pressure";
import type { LaunchFormatId } from "../formats";

export type PhaseActor = ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>;

export interface FormatKernelState {
  offeredFormats: [LaunchFormatId, LaunchFormatId] | null;
  selectedFormat: LaunchFormatId | null;
  pressure: FormatPressureProjection | null;
  lastSelectedFormat: LaunchFormatId | null;
}

export interface PhaseRunnerContext {
  gameState: GameState;
  agents: Map<UUID, IAgent>;
  config: GameConfig;
  logger: TranscriptLogger;
  contextBuilder: ContextBuilder;
  diaryRoom: DiaryRoom;
  houseInterviewer: IHouseInterviewer;
  mingleInbox: Map<UUID, Array<{ from: string; text: string }>>;
  formatKernelState: FormatKernelState;
  eliminationOrder: string[];
  eliminationOrderPlayerIds?: UUID[];
  beforeAcceptedCommit?: () => Promise<void> | void;
  random?: () => number;
}

export function agentTurnSourcePointer(
  actorId: UUID,
  action: string,
  round: number,
  phase: Phase,
  turnPass?: number,
  decisionId?: UUID,
): CanonicalSourcePointer {
  return {
    kind: "agent_turn",
    actorId,
    action,
    round,
    phase,
    ...(turnPass != null ? { turnPass } : {}),
    ...(decisionId ? { decisionId } : {}),
  };
}

export async function assertCanAcceptCommit(ctx: PhaseRunnerContext): Promise<void> {
  await ctx.beforeAcceptedCommit?.();
}

export function transcriptThinkingFor(
  agent: IAgent,
  thinking?: string,
  reasoningContext?: string,
): { thinking?: string; reasoningContext?: string; decisionId?: string } {
  const decisionId = agent.getLastPrivateDecisionId?.();
  return {
    ...(thinking && { thinking }),
    ...(reasoningContext && { reasoningContext }),
    ...(decisionId && { decisionId }),
  };
}

const strategyResultsByCandidate = new WeakMap<object, CompactStrategyApplicationResult>();

export function strategicDecisionResponse(
  metadata?: StrategicDecisionMetadata,
): { decisionId?: UUID; strategyResult?: CompactStrategyApplicationResult } {
  if (!metadata) return {};
  const strategyResult = strategyResultsByCandidate.get(metadata);
  return {
    ...(metadata.decisionId ? { decisionId: metadata.decisionId } : {}),
    ...(strategyResult ? { strategyResult } : {}),
  };
}

/**
 * The only active-game strategy mutation seam. Call after the existing
 * ownership guard and mechanic acceptance decision, never from model decoding.
 */
export function resolveActionStrategyCandidate(
  agent: IAgent,
  candidate: StrategicDecisionMetadata,
  gameplayAccepted: boolean,
): CompactStrategyApplicationResult | undefined {
  const state = agent.getCompactStrategyState?.();
  if (!state) return undefined;
  if (!gameplayAccepted) {
    if (!hasCompactStrategyCandidate(candidate)) return undefined;
    const result = discardUnacceptedStrategyCandidate(state, candidate) ?? undefined;
    if (result) strategyResultsByCandidate.set(candidate, result);
    return result;
  }
  if (!hasCompactStrategyCandidate(candidate) && candidate.strategyCandidateProposed !== true) {
    return undefined;
  }
  const boundary = state.lifecycle === "reconciliation_required"
    || state.lifecycle === "repair_required"
    ? "action_repair"
    : "ordinary_action";
  const result = agent.commitCompactStrategyCandidate?.(boundary, candidate);
  if (result) strategyResultsByCandidate.set(candidate, result);
  return result;
}

/**
 * Build PhaseContext with classified Recall Plan for one agent call (U3 / KTD1+KTD4).
 * Obtains a fresh continuity snapshot from the agent boundary — phase code never reads agent memory.
 * Defaults to ordinary_speech when promptClass is omitted.
 */
export function prepareAgentPhaseContext(
  ctx: PhaseRunnerContext,
  agent: IAgent,
  agentId: UUID,
  phase: Phase,
  promptClass: RecallPromptClass = "ordinary_speech",
  extra?: PhaseContextBuildExtra,
  isEliminated?: boolean,
  roomInfo?: PhaseContextRoomInfo,
): PhaseContext {
  const continuity = agent.getRecallContinuitySnapshot?.() ?? emptyRecallContinuitySnapshot();
  return ctx.contextBuilder.buildPhaseContextForAgentCall({
    agentId,
    phase,
    promptClass,
    continuity,
    extra,
    isEliminated,
    roomInfo,
  });
}
