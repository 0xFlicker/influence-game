import { Phase } from "../types";
import { assertCanAcceptCommit, strategyPacketUseResponse, transcriptThinkingFor, type PhaseRunnerContext, type PhaseActor } from "./phase-runner-context";

export async function runIntroductionPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  logger.emitPhaseChange(Phase.INTRODUCTION);
  logger.logSystem("=== INTRODUCTION PHASE ===", Phase.INTRODUCTION);
  const alivePlayers = gameState.getAlivePlayers();
  const aliveInfos = alivePlayers.map((p) => ({ id: p.id, name: p.name }));

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.INTRODUCTION);
      const { message, thinking, reasoningContext, strategyPacketUse } = await agent.getIntroduction(phaseCtx);
      await assertCanAcceptCommit(ctx);
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.INTRODUCTION, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.INTRODUCTION,
        action: "introduction",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: { message, ...strategyPacketUseResponse(strategyPacketUse) },
        thinking,
        reasoningContext,
        scope: "public",
        text: message,
      });
    }),
  );

  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: aliveInfos.map((p) => p.id) });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
