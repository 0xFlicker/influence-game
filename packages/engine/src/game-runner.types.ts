/**
 * Influence Game - Game Runner Types
 *
 * Shared types and interfaces used by the game runner and its extracted modules.
 */

import type {
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
import type { PostVotePressureProjection } from "./post-vote-pressure";
import type { CanonicalGameProjection } from "./game-projection";
import type { TokenCostCursor, TokenTracker } from "./token-tracker.js";
import type { ModelReasoningEffort, ModelReasoningPolicy, ProviderProfileId } from "./model-catalog";
export type { TokenCostCursor };

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
  | "blocked"
  | "malformed"
  | "not_v1_hydratable";

export type AccumulatorProofKindV1 =
  | "empty_at_boundary"
  | "drained_at_boundary"
  | "not_applicable_at_boundary";

export interface AccumulatorProofV1 {
  kind: AccumulatorProofKindV1;
  detail?: string;
}

export interface AccumulatorEntryV1 {
  id: string;
  status: AccumulatorEntryStatusV1;
  proof?: AccumulatorProofV1;
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
 * Structured private continuity capsules (U5).
 * These are producer-only state for future hydration of agent/House behavior.
 * They must not leak raw thinking or reasoningContext.
 */
export interface PlayerContinuityCapsule {
  playerId: UUID;
  playerName: string;
  strategyPacket: StrategyPacketSummary | null;
  reflectionSummary: StrategicReflectionSummary | null;
  notes: Array<{ subject: string; note: string }>;
  commitments: string[];
  relationships: { allies: string[]; threats: string[] };
  powerActionMemory: unknown;
  roundHistory: unknown[];
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

export interface AgentResponse {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking: string;
  /** The actual message content */
  message: string;
  /**
   * Model-side reasoning evidence for debug surfaces. Local models may provide raw
   * `reasoning_content`; hosted OpenAI calls may provide a labeled provider summary.
   */
  reasoningContext?: string;
  /** Private producer/debug receipt describing what this action meant strategically. */
  decisionLog?: string | null;
  /** Private producer/debug frame describing the main evidence lens for this response. */
  strategicLens?: StrategicLens;
  /** Compact private rationale for the selected strategic lens. */
  strategicLensRationale?: string;
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
  boundary?: PrivateDecisionTraceBoundary;
}

export interface PrivateDecisionTrace {
  version: 2;
  gameId?: UUID;
  ownerEpoch?: string;
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
    reasoningTokens?: number;
    totalTokens?: number;
    routerBilling?: Record<string, unknown>;
    diagnostics?: string[];
  };
  emittedThinking?: string;
  reasoningContext?: string;
  providerReasoningSummary?: ProviderReasoningSummary;
  toolName?: string;
  toolArguments?: unknown;
  decisionLog?: string;
  strategicLens?: StrategicLens;
  strategicLensRationale?: string;
  strategyPacketUpdate?: StrategyPacketUpdateAction;
  strategyPacketSummary?: StrategyPacketSummary;
  strategicReflectionSummary?: StrategicReflectionSummary;
  strategyPacketRevision?: string;
  boundary?: PrivateDecisionTraceBoundary;
}

export type PrivateTraceSink = (trace: PrivateDecisionTrace) => Promise<void> | void;

export interface StrategicDecisionMetadata {
  /** Compact private receipt tied to the current action, not raw hidden reasoning. */
  decisionLog?: string | null;
}

export interface StrategicDecisionReceipt {
  round: number;
  phase: Phase;
  action: string;
  label: string;
  decisionLog: string;
}

export interface StrategyPacketSummary {
  revisionId: string;
  previousRevisionId: string | null;
  updatedAtRound: number;
  updatedAtPhase: Phase;
  objective: string;
  targetPosture: string;
  coalitionPosture: string;
  nextSocialProbe: string;
  strategicLens: StrategicLens;
  strategicLensRationale: string;
  uncertainty: string;
  reviseTrigger: string;
  changedSincePrevious: string;
}

export interface StrategyPacketUpdateAction {
  objective: string;
  targetPosture: string;
  coalitionPosture: string;
  nextSocialProbe: string;
  strategicLens: StrategicLens;
  strategicLensRationale: string;
  uncertainty: string;
  reviseTrigger: string;
  changedSincePrevious: string;
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

export interface MingleTurnAction {
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
  /** Private producer/debug strategic decision metadata for this action. */
  decisionLog?: string | null;
}

export interface MingleIntentAction extends MingleIntentSummaryBase {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Model-side reasoning evidence for debug surfaces. */
  reasoningContext?: string;
  /** Private producer/debug strategic decision metadata for this action. */
  decisionLog?: string | null;
}

export interface StrategicReflectionAction {
  certainties: string[];
  suspicions: string[];
  allies: string[];
  threats: string[];
  plan: string;
  strategicLens: StrategicLens;
  strategicLensRationale: string;
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Model-side reasoning evidence for debug surfaces. */
  reasoningContext?: string;
  /** New strategy packet revision carried forward from this reflection, if one was produced. */
  strategyPacket?: StrategyPacketSummary | null;
}

export type StrategicReflectionSummary = Pick<StrategicReflectionAction, "certainties" | "suspicions" | "allies" | "threats" | "plan" | "strategicLens" | "strategicLensRationale">;

export interface TargetDecision {
  target: UUID;
  thinking?: string;
  reasoningContext?: string;
  decisionLog?: string | null;
}

export interface EmpowerRevoteAction {
  empowerTarget: UUID;
  thinking?: string;
  reasoningContext?: string;
  decisionLog?: string | null;
}

export interface CandidateChoiceRequest {
  lockedCandidateIds: UUID[];
  eligibleCandidateIds: UUID[];
  requiredCount: number;
  mode: string;
  fallbackReason?: string | null;
  protectedCandidateId?: UUID;
}

export interface CandidateSelectionDecision {
  selectedCandidateIds: UUID[];
  thinking?: string;
  reasoningContext?: string;
  decisionLog?: string | null;
}

export interface PowerActionOptions {
  shieldReplacementRequests?: CandidateChoiceRequest[];
}

export interface PowerActionDecision extends PowerAction {
  thinking?: string;
  reasoningContext?: string;
  decisionLog?: string | null;
  shieldPullUpCandidateIds?: UUID[];
}

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
  /** Send a private room message to all other occupants, or null to pass */
  sendRoomMessage(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null>;
  /** Mingle turn action: TALK or NO_REPLY, plus optional GOTO ROOM N for the next turn */
  takeMingleTurn?(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<MingleTurnAction>;
  /** Called to collect a rumor message */
  getRumorMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect votes */
  getVotes(
    context: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }>;
  /** Called only for an empower tie revote. Expose vote is already recorded and does not change. */
  getEmpowerRevote(
    context: PhaseContext,
    tiedCandidates: UUID[],
    originalVote: { empowerTarget: UUID; exposeTarget: UUID },
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
  ): Promise<{ target: UUID; thinking?: string; reasoningContext?: string; decisionLog?: string | null }>;
  /** Called when the agent is about to be eliminated */
  getLastMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse>;

  // --- Endgame methods ---
  /** Reckoning: public plea to the group */
  getPlea(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Reckoning/Tribunal: vote to eliminate one player (simple plurality) */
  getEndgameEliminationVote(context: PhaseContext, options?: AgentCallOptions): Promise<TargetDecision>;
  /** Tribunal: publicly accuse one player */
  getAccusation(context: PhaseContext, options?: AgentCallOptions): Promise<{ targetId: UUID; text: string; thinking?: string; reasoningContext?: string }>;
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

  // --- Strategic reflection (called after diary room) ---
  /** Produce a private strategic reflection for memory and strategy continuity. */
  getStrategicReflection(context: PhaseContext, options?: StrategicReflectionOptions): Promise<StrategicReflectionAction | null | void>;
  /** Return the live private strategy packet for this game run, if one exists. */
  getStrategyPacket?(): StrategyPacketSummary | null;

  /**
   * (U5) Return structured private continuity capsule for this agent.
   * Called by runner at durable phase boundaries for checkpoint manifests.
   * Must not include raw prompts, responses, or reasoningContext.
   */
  getContinuityCapsule?(): Omit<PlayerContinuityCapsule, "playerId" | "playerName"> | null;

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

export interface PhaseContext {
  gameId: UUID;
  round: number;
  phase: Phase;
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
  /** Context about how this agent was just eliminated for final words. */
  eliminationContext?: {
    mode: "power" | "council" | "endgame";
    exposedBy?: string[];
    councilVoters?: string[];
    eliminationVoters?: string[];
    directExecutor?: string;
  };
  /** Current lobby sub-round index (0-based) */
  lobbySubRound?: number;
  /** Total lobby sub-rounds this phase */
  lobbyTotalSubRounds?: number;
  /** Current Mingle beat index (1-based) */
  mingleBeat?: number;
  /** Total Mingle beats this phase */
  mingleTotalBeats?: number;
}

export interface RevealedVoteLedgerEntry {
  round: number;
  voterId: UUID;
  voterName: string;
  empowerTargetId: UUID;
  empowerTargetName: string;
  exposeTargetId: UUID;
  exposeTargetName: string;
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

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;
  scope: "public" | "mingle" | "whisper" | "system" | "diary" | "thinking";
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
}
