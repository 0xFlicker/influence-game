/**
 * Shared context interface passed to all phase handler functions.
 * Provides access to game state, agents, logging, and context building.
 */

import type { createActor } from "xstate";
import type { GameState } from "../game-state";
import type { TranscriptLogger } from "../transcript-logger";
import type { ContextBuilder } from "../context-builder";
import type { DiaryRoom } from "../diary-room";
import type { createPhaseMachine } from "../phase-machine";
import type { UUID, GameConfig } from "../types";
import type { IAgent } from "../game-runner.types";

export type PhaseActor = ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>;

export interface PhaseRunnerContext {
  gameState: GameState;
  agents: Map<UUID, IAgent>;
  config: GameConfig;
  logger: TranscriptLogger;
  contextBuilder: ContextBuilder;
  diaryRoom: DiaryRoom;
  whisperInbox: Map<UUID, Array<{ from: string; text: string }>>;
  eliminationOrder: string[];
}
