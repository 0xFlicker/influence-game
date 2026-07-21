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
}

export type CanonicalGameEventType =
  | "game.roster_initialized"
  | "round.started"
  | "shields.expired"
  | "mingle.rooms_allocated"
  | "vote.cast"
  | "vote.empower_tally_resolved"
  | "vote.empower_revote_cast"
  | "vote.empower_vote_cleared"
  | "vote.empowered_set"
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
  | "endgame.stage_set"
  | "endgame.elimination_vote_cast"
  | "endgame.elimination_resolved"
  | "jury.vote_cast"
  | "jury.winner_determined"
  | "judgment.speech_recorded"
  | "endgame.speech_recorded"
  | "round.result_recorded";

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
  "vote.cast",
  "vote.empower_tally_resolved",
  "vote.empower_revote_cast",
  "vote.empower_vote_cleared",
  "vote.empowered_set",
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
  "endgame.stage_set",
  "endgame.elimination_vote_cast",
  "endgame.elimination_resolved",
  "jury.vote_cast",
  "jury.winner_determined",
  "judgment.speech_recorded",
  "endgame.speech_recorded",
  "round.result_recorded",
]);

export interface CanonicalEventEnvelope<
  TType extends CanonicalGameEventType = CanonicalGameEventType,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  sequence: number;
  gameId: UUID;
  round: number;
  phase: Phase | null;
  type: TType;
  timestamp: string;
  source: CanonicalEventSource;
  visibility: CanonicalEventVisibility;
  payloadVersion: 1;
  sourcePointers: CanonicalSourcePointer[];
  payload: TPayload;
}

export type CanonicalGameEvent =
  | CanonicalEventEnvelope<
      "game.roster_initialized",
      {
        players: Array<{ id: UUID; name: string; status: PlayerStatus; shielded: boolean }>;
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
  | CanonicalEventEnvelope<"vote.cast", { voterId: UUID; empowerTarget: UUID; exposeTarget: UUID }>
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
  if (value.payloadVersion !== 1) {
    errors.push("payloadVersion must be 1");
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
