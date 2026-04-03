import { Phase } from "../types";
import type { PhaseRunnerContext, PhaseActor } from "./phase-runner-context";

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
      const text = await agent.getIntroduction(phaseCtx);
      logger.logPublic(player.id, text, Phase.INTRODUCTION);
    }),
  );

  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: aliveInfos.map((p) => p.id) });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
