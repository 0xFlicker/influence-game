import type {
  AgentResponse,
  EliminationContext,
  IAgent,
  PhaseContext,
} from "../game-runner.types";
import type { UUID } from "../types";
import { Phase } from "../types";
import { emptyRecallContinuitySnapshot } from "../context-recall-plan";
import { assertCanAcceptCommit, strategicDecisionResponse, transcriptThinkingFor, type PhaseRunnerContext } from "./phase-runner-context";

function getVoterNames(
  votes: Record<UUID, UUID>,
  targetId: UUID,
  gameState: PhaseRunnerContext["gameState"],
): string[] {
  return Object.entries(votes)
    .filter(([, votedFor]) => votedFor === targetId)
    .map(([voterId]) => gameState.getPlayerName(voterId));
}

export function getExposeVoterNames(
  ctx: PhaseRunnerContext,
  targetId: UUID,
): string[] {
  return getVoterNames(
    ctx.gameState.currentVoteTally.exposeVotes,
    targetId,
    ctx.gameState,
  );
}

export function getCouncilVoterNames(
  ctx: PhaseRunnerContext,
  targetId: UUID,
): string[] {
  return getVoterNames(
    ctx.gameState.currentCouncilTally.votes,
    targetId,
    ctx.gameState,
  );
}

export function getEndgameEliminationVoterNames(
  ctx: PhaseRunnerContext,
  targetId: UUID,
): string[] {
  return getVoterNames(
    ctx.gameState.endgameEliminationTally.votes,
    targetId,
    ctx.gameState,
  );
}

const HOUSE_ELIMINATION_MESSAGE_FALLBACK: AgentResponse = {
  thinking: "House fallback after unavailable elimination message.",
  message: "I have no final words.",
};

function normalizedEliminationMessage(response: AgentResponse): AgentResponse {
  const message = response.message.trim();
  return message
    ? { ...response, message }
    : { ...HOUSE_ELIMINATION_MESSAGE_FALLBACK };
}

function requestEliminationMessage(
  agent: IAgent,
  context: PhaseContext,
  signal: AbortSignal,
): Promise<AgentResponse> {
  if (agent.getEliminationMessage) {
    return agent.getEliminationMessage(context, { signal });
  }
  if (agent.getLastMessage) {
    return agent.getLastMessage(context);
  }
  throw new Error(
    `Agent ${agent.name} implements neither getEliminationMessage nor deprecated getLastMessage`,
  );
}

async function withEliminationMessageTimeout(
  ctx: PhaseRunnerContext,
  phase: Phase,
  agent: IAgent,
  context: PhaseContext,
): Promise<AgentResponse> {
  const operation = (signal: AbortSignal) =>
    requestEliminationMessage(agent, context, signal);
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) {
    return normalizedEliminationMessage(
      await operation(new AbortController().signal),
    );
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const operationTagged = operation(controller.signal).then((value) => ({
    source: "agent" as const,
    value,
  }));
  const timeoutTagged = new Promise<{
    source: "timeout";
    value: AgentResponse;
  }>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(
        `${agent.name} elimination message timed out after ${timeoutMs}ms; using House fallback.`,
        phase,
      );
      resolve({
        source: "timeout",
        value: { ...HOUSE_ELIMINATION_MESSAGE_FALLBACK },
      });
      controller.abort();
    }, timeoutMs);
  });

  const result = await Promise.race([operationTagged, timeoutTagged]).finally(
    () => {
      if (timeout) clearTimeout(timeout);
    },
  );
  return normalizedEliminationMessage(result.value);
}

export async function handleElimination(
  ctx: PhaseRunnerContext,
  eliminatedId: UUID,
  phase: Phase,
  eliminationContext: EliminationContext,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const eliminated = gameState.getPlayer(eliminatedId);
  if (!eliminated) {
    throw new Error(`Expected eliminated player ${eliminatedId} to exist`);
  }

  const eliminatedAgent = agents.get(eliminatedId);
  if (!eliminatedAgent) {
    throw new Error(`Expected agent ${eliminatedId} to exist for elimination`);
  }

  await assertCanAcceptCommit(ctx);
  gameState.eliminatePlayer(eliminatedId);
  logger.logSystem(`ELIMINATED: ${eliminated.name}`, phase);
  ctx.diaryRoom.lastEliminatedName = eliminated.name;
  ctx.eliminationOrder.push(eliminated.name);
  ctx.eliminationOrderPlayerIds?.push(eliminatedId);
  logger.emitStream({
    type: "player_eliminated",
    playerId: eliminatedId,
    playerName: eliminated.name,
    round: gameState.round,
  });

  const eliminationBase = contextBuilder.buildEliminationMessageContext(
    eliminatedId,
    phase,
    eliminationContext,
  );
  const continuity =
    eliminatedAgent.getRecallContinuitySnapshot?.() ?? emptyRecallContinuitySnapshot();
  const eliminationMessageContext = contextBuilder.buildPhaseContextForAgentCall({
    agentId: eliminatedId,
    phase,
    promptClass: "ordinary_speech",
    continuity,
    phaseContext: eliminationBase,
  });
  const messageResponse = await withEliminationMessageTimeout(
    ctx,
    phase,
    eliminatedAgent,
    eliminationMessageContext,
  );
  await assertCanAcceptCommit(ctx);
  gameState.recordEliminationMessage(eliminatedId, messageResponse.message, phase);

  const transcriptThinking = transcriptThinkingFor(
    eliminatedAgent,
    messageResponse.thinking,
    messageResponse.reasoningContext,
  );
  logger.logPublic(eliminatedId, messageResponse.message, phase, transcriptThinking);
  logger.emitAgentTurn({
    phase,
    action: "elimination-message",
    actor: { id: eliminatedId, name: eliminated.name, role: "player" },
    visibility: "public",
    response: {
      message: messageResponse.message,
      eliminationMode: eliminationContext.mode,
      directExecutor: eliminationContext.directExecutor,
      exposedBy: eliminationContext.exposedBy,
      voteDisclosure: eliminationContext.voteDisclosure,
      ...strategicDecisionResponse(messageResponse),
    },
    thinking: messageResponse.thinking,
    reasoningContext: messageResponse.reasoningContext,
    scope: "public",
    text: messageResponse.message,
  });

  for (const agent of agents.values()) {
    agent.removeFromMemory?.(eliminated.name);
  }
}
