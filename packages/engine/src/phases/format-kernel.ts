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
  HouseFormatResolutionFacts,
} from "../game-runner.types";
import { Phase, type UUID } from "../types";
import { handleElimination } from "./elimination";
import {
  assertCanAcceptCommit,
  strategicDecisionResponse,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
import { runMinglePhase } from "./mingle";

type FormatRoundElimination = {
  eliminatedId: UUID;
  voteDisclosure: EliminationVoteDisclosure;
  houseResolution: HouseFormatResolutionFacts;
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

export async function runFormatMenuPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger, contextBuilder } = ctx;
  const state = ctx.formatKernelState;
  const empoweredId = gameState.empoweredId;
  if (!empoweredId) {
    throw new Error("Format menu requires empowered player");
  }

  const menu = buildFormatMenu({ lastFormatId: state.lastSelectedFormat });
  state.offeredFormats = menu.offered;
  state.selectedFormat = null;
  state.pressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats: menu.offered,
    selectedFormat: null,
  });
  contextBuilder.currentFormatPressure = state.pressure;

  logger.logSystem(
    `FORMAT MENU: ${displayNameForFormat(menu.offered[0])} vs ${displayNameForFormat(menu.offered[1])}. ${gameState.getPlayerName(empoweredId)} will choose.`,
    Phase.FORMAT_MENU,
  );
  logger.logSystem(formatPressureSummary(state.pressure), Phase.FORMAT_MENU);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runFormatPickPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const state = ctx.formatKernelState;
  const empoweredId = gameState.empoweredId;
  const offeredFormats = state.offeredFormats;
  if (!empoweredId || !offeredFormats) {
    throw new Error("Format pick requires empowered player and offered formats");
  }

  const empoweredAgent = agents.get(empoweredId);
  if (!empoweredAgent) {
    throw new Error(`Missing empowered agent ${empoweredId}`);
  }

  const phaseCtx = contextBuilder.buildPhaseContext(empoweredId, Phase.FORMAT_PICK, {
    empoweredId,
  });

  let chosen: LaunchFormatId = offeredFormats[0];
  let thinking = "House fallback: first offered format";
  let reasoningContext: string | undefined;
  let decisionLog: string | null | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (empoweredAgent.pickRoundFormat) {
    const result = await empoweredAgent.pickRoundFormat(phaseCtx, offeredFormats);
    const picked = pickFormatFromMenu(offeredFormats, result.formatId);
    if (picked) {
      chosen = picked;
      provenance = normalizedFormatProvenance(result);
    } else {
      provenance = fallbackFormatProvenance("invalid_format_choice");
    }
    thinking = result.thinking ?? thinking;
    reasoningContext = result.reasoningContext;
    decisionLog = result.decisionLog;
  }

  await assertCanAcceptCommit(ctx);
  state.selectedFormat = chosen;
  state.lastSelectedFormat = chosen;
  state.pressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats,
    selectedFormat: chosen,
  });
  contextBuilder.currentFormatPressure = state.pressure;

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
  const { logger, contextBuilder } = ctx;
  const pressure = ctx.formatKernelState.pressure;
  if (pressure) {
    logger.logSystem(formatPressureSummary(pressure), Phase.FORMAT_MINGLE);
    contextBuilder.currentFormatPressure = pressure;
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
  const { gameState, logger, contextBuilder } = ctx;
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

  // House is omniscient: retain full sealed ballots / tallies for MC + producer.
  state.lastFormatResolution = elimination.houseResolution;

  await handleElimination(ctx, eliminatedId, Phase.FORMAT_RESOLVE, {
    mode: "format",
    formatId,
    voteDisclosure: elimination.voteDisclosure,
  });

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

  contextBuilder.currentFormatPressure = null;
  state.pressure = null;
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
  const { gameState, agents, logger, contextBuilder } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const ballots: SaveOrEliminateBallot[] = [];

  for (const player of alive) {
    const agent = agents.get(player.id);
    if (!agent) continue;
    const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.FORMAT_RESOLVE, {
      empoweredId,
    });
    let polarity: "save" | "eliminate" = "eliminate";
    let targetId = aliveIds.find((id) => id !== player.id) ?? player.id;
    let thinking = "fallback eliminate first other";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getSaveOrEliminateBallot) {
      const result = await agent.getSaveOrEliminateBallot(phaseCtx, aliveIds);
      if (isLegalSaveOrEliminateBallot(player.id, result.targetId, result.polarity, aliveIds)) {
        polarity = result.polarity;
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
      } else {
        provenance = fallbackFormatProvenance("invalid_save_or_eliminate_ballot");
      }
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    } else {
      // Default mock-like: eliminate last other
      const others = aliveIds.filter((id) => id !== player.id);
      targetId = others[others.length - 1] ?? targetId;
    }

    ballots.push({ voterId: player.id, polarity, targetId });
    const targetName = gameState.getPlayerName(targetId);
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

  await assertCanAcceptCommit(ctx);
  const nets = computeSaveOrEliminateNets(aliveIds, ballots);
  let resolution = resolveSaveOrEliminate(aliveIds, ballots);
  if (resolution.kind === "tie") {
    const broken = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
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
  const offered = ctx.formatKernelState.offeredFormats;
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
    houseResolution: {
      round: gameState.round,
      formatId: "save_or_eliminate",
      formatName: displayNameForFormat("save_or_eliminate"),
      offeredFormatIds: offered ? [...offered] : null,
      offeredFormatNames: offered
        ? [displayNameForFormat(offered[0]), displayNameForFormat(offered[1])]
        : null,
      ballots: ballots.map((b) => ({
        voterName: gameState.getPlayerName(b.voterId),
        targetName: gameState.getPlayerName(b.targetId),
        polarity: b.polarity,
      })),
      scores: aliveIds.map((id) => ({
        playerName: gameState.getPlayerName(id),
        value: nets.nets[id] ?? 0,
        bucket: "net",
      })),
      zeroSafeNames: [],
      safeNames: [],
      vulnerableNames: [],
      bouncePointers: [],
      resolutionKind: resolution.kind,
      resolutionSummary,
      eliminatedName: gameState.getPlayerName(eliminatedId),
      tiebreakByEmpoweredName:
        resolution.kind === "clear" && resolution.tiedSet.length > 1
          ? gameState.getPlayerName(empoweredId)
          : null,
    },
  };
}

async function resolveVoteBombRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<FormatRoundElimination> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const ballots: VoteBombBallot[] = [];

  for (const player of alive) {
    const agent = agents.get(player.id);
    if (!agent) continue;
    const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.FORMAT_RESOLVE, {
      empoweredId,
    });
    const others = aliveIds.filter((id) => id !== player.id);
    let targetId = others[others.length - 1] ?? player.id;
    let thinking = "fallback vote last other";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent.getVoteBombBallot) {
      const result = await agent.getVoteBombBallot(phaseCtx, aliveIds);
      if (isLegalVoteBombBallot(player.id, result.targetId, aliveIds)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
      } else {
        provenance = fallbackFormatProvenance("invalid_vote_bomb_target");
      }
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    }

    ballots.push({ voterId: player.id, targetId });
    const targetName = gameState.getPlayerName(targetId);
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

  await assertCanAcceptCommit(ctx);
  const tallies = computeVoteBombTallies(aliveIds, ballots);
  let resolution = resolveVoteBomb(aliveIds, ballots);
  if (resolution.kind === "tie") {
    resolution = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
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
  const offered = ctx.formatKernelState.offeredFormats;
  return {
    eliminatedId,
    voteDisclosure: {
      visibility: "sealed",
      votesReceived: tallies.totals[eliminatedId] ?? 0,
    },
    houseResolution: {
      round: gameState.round,
      formatId: "vote_bomb",
      formatName: displayNameForFormat("vote_bomb"),
      offeredFormatIds: offered ? [...offered] : null,
      offeredFormatNames: offered
        ? [displayNameForFormat(offered[0]), displayNameForFormat(offered[1])]
        : null,
      ballots: ballots.map((b) => ({
        voterName: gameState.getPlayerName(b.voterId),
        targetName: gameState.getPlayerName(b.targetId),
      })),
      scores: aliveIds.map((id) => ({
        playerName: gameState.getPlayerName(id),
        value: tallies.totals[id] ?? 0,
        bucket: (tallies.totals[id] ?? 0) === 0 ? "zero_safe" : "positive",
      })),
      zeroSafeNames: tallies.zeroSafeIds.map((id) => gameState.getPlayerName(id)),
      safeNames: [],
      vulnerableNames: [],
      bouncePointers: [],
      resolutionKind: resolution.kind,
      resolutionSummary,
      eliminatedName: gameState.getPlayerName(eliminatedId),
      tiebreakByEmpoweredName:
        resolution.kind === "clear" && resolution.tiedSet.length > 1
          ? gameState.getPlayerName(empoweredId)
          : null,
    },
  };
}

async function resolveSafetyBounceRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<FormatRoundElimination> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const starterId = aliveIds[Math.floor(Math.random() * aliveIds.length)]!;
  let board = createBounceBoard(aliveIds, starterId);
  updateBounceBoardPressure(ctx, board);

  logger.logSystem(
    `Safety Bounce starter (SAFE): ${gameState.getPlayerName(starterId)}`,
    Phase.FORMAT_RESOLVE,
  );

  const bouncePointers: HouseFormatResolutionFacts["bouncePointers"] = [];
  while (board.nextActorId !== null) {
    const actorId = board.nextActorId;
    const agent = agents.get(actorId);
    const phaseCtx = contextBuilder.buildPhaseContext(actorId, Phase.FORMAT_RESOLVE, {
      empoweredId,
    });
    let targetId = board.unclassified[0]!;
    let thinking = "fallback first unclassified";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent?.getBouncePointer) {
      const result = await agent.getBouncePointer(phaseCtx, {
        safe: board.safe,
        vulnerable: board.vulnerable,
        unclassified: board.unclassified,
        nextActorId: board.nextActorId,
      });
      const pointer = { actorId, targetId: result.targetId };
      if (isLegalBouncePointer(board, pointer)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
      } else {
        provenance = fallbackFormatProvenance("invalid_bounce_pointer");
      }
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    }

    board = applyBouncePointer(board, { actorId, targetId });
    updateBounceBoardPressure(ctx, board);
    const classification = board.vulnerable.includes(targetId) ? "VULNERABLE" : "SAFE";
    bouncePointers.push({
      actorName: gameState.getPlayerName(actorId),
      targetName: gameState.getPlayerName(targetId),
      classification,
    });
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

  const offered = ctx.formatKernelState.offeredFormats;
  if (board.vulnerable.length === 1) {
    const soleId = board.vulnerable[0]!;
    const resolutionSummary = `Elimination: ${gameState.getPlayerName(soleId)} alone vulnerable (sole_vulnerable) — no final ballot.`;
    return {
      eliminatedId: soleId,
      voteDisclosure: {
        visibility: "none",
        reason: "sole_vulnerable",
      },
      houseResolution: {
        round: gameState.round,
        formatId: "safety_bounce",
        formatName: displayNameForFormat("safety_bounce"),
        offeredFormatIds: offered ? [...offered] : null,
        offeredFormatNames: offered
          ? [displayNameForFormat(offered[0]), displayNameForFormat(offered[1])]
          : null,
        ballots: [],
        scores: [],
        zeroSafeNames: [],
        safeNames: board.safe.map((id) => gameState.getPlayerName(id)),
        vulnerableNames: board.vulnerable.map((id) => gameState.getPlayerName(id)),
        bouncePointers: [...bouncePointers],
        resolutionKind: "auto",
        resolutionSummary,
        eliminatedName: gameState.getPlayerName(soleId),
        tiebreakByEmpoweredName: null,
      },
    };
  }

  const voteTotals: Record<UUID, number> = {};
  for (const id of board.vulnerable) voteTotals[id] = 0;
  const ballots: Array<{ voterId: UUID; targetId: UUID }> = [];

  for (const player of alive) {
    const agent = agents.get(player.id);
    const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.FORMAT_RESOLVE, {
      empoweredId,
    });
    let targetId = board.vulnerable[0]!;
    let thinking = "fallback first vulnerable";
    let reasoningContext: string | undefined;
    let decisionLog: string | null | undefined;
    let provenance = fallbackFormatProvenance("agent_method_unavailable");

    if (agent?.getSafetyBounceVote) {
      const result = await agent.getSafetyBounceVote(phaseCtx, board.vulnerable);
      if (isLegalSafetyBounceVote(result.targetId, board.vulnerable)) {
        targetId = result.targetId;
        provenance = normalizedFormatProvenance(result);
      } else {
        provenance = fallbackFormatProvenance("invalid_safety_bounce_target");
      }
      thinking = result.thinking ?? thinking;
      reasoningContext = result.reasoningContext;
      decisionLog = result.decisionLog;
    } else {
      targetId = board.vulnerable[board.vulnerable.length - 1]!;
    }

    ballots.push({ voterId: player.id, targetId });
    voteTotals[targetId] = (voteTotals[targetId] ?? 0) + 1;
    const targetName = gameState.getPlayerName(targetId);
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

  await assertCanAcceptCommit(ctx);
  let resolution = resolveSafetyBounceVote(board.vulnerable, voteTotals);
  if (resolution.kind === "tie") {
    resolution = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
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
    houseResolution: {
      round: gameState.round,
      formatId: "safety_bounce",
      formatName: displayNameForFormat("safety_bounce"),
      offeredFormatIds: offered ? [...offered] : null,
      offeredFormatNames: offered
        ? [displayNameForFormat(offered[0]), displayNameForFormat(offered[1])]
        : null,
      ballots: ballots.map((b) => ({
        voterName: gameState.getPlayerName(b.voterId),
        targetName: gameState.getPlayerName(b.targetId),
      })),
      scores: board.vulnerable.map((id) => ({
        playerName: gameState.getPlayerName(id),
        value: voteTotals[id] ?? 0,
        bucket: "vulnerable_total",
      })),
      zeroSafeNames: [],
      safeNames: board.safe.map((id) => gameState.getPlayerName(id)),
      vulnerableNames: board.vulnerable.map((id) => gameState.getPlayerName(id)),
      bouncePointers: [...bouncePointers],
      resolutionKind: resolution.kind,
      resolutionSummary,
      eliminatedName: gameState.getPlayerName(eliminatedId),
      tiebreakByEmpoweredName:
        resolution.kind === "clear" && resolution.tiedSet.length > 1
          ? gameState.getPlayerName(empoweredId)
          : null,
    },
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
  const nextPressure = buildFormatPressureProjection({
    empoweredId: pressure.empoweredId,
    empoweredName: pressure.empoweredName,
    offeredFormats: pressure.offeredFormats,
    selectedFormat: pressure.selectedFormat,
    bounceBoard: board,
  });
  ctx.formatKernelState.pressure = nextPressure;
  ctx.contextBuilder.currentFormatPressure = nextPressure;
}

async function breakFormatTie(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
  tiedSet: readonly UUID[],
): Promise<{ kind: "clear"; eliminatedId: UUID; tiedSet: UUID[] }> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const agent = agents.get(empoweredId);
  const phaseCtx = contextBuilder.buildPhaseContext(empoweredId, Phase.FORMAT_RESOLVE, {
    empoweredId,
  });

  let choiceId = tiedSet[0]!;
  let thinking = "fallback first tied";
  let reasoningContext: string | undefined;
  let decisionLog: string | null | undefined;
  let provenance = fallbackFormatProvenance("agent_method_unavailable");

  if (agent?.breakFormatEliminationTie) {
    const result = await agent.breakFormatEliminationTie(phaseCtx, [...tiedSet]);
    if (tiedSet.includes(result.targetId)) {
      choiceId = result.targetId;
      provenance = normalizedFormatProvenance(result);
    } else {
      provenance = fallbackFormatProvenance("invalid_format_tiebreak_target");
    }
    thinking = result.thinking ?? thinking;
    reasoningContext = result.reasoningContext;
    decisionLog = result.decisionLog;
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

  return broken;
}
