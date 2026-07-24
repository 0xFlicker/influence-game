/**
 * Sequester format kernel phase handlers:
 * menu → pick → format mingle → resolve (Save-or-eliminate / Vote Bomb / Safety Bounce).
 */

import {
  applyBouncePointer,
  applyFormatTiebreak,
  buildFormatMenu,
  createBounceBoard,
  isLegalBouncePointer,
  isLegalSaveOrEliminateBallot,
  isLegalVoteBombBallot,
  pickFormatFromMenu,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  resolveVoteBomb,
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
  FormatDecisionFallbackReason,
  FormatDecisionProvenance,
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

/** Module-level round scratch (runner is single-threaded per game). */
let offeredFormats: [LaunchFormatId, LaunchFormatId] | null = null;
let selectedFormat: LaunchFormatId | null = null;
let formatPressure: FormatPressureProjection | null = null;
let lastSelectedFormat: LaunchFormatId | null = null;

function normalizedFormatProvenance(
  result: Partial<FormatDecisionProvenance>,
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

export function getLastSelectedFormat(): LaunchFormatId | null {
  return lastSelectedFormat;
}

export function resetFormatKernelScratch(): void {
  offeredFormats = null;
  selectedFormat = null;
  formatPressure = null;
}

export function getFormatPressureProjection(): FormatPressureProjection | null {
  return formatPressure;
}

export async function runFormatMenuPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger, contextBuilder } = ctx;
  const empoweredId = gameState.empoweredId;
  if (!empoweredId) {
    throw new Error("Format menu requires empowered player");
  }

  const menu = buildFormatMenu({ lastFormatId: lastSelectedFormat });
  offeredFormats = menu.offered;
  selectedFormat = null;
  formatPressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats: menu.offered,
    selectedFormat: null,
  });
  contextBuilder.currentFormatPressure = formatPressure;

  logger.logSystem(
    `FORMAT MENU: ${menu.offered[0]} vs ${menu.offered[1]}. ${gameState.getPlayerName(empoweredId)} will choose.`,
    Phase.FORMAT_MENU,
  );
  logger.logSystem(formatPressureSummary(formatPressure), Phase.FORMAT_MENU);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runFormatPickPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const empoweredId = gameState.empoweredId;
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
  selectedFormat = chosen;
  lastSelectedFormat = chosen;
  formatPressure = buildFormatPressureProjection({
    empoweredId,
    empoweredName: gameState.getPlayerName(empoweredId),
    offeredFormats,
    selectedFormat: chosen,
  });
  contextBuilder.currentFormatPressure = formatPressure;

  const sheet = ruleSheetForFormat(chosen);
  logger.logSystem(
    `FORMAT LOCKED: ${chosen}. Chosen by ${gameState.getPlayerName(empoweredId)}.`,
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
      thinking,
      reasoningContext,
      ...strategicDecisionResponse({ decisionLog }),
    },
    thinking,
    reasoningContext,
    scope: "system",
    text: `${gameState.getPlayerName(empoweredId)} chose format ${chosen}`,
  });

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runFormatMinglePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { logger, contextBuilder } = ctx;
  if (formatPressure) {
    logger.logSystem(formatPressureSummary(formatPressure), Phase.FORMAT_MINGLE);
    contextBuilder.currentFormatPressure = formatPressure;
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
  const formatId = selectedFormat;
  const empoweredId = gameState.empoweredId;
  if (!formatId || !empoweredId) {
    throw new Error("Format resolve requires selected format and empowered player");
  }

  logger.logSystem(`=== FORMAT RESOLVE (${formatId}) ===`, Phase.FORMAT_RESOLVE);

  let eliminatedId: UUID;
  if (formatId === "save_or_eliminate") {
    eliminatedId = await resolveSaveOrEliminateRound(ctx, empoweredId);
  } else if (formatId === "vote_bomb") {
    eliminatedId = await resolveVoteBombRound(ctx, empoweredId);
  } else {
    eliminatedId = await resolveSafetyBounceRound(ctx, empoweredId);
  }

  await handleElimination(ctx, eliminatedId, Phase.FORMAT_RESOLVE, {
    mode: "format",
    formatId,
  });

  gameState.recordRoundResult({
    round: gameState.round,
    empoweredId,
    exposeScores: {},
    candidates: null,
    powerAction: null,
    powerTarget: null,
    eliminated: eliminatedId,
    formatId,
    formatMethod: formatId,
  });

  logger.logSystem(
    `Format ${formatId} eliminated ${gameState.getPlayerName(eliminatedId)}`,
    Phase.FORMAT_RESOLVE,
  );

  contextBuilder.currentFormatPressure = null;
  formatPressure = null;
  offeredFormats = null;
  selectedFormat = null;

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
): Promise<UUID> {
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
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "save_or_eliminate",
        polarity,
        targetId,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      text: `${player.name} cast sealed save-or-eliminate ballot`,
    });
  }

  await assertCanAcceptCommit(ctx);
  let resolution = resolveSaveOrEliminate(aliveIds, ballots);
  if (resolution.kind === "tie") {
    const broken = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
    resolution = broken;
  }

  logger.logSystem(
    `Save-or-eliminate reveal: ${ballots
      .map(
        (b) =>
          `${gameState.getPlayerName(b.voterId)}→${b.polarity}:${gameState.getPlayerName(b.targetId)}`,
      )
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );

  if (!resolution.eliminatedId) {
    throw new Error("Save-or-eliminate failed to resolve elimination");
  }
  return resolution.eliminatedId;
}

async function resolveVoteBombRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<UUID> {
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
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "vote_bomb",
        targetId,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      text: `${player.name} cast sealed vote-bomb ballot`,
    });
  }

  await assertCanAcceptCommit(ctx);
  let resolution = resolveVoteBomb(aliveIds, ballots);
  if (resolution.kind === "tie") {
    resolution = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
  }

  logger.logSystem(
    `Vote Bomb reveal: ${ballots
      .map((b) => `${gameState.getPlayerName(b.voterId)}→${gameState.getPlayerName(b.targetId)}`)
      .join("; ")}`,
    Phase.FORMAT_RESOLVE,
  );

  if (!resolution.eliminatedId) {
    throw new Error("Vote Bomb failed to resolve elimination");
  }
  return resolution.eliminatedId;
}

async function resolveSafetyBounceRound(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): Promise<UUID> {
  const { gameState, agents, logger, contextBuilder } = ctx;
  const alive = gameState.getAlivePlayers();
  const aliveIds = alive.map((p) => p.id);
  const starterId = aliveIds[Math.floor(Math.random() * aliveIds.length)]!;
  let board = createBounceBoard(aliveIds, starterId);
  updateBounceBoardPressure(contextBuilder, board);

  logger.logSystem(
    `Safety Bounce starter (SAFE): ${gameState.getPlayerName(starterId)}`,
    Phase.FORMAT_RESOLVE,
  );

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
    updateBounceBoardPressure(contextBuilder, board);
    const classification = board.vulnerable.includes(targetId) ? "VULNERABLE" : "SAFE";
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
    return board.vulnerable[0]!;
  }

  const voteTotals: Record<UUID, number> = {};
  for (const id of board.vulnerable) voteTotals[id] = 0;

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
      if (board.vulnerable.includes(result.targetId)) {
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

    voteTotals[targetId] = (voteTotals[targetId] ?? 0) + 1;
    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "safety_bounce",
        targetId,
        sealed: true,
        ...provenance,
        ...strategicDecisionResponse({ decisionLog }),
      },
      thinking,
      reasoningContext,
      scope: "system",
      text: `${player.name} cast sealed safety-bounce vote`,
    });
  }

  await assertCanAcceptCommit(ctx);
  let resolution = resolveSafetyBounceVote(board.vulnerable, voteTotals);
  if (resolution.kind === "tie") {
    resolution = await breakFormatTie(ctx, empoweredId, resolution.tiedSet);
  }

  logger.logSystem(
    `Safety Bounce vote reveal: ${Object.entries(voteTotals)
      .map(([id, n]) => `${gameState.getPlayerName(id as UUID)}=${n}`)
      .join(", ")}`,
    Phase.FORMAT_RESOLVE,
  );

  if (!resolution.eliminatedId) {
    throw new Error("Safety Bounce failed to resolve elimination");
  }
  return resolution.eliminatedId;
}

function updateBounceBoardPressure(
  contextBuilder: PhaseRunnerContext["contextBuilder"],
  board: FormatPressureProjection["bounceBoard"],
): void {
  if (!formatPressure || !board) return;
  formatPressure = buildFormatPressureProjection({
    empoweredId: formatPressure.empoweredId,
    empoweredName: formatPressure.empoweredName,
    offeredFormats: formatPressure.offeredFormats,
    selectedFormat: formatPressure.selectedFormat,
    bounceBoard: board,
  });
  contextBuilder.currentFormatPressure = formatPressure;
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
