import type { UUID } from "../types";
import { Phase } from "../types";
import type { PowerLobbyExposure } from "../game-runner.types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";
import { getExposeVoterNames, handleElimination } from "./elimination";

function buildExposePressure(
  ctx: PhaseRunnerContext,
  scores: Record<UUID, number>,
): PowerLobbyExposure[] {
  return ctx.gameState
    .getAlivePlayerIds()
    .map((id) => ({
      id,
      name: ctx.gameState.getPlayerName(id),
      score: scores[id] ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

async function runPowerLobbyMessages(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
  provisionalCandidates: [UUID, UUID],
  exposePressure: PowerLobbyExposure[],
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const candidateNames = provisionalCandidates.map((id) => gameState.getPlayerName(id));
  const pressureSummary = exposePressure
    .slice(0, 3)
    .map((player) => `${player.name} (${player.score})`)
    .join(", ");

  logger.logSystem(
    `POWER LOBBY: The vote is locked. ${gameState.getPlayerName(empoweredId)} holds power. Provisional council pressure falls on ${candidateNames.join(" and ")}. Top expose pressure: ${pressureSummary}. Protect can still change the final reveal.`,
    Phase.POWER,
  );

  await Promise.all(
    gameState.getAlivePlayers().map(async (player) => {
      const agent = agents.get(player.id);
      if (!agent?.getPowerLobbyMessage) return;

      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.POWER, {
        empoweredId,
        councilCandidates: provisionalCandidates,
      });
      const { message, thinking } = await agent.getPowerLobbyMessage(
        phaseCtx,
        provisionalCandidates,
        exposePressure,
      );
      logger.logPublic(player.id, message, Phase.POWER, { thinking });
    }),
  );
}

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
  const exposePressure = buildExposePressure(ctx, scores);

  if (ctx.config.powerLobbyAfterVote) {
    await runPowerLobbyMessages(ctx, empoweredId, prelim, exposePressure);
  }

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
    await handleElimination(ctx, autoEliminated, Phase.POWER, {
      mode: "power",
      directExecutor: gameState.getPlayerName(empoweredId),
      exposedBy: getExposeVoterNames(ctx, autoEliminated),
    });

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
