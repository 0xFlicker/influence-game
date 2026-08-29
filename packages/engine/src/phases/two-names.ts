import type {
  CanonicalSourcePointer,
  FormatResolutionPayload,
} from "../canonical-events";
import {
  computeTwoNamesTallies,
  isLegalTwoNamesInitialPair,
  resolveTwoNames,
  twoNamesReplacementCandidates,
  type TwoNamesPair,
} from "../formats";
import { projectTwoNamesRound } from "../formats/two-names-events";
import { deterministicEngineFallback, engineFallbackMetadata } from "../engine-fallback";
import { ProviderUnavailableError } from "../provider-execution";
import { Phase, type UUID } from "../types";
import type { AgentResponse, StrategicDecisionMetadata } from "../game-runner.types";
import { runAllianceFormationPhase, runAllianceHuddleWindow } from "./alliances";
import { handleElimination } from "./elimination";
import { runMinglePhase } from "./mingle";
import {
  agentTurnSourcePointer,
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";

function requireAgent(ctx: PhaseRunnerContext, playerId: UUID, label: string) {
  const agent = ctx.agents.get(playerId);
  if (!agent) throw new Error(`Missing agent for ${label}: ${playerId}`);
  return agent;
}

function projection(ctx: PhaseRunnerContext) {
  const projected = projectTwoNamesRound(
    ctx.gameState.getCanonicalEvents(),
    ctx.gameState.round,
    ctx.gameState.getAlivePlayerIds(),
  );
  if (!projected) throw new Error("Two Names lifecycle has no canonical selection");
  return projected;
}

function pointer(
  actorId: UUID,
  action: string,
  phase: Phase,
  round: number,
  decision: Pick<StrategicDecisionMetadata, "decisionId" | "engineFallback">,
): CanonicalSourcePointer {
  return agentTurnSourcePointer(
    actorId,
    action,
    round,
    phase,
    undefined,
    decision.engineFallback ? undefined : decision.decisionId,
    decision.engineFallback,
  );
}

export async function runTwoNamesSetup(ctx: PhaseRunnerContext): Promise<void> {
  const { gameState, logger } = ctx;
  const empoweredId = gameState.empoweredId;
  if (!empoweredId) throw new Error("Two Names setup requires Empowered");
  const livingIds = gameState.getAlivePlayerIds();
  const legalNomineeIds = livingIds.filter((id) => id !== empoweredId);
  if (legalNomineeIds.length < 2) throw new Error("Two Names setup requires two legal nominees");
  const empoweredAgent = requireAgent(ctx, empoweredId, "Two Names initial nominations");
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    empoweredAgent,
    empoweredId,
    Phase.FORMAT_PICK,
    "strategic_decision",
    { empoweredId },
  );
  let nomineeIds: TwoNamesPair = [legalNomineeIds[0]!, legalNomineeIds[1]!];
  let decision: Awaited<ReturnType<NonNullable<typeof empoweredAgent.getTwoNamesInitialNames>>> = {
    firstNomineeId: nomineeIds[0],
    secondNomineeId: nomineeIds[1],
    decisionSource: "fallback",
    fallbackReason: "agent_method_unavailable",
    ...engineFallbackMetadata(
      phaseCtx,
      empoweredId,
      "format-two-names-initial-names",
      "agent_method_unavailable",
    ),
  };
  if (empoweredAgent.getTwoNamesInitialNames) {
    try {
      const candidate = await empoweredAgent.getTwoNamesInitialNames(phaseCtx, legalNomineeIds);
      const pair = [candidate.firstNomineeId, candidate.secondNomineeId] as TwoNamesPair;
      if (isLegalTwoNamesInitialPair(pair, empoweredId, livingIds)) {
        nomineeIds = pair;
        decision = candidate;
      } else {
        decision = {
          ...decision,
          decisionSource: "fallback",
          fallbackReason: "invalid_two_names_initial_names",
          ...engineFallbackMetadata(
            phaseCtx,
            empoweredId,
            "format-two-names-initial-names",
            "invalid_model_output",
          ),
        };
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      decision = {
        ...decision,
        decisionSource: "fallback",
        fallbackReason: "tool_call_failed",
        ...engineFallbackMetadata(
          phaseCtx,
          empoweredId,
          "format-two-names-initial-names",
          "provider_exhausted",
        ),
      };
    }
  }
  const drawIndex = Math.min(
    livingIds.length - 1,
    Math.floor((ctx.random?.() ?? 0) * livingIds.length),
  );
  const overrideHolderId = livingIds[drawIndex]!;
  await assertCanAcceptCommit(ctx);
  gameState.recordTwoNamesSetup(
    { empoweredId, initialNomineeIds: nomineeIds, overrideHolderId },
    [pointer(
      empoweredId,
      "format-two-names-initial-names",
      Phase.FORMAT_PICK,
      gameState.round,
      decision,
    )],
  );
  resolveActionStrategyCandidate(empoweredAgent, decision, decision.decisionSource === "llm");
  logger.logSystem(
    `${gameState.getPlayerName(empoweredId)} nominates: ${nomineeIds.map((id) => gameState.getPlayerName(id)).join(" and ")}.`,
    Phase.FORMAT_PICK,
  );
  logger.logSystem(
    `Override: ${gameState.getPlayerName(overrideHolderId)}.`,
    Phase.FORMAT_PICK,
  );
}

export async function runTwoNamesMingleWindow(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  window: "initial_names" | "final_names",
): Promise<void> {
  const current = projection(ctx);
  if (!current.finalistPlayerIds && !current.initialNomineeIds) {
    throw new Error("Two Names Mingle requires a nominee pair");
  }
  const pair = window === "initial_names"
    ? current.initialNomineeIds
    : current.finalistPlayerIds;
  if (!pair) throw new Error(`Two Names ${window} Mingle is missing its pair`);
  ctx.logger.logSystem(
    window === "initial_names" ? "=== TWO NAMES: FIRST MINGLE ===" : "=== TWO NAMES: FINAL MINGLE ===",
    Phase.FORMAT_MINGLE,
  );
  await runMinglePhase(ctx, actor, { phase: Phase.FORMAT_MINGLE, completePhase: false });
  await runAllianceFormationPhase(ctx);
  await runAllianceHuddleWindow(ctx, actor, Phase.FORMAT_MINGLE, { completePhase: false });
  await assertCanAcceptCommit(ctx);
  ctx.gameState.recordTwoNamesMingleCompleted(window, pair);
}

export async function runTwoNamesOverrideTransition(
  ctx: PhaseRunnerContext,
): Promise<"declined" | "used"> {
  const { gameState, logger } = ctx;
  const current = projection(ctx);
  const initial = current.initialNomineeIds;
  const holderId = current.overrideHolderId;
  const empoweredId = current.empoweredId;
  if (!initial || !holderId) throw new Error("Two Names Override requires canonical setup");
  const holder = requireAgent(ctx, holderId, "Two Names Override");
  const holderCtx = prepareAgentPhaseContext(
    ctx,
    holder,
    holderId,
    Phase.FORMAT_MINGLE,
    "strategic_decision",
    { empoweredId },
  );
  let overrideDecision: Awaited<ReturnType<NonNullable<typeof holder.getTwoNamesOverride>>> = {
    action: "decline",
    removedNomineeId: null,
    decisionSource: "fallback",
    fallbackReason: "agent_method_unavailable",
    ...engineFallbackMetadata(
      holderCtx,
      holderId,
      "format-two-names-override",
      "agent_method_unavailable",
    ),
  };
  if (holder.getTwoNamesOverride) {
    try {
      const candidate = await holder.getTwoNamesOverride(holderCtx, initial);
      const legal = candidate.action === "decline"
        ? candidate.removedNomineeId === null
        : candidate.removedNomineeId !== null && initial.includes(candidate.removedNomineeId);
      if (legal) overrideDecision = candidate;
      else {
        overrideDecision = {
          ...overrideDecision,
          decisionSource: "fallback",
          fallbackReason: "invalid_two_names_override",
          ...engineFallbackMetadata(holderCtx, holderId, "format-two-names-override", "invalid_model_output"),
        };
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      overrideDecision = {
        ...overrideDecision,
        decisionSource: "fallback",
        fallbackReason: "tool_call_failed",
        ...engineFallbackMetadata(holderCtx, holderId, "format-two-names-override", "provider_exhausted"),
      };
    }
  }
  const overridePointer = pointer(
    holderId,
    "format-two-names-override",
    Phase.FORMAT_MINGLE,
    gameState.round,
    overrideDecision,
  );
  if (overrideDecision.action === "decline") {
    await assertCanAcceptCommit(ctx);
    gameState.recordTwoNamesOverrideDeclined(holderId, initial, [overridePointer]);
    resolveActionStrategyCandidate(holder, overrideDecision, overrideDecision.decisionSource === "llm");
    logger.logSystem(`${gameState.getPlayerName(holderId)} declines Override.`, Phase.FORMAT_MINGLE);
    return "declined";
  }

  const removedNomineeId = overrideDecision.removedNomineeId;
  const retainedNomineeId = initial.find((id) => id !== removedNomineeId)!;
  const legalReplacementIds = twoNamesReplacementCandidates({
    livingIds: gameState.getAlivePlayerIds(),
    empoweredId,
    overrideHolderId: holderId,
    removedNomineeId,
    retainedNomineeId,
  });
  const empowered = requireAgent(ctx, empoweredId, "Two Names replacement");
  const empoweredCtx = prepareAgentPhaseContext(
    ctx,
    empowered,
    empoweredId,
    Phase.FORMAT_MINGLE,
    "strategic_decision",
    { empoweredId },
  );
  let replacementId = deterministicEngineFallback(
    legalReplacementIds,
    empoweredCtx,
    empoweredId,
    "format-two-names-replacement",
  );
  let replacementDecision: Awaited<ReturnType<NonNullable<typeof empowered.getTwoNamesReplacement>>> = {
    targetId: replacementId,
    decisionSource: "fallback",
    fallbackReason: "agent_method_unavailable",
    ...engineFallbackMetadata(
      empoweredCtx,
      empoweredId,
      "format-two-names-replacement",
      "agent_method_unavailable",
    ),
  };
  if (empowered.getTwoNamesReplacement) {
    try {
      const candidate = await empowered.getTwoNamesReplacement(empoweredCtx, legalReplacementIds);
      if (legalReplacementIds.includes(candidate.targetId)) {
        replacementId = candidate.targetId;
        replacementDecision = candidate;
      } else {
        replacementDecision = {
          ...replacementDecision,
          decisionSource: "fallback",
          fallbackReason: "invalid_two_names_replacement",
          ...engineFallbackMetadata(empoweredCtx, empoweredId, "format-two-names-replacement", "invalid_model_output"),
        };
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      replacementDecision = {
        ...replacementDecision,
        decisionSource: "fallback",
        fallbackReason: "tool_call_failed",
        ...engineFallbackMetadata(empoweredCtx, empoweredId, "format-two-names-replacement", "provider_exhausted"),
      };
    }
  }
  const finalistPlayerIds: TwoNamesPair = initial[0] === removedNomineeId
    ? [replacementId, retainedNomineeId]
    : [retainedNomineeId, replacementId];
  await assertCanAcceptCommit(ctx);
  gameState.recordTwoNamesOverrideUsed({
    overrideHolderId: holderId,
    removedNomineeId,
    empoweredId,
    replacementNomineeId: replacementId,
    finalistPlayerIds,
  }, {
    override: [overridePointer],
    replacement: [pointer(
      empoweredId,
      "format-two-names-replacement",
      Phase.FORMAT_MINGLE,
      gameState.round,
      replacementDecision,
    )],
  });
  resolveActionStrategyCandidate(holder, overrideDecision, overrideDecision.decisionSource === "llm");
  resolveActionStrategyCandidate(empowered, replacementDecision, replacementDecision.decisionSource === "llm");
  logger.logSystem(
    `${gameState.getPlayerName(holderId)} removes ${gameState.getPlayerName(removedNomineeId)}.`,
    Phase.FORMAT_MINGLE,
  );
  logger.logSystem(
    `${gameState.getPlayerName(empoweredId)} names ${gameState.getPlayerName(replacementId)} as the replacement.`,
    Phase.FORMAT_MINGLE,
  );
  return "used";
}

export async function runTwoNamesPlea(
  ctx: PhaseRunnerContext,
  ordinal: 0 | 1,
): Promise<void> {
  const { gameState, logger } = ctx;
  const current = projection(ctx);
  const finalists = current.finalistPlayerIds;
  if (!finalists) throw new Error("Two Names plea requires final nominees");
  const speakerId = finalists[ordinal];
  const agent = requireAgent(ctx, speakerId, "Two Names plea");
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    agent,
    speakerId,
    Phase.FORMAT_RESOLVE,
    "ordinary_speech",
    { empoweredId: current.empoweredId },
  );
  let response: AgentResponse | undefined = agent.getTwoNamesPlea
    ? undefined
    : {
        thinking: "",
        message: "",
        providerAbsence: { kind: "provider_exhausted", outcome: "service_error" },
        ...engineFallbackMetadata(
          phaseCtx,
          speakerId,
          "format-two-names-plea",
          "agent_method_unavailable",
        ),
      };
  if (agent.getTwoNamesPlea) {
    try {
      response = await agent.getTwoNamesPlea(phaseCtx, finalists);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      response = {
        thinking: "",
        message: "",
        providerAbsence: {
          kind: "provider_exhausted" as const,
          outcome: error.outcome.kind,
        },
        ...engineFallbackMetadata(
          phaseCtx,
          speakerId,
          "format-two-names-plea",
          "provider_exhausted",
        ),
      };
    }
  }
  if (!response) throw new Error("Two Names plea produced no response");
  const accepted = !response.providerAbsence && response.message.trim().length > 0;
  await assertCanAcceptCommit(ctx);
  gameState.recordTwoNamesPlea({
    speakerId,
    ordinal,
    status: accepted ? "accepted" : "absent",
    text: accepted ? response.message.trim() : null,
    absenceReason: accepted ? null : "provider_unavailable",
  }, accepted ? [pointer(
    speakerId,
    "format-two-names-plea",
    Phase.FORMAT_RESOLVE,
    gameState.round,
    response,
  )] : []);
  if (!accepted) {
    logger.logSystem(`${gameState.getPlayerName(speakerId)}: No plea was received.`, Phase.FORMAT_RESOLVE);
    return;
  }
  resolveActionStrategyCandidate(agent, response, true);
  logger.logPublic(speakerId, response.message.trim(), Phase.FORMAT_RESOLVE, {
    thinking: response.thinking,
    reasoningContext: response.reasoningContext,
  });
  logger.emitAgentTurn({
    phase: Phase.FORMAT_RESOLVE,
    action: "format-two-names-plea",
    actor: { id: speakerId, name: gameState.getPlayerName(speakerId), role: "player" },
    visibility: "public",
    response: { message: response.message.trim(), ...strategicDecisionResponse(response) },
    thinking: response.thinking,
    reasoningContext: response.reasoningContext,
    scope: "public",
    text: response.message.trim(),
  });
}

export async function runTwoNamesBallots(ctx: PhaseRunnerContext): Promise<void> {
  const { gameState, logger } = ctx;
  const current = projection(ctx);
  const finalists = current.finalistPlayerIds;
  if (!finalists) throw new Error("Two Names ballots require final nominees");
  for (const voterId of current.eligibleVoterIds) {
    const voter = requireAgent(ctx, voterId, "Two Names ballot");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      voter,
      voterId,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId: current.empoweredId },
    );
    let targetId = deterministicEngineFallback(
      finalists,
      phaseCtx,
      voterId,
      "format-two-names-ballot",
    );
    let decision: Awaited<ReturnType<NonNullable<typeof voter.getTwoNamesBallot>>> = {
      targetId,
      decisionSource: "fallback",
      fallbackReason: "agent_method_unavailable",
      ...engineFallbackMetadata(phaseCtx, voterId, "format-two-names-ballot", "agent_method_unavailable"),
    };
    if (voter.getTwoNamesBallot) {
      try {
        const candidate = await voter.getTwoNamesBallot(phaseCtx, finalists);
        if (finalists.includes(candidate.targetId)) {
          targetId = candidate.targetId;
          decision = candidate;
        } else {
          decision = {
            ...decision,
            decisionSource: "fallback",
            fallbackReason: "invalid_two_names_ballot",
            ...engineFallbackMetadata(phaseCtx, voterId, "format-two-names-ballot", "invalid_model_output"),
          };
        }
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        decision = {
          ...decision,
          decisionSource: "fallback",
          fallbackReason: "tool_call_failed",
          ...engineFallbackMetadata(phaseCtx, voterId, "format-two-names-ballot", "provider_exhausted"),
        };
      }
    }
    await assertCanAcceptCommit(ctx);
    gameState.recordFormatBallot({
      formatId: "two_names",
      voterId,
      targetId,
    }, [pointer(
      voterId,
      "format-two-names-ballot",
      Phase.FORMAT_RESOLVE,
      gameState.round,
      decision,
    )]);
    resolveActionStrategyCandidate(voter, decision, decision.decisionSource === "llm");
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: voterId, name: gameState.getPlayerName(voterId), role: "player" },
      visibility: "private",
      response: {
        formatId: "two_names",
        targetId,
        targetName: gameState.getPlayerName(targetId),
        sealed: true,
        decisionSource: decision.decisionSource,
        fallbackReason: decision.fallbackReason,
        ...strategicDecisionResponse(decision),
      },
      thinking: decision.thinking,
      reasoningContext: decision.reasoningContext,
      scope: "system",
      text: `${gameState.getPlayerName(voterId)} sealed ballot: EXIT → ${gameState.getPlayerName(targetId)}`,
    });
  }
}

export async function runTwoNamesResolution(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState } = ctx;
  const current = projection(ctx);
  const finalists = current.finalistPlayerIds;
  if (!finalists) throw new Error("Two Names resolution requires finalists");
  const outcome = resolveTwoNames(finalists, current.eligibleVoterIds, current.ballots);
  let eliminatedId = outcome.eliminatedId;
  let resolutionPointers: CanonicalSourcePointer[] = [];
  if (outcome.kind === "tie") {
    const empoweredId = current.empoweredId;
    const empowered = requireAgent(ctx, empoweredId, "Two Names tiebreak");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      empowered,
      empoweredId,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId },
    );
    eliminatedId = deterministicEngineFallback(
      finalists,
      phaseCtx,
      empoweredId,
      "format-two-names-tiebreak",
    );
    let decision: Awaited<ReturnType<NonNullable<typeof empowered.breakTwoNamesTie>>> = {
      targetId: eliminatedId,
      decisionSource: "fallback",
      fallbackReason: "agent_method_unavailable",
      ...engineFallbackMetadata(phaseCtx, empoweredId, "format-two-names-tiebreak", "agent_method_unavailable"),
    };
    if (empowered.breakTwoNamesTie) {
      try {
        const candidate = await empowered.breakTwoNamesTie(phaseCtx, finalists);
        if (finalists.includes(candidate.targetId)) {
          eliminatedId = candidate.targetId;
          decision = candidate;
        } else {
          decision = {
            ...decision,
            decisionSource: "fallback",
            fallbackReason: "invalid_two_names_tiebreak",
            ...engineFallbackMetadata(phaseCtx, empoweredId, "format-two-names-tiebreak", "invalid_model_output"),
          };
        }
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        decision = {
          ...decision,
          decisionSource: "fallback",
          fallbackReason: "tool_call_failed",
          ...engineFallbackMetadata(phaseCtx, empoweredId, "format-two-names-tiebreak", "provider_exhausted"),
        };
      }
    }
    resolutionPointers = [pointer(
      empoweredId,
      "format-two-names-tiebreak",
      Phase.FORMAT_RESOLVE,
      gameState.round,
      decision,
    )];
    resolveActionStrategyCandidate(empowered, decision, decision.decisionSource === "llm");
  }
  if (!eliminatedId) throw new Error("Two Names resolution produced no eliminated finalist");
  const score = computeTwoNamesTallies(finalists, current.eligibleVoterIds, current.ballots);
  const canonicalResolution: FormatResolutionPayload = {
    formatId: "two_names",
    empoweredId: current.empoweredId,
    eliminatedId,
    resolutionKind: outcome.kind === "tie" ? "auto" : "clear",
    tiedPlayerIds: outcome.kind === "tie" ? [...finalists] : [eliminatedId],
    tiebreakerId: outcome.kind === "tie" ? current.empoweredId : null,
    aggregate: {
      capability: "two_names",
      initialNomineeIds: [...current.initialNomineeIds!],
      overrideHolderId: current.overrideHolderId!,
      overrideAction: current.overrideAction!,
      removedNomineeId: current.removedNomineeId,
      replacementNomineeId: current.replacementNomineeId,
      finalistPlayerIds: [...finalists],
      eligibleVoterIds: [...current.eligibleVoterIds],
      totals: { ...score.totals },
    },
  };
  await assertCanAcceptCommit(ctx);
  gameState.recordFormatResolution(canonicalResolution, resolutionPointers);
  await handleElimination(ctx, eliminatedId, Phase.FORMAT_RESOLVE, {
    mode: "format",
    formatId: "two_names",
    voteDisclosure: {
      visibility: "sealed",
      votesReceived: score.totals[eliminatedId] ?? 0,
    },
  });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runTwoNamesFormatMingle(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  await runTwoNamesSetup(ctx);
  await runTwoNamesMingleWindow(ctx, actor, "initial_names");
  const outcome = await runTwoNamesOverrideTransition(ctx);
  if (outcome === "used") await runTwoNamesMingleWindow(ctx, actor, "final_names");
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runTwoNamesFormatResolve(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  await runTwoNamesPlea(ctx, 0);
  await runTwoNamesPlea(ctx, 1);
  await runTwoNamesBallots(ctx);
  await runTwoNamesResolution(ctx, actor);
}
