import { Phase } from "../types";
import {
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseRunnerContext,
  type PhaseActor,
} from "./phase-runner-context";
import type { AgentResponse } from "../game-runner.types";
import type { UUID } from "../types";

export interface IntroductionBatchItem {
  playerId: UUID;
  response: AgentResponse;
}

/** Dispatch against one frozen frontier; no game, transcript, or continuity mutation. */
export async function collectIntroductionBatch(
  ctx: PhaseRunnerContext,
): Promise<IntroductionBatchItem[]> {
  const alivePlayers = ctx.gameState.getAlivePlayers();
  return Promise.all(alivePlayers.map(async (player) => {
    const agent = ctx.agents.get(player.id)!;
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      agent,
      player.id,
      Phase.INTRODUCTION,
      "ordinary_speech",
    );
    return {
      playerId: player.id,
      response: await agent.getIntroduction(phaseCtx),
    };
  }));
}

/** Apply a collected batch in its stable roster order. */
export async function applyIntroductionBatch(
  ctx: PhaseRunnerContext,
  batch: readonly IntroductionBatchItem[],
): Promise<void> {
  const { gameState, agents, logger } = ctx;
  for (const item of batch) {
    const player = gameState.getPlayer(item.playerId);
    if (!player) throw new Error(`Introduction batch references missing player ${item.playerId}`);
    const agent = agents.get(item.playerId)!;
    const { response } = item;
    const { message, thinking, reasoningContext } = response;
    if (response.providerAbsence || !message.trim()) continue;
    await assertCanAcceptCommit(ctx);
    const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
    logger.logPublic(player.id, message, Phase.INTRODUCTION, transcriptThinking);
    resolveActionStrategyCandidate(
      agent,
      response,
      response.strategyGameplayAccepted !== false,
    );
    logger.emitAgentTurn({
      phase: Phase.INTRODUCTION,
      action: "introduction",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "public",
      response: { message, ...strategicDecisionResponse(response) },
      thinking,
      reasoningContext,
      scope: "public",
      text: message,
    });
  }
}

export async function runIntroductionPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  logger.emitPhaseChange(Phase.INTRODUCTION);
  logger.logSystem("=== INTRODUCTION PHASE ===", Phase.INTRODUCTION);
  const alivePlayers = gameState.getAlivePlayers();
  const aliveInfos = alivePlayers.map((p) => ({ id: p.id, name: p.name }));

  const batch = await collectIntroductionBatch(ctx);
  await applyIntroductionBatch(ctx, batch);

  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: aliveInfos.map((p) => p.id) });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
