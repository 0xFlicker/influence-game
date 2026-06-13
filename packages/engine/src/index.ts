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
export type { AgentResponse, AgentTurnEvent, EmpowerRevoteAction, IAgent, MingleIntentAction, MingleIntentSummary, MinglePreferredRoomSize, MingleTurnAction, PhaseContext, PowerLobbyExposure, StrategicLens, StrategicReflectionAction, StrategicReflectionSummary, StrategyPacketSummary, StrategyPacketUpdateAction, StrategyPacketUse, StrategyPacketUseMarker, TargetDecision, TranscriptEntry, GameStreamEvent, GameStateSnapshot } from "./game-runner";

// Agent
export { InfluenceAgent, createAgentCast } from "./agent";
export type { InfluenceAgentOptions, Personality } from "./agent";

// House interviewer
export { LLMHouseInterviewer, TemplateHouseInterviewer } from "./house-interviewer";
export type { IHouseInterviewer, DiaryRoomContext, FollowUpResult } from "./house-interviewer";

// Persona generator
export { generatePersona, pickAgentNames, pickArchetypes } from "./persona-generator";
export type { GeneratedPersona } from "./persona-generator";

// LLM provider configuration
export {
  createLlmClientFromEnv,
  describeLlmProvider,
  resolveModelForTier,
  resolveToolChoiceMode,
} from "./llm-client";
export type { LlmClientConfig, LlmToolChoiceMode, ModelTier } from "./llm-client";

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
