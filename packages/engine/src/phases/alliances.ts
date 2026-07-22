import { Phase } from "../types";
import type { AllianceAction, AllianceHuddlePromptContext, AllianceHuddleTurnAction } from "../game-runner.types";
import { createUUID } from "../game-state";
import type { AllianceHuddleOutcome, AllianceHuddleScheduleRecord, AllianceHuddleSessionRecord, AllianceHuddleWindow, AllianceRecord, UUID } from "../types";
import { agentTurnSourcePointer, assertCanAcceptCommit, strategicDecisionResponse, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";

const MAX_HUDDLE_SESSIONS_PER_ALLIANCE = 2;

function nameKey(value: string): string {
  return value.trim().toLowerCase();
}

function actionDecision(action: AllianceAction): Record<string, unknown> {
  return {
    ...(action.decisionLog ? strategicDecisionResponse(action) : {}),
  };
}

function resolvePlayerRefs(
  ctx: PhaseRunnerContext,
  refs: readonly string[],
  selfId: UUID,
): { memberIds: UUID[]; repairNotes: string[] } {
  const alivePlayers = ctx.gameState.getAlivePlayers();
  const byNameOrId = new Map<string, UUID>();
  for (const player of alivePlayers) {
    byNameOrId.set(nameKey(player.id), player.id);
    byNameOrId.set(nameKey(player.name), player.id);
  }

  const memberIds: UUID[] = [];
  const repairNotes: string[] = [];
  for (const ref of refs) {
    const playerId = byNameOrId.get(nameKey(ref));
    if (!playerId) {
      repairNotes.push(`Unknown or eliminated alliance member ignored: ${ref}`);
      continue;
    }
    if (!memberIds.includes(playerId)) memberIds.push(playerId);
  }
  if (!memberIds.includes(selfId)) {
    memberIds.unshift(selfId);
    repairNotes.push("Proposer added to alliance roster.");
  }
  return { memberIds, repairNotes };
}

function currentVersionId(ctx: PhaseRunnerContext, lineageId: UUID): UUID | null {
  return ctx.gameState.getAllianceProposalLineage(lineageId)?.currentVersionId ?? null;
}

function hasActiveAllianceWithSameRoster(ctx: PhaseRunnerContext, memberIds: readonly UUID[]): boolean {
  const roster = new Set(memberIds);
  return ctx.gameState.getAllianceRecords().some((alliance) => {
    if (alliance.status !== "active" || alliance.memberIds.length !== roster.size) return false;
    return alliance.memberIds.every((memberId) => roster.has(memberId));
  });
}

async function collectAllianceAction(
  ctx: PhaseRunnerContext,
  playerId: UUID,
): Promise<AllianceAction> {
  const agent = ctx.agents.get(playerId)!;
  if (!agent.getAllianceAction) {
    return {
      action: "pass",
      thinking: "No alliance action method is available.",
      decisionLog: "fallback: pass alliance action",
    };
  }

  const phaseCtx = ctx.contextBuilder.buildPhaseContext(playerId, Phase.MINGLE_I);
  try {
    return await agent.getAllianceAction(phaseCtx);
  } catch (error) {
    return {
      action: "pass",
      thinking: "Alliance action generation failed; passing.",
      reasoningContext: error instanceof Error ? error.message : String(error),
      decisionLog: "fallback: alliance action error",
    };
  }
}

async function applyAllianceAction(
  ctx: PhaseRunnerContext,
  playerId: UUID,
  action: AllianceAction,
  pass: number,
): Promise<{ result: string; repairNotes: string[]; changed: boolean }> {
  const beforeCount = ctx.gameState.getCanonicalEvents().length;
  const sourcePointers = [
    agentTurnSourcePointer(playerId, "alliance-action", ctx.gameState.round, Phase.MINGLE_I, pass),
  ];
  const repairNotes: string[] = [];

  await assertCanAcceptCommit(ctx);

  try {
    switch (action.action) {
      case "propose": {
        const resolved = resolvePlayerRefs(ctx, action.memberNames, playerId);
        repairNotes.push(...resolved.repairNotes);
        if (resolved.memberIds.length < 2) {
          repairNotes.push("Alliance proposal rejected because fewer than two live members were resolved.");
          break;
        }
        if (hasActiveAllianceWithSameRoster(ctx, resolved.memberIds)) {
          repairNotes.push("Alliance proposal rejected because an active alliance already has the same member roster.");
          break;
        }
        ctx.gameState.recordAllianceProposal({
          allianceId: action.allianceId,
          lineageId: action.lineageId,
          versionId: action.versionId,
          proposerId: playerId,
          name: action.name,
          memberIds: resolved.memberIds,
          purpose: action.purpose,
          timebox: action.timebox ?? null,
        }, { phase: Phase.MINGLE_I, sourcePointers });
        break;
      }
      case "accept":
      case "decline":
      case "defer":
      case "trial": {
        const versionId = action.versionId ?? currentVersionId(ctx, action.lineageId);
        if (!versionId) {
          repairNotes.push(`Alliance response rejected because lineage was not found: ${action.lineageId}`);
          break;
        }
        const response = action.action === "accept"
          ? "accepted"
          : action.action === "decline"
            ? "declined"
            : action.action === "defer"
              ? "deferred"
              : "trial";
        ctx.gameState.recordAllianceResponse({
          lineageId: action.lineageId,
          versionId,
          playerId,
          response,
        }, { phase: Phase.MINGLE_I, sourcePointers });
        break;
      }
      case "counter": {
        const resolved = resolvePlayerRefs(ctx, action.memberNames, playerId);
        repairNotes.push(...resolved.repairNotes);
        if (resolved.memberIds.length < 2) {
          repairNotes.push("Alliance counter rejected because fewer than two live members were resolved.");
          break;
        }
        const version = ctx.gameState.recordAllianceCounter({
          lineageId: action.lineageId,
          versionId: action.versionId,
          proposerId: playerId,
          name: action.name,
          memberIds: resolved.memberIds,
          purpose: action.purpose,
          timebox: action.timebox ?? null,
        }, { phase: Phase.MINGLE_I, sourcePointers });
        if (!version) repairNotes.push("Alliance counter rejected because the lineage is closed or the counter cap was reached.");
        break;
      }
      case "amend": {
        const resolved = resolvePlayerRefs(ctx, action.memberNames, playerId);
        repairNotes.push(...resolved.repairNotes);
        if (resolved.memberIds.length < 2) {
          repairNotes.push("Alliance amendment rejected because fewer than two live members were resolved.");
          break;
        }
        const alliance = ctx.gameState.getAlliance(action.lineageId);
        if (!alliance || alliance.status !== "active") {
          repairNotes.push(`Alliance amendment rejected because active alliance was not found: ${action.lineageId}`);
          break;
        }
        ctx.gameState.recordAllianceAmendment({
          allianceId: action.lineageId,
          versionId: action.versionId,
          proposerId: playerId,
          name: action.name,
          memberIds: resolved.memberIds,
          purpose: action.purpose,
          timebox: action.timebox ?? null,
        }, { phase: Phase.MINGLE_I, sourcePointers });
        break;
      }
      case "pass":
        break;
      default: {
        const exhaustive: never = action;
        repairNotes.push(`Unsupported alliance action ignored: ${String((exhaustive as { action?: unknown }).action)}`);
      }
    }
  } catch (error) {
    repairNotes.push(error instanceof Error ? error.message : String(error));
  }

  const changed = ctx.gameState.getCanonicalEvents().length > beforeCount;
  return {
    result: changed ? "recorded" : action.action === "pass" ? "passed" : "rejected",
    repairNotes,
    changed,
  };
}

function emitAllianceActionTurn(
  ctx: PhaseRunnerContext,
  playerId: UUID,
  action: AllianceAction,
  pass: number,
  result: string,
  repairNotes: string[],
): void {
  const player = ctx.gameState.getPlayer(playerId);
  ctx.logger.emitAgentTurn({
    phase: Phase.MINGLE_I,
    action: "alliance-action",
    actor: { id: playerId, name: player?.name ?? playerId, role: "player" },
    visibility: "private",
    response: {
      pass,
      requestedAction: action.action,
      normalizedAction: action,
      result,
      repairNotes,
      ...actionDecision(action),
    },
    thinking: action.thinking,
    reasoningContext: action.reasoningContext,
  });
}

function currentLineageVersion(lineage: NonNullable<ReturnType<PhaseRunnerContext["gameState"]["getAllianceProposalLineage"]>>) {
  return lineage.versions.find((version) => version.versionId === lineage.currentVersionId) ?? null;
}

function currentLineageResponseIds(
  lineage: NonNullable<ReturnType<PhaseRunnerContext["gameState"]["getAllianceProposalLineage"]>>,
): Set<UUID> {
  return new Set(Object.keys(lineage.responsesByVersion[lineage.currentVersionId] ?? {}));
}

function currentRequiredMemberIds(
  lineage: NonNullable<ReturnType<PhaseRunnerContext["gameState"]["getAllianceProposalLineage"]>>,
): UUID[] {
  const version = currentLineageVersion(lineage);
  return version ? [...(version.requiredConsentMemberIds ?? version.terms.memberIds)] : [];
}

function validateProposerAction(action: AllianceAction): string | null {
  if (action.action === "propose" || action.action === "pass") return null;
  return "Only propose or pass is legal during a proposer opportunity.";
}

function validateProposalResponseAction(action: AllianceAction, lineageId: UUID): string | null {
  if (action.action === "pass") return null;
  if (
    action.action === "accept"
    || action.action === "decline"
    || action.action === "defer"
    || action.action === "trial"
    || action.action === "counter"
  ) {
    return action.lineageId === lineageId
      ? null
      : `Alliance response rejected because it targeted ${action.lineageId} instead of active proposal ${lineageId}.`;
  }
  return "Only accept, decline, defer, trial, counter, or pass is legal while resolving an active proposal.";
}

function newestLineageId(
  beforeLineageIds: Set<UUID>,
  afterLineages: ReturnType<PhaseRunnerContext["gameState"]["getAllianceProposalLineages"]>,
): UUID | null {
  const created = afterLineages.filter((lineage) => !beforeLineageIds.has(lineage.id));
  return created.length === 1 ? created[0]?.id ?? null : null;
}

async function resolveAllianceProposalTransaction(
  ctx: PhaseRunnerContext,
  lineageId: UUID,
  step: { value: number },
): Promise<void> {
  const askedByVersion = new Map<UUID, Set<UUID>>();

  while (true) {
    const lineage = ctx.gameState.getAllianceProposalLineage(lineageId);
    if (!lineage || lineage.status !== "open") return;

    const version = currentLineageVersion(lineage);
    if (!version) {
      ctx.gameState.expireAllianceProposal(lineageId, { phase: Phase.MINGLE_I });
      return;
    }

    const requiredMemberIds = currentRequiredMemberIds(lineage);
    const responseIds = currentLineageResponseIds(lineage);
    const askedIds = askedByVersion.get(version.versionId) ?? new Set<UUID>();
    askedByVersion.set(version.versionId, askedIds);

    const responder = ctx.gameState.getAlivePlayers().find((player) =>
      requiredMemberIds.includes(player.id)
      && !responseIds.has(player.id)
      && !askedIds.has(player.id)
    );

    if (!responder) {
      await assertCanAcceptCommit(ctx);
      ctx.gameState.expireAllianceProposal(lineageId, { phase: Phase.MINGLE_I });
      return;
    }

    const action = await collectAllianceAction(ctx, responder.id);
    askedIds.add(responder.id);
    const modeError = validateProposalResponseAction(action, lineageId);
    if (modeError) {
      emitAllianceActionTurn(ctx, responder.id, action, step.value, "rejected", [modeError]);
      step.value += 1;
      continue;
    }

    const result = await applyAllianceAction(ctx, responder.id, action, step.value);
    emitAllianceActionTurn(ctx, responder.id, action, step.value, result.result, result.repairNotes);
    step.value += 1;
  }
}

function huddleWindowForPhase(phase: Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE): AllianceHuddleWindow {
  return phase === Phase.PRE_VOTE_HUDDLE ? "pre_vote" : "pre_council";
}

function huddleBudget(aliveCount: number): number {
  return Math.min(4, Math.max(2, Math.floor(aliveCount / 4)));
}

function liveAllianceMemberIds(ctx: PhaseRunnerContext, alliance: AllianceRecord): UUID[] {
  return alliance.memberIds.filter((memberId) => ctx.gameState.getPlayer(memberId)?.status === "alive");
}

function allianceMemberNames(ctx: PhaseRunnerContext, memberIds: readonly UUID[]): string[] {
  return memberIds.map((memberId) => ctx.gameState.getPlayerName(memberId));
}

function huddleCandidate(ctx: PhaseRunnerContext, alliance: AllianceRecord, window: AllianceHuddleWindow) {
  return {
    allianceId: alliance.id,
    name: alliance.name,
    memberNames: allianceMemberNames(ctx, liveAllianceMemberIds(ctx, alliance)),
    purpose: alliance.purpose,
    timebox: alliance.timebox,
    priorOutcomeCount: alliance.huddleOutcomeIds
      .map((outcomeId) => ctx.gameState.getAllianceHuddleOutcomes().find((outcome) => outcome.id === outcomeId))
      .filter((outcome) => outcome?.window === window).length,
  };
}

function huddleScheduleRecord(params: {
  alliance: AllianceRecord;
  window: AllianceHuddleWindow;
  round: number;
  pass: number;
  decision: "scheduled" | "skipped";
  memberIds: UUID[];
  rationale: string;
}): AllianceHuddleScheduleRecord {
  return {
    id: createUUID(),
    allianceId: params.alliance.id,
    window: params.window,
    round: params.round,
    pass: params.pass,
    decision: params.decision,
    memberIds: [...params.memberIds],
    rationale: params.rationale,
    createdAt: new Date().toISOString(),
  };
}

function emitHuddleScheduleTurn(
  ctx: PhaseRunnerContext,
  phase: Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE,
  schedule: AllianceHuddleScheduleRecord,
): void {
  ctx.logger.emitAgentTurn({
    phase,
    action: "alliance-huddle-schedule",
    actor: { name: "The House", role: "house" },
    visibility: "private",
    response: {
      scheduleId: schedule.id,
      allianceId: schedule.allianceId,
      window: schedule.window,
      decision: schedule.decision,
      pass: schedule.pass,
      memberIds: schedule.memberIds,
      rationale: schedule.rationale,
    },
    scope: "huddle",
  });
}

async function collectAllianceHuddleTurn(
  ctx: PhaseRunnerContext,
  speakerId: UUID,
  huddle: AllianceHuddlePromptContext,
  conversationHistory: Array<{ from: string; text: string }>,
): Promise<AllianceHuddleTurnAction> {
  const agent = ctx.agents.get(speakerId)!;
  if (!agent.getAllianceHuddleTurn) {
    return {
      thinking: "No alliance huddle method is available.",
      message: null,
      noReply: true,
      decisionLog: "fallback: pass alliance huddle turn",
    };
  }

  const phase = huddle.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE;
  const phaseCtx = ctx.contextBuilder.buildPhaseContext(speakerId, phase);
  try {
    return await agent.getAllianceHuddleTurn(phaseCtx, huddle, conversationHistory);
  } catch (error) {
    return {
      thinking: "Alliance huddle turn failed; no reply.",
      reasoningContext: error instanceof Error ? error.message : String(error),
      message: null,
      noReply: true,
      decisionLog: "fallback: alliance huddle turn error",
    };
  }
}

async function completeHuddleSession(
  ctx: PhaseRunnerContext,
  phase: Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE,
  alliance: AllianceRecord,
  schedule: AllianceHuddleScheduleRecord,
): Promise<void> {
  const speakerIds = schedule.memberIds.filter((memberId) => ctx.gameState.getPlayer(memberId)?.status === "alive");
  const conversationHistory: Array<{ from: string; text: string }> = [];
  // Canonical session identity is created before any message so modern huddle
  // rows carry alliance/schedule/session IDs plus exact session-time audience.
  const sessionId = createUUID();
  const huddle: AllianceHuddlePromptContext = {
    allianceId: alliance.id,
    allianceName: alliance.name,
    memberNames: allianceMemberNames(ctx, speakerIds),
    purpose: alliance.purpose,
    timebox: alliance.timebox,
    window: schedule.window,
    scheduleId: schedule.id,
    pass: schedule.pass,
  };
  const huddleMessageContext = {
    allianceId: alliance.id,
    scheduleId: schedule.id,
    sessionId,
    window: schedule.window,
    sessionAudiencePlayerIds: speakerIds,
  };
  for (const speakerId of speakerIds) {
    await assertCanAcceptCommit(ctx);
    const turn = await collectAllianceHuddleTurn(ctx, speakerId, huddle, conversationHistory);
    const message = turn.noReply ? null : (turn.message?.trim() || null);
    if (message) {
      ctx.logger.logHuddleMessage(
        speakerId,
        speakerIds.filter((memberId) => memberId !== speakerId),
        message,
        phase,
        turn.thinking,
        turn.reasoningContext,
        huddleMessageContext,
      );
      conversationHistory.push({ from: ctx.gameState.getPlayerName(speakerId), text: message });
    }
    ctx.logger.emitAgentTurn({
      phase,
      action: "alliance-huddle-turn",
      actor: { id: speakerId, name: ctx.gameState.getPlayerName(speakerId), role: "player" },
      visibility: "private",
      response: {
        scheduleId: schedule.id,
        allianceId: alliance.id,
        allianceName: alliance.name,
        sessionId,
        action: message ? "talk" : "no_reply",
        message,
        ...strategicDecisionResponse(turn),
      },
      thinking: turn.thinking,
      reasoningContext: turn.reasoningContext,
      scope: "huddle",
    });
  }

  const completedAt = new Date().toISOString();
  const session: AllianceHuddleSessionRecord = {
    id: sessionId,
    scheduleId: schedule.id,
    allianceId: alliance.id,
    window: schedule.window,
    round: schedule.round,
    pass: schedule.pass,
    speakerIds,
    completedAt,
  };
  ctx.gameState.recordAllianceHuddleCompleted(session);

  const memberNames = allianceMemberNames(ctx, speakerIds);
  const summary = await ctx.houseInterviewer.summarizeAllianceHuddle({
    round: schedule.round,
    phase,
    window: schedule.window,
    alliance: {
      id: alliance.id,
      name: alliance.name,
      memberNames,
      purpose: alliance.purpose,
      timebox: alliance.timebox,
    },
    transcript: conversationHistory,
  });
  const outcome: AllianceHuddleOutcome = {
    id: createUUID(),
    sessionId: session.id,
    allianceId: alliance.id,
    window: schedule.window,
    round: schedule.round,
    ask: summary.ask,
    plan: summary.plan,
    promises: summary.promises,
    dissent: summary.dissent,
    confidence: summary.confidence,
    posture: summary.posture,
    leakOrBetrayalClaims: summary.leakOrBetrayalClaims,
    createdAt: completedAt,
  };
  ctx.gameState.recordAllianceHuddleOutcome(outcome);
  ctx.logger.emitAgentTurn({
    phase,
    action: "alliance-huddle-outcome",
    actor: { name: "The House", role: "house" },
    visibility: "private",
    response: {
      scheduleId: schedule.id,
      sessionId: session.id,
      allianceId: alliance.id,
      outcome,
    },
    thinking: summary.thinking,
    reasoningContext: summary.reasoningContext,
    scope: "huddle",
  });
}

export async function runMingleIAlliancePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, logger } = ctx;
  logger.emitPhaseChange(Phase.MINGLE_I);
  logger.logSystem("=== MINGLE I: ALLIANCE ACTIONS ===", Phase.MINGLE_I);

  await assertCanAcceptCommit(ctx);
  gameState.closeUniversalAlliancesBeforeMingle(Phase.MINGLE_I);

  const step = { value: 1 };
  for (const player of gameState.getAlivePlayers()) {
    const action = await collectAllianceAction(ctx, player.id);
    const modeError = validateProposerAction(action);
    if (modeError) {
      emitAllianceActionTurn(ctx, player.id, action, step.value, "rejected", [modeError]);
      step.value += 1;
      continue;
    }

    const beforeLineageIds = new Set(gameState.getAllianceProposalLineages().map((lineage) => lineage.id));
    const result = await applyAllianceAction(ctx, player.id, action, step.value);
    emitAllianceActionTurn(ctx, player.id, action, step.value, result.result, result.repairNotes);
    step.value += 1;

    if (action.action !== "propose" || !result.changed) continue;
    const lineageId = action.lineageId
      ?? newestLineageId(beforeLineageIds, gameState.getAllianceProposalLineages());
    if (lineageId) await resolveAllianceProposalTransaction(ctx, lineageId, step);
  }

  for (const lineage of gameState.getAllianceProposalLineages()) {
    if (lineage.status === "open") {
      await assertCanAcceptCommit(ctx);
      gameState.expireAllianceProposal(lineage.id, { phase: Phase.MINGLE_I });
    }
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runAllianceHuddleWindow(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  phase: Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE,
): Promise<void> {
  const label = phase === Phase.PRE_VOTE_HUDDLE
    ? "PRE-VOTE ALLIANCE HUDDLES"
    : "PRE-COUNCIL ALLIANCE HUDDLES";
  ctx.logger.emitPhaseChange(phase);
  ctx.logger.logSystem(`=== ${label} ===`, phase);

  ctx.gameState.closeUniversalAlliancesBeforeMingle(phase);
  const eligible = ctx.gameState.getHuddleEligibleAlliances();
  const budget = huddleBudget(ctx.gameState.getAlivePlayers().length);
  const window = huddleWindowForPhase(phase);
  const eligibleById = new Map(eligible.map((alliance) => [alliance.id, alliance]));
  const housePlan = await ctx.houseInterviewer.planAllianceHuddles({
    round: ctx.gameState.round,
    phase,
    window,
    budget,
    alivePlayers: ctx.gameState.getAlivePlayers().map((player) => player.name),
    candidates: eligible.map((alliance) => huddleCandidate(ctx, alliance, window)),
  });
  const scheduled: Array<{ alliance: AllianceRecord; rationale: string; pass: number; order: number }> = [];
  const scheduledCounts = new Map<UUID, number>();
  let droppedHouseSelectionCount = 0;
  for (const [index, item] of housePlan.scheduled.entries()) {
    if (scheduled.length >= budget) break;
    const alliance = eligibleById.get(item.allianceId);
    if (!alliance) {
      droppedHouseSelectionCount += 1;
      continue;
    }
    const nextPass = (scheduledCounts.get(alliance.id) ?? 0) + 1;
    if (nextPass > MAX_HUDDLE_SESSIONS_PER_ALLIANCE) {
      droppedHouseSelectionCount += 1;
      continue;
    }
    scheduled.push({ alliance, rationale: item.rationale, pass: nextPass, order: index });
    scheduledCounts.set(alliance.id, nextPass);
  }

  if (droppedHouseSelectionCount > 0 && scheduled.length < budget) {
    let repairOrder = housePlan.scheduled.length;
    for (let pass = 1; pass <= MAX_HUDDLE_SESSIONS_PER_ALLIANCE && scheduled.length < budget; pass += 1) {
      for (const alliance of eligible) {
        if (scheduled.length >= budget) break;
        const currentCount = scheduledCounts.get(alliance.id) ?? 0;
        if (currentCount !== pass - 1) continue;
        scheduled.push({
          alliance,
          rationale: `The House schedule was repaired after ${droppedHouseSelectionCount} invalid or over-cap selection${droppedHouseSelectionCount === 1 ? "" : "s"}.`,
          pass,
          order: repairOrder,
        });
        repairOrder += 1;
        scheduledCounts.set(alliance.id, pass);
      }
    }
  }

  scheduled.sort((a, b) => a.pass - b.pass || a.order - b.order);
  const skipRationaleByAllianceId = new Map(housePlan.skipped.map((item) => [item.allianceId, item.rationale]));
  const skipped = eligible
    .filter((alliance) => (scheduledCounts.get(alliance.id) ?? 0) === 0)
    .map((alliance) => ({
      alliance,
      rationale: skipRationaleByAllianceId.get(alliance.id)
        ?? housePlan.rationale
        ?? "The House did not grant this alliance huddle time in the current scarce window.",
    }));

  for (const { alliance, rationale, pass } of scheduled) {
    const schedule = huddleScheduleRecord({
      alliance,
      window,
      round: ctx.gameState.round,
      pass,
      decision: "scheduled",
      memberIds: liveAllianceMemberIds(ctx, alliance),
      rationale,
    });
    await assertCanAcceptCommit(ctx);
    ctx.gameState.recordAllianceHuddleSchedule(schedule);
    emitHuddleScheduleTurn(ctx, phase, schedule);
    await completeHuddleSession(ctx, phase, alliance, schedule);
  }

  for (const { alliance, rationale } of skipped) {
    const schedule = huddleScheduleRecord({
      alliance,
      window,
      round: ctx.gameState.round,
      pass: 1,
      decision: "skipped",
      memberIds: liveAllianceMemberIds(ctx, alliance),
      rationale,
    });
    await assertCanAcceptCommit(ctx);
    ctx.gameState.recordAllianceHuddleSchedule(schedule);
    emitHuddleScheduleTurn(ctx, phase, schedule);
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}
