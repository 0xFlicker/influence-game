/**
 * Influence Game - Game Runner
 *
 * Orchestrates the phase machine, game state, event bus, and agents.
 * Drives the full game loop from INIT to END, including endgame stages.
 *
 * Phase logic is delegated to extracted modules in ./phases/.
 * Logging is handled by TranscriptLogger.
 * Context building is handled by ContextBuilder.
 * Diary room / thinking is handled by DiaryRoom.
 */

import { createActor } from "xstate";
import { GameEventBus } from "./event-bus";
import { GameState } from "./game-state";
import { createPhaseMachine } from "./phase-machine";
import { TemplateHouseInterviewer } from "./house-interviewer";
import type { IHouseInterviewer } from "./house-interviewer";
import type { UUID, GameConfig } from "./types";
import { Phase, PlayerStatus, computeMaxRounds } from "./types";

// Re-export types from the extracted module for backward compatibility
export type { AgentCallOptions, AgentResponse, GameStreamEvent, GameStateSnapshot, IAgent, MingleTurnAction, PhaseContext, PowerLobbyExposure, TranscriptEntry } from "./game-runner.types";
import type { GameStreamEvent, GameStateSnapshot, IAgent, TranscriptEntry } from "./game-runner.types";

// Internal modules
import { TranscriptLogger } from "./transcript-logger";
import { ContextBuilder } from "./context-builder";
import { DiaryRoom } from "./diary-room";
import type { PhaseRunnerContext, PhaseActor } from "./phases";
import {
  runIntroductionPhase,
  runLobbyPhase, runReckoningLobby, runTribunalLobby,
  runMinglePhase, runReckoningMingle,
  runRumorPhase,
  runVotePhase, runReckoningVote, runTribunalVote,
  runPowerPhase,
  runRevealPhase, runCouncilPhase,
  runReckoningPlea,
  runTribunalAccusation, runTribunalDefense,
  runJudgmentOpening, runJudgmentJuryQuestions, runJudgmentClosing, runJudgmentJuryVote,
} from "./phases";

// ---------------------------------------------------------------------------
// Game Runner
// ---------------------------------------------------------------------------

export class GameRunner {
  private readonly bus = new GameEventBus();
  private readonly gameState: GameState;
  private readonly machine: ReturnType<typeof createPhaseMachine>;
  private readonly config: GameConfig;
  private readonly agents: Map<UUID, IAgent>;
  private readonly logger: TranscriptLogger;
  private readonly contextBuilder: ContextBuilder;
  private readonly diaryRoom: DiaryRoom;
  private readonly houseInterviewer: IHouseInterviewer;
  /** Mingle room messages keyed by recipient */
  private mingleInbox = new Map<UUID, Array<{ from: string; text: string }>>();
  /** Ordered list of eliminated player names */
  private readonly eliminationOrder: string[] = [];
  /** When true, the game loop will exit at the next phase boundary. */
  private _aborted = false;
  /** Total number of players at game start */
  private readonly totalPlayerCount: number;
  /** Accusations stored for the defense phase */
  private readonly _currentAccusations = new Map<UUID, { accuserId: UUID; accuserName: string; text: string }>();

  constructor(agents: IAgent[], config: GameConfig, houseInterviewer?: IHouseInterviewer) {
    const scaledMaxRounds = computeMaxRounds(agents.length);
    this.config = { ...config, maxRounds: Math.max(config.maxRounds, scaledMaxRounds) };
    this.totalPlayerCount = agents.length;
    this.agents = new Map(agents.map((a) => [a.id, a]));
    this.gameState = new GameState(agents.map((a) => ({ id: a.id, name: a.name })));
    this.machine = createPhaseMachine();
    this.houseInterviewer = houseInterviewer ?? new TemplateHouseInterviewer();

    // Initialize extracted modules
    this.logger = new TranscriptLogger(this.gameState);
    this.contextBuilder = new ContextBuilder(
      this.gameState,
      this.logger,
      this.mingleInbox,
      this.totalPlayerCount,
    );
    this.diaryRoom = new DiaryRoom(
      this.gameState,
      this.logger,
      this.contextBuilder,
      this.agents,
      this.config,
      this.houseInterviewer,
    );
  }

  get transcriptLog(): readonly TranscriptEntry[] {
    return this.logger.transcript;
  }

  get diaryLog(): ReadonlyArray<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> {
    return this.diaryRoom.diaryEntries;
  }

  get thinkingLog(): ReadonlyArray<{ round: number; phase: Phase; agentId: UUID; agentName: string; text: string }> {
    return this.diaryRoom.thinkingEntries;
  }

  /** Register a listener for real-time game events (for WebSocket streaming). */
  setStreamListener(listener: (event: GameStreamEvent) => void): void {
    this.logger.setStreamListener(listener);
  }

  /** Get a snapshot of the current game state (for late-joining observers). */
  getStateSnapshot(): GameStateSnapshot {
    const allPlayers = this.gameState.getAllPlayers();
    return {
      gameId: this.gameState.gameId,
      round: this.gameState.round,
      alivePlayers: allPlayers
        .filter((p) => p.status === PlayerStatus.ALIVE)
        .map((p) => ({ id: p.id, name: p.name, shielded: p.shielded })),
      eliminatedPlayers: allPlayers
        .filter((p) => p.status === PlayerStatus.ELIMINATED)
        .map((p) => ({ id: p.id, name: p.name })),
      transcript: [...this.logger.transcript],
    };
  }

  /** Signal the game to stop at the next phase boundary. */
  abort(): void {
    this._aborted = true;
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async run(): Promise<{ winner?: UUID; winnerName?: string; rounds: number; transcript: TranscriptEntry[]; eliminationOrder: string[] }> {
    const gameId = this.gameState.gameId;
    const allPlayers = this.gameState.getAllPlayers().map((p) => ({ id: p.id, name: p.name }));

    for (const agent of this.agents.values()) {
      agent.onGameStart(gameId, allPlayers);
    }

    const actor = createActor(this.machine, {
      input: {
        gameId,
        playerIds: allPlayers.map((p) => p.id),
        maxRounds: this.config.maxRounds,
      },
    });

    const emittedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    actor.on("PHASE_STARTED", (event) => emittedEvents.push(event as unknown as { type: string; [key: string]: unknown }));
    actor.on("GAME_OVER", (event) => emittedEvents.push(event as unknown as { type: string; [key: string]: unknown }));

    actor.start();
    await this.runGameLoop(actor);
    actor.stop();
    this.bus.complete();

    const winner = this.gameState.getWinner();
    this.logger.emitStream({
      type: "game_over",
      winner: winner?.id,
      winnerName: winner?.name,
      totalRounds: this.gameState.round,
    });
    return {
      winner: winner?.id,
      winnerName: winner?.name,
      rounds: this.gameState.round,
      transcript: this.logger.transcript,
      eliminationOrder: [...this.eliminationOrder],
    };
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  private buildPhaseRunnerContext(): PhaseRunnerContext {
    return {
      gameState: this.gameState,
      agents: this.agents,
      config: this.config,
      logger: this.logger,
      contextBuilder: this.contextBuilder,
      diaryRoom: this.diaryRoom,
      mingleInbox: this.mingleInbox,
      eliminationOrder: this.eliminationOrder,
    };
  }

  private async runGameLoop(actor: PhaseActor): Promise<void> {
    let done = false;
    let lastLoopKey = "";
    let repeatedLoopCount = 0;
    const maxRepeatedLoopCount = 25;

    const completionPromise = new Promise<void>((resolve) => {
      actor.subscribe((snapshot) => {
        if (snapshot.status === "done") {
          done = true;
          resolve();
        }
      });
    });

    // Advance past INIT
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));

    const prc = this.buildPhaseRunnerContext();

    while (!done && !this._aborted) {
      const snapshot = actor.getSnapshot();
      const state = snapshot.value as string;
      const loopKey = `${state}:${this.gameState.round}:${this.logger.transcript.length}`;
      if (loopKey === lastLoopKey) {
        repeatedLoopCount += 1;
        if (repeatedLoopCount >= maxRepeatedLoopCount) {
          throw new Error(`Game loop stalled in phase-machine state "${state}" after ${repeatedLoopCount} unchanged iterations`);
        }
      } else {
        lastLoopKey = loopKey;
        repeatedLoopCount = 0;
      }

      // --- Normal round phases ---
      if (state === "introduction") {
        await runIntroductionPhase(prc, actor);
        await this.diaryRoom.runDiaryRoom(Phase.INTRODUCTION);
      } else if (state === "lobby") {
        await runLobbyPhase(prc, actor);
      } else if (state === "mingle") {
        await runMinglePhase(prc, actor);

        // House MC summary after Mingle phases (great for simulation traces)
        try {
          const summary = await this.houseInterviewer.generateGameplaySummary(
            this.logger.transcript.slice(-15),
            this.gameState.round,
            Phase.MINGLE,
            this.gameState.getAlivePlayers().map((p) => p.name),
          );
          this.logger.logSystem(`[House MC] ${summary}`, Phase.MINGLE);
        } catch {
          // non-fatal for summary generation
        }
      } else if (state === "rumor") {
        await runRumorPhase(prc, actor);
      } else if (state === "vote") {
        await runVotePhase(prc, actor);
        await this.diaryRoom.runStrategicReflections(Phase.VOTE);
      } else if (state === "power") {
        await runPowerPhase(prc, actor);
      } else if (state === "reveal") {
        await runRevealPhase(prc, actor);
      } else if (state === "council") {
        await runCouncilPhase(prc, actor);

        // House MC summary after key elimination moments for richer simulation traces
        try {
          const summary = await this.houseInterviewer.generateGameplaySummary(
            this.logger.transcript.slice(-30),
            this.gameState.round,
            Phase.COUNCIL,
            this.gameState.getAlivePlayers().map((p) => p.name),
          );
          this.logger.logSystem(`[House MC] ${summary}`, Phase.COUNCIL);
        } catch {
          // non-fatal for summary generation
        }

        // --- THE RECKONING (4 -> 3) ---
      } else if (state === "reckoning_lobby") {
        await runReckoningLobby(prc, actor);
      } else if (state === "reckoning_mingle") {
        await runReckoningMingle(prc, actor);
      } else if (state === "reckoning_plea") {
        await runReckoningPlea(prc, actor);
      } else if (state === "reckoning_vote") {
        await runReckoningVote(prc, actor);

        // --- THE TRIBUNAL (3 -> 2) ---
      } else if (state === "tribunal_lobby") {
        await runTribunalLobby(prc, actor);
      } else if (state === "tribunal_accusation") {
        await runTribunalAccusation(prc, actor, this._currentAccusations);
      } else if (state === "tribunal_defense") {
        await runTribunalDefense(prc, actor, this._currentAccusations);
      } else if (state === "tribunal_vote") {
        await runTribunalVote(prc, actor);

        // --- THE JUDGMENT (2 finalists) ---
      } else if (state === "judgment_opening") {
        await runJudgmentOpening(prc, actor);
        await this.diaryRoom.runDiaryRoom(Phase.OPENING_STATEMENTS);
      } else if (state === "judgment_jury_questions") {
        await runJudgmentJuryQuestions(prc, actor);
      } else if (state === "judgment_closing") {
        await runJudgmentClosing(prc, actor);
      } else if (state === "judgment_jury_vote") {
        await runJudgmentJuryVote(prc, actor);

      } else if (state === "checkGameOver") {
        await new Promise((r) => setTimeout(r, 10));
      } else if (state === "end" || done) {
        break;
      } else {
        throw new Error(`Game loop reached unknown phase-machine state "${state}"`);
      }

      await new Promise((r) => setTimeout(r, 0));
    }

    if (!this._aborted) {
      await completionPromise;
    }
  }
}
