/**
 * Sequester format kernel phase handlers:
 * menu → pick → format mingle → catalog-dispatched resolution.
 */

import {
  applyBouncePointer,
  applyFormatTiebreak,
  buildFormatMenu,
  computeSaveOrEliminateNets,
  createBounceBoard,
  displayNameForFormat,
  getFormatRegistration,
  isLegalBouncePointer,
  isLegalSafetyBounceVote,
  isLegalSaveOrEliminateBallot,
  pickFormatFromMenu,
  resolveSealedElimRound,
  restrictedHistoryLegalTargets,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  type FormatEliminationResolution,
  type SaveOrEliminateBallot,
  type SealedElimRegistration,
} from "../formats";
import {
  buildFormatPressureProjection,
  formatPressureSummary,
  ruleSheetForFormat,
  type FormatPressureProjection,
} from "../format-pressure";
import type {
  EliminationVoteDisclosure,
  EngineFallbackReason,
  FormatDecisionFallbackReason,
  FormatDecisionProvenance,
  StrategicDecisionMetadata,
} from "../game-runner.types";
import { deterministicEngineFallback, engineFallbackMetadata } from "../engine-fallback";
import { ProviderUnavailableError } from "../provider-execution";
import { Phase, type UUID } from "../types";
import { handleElimination } from "./elimination";
import {
  agentTurnSourcePointer,
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
import { runMinglePhase } from "./mingle";
import type { CanonicalSourcePointer, FormatResolutionPayload } from "../canonical-events";

type FormatRoundElimination = {
  eliminatedId: UUID;
  voteDisclosure: EliminationVoteDisclosure;
  /** Durable board truth only — House MC rebuilds omniscient facts from events. */
  canonicalResolution: FormatResolutionPayload;
  /** Present only when an empowered model decision directly broke an actual tie. */
  resolutionSourcePointers: CanonicalSourcePointer[];
};

function normalizedFormatProvenance(
  result: {
    decisionSource?: "llm" | "fallback";
    fallbackReason?: FormatDecisionFallbackReason | null;
  },
): FormatDecisionProvenance {
  if (result.decisionSource === "llm") {
    return { decisionSource: "llm", fallbackReason: null };
  }
  return {
    decisionSource: "fallback",
    fallbackReason: result.fallbackReason ?? "agent_internal_fallback",
  };
}

function fallbackFormatProvenance(
  fallbackReason: FormatDecisionFallbackReason,
): FormatDecisionProvenance {
  return { decisionSource: "fallback", fallbackReason };
}

/** Single writer for format pressure (kernel state + agent context card). */
function setFormatPressure(
  ctx: PhaseRunnerContext,
  pressure: FormatPressureProjection | null,
): void {
  ctx.formatKernelState.pressure = pressure;
  ctx.contextBuilder.currentFormatPressure = pressure;
}

/**
 * Race a format agent call against agentActionTimeoutMs.
 * On timeout, use House fallback (same pattern as vote/endgame).
 */
async function withFormatAgentTimeout<T>(
  ctx: PhaseRunnerContext,
  phase: Phase,
  label: string,
  operation: () => Promise<T>,
  fallback: (reason: EngineFallbackReason) => T,
): Promise<T> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      return fallback("provider_exhausted");
    }
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(
        `${label} timed out after ${timeoutMs}ms; using House fallback.`,
        phase,
      );
      resolve(fallback("action_timed_out"));
    }, timeoutMs);
  });

  return Promise.race([operation().catch((error) => {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return fallback("provider_exhausted");
  }), timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function requireAgent(ctx: PhaseRunnerContext, playerId: UUID, label: string) {
  const agent = ctx.agents.get(playerId);
  if (!agent) {
    throw new Error(`Missing agent for ${label}: ${playerId}`);
  }
  return agent;
}

export async function runFormatMenuPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  const state = ctx.formatKernelState;
  const empoweredId = gameState.empoweredId;
  if (!empoweredId) {
    throw new Error("Format menu requires empowered player");
  }

  const menu = buildFormatMenu({
    formatManifest: gameState.formatManifest,
    lastFormatId: state.lastSelectedFormat,
    round: gameState.round,
    random: ctx.random,
  });
  state.offeredFormats = menu.offered;

  if (menu.autoSelected) {
    const chosen = menu.autoSelected;
    state.selectedFormat = chosen;
    state.lastSelectedFormat = chosen;
    const pressure = buildFormatPressureProjection({
      empoweredId,
      empoweredName: gameState.getPlayerName(empoweredId),
      offeredFormats: [chosen],
      selectedFormat: chosen,
    });
    setFormatPressure(ctx, pressure);
    gameState.recordFormatSelected(empoweredId, chosen);
    logger.logSystem(
      `FORMAT LOCKED: ${displayNameForFormat(chosen)}. This game's single-format manifest selected it automatically.`,
      Phase.FORMAT_MENU,
    );
    logger.logSystem(formatPressureSummary(pressure), Phase.FORMAT_MENU);
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    return;
  }

  const offered = menu.offered;
  if (!offered) throw new Error("Multi-format game did not produce a format menu");
  state.selectedFormat = null;
  const menuPressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats: offered,
    selectedFormat: null,
  });
  setFormatPressure(ctx, menuPressure);
  gameState.recordFormatMenu(empoweredId, offered);

  logger.logSystem(
    `FORMAT MENU: ${displayNameForFormat(offered[0])} vs ${displayNameForFormat(offered[1])}. ${gameState.getPlayerName(empoweredId)} will choose.`,
    Phase.FORMAT_MENU,
  );
  logger.logSystem(formatPressureSummary(menuPressure), Phase.FORMAT_MENU);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runFormatPickPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  const state = ctx.formatKernelState;
  const empoweredId = gameState.empoweredId;
  const offeredFormats = state.offeredFormats;
  if (empoweredId && state.selectedFormat && !offeredFormats) {
    // One-format games already emitted authoritative selection in FORMAT_MENU.
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
    return;
  }
  if (!empoweredId || !offeredFormats) {
    throw new Error("Format pick requires empowered player and offered formats");
  }

  const empoweredAgent = requireAgent(ctx, empoweredId, "format pick");

  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    empoweredAgent,
    empoweredId,
    Phase.FORMAT_PICK,
    "strategic_decision",
    { empoweredId },
  );

  let chosen = deterministicEngineFallback(
    offeredFormats,
    phaseCtx,
    empoweredId,
    "format-pick",
  );
  let thinking: string | undefined;
  let reasoningContext: string | undefined;
  let strategyMetadata: StrategicDecisionMetadata = engineFallbackMetadata(
    phaseCtx,
    empoweredId,
    "format-pick",
    "agent_method_unavailable",
  );
  let decisionId: UUID | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (empoweredAgent.pickRoundFormat) {
    const pickFn = empoweredAgent.pickRoundFormat.bind(empoweredAgent);
    const result = await withFormatAgentTimeout(
      ctx,
      Phase.FORMAT_PICK,
      `Format pick (${gameState.getPlayerName(empoweredId)})`,
      () => pickFn(phaseCtx, offeredFormats),
      (reason) => ({
        formatId: chosen,
        decisionSource: "fallback" as const,
        fallbackReason: "tool_call_failed" as const,
        ...engineFallbackMetadata(phaseCtx, empoweredId, "format-pick", reason),
      }),
    );
    const timedOut = result.decisionSource === "fallback"
      && result.fallbackReason === "tool_call_failed";
    if (timedOut) {
      provenance = fallbackFormatProvenance("tool_call_failed");
      thinking = undefined;
      reasoningContext = undefined;
      strategyMetadata = result;
    } else {
      const picked = pickFormatFromMenu(offeredFormats, result.formatId);
      if (picked) {
        chosen = picked;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
      } else {
        chosen = deterministicEngineFallback(
          offeredFormats,
          phaseCtx,
          empoweredId,
          "format-pick",
        );
        provenance = fallbackFormatProvenance("invalid_format_choice");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = engineFallbackMetadata(
          phaseCtx,
          empoweredId,
          "format-pick",
          "invalid_model_output",
        );
      }
      if (picked) {
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        strategyMetadata = result;
      }
    }
  }

  await assertCanAcceptCommit(ctx);
  state.selectedFormat = chosen;
  state.lastSelectedFormat = chosen;
  setFormatPressure(
    ctx,
    buildFormatPressureProjection({
      empoweredId,
      empoweredName: gameState.getPlayerName(empoweredId),
      offeredFormats,
      selectedFormat: chosen,
    }),
  );
  gameState.recordFormatSelected(empoweredId, chosen, [
    agentTurnSourcePointer(
      empoweredId,
      "format-pick",
      gameState.round,
      Phase.FORMAT_PICK,
      undefined,
      strategyMetadata.engineFallback ? undefined : decisionId,
      strategyMetadata.engineFallback,
    ),
  ]);
  resolveActionStrategyCandidate(
    empoweredAgent,
    strategyMetadata,
    provenance.decisionSource === "llm",
  );

  const sheet = ruleSheetForFormat(chosen);
  logger.logSystem(
    `FORMAT LOCKED: ${displayNameForFormat(chosen)}. Chosen by ${gameState.getPlayerName(empoweredId)}.`,
    Phase.FORMAT_PICK,
  );
  logger.logSystem(`RULES: ${sheet}`, Phase.FORMAT_PICK);
  logger.emitAgentTurn({
    phase: Phase.FORMAT_PICK,
    action: "format-pick",
    actor: { id: empoweredId, name: gameState.getPlayerName(empoweredId), role: "player" },
    visibility: "public",
    response: {
      offeredFormats,
      selectedFormat: chosen,
      ...provenance,
      ...strategicDecisionResponse(strategyMetadata),
    },
    thinking,
    reasoningContext,
    scope: "system",
    text: `${gameState.getPlayerName(empoweredId)} chose format ${displayNameForFormat(chosen)}`,
  });

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runFormatMinglePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  options: { completePhase?: boolean } = {},
): Promise<void> {
  const { logger } = ctx;
  const pressure = ctx.formatKernelState.pressure;
  if (pressure) {
    logger.logSystem(formatPressureSummary(pressure), Phase.FORMAT_MINGLE);
    // Re-publish through the single writer so contextBuilder stays aligned.
    setFormatPressure(ctx, pressure);
  }
  await runMinglePhase(ctx, actor, {
    phase: Phase.FORMAT_MINGLE,
    completePhase: options.completePhase ?? true,
  });
}

export async function runFormatResolvePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  const state = ctx.formatKernelState;
  const formatId = state.selectedFormat;
  const empoweredId = gameState.empoweredId;
  if (!formatId || !empoweredId) {
    throw new Error("Format resolve requires selected format and empowered player");
  }

  logger.logSystem(
    `=== FORMAT RESOLVE (${displayNameForFormat(formatId)} / ${formatId}) ===`,
    Phase.FORMAT_RESOLVE,
  );

  let elimination: FormatRoundElimination;
  const registration = getFormatRegistration(formatId);
  if (registration.capability === "sealed_elim") {
    elimination = await resolveSealedElimFormatRound(ctx, empoweredId, registration);
  } else if (registration.capability === "sealed_polarity") {
    elimination = await resolveSaveOrEliminateRound(ctx, empoweredId);
  } else if (registration.capability === "public_chain") {
    elimination = await resolveSafetyBounceRound(ctx, empoweredId);
  } else {
    const unreachable: never = registration;
    throw new Error(`Unsupported format capability at resolve: ${String(unreachable)}`);
  }
  const { eliminatedId } = elimination;

  // Durable board truth only. House MC / producer rebuild omniscient facts from events (R14).
  await assertCanAcceptCommit(ctx);
  gameState.recordFormatResolution(
    elimination.canonicalResolution,
    elimination.resolutionSourcePointers,
  );

  await handleElimination(ctx, eliminatedId, Phase.FORMAT_RESOLVE, {
    mode: "format",
    formatId,
    voteDisclosure: elimination.voteDisclosure,
  });

  await assertCanAcceptCommit(ctx);
  gameState.recordRoundResult(
    {
      round: gameState.round,
      empoweredId,
      exposeScores: {},
      candidates: null,
      powerAction: null,
      powerTarget: null,
      eliminated: eliminatedId,
      formatId,
      formatMethod: formatId,
    },
    Phase.FORMAT_RESOLVE,
  );

  logger.logSystem(
    `${gameState.getPlayerName(eliminatedId)} exited under ${displayNameForFormat(formatId)}`,
    Phase.FORMAT_RESOLVE,
  );

  setFormatPressure(ctx, null);
  state.offeredFormats = null;
  state.selectedFormat = null;

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({
    type: "UPDATE_ALIVE_PLAYERS",
    aliveIds: gameState.getAlivePlayerIds(),
  });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

async function resolveSaveOrEliminateRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<FormatRoundElimination> {
  const { gameState, logger } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const ballots: SaveOrEliminateBallot[] = [];

  for (const player of alive) {
    const agent = requireAgent(ctx, player.id, "Save-or-Exit ballot");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      agent,
      player.id,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId },
    );
    const others = aliveIds.filter((id) => id !== player.id);
    let polarity: "save" | "eliminate" = "eliminate";
    let targetId = deterministicEngineFallback(
      others,
      phaseCtx,
      player.id,
      "format-save-or-eliminate-ballot",
    );
    let thinking: string | undefined;
    let reasoningContext: string | undefined;
    let strategyMetadata: StrategicDecisionMetadata = engineFallbackMetadata(
      phaseCtx,
      player.id,
      "format-save-or-eliminate-ballot",
      "agent_method_unavailable",
    );
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getSaveOrEliminateBallot) {
      const ballotFn = agent.getSaveOrEliminateBallot.bind(agent);
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Save-or-Exit ballot (${player.name})`,
        () => ballotFn(phaseCtx, aliveIds),
        (reason) => ({
          polarity: "eliminate" as const,
          targetId,
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
          ...engineFallbackMetadata(
            phaseCtx,
            player.id,
            "format-save-or-eliminate-ballot",
            reason,
          ),
        }),
      );
      if (result.decisionSource === "fallback"
        && result.fallbackReason === "tool_call_failed") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = result;
      } else if (isLegalSaveOrEliminateBallot(player.id, result.targetId, result.polarity, aliveIds)) {
        polarity = result.polarity;
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        strategyMetadata = result;
      } else {
        polarity = "eliminate";
        targetId = deterministicEngineFallback(
          others,
          phaseCtx,
          player.id,
          "format-save-or-eliminate-ballot",
        );
        provenance = fallbackFormatProvenance("invalid_save_or_eliminate_ballot");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = engineFallbackMetadata(
          phaseCtx,
          player.id,
          "format-save-or-eliminate-ballot",
          "invalid_model_output",
        );
      }
    }

    ballots.push({ voterId: player.id, polarity, targetId });
    const targetName = gameState.getPlayerName(targetId);
    await assertCanAcceptCommit(ctx);
    gameState.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: player.id,
      targetId,
      polarity,
    }, [
      agentTurnSourcePointer(
        player.id,
        "format-save-or-eliminate-ballot",
        gameState.round,
        Phase.FORMAT_RESOLVE,
        undefined,
        strategyMetadata.engineFallback ? undefined : decisionId,
        strategyMetadata.engineFallback,
      ),
    ]);
    resolveActionStrategyCandidate(
      agent,
      strategyMetadata,
      provenance.decisionSource === "llm",
    );
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "save_or_eliminate",
        polarity,
        targetId,
        targetName,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse(strategyMetadata),
      },
      thinking,
      reasoningContext,
      scope: "system",
      // Operator/sim visibility: sealed is player-facing only; chatty traces show the ballot.
      text: `${player.name} sealed ballot: ${polarity === "save" ? "SAVE" : "EXIT"} → ${targetName}`,
    });
  }

  if (ballots.length !== aliveIds.length) {
    throw new Error(`Save-or-Exit incomplete ballots: ${ballots.length}/${aliveIds.length}`);
  }

  await assertCanAcceptCommit(ctx);
  const nets = computeSaveOrEliminateNets(aliveIds, ballots);
  let resolution = resolveSaveOrEliminate(aliveIds, ballots);
  let resolutionSourcePointers: CanonicalSourcePointer[] = [];
  if (resolution.kind === "tie") {
    const broken = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
    resolutionSourcePointers = broken.sourcePointers;
    resolution = broken;
  }

  logger.logSystem(
    `Save-or-Exit ballots: ${ballots
      .map(
        (b) =>
          `${gameState.getPlayerName(b.voterId)}→${b.polarity === "save" ? "SAVE" : "EXIT"}:${gameState.getPlayerName(b.targetId)}`,
      )
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );
  const netSummary = aliveIds
    .map((id) => `${gameState.getPlayerName(id)}=${nets.nets[id] ?? 0}`)
    .join(", ");
  logger.logSystem(`Save-or-Exit nets: ${netSummary}`, Phase.FORMAT_RESOLVE);
  const resolutionSummary = formatExitReason(gameState, resolution, "lowest net");
  logger.logSystem(resolutionSummary, Phase.FORMAT_RESOLVE);

  if (!resolution.eliminatedId) {
    throw new Error("Save-or-Exit failed to resolve a player exit");
  }
  const eliminatedId = resolution.eliminatedId;
  return {
    eliminatedId,
    voteDisclosure: {
      visibility: "sealed",
      votesReceived:
        (nets.savesReceived[eliminatedId] ?? 0)
        + (nets.eliminateReceived[eliminatedId] ?? 0),
      savesReceived: nets.savesReceived[eliminatedId] ?? 0,
      eliminationVotesReceived: nets.eliminateReceived[eliminatedId] ?? 0,
      netScore: nets.nets[eliminatedId] ?? 0,
    },
    canonicalResolution: {
      formatId: "save_or_eliminate",
      empoweredId,
      eliminatedId,
      resolutionKind: resolution.kind,
      tiedPlayerIds: [...resolution.tiedSet],
      tiebreakerId: resolution.kind === "clear" && resolution.tiedSet.length > 1 ? empoweredId : null,
      aggregate: {
        capability: "sealed_polarity",
        nets: { ...nets.nets },
        savesReceived: { ...nets.savesReceived },
        eliminateReceived: { ...nets.eliminateReceived },
      },
    },
    resolutionSourcePointers,
  };
}

interface SealedElimDecisionRecord {
  thinking?: string;
  reasoningContext?: string;
  decisionId?: UUID;
  strategyMetadata: StrategicDecisionMetadata;
  provenance: FormatDecisionProvenance;
}

async function resolveSealedElimFormatRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
  registration: SealedElimRegistration,
): Promise<FormatRoundElimination> {
  const { gameState, logger } = ctx;
  const publicName = displayNameForFormat(registration.id);
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const historicalBallots = gameState.getCanonicalEvents().flatMap((event) =>
    event.type === "format.ballot_cast"
      ? [{
          round: event.round,
          voterId: event.payload.voterId,
          targetId: event.payload.targetId,
          polarity: event.payload.polarity,
        }]
      : []
  );
  const resolved = await resolveSealedElimRound<
    SealedElimDecisionRecord,
    CanonicalSourcePointer[]
  >({
    registration,
    participants: alive,
    traceAction: registration.decision.traceAction,
    legalTargetIdsFor: registration.decision.targetPolicy === "restricted_history"
      ? (player) => restrictedHistoryLegalTargets(
          player.id,
          aliveIds,
          gameState.round,
          historicalBallots,
        )
      : undefined,
    collectDecision: async (player, fallbackTargetId, legalTargetIds) => {
      const agent = requireAgent(
        ctx,
        player.id,
        `${publicName} ballot`,
      );
      const phaseCtx = prepareAgentPhaseContext(
        ctx,
        agent,
        player.id,
        Phase.FORMAT_RESOLVE,
        "strategic_decision",
        { empoweredId },
      );
      let targetId = deterministicEngineFallback(
        legalTargetIds,
        phaseCtx,
        player.id,
        registration.decision.traceAction,
      );
      let decision: SealedElimDecisionRecord = {
        strategyMetadata: engineFallbackMetadata(
          phaseCtx,
          player.id,
          registration.decision.traceAction,
          "agent_method_unavailable",
        ),
        provenance: fallbackFormatProvenance("agent_method_unavailable"),
      };

      const ballotMethod = agent[registration.decision.agentMethod];
      if (ballotMethod) {
        const ballotFn = ballotMethod.bind(agent);
        const result = await withFormatAgentTimeout(
          ctx,
          Phase.FORMAT_RESOLVE,
          `${publicName} ballot (${player.name})`,
          () => ballotFn(phaseCtx, [...legalTargetIds]),
          (reason) => ({
            targetId,
            decisionSource: "fallback" as const,
            fallbackReason: "tool_call_failed" as const,
            ...engineFallbackMetadata(
              phaseCtx,
              player.id,
              registration.decision.traceAction,
              reason,
            ),
          }),
        );
        const legalResult = legalTargetIds.includes(result.targetId);
        targetId = legalResult
          ? result.targetId
          : deterministicEngineFallback(
              legalTargetIds,
              phaseCtx,
              player.id,
              registration.decision.traceAction,
            );
        const timedOut = result.decisionSource === "fallback"
          && result.fallbackReason === "tool_call_failed";
        const provenance = timedOut
          ? fallbackFormatProvenance("tool_call_failed")
          : legalResult
            ? normalizedFormatProvenance(result)
            : fallbackFormatProvenance(registration.decision.invalidTargetReason);
        const strategyMetadata = timedOut
          ? result
          : legalResult
            ? result
            : engineFallbackMetadata(
                phaseCtx,
                player.id,
                registration.decision.traceAction,
                "invalid_model_output",
              );
        decision = {
          thinking: provenance.decisionSource === "llm" ? result.thinking : undefined,
          reasoningContext: provenance.decisionSource === "llm" ? result.reasoningContext : undefined,
          decisionId: provenance.decisionSource === "llm" ? result.decisionId : undefined,
          strategyMetadata,
          provenance,
        };
      }

      return { targetId, decision };
    },
    recordAcceptedBallot: async ({
      ballot,
      decision,
      repairedInvalidTarget,
      traceAction,
    }) => {
      const player = alive.find((candidate) => candidate.id === ballot.voterId);
      if (!player) throw new Error(`Missing alive player for sealed ballot: ${ballot.voterId}`);
      const targetName = gameState.getPlayerName(ballot.targetId);
      const provenance = repairedInvalidTarget
        ? fallbackFormatProvenance(registration.decision.invalidTargetReason)
        : decision.provenance;
      const decisionId = repairedInvalidTarget ? undefined : decision.decisionId;
      const fallbackMetadata = repairedInvalidTarget
        ? engineFallbackMetadata(
            {
              gameId: gameState.gameId,
              round: gameState.round,
              phase: Phase.FORMAT_RESOLVE,
            },
            ballot.voterId,
            traceAction,
            "invalid_model_output",
          )
        : decision.strategyMetadata;

      await assertCanAcceptCommit(ctx);
      gameState.recordFormatBallot({
        formatId: registration.id,
        voterId: ballot.voterId,
        targetId: ballot.targetId,
      }, [
        agentTurnSourcePointer(
          ballot.voterId,
          traceAction,
          gameState.round,
          Phase.FORMAT_RESOLVE,
          undefined,
          fallbackMetadata.engineFallback ? undefined : decisionId,
          fallbackMetadata.engineFallback,
        ),
      ]);
      resolveActionStrategyCandidate(
        ctx.agents.get(ballot.voterId)!,
        fallbackMetadata,
        provenance.decisionSource === "llm",
      );
      logger.emitAgentTurn({
        phase: Phase.FORMAT_RESOLVE,
        action: "format-ballot",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "private",
        response: {
          formatId: registration.id,
          targetId: ballot.targetId,
          targetName,
          sealed: true,
          ...provenance,
          ...strategicDecisionResponse(decision.strategyMetadata),
        },
        thinking: decision.thinking,
        reasoningContext: decision.reasoningContext,
        scope: "system",
        text: `${player.name} sealed ballot: EXIT → ${targetName}`,
      });
    },
    recordForfeitedBallot: async (player) => {
      await assertCanAcceptCommit(ctx);
      gameState.recordFormatBallotForfeited(player.id);
      logger.logSystem(
        `${player.name} has already targeted every legal opponent and forfeits their Restricted History ballot.`,
        Phase.FORMAT_RESOLVE,
      );
    },
    beforeScore: () => assertCanAcceptCommit(ctx),
    breakTie: async (tiedPlayerIds) => {
      const broken = await breakFormatTie(ctx, empoweredId, tiedPlayerIds);
      return {
        resolution: broken,
        evidence: broken.sourcePointers,
      };
    },
  });

  const tallies = resolved.score;
  const resolution = resolved.resolution;
  const resolutionSourcePointers = resolved.tieEvidence ?? [];

  logger.logSystem(
    `${publicName} ballots: ${resolved.ballots
      .map((b) => `${gameState.getPlayerName(b.voterId)}→${gameState.getPlayerName(b.targetId)}`)
      .concat(resolved.forfeitedVoterIds.map((id) => `${gameState.getPlayerName(id)}→FORFEIT`))
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );
  const scoreSummary = tallies.eligibleIds
    .map((id) => `${gameState.getPlayerName(id)}=${tallies.totals[id] ?? 0}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  const criterion = registration.presentation.scoring === "fewest_positive"
    ? "fewest positive votes"
    : registration.presentation.scoring === "highest_even"
      ? "highest even total"
      : "highest total";
  if (registration.presentation.zeroVoteTreatment === "safe") {
    const eligibleIds = new Set(tallies.eligibleIds);
    const zeroSafe = aliveIds
      .filter((id) => !eligibleIds.has(id))
      .map((id) => gameState.getPlayerName(id)).join(", ") || "none";
    logger.logSystem(
      `${publicName} tally: SAFE(zero)=[${zeroSafe}]; positive totals: ${scoreSummary || "none"} (${criterion} exits)`,
      Phase.FORMAT_RESOLVE,
    );
  } else if (registration.presentation.scoring === "highest_even") {
    const eligibleIds = new Set(tallies.eligibleIds);
    const allOdd = aliveIds.every((id) => (tallies.totals[id] ?? 0) % 2 !== 0);
    const oddSafe = aliveIds
      .filter((id) => !eligibleIds.has(id))
      .map((id) => gameState.getPlayerName(id)).join(", ") || "none";
    logger.logSystem(
      allOdd
        ? `${publicName} tally: every total is odd; the entire remaining field goes to the empowered tiebreak`
        : `${publicName} tally: SAFE(odd)=[${oddSafe}]; even totals: ${scoreSummary || "none"} (${criterion} exits)`,
      Phase.FORMAT_RESOLVE,
    );
  } else {
    logger.logSystem(
      `${publicName} tally: totals: ${scoreSummary || "none"} (${criterion} exits)`,
      Phase.FORMAT_RESOLVE,
    );
  }
  const resolutionSummary = formatExitReason(gameState, resolution, criterion);
  logger.logSystem(resolutionSummary, Phase.FORMAT_RESOLVE);

  if (!resolution.eliminatedId) {
    throw new Error(`${publicName} failed to resolve a player exit`);
  }
  const eliminatedId = resolution.eliminatedId;
  return {
    eliminatedId,
    voteDisclosure: {
      visibility: "sealed",
      votesReceived: tallies.totals[eliminatedId] ?? 0,
    },
    canonicalResolution: {
      formatId: registration.id,
      empoweredId,
      eliminatedId,
      resolutionKind: resolution.kind,
      tiedPlayerIds: [...resolution.tiedSet],
      tiebreakerId: resolution.kind === "clear" && resolution.tiedSet.length > 1 ? empoweredId : null,
      aggregate: {
        capability: "sealed_elim",
        totals: { ...resolved.aggregate.totals },
        eligiblePlayerIds: [...resolved.aggregate.eligiblePlayerIds],
      },
    },
    resolutionSourcePointers,
  };
}

async function resolveSafetyBounceRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<FormatRoundElimination> {
  const { gameState, logger } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const starterId = aliveIds[Math.floor(Math.random() * aliveIds.length)]!;
  let board = createBounceBoard(aliveIds, starterId);
  updateBounceBoardPressure(ctx, board);
  await assertCanAcceptCommit(ctx);
  gameState.recordSafetyBounceStarted(starterId);

  logger.logSystem(
    `Safety Bounce starter (SAFE): ${gameState.getPlayerName(starterId)}`,
    Phase.FORMAT_RESOLVE,
  );

  while (board.nextActorId !== null) {
    const actorId = board.nextActorId;
    const agent = requireAgent(ctx, actorId, "safety-bounce pointer");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      agent,
      actorId,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId },
    );
    let targetId = deterministicEngineFallback(
      board.unclassified,
      phaseCtx,
      actorId,
      "bounce-pointer",
    );
    let thinking: string | undefined;
    let reasoningContext: string | undefined;
    let strategyMetadata: StrategicDecisionMetadata = engineFallbackMetadata(
      phaseCtx,
      actorId,
      "bounce-pointer",
      "agent_method_unavailable",
    );
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getBouncePointer) {
      const pointerFn = agent.getBouncePointer.bind(agent);
      const boardSnapshot = {
        safe: board.safe,
        vulnerable: board.vulnerable,
        unclassified: board.unclassified,
        nextActorId: board.nextActorId,
      };
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Safety Bounce pointer (${gameState.getPlayerName(actorId)})`,
        () => pointerFn(phaseCtx, boardSnapshot),
        (reason) => ({
          targetId,
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
          ...engineFallbackMetadata(phaseCtx, actorId, "bounce-pointer", reason),
        }),
      );
      if (result.decisionSource === "fallback"
        && result.fallbackReason === "tool_call_failed") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = result;
      } else {
        const pointer = { actorId, targetId: result.targetId };
        if (isLegalBouncePointer(board, pointer)) {
          targetId = result.targetId;
          provenance = normalizedFormatProvenance(result);
          if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        } else {
          targetId = deterministicEngineFallback(
            board.unclassified,
            phaseCtx,
            actorId,
            "bounce-pointer",
          );
          provenance = fallbackFormatProvenance("invalid_bounce_pointer");
          strategyMetadata = engineFallbackMetadata(
            phaseCtx,
            actorId,
            "bounce-pointer",
            "invalid_model_output",
          );
        }
        if (provenance.decisionSource === "llm") {
          thinking = result.thinking ?? thinking;
          reasoningContext = result.reasoningContext;
          strategyMetadata = result;
        } else {
          thinking = undefined;
          reasoningContext = undefined;
        }
      }
    }

    board = applyBouncePointer(board, { actorId, targetId });
    updateBounceBoardPressure(ctx, board);
    const classification = board.vulnerable.includes(targetId) ? "VULNERABLE" : "SAFE";
    await assertCanAcceptCommit(ctx);
    gameState.recordSafetyBouncePointer(
      actorId,
      targetId,
      classification.toLowerCase() as "safe" | "vulnerable",
      [
        agentTurnSourcePointer(
          actorId,
          "bounce-pointer",
          gameState.round,
          Phase.FORMAT_RESOLVE,
          undefined,
          strategyMetadata.engineFallback ? undefined : decisionId,
          strategyMetadata.engineFallback,
        ),
      ],
    );
    resolveActionStrategyCandidate(
      agent,
      strategyMetadata,
      provenance.decisionSource === "llm",
    );
    logger.logSystem(
      `Bounce: ${gameState.getPlayerName(actorId)} → ${gameState.getPlayerName(targetId)} (${classification})`,
      Phase.FORMAT_RESOLVE,
    );
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "bounce-pointer",
      actor: { id: actorId, name: gameState.getPlayerName(actorId), role: "player" },
      visibility: "public",
      response: {
        targetId,
        classification,
        ...provenance,
        ...strategicDecisionResponse(strategyMetadata),
      },
      thinking,
      reasoningContext,
      scope: "system",
      text: `${gameState.getPlayerName(actorId)} pointed at ${gameState.getPlayerName(targetId)} (${classification})`,
    });
  }

  logger.logSystem(
    `Bounce complete. Safe: ${board.safe.map((id) => gameState.getPlayerName(id)).join(", ")}. Vulnerable: ${board.vulnerable.map((id) => gameState.getPlayerName(id)).join(", ")}.`,
    Phase.FORMAT_RESOLVE,
  );

  if (board.vulnerable.length === 1) {
    const soleId = board.vulnerable[0]!;
    return {
      eliminatedId: soleId,
      voteDisclosure: {
        visibility: "none",
        reason: "sole_vulnerable",
      },
      canonicalResolution: {
        formatId: "safety_bounce",
        empoweredId,
        eliminatedId: soleId,
        resolutionKind: "auto",
        tiedPlayerIds: [],
        tiebreakerId: null,
        aggregate: {
          capability: "public_chain",
          starterId,
          safePlayerIds: [...board.safe],
          vulnerablePlayerIds: [...board.vulnerable],
          voteTotals: {},
        },
      },
      resolutionSourcePointers: [],
    };
  }

  const voteTotals: Record<UUID, number> = {};
  for (const id of board.vulnerable) voteTotals[id] = 0;
  const ballots: Array<{ voterId: UUID; targetId: UUID }> = [];

  for (const player of alive) {
    const agent = requireAgent(ctx, player.id, "safety-bounce vote");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      agent,
      player.id,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId },
    );
    let targetId = deterministicEngineFallback(
      board.vulnerable,
      phaseCtx,
      player.id,
      "format-safety-bounce-vote",
    );
    let thinking: string | undefined;
    let reasoningContext: string | undefined;
    let strategyMetadata: StrategicDecisionMetadata = engineFallbackMetadata(
      phaseCtx,
      player.id,
      "format-safety-bounce-vote",
      "agent_method_unavailable",
    );
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getSafetyBounceVote) {
      const voteFn = agent.getSafetyBounceVote.bind(agent);
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Safety Bounce vote (${player.name})`,
        () => voteFn(phaseCtx, board.vulnerable),
        (reason) => ({
          targetId,
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
          ...engineFallbackMetadata(
            phaseCtx,
            player.id,
            "format-safety-bounce-vote",
            reason,
          ),
        }),
      );
      if (result.decisionSource === "fallback"
        && result.fallbackReason === "tool_call_failed") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = result;
      } else if (isLegalSafetyBounceVote(result.targetId, board.vulnerable)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        strategyMetadata = result;
      } else {
        targetId = deterministicEngineFallback(
          board.vulnerable,
          phaseCtx,
          player.id,
          "format-safety-bounce-vote",
        );
        provenance = fallbackFormatProvenance("invalid_safety_bounce_target");
        thinking = undefined;
        reasoningContext = undefined;
        strategyMetadata = engineFallbackMetadata(
          phaseCtx,
          player.id,
          "format-safety-bounce-vote",
          "invalid_model_output",
        );
      }
    }

    ballots.push({ voterId: player.id, targetId });
    voteTotals[targetId] = (voteTotals[targetId] ?? 0) + 1;
    const targetName = gameState.getPlayerName(targetId);
    await assertCanAcceptCommit(ctx);
    gameState.recordFormatBallot({
      formatId: "safety_bounce",
      voterId: player.id,
      targetId,
    }, [
      agentTurnSourcePointer(
        player.id,
        "format-safety-bounce-vote",
        gameState.round,
        Phase.FORMAT_RESOLVE,
        undefined,
        strategyMetadata.engineFallback ? undefined : decisionId,
        strategyMetadata.engineFallback,
      ),
    ]);
    resolveActionStrategyCandidate(
      agent,
      strategyMetadata,
      provenance.decisionSource === "llm",
    );
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "safety_bounce",
        targetId,
        targetName,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse(strategyMetadata),
      },
      thinking,
      reasoningContext,
      scope: "system",
      // Operator/sim visibility: sealed is player-facing only; chatty traces show the ballot.
      text: `${player.name} sealed ballot: EXIT → ${targetName}`,
    });
  }

  if (ballots.length !== aliveIds.length) {
    throw new Error(`Safety Bounce incomplete ballots: ${ballots.length}/${aliveIds.length}`);
  }

  await assertCanAcceptCommit(ctx);
  let resolution = resolveSafetyBounceVote(board.vulnerable, voteTotals);
  let resolutionSourcePointers: CanonicalSourcePointer[] = [];
  if (resolution.kind === "tie") {
    const broken = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
    resolutionSourcePointers = broken.sourcePointers;
    resolution = broken;
  }

  logger.logSystem(
    `Safety Bounce ballots: ${ballots
      .map((b) => `${gameState.getPlayerName(b.voterId)}→${gameState.getPlayerName(b.targetId)}`)
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );
  logger.logSystem(
    `Safety Bounce vote reveal: ${Object.entries(voteTotals)
      .map(([id, n]) => `${gameState.getPlayerName(id as UUID)}=${n}`)
      .join(", ")} (highest total among vulnerable exits)`,
    Phase.FORMAT_RESOLVE,
  );
  const resolutionSummary = formatExitReason(gameState, resolution, "highest total in vulnerable pool");
  logger.logSystem(resolutionSummary, Phase.FORMAT_RESOLVE);

  if (!resolution.eliminatedId) {
    throw new Error("Safety Bounce failed to resolve elimination");
  }
  const eliminatedId = resolution.eliminatedId;
  return {
    eliminatedId,
    voteDisclosure: {
      visibility: "sealed",
      votesReceived: voteTotals[eliminatedId] ?? 0,
    },
    canonicalResolution: {
      formatId: "safety_bounce",
      empoweredId,
      eliminatedId,
      resolutionKind: resolution.kind,
      tiedPlayerIds: [...resolution.tiedSet],
      tiebreakerId: resolution.kind === "clear" && resolution.tiedSet.length > 1 ? empoweredId : null,
      aggregate: {
        capability: "public_chain",
        starterId,
        safePlayerIds: [...board.safe],
        vulnerablePlayerIds: [...board.vulnerable],
        voteTotals: { ...voteTotals },
      },
    },
    resolutionSourcePointers,
  };
}

/** Human-readable exit outcome for chatty/transcript (includes sole vs tiebreak). */
function formatExitReason(
  gameState: PhaseRunnerContext["gameState"],
  resolution: FormatEliminationResolution,
  criterion: string,
): string {
  if (!resolution.eliminatedId) {
    return `Format exit unresolved under ${criterion}.`;
  }
  const name = gameState.getPlayerName(resolution.eliminatedId);
  if (resolution.kind === "auto") {
    return `Exit: ${name} alone had ${criterion} (${resolution.reason}) — no empowered tiebreak.`;
  }
  if (resolution.kind === "clear" && resolution.tiedSet.length > 1) {
    const tied = resolution.tiedSet.map((id) => gameState.getPlayerName(id)).join(", ");
    return `Exit: ${name} chosen by empowered tiebreak among tied set [${tied}] on ${criterion}.`;
  }
  return `Exit: ${name} under ${criterion}.`;
}

function updateBounceBoardPressure(
  ctx: PhaseRunnerContext,
  board: FormatPressureProjection["bounceBoard"],
): void {
  const pressure = ctx.formatKernelState.pressure;
  if (!pressure || !board) return;
  setFormatPressure(
    ctx,
    buildFormatPressureProjection({
      empoweredId: pressure.empoweredId,
      empoweredName: pressure.empoweredName,
      offeredFormats: pressure.offeredFormats,
      selectedFormat: pressure.selectedFormat,
      bounceBoard: board,
    }),
  );
}

async function breakFormatTie(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
  tiedSet: readonly UUID[],
): Promise<{
  kind: "clear";
  eliminatedId: UUID;
  tiedSet: UUID[];
  sourcePointers: CanonicalSourcePointer[];
}> {
  const { gameState, logger } = ctx;
  const agent = requireAgent(ctx, empoweredId, "format tiebreak");
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    agent,
    empoweredId,
    Phase.FORMAT_RESOLVE,
    "strategic_decision",
    { empoweredId },
  );

  let choiceId = deterministicEngineFallback(
    tiedSet,
    phaseCtx,
    empoweredId,
    "format-tiebreak",
  );
  let thinking: string | undefined;
  let reasoningContext: string | undefined;
  let strategyMetadata: StrategicDecisionMetadata = engineFallbackMetadata(
    phaseCtx,
    empoweredId,
    "format-tiebreak",
    "agent_method_unavailable",
  );
  let decisionId: UUID | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (agent.breakFormatEliminationTie) {
    const tieFn = agent.breakFormatEliminationTie.bind(agent);
    const result = await withFormatAgentTimeout(
      ctx,
      Phase.FORMAT_RESOLVE,
      `Format tiebreak (${gameState.getPlayerName(empoweredId)})`,
      () => tieFn(phaseCtx, [...tiedSet]),
      (reason) => ({
        targetId: choiceId,
        decisionSource: "fallback" as const,
        fallbackReason: "tool_call_failed" as const,
        ...engineFallbackMetadata(phaseCtx, empoweredId, "format-tiebreak", reason),
      }),
    );
    if (result.decisionSource === "fallback"
      && result.fallbackReason === "tool_call_failed") {
      provenance = fallbackFormatProvenance("tool_call_failed");
      thinking = undefined;
      reasoningContext = undefined;
      strategyMetadata = result;
    } else if (tiedSet.includes(result.targetId)) {
      choiceId = result.targetId;
      provenance = normalizedFormatProvenance(result);
      if (provenance.decisionSource === "llm") decisionId = result.decisionId;
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      strategyMetadata = result;
    } else {
      choiceId = deterministicEngineFallback(
        tiedSet,
        phaseCtx,
        empoweredId,
        "format-tiebreak",
      );
      provenance = fallbackFormatProvenance("invalid_format_tiebreak_target");
      thinking = undefined;
      reasoningContext = undefined;
      strategyMetadata = engineFallbackMetadata(
        phaseCtx,
        empoweredId,
        "format-tiebreak",
        "invalid_model_output",
      );
    }
  }

  await assertCanAcceptCommit(ctx);
  const broken = applyFormatTiebreak(tiedSet, choiceId);
  if (!broken || broken.kind !== "clear" || !broken.eliminatedId) {
    throw new Error("Format tiebreak failed");
  }
  resolveActionStrategyCandidate(
    agent,
    strategyMetadata,
    provenance.decisionSource === "llm",
  );

  logger.logSystem(
    `Empowered tiebreak: ${gameState.getPlayerName(empoweredId)} eliminates ${gameState.getPlayerName(broken.eliminatedId)} among ${tiedSet.map((id) => gameState.getPlayerName(id)).join(", ")}`,
    Phase.FORMAT_RESOLVE,
  );
  logger.emitAgentTurn({
    phase: Phase.FORMAT_RESOLVE,
    action: "format-tiebreak",
    actor: { id: empoweredId, name: gameState.getPlayerName(empoweredId), role: "player" },
    visibility: "public",
    response: {
      tiedSet: [...tiedSet],
      eliminatedId: broken.eliminatedId,
      ...provenance,
      ...strategicDecisionResponse(strategyMetadata),
    },
    thinking,
    reasoningContext,
    scope: "system",
    text: `${gameState.getPlayerName(empoweredId)} broke format tie → ${gameState.getPlayerName(broken.eliminatedId)}`,
  });

  return {
    ...broken,
    sourcePointers: [
      agentTurnSourcePointer(
        empoweredId,
        "format-tiebreak",
        gameState.round,
        Phase.FORMAT_RESOLVE,
        undefined,
        strategyMetadata.engineFallback ? undefined : decisionId,
        strategyMetadata.engineFallback,
      ),
    ],
  };
}
