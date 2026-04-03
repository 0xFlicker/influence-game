import type { UUID } from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

export async function runPowerPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.POWER);
  const empoweredId = gameState.empoweredId;
  if (!empoweredId) {
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: null });
    actor.send({ type: "PHASE_COMPLETE" });
    return;
  }

  logger.logSystem(
    `=== POWER PHASE === (${gameState.getPlayerName(empoweredId)} is empowered)`,
    Phase.POWER,
  );

  const scores = gameState.getExposeScores();
  const aliveIds = gameState.getAlivePlayerIds();
  const sorted = [...aliveIds].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const sorted0 = sorted[0];
  const sorted1 = sorted[1];
  if (!sorted0) throw new Error("No players to sort for power phase preliminary candidates");
  const prelim: [UUID, UUID] = [sorted0, sorted1 ?? sorted0];

  const empoweredAgent = agents.get(empoweredId)!;
  const phaseCtx = contextBuilder.buildPhaseContext(empoweredId, Phase.POWER, { empoweredId, councilCandidates: prelim });
  const powerAction = await empoweredAgent.getPowerAction(phaseCtx, prelim);

  gameState.setPowerAction(powerAction);
  logger.logSystem(
    `${gameState.getPlayerName(empoweredId)} power action: ${powerAction.action} -> ${gameState.getPlayerName(powerAction.target)}`,
    Phase.POWER,
  );

  if (powerAction.action === "protect") {
    empoweredAgent.updateAlly(gameState.getPlayerName(powerAction.target));
  } else if (powerAction.action === "eliminate") {
    empoweredAgent.updateThreat(gameState.getPlayerName(powerAction.target));
  }

  const { candidates, autoEliminated, shieldGranted } = gameState.determineCandidates();

  if (shieldGranted) {
    logger.logSystem(
      `${gameState.getPlayerName(shieldGranted)} is protected (shield granted)`,
      Phase.POWER,
    );
  }

  if (autoEliminated) {
    const eliminatedName = gameState.getPlayerName(autoEliminated);
    logger.logSystem(`AUTO-ELIMINATE: ${eliminatedName}`, Phase.POWER);
    ctx.diaryRoom.lastEliminatedName = eliminatedName;
    ctx.eliminationOrder.push(eliminatedName);
    const eliminated = gameState.getPlayer(autoEliminated)!;
    const lastMsg = eliminated.lastMessage ?? "(no final words)";
    logger.logPublic(autoEliminated, lastMsg, Phase.POWER);
    gameState.eliminatePlayer(autoEliminated);
    logger.emitStream({ type: "player_eliminated", playerId: autoEliminated, playerName: eliminatedName, round: gameState.round });

    for (const agent of agents.values()) {
      agent.removeFromMemory?.(eliminatedName);
    }

    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated });
    actor.send({ type: "PLAYER_ELIMINATED", playerId: autoEliminated });
    actor.send({
      type: "UPDATE_ALIVE_PLAYERS",
      aliveIds: gameState.getAlivePlayerIds(),
    });
  } else if (candidates) {
    actor.send({ type: "CANDIDATES_DETERMINED", candidates, autoEliminated: null });
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
