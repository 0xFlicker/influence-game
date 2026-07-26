import type {
  CanonicalGameEvent,
  FormatResolutionPayload,
} from "./canonical-events";
import type { LaunchFormatId } from "./formats";
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
      return { ...base, type: event.type, payload: projectFormatResolution(event.payload) };
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

function projectFormatResolution(payload: FormatResolutionPayload): ViewerFormatResolutionPayload {
  return {
    formatId: payload.formatId,
    empoweredId: payload.empoweredId,
    eliminatedId: payload.eliminatedId,
    resolutionKind: payload.resolutionKind,
    tiedPlayerIds: [...payload.tiedPlayerIds],
    tiebreakerId: payload.tiebreakerId,
    saveOrEliminate: payload.saveOrEliminate
      ? {
          nets: copyRecord(payload.saveOrEliminate.nets),
          savesReceived: copyRecord(payload.saveOrEliminate.savesReceived),
          eliminateReceived: copyRecord(payload.saveOrEliminate.eliminateReceived),
        }
      : null,
    voteBomb: payload.voteBomb
      ? {
          totals: copyRecord(payload.voteBomb.totals),
          zeroSafePlayerIds: [...payload.voteBomb.zeroSafePlayerIds],
        }
      : null,
    safetyBounce: payload.safetyBounce
      ? {
          starterId: payload.safetyBounce.starterId,
          safePlayerIds: [...payload.safetyBounce.safePlayerIds],
          vulnerablePlayerIds: [...payload.safetyBounce.vulnerablePlayerIds],
          voteTotals: copyRecord(payload.safetyBounce.voteTotals),
        }
      : null,
  };
}

function copyRecord<T>(record: Record<UUID, T>): Record<UUID, T> {
  return { ...record };
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

    if (event.type === "format.resolved" && event.payload.safetyBounce) {
      resolved = event;
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

function validateSafetyBounceResolution(input: {
  resolved: Extract<CanonicalGameEvent, { type: "format.resolved" }>;
  starterId: UUID | null;
  safePlayerIds: readonly UUID[];
  vulnerablePlayerIds: readonly UUID[];
  benchPlayerIds: readonly UUID[];
  diagnostics: SafetyBouncePrefixDiagnostic[];
}): void {
  const payload = input.resolved.payload.safetyBounce;
  if (!payload) return;

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
