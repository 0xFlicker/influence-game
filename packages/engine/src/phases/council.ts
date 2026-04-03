import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

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
      const vote = await agent.getCouncilVote(phaseCtx, candidates);
      gameState.recordCouncilVote(player.id, vote);

      const votedAgainstName = gameState.getPlayerName(vote);
      agent.addNote(votedAgainstName, `Voted against in council R${gameState.round}`);

      logger.logSystem(
        `${player.name} council vote -> ${votedAgainstName}`,
        Phase.COUNCIL,
      );
    }),
  );

  const eliminatedId = gameState.tallyCouncilVotes(empoweredId);
  const eliminated = gameState.getPlayer(eliminatedId)!;
  const lastMsg = eliminated.lastMessage ?? "(no final words)";

  logger.logSystem(`ELIMINATED: ${eliminated.name}`, Phase.COUNCIL);
  ctx.diaryRoom.lastEliminatedName = eliminated.name;
  ctx.eliminationOrder.push(eliminated.name);
  logger.logPublic(eliminatedId, lastMsg, Phase.COUNCIL);

  gameState.eliminatePlayer(eliminatedId);
  logger.emitStream({ type: "player_eliminated", playerId: eliminatedId, playerName: eliminated.name, round: gameState.round });

  for (const agent of agents.values()) {
    agent.removeFromMemory?.(eliminated.name);
  }

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({
    type: "UPDATE_ALIVE_PLAYERS",
    aliveIds: gameState.getAlivePlayerIds(),
  });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
