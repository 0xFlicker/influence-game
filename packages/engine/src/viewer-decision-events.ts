import type {
  CanonicalGameEvent,
  FormatResolutionAggregate,
} from "./canonical-events";
import {
  computeSaveOrEliminateNets,
  formatResolutionAggregate,
  getFormatRegistration,
  type FormatEliminationResolution,
  type LaunchFormatId,
} from "./formats";
import type { Phase, PowerAction, UUID } from "./types";

/**
 * Viewer-safe accepted decisions. This is deliberately narrower than a
 * canonical envelope: raw source pointers, visibility, producer evidence, and
 * decision/cognition metadata stay on the canonical event only.
 */
export interface ViewerDecisionEventBase<
  TType extends ViewerDecisionEventType,
  TPayload extends object,
> {
  sequence: number;
  timestamp: string;
  round: number;
  phase: Phase | null;
  type: TType;
  payload: TPayload;
}

export type ViewerDecisionEventType =
  | "vote.cast"
  | "vote.empower_tally_resolved"
  | "vote.empower_revote_cast"
  | "vote.empower_vote_cleared"
  | "vote.empowered_set"
  | "format.menu_offered"
  | "format.selected"
  | "format.ballot_cast"
  | "format.safety_bounce_started"
  | "format.safety_bounce_pointer"
  | "format.resolved"
  | "power.action_set"
  | "power.candidates_resolved"
  | "council.vote_cast"
  | "council.elimination_resolved";

export type ViewerDecisionEvent =
  | ViewerDecisionEventBase<
      "vote.cast",
      { voterId: UUID; empowerTarget: UUID; exposeTarget?: UUID | null }
    >
  | ViewerDecisionEventBase<
      "vote.empower_tally_resolved",
      {
        counts: Record<UUID, number>;
        empowered: UUID;
        tied: UUID[] | null;
        method: "plurality" | "tie_pending" | "wheel";
        cumulativeEmpowerVotes: Record<UUID, number>;
      }
    >
  | ViewerDecisionEventBase<"vote.empower_revote_cast", { voterId: UUID; target: UUID }>
  | ViewerDecisionEventBase<"vote.empower_vote_cleared", { voterId: UUID }>
  | ViewerDecisionEventBase<
      "vote.empowered_set",
      { empowered: UUID; method: "initial" | "revote" | "wheel" | "manual" }
    >
  | ViewerDecisionEventBase<
      "format.menu_offered",
      { empoweredId: UUID; offeredFormatIds: [LaunchFormatId, LaunchFormatId] }
    >
  | ViewerDecisionEventBase<"format.selected", { empoweredId: UUID; formatId: LaunchFormatId }>
  | ViewerDecisionEventBase<
      "format.ballot_cast",
      { formatId: LaunchFormatId; voterId: UUID; targetId: UUID; polarity: "save" | "eliminate" | null }
    >
  | ViewerDecisionEventBase<"format.safety_bounce_started", { starterId: UUID }>
  | ViewerDecisionEventBase<
      "format.safety_bounce_pointer",
      { actorId: UUID; targetId: UUID; classification: "safe" | "vulnerable" }
    >
  | ViewerDecisionEventBase<"format.resolved", ViewerFormatResolutionPayload>
  | ViewerDecisionEventBase<"power.action_set", { action: PowerAction }>
  | ViewerDecisionEventBase<
      "power.candidates_resolved",
      {
        exposeScores: Record<UUID, number>;
        candidates: [UUID, UUID] | null;
        autoEliminated: UUID | null;
        shieldGranted: UUID | null;
        method:
          | "two_player"
          | "auto_eliminate"
          | "expose_scores"
          | "exposure_bench"
          | "exposure_bench_protect"
          | "insufficient_candidates";
      }
    >
  | ViewerDecisionEventBase<"council.vote_cast", { voterId: UUID; target: UUID }>
  | ViewerDecisionEventBase<
      "council.elimination_resolved",
      {
        empoweredId: UUID;
        candidates: [UUID, UUID];
        tally: { votes: Record<UUID, UUID> };
        eliminated: UUID;
        method: "plurality" | "empowered_tiebreaker" | "random_tiebreaker";
      }
    >;

const VIEWER_DECISION_EVENT_TYPES = new Set<string>([
  "vote.cast",
  "vote.empower_tally_resolved",
  "vote.empower_revote_cast",
  "vote.empower_vote_cleared",
  "vote.empowered_set",
  "format.menu_offered",
  "format.selected",
  "format.ballot_cast",
  "format.safety_bounce_started",
  "format.safety_bounce_pointer",
  "format.resolved",
  "power.action_set",
  "power.candidates_resolved",
  "council.vote_cast",
  "council.elimination_resolved",
]);

export type ViewerFormatResolutionPayload = {
  formatId: LaunchFormatId;
  empoweredId: UUID;
  eliminatedId: UUID;
  resolutionKind: "clear" | "auto";
  tiedPlayerIds: UUID[];
  tiebreakerId: UUID | null;
  /** Version-2 capability aggregate; historical bags remain for v1 presentation. */
  aggregate?: FormatResolutionAggregate;
  saveOrEliminate: {
    nets: Record<UUID, number>;
    savesReceived: Record<UUID, number>;
    eliminateReceived: Record<UUID, number>;
  } | null;
  voteBomb: {
    totals: Record<UUID, number>;
    zeroSafePlayerIds: UUID[];
  } | null;
  safetyBounce: {
    starterId: UUID;
    safePlayerIds: UUID[];
    vulnerablePlayerIds: UUID[];
    voteTotals: Record<UUID, number>;
  } | null;
};

export type FormatBallotPresentationStatus =
  | "sealed"
  | "revealed"
  | "not_applicable"
  | "unavailable";

export interface ProjectedFormatBallotEntry {
  voterId: UUID;
  targetId: UUID;
  polarity: "save" | "eliminate" | null;
}

export interface ProjectedFormatBallotPresentation {
  status: FormatBallotPresentationStatus;
  rollCall: ProjectedFormatBallotEntry[];
}

export interface ProjectFormatBallotPresentationOptions {
  events: readonly CanonicalGameEvent[];
  round: number;
  /** Canonical roster order, narrowed to agents eligible to vote in this round. */
  eligibleVoterIds: readonly UUID[];
  /** Frozen manifest when the caller projects a round-only event slice. */
  formatManifest?: readonly LaunchFormatId[];
}

/**
 * Projects one canonical event into an allowlisted viewer decision, or null
 * when the event is not a decision the watch/replay contract publishes.
 */
export function projectViewerDecisionEvent(
  event: CanonicalGameEvent,
): ViewerDecisionEvent | null {
  if (!VIEWER_DECISION_EVENT_TYPES.has(event.type)) return null;
  const base = viewerEventBase(event);

  switch (event.type) {
    case "vote.cast":
      return {
        ...base,
        type: event.type,
        payload: {
          voterId: event.payload.voterId,
          empowerTarget: event.payload.empowerTarget,
          ...(event.payload.exposeTarget !== undefined ? { exposeTarget: event.payload.exposeTarget } : {}),
        },
      };
    case "vote.empower_tally_resolved":
      return {
        ...base,
        type: event.type,
        payload: {
          counts: copyRecord(event.payload.counts),
          empowered: event.payload.empowered,
          tied: event.payload.tied ? [...event.payload.tied] : null,
          method: event.payload.method,
          cumulativeEmpowerVotes: copyRecord(event.payload.cumulativeEmpowerVotes),
        },
      };
    case "vote.empower_revote_cast":
      return {
        ...base,
        type: event.type,
        payload: { voterId: event.payload.voterId, target: event.payload.target },
      };
    case "vote.empower_vote_cleared":
      return { ...base, type: event.type, payload: { voterId: event.payload.voterId } };
    case "vote.empowered_set":
      return {
        ...base,
        type: event.type,
        payload: { empowered: event.payload.empowered, method: event.payload.method },
      };
    case "format.menu_offered":
      return {
        ...base,
        type: event.type,
        payload: {
          empoweredId: event.payload.empoweredId,
          offeredFormatIds: [...event.payload.offeredFormatIds] as [LaunchFormatId, LaunchFormatId],
        },
      };
    case "format.selected":
      return {
        ...base,
        type: event.type,
        payload: { empoweredId: event.payload.empoweredId, formatId: event.payload.formatId },
      };
    case "format.ballot_cast":
      return {
        ...base,
        type: event.type,
        payload: {
          formatId: event.payload.formatId,
          voterId: event.payload.voterId,
          targetId: event.payload.targetId,
          polarity: event.payload.polarity,
        },
      };
    case "format.safety_bounce_started":
      return { ...base, type: event.type, payload: { starterId: event.payload.starterId } };
    case "format.safety_bounce_pointer":
      return {
        ...base,
        type: event.type,
        payload: {
          actorId: event.payload.actorId,
          targetId: event.payload.targetId,
          classification: event.payload.classification,
        },
      };
    case "format.resolved":
      return { ...base, type: event.type, payload: projectFormatResolution(event) };
    case "power.action_set":
      return {
        ...base,
        type: event.type,
        payload: {
          action: {
            action: event.payload.action.action,
            target: event.payload.action.target,
          },
        },
      };
    case "power.candidates_resolved":
      return {
        ...base,
        type: event.type,
        payload: {
          exposeScores: copyRecord(event.payload.exposeScores),
          candidates: event.payload.candidates ? [...event.payload.candidates] as [UUID, UUID] : null,
          autoEliminated: event.payload.autoEliminated,
          shieldGranted: event.payload.shieldGranted,
          method: event.payload.method,
        },
      };
    case "council.vote_cast":
      return {
        ...base,
        type: event.type,
        payload: { voterId: event.payload.voterId, target: event.payload.target },
      };
    case "council.elimination_resolved":
      return {
        ...base,
        type: event.type,
        payload: {
          empoweredId: event.payload.empoweredId,
          candidates: [...event.payload.candidates] as [UUID, UUID],
          tally: { votes: copyRecord(event.payload.tally.votes) },
          eliminated: event.payload.eliminated,
          method: event.payload.method,
        },
      };
    default:
      return null;
  }
}

function viewerEventBase(event: CanonicalGameEvent): Omit<ViewerDecisionEvent, "type" | "payload"> {
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    round: event.round,
    phase: event.phase,
  };
}

function projectFormatResolution(
  event: Extract<CanonicalGameEvent, { type: "format.resolved" }>,
): ViewerFormatResolutionPayload {
  const payload = event.payload;
  const aggregate = formatResolutionAggregate(event);
  return {
    formatId: payload.formatId,
    empoweredId: payload.empoweredId,
    eliminatedId: payload.eliminatedId,
    resolutionKind: payload.resolutionKind,
    tiedPlayerIds: [...payload.tiedPlayerIds],
    tiebreakerId: payload.tiebreakerId,
    aggregate: cloneResolutionAggregate(aggregate),
    saveOrEliminate: aggregate.capability === "sealed_polarity"
      ? {
          nets: copyRecord(aggregate.nets),
          savesReceived: copyRecord(aggregate.savesReceived),
          eliminateReceived: copyRecord(aggregate.eliminateReceived),
        }
      : null,
    voteBomb: payload.formatId === "vote_bomb" && aggregate.capability === "sealed_elim"
      ? {
          totals: copyRecord(aggregate.totals),
          zeroSafePlayerIds: Object.keys(aggregate.totals).filter(
            (id) => !aggregate.eligiblePlayerIds.includes(id),
          ),
        }
      : null,
    safetyBounce: aggregate.capability === "public_chain"
      ? {
          starterId: aggregate.starterId,
          safePlayerIds: [...aggregate.safePlayerIds],
          vulnerablePlayerIds: [...aggregate.vulnerablePlayerIds],
          voteTotals: copyRecord(aggregate.voteTotals),
        }
      : null,
  };
}

function cloneResolutionAggregate(
  aggregate: FormatResolutionAggregate,
): FormatResolutionAggregate {
  if (aggregate.capability === "sealed_elim") {
    return {
      capability: "sealed_elim",
      totals: copyRecord(aggregate.totals),
      eligiblePlayerIds: [...aggregate.eligiblePlayerIds],
    };
  }
  if (aggregate.capability === "sealed_polarity") {
    return {
      capability: "sealed_polarity",
      nets: copyRecord(aggregate.nets),
      savesReceived: copyRecord(aggregate.savesReceived),
      eliminateReceived: copyRecord(aggregate.eliminateReceived),
    };
  }
  return {
    capability: "public_chain",
    starterId: aggregate.starterId,
    safePlayerIds: [...aggregate.safePlayerIds],
    vulnerablePlayerIds: [...aggregate.vulnerablePlayerIds],
    voteTotals: copyRecord(aggregate.voteTotals),
  };
}

function copyRecord<T>(record: Record<UUID, T>): Record<UUID, T> {
  return { ...record };
}

/**
 * Builds the phase-end ballot presentation from the existing accepted ballot
 * events. Accepted ballot transport remains independent: this projection gates
 * only the roster-ordered roll call drawn after a trusted resolution.
 */
export function projectFormatBallotPresentation(
  options: ProjectFormatBallotPresentationOptions,
): ProjectedFormatBallotPresentation {
  const events = options.events.filter((event) => event.round === options.round);
  const menus = eventsOfType(events, "format.menu_offered");
  const selections = eventsOfType(events, "format.selected");
  const ballots = eventsOfType(events, "format.ballot_cast");
  const resolutions = eventsOfType(events, "format.resolved");
  const selected = selections.at(-1) ?? null;
  const resolved = resolutions.at(-1) ?? null;
  const roster = options.events.find(
    (event): event is Extract<CanonicalGameEvent, { type: "game.roster_initialized" }> =>
      event.type === "game.roster_initialized",
  );

  if (!selected && !resolved && ballots.length === 0) {
    return ballotPresentation("not_applicable");
  }
  if (
    selections.length !== 1
    || !selected
    || !selectionMatchesMenuOrManifest(
      menus,
      selected,
      options.formatManifest ?? roster?.payload.formatManifest,
    )
  ) {
    return ballotPresentation("unavailable");
  }
  if (!validAcceptedBallots(ballots, selected.payload.formatId, options.eligibleVoterIds)) {
    return ballotPresentation("unavailable");
  }
  if (!resolved) {
    return ballotPresentation("sealed");
  }
  if (
    resolutions.length !== 1
    || resolved.payload.formatId !== selected.payload.formatId
    || resolved.payload.empoweredId !== selected.payload.empoweredId
    || !validResolutionShape(resolved)
  ) {
    return ballotPresentation("unavailable");
  }

  const bouncePrefix = resolved.payload.formatId === "safety_bounce"
    ? reconstructSafetyBouncePrefix({
        roster: options.eligibleVoterIds.map((id) => ({ id })),
        events,
      })
    : null;
  if (bouncePrefix?.diagnostics.length) {
    return ballotPresentation("unavailable");
  }
  if (soleVulnerableSafetyBounce(resolved, ballots)) {
    return ballotPresentation("not_applicable");
  }

  if (
    ballots.length !== options.eligibleVoterIds.length
    || !aggregateMatchesBallots(resolved, ballots, options.eligibleVoterIds)
  ) {
    return ballotPresentation("unavailable");
  }

  const byVoter = new Map(ballots.map((event) => [event.payload.voterId, event.payload]));
  return {
    status: "revealed",
    rollCall: options.eligibleVoterIds.map((voterId) => {
      const ballot = byVoter.get(voterId)!;
      return {
        voterId,
        targetId: ballot.targetId,
        polarity: ballot.polarity,
      };
    }),
  };
}

function selectionMatchesMenuOrManifest(
  menus: readonly Extract<CanonicalGameEvent, { type: "format.menu_offered" }>[],
  selected: Extract<CanonicalGameEvent, { type: "format.selected" }>,
  formatManifest: readonly LaunchFormatId[] | undefined,
): boolean {
  if (menus.length === 1) return menuMatchesSelection(menus[0]!, selected);
  return menus.length === 0
    && formatManifest?.length === 1
    && formatManifest[0] === selected.payload.formatId;
}

function ballotPresentation(
  status: Exclude<FormatBallotPresentationStatus, "revealed">,
): ProjectedFormatBallotPresentation {
  return { status, rollCall: [] };
}

function menuMatchesSelection(
  menu: Extract<CanonicalGameEvent, { type: "format.menu_offered" }>,
  selected: Extract<CanonicalGameEvent, { type: "format.selected" }>,
): boolean {
  return menu.payload.empoweredId === selected.payload.empoweredId
    && menu.payload.offeredFormatIds.includes(selected.payload.formatId);
}

function validAcceptedBallots(
  ballots: readonly Extract<CanonicalGameEvent, { type: "format.ballot_cast" }>[],
  formatId: LaunchFormatId,
  eligibleVoterIds: readonly UUID[],
): boolean {
  const eligible = new Set(eligibleVoterIds);
  const voters = new Set<UUID>();
  for (const ballot of ballots) {
    const payload = ballot.payload;
    if (
      payload.formatId !== formatId
      || !eligible.has(payload.voterId)
      || !eligible.has(payload.targetId)
      || voters.has(payload.voterId)
    ) {
      return false;
    }
    if (
      (formatId === "save_or_eliminate" && payload.polarity === null)
      || (formatId !== "save_or_eliminate" && payload.polarity !== null)
    ) {
      return false;
    }
    voters.add(payload.voterId);
  }
  return true;
}

function validResolutionShape(
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>,
): boolean {
  return getFormatRegistration(resolved.payload.formatId).capability
    === formatResolutionAggregate(resolved).capability;
}

function soleVulnerableSafetyBounce(
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>,
  ballots: readonly Extract<CanonicalGameEvent, { type: "format.ballot_cast" }>[],
): boolean {
  const aggregate = formatResolutionAggregate(resolved);
  return resolved.payload.formatId === "safety_bounce"
    && aggregate.capability === "public_chain"
    && resolved.payload.resolutionKind === "auto"
    && aggregate.vulnerablePlayerIds.length === 1
    && aggregate.vulnerablePlayerIds[0] === resolved.payload.eliminatedId
    && Object.keys(aggregate.voteTotals).length === 0
    && ballots.length === 0;
}

function aggregateMatchesBallots(
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>,
  ballots: readonly Extract<CanonicalGameEvent, { type: "format.ballot_cast" }>[],
  eligibleVoterIds: readonly UUID[],
): boolean {
  const eligible = new Set(eligibleVoterIds);
  const aggregate = formatResolutionAggregate(resolved);
  if (resolved.payload.formatId === "save_or_eliminate") {
    if (aggregate.capability !== "sealed_polarity") return false;
    const computed = computeSaveOrEliminateNets(
      eligibleVoterIds,
      ballots.map((ballot) => ({
        voterId: ballot.payload.voterId,
        targetId: ballot.payload.targetId,
        polarity: ballot.payload.polarity as "save" | "eliminate",
      })),
    );
    return countRecordMatches(aggregate.savesReceived, computed.savesReceived, eligible)
      && countRecordMatches(
        aggregate.eliminateReceived,
        computed.eliminateReceived,
        eligible,
      )
      && countRecordMatches(aggregate.nets, computed.nets, eligible);
  }
  if (aggregate.capability === "sealed_elim") {
    const registration = getFormatRegistration(resolved.payload.formatId);
    if (registration.capability !== "sealed_elim") return false;
    const sealedBallots = ballots.map((ballot) => ({
      voterId: ballot.payload.voterId,
      targetId: ballot.payload.targetId,
    }));
    const computed = registration.score(eligibleVoterIds, sealedBallots);
    return countRecordMatches(aggregate.totals, computed.totals, eligible)
      && samePlayerSet(aggregate.eligiblePlayerIds, computed.eligibleIds)
      && sealedElimOutcomeMatches(
        resolved,
        registration.resolve(eligibleVoterIds, sealedBallots),
      );
  }

  if (aggregate.capability !== "public_chain") return false;
  const bounce = aggregate;
  const vulnerable = new Set(bounce.vulnerablePlayerIds);
  if (
    bounce.vulnerablePlayerIds.some((id) => !eligible.has(id))
    || ballots.some((ballot) => !vulnerable.has(ballot.payload.targetId))
  ) {
    return false;
  }
  const totals = zeroCounts(bounce.vulnerablePlayerIds);
  for (const ballot of ballots) {
    totals[ballot.payload.targetId] = (totals[ballot.payload.targetId] ?? 0) + 1;
  }
  return countRecordMatches(bounce.voteTotals, totals, vulnerable);
}

function sealedElimOutcomeMatches(
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>,
  expected: FormatEliminationResolution,
): boolean {
  const payload = resolved.payload;
  if (!samePlayerSet(payload.tiedPlayerIds, expected.tiedSet)) return false;
  if (expected.kind === "tie") {
    return payload.resolutionKind === "clear"
      && payload.tiebreakerId === payload.empoweredId
      && expected.tiedSet.includes(payload.eliminatedId);
  }
  return payload.resolutionKind === expected.kind
    && payload.eliminatedId === expected.eliminatedId
    && payload.tiebreakerId === null;
}

function zeroCounts(ids: readonly UUID[]): Record<UUID, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]));
}

function countRecordMatches(
  actual: Record<UUID, number>,
  expected: Record<UUID, number>,
  expectedIds: ReadonlySet<UUID>,
): boolean {
  const actualIds = Object.keys(actual);
  return actualIds.length === expectedIds.size
    && actualIds.every((id) => expectedIds.has(id))
    && actualIds.every((id) => actual[id] === expected[id]);
}

function eventsOfType<TType extends CanonicalGameEvent["type"]>(
  events: readonly CanonicalGameEvent[],
  type: TType,
): Array<Extract<CanonicalGameEvent, { type: TType }>> {
  return events.filter(
    (event): event is Extract<CanonicalGameEvent, { type: TType }> => event.type === type,
  );
}

export interface SafetyBounceRosterPlayer {
  id: UUID;
}

export type SafetyBouncePrefixDiagnosticCode =
  | "safety_bounce_event_gap"
  | "safety_bounce_missing_start"
  | "safety_bounce_duplicate_start"
  | "safety_bounce_missing_roster_player"
  | "safety_bounce_invalid_actor"
  | "safety_bounce_classification_mismatch"
  | "safety_bounce_duplicate_target"
  | "safety_bounce_resolution_mismatch"
  | "safety_bounce_incomplete_at_resolution";

export interface SafetyBouncePrefixDiagnostic {
  code: SafetyBouncePrefixDiagnosticCode;
  message: string;
  sequence?: number;
}

export type SafetyBounceCompletion =
  | "in_progress"
  | "sole_vulnerable_auto_elimination"
  | "resolved_with_final_ballot"
  | "resolved_without_final_ballot";

/**
 * The event-derived state needed to stage a Safety Bounce at any trusted
 * canonical prefix. It intentionally has no transcript fallback or animation
 * details: sequence order is the decision order; clients own the choreography.
 */
export interface SafetyBouncePrefix {
  starterId: UUID | null;
  currentActorId: UUID | null;
  benchPlayerIds: UUID[];
  safePlayerIds: UUID[];
  vulnerablePlayerIds: UUID[];
  acceptedPointers: Array<{
    actorId: UUID;
    targetId: UUID;
    classification: "safe" | "vulnerable";
  }>;
  finalBallotCount: number;
  completion: SafetyBounceCompletion;
  diagnostics: SafetyBouncePrefixDiagnostic[];
}

export interface ReconstructSafetyBouncePrefixOptions {
  roster: readonly SafetyBounceRosterPlayer[];
  /** Complete ordered canonical prefix, not transcript or a best-effort subset. */
  events: readonly CanonicalGameEvent[];
}

/**
 * Reconstructs a Safety Bounce only from a trusted ordered event prefix. On an
 * invalid transition the affected event is not applied; no prose or resolution
 * aggregate is used to fill missing choices.
 */
export function reconstructSafetyBouncePrefix(
  options: ReconstructSafetyBouncePrefixOptions,
): SafetyBouncePrefix {
  const rosterIds = options.roster.map((player) => player.id);
  const roster = new Set(rosterIds);
  const diagnostics: SafetyBouncePrefixDiagnostic[] = [];
  const safePlayerIds: UUID[] = [];
  const vulnerablePlayerIds: UUID[] = [];
  const acceptedPointers: SafetyBouncePrefix["acceptedPointers"] = [];
  const classified = new Set<UUID>();
  let starterId: UUID | null = null;
  let currentActorId: UUID | null = null;
  let finalBallotCount = 0;
  let resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }> | null = null;
  let previousSequence: number | null = null;

  const addDiagnostic = (diagnostic: SafetyBouncePrefixDiagnostic): void => {
    diagnostics.push(diagnostic);
  };

  for (const event of options.events) {
    if (previousSequence !== null && event.sequence !== previousSequence + 1) {
      addDiagnostic({
        code: "safety_bounce_event_gap",
        sequence: event.sequence,
        message: `Expected canonical sequence ${previousSequence + 1}, received ${event.sequence}.`,
      });
      break;
    }
    previousSequence = event.sequence;

    if (event.type === "format.ballot_cast" && event.payload.formatId === "safety_bounce") {
      finalBallotCount += 1;
      continue;
    }

    if (event.type === "format.safety_bounce_started") {
      if (starterId !== null) {
        addDiagnostic({
          code: "safety_bounce_duplicate_start",
          sequence: event.sequence,
          message: "Safety Bounce started more than once in the same canonical prefix.",
        });
        continue;
      }
      if (!roster.has(event.payload.starterId)) {
        addDiagnostic({
          code: "safety_bounce_missing_roster_player",
          sequence: event.sequence,
          message: `Safety Bounce starter ${event.payload.starterId} is not in the canonical roster.`,
        });
        continue;
      }
      starterId = event.payload.starterId;
      currentActorId = starterId;
      safePlayerIds.push(starterId);
      classified.add(starterId);
      continue;
    }

    if (event.type === "format.safety_bounce_pointer") {
      if (starterId === null || currentActorId === null) {
        addDiagnostic({
          code: "safety_bounce_missing_start",
          sequence: event.sequence,
          message: "Safety Bounce pointer has no accepted starter to establish the current actor.",
        });
        continue;
      }
      if (!roster.has(event.payload.actorId) || !roster.has(event.payload.targetId)) {
        const missingId = !roster.has(event.payload.actorId)
          ? event.payload.actorId
          : event.payload.targetId;
        addDiagnostic({
          code: "safety_bounce_missing_roster_player",
          sequence: event.sequence,
          message: `Safety Bounce player ${missingId} is not in the canonical roster.`,
        });
        continue;
      }
      if (event.payload.actorId !== currentActorId) {
        addDiagnostic({
          code: "safety_bounce_invalid_actor",
          sequence: event.sequence,
          message: `Safety Bounce expected ${currentActorId} to choose, received ${event.payload.actorId}.`,
        });
        continue;
      }
      if (classified.has(event.payload.targetId)) {
        addDiagnostic({
          code: "safety_bounce_duplicate_target",
          sequence: event.sequence,
          message: `Safety Bounce target ${event.payload.targetId} was already classified.`,
        });
        continue;
      }
      const expectedClassification = safePlayerIds.includes(event.payload.actorId)
        ? "vulnerable"
        : "safe";
      if (event.payload.classification !== expectedClassification) {
        addDiagnostic({
          code: "safety_bounce_classification_mismatch",
          sequence: event.sequence,
          message:
            `Safety Bounce ${event.payload.actorId} is ${
              expectedClassification === "vulnerable" ? "SAFE" : "VULNERABLE"
            } and must make the target ${expectedClassification.toUpperCase()}.`,
        });
        continue;
      }

      classified.add(event.payload.targetId);
      if (event.payload.classification === "safe") {
        safePlayerIds.push(event.payload.targetId);
      } else {
        vulnerablePlayerIds.push(event.payload.targetId);
      }
      acceptedPointers.push({ ...event.payload });
      currentActorId = event.payload.targetId;
      continue;
    }

    if (event.type === "format.resolved" && event.payload.formatId === "safety_bounce") {
      if (formatResolutionAggregate(event).capability === "public_chain") {
        resolved = event;
      }
    }
  }

  const benchPlayerIds = rosterIds.filter((playerId) => !classified.has(playerId));
  if (resolved) {
    validateSafetyBounceResolution({
      resolved,
      starterId,
      safePlayerIds,
      vulnerablePlayerIds,
      benchPlayerIds,
      diagnostics,
    });
  }

  return {
    starterId,
    currentActorId,
    benchPlayerIds,
    safePlayerIds,
    vulnerablePlayerIds,
    acceptedPointers,
    finalBallotCount,
    completion: safetyBounceCompletion(resolved, vulnerablePlayerIds, finalBallotCount),
    diagnostics,
  };
}

export interface SafetyBouncePresentationCycleOptions {
  gameId: string;
  round: number;
  canonicalSequence: number;
  /** Stable canonical roster order; included in the deterministic seed. */
  rosterPlayerIds: readonly UUID[];
  /** Currently legal unclassified pointer targets. */
  eligibleCandidateIds: readonly UUID[];
  /** Accepted canonical target. Always the final returned candidate. */
  acceptedTargetId: UUID;
}

/**
 * Pure presentation-only pointer cycle. These candidates are never persisted,
 * projected as facts, or exposed as agent reasoning. The accepted canonical
 * target is withheld from intermediate positions and is always the landing.
 */
export function buildSafetyBouncePresentationCycle(
  options: SafetyBouncePresentationCycleOptions,
): UUID[] {
  const eligible = uniqueIds(options.eligibleCandidateIds).filter((id) =>
    options.rosterPlayerIds.includes(id)
  );
  if (!eligible.includes(options.acceptedTargetId)) {
    return [];
  }
  const intermediate = eligible.filter((id) => id !== options.acceptedTargetId);
  if (intermediate.length === 0) return [options.acceptedTargetId];

  let state = hashSeed([
    options.gameId,
    String(options.round),
    String(options.canonicalSequence),
    options.rosterPlayerIds.join(","),
    options.acceptedTargetId,
  ].join("|"));
  const count = Math.min(4, Math.max(2, intermediate.length));
  const cycle: UUID[] = [];
  for (let index = 0; index < count; index += 1) {
    state = xorshift32(state);
    const candidate = intermediate[state % intermediate.length]!;
    if (cycle.at(-1) !== candidate) cycle.push(candidate);
  }
  if (cycle.length === 0) cycle.push(intermediate[0]!);
  cycle.push(options.acceptedTargetId);
  return cycle;
}

function uniqueIds(ids: readonly UUID[]): UUID[] {
  return [...new Set(ids)];
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function xorshift32(value: number): number {
  let next = value >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

function validateSafetyBounceResolution(input: {
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>;
  starterId: UUID | null;
  safePlayerIds: readonly UUID[];
  vulnerablePlayerIds: readonly UUID[];
  benchPlayerIds: readonly UUID[];
  diagnostics: SafetyBouncePrefixDiagnostic[];
}): void {
  const payload = formatResolutionAggregate(input.resolved);
  if (payload.capability !== "public_chain") return;

  if (input.benchPlayerIds.length > 0) {
    input.diagnostics.push({
      code: "safety_bounce_incomplete_at_resolution",
      sequence: input.resolved.sequence,
      message: "Safety Bounce resolved before every roster player was classified.",
    });
  }
  if (
    input.starterId !== payload.starterId
    || !samePlayerSet(input.safePlayerIds, payload.safePlayerIds)
    || !samePlayerSet(input.vulnerablePlayerIds, payload.vulnerablePlayerIds)
  ) {
    input.diagnostics.push({
      code: "safety_bounce_resolution_mismatch",
      sequence: input.resolved.sequence,
      message: "Safety Bounce resolution pools do not match the accepted pointer prefix.",
    });
  }
}

function samePlayerSet(left: readonly UUID[], right: readonly UUID[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function safetyBounceCompletion(
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }> | null,
  vulnerablePlayerIds: readonly UUID[],
  finalBallotCount: number,
): SafetyBounceCompletion {
  if (!resolved) return "in_progress";
  if (
    resolved.payload.resolutionKind === "auto"
    && vulnerablePlayerIds.length === 1
    && finalBallotCount === 0
  ) {
    return "sole_vulnerable_auto_elimination";
  }
  return finalBallotCount > 0 ? "resolved_with_final_ballot" : "resolved_without_final_ballot";
}
