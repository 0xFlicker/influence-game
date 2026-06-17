import type { UUID, PowerAction } from "../types";
import { Phase } from "../types";
import type { CandidateChoiceRequest, PowerLobbyExposure } from "../game-runner.types";
import type { ShieldReplacementResolution } from "../exposure-bench";
import { assertCanAcceptCommit, agentTurnSourcePointer, strategyPacketUseResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";
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

function shouldRequestShieldReplacementChoice(resolution: ShieldReplacementResolution): boolean {
  return resolution.choice.requiredCount > 0;
}

function shieldReplacementChoiceRequest(resolution: ShieldReplacementResolution): CandidateChoiceRequest {
  return {
    lockedCandidateIds: resolution.remainingCandidateIds,
    eligibleCandidateIds: resolution.choice.eligibleCandidateIds,
    requiredCount: resolution.choice.requiredCount,
    mode: resolution.mode,
    fallbackReason: resolution.fallbackReason,
    protectedCandidateId: resolution.protectedCandidateId,
  };
}

function resolveBundledShieldPullUp(
  request: CandidateChoiceRequest,
  selectedCandidateIds: UUID[] = [],
): { selectedCandidateIds: UUID[]; fallbackApplied: boolean } {
  const eligibleSet = new Set(request.eligibleCandidateIds);
  const selected: UUID[] = [];
  let fallbackApplied = selectedCandidateIds.length < request.requiredCount;

  for (const id of selectedCandidateIds) {
    if (!eligibleSet.has(id) || selected.includes(id)) {
      fallbackApplied = true;
      continue;
    }
    selected.push(id);
    if (selected.length === request.requiredCount) break;
  }

  const pool = request.eligibleCandidateIds.filter((id) => !selected.includes(id));
  while (selected.length < request.requiredCount && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [id] = pool.splice(index, 1);
    if (id) selected.push(id);
  }

  return { selectedCandidateIds: selected, fallbackApplied };
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
      const { message, thinking, reasoningContext, strategyPacketUse } = await agent.getPowerLobbyMessage(
        phaseCtx,
        provisionalCandidates,
        exposePressure,
      );
      await assertCanAcceptCommit(ctx);
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.POWER, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.POWER,
        action: "power-lobby-message",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: {
          message,
          empowered: { id: empoweredId, name: gameState.getPlayerName(empoweredId) },
          provisionalCandidates: provisionalCandidates.map((id) => ({ id, name: gameState.getPlayerName(id) })),
          ...strategyPacketUseResponse(strategyPacketUse),
        },
        thinking,
        reasoningContext,
        scope: "public",
        text: message,
      });
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
  const initialResolution = gameState.initialCandidateResolution ?? gameState.resolveInitialCandidates();
  const prelim = initialResolution?.candidates;
  if (!prelim) {
    actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: null });
    actor.send({ type: "PHASE_COMPLETE" });
    return;
  }
  const exposePressure = buildExposePressure(ctx, scores);

  if (ctx.config.powerLobbyAfterVote) {
    await runPowerLobbyMessages(ctx, empoweredId, prelim, exposePressure);
  }

  const empoweredAgent = agents.get(empoweredId)!;
  const phaseCtx = contextBuilder.buildPhaseContext(empoweredId, Phase.POWER, { empoweredId, councilCandidates: prelim });
  const shieldReplacementRequests = prelim
    .map((candidateId) => gameState.previewShieldReplacement(candidateId))
    .filter((resolution): resolution is ShieldReplacementResolution => Boolean(resolution))
    .filter(shouldRequestShieldReplacementChoice)
    .map(shieldReplacementChoiceRequest);
  const powerActionResult = await empoweredAgent.getPowerAction(phaseCtx, prelim, { shieldReplacementRequests });
  const powerAction: PowerAction = { action: powerActionResult.action, target: powerActionResult.target };
  await assertCanAcceptCommit(ctx);
  gameState.setPowerAction(powerAction, [
    agentTurnSourcePointer(empoweredId, "power-action", gameState.round, Phase.POWER),
  ]);
  let replacementCandidateIds: UUID[] = [];
  let shieldPullUpResponse: Record<string, unknown> | null = null;
  if (powerAction.action === "protect" && prelim.includes(powerAction.target)) {
    const request = shieldReplacementRequests.find(
      (candidateRequest) => candidateRequest.protectedCandidateId === powerAction.target,
    );
    if (request) {
      const selection = resolveBundledShieldPullUp(request, powerActionResult.shieldPullUpCandidateIds);
      replacementCandidateIds = selection.selectedCandidateIds;
      const resolvedPreview = gameState.previewShieldReplacement(powerAction.target, replacementCandidateIds);
      shieldPullUpResponse = {
        mode: resolvedPreview?.mode ?? request.mode,
        protectedCandidate: { id: powerAction.target, name: gameState.getPlayerName(powerAction.target) },
        lockedCandidates: request.lockedCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        eligibleChoices: request.eligibleCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        selectedCandidates: (resolvedPreview?.selectedCandidateIds ?? replacementCandidateIds).map((id) => ({ id, name: gameState.getPlayerName(id) })),
        resolvedCandidates: resolvedPreview?.candidates?.map((id) => ({ id, name: gameState.getPlayerName(id) })) ?? null,
        fallbackApplied: selection.fallbackApplied || (resolvedPreview?.fallbackApplied ?? false),
        fallbackReason: selection.fallbackApplied ? "random_selection" : resolvedPreview?.fallbackReason ?? null,
      };
    }
  }
  const transcriptThinking = transcriptThinkingFor(empoweredAgent, powerActionResult.thinking, powerActionResult.reasoningContext);
  logger.logSystem(
    `${gameState.getPlayerName(empoweredId)} power action: ${powerAction.action} -> ${gameState.getPlayerName(powerAction.target)}`,
    Phase.POWER,
    transcriptThinking.thinking,
    transcriptThinking.reasoningContext,
  );
  logger.emitAgentTurn({
    phase: Phase.POWER,
    action: "power-action",
    actor: { id: empoweredId, name: gameState.getPlayerName(empoweredId), role: "player" },
    visibility: "private",
    response: {
      action: powerAction.action,
      target: { id: powerAction.target, name: gameState.getPlayerName(powerAction.target) },
      candidates: prelim.map((id) => ({ id, name: gameState.getPlayerName(id) })),
      ...(shieldPullUpResponse ? { shieldPullUp: shieldPullUpResponse } : {}),
      ...strategyPacketUseResponse(powerActionResult.strategyPacketUse),
    },
    thinking: powerActionResult.thinking,
    reasoningContext: powerActionResult.reasoningContext,
    scope: "system",
    text: `${gameState.getPlayerName(empoweredId)} power action: ${powerAction.action} -> ${gameState.getPlayerName(powerAction.target)}`,
  });

  if (powerAction.action === "protect") {
    empoweredAgent.updateAlly(gameState.getPlayerName(powerAction.target));
  } else if (powerAction.action === "eliminate") {
    empoweredAgent.updateThreat(gameState.getPlayerName(powerAction.target));
  }

  await assertCanAcceptCommit(ctx);
  const { candidates, autoEliminated, shieldGranted } = gameState.determineCandidates(replacementCandidateIds);
  contextBuilder.currentPostVotePressure = null;

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
