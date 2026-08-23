import type { UUID, PowerAction } from "../types";
import { Phase } from "../types";
import type { CandidateChoiceRequest, PowerActionDecision, PowerLobbyExposure } from "../game-runner.types";
import {
  deterministicEngineFallback,
  engineFallbackMetadata,
} from "../engine-fallback";
import type { ShieldReplacementResolution } from "../exposure-bench";
import { ProviderAttemptError } from "../provider-execution";
import {
  assertCanAcceptCommit,
  agentTurnSourcePointer,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
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
  phaseContext: Parameters<typeof engineFallbackMetadata>[0],
  actorId: UUID,
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
    const id = deterministicEngineFallback(
      pool,
      phaseContext,
      actorId,
      `shield-replacement-${selected.length}`,
    );
    const index = pool.indexOf(id);
    pool.splice(index, 1);
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
  const { gameState, agents, logger } = ctx;
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

      const phaseCtx = prepareAgentPhaseContext(
        ctx,
        agent,
        player.id,
        Phase.POWER,
        "ordinary_speech",
        {
          empoweredId,
          councilCandidates: provisionalCandidates,
        },
      );
      const response = await agent.getPowerLobbyMessage(
        phaseCtx,
        provisionalCandidates,
        exposePressure,
      );
      if (response.providerAbsence || !response.message.trim()) return;
      const { message, thinking, reasoningContext } = response;
      await assertCanAcceptCommit(ctx);
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.POWER, transcriptThinking);
      resolveActionStrategyCandidate(
        agent,
        response,
        response.strategyGameplayAccepted !== false,
      );
      logger.emitAgentTurn({
        phase: Phase.POWER,
        action: "power-lobby-message",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: {
          message,
          empowered: { id: empoweredId, name: gameState.getPlayerName(empoweredId) },
          provisionalCandidates: provisionalCandidates.map((id) => ({ id, name: gameState.getPlayerName(id) })),
          ...strategicDecisionResponse(response),
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
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    empoweredAgent,
    empoweredId,
    Phase.POWER,
    "strategic_decision",
    { empoweredId, councilCandidates: prelim },
  );
  const shieldReplacementRequests = prelim
    .map((candidateId) => gameState.previewShieldReplacement(candidateId))
    .filter((resolution): resolution is ShieldReplacementResolution => Boolean(resolution))
    .filter(shouldRequestShieldReplacementChoice)
    .map(shieldReplacementChoiceRequest);
  let powerActionResult: PowerActionDecision;
  try {
    powerActionResult = await empoweredAgent.getPowerAction(phaseCtx, prelim, { shieldReplacementRequests });
  } catch (error) {
    if (!(error instanceof ProviderAttemptError)) throw error;
    powerActionResult = {
      action: "pass" as const,
      target: prelim[0],
      ...engineFallbackMetadata(
        phaseCtx,
        empoweredId,
        "power",
        "provider_exhausted",
      ),
    };
  }
  const legalPowerAction = (powerActionResult.action === "pass" && prelim.includes(powerActionResult.target))
    || (powerActionResult.action === "eliminate" && prelim.includes(powerActionResult.target))
    || (powerActionResult.action === "protect" && gameState.getAlivePlayerIds().includes(powerActionResult.target));
  if (!legalPowerAction) {
    powerActionResult = {
      action: "pass" as const,
      target: deterministicEngineFallback(prelim, phaseCtx, empoweredId, "power"),
      ...engineFallbackMetadata(phaseCtx, empoweredId, "power", "invalid_model_output"),
    };
  }
  let replacementCandidateIds: UUID[] = [];
  let replacementSelectionFallback = false;
  if (powerActionResult.action === "protect" && prelim.includes(powerActionResult.target)) {
    const request = shieldReplacementRequests.find(
      (candidateRequest) => candidateRequest.protectedCandidateId === powerActionResult.target,
    );
    if (request) {
      const selection = resolveBundledShieldPullUp(
        request,
        phaseCtx,
        empoweredId,
        powerActionResult.shieldPullUpCandidateIds,
      );
      replacementCandidateIds = selection.selectedCandidateIds;
      replacementSelectionFallback = selection.fallbackApplied;
      if (selection.fallbackApplied) {
        powerActionResult = {
          action: powerActionResult.action,
          target: powerActionResult.target,
          shieldPullUpCandidateIds: replacementCandidateIds,
          ...engineFallbackMetadata(
            phaseCtx,
            empoweredId,
            "power",
            "invalid_model_output",
          ),
        };
      }
    }
  }
  const powerAction: PowerAction = { action: powerActionResult.action, target: powerActionResult.target };
  await assertCanAcceptCommit(ctx);
  gameState.setPowerAction(powerAction, [
    agentTurnSourcePointer(
      empoweredId,
      "power",
      gameState.round,
      Phase.POWER,
      undefined,
      powerAction.action === "pass" || powerActionResult.engineFallback
        ? undefined
        : powerActionResult.decisionId,
      powerActionResult.engineFallback,
    ),
  ]);
  resolveActionStrategyCandidate(
    empoweredAgent,
    powerActionResult,
    powerActionResult.strategyGameplayAccepted !== false,
  );
  let shieldPullUpResponse: Record<string, unknown> | null = null;
  if (powerAction.action === "protect" && prelim.includes(powerAction.target)) {
    const request = shieldReplacementRequests.find(
      (candidateRequest) => candidateRequest.protectedCandidateId === powerAction.target,
    );
    if (request) {
      const resolvedPreview = gameState.previewShieldReplacement(powerAction.target, replacementCandidateIds);
      shieldPullUpResponse = {
        mode: resolvedPreview?.mode ?? request.mode,
        protectedCandidate: { id: powerAction.target, name: gameState.getPlayerName(powerAction.target) },
        lockedCandidates: request.lockedCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        eligibleChoices: request.eligibleCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        selectedCandidates: (resolvedPreview?.selectedCandidateIds ?? replacementCandidateIds).map((id) => ({ id, name: gameState.getPlayerName(id) })),
        resolvedCandidates: resolvedPreview?.candidates?.map((id) => ({ id, name: gameState.getPlayerName(id) })) ?? null,
        fallbackApplied: replacementSelectionFallback || (resolvedPreview?.fallbackApplied ?? false),
        fallbackReason: replacementSelectionFallback ? "deterministic_selection" : resolvedPreview?.fallbackReason ?? null,
      };
    }
  }
  const transcriptThinking = transcriptThinkingFor(
    empoweredAgent,
    powerActionResult.thinking,
    powerActionResult.reasoningContext,
    powerActionResult,
  );
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
      ...strategicDecisionResponse(powerActionResult),
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
      voteDisclosure: {
        visibility: "none",
        reason: "direct_elimination",
      },
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
