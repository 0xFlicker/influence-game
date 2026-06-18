import { Phase } from "../types";
import { assertCanAcceptCommit, agentTurnSourcePointer, strategicDecisionResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";
import { getCouncilVoterNames, getExposeVoterNames, handleElimination } from "./elimination";

export async function runRevealPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  const candidates = gameState.councilCandidates;
  if (!candidates) {
    actor.send({ type: "PHASE_COMPLETE" });
    return;
  }

  const [c1, c2] = candidates;
  logger.logSystem(
    `=== REVEAL PHASE === Council candidates: ${gameState.getPlayerName(c1)} vs ${gameState.getPlayerName(c2)}`,
    Phase.REVEAL,
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runCouncilPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const candidates = gameState.councilCandidates;
  const empoweredId = gameState.empoweredId;

  if (!candidates || !empoweredId) {
    actor.send({ type: "PHASE_COMPLETE" });
    return;
  }

  logger.emitPhaseChange(Phase.COUNCIL);
  logger.logSystem("=== COUNCIL PHASE ===", Phase.COUNCIL);
  const alivePlayers = gameState.getAlivePlayers();

  const voters = alivePlayers.filter(
    (p) => p.id !== candidates[0] && p.id !== candidates[1],
  );
  await Promise.all(
    voters.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.COUNCIL, {
        empoweredId,
        councilCandidates: candidates,
      });
      const voteResult = await agent.getCouncilVote(phaseCtx, candidates);
      const vote = voteResult.target;
      await assertCanAcceptCommit(ctx);
      gameState.recordCouncilVote(player.id, vote, [
        agentTurnSourcePointer(player.id, "council-vote", gameState.round, Phase.COUNCIL),
      ]);

      const votedAgainstName = gameState.getPlayerName(vote);
      agent.addNote(votedAgainstName, `Voted against in council R${gameState.round}`);

      const transcriptThinking = transcriptThinkingFor(agent, voteResult.thinking, voteResult.reasoningContext);
      logger.logSystem(
        `${player.name} council vote -> ${votedAgainstName}`,
        Phase.COUNCIL,
        transcriptThinking.thinking,
        transcriptThinking.reasoningContext,
      );
      logger.emitAgentTurn({
        phase: Phase.COUNCIL,
        action: "council-vote",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "private",
        response: {
          target: { id: vote, name: votedAgainstName },
          candidates: candidates.map((id) => ({ id, name: gameState.getPlayerName(id) })),
          ...strategicDecisionResponse(voteResult),
        },
        thinking: voteResult.thinking,
        reasoningContext: voteResult.reasoningContext,
        scope: "system",
        text: `${player.name} council vote -> ${votedAgainstName}`,
      });
    }),
  );

  await assertCanAcceptCommit(ctx);
  const eliminatedId = gameState.tallyCouncilVotes(empoweredId);
  await handleElimination(ctx, eliminatedId, Phase.COUNCIL, {
    mode: "council",
    exposedBy: getExposeVoterNames(ctx, eliminatedId),
    councilVoters: getCouncilVoterNames(ctx, eliminatedId),
  });

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({
    type: "UPDATE_ALIVE_PLAYERS",
    aliveIds: gameState.getAlivePlayerIds(),
  });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
