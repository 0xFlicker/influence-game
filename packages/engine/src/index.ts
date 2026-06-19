/**
 * @influence/engine — public API
 *
 * Re-exports everything downstream packages need.
 */

// Core types
export * from "./types";

// Game state
export { GameState, createUUID } from "./game-state";
export type { GameStateOptions } from "./game-state";

// Canonical accepted domain events and projections
export { CanonicalEventLog } from "./canonical-event-log";
export type { CanonicalEventListener } from "./canonical-event-log";
export {
  assertCanonicalGameEvent,
  canonicalEventIsVisibleTo,
  validateCanonicalGameEvent,
} from "./canonical-events";
export type {
  CanonicalEventEnvelope,
  CanonicalEventQueryMode,
  CanonicalEventSource,
  CanonicalEventVisibility,
  CanonicalGameEvent,
  CanonicalGameEventType,
  CanonicalSourcePointer,
  CanonicalSourcePointerKind,
} from "./canonical-events";
export {
  applyCanonicalEvent,
  createEmptyProjection,
  replayCanonicalEvents,
} from "./game-projection";
export type {
  CanonicalGameProjection,
  ProjectedPlayer,
  ProjectedRoomAllocation,
} from "./game-projection";
export {
  createGameMcpServer,
  GameMcpJsonRpcServer,
  GameMcpReadModel,
  runStdioGameMcpServer,
} from "./game-mcp";
export type {
  GameMcpEventFilter,
  GameMcpEventResult,
  GameMcpGameFilter,
  GameMcpGameSummary,
  GameMcpLinkedRecords,
  GameMcpLogRecord,
  GameMcpSearchOptions,
  GameMcpSearchResult,
  GameMcpSessionFilter,
  GameMcpSessionStatus,
  GameMcpSessionSummary,
  GameMcpSourceCitation,
  GameMcpSourceKind,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./game-mcp";

// Event bus
export { GameEventBus } from "./event-bus";

// Phase machine
export { createPhaseMachine } from "./phase-machine";
export type {
  PhaseMachineContext,
  PhaseMachineInput,
  PhaseMachineEvent,
  PhaseMachineEmitted,
  PhaseMachine,
} from "./phase-machine";

// Game runner
export { GameRunner } from "./game-runner";
export type { ActorWitnessV1, AgentResponse, AgentTurnEvent, CheckpointBoundaryIdentityV1, EmpowerRevoteAction, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, IAgent, MingleIntentAction, MingleIntentSummary, MinglePreferredRoomSize, MingleTurnAction, PhaseAccumulatorRegistryV1, PhaseContext, PlayerContinuityCapsule, PowerLobbyExposure, PrivateDecisionTrace, PrivateDecisionTraceActor, PrivateDecisionTraceActorRole, PrivateDecisionTraceBoundary, PrivateDecisionTraceContext, PrivateDecisionTraceMessage, PrivateDecisionTraceToolCall, PrivateTraceSink, ProviderReasoningSummary, ProviderReasoningSummaryMode, RuntimeSnapshotV1, StrategicLens, StrategicReflectionAction, StrategicReflectionSummary, StrategyPacketSummary, StrategyPacketUpdateAction, StrategicDecisionMetadata, StrategicDecisionReceipt, TargetDecision, TranscriptEntry, TranscriptWatermarkV1, GameStreamEvent, GameStateSnapshot } from "./game-runner";
export {
  accumulatorProof,
  buildActorWitness,
  buildPhaseAccumulatorRegistry,
  buildRuntimeSnapshotV1,
  buildTranscriptWatermark,
  createEngineBoundaryPlaceholder,
  requiredPhaseBoundaryAccumulatorIds,
  sealBoundaryIdentity,
} from "./runtime-snapshot";
export { PHASE_BOUNDARY_ACCUMULATOR_IDS } from "./game-runner.types";
export type { AccumulatorEntryV1, AccumulatorEntryStatusV1, AccumulatorProofV1, PhaseBoundaryAccumulatorId } from "./game-runner.types";

// Agent
export { InfluenceAgent, createAgentCast } from "./agent";
export type { InfluenceAgentOptions, Personality } from "./agent";

// House interviewer
export { LLMHouseInterviewer, TemplateHouseInterviewer } from "./house-interviewer";
export type { IHouseInterviewer, DiaryRoomContext, FollowUpResult, LLMHouseInterviewerOptions } from "./house-interviewer";

// Persona generator
export { generatePersona, pickAgentNames, pickArchetypes } from "./persona-generator";
export type { GeneratedPersona } from "./persona-generator";

// LLM provider configuration
export {
  createLlmClientFromEnv,
  describeLlmProvider,
  resolveOpenAIReasoningSummaryMode,
  resolveModelForTier,
  resolveToolChoiceMode,
} from "./llm-client";
export type { LlmClientConfig, LlmToolChoiceMode, ModelTier, OpenAIReasoningSummaryMode } from "./llm-client";

// Memory store
export { InMemoryMemoryStore } from "./memory-store";
export type { MemoryStore, MemoryRecord, MemoryType } from "./memory-store";

// Token tracking
export {
  TokenTracker,
  estimateCost,
  estimateCostAllModels,
  MODEL_PRICING,
} from "./token-tracker";
export type { TokenUsage, ModelPricing, CostEstimate } from "./token-tracker";
