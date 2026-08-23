import { Phase } from "../types";
import {
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";

export async function runRumorPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger } = ctx;

  logger.emitPhaseChange(Phase.RUMOR);
  logger.logSystem("=== RUMOR PHASE ===", Phase.RUMOR);
  const alivePlayers = gameState.getAlivePlayers();

  const rumors = await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.RUMOR, "ordinary_speech");
      const response = await agent.getRumorMessage(phaseCtx);
      return { playerId: player.id, ...response };
    }),
  );

  // Shuffle display order (Fisher-Yates)
  const shuffled = rumors.filter(
    (rumor) => !rumor.providerAbsence && rumor.message.trim().length > 0,
  );
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  for (let i = 0; i < shuffled.length; i++) {
    const rumor = shuffled[i]!;
    const playerName = gameState.getPlayerName(rumor.playerId);
    const agent = agents.get(rumor.playerId)!;
    const transcriptThinking = transcriptThinkingFor(agent, rumor.thinking, rumor.reasoningContext);
    await assertCanAcceptCommit(ctx);
    logger.logPublic(rumor.playerId, rumor.message, Phase.RUMOR, {
      anonymous: true,
      displayOrder: i + 1,
      ...transcriptThinking,
    });
    resolveActionStrategyCandidate(
      agent,
      rumor,
      rumor.strategyGameplayAccepted !== false,
    );
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
        ...strategicDecisionResponse(rumor),
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
