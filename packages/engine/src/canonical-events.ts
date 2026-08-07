import type {
  AllianceHuddleOutcome,
  AllianceHuddleScheduleRecord,
  AllianceHuddleSessionRecord,
  AllianceProposalLineage,
  AllianceProposalResponse,
  AllianceRecord,
  CouncilVoteTally,
  EndgameEliminationTally,
  EndgameStage,
  JuryMember,
  JuryVoteTally,
  Phase,
  PlayerStatus,
  PowerAction,
  RoomAllocation,
  RoundResult,
  UUID,
} from "./types";
import type { LaunchFormatId } from "./formats";
import {
  getFormatRegistration,
  isRegisteredFormatId,
} from "./formats/catalog";

export type CanonicalEventVisibility = "public" | "player" | "producer" | "system";

export type CanonicalEventQueryMode = "public" | "player" | "producer";

export type CanonicalEventSource = "engine" | "phase" | "simulator" | "replay" | "mcp";

export type CanonicalSourcePointerKind =
  | "canonical_event"
  | "transcript_entry"
  | "agent_turn"
  | "simulation_jsonl";

export interface CanonicalSourcePointer {
  kind: CanonicalSourcePointerKind;
  sequence?: number;
  eventSequence?: number;
  turnPass?: number;
  gameNumber?: number;
  file?: string;
  line?: number;
  byteOffset?: number;
  actorId?: UUID;
  action?: string;
  round?: number;
  phase?: Phase;
  /**
   * Private-decision id linking this accepted action to cognition/dialogue.
   * Forward-path only; not a public narrative of thought content.
   */
  decisionId?: UUID;
}

export type AcceptedActionCardinality = "one_to_one" | "many_to_one";

export interface AcceptedActionRegistryEntry {
  /** Action vocabulary written on the canonical source pointer. */
  sourceActions: readonly string[];
  /** Private trace action vocabulary accepted for the same direct action. */
  traceActions: readonly string[];
  /** Dot path used to validate the canonical actor when the payload has one. */
  actorPayloadPath: string | null;
  cardinality: AcceptedActionCardinality;
}

export type CanonicalGameEventType =
  | "game.roster_initialized"
  | "round.started"
  | "shields.expired"
  | "mingle.rooms_allocated"
  | "mingle.coordination_receipt_recorded"
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
  | "alliance.proposal_submitted"
  | "alliance.response_recorded"
  | "alliance.counter_submitted"
  | "alliance.activated"
  | "alliance.amendment_resolved"
  | "alliance.proposal_expired"
  | "alliance.closed"
  | "alliance.archived"
  | "alliance.huddle_scheduled"
  | "alliance.huddle_skipped"
  | "alliance.huddle_completed"
  | "alliance.huddle_outcome_recorded"
  | "council.vote_cast"
  | "council.elimination_resolved"
  | "player.last_message_recorded"
  | "player.eliminated"
  | "player.elimination_message_recorded"
  | "endgame.stage_set"
  | "endgame.elimination_vote_cast"
  | "endgame.elimination_resolved"
  | "jury.vote_cast"
  | "jury.winner_determined"
  | "judgment.speech_recorded"
  | "endgame.speech_recorded"
  | "round.result_recorded";

/**
 * Exhaustive registry of trace-bearing actions that can directly author board facts.
 * Anything absent here is intentionally not eligible for accepted-action correlation.
 */
export const ACCEPTED_ACTION_REGISTRY = {
  "vote.cast": {
    sourceActions: ["vote"],
    traceActions: ["vote"],
    actorPayloadPath: "voterId",
    cardinality: "one_to_one",
  },
  "vote.empower_revote_cast": {
    sourceActions: ["empower-revote"],
    traceActions: ["empower-revote"],
    actorPayloadPath: "voterId",
    cardinality: "one_to_one",
  },
  "format.selected": {
    sourceActions: ["format-pick"],
    traceActions: ["format-pick"],
    actorPayloadPath: "empoweredId",
    cardinality: "one_to_one",
  },
  "format.ballot_cast": {
    sourceActions: [
      "format-save-or-eliminate-ballot",
      "format-vote-bomb-ballot",
      "format-majority-elimination-ballot",
      "format-safety-bounce-vote",
    ],
    traceActions: [
      "format-save-or-eliminate-ballot",
      "format-vote-bomb-ballot",
      "format-majority-elimination-ballot",
      "format-safety-bounce-vote",
    ],
    actorPayloadPath: "voterId",
    cardinality: "one_to_one",
  },
  "format.safety_bounce_pointer": {
    sourceActions: ["bounce-pointer"],
    traceActions: ["bounce-pointer"],
    actorPayloadPath: "actorId",
    cardinality: "one_to_one",
  },
  "format.resolved": {
    sourceActions: ["format-tiebreak"],
    traceActions: ["format-tiebreak"],
    actorPayloadPath: "tiebreakerId",
    cardinality: "one_to_one",
  },
  "power.action_set": {
    sourceActions: ["power", "power-action"],
    traceActions: ["power"],
    actorPayloadPath: null,
    cardinality: "one_to_one",
  },
  "alliance.proposal_submitted": {
    sourceActions: ["alliance-action"],
    traceActions: ["alliance-action"],
    actorPayloadPath: "lineage.versions[].proposerId",
    cardinality: "one_to_one",
  },
  "alliance.response_recorded": {
    sourceActions: ["alliance-action"],
    traceActions: ["alliance-action"],
    actorPayloadPath: "playerId",
    cardinality: "one_to_one",
  },
  "alliance.counter_submitted": {
    sourceActions: ["alliance-action"],
    traceActions: ["alliance-action"],
    actorPayloadPath: "lineage.versions[].proposerId",
    cardinality: "one_to_one",
  },
  "alliance.amendment_resolved": {
    sourceActions: ["alliance-action"],
    traceActions: ["alliance-action"],
    actorPayloadPath: "lineage.versions[].proposerId",
    cardinality: "one_to_one",
  },
  "council.vote_cast": {
    sourceActions: ["council-vote"],
    traceActions: ["council-vote"],
    actorPayloadPath: "voterId",
    cardinality: "one_to_one",
  },
  "endgame.elimination_vote_cast": {
    sourceActions: ["elimination-vote"],
    traceActions: ["elimination-vote"],
    actorPayloadPath: "voterId",
    cardinality: "one_to_one",
  },
  "endgame.elimination_resolved": {
    sourceActions: ["tribunal-jury-tiebreaker-vote"],
    traceActions: ["tribunal-jury-tiebreaker-vote"],
    actorPayloadPath: null,
    cardinality: "many_to_one",
  },
  "jury.vote_cast": {
    sourceActions: ["jury-vote"],
    traceActions: ["jury-vote"],
    actorPayloadPath: "jurorId",
    cardinality: "one_to_one",
  },
} as const satisfies Partial<Record<CanonicalGameEventType, AcceptedActionRegistryEntry>>;

export function acceptedActionRegistryEntry(
  eventType: CanonicalGameEventType,
): AcceptedActionRegistryEntry | undefined {
  return ACCEPTED_ACTION_REGISTRY[eventType as keyof typeof ACCEPTED_ACTION_REGISTRY];
}

export interface AcceptedActionSourcePointerMatch {
  pointer: CanonicalSourcePointer & {
    actorId: UUID;
    action: string;
    decisionId: UUID;
  };
  registry: AcceptedActionRegistryEntry;
  traceAction: string;
}

export function acceptedActionSourcePointerMatches(
  event: CanonicalGameEvent,
): AcceptedActionSourcePointerMatch[] {
  const registry = acceptedActionRegistryEntry(event.type);
  if (!registry) return [];

  return event.sourcePointers.flatMap((pointer) => {
    if (
      pointer.kind !== "agent_turn"
      || typeof pointer.actorId !== "string"
      || pointer.actorId.length === 0
      || typeof pointer.action !== "string"
      || pointer.action.length === 0
      || typeof pointer.decisionId !== "string"
      || pointer.decisionId.length === 0
    ) {
      return [];
    }
    if (
      registry.actorPayloadPath !== null
      && !readAcceptedActionPayloadPath(
        event.payload,
        registry.actorPayloadPath,
      ).includes(pointer.actorId)
    ) {
      return [];
    }

    const traceAction = normalizeAcceptedActionTraceAction(
      registry,
      pointer.action,
    );
    return traceAction
      ? [{
          pointer: pointer as AcceptedActionSourcePointerMatch["pointer"],
          registry,
          traceAction,
        }]
      : [];
  });
}

function normalizeAcceptedActionTraceAction(
  registry: AcceptedActionRegistryEntry,
  sourceAction: string,
): string | undefined {
  const sourceIndex = registry.sourceActions.indexOf(sourceAction);
  if (sourceIndex < 0) return undefined;
  if (registry.traceActions.includes(sourceAction)) return sourceAction;
  if (registry.traceActions.length === 1) return registry.traceActions[0];
  return registry.traceActions[sourceIndex];
}

function readAcceptedActionPayloadPath(payload: unknown, path: string): unknown[] {
  let values: unknown[] = [payload];
  for (const segment of path.split(".")) {
    const arraySegment = segment.endsWith("[]");
    const key = arraySegment ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const child = (value as Record<string, unknown>)[key];
      if (arraySegment) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    values = next;
  }
  return values;
}

export type JudgmentSpeechKind =
  | "opening_statement"
  | "jury_question"
  | "jury_answer"
  | "closing_argument";

export type EndgameSpeechKind = "plea" | "accusation" | "defense";

export type JudgmentSpeechProvenance = "agent" | "timeout" | "fallback";

/** Shared provenance for accepted public formal speech (Judgment + endgame). */
export type FormalSpeechProvenance = JudgmentSpeechProvenance;

const CANONICAL_GAME_EVENT_TYPES = new Set<string>([
  "game.roster_initialized",
  "round.started",
  "shields.expired",
  "mingle.rooms_allocated",
  "mingle.coordination_receipt_recorded",
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
  "alliance.proposal_submitted",
  "alliance.response_recorded",
  "alliance.counter_submitted",
  "alliance.activated",
  "alliance.amendment_resolved",
  "alliance.proposal_expired",
  "alliance.closed",
  "alliance.archived",
  "alliance.huddle_scheduled",
  "alliance.huddle_skipped",
  "alliance.huddle_completed",
  "alliance.huddle_outcome_recorded",
  "council.vote_cast",
  "council.elimination_resolved",
  "player.last_message_recorded",
  "player.eliminated",
  "player.elimination_message_recorded",
  "endgame.stage_set",
  "endgame.elimination_vote_cast",
  "endgame.elimination_resolved",
  "jury.vote_cast",
  "jury.winner_determined",
  "judgment.speech_recorded",
  "endgame.speech_recorded",
  "round.result_recorded",
]);

/**
 * Canonical events are accepted domain facts. `sourcePointers` deliberately
 * remain raw-envelope provenance; viewer/replay consumers must use the narrow
 * allowlisted projector in `viewer-decision-events.ts`, never transcript prose
 * or a copied canonical payload.
 */
export interface CanonicalEventEnvelope<
  TType extends CanonicalGameEventType = CanonicalGameEventType,
  TPayload extends object = Record<string, unknown>,
  TPayloadVersion extends 1 | 2 = 1,
> {
  sequence: number;
  gameId: UUID;
  round: number;
  phase: Phase | null;
  type: TType;
  timestamp: string;
  source: CanonicalEventSource;
  visibility: CanonicalEventVisibility;
  payloadVersion: TPayloadVersion;
  sourcePointers: CanonicalSourcePointer[];
  payload: TPayload;
}

/**
 * Public format-resolution aggregates. Never include voter→ballot mappings;
 * `format.ballot_cast` carries the per-voter facts and viewer read paths expose
 * only its sanitized projection, never the raw producer envelope.
 */
export type FormatResolutionCommon = {
  formatId: LaunchFormatId;
  empoweredId: UUID;
  eliminatedId: UUID;
  resolutionKind: "clear" | "auto";
  tiedPlayerIds: UUID[];
  tiebreakerId: UUID | null;
};

/** Historical version-1 format resolution with mutually-exclusive format bags. */
export type FormatResolutionPayloadV1 = FormatResolutionCommon & {
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
  aggregate?: never;
};

export type FormatResolutionAggregate =
  | {
      capability: "sealed_elim";
      totals: Record<UUID, number>;
      eligiblePlayerIds: UUID[];
    }
  | {
      capability: "sealed_polarity";
      nets: Record<UUID, number>;
      savesReceived: Record<UUID, number>;
      eliminateReceived: Record<UUID, number>;
    }
  | {
      capability: "public_chain";
      starterId: UUID;
      safePlayerIds: UUID[];
      vulnerablePlayerIds: UUID[];
      voteTotals: Record<UUID, number>;
    };

/** Version-2 format resolution. Aggregate shape is selected by catalog capability. */
export type FormatResolutionPayloadV2 = FormatResolutionCommon & {
  aggregate: FormatResolutionAggregate;
  saveOrEliminate?: never;
  voteBomb?: never;
  safetyBounce?: never;
};

/** New-writer format resolution contract. */
export type FormatResolutionPayload = FormatResolutionPayloadV2;

export type AnyFormatResolutionPayload =
  | FormatResolutionPayloadV1
  | FormatResolutionPayloadV2;

/** Producer-only sealed format ballot (owner reads filtered through round-facts scope). */
export type FormatBallotPayload = {
  formatId: LaunchFormatId;
  voterId: UUID;
  targetId: UUID;
  /** Present for Save-or-Eliminate only. */
  polarity: "save" | "eliminate" | null;
};

export type CanonicalGameEvent =
  | CanonicalEventEnvelope<
      "game.roster_initialized",
      {
        players: Array<{ id: UUID; name: string; status: PlayerStatus; shielded: boolean }>;
        /** Frozen legal formats. Absent only on historical launch-trio games. */
        formatManifest?: LaunchFormatId[];
      }
    >
  | CanonicalEventEnvelope<"round.started", { round: number }>
  | CanonicalEventEnvelope<"shields.expired", { expiredPlayerIds: UUID[] }>
  | CanonicalEventEnvelope<
      "mingle.rooms_allocated",
      {
        round: number;
        rooms: RoomAllocation[];
        excluded: UUID[];
        lastSessionExcluded: UUID[];
      }
    >
  | CanonicalEventEnvelope<
      "vote.cast",
      {
        voterId: UUID;
        empowerTarget: UUID;
        /** Legacy optional field; format-kernel standard rounds omit expose. */
        exposeTarget?: UUID | null;
      }
    >
  | CanonicalEventEnvelope<
      "vote.empower_tally_resolved",
      {
        counts: Record<UUID, number>;
        empowered: UUID;
        tied: UUID[] | null;
        method: "plurality" | "tie_pending" | "wheel";
        cumulativeEmpowerVotes: Record<UUID, number>;
      }
    >
  | CanonicalEventEnvelope<"vote.empower_revote_cast", { voterId: UUID; target: UUID }>
  | CanonicalEventEnvelope<"vote.empower_vote_cleared", { voterId: UUID }>
  | CanonicalEventEnvelope<"vote.empowered_set", { empowered: UUID; method: "initial" | "revote" | "wheel" | "manual" }>
  | CanonicalEventEnvelope<
      "format.menu_offered",
      { empoweredId: UUID; offeredFormatIds: [LaunchFormatId, LaunchFormatId] }
    >
  | CanonicalEventEnvelope<
      "format.selected",
      { empoweredId: UUID; formatId: LaunchFormatId }
    >
  | CanonicalEventEnvelope<"format.ballot_cast", FormatBallotPayload>
  | CanonicalEventEnvelope<"format.safety_bounce_started", { starterId: UUID }>
  | CanonicalEventEnvelope<
      "format.safety_bounce_pointer",
      { actorId: UUID; targetId: UUID; classification: "safe" | "vulnerable" }
    >
  | CanonicalEventEnvelope<"format.resolved", FormatResolutionPayloadV1, 1>
  | CanonicalEventEnvelope<"format.resolved", FormatResolutionPayloadV2, 2>
  | CanonicalEventEnvelope<"power.action_set", { action: PowerAction }>
  | CanonicalEventEnvelope<
      "power.candidates_resolved",
      {
        exposeScores: Record<UUID, number>;
        candidates: [UUID, UUID] | null;
        autoEliminated: UUID | null;
        shieldGranted: UUID | null;
        method: "two_player" | "auto_eliminate" | "expose_scores" | "exposure_bench" | "exposure_bench_protect" | "insufficient_candidates";
        initialResolution?: Record<string, unknown>;
        shieldReplacement?: Record<string, unknown>;
      }
    >
  | CanonicalEventEnvelope<"alliance.proposal_submitted", { lineage: AllianceProposalLineage }>
  | CanonicalEventEnvelope<
      "alliance.response_recorded",
      {
        lineage: AllianceProposalLineage;
        playerId: UUID;
        response: AllianceProposalResponse;
        versionId: UUID;
      }
    >
  | CanonicalEventEnvelope<"alliance.counter_submitted", { lineage: AllianceProposalLineage }>
  | CanonicalEventEnvelope<
      "alliance.activated",
      {
        lineage: AllianceProposalLineage;
        alliance: AllianceRecord;
      }
    >
  | CanonicalEventEnvelope<
      "alliance.amendment_resolved",
      {
        lineage: AllianceProposalLineage;
        alliance: AllianceRecord;
      }
    >
  | CanonicalEventEnvelope<"alliance.proposal_expired", { lineage: AllianceProposalLineage }>
  | CanonicalEventEnvelope<"mingle.coordination_receipt_recorded", { receipt: import("./types").MingleCoordinationReceiptRecord }>
  | CanonicalEventEnvelope<"alliance.closed", { alliance: AllianceRecord }>
  | CanonicalEventEnvelope<"alliance.archived", { alliance: AllianceRecord }>
  | CanonicalEventEnvelope<"alliance.huddle_scheduled", { schedule: AllianceHuddleScheduleRecord }>
  | CanonicalEventEnvelope<"alliance.huddle_skipped", { schedule: AllianceHuddleScheduleRecord }>
  | CanonicalEventEnvelope<"alliance.huddle_completed", { session: AllianceHuddleSessionRecord }>
  | CanonicalEventEnvelope<
      "alliance.huddle_outcome_recorded",
      {
        outcome: AllianceHuddleOutcome;
        alliance?: AllianceRecord;
      }
    >
  | CanonicalEventEnvelope<"council.vote_cast", { voterId: UUID; target: UUID }>
  | CanonicalEventEnvelope<
      "council.elimination_resolved",
      {
        empoweredId: UUID;
        candidates: [UUID, UUID];
        tally: CouncilVoteTally;
        eliminated: UUID;
        method: "plurality" | "empowered_tiebreaker" | "random_tiebreaker";
      }
    >
  | CanonicalEventEnvelope<"player.last_message_recorded", { playerId: UUID; message: string }>
  | CanonicalEventEnvelope<"player.elimination_message_recorded", { playerId: UUID; message: string }>
  | CanonicalEventEnvelope<
      "player.eliminated",
      {
        playerId: UUID;
        playerName: string;
        eliminatedRound: number;
        juryMember: JuryMember;
      }
    >
  | CanonicalEventEnvelope<
      "endgame.stage_set",
      {
        stage: EndgameStage;
        lastEmpoweredFromRegularRounds: UUID | null;
      }
    >
  | CanonicalEventEnvelope<"endgame.elimination_vote_cast", { voterId: UUID; target: UUID }>
  | CanonicalEventEnvelope<
      "endgame.elimination_resolved",
      {
        stage: EndgameStage | null;
        tally: EndgameEliminationTally;
        juryTiebreakerVotes?: Record<UUID, UUID>;
        eliminated: UUID;
        method:
          | "plurality"
          | "random_no_votes"
          | "last_empowered_tiebreaker"
          | "jury_tiebreaker"
          | "fallback_first_tied";
      }
    >
  | CanonicalEventEnvelope<"jury.vote_cast", { jurorId: UUID; finalistId: UUID }>
  | CanonicalEventEnvelope<
      "jury.winner_determined",
      {
        tally: JuryVoteTally;
        winnerId: UUID;
        method: "majority" | "empower_tiebreaker" | "random_tiebreaker";
        voteCounts: Array<{ id: UUID; name: string; votes: number }>;
      }
    >
  | CanonicalEventEnvelope<
      "judgment.speech_recorded",
      {
        speechKind: JudgmentSpeechKind;
        playerId: UUID;
        text: string;
        provenance: JudgmentSpeechProvenance;
        addresseeId?: UUID;
      }
    >
  | CanonicalEventEnvelope<
      "endgame.speech_recorded",
      {
        speechKind: EndgameSpeechKind;
        playerId: UUID;
        text: string;
        provenance: FormalSpeechProvenance;
        /** Accusation target (accused). Present for accusation. */
        targetId?: UUID;
        /** Safe counterpart — accuser for defense. */
        counterpartId?: UUID;
        /** Deterministic correlation key for transcript/event parity. */
        correlationKey: string;
      }
    >
  | CanonicalEventEnvelope<"round.result_recorded", { result: RoundResult }>;

export interface CanonicalEventValidationResult {
  ok: boolean;
  errors: string[];
}

export function canonicalEventIsVisibleTo(
  event: Pick<CanonicalGameEvent, "visibility">,
  mode: CanonicalEventQueryMode,
): boolean {
  if (mode === "producer") return true;
  if (mode === "player") return event.visibility === "public" || event.visibility === "player" || event.visibility === "system";
  return event.visibility === "public" || event.visibility === "system";
}

export function isCanonicalGameEventType(value: unknown): value is CanonicalGameEventType {
  return typeof value === "string" && CANONICAL_GAME_EVENT_TYPES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSourcePointer(value: unknown): value is CanonicalSourcePointer {
  if (!isRecord(value)) return false;
  return (
    value.kind === "canonical_event" ||
    value.kind === "transcript_entry" ||
    value.kind === "agent_turn" ||
    value.kind === "simulation_jsonl"
  );
}

export function isSupportedCanonicalPayloadVersion(
  eventType: unknown,
  payloadVersion: unknown,
): payloadVersion is 1 | 2 {
  return eventType === "format.resolved"
    ? payloadVersion === 1 || payloadVersion === 2
    : payloadVersion === 1;
}

function expectedFormatCapability(formatId: unknown): FormatResolutionAggregate["capability"] | null {
  return typeof formatId === "string" && isRegisteredFormatId(formatId)
    ? getFormatRegistration(formatId).capability
    : null;
}

function validateFormatResolutionV2(payload: unknown): string[] {
  if (!isRecord(payload)) return ["format.resolved v2 payload must be an object"];
  if (!isRecord(payload.aggregate)) {
    return ["format.resolved v2 payload.aggregate must be an object"];
  }
  for (const legacyBag of ["saveOrEliminate", "voteBomb", "safetyBounce"] as const) {
    if (Object.hasOwn(payload, legacyBag)) {
      return [`format.resolved v2 payload must not contain legacy bag ${legacyBag}`];
    }
  }
  const expected = expectedFormatCapability(payload.formatId);
  if (!expected) {
    return [`format.resolved v2 formatId is unsupported: ${String(payload.formatId)}`];
  }
  if (payload.aggregate.capability !== expected) {
    return [
      `format.resolved v2 capability mismatch for ${String(payload.formatId)}: expected ${expected}, got ${String(payload.aggregate.capability)}`,
    ];
  }
  const aggregate = payload.aggregate;
  if (
    aggregate.capability === "sealed_elim"
    && (!isRecord(aggregate.totals) || !Array.isArray(aggregate.eligiblePlayerIds))
  ) {
    return ["format.resolved v2 sealed_elim aggregate requires totals and eligiblePlayerIds"];
  }
  if (
    aggregate.capability === "sealed_polarity"
    && (
      !isRecord(aggregate.nets)
      || !isRecord(aggregate.savesReceived)
      || !isRecord(aggregate.eliminateReceived)
    )
  ) {
    return ["format.resolved v2 sealed_polarity aggregate requires nets, savesReceived, and eliminateReceived"];
  }
  if (
    aggregate.capability === "public_chain"
    && (
      typeof aggregate.starterId !== "string"
      || !Array.isArray(aggregate.safePlayerIds)
      || !Array.isArray(aggregate.vulnerablePlayerIds)
      || !isRecord(aggregate.voteTotals)
    )
  ) {
    return ["format.resolved v2 public_chain aggregate requires starterId, classifications, and voteTotals"];
  }
  return [];
}

export function validateCanonicalGameEvent(value: unknown): CanonicalEventValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["event must be an object"] };
  }

  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) {
    errors.push("sequence must be a positive integer");
  }
  if (typeof value.gameId !== "string" || value.gameId.length === 0) {
    errors.push("gameId is required");
  }
  if (!Number.isInteger(value.round) || Number(value.round) < 0) {
    errors.push("round must be a non-negative integer");
  }
  if (typeof value.type !== "string" || value.type.length === 0) {
    errors.push("type is required");
  } else if (!isCanonicalGameEventType(value.type)) {
    errors.push(`type is unsupported: ${value.type}`);
  }
  if (typeof value.timestamp !== "string" || value.timestamp.length === 0) {
    errors.push("timestamp is required");
  }
  if (
    value.source !== "engine" &&
    value.source !== "phase" &&
    value.source !== "simulator" &&
    value.source !== "replay" &&
    value.source !== "mcp"
  ) {
    errors.push("source is invalid");
  }
  if (
    value.visibility !== "public" &&
    value.visibility !== "player" &&
    value.visibility !== "producer" &&
    value.visibility !== "system"
  ) {
    errors.push("visibility is invalid");
  }
  if (!isSupportedCanonicalPayloadVersion(value.type, value.payloadVersion)) {
    errors.push(
      value.type === "format.resolved"
        ? `payloadVersion for format.resolved must be 1 or 2, got ${String(value.payloadVersion)}`
        : `payloadVersion for ${String(value.type)} must be 1, got ${String(value.payloadVersion)}`,
    );
  } else if (value.type === "format.resolved" && value.payloadVersion === 2) {
    errors.push(...validateFormatResolutionV2(value.payload));
  }
  if (!Array.isArray(value.sourcePointers) || !value.sourcePointers.every(isSourcePointer)) {
    errors.push("sourcePointers must be an array of source pointer records");
  }
  if (!isRecord(value.payload)) {
    errors.push("payload must be an object");
  }

  return { ok: errors.length === 0, errors };
}

export function assertCanonicalGameEvent(value: unknown): asserts value is CanonicalGameEvent {
  const result = validateCanonicalGameEvent(value);
  if (!result.ok) {
    throw new Error(`Invalid canonical game event: ${result.errors.join("; ")}`);
  }
}
