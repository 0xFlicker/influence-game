import type { PhaseContext } from "../game-runner.types";
import type { UUID } from "../types";
import { Phase } from "../types";
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

export async function handleElimination(
  ctx: PhaseRunnerContext,
  eliminatedId: UUID,
  phase: Phase,
  eliminationContext?: PhaseContext["eliminationContext"],
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

  const finalWordsContext = contextBuilder.buildPhaseContext(
    eliminatedId,
    phase,
    { eliminationContext },
    true,
  );
  const lastMsgResponse = await eliminatedAgent.getLastMessage(finalWordsContext);
  await assertCanAcceptCommit(ctx);
  gameState.recordLastMessage(eliminatedId, lastMsgResponse.message);

  logger.logSystem(`ELIMINATED: ${eliminated.name}`, phase);
  ctx.diaryRoom.lastEliminatedName = eliminated.name;
  ctx.eliminationOrder.push(eliminated.name);
  ctx.eliminationOrderPlayerIds?.push(eliminatedId);
  const transcriptThinking = transcriptThinkingFor(eliminatedAgent, lastMsgResponse.thinking, lastMsgResponse.reasoningContext);
  logger.logPublic(eliminatedId, lastMsgResponse.message, phase, transcriptThinking);
  logger.emitAgentTurn({
    phase,
    action: "last-message",
    actor: { id: eliminatedId, name: eliminated.name, role: "player" },
    visibility: "public",
    response: {
      message: lastMsgResponse.message,
      eliminationMode: eliminationContext?.mode,
      directExecutor: eliminationContext?.directExecutor,
      exposedBy: eliminationContext?.exposedBy,
      councilVoters: eliminationContext?.councilVoters,
      eliminationVoters: eliminationContext?.eliminationVoters,
      ...strategicDecisionResponse(lastMsgResponse),
    },
    thinking: lastMsgResponse.thinking,
    reasoningContext: lastMsgResponse.reasoningContext,
    scope: "public",
    text: lastMsgResponse.message,
  });
  await assertCanAcceptCommit(ctx);
  gameState.eliminatePlayer(eliminatedId);
  logger.emitStream({
    type: "player_eliminated",
    playerId: eliminatedId,
    playerName: eliminated.name,
    round: gameState.round,
  });

  for (const agent of agents.values()) {
    agent.removeFromMemory?.(eliminated.name);
  }
}
