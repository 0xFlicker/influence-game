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
import type { CanonicalEventListener } from "./canonical-event-log";
import type { CanonicalGameEvent } from "./canonical-events";
import type { CanonicalGameProjection } from "./game-projection";
import { createPhaseMachine } from "./phase-machine";
import { TemplateHouseInterviewer } from "./house-interviewer";
import type { IHouseInterviewer } from "./house-interviewer";
import type { UUID, GameConfig } from "./types";
import { Phase, PlayerStatus, computeMaxRounds } from "./types";

// Re-export types from the extracted module for backward compatibility
export type { ActorWitnessV1, AgentCallOptions, AgentResponse, AgentTurnEvent, BoundaryCertificate, CandidateChoiceRequest, CandidateSelectionDecision, CheckpointBoundaryIdentityV1, EmpowerRevoteAction, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, GameStreamEvent, GameStateSnapshot, HouseAllianceHypothesis, HouseContinuityCapsule, HouseCouncilRole, HouseCouncilRoleFact, HouseEvidenceBundle, HouseGameplaySummaryResult, HouseProducerBrief, HouseRoundFacts, HouseStrategyBiblePacket, HouseVoteCount, IAgent, MingleIntentAction, MingleIntentSummary, MinglePreferredRoomSize, MingleTurnAction, PhaseAccumulatorRegistryV1, PhaseContext, PlayerContinuityCapsule, PowerActionDecision, PowerActionOptions, PowerLobbyExposure, PrivateDecisionTrace, PrivateDecisionTraceActor, PrivateDecisionTraceActorRole, PrivateDecisionTraceBoundary, PrivateDecisionTraceContext, PrivateDecisionTraceMessage, PrivateDecisionTraceToolCall, PrivateTraceSink, RecentDecisionContextEntry, RuntimeSnapshotV1, StrategicLens, StrategicReflectionAction, StrategicReflectionSummary, StrategyPacketSummary, StrategyPacketUpdateAction, StrategyPacketUse, StrategyPacketUseMarker, TargetDecision, TokenCostCursor, TranscriptEntry, TranscriptWatermarkV1 } from "./game-runner.types";
import type { AccumulatorEntryV1, BoundaryCertificate, GameCheckpointKind, GameRunnerOptions, GameStreamEvent, GameStateSnapshot, HouseContinuityCapsule, HouseCouncilRoleFact, HouseCoveredWindow, HouseEvidenceBundle, HouseGameplaySummaryResult, HouseRoundFacts, HouseStrategyBiblePacket, HouseVoteCount, IAgent, PlayerContinuityCapsule, RuntimeSnapshotV1, TranscriptEntry } from "./game-runner.types";
import type { TokenTracker } from "./token-tracker";
import {
  accumulatorProof,
  buildActorWitness,
  buildPhaseAccumulatorRegistry,
  buildRuntimeSnapshotV1,
  buildTranscriptWatermark,
  createEngineBoundaryPlaceholder,
  requiredPhaseBoundaryAccumulatorIds,
} from "./runtime-snapshot";

// Internal modules
import { TranscriptLogger } from "./transcript-logger";
import { ContextBuilder } from "./context-builder";
import { DiaryRoom } from "./diary-room";
import type { PhaseRunnerContext, PhaseActor } from "./phases";
import {
  runIntroductionPhase,
  runLobbyPhase, runReckoningLobby, runTribunalLobby,
  runMinglePhase,
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
  private readonly durableEventSink?: GameRunnerOptions["durableEventSink"];
  private readonly durableCheckpointSink?: GameRunnerOptions["durableCheckpointSink"];
  private readonly beforeAcceptedCommit?: GameRunnerOptions["beforeAcceptedCommit"];
  private readonly tokenTracker?: TokenTracker;
  private flushedCanonicalSequence = 0;
  private readonly writtenCheckpointKeys = new Set<string>();
  private houseStrategyBible: HouseStrategyBiblePacket | null = null;
  private readonly completedHouseSummaryRounds = new Set<number>();
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

  constructor(
    agents: IAgent[],
    config: GameConfig,
    houseInterviewer?: IHouseInterviewer,
    options: GameRunnerOptions = {},
  ) {
    const scaledMaxRounds = computeMaxRounds(agents.length);
    this.config = { ...config, maxRounds: Math.max(config.maxRounds, scaledMaxRounds) };
    this.totalPlayerCount = agents.length;
    this.agents = new Map(agents.map((a) => [a.id, a]));
    const gameStateOptions = options.gameId ? { gameId: options.gameId } : {};
    this.gameState = new GameState(agents.map((a) => ({ id: a.id, name: a.name })), gameStateOptions);
    this.machine = createPhaseMachine();
    this.houseInterviewer = houseInterviewer ?? new TemplateHouseInterviewer();
    this.durableEventSink = options.durableEventSink;
    this.durableCheckpointSink = options.durableCheckpointSink;
    this.beforeAcceptedCommit = options.beforeAcceptedCommit;
    this.tokenTracker = options.tokenTracker;

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
      () => this.houseStrategyBible,
      () => this.buildHouseRoundFacts(this.gameState.round),
    );
    if (this.durableEventSink) {
      this.logger.beginStreamBuffering();
    }
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

  /** Register a listener for canonical accepted domain events. */
  setCanonicalEventListener(listener: CanonicalEventListener): () => void {
    return this.gameState.subscribeCanonicalEvents(listener, { replayExisting: true });
  }

  /** Read the canonical accepted domain events emitted so far. */
  getCanonicalEvents(): readonly CanonicalGameEvent[] {
    return this.gameState.getCanonicalEvents();
  }

  /** Read the live domain projection used by replay parity tests. */
  getDomainProjection(): CanonicalGameProjection {
    return this.gameState.getDomainProjection();
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

  /** Whether the runner has been asked to stop before normal completion. */
  get aborted(): boolean {
    return this._aborted;
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async run(): Promise<{ winner?: UUID; winnerName?: string; rounds: number; transcript: TranscriptEntry[]; eliminationOrder: string[] }> {
    const gameId = this.gameState.gameId;
    const allPlayers = this.gameState.getAllPlayers().map((p) => ({ id: p.id, name: p.name }));

    await this.flushDurableEvents({
      continueBuffering: true,
      checkpointKind: "initial",
      phase: Phase.INIT,
    });

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
    try {
      await this.runGameLoop(actor);
    } finally {
      actor.stop();
    }
    this.bus.complete();

    if (this._aborted && this.durableEventSink) {
      this.logger.dropStreamBuffer();
      throw new Error("Game run aborted");
    }

    await this.flushDurableEvents({
      continueBuffering: false,
      checkpointKind: "terminal",
      phase: Phase.END,
    });

    const winner = this.gameState.getWinner();
    if (!this.durableEventSink) {
      this.logger.emitStream({
        type: "game_over",
        winner: winner?.id,
        winnerName: winner?.name,
        totalRounds: this.gameState.round,
      });
    }
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
      houseInterviewer: this.houseInterviewer,
      mingleInbox: this.mingleInbox,
      eliminationOrder: this.eliminationOrder,
      beforeAcceptedCommit: this.beforeAcceptedCommit,
    };
  }

  private async flushDurableEvents(options: {
    continueBuffering: boolean;
    checkpointKind?: GameCheckpointKind;
    phase?: Phase;
    phaseActor?: PhaseActor;
  }): Promise<void> {
    if (!this.durableEventSink) return;

    const pendingEvents = this.gameState
      .getCanonicalEvents()
      .filter((event) => event.sequence > this.flushedCanonicalSequence);

    try {
      if (pendingEvents.length > 0) {
        await this.durableEventSink(pendingEvents);
        this.flushedCanonicalSequence = pendingEvents[pendingEvents.length - 1]!.sequence;
      }
      this.logger.flushStreamBuffer();
      if (options.checkpointKind) {
        await this.writeCheckpoint(options.checkpointKind, options.phase, options.phaseActor);
      }
      if (options.continueBuffering) {
        this.logger.beginStreamBuffering();
      }
    } catch (error) {
      this.logger.dropStreamBuffer();
      throw error;
    }
  }

  private buildPhaseBoundaryAccumulators(): AccumulatorEntryV1[] {
    const mingleInboxSize = [...this.mingleInbox.values()].reduce((sum, inbox) => sum + inbox.length, 0);
    const streamBufferDrained = this.logger.isStreamBufferEmpty();
    const accusationsSize = this._currentAccusations.size;

    return requiredPhaseBoundaryAccumulatorIds().map((id) => {
      switch (id) {
        case "mingleInbox":
          return mingleInboxSize === 0
            ? { id, status: "empty" as const, proof: accumulatorProof("empty_at_boundary", "no mingle inbox messages at boundary") }
            : { id, status: "blocked" as const };
        case "transcriptStreamBuffer":
          return streamBufferDrained
            ? { id, status: "drained" as const, proof: accumulatorProof("drained_at_boundary", "stream buffer flushed before checkpoint") }
            : { id, status: "blocked" as const };
        case "currentAccusations":
          return accusationsSize === 0
            ? { id, status: "empty" as const, proof: accumulatorProof("empty_at_boundary", "no active accusations at boundary") }
            : { id, status: "blocked" as const };
        default:
          return { id, status: "malformed" as const };
      }
    });
  }

  private async writeCheckpoint(
    kind: GameCheckpointKind,
    phase?: Phase,
    phaseActor?: PhaseActor,
  ): Promise<void> {
    if (!this.durableCheckpointSink) return;

    const canonicalEvents = this.gameState.getCanonicalEvents();
    const lastEvent = canonicalEvents.findLast((event) => event.sequence <= this.flushedCanonicalSequence);
    const checkpointPhase = phase ?? lastEvent?.phase ?? Phase.INIT;
    const checkpointKey = `${kind}:${this.flushedCanonicalSequence}`;
    if (this.writtenCheckpointKeys.has(checkpointKey)) return;

    const projection = this.getDomainProjection();
    const allPlayers = this.gameState.getAllPlayers();
    const alivePlayerCount = allPlayers.filter((player) => player.status === PlayerStatus.ALIVE).length;
    const eliminatedPlayerCount = allPlayers.length - alivePlayerCount;

    const playerContinuityCapsules: PlayerContinuityCapsule[] = [];
    for (const [id, ag] of this.agents) {
      const partial = ag.getContinuityCapsule?.() ?? null;
      if (partial) {
        playerContinuityCapsules.push({
          playerId: id,
          playerName: ag.name,
          ...partial,
        });
      }
    }
    const houseContinuityCapsule: HouseContinuityCapsule | null = this.houseStrategyBible
      ? { ...this.houseStrategyBible }
      : null;

    let tokenCursor = this.tokenTracker?.toCursor() ?? null;
    const transcriptEntryCount = this.logger.transcript.length;
    const hasRuntimeSnapshot = phaseActor != null && kind === "phase_boundary";

    const boundaryCertificate: BoundaryCertificate = {
      gameId: this.gameState.gameId,
      boundarySequence: this.flushedCanonicalSequence,
      checkpointReason: kind,
      phase: checkpointPhase,
      round: this.gameState.round,
      eventCommitReceipt: null,
      noPendingEffectsAsserted: true,
    };

    let runtimeSnapshot: RuntimeSnapshotV1 | null = null;
    if (hasRuntimeSnapshot) {
      const actorSnapshot = phaseActor.getSnapshot();
      const boundary = createEngineBoundaryPlaceholder({
        boundarySequence: this.flushedCanonicalSequence,
        checkpointKind: kind,
        phase: checkpointPhase,
        round: this.gameState.round,
      });
      tokenCursor = tokenCursor ? { ...tokenCursor, boundary } : null;
      const actorWitness = buildActorWitness({
        boundary,
        actorCoordinate: String(actorSnapshot.value),
        actorStatus: actorSnapshot.status === "done" ? "done" : "active",
        round: this.gameState.round,
        phase: checkpointPhase,
        alivePlayerIds: this.gameState.getAlivePlayers().map((player) => player.id),
      });
      const accumulatorRegistry = buildPhaseAccumulatorRegistry({
        boundary,
        entries: this.buildPhaseBoundaryAccumulators(),
      });
      const transcriptWatermark = buildTranscriptWatermark({
        boundary,
        lastCanonicalSequence: this.flushedCanonicalSequence,
        entryCount: transcriptEntryCount,
        boundaryDigest: `transcript-boundary:${this.flushedCanonicalSequence}:${transcriptEntryCount}`,
      });
      runtimeSnapshot = buildRuntimeSnapshotV1({
        boundary,
        actorWitness,
        accumulatorRegistry,
        transcriptWatermark,
      });
    }

    const transcriptCursor = runtimeSnapshot
      ? {
          entries: transcriptEntryCount,
          version: 1,
          durableBoundary: true,
          boundaryDigest: runtimeSnapshot.transcriptWatermark.boundaryDigest,
          lastCanonicalSequence: this.flushedCanonicalSequence,
        }
      : { entries: transcriptEntryCount };

    await this.durableCheckpointSink({
      gameId: this.gameState.gameId,
      lastEventSequence: this.flushedCanonicalSequence,
      checkpointKind: kind,
      phase: checkpointPhase,
      round: this.gameState.round,
      eventCount: canonicalEvents.length,
      projection,
      state: {
        gameId: this.gameState.gameId,
        round: this.gameState.round,
        alivePlayerCount,
        eliminatedPlayerCount,
      },
      projectionSummary: {
        gameId: projection.gameId,
        lastSequence: projection.lastSequence,
        round: projection.round,
        phase: projection.phase,
        alivePlayerCount,
        eliminatedPlayerCount,
        roomAllocationRounds: Object.keys(projection.roomAllocations).length,
        roundResultCount: projection.roundResults.length,
      },
      boundaryCertificate,
      playerContinuityCapsules,
      houseContinuityCapsule,
      runtimeSnapshot,
      transcriptCursor,
      tokenCostCursor: tokenCursor,
    });
    this.writtenCheckpointKeys.add(checkpointKey);
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
      } else if (state === "vote") {
        if (this.gameState.round > 1) {
          await this.diaryRoom.runStrategicReflections(Phase.VOTE, { timing: "pre_vote" });
        }
        await runVotePhase(prc, actor);
        await this.diaryRoom.runStrategicReflections(Phase.VOTE);
      } else if (state === "power") {
        await runPowerPhase(prc, actor);
        if (!this.gameState.councilCandidates) {
          await this.emitHouseRoundInterstitial(Phase.POWER);
        }
      } else if (state === "reveal") {
        await runRevealPhase(prc, actor);
      } else if (state === "council") {
        await runCouncilPhase(prc, actor);
        await this.emitHouseRoundInterstitial(Phase.COUNCIL);
        await this.runConfiguredDiaryRoom(Phase.COUNCIL);

        // --- THE RECKONING (4 -> 3) ---
      } else if (state === "reckoning_lobby") {
        await runReckoningLobby(prc, actor);
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
      if (this._aborted && this.durableEventSink) {
        this.logger.dropStreamBuffer();
        throw new Error("Game run aborted");
      }
      await this.flushDurableEvents({
        continueBuffering: true,
        checkpointKind: "phase_boundary",
        phase: this.gameState.getCanonicalEvents().at(-1)?.phase ?? Phase.INIT,
        phaseActor: actor,
      });
    }

    if (!this._aborted) {
      await completionPromise;
    }
  }

  private houseRoundSummariesEnabled(): boolean {
    return this.config.enableHouseRoundSummaries !== false;
  }

  private houseStrategyBibleEnabled(): boolean {
    return this.config.enableHouseStrategyBible === true;
  }

  private houseLongFormSummariesEnabled(): boolean {
    return this.config.enableHouseLongFormSummaries === true;
  }

  private async emitHouseRoundInterstitial(resolvedPhase: Phase): Promise<void> {
    const round = this.gameState.round;
    if (round <= 0 || this.completedHouseSummaryRounds.has(round) || !this.houseRoundSummariesEnabled()) {
      return;
    }
    this.completedHouseSummaryRounds.add(round);

    const coveredWindow = this.buildHouseCoveredWindow(resolvedPhase);
    const evidence = this.buildHouseEvidenceBundle(resolvedPhase);

    if (this.houseStrategyBibleEnabled()) {
      try {
        const update = await this.houseInterviewer.updateStrategyBible({
          round,
          phase: resolvedPhase,
          previousPacket: this.houseStrategyBible,
          evidence,
          coveredWindow,
        });
        if (update.packet) {
          this.houseStrategyBible = update.packet;
          this.logger.emitAgentTurn({
            phase: resolvedPhase,
            action: "house-strategy-bible",
            actor: { name: "House", role: "house" },
            visibility: "private",
            response: {
              packet: update.packet,
              rationale: update.rationale,
            },
            thinking: update.thinking,
            reasoningContext: update.reasoningContext,
            scope: "thinking",
          });
        }
      } catch {
        // House packet generation is producer/debug work; never break the game loop.
      }
    }

    const summaryContext = {
      round,
      phase: resolvedPhase,
      kind: "round" as const,
      alivePlayers: this.gameState.getAlivePlayers().map((player) => player.name),
      packet: this.houseStrategyBible,
      evidence,
      coveredWindow,
    };

    try {
      const summary = await this.houseInterviewer.generateHouseSummary(summaryContext);
      this.emitHouseSummaryTurn("house-mc-summary", resolvedPhase, summary, "system", evidence.roundFacts);
      this.logger.logSystem(summary.summary, resolvedPhase);
    } catch {
      // non-fatal for summary generation
    }

    if (this.houseLongFormSummariesEnabled()) {
      try {
        const longForm = await this.houseInterviewer.generateLongFormGameplaySummary({
          ...summaryContext,
          kind: "long-form",
        });
        this.emitHouseSummaryTurn("house-long-form-summary", resolvedPhase, longForm, "private", evidence.roundFacts);
      } catch {
        // non-fatal for producer catch-up generation
      }
    }
  }

  private emitHouseSummaryTurn(
    action: "house-mc-summary" | "house-long-form-summary",
    phase: Phase,
    summary: HouseGameplaySummaryResult,
    visibility: "private" | "system",
    facts?: HouseRoundFacts,
  ): void {
    this.logger.emitAgentTurn({
      phase,
      action,
      actor: { name: "House", role: "house" },
      visibility,
      response: {
        summary: summary.summary,
        kind: summary.kind,
        packetRevisionId: summary.packetRevisionId,
        coveredWindow: summary.coveredWindow,
        referencedAllianceNames: summary.referencedAllianceNames,
        openQuestions: summary.openQuestions ?? [],
        ...(facts ? { roundFacts: facts } : {}),
      },
      thinking: summary.thinking,
      reasoningContext: summary.reasoningContext,
      scope: "system",
      text: summary.summary,
    });
  }

  private buildHouseCoveredWindow(toPhase: Phase): HouseCoveredWindow {
    return {
      fromRound: this.houseStrategyBible?.updatedAtRound ?? 1,
      toRound: this.gameState.round,
      ...(this.houseStrategyBible?.updatedAtPhase && { fromPhase: this.houseStrategyBible.updatedAtPhase }),
      toPhase,
    };
  }

  private buildHouseCouncilRoles(
    councilCandidates: [UUID, UUID] | null,
    councilResolved: Extract<CanonicalGameEvent, { type: "council.elimination_resolved" }> | null,
  ): HouseCouncilRoleFact[] {
    const candidateNames = councilCandidates
      ? [this.gameState.getPlayerName(councilCandidates[0]), this.gameState.getPlayerName(councilCandidates[1])] as [string, string]
      : null;
    const eliminatedId = councilResolved?.payload.eliminated ?? null;
    const eliminatedName = eliminatedId ? this.gameState.getPlayerName(eliminatedId) : null;
    const survivingCandidateId = councilCandidates?.find((id) => id !== eliminatedId) ?? null;
    const survivingCandidateName = survivingCandidateId ? this.gameState.getPlayerName(survivingCandidateId) : null;
    const votes = councilResolved?.payload.tally.votes ?? this.gameState.currentCouncilTally.votes;
    const empoweredId = councilResolved?.payload.empoweredId ?? this.gameState.empoweredId ?? null;

    return this.gameState.getAllPlayers().map((player) => {
      const votedForId = votes[player.id];
      const votedForName = votedForId ? this.gameState.getPlayerName(votedForId) : null;
      if (!councilCandidates) {
        return {
          playerName: player.name,
          role: "not_applicable",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName,
        };
      }
      if (councilCandidates.includes(player.id)) {
        return {
          playerName: player.name,
          role: "candidate",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName: null,
        };
      }
      if (votedForId && player.id === empoweredId) {
        return {
          playerName: player.name,
          role: "empowered_tiebreaker",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName,
        };
      }
      if (votedForId && votedForId === eliminatedId) {
        return {
          playerName: player.name,
          role: "voted_for_eliminated",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName,
        };
      }
      if (votedForId) {
        return {
          playerName: player.name,
          role: "voted_for_survivor",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName,
        };
      }
      return {
        playerName: player.name,
        role: "non_voter",
        candidateNames,
        eliminatedName,
        survivingCandidateName,
        votedForName,
      };
    });
  }

  private buildHouseRoundFacts(round: number): HouseRoundFacts {
    const events = this.gameState.getCanonicalEvents().filter((event) => event.round === round);
    const empowerTally = this.latestRoundEvent(events, "vote.empower_tally_resolved");
    const empoweredSet = this.latestRoundEvent(events, "vote.empowered_set");
    const powerAction = this.latestRoundEvent(events, "power.action_set");
    const candidatesResolved = this.latestRoundEvent(events, "power.candidates_resolved");
    const councilResolved = this.latestRoundEvent(events, "council.elimination_resolved");
    const playerEliminated = this.latestRoundEvent(events, "player.eliminated");

    const councilCandidates = councilResolved?.payload.candidates
      ?? candidatesResolved?.payload.candidates
      ?? this.gameState.councilCandidates;
    const empoweredId = empoweredSet?.payload.empowered
      ?? councilResolved?.payload.empoweredId
      ?? this.gameState.empoweredId;

    return {
      round,
      empoweredName: empoweredId ? this.gameState.getPlayerName(empoweredId) : null,
      empowerMethod: empoweredSet?.payload.method ?? empowerTally?.payload.method ?? null,
      empowerVoteCounts: this.buildVoteCounts(this.gameState.currentVoteTally.empowerVotes),
      exposeVoteCounts: this.buildVoteCounts(this.gameState.currentVoteTally.exposeVotes),
      councilCandidates: councilCandidates
        ? [this.gameState.getPlayerName(councilCandidates[0]), this.gameState.getPlayerName(councilCandidates[1])]
        : null,
      powerAction: powerAction
        ? {
            action: powerAction.payload.action.action,
            targetName: powerAction.payload.action.action === "pass"
              ? null
              : this.gameState.getPlayerName(powerAction.payload.action.target),
          }
        : null,
      shieldGrantedName: candidatesResolved?.payload.shieldGranted
        ? this.gameState.getPlayerName(candidatesResolved.payload.shieldGranted)
        : null,
      autoEliminatedName: candidatesResolved?.payload.autoEliminated
        ? this.gameState.getPlayerName(candidatesResolved.payload.autoEliminated)
        : null,
      councilVoteCounts: councilCandidates
        ? this.buildVoteCounts(
            councilResolved?.payload.tally.votes ?? this.gameState.currentCouncilTally.votes,
            [...councilCandidates],
            councilResolved?.payload.empoweredId ?? this.gameState.empoweredId ?? undefined,
          )
        : [],
      councilMethod: councilResolved?.payload.method ?? null,
      eliminatedName: playerEliminated?.payload.playerName
        ?? (councilResolved?.payload.eliminated ? this.gameState.getPlayerName(councilResolved.payload.eliminated) : null),
      councilRoles: this.buildHouseCouncilRoles(councilCandidates, councilResolved),
    };
  }

  private latestRoundEvent<TType extends CanonicalGameEvent["type"]>(
    events: readonly CanonicalGameEvent[],
    type: TType,
  ): Extract<CanonicalGameEvent, { type: TType }> | null {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === type) {
        return event as Extract<CanonicalGameEvent, { type: TType }>;
      }
    }
    return null;
  }

  private buildVoteCounts(
    votes: Record<UUID, UUID>,
    knownTargets: UUID[] = [],
    excludedVoterId?: UUID,
  ): HouseVoteCount[] {
    const counts = new Map<UUID, { votes: number; voters: string[]; knownIndex: number }>();
    for (const [index, targetId] of knownTargets.entries()) {
      counts.set(targetId, { votes: 0, voters: [], knownIndex: index });
    }

    for (const [voterId, targetId] of Object.entries(votes) as Array<[UUID, UUID]>) {
      if (voterId === excludedVoterId) continue;
      if (knownTargets.length > 0 && !knownTargets.includes(targetId)) continue;
      const current = counts.get(targetId) ?? { votes: 0, voters: [], knownIndex: Number.MAX_SAFE_INTEGER };
      current.votes += 1;
      current.voters.push(this.gameState.getPlayerName(voterId));
      counts.set(targetId, current);
    }

    return Array.from(counts.entries())
      .filter(([, count]) => count.votes > 0 || count.knownIndex !== Number.MAX_SAFE_INTEGER)
      .sort(([, a], [, b]) => b.votes - a.votes || a.knownIndex - b.knownIndex)
      .map(([playerId, count]) => ({
        playerName: this.gameState.getPlayerName(playerId),
        votes: count.votes,
        voters: count.voters,
      }));
  }

  private buildHouseEvidenceBundle(phase: Phase): HouseEvidenceBundle {
    const allPlayers = this.gameState.getAllPlayers();
    const alivePlayers = this.gameState.getAlivePlayers();
    const roomAllocations = this.logger.transcript
      .filter((entry) => entry.roomMetadata)
      .map((entry) => ({
        round: entry.round,
        text: entry.text,
        rooms: entry.roomMetadata?.rooms.map((room) => ({
          roomId: room.roomId,
          players: room.playerIds.map((playerId) => this.gameState.getPlayerName(playerId)),
        })) ?? [],
        excluded: entry.roomMetadata?.excluded ?? [],
      }));

    const candidates = this.gameState.councilCandidates;
    return {
      round: this.gameState.round,
      phase,
      alivePlayers: alivePlayers.map((player) => player.name),
      eliminatedPlayers: allPlayers
        .filter((player) => player.status === PlayerStatus.ELIMINATED)
        .map((player) => player.name),
      activeShieldNames: alivePlayers.filter((player) => player.shielded).map((player) => player.name),
      empoweredName: this.gameState.empoweredId ? this.gameState.getPlayerName(this.gameState.empoweredId) : null,
      councilCandidates: candidates
        ? [this.gameState.getPlayerName(candidates[0]), this.gameState.getPlayerName(candidates[1])]
        : null,
      recentTranscript: [...this.logger.transcript],
      recentPublicMessages: [...this.logger.publicMessages],
      recentDiaryEntries: [...this.diaryRoom.diaryEntries],
      roomAllocations,
      roundFacts: this.buildHouseRoundFacts(this.gameState.round),
      canonicalEventCount: this.gameState.getCanonicalEvents().length,
    };
  }

  private async runConfiguredDiaryRoom(phase: Phase): Promise<void> {
    if (!this.config.diaryRoomAfterPhases?.includes(phase)) {
      return;
    }
    await this.diaryRoom.runDiaryRoom(phase);
  }
}
