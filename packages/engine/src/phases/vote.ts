import type { UUID } from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

/** Shared helper: handle elimination of a player with logging and cleanup */
function handleElimination(
  ctx: PhaseRunnerContext,
  eliminatedId: UUID,
  phase: Phase,
): void {
  const { gameState, agents, logger } = ctx;
  const eliminated = gameState.getPlayer(eliminatedId)!;
  const lastMsg = eliminated.lastMessage ?? "(no final words)";

  logger.logSystem(`ELIMINATED: ${eliminated.name}`, phase);
  ctx.diaryRoom.lastEliminatedName = eliminated.name;
  ctx.eliminationOrder.push(eliminated.name);
  logger.logPublic(eliminatedId, lastMsg, phase);
  gameState.eliminatePlayer(eliminatedId);
  logger.emitStream({ type: "player_eliminated", playerId: eliminatedId, playerName: eliminated.name, round: gameState.round });

  for (const agent of agents.values()) {
    agent.removeFromMemory?.(eliminated.name);
  }
}

export async function runVotePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== VOTE PHASE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);

      const [votes, lastMsgResponse] = await Promise.all([
        agent.getVotes(phaseCtx),
        agent.getLastMessage(phaseCtx),
      ]);

      gameState.recordVote(player.id, votes.empowerTarget, votes.exposeTarget);
      gameState.recordLastMessage(player.id, lastMsgResponse.message);

      const empowerName = gameState.getPlayerName(votes.empowerTarget);
      const exposeName = gameState.getPlayerName(votes.exposeTarget);
      logger.logSystem(
        `${player.name} votes: empower=${empowerName}, expose=${exposeName}`,
        Phase.VOTE,
      );
    }),
  );

  const { empowered: initialEmpowered, tied } = gameState.tallyEmpowerVotes();
  let empoweredId = initialEmpowered;

  if (tied) {
    const tiedNames = tied.map((id) => gameState.getPlayerName(id)).join(", ");
    logger.logSystem(`Empower TIED between: ${tiedNames}. Re-vote!`, Phase.VOTE);

    const reVoters = alivePlayers.filter((p) => !tied.includes(p.id));
    for (const rv of reVoters) {
      gameState.clearEmpowerVote(rv.id);
    }
    if (reVoters.length > 0) {
      await Promise.all(
        reVoters.map(async (player) => {
          const agent = agents.get(player.id)!;
          const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
          const votes = await agent.getVotes(phaseCtx);
          if (tied.includes(votes.empowerTarget)) {
            gameState.recordEmpowerReVote(player.id, votes.empowerTarget);
            const empowerName = gameState.getPlayerName(votes.empowerTarget);
            logger.logSystem(`${player.name} re-votes: empower=${empowerName}`, Phase.VOTE);
          }
        }),
      );
    }

    const reVoteCounts: Record<UUID, number> = {};
    for (const id of tied) reVoteCounts[id] = 0;
    for (const voter of reVoters) {
      const target = gameState.currentVoteTally.empowerVotes[voter.id];
      if (target && target in reVoteCounts) {
        reVoteCounts[target] = (reVoteCounts[target] ?? 0) + 1;
      }
    }

    const maxReVotes = Math.max(...Object.values(reVoteCounts), 0);
    const reVoteTied = tied.filter((id) => reVoteCounts[id] === maxReVotes);

    if (reVoteTied.length === 1) {
      empoweredId = reVoteTied[0]!;
      logger.logSystem(`Re-vote resolved: ${gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
    } else {
      empoweredId = reVoteTied[Math.floor(Math.random() * reVoteTied.length)]!;
      logger.logSystem(`Re-vote still tied! THE WHEEL decides: ${gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
    }
    gameState.setEmpowered(empoweredId);
  }

  logger.logSystem(
    `Empowered: ${gameState.getPlayerName(empoweredId)}`,
    Phase.VOTE,
  );

  // Update agent memory
  const voteTally = gameState.currentVoteTally;
  for (const [voterId, empowerTargetId] of Object.entries(voteTally.empowerVotes)) {
    const agent = agents.get(voterId as UUID);
    if (agent) {
      const empowerName = gameState.getPlayerName(empowerTargetId);
      agent.updateAlly(empowerName);
    }
  }
  for (const [voterId, exposeTargetId] of Object.entries(voteTally.exposeVotes)) {
    const agent = agents.get(voterId as UUID);
    if (agent) {
      const exposeName = gameState.getPlayerName(exposeTargetId);
      agent.updateThreat(exposeName);
    }
  }

  actor.send({ type: "VOTES_TALLIED", empoweredId });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runReckoningVote(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== RECKONING: ELIMINATION VOTE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
      const [vote, lastMsgResponse] = await Promise.all([
        agent.getEndgameEliminationVote(phaseCtx),
        agent.getLastMessage(phaseCtx),
      ]);
      gameState.recordEndgameEliminationVote(player.id, vote);
      gameState.recordLastMessage(player.id, lastMsgResponse.message);
      logger.logSystem(
        `${player.name} votes to eliminate: ${gameState.getPlayerName(vote)}`,
        Phase.VOTE,
      );
    }),
  );

  const eliminatedId = gameState.tallyEndgameEliminationVotes();
  handleElimination(ctx, eliminatedId, Phase.VOTE);

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runTribunalVote(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== TRIBUNAL: ELIMINATION VOTE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
      const [vote, lastMsgResponse] = await Promise.all([
        agent.getEndgameEliminationVote(phaseCtx),
        agent.getLastMessage(phaseCtx),
      ]);
      gameState.recordEndgameEliminationVote(player.id, vote);
      gameState.recordLastMessage(player.id, lastMsgResponse.message);
      logger.logSystem(
        `${player.name} votes to eliminate: ${gameState.getPlayerName(vote)}`,
        Phase.VOTE,
      );
    }),
  );

  // Tribunal: jury can break ties
  let juryTiebreakerVotes: Record<UUID, UUID> | undefined;
  const tribunalJury = contextBuilder.getActiveJury();
  if (tribunalJury.length > 0) {
    juryTiebreakerVotes = {};
    for (const juror of tribunalJury) {
      const jurorAgent = agents.get(juror.playerId);
      if (jurorAgent) {
        const phaseCtx = contextBuilder.buildPhaseContext(juror.playerId, Phase.VOTE);
        const vote = await jurorAgent.getEndgameEliminationVote(phaseCtx);
        juryTiebreakerVotes[juror.playerId] = vote;
      }
    }
  }

  const eliminatedId = gameState.tallyTribunalVotes(juryTiebreakerVotes);
  handleElimination(ctx, eliminatedId, Phase.VOTE);

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
