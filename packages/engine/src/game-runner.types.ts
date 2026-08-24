/**
 * Influence Game - Game Runner Types
 *
 * Shared types and interfaces used by the game runner and its extracted modules.
 */

import type {
  AllianceHuddleCommitmentFact,
  UUID,
  PowerAction,
  JuryMember,
  EndgameStage,
  RoomAllocation,
  Phase,
  MingleSessionDiagnostics,
  MingleRoomCount,
  MingleIntentSummary as MingleIntentSummaryBase,
  StrategicLens,
} from "./types";
import type { CanonicalGameEvent, CanonicalSourcePointer } from "./canonical-events";
import type { FormatPressureProjection } from "./format-pressure";
import type { LaunchFormatId } from "./formats";
import type { PostVotePressureProjection } from "./post-vote-pressure";
import type { CanonicalGameProjection } from "./game-projection";
import type { TokenCostCursor, TokenTracker } from "./token-tracker.js";
import type { ModelReasoningEffort, ModelReasoningPolicy, ProviderProfileId } from "./model-catalog";
import type {
  HouseFactCategory,
  HouseNarrativeContinuity,
  HouseProviderUsage,
  HouseSourceCoordinate,
  HouseSummaryBoundary,
  HouseSummaryFrontier,
} from "./house-summary-frontier";
export type { TokenCostCursor };
export type {
  ProviderAttemptFailureKind,
  ProviderAttemptFailureOutcome,
  ProviderAttemptAccountingFacts,
  ProviderAttemptDisposition,
  ProviderAttemptIntent,
  ProviderAttemptOutcome,
  ProviderAttemptRecord,
  ProviderAttemptUsageFacts,
  ProviderExecutionHooks,
  ProviderLogicalCallCoordinate,
  ProviderPreparedRequest,
  SanitizedProviderRequestEvidence,
  SanitizedProviderResponseEvidence,
} from "./provider-execution";
export type {
  HouseBeatClass,
  HouseBeatStatus,
  HouseFactCategory,
  HouseFactRow,
  HouseFactSlice,
  HouseNarrativeContinuity,
  HouseProviderUsage,
  HouseSalienceItem,
  HouseSourceCoordinate,
  HouseSummaryBoundary,
  HouseSummaryFrontier,
  HouseSummaryPhaseReceipt,
} from "./house-summary-frontier";

export type { MingleIntentSummary, MinglePreferredRoomSize, StrategicLens } from "./types";

// ---------------------------------------------------------------------------
// Stream events — emitted in real-time for WebSocket observers
// ---------------------------------------------------------------------------

export type GameStreamEvent =
  | { type: "transcript_entry"; entry: TranscriptEntry }
  | AgentTurnEvent
  | { type: "phase_change"; phase: Phase; round: number; alivePlayers: Array<{ id: UUID; name: string }> }
  | { type: "player_eliminated"; playerId: UUID; playerName: string; round: number }
  | { type: "game_over"; winner?: UUID; winnerName?: string; totalRounds: number };

export interface GameStateSnapshot {
  gameId: UUID;
  round: number;
  alivePlayers: Array<{ id: UUID; name: string; shielded: boolean }>;
  eliminatedPlayers: Array<{ id: UUID; name: string }>;
  transcript: TranscriptEntry[];
}

export interface GameRunnerOptions {
  /** Optional external run identity, used by API-backed games before the first canonical event. */
  gameId?: UUID;
  /**
   * Controls whether config.maxRounds is raised to the player-scaled completion
   * floor. Production defaults to completion_scaled; bounded simulations may
   * opt into an exact cap.
   */
  maxRoundsMode?: "completion_scaled" | "exact";
  /** Runtime resume input for supported completed phase-boundary checkpoints. */
  resumeFrom?: GameRunnerResumeOptions;
  /** Optional producer/debug sink for private model-call traces. */
  privateTraceSink?: PrivateTraceSink;
  /** Awaited durability boundary for API-backed canonical event persistence. */
  durableEventSink?: (events: readonly CanonicalGameEvent[]) => Promise<void> | void;
  /** Optional forensic checkpoint writer called after durable event flushes. */
  durableCheckpointSink?: (checkpoint: GameCheckpointCapsule) => Promise<void> | void;
  /** Optional owner/lease check before accepting post-LLM commits. */
  beforeAcceptedCommit?: () => Promise<void> | void;
  /** Optional token tracker for checkpoint cursor evidence (API-backed games). */
  tokenTracker?: TokenTracker;
  /** Injectable format-menu RNG for deterministic simulation and tests. */
  random?: () => number;
}

export const PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES = [
  "lobby",
  "mingle_i",
  "pre_vote_huddle",
  "vote",
  "format_menu",
  "format_pick",
  "format_mingle",
  "format_resolve",
  "post_vote_mingle",
  "power",
  "reveal",
  "pre_council_huddle",
  "council",
  "reckoning_lobby",
  "reckoning_plea",
  "reckoning_vote",
  "tribunal_lobby",
  "tribunal_accusation",
  "tribunal_defense",
  "tribunal_vote",
  "judgment_opening",
  "judgment_jury_questions",
  "judgment_closing",
  "judgment_jury_vote",
] as const;

export type GameRunnerResumeActorCoordinate = (typeof PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES)[number];

export interface GameRunnerResumeOptions {
  kind: "phase_boundary";
  actorCoordinate: GameRunnerResumeActorCoordinate;
  canonicalEvents: readonly CanonicalGameEvent[];
  lastEventSequence: number;
  transcriptReplay: readonly TranscriptEntry[];
  tokenCostCursor?: TokenCostCursor | null;
  houseContinuityCapsule?: HouseContinuityCapsule | null;
  houseContinuityRequirement?: HouseContinuityRequirement;
  /** Validated active-player private continuity capsules for supported resume hydration. */
  playerContinuityCapsules?: readonly PlayerContinuityCapsule[];
  mingleInboxReplay?: MingleInboxReplay | null;
  currentAccusations?: CurrentAccusationsAccumulatorV1 | null;
}

export type GameCheckpointKind = "initial" | "phase_boundary" | "terminal";

export interface GameCheckpointStateSummary {
  gameId: UUID;
  round: number;
  alivePlayerCount: number;
  eliminatedPlayerCount: number;
}

export interface GameCheckpointProjectionSummary {
  gameId: UUID;
  lastSequence: number;
  round: number;
  phase: Phase | null;
  alivePlayerCount: number;
  eliminatedPlayerCount: number;
  roomAllocationRounds: number;
  roundResultCount: number;
}

/** Boundary certificate evidence (U3+). Conservative for v1: asserts write happened after durable flush with no pending pre-boundary effects locally. */
export interface BoundaryCertificate {
  gameId: UUID;
  ownerEpoch?: string;
  boundarySequence: number;
  checkpointReason: GameCheckpointKind;
  phase?: Phase;
  round?: number;
  projectionHash?: string;
  eventCommitReceipt: { sequence: number; hash: string } | null;
  noPendingEffectsAsserted: boolean;
}

/** Shared boundary tuple binding every Runtime Snapshot v1 artifact. */
export interface CheckpointBoundaryIdentityV1 {
  version: 1;
  ownerEpoch: string;
  boundarySequence: number;
  eventHeadHash: string;
  projectionHash: string;
  checkpointKind: GameCheckpointKind;
  phase: Phase;
  round: number;
}

export type AccumulatorEntryStatusV1 =
  | "empty"
  | "drained"
  | "captured"
  | "blocked"
  | "malformed"
  | "not_v1_hydratable";

export type AccumulatorProofKindV1 =
  | "empty_at_boundary"
  | "drained_at_boundary"
  | "captured_at_boundary"
  | "not_applicable_at_boundary";

export interface AccumulatorProofV1 {
  kind: AccumulatorProofKindV1;
  detail?: string;
}

export interface AccumulatorEntryV1 {
  id: string;
  status: AccumulatorEntryStatusV1;
  proof?: AccumulatorProofV1;
  payload?: CurrentAccusationsAccumulatorV1;
}

export interface MingleInboxReplay {
  version: 1;
  sourceRound: number | null;
  entries: Array<{
    recipientId: UUID;
    messages: Array<{ from: string; text: string }>;
  }>;
  unresolvedRecipientNames: string[];
}

export interface CurrentAccusationRecordV1 {
  targetId: UUID;
  targetName: string;
  accuserId: UUID;
  accuserName: string;
  accusation: string;
}

export interface CurrentAccusationsAccumulatorV1 {
  version: 1;
  boundary: CheckpointBoundaryIdentityV1;
  items: CurrentAccusationRecordV1[];
}

/** Closed v1 registry for phase-boundary runner accumulators. */
export const PHASE_BOUNDARY_ACCUMULATOR_IDS = [
  "mingleInbox",
  "transcriptStreamBuffer",
  "currentAccusations",
] as const;

export type PhaseBoundaryAccumulatorId = (typeof PHASE_BOUNDARY_ACCUMULATOR_IDS)[number];

export interface PhaseAccumulatorRegistryV1 {
  version: 1;
  boundaryClass: "phase_boundary";
  boundary: CheckpointBoundaryIdentityV1;
  entries: AccumulatorEntryV1[];
}

export interface ActorWitnessV1 {
  version: 1;
  boundary: CheckpointBoundaryIdentityV1;
  machineSchemaVersion: "phase-machine-v1";
  actorCoordinate: string;
  actorStatus: "active" | "done";
  contextSummary: {
    round: number;
    phase: Phase;
    alivePlayerIds: UUID[];
  };
  futureHydrationInputVersion: 1;
}

export interface TranscriptWatermarkV1 {
  version: 1;
  boundary: CheckpointBoundaryIdentityV1;
  lastCanonicalSequence: number;
  entryCount: number;
  durableBoundary: true;
  boundaryDigest: string;
}

/** Versioned runtime snapshot payload persisted inside checkpoint JSONB. */
export interface RuntimeSnapshotV1 {
  version: 1;
  boundary: CheckpointBoundaryIdentityV1;
  actorWitness: ActorWitnessV1;
  accumulatorRegistry: PhaseAccumulatorRegistryV1;
  transcriptWatermark: TranscriptWatermarkV1;
}

/**
 * Structured private continuity capsules.
 * These are producer-only state for supported-boundary hydration of agent/House behavior.
 * They must not leak raw thinking or reasoningContext.
 */
export const PLAYER_CONTINUITY_CAPSULE_VERSION = 2 as const;

/**
 * Checkpoint-time House Strategy Bible continuity contract.
 * Sealed when the checkpoint is written; recovery and passport must not re-read live config.
 */
export type HouseContinuityRequirement =
  | "disabled"
  | "awaiting_first_valid_update"
  | "required";

export interface PlayerPowerActionMemoryEntry {
  round: number;
  action: "eliminate" | "protect" | "pass";
  target: string;
}

export interface PlayerRoundHistoryEntry {
  round: number;
  eliminated?: string;
  empowered?: string;
  myVotes: { empower: string };
}

export interface PlayerContinuityCapsule {
  version: typeof PLAYER_CONTINUITY_CAPSULE_VERSION;
  playerId: UUID;
  playerName: string;
  /** The only private strategy source admitted by supported recovery. */
  compactStrategy: CompactStrategyState;
  notes: Array<{ subject: string; note: string }>;
  relationships: { allies: string[]; threats: string[] };
  powerActionMemory: PlayerPowerActionMemoryEntry[];
  roundHistory: PlayerRoundHistoryEntry[];
}

export interface HouseContinuityCapsule {
  revisionId: string;
  previousRevisionId: string | null;
  updatedAtRound: number;
  updatedAtPhase: Phase;
  summary: string;
  alliances: HouseAllianceHypothesis[];
  tensions: string[];
  promises: string[];
  voteBlocs: string[];
  mingleDiscoveries: string[];
  playerTrajectories: HousePlayerTrajectory[];
  storyArcs: HouseStoryArc[];
  droppedThreads: string[];
  openQuestions: string[];
  changedSincePrevious: string;
}

export interface GameCheckpointCapsule {
  gameId: UUID;
  lastEventSequence: number;
  checkpointKind: GameCheckpointKind;
  phase: Phase;
  round: number;
  eventCount: number;
  projection: CanonicalGameProjection;
  state: GameCheckpointStateSummary;
  projectionSummary: GameCheckpointProjectionSummary;
  /** Boundary safety evidence captured at write time (U3+). */
  boundaryCertificate?: BoundaryCertificate | null;
  playerContinuityCapsules?: PlayerContinuityCapsule[];
  houseContinuityCapsule?: HouseContinuityCapsule | null;
  /**
   * Checkpoint-time House continuity contract. Absent on legacy capsules;
   * recovery fails closed for player continuity without versioned capsules,
   * and passport treats missing House requirement as the historical strict path.
   */
  houseContinuityRequirement?: HouseContinuityRequirement;
  transcriptReplay?: {
    /** 1 = legacy safe-entry shape; 2 = normalized dialogue identity fields. */
    version: 1 | 2;
    entries: TranscriptEntry[];
  } | null;
  /**
   * Transient product-dialogue projection (dialogue scopes with entrySequence only).
   * Consumed by the API checkpoint write path to append the durable dialogue suffix.
   * Not a player-facing checkpoint field and must not be re-exposed from checkpoint reads.
   */
  productDialogueProjection?: readonly TranscriptEntry[];
  /** Phase-boundary runtime evidence for hydration passport validation (v1). */
  runtimeSnapshot?: RuntimeSnapshotV1 | null;
  transcriptCursor: {
    entries: number;
    version?: number;
    durableBoundary?: boolean;
    [key: string]: unknown;
  };
  tokenCostCursor: TokenCostCursor | null;
}

// ---------------------------------------------------------------------------
// Agent response — structured output from message-producing methods
// ---------------------------------------------------------------------------

export interface AgentResponse extends StrategicDecisionMetadata {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking: string;
  /** The actual message content */
  message: string;
  /**
   * Model-side reasoning evidence for debug surfaces. Local models may provide raw
   * `reasoning_content`; hosted OpenAI calls may provide a labeled provider summary.
   */
  reasoningContext?: string;
  /** Private producer/debug frame describing the main evidence lens for this response. */
  strategicLens?: StrategicLens;
  /** Compact private rationale for the selected strategic lens. */
  strategicLensRationale?: string;
  /**
   * Durable private-decision id minted with the private decision trace when present.
   * Used to correlate dialogue with owned cognition; not board-fact authority.
   */
  decisionId?: UUID;
  /**
   * Explicit absence returned when an optional provider-backed utterance exhausts.
   * Empty message/thinking fields remain non-authoritative compatibility fields;
   * phase runners must omit the turn entirely when this marker is present.
   */
  providerAbsence?: ProviderSpeechAbsence;
}

export interface ProviderSpeechAbsence {
  kind: "provider_exhausted";
  outcome:
    | "refusal"
    | "rate_limit"
    | "service_error"
    | "transport_error"
    | "transport_timeout"
    | "authentication"
    | "configuration"
    | "request_error"
    | "cancellation"
    | "empty_output"
    | "malformed_output"
    | "wrong_tool"
    | "undecodable_structured_output"
    | "budget_exhausted"
    | "circuit_open";
}

export type PrivateDecisionTraceActorRole = "player" | "juror" | "house" | "system" | "producer";

export interface PrivateDecisionTraceActor {
  id?: UUID;
  name: string;
  role: PrivateDecisionTraceActorRole;
}

export interface PrivateDecisionTraceMessage {
  role: string;
  content: unknown;
  name?: string;
  toolCallId?: string;
  toolCalls?: PrivateDecisionTraceToolCall[];
}

export interface PrivateDecisionTraceToolCall {
  id?: string;
  type?: string;
  name?: string;
  arguments?: string;
}

export type ProviderReasoningSummaryMode = "auto" | "concise" | "detailed";

export interface ProviderReasoningSummary {
  provider: "openai_responses";
  mode: ProviderReasoningSummaryMode;
  text: string;
  parts: string[];
  outputItemIds?: string[];
}

export interface PrivateDecisionTraceBoundary {
  currentEventSequence?: number;
  currentEventHash?: string;
  sourcePointer?: CanonicalSourcePointer | null;
  finalEventSequence?: number;
}

export interface PrivateDecisionTraceContext {
  gameId?: UUID;
  ownerEpoch?: string;
  action: string;
  actor: PrivateDecisionTraceActor;
  phase?: Phase;
  round?: number;
  /** Durable phase-owned ordinal for repeated calls at this actor/action boundary. */
  logicalCallOrdinal?: number;
  boundary?: PrivateDecisionTraceBoundary;
  /**
   * Structural-only Recall Plan receipt for this call (KTD5 / R16).
   * Attached at the private-trace seam; never carries dialogue or names.
   */
  recallPlanReceipt?: RecallPlanReceipt;
}

/** Producer-only structural receipt. It deliberately has no prompt content. */
export interface PromptReuseReceipt {
  version: 1;
  lane: string;
  requestShape: string;
  blocks: Array<{ id: string; class: "instructions" | "context" | "conversation" | "tool" | "unknown"; volatility: "stable" | "rolling" | "volatile"; canonicalHash: string; rollingHash: string; characters: number; tokenEstimate: number }>;
  characterEstimate: number;
  tokenEstimate: number;
  comparable: boolean;
  reusableCharacters: number;
  reusableTokenEstimate: number;
  firstBreak?: string;
  usage?: { promptTokens?: number; cachedTokens?: number };
}

export interface PrivateDecisionTrace {
  version: 2;
  gameId?: UUID;
  ownerEpoch?: string;
  /**
   * Durable id for one private decision commit. Shared by thinking/strategy
   * artifacts and resulting dialogue rows for exact narrative correlation.
   * Forward-path only; never invented at read time for legacy rows.
   */
  decisionId?: UUID;
  action: string;
  actor: PrivateDecisionTraceActor;
  phase?: Phase;
  round?: number;
  createdAt: string;
  model: {
    provider?: string;
    providerProfileId?: ProviderProfileId;
    catalogId?: string;
    name: string;
  };
  requestedReasoningEffort?: ModelReasoningEffort;
  reasoningPolicy?: ModelReasoningPolicy;
  prompt: {
    messages: PrivateDecisionTraceMessage[];
  };
  request?: unknown;
  response: {
    raw: unknown;
    finishReason?: string | null;
    content?: string | null;
    toolCalls?: PrivateDecisionTraceToolCall[];
  };
  output?: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    routerBilling?: Record<string, unknown>;
    diagnostics?: string[];
  };
  promptReuse?: PromptReuseReceipt;
  /**
   * Producer-only structural Recall Plan receipt (KTD5 / R16).
   * Safe for aggregate evaluation; never includes dialogue, names, entry IDs,
   * rejected counts, prompt payloads, thinking, or reasoning context.
   */
  recallPlanReceipt?: RecallPlanReceipt;
  emittedThinking?: string;
  reasoningContext?: string;
  providerReasoningSummary?: ProviderReasoningSummary;
  toolName?: string;
  toolArguments?: unknown;
  /** Model-submitted compact strategy proposal. Acceptance is decided later. */
  strategyCandidate?: {
    operation: "replace" | "delta";
    submittedValue: unknown;
  };
  boundary?: PrivateDecisionTraceBoundary;
}

export type PrivateTraceSink = (trace: PrivateDecisionTrace) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Compact private strategy state
// ---------------------------------------------------------------------------

export type CompactStrategyLifecycle =
  | "opening"
  | "active"
  | "reconciliation_required"
  | "repair_required";

export type CompactStrategyDecisionBoundary =
  | "ordinary_action"
  | "diary_follow_up"
  | "post_eviction_diary"
  | "diary_repair"
  | "action_repair";

export interface CompactStrategyPriorEpoch {
  lifecycle: "opening" | "active";
  baseline: string | null;
  deltas: string[];
  revision: number;
}

/**
 * Engine-owned private cognition. Canonical board facts always override this
 * fallible strategy text when the two disagree.
 */
export interface CompactStrategyState {
  lifecycle: CompactStrategyLifecycle;
  /** Null during the implicit authored opening posture and while reconciling. */
  baseline: string | null;
  /** Ordered, mechanically accepted refinements to the current epoch. */
  deltas: string[];
  /** The last valid epoch, retained only while post-eviction repair is pending. */
  priorEpoch: CompactStrategyPriorEpoch | null;
  /** Monotonic engine-owned revision; models never supply this value. */
  revision: number;
}

/** Raw flat fields decoded independently from the mechanic-specific action. */
export interface CompactStrategyCandidate {
  strategy?: unknown;
  strategyDelta?: unknown;
}

export type CompactStrategyOperation = "replace" | "delta";

export type CompactStrategyRejectionReason =
  | "action_not_accepted"
  | "boundary_field_not_allowed"
  | "lifecycle_operation_not_allowed"
  | "required_value_missing"
  | "value_not_string"
  | "value_too_long"
  | "delta_limit_reached"
  | "aggregate_too_long";

export interface CompactStrategyApplicationBase {
  operation: CompactStrategyOperation;
  state: CompactStrategyState;
  previousRevision: number;
  resultingRevision: number;
}

export interface CompactStrategyAccepted extends CompactStrategyApplicationBase {
  status: "accepted";
  value: string;
}

export interface CompactStrategyNoChange extends CompactStrategyApplicationBase {
  status: "no_change";
  reason: "optional_value_absent";
}

export interface CompactStrategyRejected extends CompactStrategyApplicationBase {
  status: "rejected";
  reason: CompactStrategyRejectionReason;
  diagnostic: string;
}

export type CompactStrategyApplicationResult =
  | CompactStrategyAccepted
  | CompactStrategyNoChange
  | CompactStrategyRejected;

export interface StrategicDecisionMetadata extends CompactStrategyCandidate {
  /**
   * Engine-only marker that this response came from a model-authored strategic
   * surface even when the offered strategy field was omitted. Provider and
   * deterministic fallbacks omit it so they cannot consume a pending repair.
   */
  strategyCandidateProposed?: boolean;
  /** Engine-only mechanic validation outcome for candidate discard diagnostics. */
  strategyGameplayAccepted?: boolean;
  /**
   * Fresh private-decision receipt minted by this exact model call.
   * Acceptance writers may use it only when the returned value is accepted directly.
   */
  decisionId?: UUID;
  /** Engine-owned provenance for a legal required action chosen without a model result. */
  engineFallback?: EngineFallbackProvenance;
}

export type EngineFallbackReason =
  | "provider_exhausted"
  | "action_timed_out"
  | "invalid_model_output"
  | "agent_method_unavailable";

export interface EngineFallbackProvenance {
  source: "engine";
  reason: EngineFallbackReason;
  /** Stable coordinate used to replay the same choice from the same legal set. */
  seed: string;
}

export type HouseAllianceStatus = "speculative" | "forming" | "active" | "fracturing" | "retired";
export type HouseConfidence = "low" | "medium" | "high";

export interface HouseAllianceHypothesis {
  name: string;
  members: string[];
  status: HouseAllianceStatus;
  confidence: HouseConfidence;
  evidence: string[];
  tension?: string | null;
  openQuestions?: string[];
}

export interface HousePlayerTrajectory {
  playerName: string;
  currentRead: string;
  pressurePoints: string[];
  likelyNextMove?: string | null;
}

export interface HouseStoryArc {
  title: string;
  summary: string;
  involvedPlayers: string[];
  status: "emerging" | "active" | "resolved" | "dropped";
}

export interface HouseCoveredWindow {
  fromRound: number;
  toRound: number;
  fromPhase?: Phase;
  toPhase?: Phase;
}

export interface HouseVoteCount {
  playerName: string;
  votes: number;
  voters: string[];
}

/** One sealed format ballot (House/producer omniscient; not player-public until reveal). */
export interface HouseFormatBallotLine {
  voterName: string;
  targetName: string;
  /** Present for Save-or-Eliminate. */
  polarity?: "save" | "eliminate";
}

export interface HouseFormatScoreLine {
  playerName: string;
  value: number;
  /** e.g. zero_safe | positive | net | vulnerable_total */
  bucket?: string;
}

export interface HouseFormatBouncePointerLine {
  actorName: string;
  targetName: string;
  classification: "SAFE" | "VULNERABLE";
}

/**
 * Full format resolution snapshot for House MC / producer.
 * House sees every sealed ballot; player-facing surfaces stay sealed.
 */
export interface HouseFormatResolutionFacts {
  round: number;
  formatId: string;
  formatName: string;
  offeredFormatIds: [string, string] | null;
  offeredFormatNames: [string, string] | null;
  ballots: HouseFormatBallotLine[];
  scores: HouseFormatScoreLine[];
  zeroSafeNames: string[];
  safeNames: string[];
  vulnerableNames: string[];
  bouncePointers: HouseFormatBouncePointerLine[];
  resolutionKind: string;
  resolutionSummary: string;
  eliminatedName: string;
  tiebreakByEmpoweredName: string | null;
}

export interface HouseRoundFacts {
  round: number;
  empoweredName: string | null;
  empowerMethod: string | null;
  empowerVoteCounts: HouseVoteCount[];
  exposeVoteCounts: HouseVoteCount[];
  councilCandidates: [string, string] | null;
  powerAction: { action: PowerAction["action"]; targetName: string | null } | null;
  shieldGrantedName: string | null;
  autoEliminatedName: string | null;
  councilVoteCounts: HouseVoteCount[];
  councilMethod: string | null;
  eliminatedName: string | null;
  councilRoles: HouseCouncilRoleFact[];
  /** Format-kernel fields (null on classic Power→Council rounds). */
  selectedFormatId: string | null;
  selectedFormatName: string | null;
  offeredFormatIds: [string, string] | null;
  offeredFormatNames: [string, string] | null;
  /** How elimination resolved under the format (e.g. format id / method string). */
  formatMethod: string | null;
  /** Which elimination spine produced the exit this round. */
  eliminationPath: "format" | "council" | "power_auto" | "unknown";
  /**
   * Omniscient format resolution: every sealed ballot, scoreboard, bounce chain.
   * Null on classic rounds or before format resolve completes.
   */
  formatResolution: HouseFormatResolutionFacts | null;
}

export type HouseCouncilRole =
  | "candidate"
  | "voted_for_eliminated"
  | "voted_for_survivor"
  | "empowered_tiebreaker"
  | "empowered_no_tiebreak_needed"
  | "non_voter"
  | "not_applicable";

export interface HouseCouncilRoleFact {
  playerName: string;
  role: HouseCouncilRole;
  candidateNames: [string, string] | null;
  eliminatedName: string | null;
  survivingCandidateName: string | null;
  votedForName: string | null;
}

export interface HouseStrategyBiblePacket {
  revisionId: string;
  previousRevisionId: string | null;
  updatedAtRound: number;
  updatedAtPhase: Phase;
  coveredWindow: HouseCoveredWindow;
  summary: string;
  alliances: HouseAllianceHypothesis[];
  tensions: string[];
  promises: string[];
  voteBlocs: string[];
  mingleDiscoveries: string[];
  playerTrajectories: HousePlayerTrajectory[];
  storyArcs: HouseStoryArc[];
  droppedThreads: string[];
  openQuestions: string[];
  changedSincePrevious: string;
}

export interface HouseEvidenceBundle {
  round: number;
  phase: Phase;
  alivePlayers: string[];
  eliminatedPlayers: string[];
  activeShieldNames: string[];
  empoweredName: string | null;
  councilCandidates: [string, string] | null;
  recentTranscript: TranscriptEntry[];
  recentPublicMessages: Array<{ from: string; text: string; phase: Phase; round?: number; anonymous?: boolean }>;
  recentDiaryEntries: Array<{ round: number; precedingPhase: Phase; agentName: string; question: string; answer: string }>;
  roomAllocations: Array<{ round: number; text: string; rooms: Array<{ roomId: number; players: string[] }>; excluded: string[] }>;
  roundFacts: HouseRoundFacts;
  canonicalEventCount: number;
}

export interface HouseStrategyBibleUpdateContext {
  round: number;
  phase: Phase;
  previousPacket: HouseStrategyBiblePacket | null;
  evidence: HouseEvidenceBundle;
  coveredWindow: HouseCoveredWindow;
}

export interface HouseStrategyBibleUpdateResult {
  packet: HouseStrategyBiblePacket | null;
  rationale?: string;
  thinking?: string;
  reasoningContext?: string;
}

export type HouseSummaryKind = "round" | "phase" | "long-form";

export interface HouseGameplaySummaryContext {
  gameId: UUID;
  round: number;
  phase: Phase;
  kind: HouseSummaryKind;
  alivePlayers: string[];
  packet: HouseStrategyBiblePacket | null;
  evidence: HouseEvidenceBundle;
  coveredWindow: HouseCoveredWindow;
}

export interface HouseGameplaySummaryResult {
  summary: string;
  kind: HouseSummaryKind;
  packetRevisionId: string | null;
  coveredWindow: HouseCoveredWindow;
  referencedAllianceNames: string[];
  openQuestions?: string[];
  thinking?: string;
  reasoningContext?: string;
}

export interface HouseSelectiveSummaryContext {
  frontier: HouseSummaryFrontier;
  continuity: HouseNarrativeContinuity;
  factReadAllowed: boolean;
}

interface HouseSummaryAttemptBase {
  boundary: HouseSummaryBoundary;
  providerCalls: number;
  factCalls: number;
  requestedCategories: HouseFactCategory[];
  returnedBytes: number;
  usage: HouseProviderUsage[];
  thinking?: string;
  reasoningContext?: string;
}

export interface HouseSummaryEmittedResult extends HouseSummaryAttemptBase {
  status: "emitted";
  summary: string;
  sourceAliases: string[];
  sources: HouseSourceCoordinate[];
  openQuestions: string[];
  threadIds: string[];
}

export interface HouseSummaryModelSkippedResult extends HouseSummaryAttemptBase {
  status: "model_skipped";
  reason: string;
}

export interface HouseSummaryFailedResult extends HouseSummaryAttemptBase {
  status: "failed";
  reason: string;
}

export type HouseSummaryAttemptResult =
  | HouseSummaryEmittedResult
  | HouseSummaryModelSkippedResult
  | HouseSummaryFailedResult;

export interface HouseProducerBrief {
  playerName: string;
  packetRevisionId: string | null;
  storyRole: string;
  pressurePoints: string[];
  relevantAllianceHypotheses: string[];
  contradictions: string[];
  questionAngles: string[];
  safeToReveal: string[];
  privateDoNotReveal: string[];
  thinking?: string;
  reasoningContext?: string;
}

export type AllianceActionKind =
  | "propose"
  | "accept"
  | "decline"
  | "counter"
  | "defer"
  | "trial"
  | "amend"
  | "pass";

export interface AllianceActionBase extends StrategicDecisionMetadata {
  action: AllianceActionKind;
  thinking?: string;
  reasoningContext?: string;
}

export interface AllianceProposalAction extends AllianceActionBase {
  action: "propose";
  allianceId?: UUID;
  lineageId?: UUID;
  versionId?: UUID;
  name: string;
  memberNames: string[];
  purpose: string;
  timebox?: string | null;
}

export interface AllianceProposalResponseAction extends AllianceActionBase {
  action: "accept" | "decline" | "defer" | "trial";
  lineageId: UUID;
  versionId?: UUID | null;
}

export interface AllianceCounterAction extends AllianceActionBase {
  action: "counter";
  lineageId: UUID;
  versionId?: UUID;
  name: string;
  memberNames: string[];
  purpose: string;
  timebox?: string | null;
}

export interface AllianceAmendAction extends AllianceActionBase {
  action: "amend";
  allianceId: UUID;
  versionId?: UUID;
  name: string;
  memberNames: string[];
  purpose: string;
  timebox?: string | null;
}

export interface AlliancePassAction extends AllianceActionBase {
  action: "pass";
}

export type AllianceAction =
  | AllianceProposalAction
  | AllianceProposalResponseAction
  | AllianceCounterAction
  | AllianceAmendAction
  | AlliancePassAction;

export interface AllianceActionOpportunityTerms {
  name: string;
  memberNames: string[];
  purpose: string;
  timebox: string | null;
}

export type AllianceActionOpportunity =
  | {
    kind: "proposer";
  }
  | {
    kind: "response";
    lineageId: UUID;
    versionId: UUID;
    counterAllowed: boolean;
    terms: AllianceActionOpportunityTerms;
  };

export interface AllianceHuddlePromptContext {
  allianceId: UUID;
  allianceName: string;
  memberNames: string[];
  purpose: string;
  timebox?: string | null;
  window: "format" | "pre_vote" | "pre_council";
  scheduleId: UUID;
  pass: number;
}

export interface AllianceHuddleTurnAction extends StrategicDecisionMetadata {
  /** Typed provider exhaustion for an optional huddle turn; omit the turn entirely. */
  providerAbsence?: ProviderSpeechAbsence;
  thinking?: string;
  reasoningContext?: string;
  message: string | null;
  noReply?: boolean;
  commitment?: Omit<AllianceHuddleCommitmentFact, "speakerId" | "speakerName">;
}

export interface MingleTurnAction extends StrategicDecisionMetadata {
  /** Typed provider exhaustion for an optional turn; never emit a transcript entry. */
  providerAbsence?: ProviderSpeechAbsence;
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Private room message. Empty/null means no TALK action. */
  message?: string | null;
  /** True when the agent intentionally sends NO_REPLY for this turn. */
  noReply?: boolean;
  /** Optional local room number to enter for the next turn. */
  gotoRoomId?: number | null;
  /** Optional player name to follow to their resolved room for the next turn. */
  gotoPlayerName?: string | null;
  /** Model-side reasoning evidence for debug surfaces. */
  reasoningContext?: string;
  /** Private receipt for a concrete proposal made in a decision-relevant allied room. */
  coordinationReceipt?: {
    proposedTarget: string | null;
    proposedAction: string | null;
    commitment: string | null;
    noProposalReason: string | null;
  };
}

export interface MingleIntentAction extends MingleIntentSummaryBase, StrategicDecisionMetadata {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Model-side reasoning evidence for debug surfaces. */
  reasoningContext?: string;
}

export interface TargetDecision extends StrategicDecisionMetadata {
  target: UUID;
  thinking?: string;
  reasoningContext?: string;
}

export interface EmpowerRevoteAction extends StrategicDecisionMetadata {
  empowerTarget: UUID;
  thinking?: string;
  reasoningContext?: string;
}

export interface CandidateChoiceRequest {
  lockedCandidateIds: UUID[];
  eligibleCandidateIds: UUID[];
  requiredCount: number;
  mode: string;
  fallbackReason?: string | null;
  protectedCandidateId?: UUID;
}

export interface CandidateSelectionDecision extends StrategicDecisionMetadata {
  selectedCandidateIds: UUID[];
  thinking?: string;
  reasoningContext?: string;
}

export interface PowerActionOptions {
  shieldReplacementRequests?: CandidateChoiceRequest[];
}

export interface PowerActionDecision extends PowerAction, StrategicDecisionMetadata {
  thinking?: string;
  reasoningContext?: string;
  shieldPullUpCandidateIds?: UUID[];
}

export type FormatDecisionFallbackReason =
  | "agent_method_unavailable"
  | "agent_internal_fallback"
  | "tool_call_failed"
  | "invalid_format_choice"
  | "invalid_save_or_eliminate_ballot"
  | "invalid_vote_bomb_target"
  | "invalid_majority_elimination_target"
  | "invalid_even_votes_target"
  | "invalid_restricted_history_target"
  | "invalid_bounce_pointer"
  | "invalid_safety_bounce_target"
  | "invalid_format_tiebreak_target";

export type FormatDecisionProvenance =
  | { decisionSource: "llm"; fallbackReason: null }
  | { decisionSource: "fallback"; fallbackReason: FormatDecisionFallbackReason };

export type AgentTurnVisibility = "public" | "private" | "anonymous" | "diary" | "system";

export interface AgentTurnActor {
  id?: UUID;
  name: string;
  role?: "player" | "juror" | "house";
}

export interface AgentTurnEvent {
  type: "agent_turn";
  round: number;
  phase: Phase;
  timestamp: number;
  action: string;
  actor: AgentTurnActor;
  visibility: AgentTurnVisibility;
  response: Record<string, unknown>;
  /** Exact correlation with the proposal-time private decision trace. */
  decisionId?: UUID;
  /** Post-guard mechanical result; authorized exactly like `thinking`. */
  strategyResult?: CompactStrategyApplicationResult;
  thinking?: string;
  reasoningContext?: string;
  scope?: TranscriptEntry["scope"];
  text?: string;
  to?: string[];
  roomId?: number;
  anonymous?: boolean;
  displayOrder?: number;
}

export interface PowerLobbyExposure {
  id: UUID;
  name: string;
  score: number;
}

export interface AgentCallOptions {
  signal?: AbortSignal;
  traceAction?: string;
  decisionAction?: string;
  decisionLabel?: string;
}

export interface StrategicReflectionOptions {
  timing?: "post_phase" | "pre_vote";
}

// ---------------------------------------------------------------------------
// Agent interface (implemented by InfluenceAgent in agent.ts)
// ---------------------------------------------------------------------------

export interface IAgent {
  readonly id: UUID;
  readonly name: string;
  /**
   * Most recent private-decision id minted for this agent in the live run, when
   * the implementation emits private decision traces. Optional for mock agents.
   */
  getLastPrivateDecisionId?(): UUID | undefined;
  /** Current private compact-strategy state. Phase code never mutates this value directly. */
  getCompactStrategyState?(): CompactStrategyState;
  /**
   * Apply a strategy candidate only after the associated gameplay proposal has
   * passed the phase's acceptance guard and canonical mechanic mutation.
   */
  commitCompactStrategyCandidate?(
    boundary: CompactStrategyDecisionBoundary,
    candidate: CompactStrategyCandidate,
  ): CompactStrategyApplicationResult;
  /** Canonical elimination invalidates the current strategy epoch. */
  markCompactStrategyReconciliationRequired?(): CompactStrategyState;
  /** Called once when the game starts */
  onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void;
  /** Called at the start of each phase with current game context */
  onPhaseStart(context: PhaseContext): Promise<void>;
  /** Called to collect this agent's introduction message */
  getIntroduction(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect a lobby message */
  getLobbyMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect whisper actions (list of {to, text}) — DEPRECATED, use room methods */
  getWhispers(context: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>>;
  /** Called before House initial Mingle room assignment to form a hidden private-room strategy intent */
  getMingleIntent?(context: PhaseContext): Promise<MingleIntentAction | null>;
  /** Called during Mingle I for one engine-scoped official named-alliance opportunity. */
  getAllianceAction?(context: PhaseContext, opportunity: AllianceActionOpportunity): Promise<AllianceAction>;
  /** Called during a House-scheduled alliance huddle for one private speaking opportunity. */
  getAllianceHuddleTurn?(context: PhaseContext, huddle: AllianceHuddlePromptContext, conversationHistory?: Array<{ from: string; text: string }>): Promise<AllianceHuddleTurnAction>;
  /** Send a private room message to all other occupants, or null to pass */
  sendRoomMessage(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null>;
  /** Mingle turn action: TALK or NO_REPLY, plus optional GOTO ROOM N for the next turn */
  takeMingleTurn?(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<MingleTurnAction>;
  /** Called to collect a rumor message */
  getRumorMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect votes */
  getVotes(
    context: PhaseContext,
  ): Promise<StrategicDecisionMetadata & { empowerTarget: UUID; thinking?: string; reasoningContext?: string }>;
  /** Called only for an empower tie revote. */
  getEmpowerRevote(
    context: PhaseContext,
    tiedCandidates: UUID[],
    originalVote: { empowerTarget: UUID },
  ): Promise<EmpowerRevoteAction>;
  /** Called privately after Vote when expose votes do not fully lock the initial Council pair. */
  getCandidateSelection?(
    context: PhaseContext,
    request: CandidateChoiceRequest,
  ): Promise<CandidateSelectionDecision>;
  /** Called during the optional post-vote Power Lobby experiment before the empowered action */
  getPowerLobbyMessage?(
    context: PhaseContext,
    provisionalCandidates: [UUID, UUID],
    exposePressure: PowerLobbyExposure[],
  ): Promise<AgentResponse>;
  /** Called only if this agent is the empowered agent */
  getPowerAction(
    context: PhaseContext,
    candidates: [UUID, UUID],
    options?: PowerActionOptions,
  ): Promise<PowerActionDecision>;
  /** Called for council vote (empowered agent also votes as tiebreaker) */
  getCouncilVote(
    context: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<TargetDecision>;

  // --- Format kernel (sequester) ---
  /** Empowered player picks one of two House-offered round formats. */
  pickRoundFormat?(
    context: PhaseContext,
    offeredFormats: [LaunchFormatId, LaunchFormatId],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { formatId: string; thinking?: string; reasoningContext?: string }>;
  getSaveOrEliminateBallot?(
    context: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & {
    polarity: "save" | "eliminate";
    targetId: UUID;
    thinking?: string;
    reasoningContext?: string;
  }>;
  getVoteBombBallot?(
    context: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  getMajorityEliminationBallot?(
    context: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  getEvenVotesBallot?(
    context: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  getRestrictedHistoryBallot?(
    context: PhaseContext,
    legalTargetIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  getBouncePointer?(
    context: PhaseContext,
    board: { safe: UUID[]; vulnerable: UUID[]; unclassified: UUID[]; nextActorId: UUID | null },
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  getSafetyBounceVote?(
    context: PhaseContext,
    vulnerableIds: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;
  breakFormatEliminationTie?(
    context: PhaseContext,
    tiedSet: UUID[],
  ): Promise<FormatDecisionProvenance & StrategicDecisionMetadata & { targetId: UUID; thinking?: string; reasoningContext?: string }>;

  /** Called only after this agent has been eliminated. */
  getEliminationMessage?(
    context: PhaseContext,
    options?: AgentCallOptions,
  ): Promise<AgentResponse>;
  /** @deprecated Implement getEliminationMessage instead. */
  getLastMessage?(context: PhaseContext): Promise<AgentResponse>;
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse>;

  // --- Endgame methods ---
  /** Reckoning: public plea to the group */
  getPlea(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Reckoning/Tribunal: vote to eliminate one player (simple plurality) */
  getEndgameEliminationVote(context: PhaseContext, options?: AgentCallOptions): Promise<TargetDecision>;
  /** Tribunal: publicly accuse one player */
  getAccusation(context: PhaseContext, options?: AgentCallOptions): Promise<StrategicDecisionMetadata & { targetId: UUID; text: string; thinking?: string; reasoningContext?: string }>;
  /** Tribunal: defend against an accusation */
  getDefense(context: PhaseContext, accusation: string, accuserName: string, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: opening statement to the jury */
  getOpeningStatement(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: juror asks one question to one finalist */
  getJuryQuestion(context: PhaseContext, finalistIds: [UUID, UUID], options?: AgentCallOptions): Promise<{ targetFinalistId: UUID; question: string; thinking?: string; reasoningContext?: string }>;
  /** Judgment: finalist answers a jury question */
  getJuryAnswer(context: PhaseContext, question: string, jurorName: string, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: closing argument to the jury */
  getClosingArgument(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: juror votes for the winner */
  getJuryVote(context: PhaseContext, finalistIds: [UUID, UUID], options?: AgentCallOptions): Promise<TargetDecision>;

  /**
   * Narrow continuity snapshot for Recall Plan compilation (U3).
   * Phase runners obtain this immediately before ContextBuilder; they never read agent memory fields directly.
   */
  getRecallContinuitySnapshot?(): RecallContinuitySnapshot;

  /**
   * Return structured private continuity capsule for this agent.
   * Called by runner at durable phase boundaries for checkpoint manifests.
   * Must not include raw prompts, responses, or reasoningContext.
   */
  getContinuityCapsule?(): Omit<PlayerContinuityCapsule, "playerId" | "playerName"> | null;

  /**
   * Restore validated private continuity after roster initialization on supported resume.
   * Must scrub eliminated players from actionable state while preserving historical context.
   */
  restoreContinuityCapsule?(
    capsule: PlayerContinuityCapsule,
    options?: { livingPlayerNames?: readonly string[] },
  ): void;

  // --- Memory updates (called by GameRunner after phase events) ---
  /** Record a player as an ally */
  updateAlly(playerName: string): void;
  /** Record a player as a threat */
  updateThreat(playerName: string): void;
  /** Add a note about a player */
  addNote(playerName: string, note: string): void;
  /** Remove a player from memory (after elimination) */
  removeFromMemory?(playerName: string): void;
}

// ---------------------------------------------------------------------------
// Phase context passed to agents
// ---------------------------------------------------------------------------

export interface PlayerAllianceContextTerms {
  name: string;
  memberIds: UUID[];
  memberNames: string[];
  purpose: string;
  timebox: string | null;
}

export interface PlayerAllianceContextAlliance extends PlayerAllianceContextTerms {
  id: UUID;
  status: "active" | "closed" | "archived";
  huddleOutcomes: Array<{
    id: UUID;
    round: number;
    ask: string;
    plan: string;
    promises: string[];
    dissent: string[];
    confidence: "low" | "medium" | "high";
    posture: string;
    leakOrBetrayalClaims: string[];
  }>;
}

export interface PlayerAllianceContextProposal {
  lineageId: UUID;
  allianceId: UUID;
  status: "open" | "activated" | "declined" | "expired";
  currentVersionId: UUID;
  currentTerms: PlayerAllianceContextTerms;
  yourResponse: string | null;
}

export interface PlayerAllianceContext {
  activeAlliances: PlayerAllianceContextAlliance[];
  openProposals: PlayerAllianceContextProposal[];
  proposalHistory: PlayerAllianceContextProposal[];
}

export interface RestrictedHistoryLegalityProjection {
  priorTargetIds: UUID[];
  priorTargetNames: string[];
  legalTargetIds: UUID[];
  legalTargetNames: string[];
}

export interface PhaseContext {
  gameId: UUID;
  round: number;
  phase: Phase;
  /** Durable phase-owned ordinal for repeated provider calls at this boundary. */
  providerLogicalCallOrdinal?: number;
  selfId: UUID;
  selfName: string;
  alivePlayers: Array<{ id: UUID; name: string; shielded?: boolean }>;
  publicMessages: Array<{ from: string; text: string; phase: Phase; round?: number; anonymous?: boolean; displayOrder?: number }>;
  /** Messages this agent received in the current Mingle/private room */
  mingleMessages: Array<{ from: string; text: string }>;
  empoweredId?: UUID;
  councilCandidates?: [UUID, UUID];
  /** Vote-derived pressure visible after empowerment is resolved. */
  postVotePressure?: PostVotePressureProjection;
  /** Current format menu, locked rules, and public Safety Bounce board. */
  formatPressure?: FormatPressureProjection;
  /** Actor-specific Restricted History exclusions and current legal targets. */
  restrictedHistoryLegality?: RestrictedHistoryLegalityProjection;
  /** Public named vote record revealed to players after each standard Vote resolves. */
  revealedVoteLedger?: RevealedVoteLedgerEntry[];
  /** Player-visible canonical event record rendered with names for endgame context. */
  gameEventRecord?: string[];
  /** Public/system transcript context visible to players, excluding private Mingle, diary, and thinking traces. */
  publicTranscriptContext?: PublicTranscriptContextEntry[];
  /** Prior Judgment jury questions and answers visible during the finale. */
  judgmentQuestionHistory?: JudgmentQuestionHistoryEntry[];
  /** Controls whether Judgment history renders answers; juror question generation gets questions only. */
  judgmentQuestionHistoryMode?: "full" | "questions_only";
  /** Recent personal decisions reconstructed from canonical events and public Judgment transcript. */
  recentDecisions?: RecentDecisionContextEntry[];
  /** Member-safe official alliance facts and proposal history for this player only. */
  allianceContext?: PlayerAllianceContext;
  /** Most recent eliminated player name, derived from jury/elimination order when available. */
  latestEliminatedPlayerName?: string;
  // Mingle room allocation context
  /** Number of available rooms this round */
  roomCount?: number;
  /** Current occupant count for each room. Player identities outside the current room are hidden. */
  roomCounts?: MingleRoomCount[];
  /** This agent's current local room number, if they are in a Mingle room. */
  currentRoomId?: number;
  /** Room assignments for this round (if Mingle phase completed) */
  roomAllocations?: Array<{ roomId: number; beat: number; playerIds: string[]; playerNames: string[] }>;
  /** This agent's current room occupants, including self */
  roomMates?: string[];
  /** Hidden Mingle intent formed before initial House room assignment */
  mingleIntent?: MingleIntentSummaryBase | null;
  // Endgame context
  endgameStage?: EndgameStage;
  jury?: JuryMember[];
  finalists?: [UUID, UUID];
  /** True when this agent has been eliminated (e.g. juror in diary room) */
  isEliminated?: boolean;
  /** Controlled facts disclosed only after this agent's elimination commits. */
  eliminationContext?: EliminationContext;
  /** Current lobby sub-round index (0-based) */
  lobbySubRound?: number;
  /** Total lobby sub-rounds this phase */
  lobbyTotalSubRounds?: number;
  /** Current Mingle beat index (1-based) */
  mingleBeat?: number;
  /** Total Mingle beats this phase */
  mingleTotalBeats?: number;
  /**
   * Selective recall class for this agent call (U3).
   * Unspecified legacy contexts behave as ordinary_speech when plans are compiled.
   */
  recallPromptClass?: RecallPromptClass;
  /**
   * Compiled Recall Plan attached at the phase boundary for U4 prompt rendering.
   * Present when the call path used buildPhaseContextForAgentCall / prepareAgentPhaseContext.
   */
  recallPlan?: RecallPlan;
}

export type EliminationVoteDisclosure =
  | {
      visibility: "public";
      votesReceived: number;
      voterNames: string[];
    }
  | {
      visibility: "sealed";
      votesReceived: number;
      savesReceived?: number;
      eliminationVotesReceived?: number;
      netScore?: number;
    }
  | {
      visibility: "none";
      reason: "direct_elimination" | "sole_vulnerable";
    };

export interface EliminationContext {
  mode: "power" | "council" | "endgame" | "format";
  exposedBy?: string[];
  directExecutor?: string;
  formatId?: string;
  voteDisclosure: EliminationVoteDisclosure;
}

export interface RevealedVoteLedgerEntry {
  round: number;
  voterId: UUID;
  voterName: string;
  empowerTargetId: UUID;
  empowerTargetName: string;
  /** Legacy optional fields; absent on format-kernel empower-only ballots. */
  exposeTargetId?: UUID;
  exposeTargetName?: string;
  revoteEmpowerTargetId?: UUID;
  revoteEmpowerTargetName?: string;
}

export interface PublicTranscriptContextEntry {
  round: number;
  phase: Phase;
  from: string;
  text: string;
}

export interface JudgmentQuestionHistoryEntry {
  jurorName: string;
  finalistName: string;
  question: string;
  answer?: string;
}

export interface RecentDecisionContextEntry {
  round: number;
  phase: Phase;
  label: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Transcript entry
// ---------------------------------------------------------------------------

/** Viewer-safe dialogue kind for product transcript capture (current contract). */
export type TranscriptDialogueKind =
  | "public_speech"
  | "mingle_speech"
  | "huddle_speech"
  | "whisper_speech"
  | "system_phase_banner"
  | "system_room_allocation"
  | "system_elimination"
  | "house_summary"
  | "system_announcement";

/**
 * Versioned viewer-safe dialogue context. Excludes room diagnostics, cognition,
 * prompts, and producer metadata.
 */
export interface TranscriptDialogueContextV1 {
  version: 1;
  roomId?: number;
  allianceId?: string;
  scheduleId?: string;
  sessionId?: string;
  window?: string;
  /** Exact session-time membership (huddles); IDs only. */
  sessionAudiencePlayerIds?: string[];
  /**
   * Deterministic formal-speech correlation key shared with accepted public
   * speech events (`judgment.speech_recorded` / `endgame.speech_recorded`).
   * Enables parity without fuzzy text matching. Optional so legacy rows remain valid.
   */
  formalSpeechCorrelationKey?: string;
  /**
   * Durable private-decision id linking this speech to thinking/strategy from the
   * same decision commit. Optional; forward-path only. Outside product-dialogue
   * digest identity. Not exposed on owner match-transcript DTOs.
   */
  decisionId?: string;
}

export type TranscriptDialogueContext = TranscriptDialogueContextV1;

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;
  scope: "public" | "mingle" | "huddle" | "whisper" | "system" | "diary" | "thinking";
  to?: string[];
  text: string;
  /** Agent's internal thinking when producing this message (hidden from players, visible to viewers) */
  thinking?: string;
  /**
   * Model-side reasoning evidence. Local models may provide raw `reasoning_content`;
   * hosted OpenAI calls may provide a labeled provider summary.
   * Captured separately from the agent's "thinking" field for richer simulation traces.
   */
  reasoningContext?: string;
  /** When true, author identity is hidden from players (viewers still see it) */
  anonymous?: boolean;
  /** Shuffled display position for anonymous rumors */
  displayOrder?: number;
  /** Room ID for this private-room message */
  roomId?: number;
  /** Room allocation metadata attached to system events */
  roomMetadata?: {
    rooms: RoomAllocation[];
    excluded: string[];
    diagnostics?: MingleSessionDiagnostics;
  };
  // --- Current-capture product dialogue fields (absent on legacy replay seeds) ---
  /** Normalized speaker player UUID; null/omitted for House/system without a player actor. */
  speakerPlayerId?: string | null;
  /**
   * 1-based game-local product dialogue sequence. Present only for public, mingle,
   * whisper, huddle, and allowlisted system dialogue. Never set on diary/thinking.
   */
  entrySequence?: number;
  /** Viewer-safe dialogue kind for modern system/public classification. */
  dialogueKind?: TranscriptDialogueKind;
  /** Exact audience player UUIDs at emission time; empty array = public/all-viewers. */
  audiencePlayerIds?: string[];
  /** Versioned viewer-safe dialogue context (no diagnostics). */
  dialogueContext?: TranscriptDialogueContext;
}

// ---------------------------------------------------------------------------
// Selective context recall (Recall Plan compiler — U2)
// ---------------------------------------------------------------------------

/**
 * Explicit prompt classification controlling historical archive eligibility.
 * Unspecified call sites default to ordinary_speech (no history lane).
 */
export type RecallPromptClass =
  | "ordinary_speech"
  | "strategic_decision";

/**
 * Narrow actor continuity input for Recall Plan compilation.
 * Phase runners obtain this immediately before context build (U3); pure compiler takes it as data.
 */
export interface RecallContinuitySnapshot {
  /** Cloned engine-owned private strategy state; free-form text is never authoritative. */
  compactStrategy: CompactStrategyState;
}

/** Canonical board facts pinned in the protected lane (structured, not rendered). */
export interface RecallBoardContractFacts {
  authority: "canonical_board_contract";
  gameId: UUID;
  round: number;
  phase: Phase;
  selfId: UUID;
  selfName: string;
  alivePlayers: Array<{ id: UUID; name: string; shielded?: boolean }>;
  empoweredId?: UUID;
  councilCandidates?: [UUID, UUID];
  endgameStage?: EndgameStage;
  finalists?: [UUID, UUID];
  latestEliminatedPlayerName?: string;
  jury?: JuryMember[];
  isEliminated?: boolean;
}

/** Compact huddle outcome fields retained in protected recall (no participant snapshot). */
export interface RecallProtectedHuddleOutcome {
  id: UUID;
  round: number;
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: "low" | "medium" | "high";
  posture: string;
  leakOrBetrayalClaims: string[];
}

/** Active-room conversation (hot lane), distinct from historical Mingle archive. */
export interface RecallHotMessage {
  from: string;
  text: string;
}

/**
 * Selected historical dialogue evidence. Never authoritative: cannot override
 * Board Contract, permissions, or instructions. Rendered by agent prompt builders.
 */
export interface RecallHistoryDialogueEvidence {
  entrySequence: number;
  round: number;
  phase: Phase;
  speakerLabel: string;
  dialogueText: string;
  sourceClass: "public" | "mingle";
  evidenceRole: "historical_evidence";
}

export interface RecallPlanBudgetLedger {
  /** Fixture-calibrated character envelope for the prompt class. */
  envelopeChars: number;
  /** Per-class history ceiling (0 for ordinary_speech). */
  historyCeilingChars: number;
  protectedChars: number;
  hotChars: number;
  historyChars: number;
  /** Remaining history budget after protected+hot, capped by history ceiling. */
  historyBudgetChars: number;
  protectedTokenEstimate: number;
  hotTokenEstimate: number;
  historyTokenEstimate: number;
  /** True when protected alone exhausted the prompt-class envelope. */
  protectedOverflow: boolean;
}

export interface RecallPlanProtectedLane {
  boardContract: RecallBoardContractFacts;
  compactStrategy: CompactStrategyState;
  huddleOutcomes: RecallProtectedHuddleOutcome[];
  currentReceipts: {
    recentDecisions: RecentDecisionContextEntry[];
    revealedVoteLedger: RevealedVoteLedgerEntry[];
  };
}

export interface RecallPlanHotLane {
  activeRoomMessages: RecallHotMessage[];
}

export interface RecallPlanHistoryLane {
  dialogueEvidence: RecallHistoryDialogueEvidence[];
}

/**
 * Content-free structural receipt for producer/replay comparison (KTD5 / R16).
 * Never retains dialogue, names, entry IDs, rejected counts, foreign-lane counts,
 * prompts, thinking, or traces.
 */
export interface RecallPlanReceipt {
  promptClass: RecallPromptClass;
  protectedTokenEstimate: number;
  hotTokenEstimate: number;
  historyTokenEstimate: number;
  selectedLaneCounts: {
    protected: number;
    hot: number;
    history: number;
  };
  /** Rank slots for selected history only — source class, never entry IDs or text. */
  selectedByRankSlot: Array<{
    rankSlot: number;
    lane: "history";
    sourceClass: "public" | "mingle";
  }>;
  /**
   * Actor-authorized evidence boundary only. Foreign private writes that advance
   * a global sequence must not change this boundary for an unauthorized actor.
   */
  eventBoundary: {
    maxAuthorizedEntrySequence: number | null;
    authorizedCandidateCount: number;
    protectedRecordCount: number;
  };
  protectedOverflow: boolean;
}

/** Renderable Recall Plan with distinct protected / hot / history lanes. */
export interface RecallPlan {
  promptClass: RecallPromptClass;
  actorId: UUID;
  protected: RecallPlanProtectedLane;
  hot: RecallPlanHotLane;
  history: RecallPlanHistoryLane;
  budget: RecallPlanBudgetLedger;
  receipt: RecallPlanReceipt;
}
