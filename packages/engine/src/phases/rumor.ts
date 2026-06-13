import { Phase } from "../types";
import { strategyPacketUseResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";

export async function runRumorPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.RUMOR);
  logger.logSystem("=== RUMOR PHASE ===", Phase.RUMOR);
  const alivePlayers = gameState.getAlivePlayers();

  const rumors = await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.RUMOR);
      const { message, thinking, reasoningContext, strategyPacketUse, strategicLens, strategicLensRationale } = await agent.getRumorMessage(phaseCtx);
      return { playerId: player.id, message, thinking, reasoningContext, strategyPacketUse, strategicLens, strategicLensRationale };
    }),
  );

  // Shuffle display order (Fisher-Yates)
  const shuffled = [...rumors];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  for (let i = 0; i < shuffled.length; i++) {
    const rumor = shuffled[i]!;
    const playerName = gameState.getPlayerName(rumor.playerId);
    const agent = agents.get(rumor.playerId)!;
    const transcriptThinking = transcriptThinkingFor(agent, rumor.thinking, rumor.reasoningContext);
    logger.logPublic(rumor.playerId, rumor.message, Phase.RUMOR, {
      anonymous: true,
      displayOrder: i + 1,
      ...transcriptThinking,
    });
    logger.emitAgentTurn({
      phase: Phase.RUMOR,
      action: "rumor",
      actor: { id: rumor.playerId, name: playerName, role: "player" },
      visibility: "anonymous",
      response: {
        message: rumor.message,
        displayOrder: i + 1,
        strategicLens: rumor.strategicLens ?? null,
        strategicLensRationale: rumor.strategicLensRationale ?? null,
        ...strategyPacketUseResponse(rumor.strategyPacketUse),
      },
      thinking: rumor.thinking,
      reasoningContext: rumor.reasoningContext,
      scope: "public",
      text: rumor.message,
      anonymous: true,
      displayOrder: i + 1,
    });
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
