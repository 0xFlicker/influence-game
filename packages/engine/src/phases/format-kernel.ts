/**
 * Sequester format kernel phase handlers:
 * menu → pick → format mingle → resolve (Save-or-eliminate / Vote Bomb / Safety Bounce).
 */

import {
  applyBouncePointer,
  applyFormatTiebreak,
  buildFormatMenu,
  computeSaveOrEliminateNets,
  computeVoteBombTallies,
  createBounceBoard,
  displayNameForFormat,
  isLegalBouncePointer,
  isLegalSafetyBounceVote,
  isLegalSaveOrEliminateBallot,
  isLegalVoteBombBallot,
  pickFormatFromMenu,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  resolveVoteBomb,
  type FormatEliminationResolution,
  type LaunchFormatId,
  type SaveOrEliminateBallot,
  type VoteBombBallot,
} from "../formats";
import {
  buildFormatPressureProjection,
  formatPressureSummary,
  ruleSheetForFormat,
  type FormatPressureProjection,
} from "../format-pressure";
import type {
  EliminationVoteDisclosure,
  FormatDecisionFallbackReason,
  FormatDecisionProvenance,
} from "../game-runner.types";
import { Phase, type UUID } from "../types";
import { handleElimination } from "./elimination";
import {
  agentTurnSourcePointer,
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
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
  fallback: () => T,
): Promise<T> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) return operation();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(
        `${label} timed out after ${timeoutMs}ms; using House fallback.`,
        phase,
      );
      resolve(fallback());
    }, timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]).finally(() => {
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

  const menu = buildFormatMenu({ lastFormatId: state.lastSelectedFormat });
  state.offeredFormats = menu.offered;
  state.selectedFormat = null;
  const menuPressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats: menu.offered,
    selectedFormat: null,
  });
  setFormatPressure(ctx, menuPressure);
  gameState.recordFormatMenu(empoweredId, menu.offered);

  logger.logSystem(
    `FORMAT MENU: ${displayNameForFormat(menu.offered[0])} vs ${displayNameForFormat(menu.offered[1])}. ${gameState.getPlayerName(empoweredId)} will choose.`,
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

  let chosen: LaunchFormatId = offeredFormats[0]!;
  let thinking = "House fallback: first offered format";
  let reasoningContext: string | undefined;
  let decisionLog: string | null | undefined;
  let decisionId: UUID | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (empoweredAgent.pickRoundFormat) {
    const pickFn = empoweredAgent.pickRoundFormat.bind(empoweredAgent);
    const result = await withFormatAgentTimeout(
      ctx,
      Phase.FORMAT_PICK,
      `Format pick (${gameState.getPlayerName(empoweredId)})`,
      () => pickFn(phaseCtx, offeredFormats),
      () => ({
        formatId: offeredFormats[0]!,
        thinking: "House fallback after format-pick timeout",
        decisionSource: "fallback" as const,
        fallbackReason: "tool_call_failed" as const,
      }),
    );
    const timedOut = result.thinking === "House fallback after format-pick timeout"
      && result.fallbackReason === "tool_call_failed";
    if (timedOut) {
      chosen = offeredFormats[0]!;
      provenance = fallbackFormatProvenance("tool_call_failed");
      thinking = result.thinking ?? thinking;
    } else {
      const picked = pickFormatFromMenu(offeredFormats, result.formatId);
      if (picked) {
        chosen = picked;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
      } else {
        provenance = fallbackFormatProvenance("invalid_format_choice");
      }
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
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
      decisionId,
    ),
  ]);

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
      ...strategicDecisionResponse({ decisionLog }),
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
    completePhase: true,
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
  if (formatId === "save_or_eliminate") {
    elimination = await resolveSaveOrEliminateRound(ctx, empoweredId);
  } else if (formatId === "vote_bomb") {
    elimination = await resolveVoteBombRound(ctx, empoweredId);
  } else {
    elimination = await resolveSafetyBounceRound(ctx, empoweredId);
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
    `Format ${displayNameForFormat(formatId)} eliminated ${gameState.getPlayerName(eliminatedId)}`,
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
    const agent = requireAgent(ctx, player.id, "save-or-eliminate ballot");
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
    let targetId = others[others.length - 1] ?? others[0] ?? player.id;
    let thinking = "fallback eliminate first other";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getSaveOrEliminateBallot) {
      const ballotFn = agent.getSaveOrEliminateBallot.bind(agent);
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Save-or-eliminate ballot (${player.name})`,
        () => ballotFn(phaseCtx, aliveIds),
        () => ({
          polarity: "eliminate" as const,
          targetId,
          thinking: "House fallback after save-or-eliminate ballot timeout",
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
        }),
      );
      if (result.fallbackReason === "tool_call_failed"
        && result.thinking === "House fallback after save-or-eliminate ballot timeout") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = result.thinking;
      } else if (isLegalSaveOrEliminateBallot(player.id, result.targetId, result.polarity, aliveIds)) {
        polarity = result.polarity;
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
      } else {
        provenance = fallbackFormatProvenance("invalid_save_or_eliminate_ballot");
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
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
        decisionId,
      ),
    ]);
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
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      // Operator/sim visibility: sealed is player-facing only; chatty traces show the ballot.
      text: `${player.name} sealed ballot: ${polarity.toUpperCase()} → ${targetName}`,
    });
  }

  if (ballots.length !== aliveIds.length) {
    throw new Error(`Save-or-eliminate incomplete ballots: ${ballots.length}/${aliveIds.length}`);
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
    `Save-or-eliminate ballots: ${ballots
      .map(
        (b) =>
          `${gameState.getPlayerName(b.voterId)}→${b.polarity}:${gameState.getPlayerName(b.targetId)}`,
      )
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );
  const netSummary = aliveIds
    .map((id) => `${gameState.getPlayerName(id)}=${nets.nets[id] ?? 0}`)
    .join(", ");
  logger.logSystem(`Save-or-eliminate nets: ${netSummary}`, Phase.FORMAT_RESOLVE);
  const resolutionSummary = formatEliminationReason(gameState, resolution, "lowest net");
  logger.logSystem(resolutionSummary, Phase.FORMAT_RESOLVE);

  if (!resolution.eliminatedId) {
    throw new Error("Save-or-eliminate failed to resolve elimination");
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
      saveOrEliminate: {
        nets: { ...nets.nets },
        savesReceived: { ...nets.savesReceived },
        eliminateReceived: { ...nets.eliminateReceived },
      },
      voteBomb: null,
      safetyBounce: null,
    },
    resolutionSourcePointers,
  };
}

async function resolveVoteBombRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<FormatRoundElimination> {
  const { gameState, logger } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const ballots: VoteBombBallot[] = [];

  for (const player of alive) {
    const agent = requireAgent(ctx, player.id, "vote-bomb ballot");
    const phaseCtx = prepareAgentPhaseContext(
      ctx,
      agent,
      player.id,
      Phase.FORMAT_RESOLVE,
      "strategic_decision",
      { empoweredId },
    );
    const others = aliveIds.filter((id) => id !== player.id);
    let targetId = others[others.length - 1] ?? others[0] ?? player.id;
    let thinking = "fallback vote last other";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getVoteBombBallot) {
      const ballotFn = agent.getVoteBombBallot.bind(agent);
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Vote Bomb ballot (${player.name})`,
        () => ballotFn(phaseCtx, aliveIds),
        () => ({
          targetId,
          thinking: "House fallback after vote-bomb ballot timeout",
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
        }),
      );
      if (result.fallbackReason === "tool_call_failed"
        && result.thinking === "House fallback after vote-bomb ballot timeout") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = result.thinking;
      } else if (isLegalVoteBombBallot(player.id, result.targetId, aliveIds)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
      } else {
        provenance = fallbackFormatProvenance("invalid_vote_bomb_target");
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
      }
    }

    ballots.push({ voterId: player.id, targetId });
    const targetName = gameState.getPlayerName(targetId);
    await assertCanAcceptCommit(ctx);
    gameState.recordFormatBallot({
      formatId: "vote_bomb",
      voterId: player.id,
      targetId,
    }, [
      agentTurnSourcePointer(
        player.id,
        "format-vote-bomb-ballot",
        gameState.round,
        Phase.FORMAT_RESOLVE,
        undefined,
        decisionId,
      ),
    ]);
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "vote_bomb",
        targetId,
        targetName,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      // Operator/sim visibility: sealed is player-facing only; chatty traces show the ballot.
      text: `${player.name} sealed ballot: eliminate → ${targetName}`,
    });
  }

  if (ballots.length !== aliveIds.length) {
    throw new Error(`Vote Bomb incomplete ballots: ${ballots.length}/${aliveIds.length}`);
  }

  await assertCanAcceptCommit(ctx);
  const tallies = computeVoteBombTallies(aliveIds, ballots);
  let resolution = resolveVoteBomb(aliveIds, ballots);
  let resolutionSourcePointers: CanonicalSourcePointer[] = [];
  if (resolution.kind === "tie") {
    const broken = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
    resolutionSourcePointers = broken.sourcePointers;
    resolution = broken;
  }

  logger.logSystem(
    `Vote Bomb ballots: ${ballots
      .map((b) => `${gameState.getPlayerName(b.voterId)}→${gameState.getPlayerName(b.targetId)}`)
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );
  const zeroSafe =
    tallies.zeroSafeIds.map((id) => gameState.getPlayerName(id)).join(", ") || "none";
  const positiveTotals = tallies.positiveIds
    .map((id) => `${gameState.getPlayerName(id)}=${tallies.totals[id] ?? 0}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  logger.logSystem(
    `Vote Bomb tally: SAFE(zero)=[${zeroSafe}]; positive totals: ${positiveTotals || "none"} (fewest positive is eliminated)`,
    Phase.FORMAT_RESOLVE,
  );
  const resolutionSummary = formatEliminationReason(gameState, resolution, "fewest positive votes");
  logger.logSystem(resolutionSummary, Phase.FORMAT_RESOLVE);

  if (!resolution.eliminatedId) {
    throw new Error("Vote Bomb failed to resolve elimination");
  }
  const eliminatedId = resolution.eliminatedId;
  return {
    eliminatedId,
    voteDisclosure: {
      visibility: "sealed",
      votesReceived: tallies.totals[eliminatedId] ?? 0,
    },
    canonicalResolution: {
      formatId: "vote_bomb",
      empoweredId,
      eliminatedId,
      resolutionKind: resolution.kind,
      tiedPlayerIds: [...resolution.tiedSet],
      tiebreakerId: resolution.kind === "clear" && resolution.tiedSet.length > 1 ? empoweredId : null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { ...tallies.totals },
        zeroSafePlayerIds: [...tallies.zeroSafeIds],
      },
      safetyBounce: null,
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
    let targetId = board.unclassified[0]!;
    let thinking = "fallback first unclassified";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
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
        () => ({
          targetId,
          thinking: "House fallback after bounce-pointer timeout",
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
        }),
      );
      if (result.fallbackReason === "tool_call_failed"
        && result.thinking === "House fallback after bounce-pointer timeout") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = result.thinking;
      } else {
        const pointer = { actorId, targetId: result.targetId };
        if (isLegalBouncePointer(board, pointer)) {
          targetId = result.targetId;
          provenance = normalizedFormatProvenance(result);
          if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        } else {
          provenance = fallbackFormatProvenance("invalid_bounce_pointer");
        }
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
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
          decisionId,
        ),
      ],
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
        ...strategicDecisionResponse({ decisionLog }),
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
        saveOrEliminate: null,
        voteBomb: null,
        safetyBounce: {
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
    let targetId = board.vulnerable[board.vulnerable.length - 1] ?? board.vulnerable[0]!;
    let thinking = "fallback first vulnerable";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let decisionId: UUID | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getSafetyBounceVote) {
      const voteFn = agent.getSafetyBounceVote.bind(agent);
      const result = await withFormatAgentTimeout(
        ctx,
        Phase.FORMAT_RESOLVE,
        `Safety Bounce vote (${player.name})`,
        () => voteFn(phaseCtx, board.vulnerable),
        () => ({
          targetId,
          thinking: "House fallback after safety-bounce vote timeout",
          decisionSource: "fallback" as const,
          fallbackReason: "tool_call_failed" as const,
        }),
      );
      if (result.fallbackReason === "tool_call_failed"
        && result.thinking === "House fallback after safety-bounce vote timeout") {
        provenance = fallbackFormatProvenance("tool_call_failed");
        thinking = result.thinking;
      } else if (isLegalSafetyBounceVote(result.targetId, board.vulnerable)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
        if (provenance.decisionSource === "llm") decisionId = result.decisionId;
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
      } else {
        provenance = fallbackFormatProvenance("invalid_safety_bounce_target");
        thinking = result.thinking ?? thinking;
        reasoningContext = result.reasoningContext;
        decisionLog = result.decisionLog;
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
        decisionId,
      ),
    ]);
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
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      // Operator/sim visibility: sealed is player-facing only; chatty traces show the ballot.
      text: `${player.name} sealed ballot: eliminate → ${targetName}`,
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
      .join(", ")} (most votes among vulnerable is eliminated)`,
    Phase.FORMAT_RESOLVE,
  );
  const resolutionSummary = formatEliminationReason(gameState, resolution, "most votes in vulnerable pool");
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
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId,
        safePlayerIds: [...board.safe],
        vulnerablePlayerIds: [...board.vulnerable],
        voteTotals: { ...voteTotals },
      },
    },
    resolutionSourcePointers,
  };
}

/** Human-readable elimination outcome for chatty/transcript (includes sole vs tiebreak). */
function formatEliminationReason(
  gameState: PhaseRunnerContext["gameState"],
  resolution: FormatEliminationResolution,
  criterion: string,
): string {
  if (!resolution.eliminatedId) {
    return `Format elimination unresolved under ${criterion}.`;
  }
  const name = gameState.getPlayerName(resolution.eliminatedId);
  if (resolution.kind === "auto") {
    return `Elimination: ${name} alone had ${criterion} (${resolution.reason}) — no empowered tiebreak.`;
  }
  if (resolution.kind === "clear" && resolution.tiedSet.length > 1) {
    const tied = resolution.tiedSet.map((id) => gameState.getPlayerName(id)).join(", ");
    return `Elimination: ${name} chosen by empowered tiebreak among tied set [${tied}] on ${criterion}.`;
  }
  return `Elimination: ${name} under ${criterion}.`;
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

  let choiceId = tiedSet[0]!;
  let thinking = "fallback first tied";
  let reasoningContext: string | undefined;
  let decisionLog: string | null | undefined;
  let decisionId: UUID | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (agent.breakFormatEliminationTie) {
    const tieFn = agent.breakFormatEliminationTie.bind(agent);
    const result = await withFormatAgentTimeout(
      ctx,
      Phase.FORMAT_RESOLVE,
      `Format tiebreak (${gameState.getPlayerName(empoweredId)})`,
      () => tieFn(phaseCtx, [...tiedSet]),
      () => ({
        targetId: choiceId,
        thinking: "House fallback after format-tiebreak timeout",
        decisionSource: "fallback" as const,
        fallbackReason: "tool_call_failed" as const,
      }),
    );
    if (result.fallbackReason === "tool_call_failed"
      && result.thinking === "House fallback after format-tiebreak timeout") {
      provenance = fallbackFormatProvenance("tool_call_failed");
      thinking = result.thinking;
    } else if (tiedSet.includes(result.targetId)) {
      choiceId = result.targetId;
      provenance = normalizedFormatProvenance(result);
      if (provenance.decisionSource === "llm") decisionId = result.decisionId;
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    } else {
      provenance = fallbackFormatProvenance("invalid_format_tiebreak_target");
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    }
  }

  const broken = applyFormatTiebreak(tiedSet, choiceId);
  if (!broken || broken.kind !== "clear" || !broken.eliminatedId) {
    throw new Error("Format tiebreak failed");
  }

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
      ...strategicDecisionResponse({ decisionLog }),
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
        decisionId,
      ),
    ],
  };
}
