import { createHash } from "node:crypto";
import { Phase } from "../types";
import type { AllianceAction, AllianceActionOpportunity, AllianceHuddlePromptContext, AllianceHuddleTurnAction } from "../game-runner.types";
import { createUUID } from "../game-state";
import type {
  HouseAllianceProposerCandidate,
  HouseAllianceProposerSelectionResult,
} from "../house-interviewer";
import type { AllianceHuddleFactAtom, AllianceHuddleOutcome, AllianceHuddleScheduleRecord, AllianceHuddleSessionRecord, AllianceHuddleWindow, AllianceRecord, UUID } from "../types";
import {
  formatAllianceActionOperatorText,
  formatAllianceHuddleOutcomeOperatorText,
  formatAllianceHuddleScheduleOperatorText,
  formatAllianceHuddleTurnOperatorText,
  type AllianceActionOperatorContext,
} from "../operator-turn-text";
import { formatAllianceHuddleFacts } from "../alliance-huddle-outcome";
import {
  agentTurnSourcePointer,
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
import { engineFallbackMetadata } from "../engine-fallback";
import { isProviderFallbackEligible, ProviderUnavailableError } from "../provider-execution";

const MAX_HUDDLE_SESSIONS_PER_ALLIANCE = 2;

function deterministicHuddleId(coordinate: readonly unknown[]): UUID {
  const digest = createHash("sha256")
    .update(JSON.stringify(coordinate))
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function nameKey(value: string): string {
  return value.trim().toLowerCase();
}

function actionDecision(action: AllianceAction): Record<string, unknown> {
  return { ...strategicDecisionResponse(action) };
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
  phase: Phase.FORMAT_MINGLE,
  opportunity: AllianceActionOpportunity,
): Promise<AllianceAction> {
  const agent = ctx.agents.get(playerId)!;
  const phaseCtx = prepareAgentPhaseContext(ctx, agent, playerId, phase, "strategic_decision");
  if (!agent.getAllianceAction) {
    return {
      action: "pass",
      ...engineFallbackMetadata(
        phaseCtx,
        playerId,
        "alliance-action",
        "agent_method_unavailable",
      ),
    };
  }

  try {
    let action = await agent.getAllianceAction(phaseCtx, opportunity);
    if (action.action === "pass" && action.strategyGameplayAccepted === false) {
      action = {
        action: "pass",
        ...engineFallbackMetadata(
          phaseCtx,
          playerId,
          "alliance-action",
          "invalid_model_output",
        ),
      };
    }
    if (opportunity.kind !== "response") return action;
    if (
      action.action === "accept"
      || action.action === "decline"
      || action.action === "defer"
      || action.action === "trial"
    ) {
      return {
        ...action,
        lineageId: opportunity.lineageId,
        versionId: opportunity.versionId,
      };
    }
    if (action.action === "counter") {
      const { versionId: _providerVersionId, ...counter } = action;
      return {
        ...counter,
        lineageId: opportunity.lineageId,
      };
    }
    return action;
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return {
      action: "pass",
      ...engineFallbackMetadata(
        phaseCtx,
        playerId,
        "alliance-action",
        "provider_exhausted",
      ),
    };
  }
}

async function applyAllianceAction(
  ctx: PhaseRunnerContext,
  playerId: UUID,
  action: AllianceAction,
  pass: number,
  phase: Phase.FORMAT_MINGLE,
): Promise<{ result: string; repairNotes: string[]; changed: boolean }> {
  const beforeCount = ctx.gameState.getCanonicalEvents().length;
  const repairNotes: string[] = [];
  const sourcePointers = (decisionId: UUID | undefined) => [
    agentTurnSourcePointer(
      playerId,
      "alliance-action",
      ctx.gameState.round,
      phase,
      pass,
      action.engineFallback ? undefined : decisionId,
      action.engineFallback,
    ),
  ];

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
        }, {
          phase,
          sourcePointers: sourcePointers(repairNotes.length === 0 ? action.decisionId : undefined),
        });
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
        }, {
          phase,
          sourcePointers: sourcePointers(action.decisionId),
        });
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
        }, {
          phase,
          sourcePointers: sourcePointers(repairNotes.length === 0 ? action.decisionId : undefined),
        });
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
        const alliance = ctx.gameState.getAlliance(action.allianceId);
        if (!alliance || alliance.status !== "active") {
          repairNotes.push(`Alliance amendment rejected because active alliance was not found: ${action.allianceId}`);
          break;
        }
        if (!alliance.memberIds.includes(playerId)) {
          repairNotes.push(`Alliance amendment rejected because proposer is not an active member: ${playerId}`);
          break;
        }
        ctx.gameState.recordAllianceAmendment({
          allianceId: action.allianceId,
          versionId: action.versionId,
          proposerId: playerId,
          name: action.name,
          memberIds: resolved.memberIds,
          purpose: action.purpose,
          timebox: action.timebox ?? null,
        }, {
          phase,
          sourcePointers: sourcePointers(repairNotes.length === 0 ? action.decisionId : undefined),
        });
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
  resolveActionStrategyCandidate(
    ctx.agents.get(playerId)!,
    action,
    (changed || action.action === "pass")
      && action.strategyGameplayAccepted !== false,
  );
  return {
    result: changed ? "recorded" : action.action === "pass" ? "passed" : "rejected",
    repairNotes,
    changed,
  };
}

function resolveAllianceActionOperatorContext(
  ctx: PhaseRunnerContext,
  action: AllianceAction,
): AllianceActionOperatorContext {
  const lineageId =
    "lineageId" in action && typeof action.lineageId === "string" && action.lineageId.length > 0
      ? action.lineageId
      : null;
  const allianceId = action.action === "amend" ? action.allianceId : null;

  // After a successful propose, lineage may only exist under a generated id.
  // Prefer an action lineage; otherwise scan generated proposal/amendment lineages by name.
  let lineage = lineageId ? ctx.gameState.getAllianceProposalLineage(lineageId) : undefined;
  if (!lineage && (action.action === "propose" || action.action === "amend")) {
    const open = ctx.gameState.getAllianceProposalLineages()
      .filter((candidate) => candidate.status === "open")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    lineage = open.find((candidate) => {
      const version = candidate.versions.find((entry) => entry.versionId === candidate.currentVersionId);
      return version?.terms.name === action.name;
    }) ?? open[0];
  }

  if (!lineage) {
    if (action.action === "propose" || action.action === "counter" || action.action === "amend") {
      return {
        allianceName: action.name,
        memberNames: action.memberNames,
        shortId: (lineageId ?? allianceId)?.slice(0, 8) ?? null,
      };
    }
    return { shortId: lineageId ? lineageId.slice(0, 8) : null };
  }

  const version =
    lineage.versions.find((entry) => entry.versionId === lineage.currentVersionId)
    ?? lineage.versions[lineage.versions.length - 1];
  const terms = version?.terms;
  const alliance = ctx.gameState.getAlliance(lineage.allianceId);
  const memberIds = terms?.memberIds ?? alliance?.memberIds ?? [];
  const memberNames = memberIds.map((id) => ctx.gameState.getPlayerName(id));
  return {
    allianceName: terms?.name ?? alliance?.name ?? null,
    memberNames,
    shortId: lineage.id.slice(0, 8),
  };
}

function emitAllianceActionTurn(
  ctx: PhaseRunnerContext,
  playerId: UUID,
  action: AllianceAction,
  pass: number,
  result: string,
  repairNotes: string[],
  phase: Phase.FORMAT_MINGLE,
): void {
  const player = ctx.gameState.getPlayer(playerId);
  const playerName = player?.name ?? playerId;
  const operatorContext = resolveAllianceActionOperatorContext(ctx, action);
  const {
    strategy: _strategy,
    strategyDelta: _strategyDelta,
    strategyCandidateProposed: _strategyCandidateProposed,
    ...normalizedAction
  } = action;
  ctx.logger.emitAgentTurn({
    phase,
    action: "alliance-action",
    actor: { id: playerId, name: playerName, role: "player" },
    visibility: "private",
    response: {
      pass,
      requestedAction: action.action,
      normalizedAction,
      result,
      repairNotes,
      // Operator-facing identity (also useful in turns JSONL / MCP).
      allianceName: operatorContext.allianceName ?? null,
      memberNames: operatorContext.memberNames ?? [],
      shortId: operatorContext.shortId ?? null,
      ...actionDecision(action),
    },
    thinking: action.thinking,
    reasoningContext: action.reasoningContext,
    text: formatAllianceActionOperatorText(playerName, action, result, operatorContext),
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
  if (action.action === "propose" || action.action === "amend" || action.action === "pass") return null;
  return "Only propose, amend, or pass is legal during a proposer opportunity.";
}

function validateProposalResponseAction(
  action: AllianceAction,
  lineageId: UUID,
  counterAllowed: boolean,
): string | null {
  if (action.action === "pass") return null;
  if (
    action.action === "accept"
    || action.action === "decline"
    || action.action === "defer"
    || action.action === "trial"
    || action.action === "counter"
  ) {
    if (action.action === "counter" && !counterAllowed) {
      return "Alliance counter rejected because the counter cap was reached.";
    }
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
  phase: Phase.FORMAT_MINGLE,
): Promise<void> {
  const askedByVersion = new Map<UUID, Set<UUID>>();

  while (true) {
    const lineage = ctx.gameState.getAllianceProposalLineage(lineageId);
    if (!lineage || lineage.status !== "open") return;

    const version = currentLineageVersion(lineage);
    if (!version) {
      ctx.gameState.expireAllianceProposal(lineageId, { phase });
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
      ctx.gameState.expireAllianceProposal(lineageId, { phase });
      return;
    }

    const counterAllowed = ctx.gameState.canCounterAllianceProposal(lineageId);
    const action = await collectAllianceAction(ctx, responder.id, phase, {
      kind: "response",
      lineageId,
      versionId: version.versionId,
      counterAllowed,
      terms: {
        name: version.terms.name,
        memberNames: version.terms.memberIds.map((memberId) => ctx.gameState.getPlayerName(memberId)),
        purpose: version.terms.purpose,
        timebox: version.terms.timebox,
      },
    });
    askedIds.add(responder.id);
    const modeError = validateProposalResponseAction(action, lineageId, counterAllowed);
    if (modeError) {
      await assertCanAcceptCommit(ctx);
      resolveActionStrategyCandidate(ctx.agents.get(responder.id)!, action, false);
      emitAllianceActionTurn(ctx, responder.id, action, step.value, "rejected", [modeError], phase);
      step.value += 1;
      continue;
    }

    const result = await applyAllianceAction(ctx, responder.id, action, step.value, phase);
    emitAllianceActionTurn(ctx, responder.id, action, step.value, result.result, result.repairNotes, phase);
    step.value += 1;
  }
}

type AllianceHuddlePhase = Phase.FORMAT_MINGLE | Phase.PRE_VOTE_HUDDLE | Phase.PRE_COUNCIL_HUDDLE;

function huddleWindowForPhase(phase: AllianceHuddlePhase): AllianceHuddleWindow {
  if (phase === Phase.FORMAT_MINGLE) return "format";
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
  phase: AllianceHuddlePhase,
  schedule: AllianceHuddleScheduleRecord,
): void {
  const alliance = ctx.gameState.getAlliance(schedule.allianceId);
  const allianceName = alliance?.name ?? schedule.allianceId;
  const memberNames = allianceMemberNames(ctx, schedule.memberIds);
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
    text: formatAllianceHuddleScheduleOperatorText({
      decision: schedule.decision,
      allianceName,
      memberNames,
      rationale: schedule.rationale,
    }),
  });
}

async function collectAllianceHuddleTurn(
  ctx: PhaseRunnerContext,
  speakerId: UUID,
  huddle: AllianceHuddlePromptContext,
  conversationHistory: Array<{ from: string; text: string }>,
): Promise<AllianceHuddleTurnAction | null> {
  const agent = ctx.agents.get(speakerId)!;
  if (!agent.getAllianceHuddleTurn) {
    return null;
  }

  const phase = huddle.window === "format"
    ? Phase.FORMAT_MINGLE
    : huddle.window === "pre_vote"
      ? Phase.PRE_VOTE_HUDDLE
      : Phase.PRE_COUNCIL_HUDDLE;
  const phaseCtx = prepareAgentPhaseContext(
    ctx,
    agent,
    speakerId,
    phase,
    "ordinary_speech",
    {
      empoweredId: ctx.gameState.empoweredId ?? undefined,
      councilCandidates: ctx.gameState.councilCandidates ?? undefined,
    },
  );
  try {
    return await agent.getAllianceHuddleTurn(phaseCtx, huddle, conversationHistory);
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return {
      message: null,
      noReply: true,
      factAtoms: [],
      providerAbsence: {
        kind: "provider_exhausted",
        outcome: error.outcome.kind,
      },
    };
  }
}

async function completeHuddleSession(
  ctx: PhaseRunnerContext,
  phase: AllianceHuddlePhase,
  alliance: AllianceRecord,
  schedule: AllianceHuddleScheduleRecord,
): Promise<void> {
  const speakerIds = schedule.memberIds.filter((memberId) => ctx.gameState.getPlayer(memberId)?.status === "alive");
  const conversationHistory: Array<{ from: string; text: string }> = [];
  const facts: AllianceHuddleFactAtom[] = [];
  // Canonical session identity is created before any message so modern huddle
  // rows carry alliance/schedule/session IDs plus exact session-time audience.
  const sessionId = deterministicHuddleId([
    "alliance-huddle-session-v1",
    ctx.gameState.gameId,
    schedule.round,
    schedule.window,
    alliance.id,
    schedule.pass,
  ]);
  const huddle: AllianceHuddlePromptContext = {
    sessionId,
    allianceId: alliance.id,
    allianceName: alliance.name,
    memberIds: [...speakerIds],
    memberNames: allianceMemberNames(ctx, speakerIds),
    purpose: alliance.purpose,
    timebox: alliance.timebox,
    window: schedule.window,
    scheduleId: schedule.id,
    pass: schedule.pass,
    priorFacts: facts,
  };
  const huddleMessageContext = {
    allianceId: alliance.id,
    scheduleId: schedule.id,
    sessionId,
    window: schedule.window,
    sessionAudiencePlayerIds: speakerIds,
  };
  for (const [speakerOrdinal, speakerId] of speakerIds.entries()) {
    const turn = await collectAllianceHuddleTurn(ctx, speakerId, huddle, conversationHistory);
    if (!turn || turn.providerAbsence) continue;
    await assertCanAcceptCommit(ctx);
    const message = turn.noReply ? null : (turn.message?.trim() || null);
    facts.push(...turn.factAtoms.map((fact, factOrdinal) => ({
      ...fact,
      factId: deterministicHuddleId([
        "alliance-huddle-fact-v1",
        sessionId,
        speakerId,
        speakerOrdinal,
        factOrdinal,
        fact.kind,
        "actionKind" in fact ? fact.actionKind : null,
        "targetPlayerId" in fact ? fact.targetPlayerId : null,
      ]),
      sessionId,
    })));
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
    resolveActionStrategyCandidate(
      ctx.agents.get(speakerId)!,
      turn,
      turn.strategyGameplayAccepted !== false,
    );
    const speakerName = ctx.gameState.getPlayerName(speakerId);
    ctx.logger.emitAgentTurn({
      phase,
      action: "alliance-huddle-turn",
      actor: { id: speakerId, name: speakerName, role: "player" },
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
      text: formatAllianceHuddleTurnOperatorText({
        playerName: speakerName,
        allianceName: alliance.name,
        message,
      }),
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
    facts,
  });
  const outcome: AllianceHuddleOutcome = {
    id: deterministicHuddleId(["alliance-huddle-outcome-v1", sessionId]),
    sessionId: session.id,
    allianceId: alliance.id,
    window: schedule.window,
    round: schedule.round,
    facts,
    // Immutable session participant snapshot — not current alliance membership.
    participantPlayerIds: [...speakerIds],
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
      interpretation: {
        ask: summary.ask,
        plan: summary.plan,
        promises: summary.promises,
        dissent: summary.dissent,
        confidence: summary.confidence,
        posture: summary.posture,
        leakOrBetrayalClaims: summary.leakOrBetrayalClaims,
      },
    },
    thinking: summary.thinking,
    reasoningContext: summary.reasoningContext,
    scope: "huddle",
    text: formatAllianceHuddleOutcomeOperatorText({
      allianceName: alliance.name,
      factSummaries: formatAllianceHuddleFacts(
        outcome.facts,
        (playerId) => ctx.gameState.getPlayerName(playerId),
      ),
    }),
  });
}

export async function runAllianceFormationPhase(
  ctx: PhaseRunnerContext,
): Promise<void> {
  const phase = Phase.FORMAT_MINGLE;
  const { gameState, logger } = ctx;
  logger.emitPhaseChange(phase);
  logger.logSystem("=== NAMED ALLIANCE ACTIONS ===", phase);

  await assertCanAcceptCommit(ctx);
  gameState.closeUniversalAlliancesBeforeMingle(phase);

  const livingPlayers = gameState.getAlivePlayers();
  const proposerBudget = Math.ceil(livingPlayers.length / 4);
  const activeAlliances = gameState.getAllianceRecords().filter((alliance) => alliance.status === "active");
  const candidates: HouseAllianceProposerCandidate[] = livingPlayers.map((player) => ({
    playerId: player.id,
    playerName: player.name,
    activeAllianceCount: activeAlliances.filter((alliance) => alliance.memberIds.includes(player.id)).length,
  }));
  const candidateById = new Map(candidates.map((candidate) => [candidate.playerId, candidate]));
  let housePlan: HouseAllianceProposerSelectionResult;
  try {
    housePlan = await ctx.houseInterviewer.selectAllianceProposers({
      round: gameState.round,
      phase,
      budget: proposerBudget,
      candidates,
    });
  } catch (error) {
    if (!isProviderFallbackEligible(error)) throw error;
    housePlan = {
      selected: [],
      rationale: `House proposer selection failed; deterministic repair applied (${error instanceof Error ? error.message : String(error)}).`,
    };
  }

  const repairNotes: string[] = [];
  const finalizedRationaleById = new Map<UUID, string>();
  for (const item of housePlan.selected) {
    const candidate = candidateById.get(item.playerId);
    if (!candidate) {
      const knownPlayer = gameState.getPlayer(item.playerId);
      repairNotes.push(knownPlayer
        ? `Eliminated or otherwise ineligible House selection dropped: ${item.playerId}.`
        : `Unknown House selection dropped: ${item.playerId}.`);
      continue;
    }
    if (finalizedRationaleById.has(item.playerId)) {
      repairNotes.push(`Duplicate House selection dropped: ${item.playerId}.`);
      continue;
    }
    if (finalizedRationaleById.size >= proposerBudget) {
      repairNotes.push(`Excess House selection dropped after the ${proposerBudget}-player budget was filled: ${item.playerId}.`);
      continue;
    }
    finalizedRationaleById.set(item.playerId, item.rationale);
  }

  if (finalizedRationaleById.size < proposerBudget) {
    const repairCandidates = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !finalizedRationaleById.has(candidate.playerId))
      .sort((left, right) =>
        left.candidate.activeAllianceCount - right.candidate.activeAllianceCount || left.index - right.index,
      );
    for (const { candidate } of repairCandidates) {
      if (finalizedRationaleById.size >= proposerBudget) break;
      finalizedRationaleById.set(
        candidate.playerId,
        `Deterministic repair selected ${candidate.playerName} with ${candidate.activeAllianceCount} active alliance${candidate.activeAllianceCount === 1 ? "" : "s"}.`,
      );
      repairNotes.push(`Underrepresentation-first repair added ${candidate.playerId}.`);
    }
  }

  const finalizedPlayers = livingPlayers.filter((player) => finalizedRationaleById.has(player.id));
  await assertCanAcceptCommit(ctx);
  logger.emitAgentTurn({
    phase,
    action: "alliance-proposer-selection",
    actor: { name: "The House", role: "house" },
    visibility: "private",
    response: {
      budget: proposerBudget,
      selected: finalizedPlayers.map((player) => {
        const candidate = candidateById.get(player.id)!;
        return {
          playerId: player.id,
          playerName: player.name,
          activeAllianceCount: candidate.activeAllianceCount,
          rationale: finalizedRationaleById.get(player.id)!,
        };
      }),
      rationale: housePlan.rationale ?? "The House selected scarce proposer access for this alliance-action window.",
      repairNotes,
    },
    thinking: housePlan.thinking,
    reasoningContext: housePlan.reasoningContext,
    text: `The House selected ${finalizedPlayers.map((player) => player.name).join(", ") || "no players"} for ${proposerBudget} proposer opportunit${proposerBudget === 1 ? "y" : "ies"}.`,
  });

  const step = { value: 1 };
  for (const player of finalizedPlayers) {
    const action = await collectAllianceAction(ctx, player.id, phase, { kind: "proposer" });
    const modeError = validateProposerAction(action);
    if (modeError) {
      await assertCanAcceptCommit(ctx);
      resolveActionStrategyCandidate(ctx.agents.get(player.id)!, action, false);
      emitAllianceActionTurn(ctx, player.id, action, step.value, "rejected", [modeError], phase);
      step.value += 1;
      continue;
    }

    const beforeLineageIds = new Set(gameState.getAllianceProposalLineages().map((lineage) => lineage.id));
    const result = await applyAllianceAction(ctx, player.id, action, step.value, phase);
    emitAllianceActionTurn(ctx, player.id, action, step.value, result.result, result.repairNotes, phase);
    step.value += 1;

    if ((action.action !== "propose" && action.action !== "amend") || !result.changed) continue;
    const lineageId = action.action === "propose"
      ? action.lineageId ?? newestLineageId(beforeLineageIds, gameState.getAllianceProposalLineages())
      : newestLineageId(beforeLineageIds, gameState.getAllianceProposalLineages());
    if (lineageId) await resolveAllianceProposalTransaction(ctx, lineageId, step, phase);
  }

  for (const lineage of gameState.getAllianceProposalLineages()) {
    if (lineage.status === "open") {
      await assertCanAcceptCommit(ctx);
      gameState.expireAllianceProposal(lineage.id, { phase });
    }
  }
}

export async function runAllianceHuddleWindow(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  phase: AllianceHuddlePhase,
): Promise<void> {
  const label = phase === Phase.FORMAT_MINGLE
    ? "POST-FORMAT ALLIANCE HUDDLES"
    : phase === Phase.PRE_VOTE_HUDDLE
      ? "PRE-VOTE ALLIANCE HUDDLES"
      : "PRE-COUNCIL ALLIANCE HUDDLES";
  ctx.logger.emitPhaseChange(phase);
  ctx.logger.logSystem(`=== ${label} ===`, phase);

  ctx.gameState.closeUniversalAlliancesBeforeMingle(phase);
  const eligible = ctx.gameState.getHuddleEligibleAlliances();
  const budget = huddleBudget(ctx.gameState.getAlivePlayers().length);
  const window = huddleWindowForPhase(phase);
  if (eligible.length === 0) {
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return;
  }
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
