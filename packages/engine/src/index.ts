/**
 * @influence/engine — public API
 *
 * Re-exports everything downstream packages need.
 */

// Core types
export * from "./types";

// Game state
export { GameState, createUUID } from "./game-state";

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
export type { IAgent, PhaseContext, TranscriptEntry } from "./game-runner";

// Agent
export { InfluenceAgent, createAgentCast } from "./agent";
export type { Personality } from "./agent";

// House interviewer
export { LLMHouseInterviewer, TemplateHouseInterviewer } from "./house-interviewer";
export type { IHouseInterviewer, DiaryRoomContext } from "./house-interviewer";

// Token tracking
export {
  TokenTracker,
  estimateCost,
  estimateCostAllModels,
  MODEL_PRICING,
} from "./token-tracker";
export type { TokenUsage, ModelPricing, CostEstimate } from "./token-tracker";
