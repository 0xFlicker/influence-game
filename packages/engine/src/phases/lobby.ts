import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

/**
 * Compute messages per player for lobby phase.
 * Scaling: fewer players = more messages per player.
 * 4-5 players → 4, 6-7 → 3, 8+ → 2.
 */
export function computeLobbyMessagesPerPlayer(aliveCount: number, configOverride?: number): number {
  if (configOverride != null) return configOverride;
  if (aliveCount <= 5) return 4;
  if (aliveCount <= 7) return 3;
  return 2;
}

async function runLobbyMessages(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;
  const alivePlayers = gameState.getAlivePlayers();
  const messagesPerPlayer = computeLobbyMessagesPerPlayer(alivePlayers.length, config.lobbyMessagesPerPlayer);

  // Pre-lobby intent
  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      if (agent.getLobbyIntent) {
        const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.LOBBY);
        await agent.getLobbyIntent(phaseCtx);
      }
    }),
  );

  // Sub-rounds
  for (let sub = 0; sub < messagesPerPlayer; sub++) {
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = agents.get(player.id)!;
        const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.LOBBY);
        phaseCtx.lobbySubRound = sub;
        phaseCtx.lobbyTotalSubRounds = messagesPerPlayer;
        const text = await agent.getLobbyMessage(phaseCtx);
        logger.logPublic(player.id, text, Phase.LOBBY);
      }),
    );
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runLobbyPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  gameState.startRound();
  gameState.expireShields();
  const round = gameState.round;
  logger.emitPhaseChange(Phase.LOBBY);
  logger.logSystem(`=== ROUND ${round}: LOBBY PHASE ===`, Phase.LOBBY);

  await runLobbyMessages(ctx, actor);
}

export async function runReckoningLobby(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  gameState.startRound();
  gameState.setEndgameStage("reckoning");
  const round = gameState.round;
  logger.emitPhaseChange(Phase.LOBBY);
  logger.logSystem(`\n========================================`, Phase.LOBBY);
  logger.logSystem(`=== THE RECKONING (Round ${round}) ===`, Phase.LOBBY);
  logger.logSystem(`========================================`, Phase.LOBBY);
  logger.logSystem(`${gameState.describeState()}`, Phase.LOBBY);

  await runLobbyMessages(ctx, actor);
}

export async function runTribunalLobby(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  gameState.startRound();
  gameState.setEndgameStage("tribunal");
  const round = gameState.round;
  logger.emitPhaseChange(Phase.LOBBY);
  logger.logSystem(`\n========================================`, Phase.LOBBY);
  logger.logSystem(`=== THE TRIBUNAL (Round ${round}) ===`, Phase.LOBBY);
  logger.logSystem(`========================================`, Phase.LOBBY);
  logger.logSystem(`${gameState.describeState()}`, Phase.LOBBY);

  await runLobbyMessages(ctx, actor);
}
