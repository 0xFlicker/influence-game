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
import {
  buildMingleInboxReplayFromTranscript,
  hydrateMingleInboxFromReplay,
  mingleInboxSessionForResumeTarget,
} from "./mingle-inbox-replay";
import {
  buildFormatKernelStateForResume,
  isFormatResumeCoordinate,
  resolveEmpoweredIdForRound,
  validateFormatResumePrerequisites,
} from "./format-recovery";
import { resolveFormatManifest } from "./formats";

// Re-export types from the extracted module for backward compatibility
export type { ActorWitnessV1, AgentCallOptions, AgentResponse, AgentTurnEvent, AllianceAction, AllianceActionBase, AllianceActionKind, AllianceActionOpportunity, AllianceActionOpportunityTerms, AllianceAmendAction, AllianceCounterAction, AllianceHuddlePromptContext, AllianceHuddleTurnAction, AlliancePassAction, AllianceProposalAction, AllianceProposalResponseAction, BoundaryCertificate, CandidateChoiceRequest, CandidateSelectionDecision, CheckpointBoundaryIdentityV1, CurrentAccusationRecordV1, CurrentAccusationsAccumulatorV1, EliminationContext, EliminationVoteDisclosure, EmpowerRevoteAction, FormatDecisionFallbackReason, FormatDecisionProvenance, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, GameStreamEvent, GameStateSnapshot, HouseGameplaySummaryContext, HouseGameplaySummaryResult, HouseSummaryKind, IAgent, MingleInboxReplay, MingleIntentAction, MingleIntentSummary, MinglePreferredRoomSize, MingleTurnAction, PhaseAccumulatorRegistryV1, PhaseContext, PlayerAllianceContext, PlayerAllianceContextAlliance, PlayerAllianceContextProposal, PlayerAllianceContextTerms, PlayerContinuityCapsule, PlayerPowerActionMemoryEntry, PlayerRoundHistoryEntry, PowerActionDecision, PowerActionOptions, PowerLobbyExposure, PrivateDecisionTrace, PrivateDecisionTraceActor, PrivateDecisionTraceActorRole, PrivateDecisionTraceBoundary, PrivateDecisionTraceContext, PrivateDecisionTraceMessage, PrivateDecisionTraceToolCall, PrivateTraceSink, PromptReuseReceipt, ProviderReasoningSummary, ProviderReasoningSummaryMode, RecentDecisionContextEntry, RuntimeSnapshotV1, StrategicLens, StrategicDecisionMetadata, TargetDecision, TokenCostCursor, TranscriptDialogueContext, TranscriptDialogueContextV1, TranscriptDialogueKind, TranscriptEntry, TranscriptWatermarkV1, RecallPromptClass, RecallContinuitySnapshot, RecallBoardContractFacts, RecallProtectedHuddleOutcome, RecallHotMessage, RecallHistoryDialogueEvidence, RecallPlanBudgetLedger, RecallPlanProtectedLane, RecallPlanHotLane, RecallPlanHistoryLane, RecallPlanReceipt, RecallPlan } from "./game-runner.types";
export type {
  HouseNarrativeTurnContext,
  HouseSummaryAttemptResult,
  HouseSummaryEmittedResult,
  HouseSummaryFailedResult,
  HouseSummaryModelSkippedResult,
} from "./game-runner.types";
export type {
  DurableGameTurnCommittedV1,
  DurableGameTurnInitializationV1,
  DurableGameTurnPlanV1,
  DurableGameTurnSnapshotV1,
  DurableGameTurnStore,
  DurableProviderTurnBinding,
} from "./game-runner.types";
export { PLAYER_CONTINUITY_CAPSULE_VERSION } from "./game-runner.types";
export {
  HOUSE_NARRATIVE_CONTINUITY_VERSION,
  HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
  appendRecentHouseNarrativeBeat,
  compileHouseNarrationContext,
  createEmptyHouseNarrativeContinuity,
  isHouseSummaryActorCoordinate,
} from "./house-summary-frontier";
export type {
  HouseBeatClass,
  HouseBeatStatus,
  HouseNarrationContext,
  HouseNarrativeBeat,
  HouseNarrativeContinuityV2,
  HouseProviderUsage,
  HouseSummaryBoundary,
  HouseSummaryPhaseTelemetry,
  HouseSummaryActorCoordinate,
} from "./house-summary-frontier";
export {
  parsePlayerContinuityCapsule,
  validatePlayerContinuitySetForRecovery,
} from "./player-continuity";
import type { AccumulatorEntryV1, BoundaryCertificate, CheckpointBoundaryIdentityV1, CurrentAccusationRecordV1, CurrentAccusationsAccumulatorV1, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, GameRunnerResumeActorCoordinate, GameStreamEvent, GameStateSnapshot, HouseCoveredWindow, HouseSummaryAttemptResult, IAgent, PlayerContinuityCapsule, RuntimeSnapshotV1, TranscriptEntry } from "./game-runner.types";
import type { TokenTracker } from "./token-tracker";
import type {
  DurableGameTurnCommittedV1,
  DurableGameTurnSnapshotV1,
  DurableGameTurnStore,
} from "./game-runner.types";
import type {
  GameExecutionCursorV1,
  GameTurnIntentV1,
} from "./durable-game-turn";
import {
  buildTurnCommitDraft,
  capturePlayerContinuity,
  collectStagedEffects,
  createDurableTurnIntent,
  createStagedAgents,
  seededRandom,
  toDurableJsonObject,
  type DurableTurnIntentInput,
  type StagedTurnEffects,
} from "./durable-game-runner";
import {
  HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
  appendRecentHouseNarrativeBeat,
  compileHouseNarrationContext,
  createEmptyHouseNarrativeContinuity,
  houseSummaryCharacterLimit,
  isHouseSummaryActorCoordinate,
  isBoundedHouseAuthoredText,
  parseHouseNarrativeContinuity,
  type HouseBeatClass,
  type HouseNarrativeContinuityV2,
  type HouseSummaryActorCoordinate,
  type HouseSummaryBoundary,
  type HouseSummaryPhaseTelemetry,
} from "./house-summary-frontier";
import {
  accumulatorProof,
  buildActorWitness,
  buildCurrentAccusationsAccumulator,
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
import type { FormatKernelState, PhaseRunnerContext, PhaseActor } from "./phases";
import {
  runIntroductionPhase,
  runLobbyPhase, runReckoningLobby, runTribunalLobby,
  runAllianceFormationPhase, runAllianceHuddleWindow,
  runMinglePhase,
  runVotePhase, runReckoningVote, runTribunalVote,
  runFormatMenuPhase, runFormatPickPhase, runFormatMinglePhase, runFormatResolvePhase,
  runPowerPhase,
  runRevealPhase, runCouncilPhase,
  runReckoningPlea,
  runTribunalAccusation, runTribunalDefense,
  runJudgmentOpening, runJudgmentJuryQuestions, runJudgmentClosing, runJudgmentJuryVote,
} from "./phases";
import {
  applyIntroductionBatch,
  collectIntroductionBatch,
} from "./phases/introduction";
import {
  beginLobbyPhase,
  computeLobbyMessagesPerPlayer,
  runLobbySpeakerTurn,
} from "./phases/lobby";
import {
  applyEmpowerRevoteBatch,
  applyEmpowerVoteBatch,
  collectEmpowerRevoteBatch,
  collectEmpowerVoteBatch,
  finishEmpowerVote,
  resolveEmpowerRevote,
  tallyEmpowerVote,
} from "./phases/vote";

// ---------------------------------------------------------------------------
// Game Runner
// ---------------------------------------------------------------------------

function houseSummaryBoundariesEqual(
  left: HouseSummaryBoundary,
  right: HouseSummaryBoundary,
): boolean {
  return left.version === right.version
    && left.id === right.id
    && left.gameId === right.gameId
    && left.actorCoordinate === right.actorCoordinate
    && left.round === right.round
    && left.phase === right.phase
    && left.beatClass === right.beatClass
    && left.canonicalHead === right.canonicalHead
    && left.dialogueHead === right.dialogueHead;
}

interface DurableHouseBeatInput {
  actorCoordinate: HouseSummaryActorCoordinate;
  phase: Phase;
  beatClass: HouseBeatClass;
  roundMilestone: boolean;
}

interface DurablePhaseTurnInput extends DurableTurnIntentInput {
  houseBeat?: DurableHouseBeatInput;
}

export class GameRunner {
  private readonly bus = new GameEventBus();
  private gameState: GameState;
  private readonly machine: ReturnType<typeof createPhaseMachine>;
  private readonly config: GameConfig;
  private readonly agents: Map<UUID, IAgent>;
  private logger: TranscriptLogger;
  private contextBuilder: ContextBuilder;
  private diaryRoom: DiaryRoom;
  private readonly houseInterviewer: IHouseInterviewer;
  private readonly formatKernelState: FormatKernelState = {
    offeredFormats: null,
    selectedFormat: null,
    pressure: null,
    lastSelectedFormat: null,
  };
  private readonly durableEventSink?: GameRunnerOptions["durableEventSink"];
  private readonly durableCheckpointSink?: GameRunnerOptions["durableCheckpointSink"];
  private readonly beforeAcceptedCommit?: GameRunnerOptions["beforeAcceptedCommit"];
  private readonly tokenTracker?: TokenTracker;
  private readonly resumeFrom?: GameRunnerOptions["resumeFrom"];
  private readonly random?: () => number;
  private readonly durableTurnStore?: DurableGameTurnStore;
  private durableTurnSnapshot: DurableGameTurnSnapshotV1 | null = null;
  private agentsStarted = false;
  private durablePreparation: Promise<void> | null = null;
  private streamListener?: (event: GameStreamEvent) => void;
  private readonly canonicalEventListeners = new Set<CanonicalEventListener>();
  private flushedCanonicalSequence = 0;
  private terminalStreamReleased = false;
  private terminalOutcomeDurablyAccepted = false;
  private readonly writtenCheckpointKeys = new Set<string>();
  private readonly houseSummaryTelemetry: HouseSummaryPhaseTelemetry[] = [];
  private houseNarrativeContinuity: HouseNarrativeContinuityV2;
  /** Mingle room messages keyed by recipient */
  private mingleInbox = new Map<UUID, Array<{ from: string; text: string }>>();
  /** Ordered list of eliminated player names */
  private readonly eliminationOrder: string[] = [];
  /** Canonical player IDs in elimination order, independent of display names. */
  private readonly eliminationOrderPlayerIds: UUID[] = [];
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
    const maxRounds = options.maxRoundsMode === "exact"
      ? config.maxRounds
      : Math.max(config.maxRounds, scaledMaxRounds);
    this.totalPlayerCount = agents.length;
    this.agents = new Map(agents.map((a) => [a.id, a]));
    const gameStateOptions = options.gameId ? { gameId: options.gameId } : {};
    this.resumeFrom = options.resumeFrom ?? options.durableUpgradeFrom;
    this.gameState = this.resumeFrom
      ? GameState.fromCanonicalEvents(this.resumeFrom.canonicalEvents)
      : new GameState(agents.map((a) => ({ id: a.id, name: a.name })), {
          ...gameStateOptions,
          formatManifest: resolveFormatManifest(config.formatManifest),
        });
    this.houseNarrativeContinuity = createEmptyHouseNarrativeContinuity(this.gameState.gameId);
    this.config = {
      ...config,
      maxRounds,
      formatManifest: [...this.gameState.formatManifest],
    };
    this.random = options.random;
    if (this.resumeFrom) {
      for (const event of this.resumeFrom.canonicalEvents) {
        if (event.type !== "player.eliminated") continue;
        this.eliminationOrderPlayerIds.push(event.payload.playerId);
        this.eliminationOrder.push(event.payload.playerName);
      }
      this.hydrateFormatKernelStateFromEvents(
        this.resumeFrom.canonicalEvents,
        this.resumeFrom.actorCoordinate,
      );
    }
    this.machine = createPhaseMachine();
    this.houseInterviewer = houseInterviewer ?? new TemplateHouseInterviewer();
    if (options.durableTurnStore && (options.durableEventSink || options.durableCheckpointSink || options.resumeFrom)) {
      throw new Error(
        "durableTurnStore replaces phase-boundary resume, durableEventSink, and durableCheckpointSink",
      );
    }
    this.durableTurnStore = options.durableTurnStore;
    this.durableEventSink = options.durableEventSink;
    this.durableCheckpointSink = options.durableCheckpointSink;
    this.beforeAcceptedCommit = options.beforeAcceptedCommit;
    this.tokenTracker = options.tokenTracker;
    if (this.resumeFrom) {
      this.flushedCanonicalSequence = this.resumeFrom.lastEventSequence;
      this.writtenCheckpointKeys.add(`initial:${this.flushedCanonicalSequence}`);
      this.writtenCheckpointKeys.add(`phase_boundary:${this.flushedCanonicalSequence}`);
      const parsedHouseContinuity = parseHouseNarrativeContinuity(
        this.resumeFrom.houseNarrativeContinuityCapsule,
      );
      if (parsedHouseContinuity.status !== "valid"
          || parsedHouseContinuity.value.gameId !== this.gameState.gameId) {
        throw new Error("Resume House narrative continuity is invalid or belongs to another game.");
      }
      this.houseNarrativeContinuity = parsedHouseContinuity.value;
      if (this.resumeFrom.tokenCostCursor) {
        this.tokenTracker?.loadCursor(this.resumeFrom.tokenCostCursor);
      }
      if (this.resumeFrom.currentAccusations) {
        this.hydrateCurrentAccusations(this.resumeFrom.currentAccusations);
      }
    }

    // Initialize extracted modules
    this.logger = new TranscriptLogger(this.gameState);
    if (this.resumeFrom) {
      this.logger.seed(this.resumeFrom.transcriptReplay);
      hydrateMingleInboxFromReplay(this.mingleInbox, this.resumeFrom.mingleInboxReplay);
      const canonicalHead = this.gameState.getCanonicalEvents().at(-1)?.sequence ?? 0;
      const dialogueHead = this.logger.transcript.reduce(
        (head, entry) => Math.max(head, entry.entrySequence ?? 0),
        0,
      );
      this.houseNarrativeContinuity.examinedCanonicalHead = Math.max(
        this.houseNarrativeContinuity.examinedCanonicalHead,
        canonicalHead,
      );
      this.houseNarrativeContinuity.examinedDialogueHead = Math.max(
        this.houseNarrativeContinuity.examinedDialogueHead,
        dialogueHead,
      );
    }
    this.contextBuilder = new ContextBuilder(
      this.gameState,
      this.logger,
      this.mingleInbox,
      this.totalPlayerCount,
    );
    // Format pressure must attach after ContextBuilder exists so resumed pick/mingle/resolve
    // contexts see the same event-derived card as a live game.
    if (this.formatKernelState.pressure) {
      this.contextBuilder.currentFormatPressure = this.formatKernelState.pressure;
    }
    this.diaryRoom = new DiaryRoom(
      this.gameState,
      this.logger,
      this.contextBuilder,
      this.agents,
      this.config,
      this.houseInterviewer,
      this.beforeAcceptedCommit,
    );
    if (this.durableEventSink) {
      this.logger.beginStreamBuffering();
    }
  }

  get transcriptLog(): readonly TranscriptEntry[] {
    return this.logger.transcript;
  }

  /** Content-free per-boundary House summary provider/cadence telemetry. */
  get houseSummaryPhaseTelemetry(): readonly HouseSummaryPhaseTelemetry[] {
    return this.houseSummaryTelemetry;
  }

  get diaryLog(): ReadonlyArray<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> {
    return this.diaryRoom.diaryEntries;
  }

  get thinkingLog(): ReadonlyArray<{ round: number; phase: Phase; agentId: UUID; agentName: string; text: string }> {
    return this.diaryRoom.thinkingEntries;
  }

  /** Register a listener for real-time game events (for WebSocket streaming). */
  setStreamListener(listener: (event: GameStreamEvent) => void): void {
    this.streamListener = listener;
    this.logger.setStreamListener(listener);
  }

  /**
   * Publish the terminal stream only after the caller has durably settled the
   * completed game. Durable runs retain jury/finale events until this boundary
   * so a failed settlement cannot reveal an outcome the read models still hold
   * as non-final.
   */
  releaseTerminalStream(): void {
    if (!this.durableEventSink || this.terminalStreamReleased) return;
    this.terminalStreamReleased = true;
    this.logger.flushStreamBuffer();
    const winner = this.gameState.getWinner();
    this.logger.emitStream({
      type: "game_over",
      winner: winner?.id,
      winnerName: winner?.name,
      totalRounds: this.gameState.round,
    });
  }

  /** Register a listener for canonical accepted domain events. */
  setCanonicalEventListener(listener: CanonicalEventListener): () => void {
    if (!this.durableTurnStore) {
      return this.gameState.subscribeCanonicalEvents(listener, { replayExisting: true });
    }
    this.canonicalEventListeners.add(listener);
    for (const event of this.gameState.getCanonicalEvents()) listener(structuredClone(event));
    return () => this.canonicalEventListeners.delete(listener);
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

  /**
   * Establish durable execution authority before background work begins.
   * Repeated and concurrent calls share the same initialization attempt, and
   * the explicit roster bootstrap is committed before this method returns.
   */
  async prepareDurableExecution(): Promise<void> {
    if (!this.durableTurnStore) {
      throw new Error("prepareDurableExecution requires a durable turn store");
    }
    if (this.durablePreparation) return this.durablePreparation;
    const preparation = this.prepareDurableExecutionInternal();
    this.durablePreparation = preparation;
    try {
      await preparation;
    } catch (error) {
      if (this.durablePreparation === preparation) this.durablePreparation = null;
      throw error;
    }
  }

  private startAgentsForGame(): void {
    if (this.agentsStarted) return;
    const players = this.gameState.getAllPlayers().map((player) => ({
      id: player.id,
      name: player.name,
    }));
    for (const agent of this.agents.values()) {
      agent.onGameStart(this.gameState.gameId, players);
    }
    this.agentsStarted = true;
  }

  private async prepareDurableExecutionInternal(): Promise<void> {
    const store = this.durableTurnStore;
    if (!store) throw new Error("Durable execution preparation requires a turn store");
    this.startAgentsForGame();

    if (!this.durableTurnSnapshot) {
      const durable = await store.load(this.gameState.gameId);
      if (durable) {
        this.durableTurnSnapshot = structuredClone(durable);
        if (durable.canonicalEvents.length > 0) {
          this.installDurableSnapshot(durable, { publish: false });
        } else if (
          durable.execution.cursor.kind !== "rules"
          || durable.execution.cursor.operation !== "bootstrap_roster"
        ) {
          throw new Error("Empty durable game frontier is not at bootstrap_roster");
        }
      }
    }

    if (!this.durableTurnSnapshot) {
      if (this.resumeFrom && this.durableTurnStore) {
        const upgradeActor = createActor(this.machine, {
          input: {
            gameId: this.gameState.gameId,
            playerIds: this.gameState.getAllPlayers().map((player) => player.id),
            maxRounds: this.config.maxRounds,
          },
        });
        upgradeActor.start();
        try {
          await this.hydratePhaseActorForResume(
            upgradeActor,
            this.resumeFrom.actorCoordinate,
          );
          this.durableTurnSnapshot = await store.initialize({
            version: 1,
            gameId: this.gameState.gameId,
            xstateSnapshot: toDurableJsonObject(upgradeActor.getPersistedSnapshot()),
            cursor: {
              version: 1,
              kind: "phase_enter",
              actor: this.resumeFrom.actorCoordinate,
            },
            playerContinuityCapsules: [...(this.resumeFrom.playerContinuityCapsules ?? [])]
              .map((capsule) => structuredClone(capsule)),
            houseNarrativeContinuity: structuredClone(
              this.resumeFrom.houseNarrativeContinuityCapsule,
            ),
            canonicalEvents: this.resumeFrom.canonicalEvents.map((event) => structuredClone(event)),
            transcriptEntries: this.resumeFrom.transcriptReplay.map((entry) => structuredClone(entry)),
          });
          this.installDurableSnapshot(this.durableTurnSnapshot, { publish: false });
        } finally {
          upgradeActor.stop();
        }
      }
    }

    if (!this.durableTurnSnapshot) {
      const players = this.gameState.getAllPlayers().map((player) => ({
        id: player.id,
        name: player.name,
      }));
      const bootstrapActor = createActor(this.machine, {
        input: {
          gameId: this.gameState.gameId,
          playerIds: players.map((player) => player.id),
          maxRounds: this.config.maxRounds,
        },
      });
      bootstrapActor.start();
      try {
        bootstrapActor.send({ type: "PHASE_COMPLETE" });
        await this.tickPhaseActor();
        this.durableTurnSnapshot = await store.initialize({
          version: 1,
          gameId: this.gameState.gameId,
          xstateSnapshot: toDurableJsonObject(bootstrapActor.getPersistedSnapshot()),
          cursor: { version: 1, kind: "rules", operation: "bootstrap_roster" },
          playerContinuityCapsules: capturePlayerContinuity(this.agents),
          houseNarrativeContinuity: structuredClone(this.houseNarrativeContinuity),
          canonicalEvents: [],
          transcriptEntries: [],
        });
      } finally {
        bootstrapActor.stop();
      }
    }

    if (
      this.durableTurnSnapshot.execution.cursor.kind === "rules"
      && this.durableTurnSnapshot.execution.cursor.operation === "bootstrap_roster"
    ) {
      await this.commitDurableRosterBootstrap();
    }
  }

  async run(): Promise<{
    winner?: UUID;
    winnerName?: string;
    rounds: number;
    transcript: TranscriptEntry[];
    eliminationOrder: string[];
    rankedPlayerIds: UUID[];
  }> {
    const gameId = this.gameState.gameId;
    let allPlayers = this.gameState.getAllPlayers().map((p) => ({ id: p.id, name: p.name }));

    await this.flushDurableEvents({
      continueBuffering: true,
      checkpointKind: "initial",
      phase: Phase.INIT,
    });

    this.startAgentsForGame();

    if (this.durableTurnStore) {
      await this.prepareDurableExecution();
      allPlayers = this.gameState.getAllPlayers().map((player) => ({
        id: player.id,
        name: player.name,
      }));
    }

    if (!this.durableTurnStore && this.resumeFrom?.playerContinuityCapsules?.length) {
      const livingPlayerNames = this.gameState.getAlivePlayers().map((player) => player.name);
      for (const capsule of this.resumeFrom.playerContinuityCapsules) {
        const agent = this.agents.get(capsule.playerId);
        if (!agent?.restoreContinuityCapsule) {
          throw new Error(`Missing agent for continuity capsule ${capsule.playerName}/${capsule.playerId}`);
        }
        agent.restoreContinuityCapsule(capsule, { livingPlayerNames });
      }
    }

    if (this.durableTurnStore) {
      await this.runDurableGameLoop();
    } else {
      const actor = createActor(this.machine, {
        input: {
          gameId,
          playerIds: allPlayers.map((player) => player.id),
          maxRounds: this.config.maxRounds,
        },
      });
      actor.start();
      try {
        await this.runGameLoop(actor);
      } finally {
        actor.stop();
      }
    }
    this.bus.complete();

    if (this._aborted && (this.durableEventSink || this.durableTurnStore)) {
      this.logger.dropStreamBuffer();
      throw new Error("Game run aborted");
    }

    await this.flushDurableEvents({
      continueBuffering: false,
      releaseStream: false,
      checkpointKind: "terminal",
      phase: Phase.END,
    });

    const winner = this.gameState.getWinner();
    const finalistIds = this.gameState.getAllPlayers()
      .filter((player) => player.status === PlayerStatus.ALIVE && player.id !== winner?.id)
      .map((player) => player.id);
    const rankedPlayerIds = [
      ...(winner ? [winner.id] : []),
      ...finalistIds,
      ...[...this.eliminationOrderPlayerIds].reverse(),
    ];
    if (!this.durableEventSink && !this.durableTurnStore) {
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
      rankedPlayerIds,
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
      formatKernelState: this.formatKernelState,
      eliminationOrder: this.eliminationOrder,
      eliminationOrderPlayerIds: this.eliminationOrderPlayerIds,
      beforeAcceptedCommit: this.beforeAcceptedCommit,
      random: this.random,
    };
  }

  private async flushDurableEvents(options: {
    continueBuffering: boolean;
    releaseStream?: boolean;
    checkpointKind?: GameCheckpointKind;
    phase?: Phase;
    phaseActor?: PhaseActor;
  }): Promise<void> {
    if (!this.durableEventSink) return;

    const pendingEvents = this.gameState
      .getCanonicalEvents()
      .filter((event) => event.sequence > this.flushedCanonicalSequence);
    const acceptsTerminalOutcome = pendingEvents.some(
      (event) => event.type === "jury.winner_determined",
    );
    const releaseStream = options.releaseStream !== false
      && !this.terminalOutcomeDurablyAccepted
      && !acceptsTerminalOutcome;

    try {
      if (pendingEvents.length > 0) {
        await this.durableEventSink(pendingEvents);
        this.flushedCanonicalSequence = pendingEvents[pendingEvents.length - 1]!.sequence;
        if (acceptsTerminalOutcome) {
          this.terminalOutcomeDurablyAccepted = true;
        }
      }
      const checkpointedStreamBuffer = releaseStream && options.checkpointKind
        ? this.logger.takeStreamBufferForCheckpoint()
        : null;
      if (options.checkpointKind) {
        await this.writeCheckpoint(options.checkpointKind, options.phase, options.phaseActor);
      }
      if (releaseStream) {
        if (checkpointedStreamBuffer) {
          this.logger.releaseCheckpointedStreamBuffer(checkpointedStreamBuffer);
        } else {
          this.logger.flushStreamBuffer();
        }
      }
      if (options.continueBuffering && releaseStream) {
        this.logger.beginStreamBuffering();
      }
    } catch (error) {
      this.logger.dropStreamBuffer();
      throw error;
    }
  }

  private hydrateCurrentAccusations(capsule: CurrentAccusationsAccumulatorV1): void {
    if (capsule.version !== 1) {
      throw new Error("Phase-boundary resume currentAccusations capsule has unsupported version");
    }
    if (capsule.boundary.boundarySequence !== this.resumeFrom?.lastEventSequence) {
      throw new Error("Phase-boundary resume currentAccusations boundary does not match resume event head");
    }
    const alivePlayerIds = new Set(this.gameState.getAlivePlayers().map((player) => player.id));
    this._currentAccusations.clear();
    for (const item of capsule.items) {
      if (!alivePlayerIds.has(item.targetId) || !alivePlayerIds.has(item.accuserId)) {
        throw new Error("Phase-boundary resume currentAccusations references a non-active player");
      }
      if (item.accusation.trim().length === 0) {
        throw new Error("Phase-boundary resume currentAccusations contains an empty accusation");
      }
      this._currentAccusations.set(item.targetId, {
        accuserId: item.accuserId,
        accuserName: item.accuserName,
        text: item.accusation,
      });
    }
  }

  /**
   * Reconstruct format-kernel runtime state for resume.
   * Anti-repeat history always comes from durable format.selected evidence.
   * Active menu/selection/pressure are restored only for format phase-entry targets.
   */
  private hydrateFormatKernelStateFromEvents(
    events: readonly CanonicalGameEvent[],
    actorCoordinate: string,
  ): void {
    if (isFormatResumeCoordinate(actorCoordinate)) {
      const reason = validateFormatResumePrerequisites(actorCoordinate, events);
      if (reason) {
        throw new Error(`Phase-boundary resume rejected format prefix: ${reason}`);
      }
    }
    const hydrated = buildFormatKernelStateForResume({
      actorCoordinate,
      canonicalEvents: events,
      getPlayerName: (id) => this.gameState.getPlayerName(id),
    });
    this.formatKernelState.offeredFormats = hydrated.offeredFormats;
    this.formatKernelState.selectedFormat = hydrated.selectedFormat;
    this.formatKernelState.pressure = hydrated.pressure;
    this.formatKernelState.lastSelectedFormat = hydrated.lastSelectedFormat;
  }

  private buildCurrentAccusationsPayload(
    boundary: CheckpointBoundaryIdentityV1,
  ): CurrentAccusationsAccumulatorV1 {
    const items: CurrentAccusationRecordV1[] = [...this._currentAccusations.entries()]
      .map(([targetId, accusation]) => ({
        targetId,
        targetName: this.gameState.getPlayerName(targetId),
        accuserId: accusation.accuserId,
        accuserName: accusation.accuserName,
        accusation: accusation.text,
      }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
    return buildCurrentAccusationsAccumulator({ boundary, items });
  }

  private buildPhaseBoundaryAccumulators(boundary: CheckpointBoundaryIdentityV1): AccumulatorEntryV1[] {
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
            : {
                id,
                status: "captured" as const,
                proof: accumulatorProof("captured_at_boundary", "structured current accusations captured for tribunal defense"),
                payload: this.buildCurrentAccusationsPayload(boundary),
              };
        default:
          return { id, status: "malformed" as const };
      }
    });
  }

  private buildTranscriptReplay(): NonNullable<GameCheckpointCapsule["transcriptReplay"]> {
    return {
      version: 2,
      entries: this.logger.transcript.map((entry) => {
        const safeEntry = { ...entry };
        delete safeEntry.thinking;
        delete safeEntry.reasoningContext;
        return structuredClone(safeEntry) as TranscriptEntry;
      }),
    };
  }

  /**
   * Product-dialogue-only projection for checkpoint-aligned durable watermarking.
   * Diary/thinking and any row without a positive entrySequence are excluded.
   */
  private buildProductDialogueProjection(): TranscriptEntry[] {
    return this.logger.transcript
      .filter(
        (entry) =>
          typeof entry.entrySequence === "number" &&
          entry.entrySequence >= 1 &&
          (entry.scope === "public" ||
            entry.scope === "mingle" ||
            entry.scope === "huddle" ||
            entry.scope === "whisper" ||
            entry.scope === "system"),
      )
      .map((entry) => {
        const safeEntry = { ...entry };
        delete safeEntry.thinking;
        delete safeEntry.reasoningContext;
        return structuredClone(safeEntry) as TranscriptEntry;
      });
  }

  private phaseForActorCoordinate(coordinate: string): Phase | undefined {
    switch (coordinate) {
      case "introduction":
        return Phase.INTRODUCTION;
      case "lobby":
      case "reckoning_lobby":
      case "tribunal_lobby":
        return Phase.LOBBY;
      case "mingle_i":
        return Phase.MINGLE_I;
      case "pre_vote_huddle":
        return Phase.PRE_VOTE_HUDDLE;
      case "vote":
      case "reckoning_vote":
      case "tribunal_vote":
        return Phase.VOTE;
      case "format_menu":
        return Phase.FORMAT_MENU;
      case "format_pick":
        return Phase.FORMAT_PICK;
      case "format_mingle":
        return Phase.FORMAT_MINGLE;
      case "format_resolve":
        return Phase.FORMAT_RESOLVE;
      case "post_vote_mingle":
        return Phase.POST_VOTE_MINGLE;
      case "power":
        return Phase.POWER;
      case "reveal":
        return Phase.REVEAL;
      case "pre_council_huddle":
        return Phase.PRE_COUNCIL_HUDDLE;
      case "council":
        return Phase.COUNCIL;
      case "reckoning_plea":
        return Phase.PLEA;
      case "tribunal_accusation":
        return Phase.ACCUSATION;
      case "tribunal_defense":
        return Phase.DEFENSE;
      case "judgment_opening":
        return Phase.OPENING_STATEMENTS;
      case "judgment_jury_questions":
        return Phase.JURY_QUESTIONS;
      case "judgment_closing":
        return Phase.CLOSING_ARGUMENTS;
      case "judgment_jury_vote":
        return Phase.JURY_VOTE;
      default:
        return undefined;
    }
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
    const actorSnapshot = phaseActor?.getSnapshot();
    const actorCoordinate = actorSnapshot ? String(actorSnapshot.value) : "none";
    const checkpointKey = `${kind}:${this.flushedCanonicalSequence}:${actorCoordinate}`;
    if (this.writtenCheckpointKeys.has(checkpointKey)) return;

    const projection = this.getDomainProjection();
    const allPlayers = this.gameState.getAllPlayers();
    const alivePlayerCount = allPlayers.filter((player) => player.status === PlayerStatus.ALIVE).length;
    const eliminatedPlayerCount = allPlayers.length - alivePlayerCount;

    const aliveAgents = this.gameState.getAlivePlayers()
      .map((player) => this.agents.get(player.id))
      .filter((agent): agent is IAgent => agent != null);
    const playerContinuityCapsules: PlayerContinuityCapsule[] = [];
    for (const ag of aliveAgents) {
      const partial = ag.getContinuityCapsule?.() ?? null;
      if (partial) {
        playerContinuityCapsules.push({
          playerId: ag.id,
          playerName: ag.name,
          ...partial,
        });
      }
    }
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
      if (!actorSnapshot) {
        throw new Error("Phase-boundary checkpoint missing phase actor snapshot");
      }
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
        entries: this.buildPhaseBoundaryAccumulators(boundary),
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
      houseNarrativeContinuityCapsule: structuredClone(this.houseNarrativeContinuity),
      transcriptReplay: hasRuntimeSnapshot ? this.buildTranscriptReplay() : null,
      // Transient write input for API product-dialogue watermark; not player-facing.
      productDialogueProjection: this.buildProductDialogueProjection(),
      runtimeSnapshot,
      transcriptCursor,
      tokenCostCursor: tokenCursor,
    });
    this.writtenCheckpointKeys.add(checkpointKey);
  }

  private installDurableSnapshot(
    snapshot: DurableGameTurnSnapshotV1,
    options: { publish: boolean; stagedStreamEvents?: readonly GameStreamEvent[] },
  ): void {
    const previousEventHead = this.gameState.getCanonicalEvents().at(-1)?.sequence ?? 0;
    this.durableTurnSnapshot = structuredClone(snapshot);
    this.gameState = GameState.fromCanonicalEvents(snapshot.canonicalEvents);
    this.logger = new TranscriptLogger(this.gameState);
    this.logger.seed(snapshot.transcriptEntries);
    if (this.streamListener) this.logger.setStreamListener(this.streamListener);

    this.mingleInbox.clear();
    const actorCoordinate = this.actorCoordinateFromDurableSnapshot(snapshot);
    hydrateMingleInboxFromReplay(
      this.mingleInbox,
      buildMingleInboxReplayFromTranscript({
        transcriptReplay: snapshot.transcriptEntries,
        players: this.gameState.getAllPlayers().map((player) => ({
          id: player.id,
          name: player.name,
        })),
        session: mingleInboxSessionForResumeTarget(actorCoordinate),
      }),
    );
    this.contextBuilder = new ContextBuilder(
      this.gameState,
      this.logger,
      this.mingleInbox,
      this.totalPlayerCount,
    );
    this.hydrateDurableContextBuilder(
      this.contextBuilder,
      this.gameState,
      snapshot.canonicalEvents,
    );
    const hydratedFormatState = buildFormatKernelStateForResume({
      actorCoordinate,
      canonicalEvents: snapshot.canonicalEvents,
      getPlayerName: (id) => this.gameState.getPlayerName(id),
    });
    this.formatKernelState.offeredFormats = hydratedFormatState.offeredFormats;
    this.formatKernelState.selectedFormat = hydratedFormatState.selectedFormat;
    this.formatKernelState.pressure = hydratedFormatState.pressure;
    this.formatKernelState.lastSelectedFormat = hydratedFormatState.lastSelectedFormat;
    this.contextBuilder.currentFormatPressure = hydratedFormatState.pressure;
    this.diaryRoom = new DiaryRoom(
      this.gameState,
      this.logger,
      this.contextBuilder,
      this.agents,
      this.config,
      this.houseInterviewer,
      this.beforeAcceptedCommit,
    );

    const livingPlayerNames = this.gameState.getAlivePlayers().map((player) => player.name);
    for (const capsule of snapshot.execution.playerContinuityCapsules) {
      const agent = this.agents.get(capsule.playerId);
      if (!agent?.restoreContinuityCapsule) {
        throw new Error(`Missing agent for durable continuity ${capsule.playerName}/${capsule.playerId}`);
      }
      agent.restoreContinuityCapsule(capsule, { livingPlayerNames });
    }
    this.houseNarrativeContinuity = snapshot.execution.houseNarrativeContinuity
      ? structuredClone(snapshot.execution.houseNarrativeContinuity)
      : createEmptyHouseNarrativeContinuity(this.gameState.gameId);

    this.eliminationOrder.length = 0;
    this.eliminationOrderPlayerIds.length = 0;
    for (const event of snapshot.canonicalEvents) {
      if (event.type !== "player.eliminated") continue;
      this.eliminationOrderPlayerIds.push(event.payload.playerId);
      this.eliminationOrder.push(event.payload.playerName);
    }

    if (!options.publish) return;
    for (const event of snapshot.canonicalEvents) {
      if (event.sequence <= previousEventHead) continue;
      for (const listener of this.canonicalEventListeners) {
        listener(structuredClone(event));
      }
    }
    for (const event of options.stagedStreamEvents ?? []) {
      this.logger.emitStream(structuredClone(event));
    }
  }

  private async commitDurableRosterBootstrap(): Promise<void> {
    const store = this.durableTurnStore;
    const base = this.durableTurnSnapshot;
    if (!store || !base) throw new Error("Roster bootstrap requires initialized durable authority");
    if (base.canonicalEvents.length !== 0 || base.execution.heads.eventSequence !== 0) {
      throw new Error("Roster bootstrap requires an empty committed canonical frontier");
    }
    const rosterEvents = [...this.gameState.getCanonicalEvents()];
    if (rosterEvents.length !== 1 || rosterEvents[0]?.type !== "game.roster_initialized") {
      throw new Error("Roster bootstrap requires exactly one constructor roster event");
    }
    const requestedIntent = createDurableTurnIntent(base.execution, {
      branch: "engine",
      action: "bootstrap-roster",
      actorIds: this.gameState.getAllPlayers().map((player) => player.id),
    });
    const planned = await store.planNextTurn(requestedIntent);
    if (planned.status === "committed") {
      this.installDurableSnapshot(planned.snapshot, { publish: false });
      return;
    }
    const effects: StagedTurnEffects = {
      canonicalEvents: rosterEvents,
      transcriptEntries: [],
      streamEvents: [],
      playerContinuityCapsules: capturePlayerContinuity(this.agents),
      acceptedProviderCallIds: [],
    };
    const draft = buildTurnCommitDraft({
      base,
      intent: planned.intent,
      nextCursor: { version: 1, kind: "phase_enter", actor: "introduction" },
      xstateSnapshot: structuredClone(base.execution.xstateSnapshot),
      houseNarrativeContinuity: structuredClone(this.houseNarrativeContinuity),
      effects,
    });
    let committed: DurableGameTurnCommittedV1;
    try {
      committed = await store.commitTurn(draft);
    } catch (error) {
      const retried = await store.planNextTurn(planned.intent);
      if (retried.status !== "committed") throw error;
      committed = retried;
    }
    this.installDurableSnapshot(committed.snapshot, { publish: true });
  }

  private actorCoordinateFromDurableSnapshot(snapshot: DurableGameTurnSnapshotV1): string {
    const value = snapshot.execution.xstateSnapshot.value;
    if (typeof value !== "string") {
      throw new Error("Durable XState snapshot does not contain a scalar actor coordinate");
    }
    return value;
  }

  private requireDurableSnapshot(): DurableGameTurnSnapshotV1 {
    if (!this.durableTurnSnapshot) {
      throw new Error("Durable execution snapshot is not initialized");
    }
    return this.durableTurnSnapshot;
  }

  private hydrateDurableContextBuilder(
    contextBuilder: ContextBuilder,
    gameState: GameState,
    canonicalEvents: readonly CanonicalGameEvent[],
  ): void {
    const revoteByRoundAndVoter = new Map<string, UUID>();
    for (const event of canonicalEvents) {
      if (event.type !== "vote.empower_revote_cast") continue;
      revoteByRoundAndVoter.set(`${event.round}:${event.payload.voterId}`, event.payload.target);
    }
    contextBuilder.revealVoteLedgerEntries(canonicalEvents.flatMap((event) => {
      if (event.type !== "vote.cast") return [];
      const revoteTargetId = revoteByRoundAndVoter.get(`${event.round}:${event.payload.voterId}`);
      return [{
        round: event.round,
        voterId: event.payload.voterId,
        voterName: gameState.getPlayerName(event.payload.voterId),
        empowerTargetId: event.payload.empowerTarget,
        empowerTargetName: gameState.getPlayerName(event.payload.empowerTarget),
        ...(revoteTargetId ? {
          revoteEmpowerTargetId: revoteTargetId,
          revoteEmpowerTargetName: gameState.getPlayerName(revoteTargetId),
        } : {}),
      }];
    }));
  }

  private createDurableScratch(
    intent: GameTurnIntentV1,
    boundProviderActorIds: ReadonlySet<string>,
  ): {
    actor: PhaseActor;
    context: PhaseRunnerContext;
    readEffects: () => StagedTurnEffects;
    stop: () => void;
  } {
    const base = this.durableTurnSnapshot;
    if (!base) throw new Error("Durable turn execution requires a committed base snapshot");
    const gameState = GameState.fromCanonicalEvents(base.canonicalEvents);
    const logger = new TranscriptLogger(gameState);
    logger.seed(base.transcriptEntries);
    const streamEvents: GameStreamEvent[] = [];
    logger.setStreamListener((event) => streamEvents.push(structuredClone(event)));
    const stagedAgents = createStagedAgents(
      this.agents,
      base.execution.playerContinuityCapsules,
      intent.providerSubcalls.filter(
        (subcall) => subcall.actorId !== null && boundProviderActorIds.has(subcall.actorId),
      ),
    );
    const actorCoordinate = this.actorCoordinateFromDurableSnapshot(base);
    const mingleInbox = new Map<UUID, Array<{ from: string; text: string }>>();
    hydrateMingleInboxFromReplay(
      mingleInbox,
      buildMingleInboxReplayFromTranscript({
        transcriptReplay: base.transcriptEntries,
        players: gameState.getAllPlayers().map((player) => ({
          id: player.id,
          name: player.name,
        })),
        session: mingleInboxSessionForResumeTarget(actorCoordinate),
      }),
    );
    const contextBuilder = new ContextBuilder(
      gameState,
      logger,
      mingleInbox,
      this.totalPlayerCount,
    );
    this.hydrateDurableContextBuilder(
      contextBuilder,
      gameState,
      base.canonicalEvents,
    );
    const formatKernelState = buildFormatKernelStateForResume({
      actorCoordinate,
      canonicalEvents: base.canonicalEvents,
      getPlayerName: (id) => gameState.getPlayerName(id),
    });
    contextBuilder.currentFormatPressure = formatKernelState.pressure;
    const diaryRoom = new DiaryRoom(
      gameState,
      logger,
      contextBuilder,
      stagedAgents.agents,
      this.config,
      this.houseInterviewer,
      this.beforeAcceptedCommit,
    );
    const actor = createActor(this.machine, {
      input: {
        gameId: gameState.gameId,
        playerIds: gameState.getAllPlayers().map((player) => player.id),
        maxRounds: this.config.maxRounds,
      },
      snapshot: base.execution.xstateSnapshot as never,
    });
    actor.start();
    const context: PhaseRunnerContext = {
      gameState,
      agents: stagedAgents.agents,
      config: this.config,
      logger,
      contextBuilder,
      diaryRoom,
      houseInterviewer: this.houseInterviewer,
      mingleInbox,
      formatKernelState,
      eliminationOrder: [...this.eliminationOrder],
      eliminationOrderPlayerIds: [...this.eliminationOrderPlayerIds],
      beforeAcceptedCommit: this.beforeAcceptedCommit,
      random: seededRandom(intent.seed),
    };
    return {
      actor,
      context,
      readEffects: () => collectStagedEffects({
        base,
        canonicalEvents: gameState.getCanonicalEvents(),
        transcriptEntries: logger.transcript,
        streamEvents,
        playerContinuityCapsules: stagedAgents.readContinuity(),
        acceptedProviderCallIds: stagedAgents.readAcceptedProviderCallIds(),
      }),
      stop: () => actor.stop(),
    };
  }

  private async executeDurableTurn(
    input: DurablePhaseTurnInput,
    execute: (
      context: PhaseRunnerContext,
      actor: PhaseActor,
    ) => Promise<GameExecutionCursorV1>,
  ): Promise<void> {
    const store = this.durableTurnStore;
    const base = this.durableTurnSnapshot;
    if (!store || !base) throw new Error("Durable turn coordinator is not initialized");
    const requestedIntent = createDurableTurnIntent(base.execution, input);
    const planned = await store.planNextTurn(requestedIntent);
    if (planned.status === "committed") {
      this.installDurableSnapshot(planned.snapshot, { publish: false });
      return;
    }
    const intent = planned.intent;
    const boundAgents: IAgent[] = [];
    const boundProviderActorIds = new Set<string>();
    for (const subcall of intent.providerSubcalls) {
      if (!subcall.actorId) continue;
      const agent = this.agents.get(subcall.actorId);
      if (!agent?.setDurableProviderTurnBinding) continue;
      agent.setDurableProviderTurnBinding({
        turnId: intent.turnId,
        subcallSlot: subcall.slot,
        logicalCallId: subcall.logicalCallId,
      });
      boundAgents.push(agent);
      boundProviderActorIds.add(subcall.actorId);
    }
    let scratch: ReturnType<GameRunner["createDurableScratch"]>;
    try {
      scratch = this.createDurableScratch(intent, boundProviderActorIds);
    } catch (error) {
      for (const agent of boundAgents) agent.setDurableProviderTurnBinding?.(null);
      throw error;
    }
    let effects: StagedTurnEffects;
    let nextCursor: GameExecutionCursorV1;
    let nextHouseNarrativeContinuity = base.execution.houseNarrativeContinuity
      ? structuredClone(base.execution.houseNarrativeContinuity)
      : createEmptyHouseNarrativeContinuity(base.execution.gameId);
    let xstateSnapshot;
    try {
      nextCursor = await execute(scratch.context, scratch.actor);
      if (input.houseBeat) {
        nextHouseNarrativeContinuity = await this.emitHousePhaseBeatForContext(
          scratch.context,
          nextHouseNarrativeContinuity,
          input.houseBeat,
        );
      }
      await this.tickPhaseActor();
      effects = scratch.readEffects();
      xstateSnapshot = toDurableJsonObject(scratch.actor.getPersistedSnapshot());
    } finally {
      scratch.stop();
      for (const agent of boundAgents) agent.setDurableProviderTurnBinding?.(null);
    }
    const draft = buildTurnCommitDraft({
      base,
      intent,
      nextCursor,
      xstateSnapshot,
      houseNarrativeContinuity: nextHouseNarrativeContinuity,
      effects,
    });
    let committed: DurableGameTurnCommittedV1;
    try {
      committed = await store.commitTurn(draft);
    } catch (error) {
      const retriedPlan = await store.planNextTurn(intent);
      if (retriedPlan.status !== "committed") throw error;
      committed = retriedPlan;
    }
    this.installDurableSnapshot(committed.snapshot, {
      publish: true,
      stagedStreamEvents: effects.streamEvents,
    });
  }

  private isDurableConvertedActorCoordinate(value: string): boolean {
    return value === "introduction"
      || value === "lobby"
      || value === "vote"
      || value === "format_menu"
      || value === "format_pick"
      || value === "format_mingle"
      || value === "format_resolve"
      || value === "reckoning_lobby"
      || value === "reckoning_plea"
      || value === "reckoning_vote"
      || value === "tribunal_lobby"
      || value === "tribunal_accusation"
      || value === "tribunal_defense"
      || value === "tribunal_vote"
      || value === "judgment_opening"
      || value === "judgment_jury_questions"
      || value === "judgment_closing"
      || value === "judgment_jury_vote";
  }

  private cursorAfterFormatResolve(actor: PhaseActor): GameExecutionCursorV1 {
    const coordinate = String(actor.getSnapshot().value);
    switch (coordinate) {
      case "lobby":
      case "reckoning_lobby":
      case "tribunal_lobby":
      case "judgment_opening":
        return { version: 1, kind: "phase_enter", actor: coordinate };
      case "end":
        return { version: 1, kind: "terminal", stage: "commit_game" };
      default:
        throw new Error(`Format resolve ended at unexpected actor coordinate ${coordinate}`);
    }
  }

  private cursorAfterEndgamePhase(
    actor: PhaseActor,
    expected: readonly string[],
  ): GameExecutionCursorV1 {
    const coordinate = String(actor.getSnapshot().value);
    if (coordinate === "end") {
      return { version: 1, kind: "terminal", stage: "commit_game" };
    }
    if (!expected.includes(coordinate)) {
      throw new Error(`Endgame phase ended at unexpected actor coordinate ${coordinate}`);
    }
    return {
      version: 1,
      kind: "phase_enter",
      actor: coordinate as Extract<GameExecutionCursorV1, { kind: "phase_enter" }>['actor'],
    };
  }

  private tribunalAccusationsFromCanonical(
    gameState: GameState,
  ): Map<UUID, { accuserId: UUID; accuserName: string; text: string }> {
    const accusations = new Map<UUID, { accuserId: UUID; accuserName: string; text: string }>();
    for (const event of gameState.getCanonicalEvents()) {
      if (
        event.type !== "endgame.speech_recorded"
        || event.round !== gameState.round
        || event.phase !== Phase.ACCUSATION
        || event.payload.speechKind !== "accusation"
        || !event.payload.targetId
      ) {
        continue;
      }
      accusations.set(event.payload.targetId, {
        accuserId: event.payload.playerId,
        accuserName: gameState.getPlayerName(event.payload.playerId),
        text: event.payload.text,
      });
    }
    return accusations;
  }

  private async runDurableConvertedPhase(phase: string): Promise<void> {
    while (this.actorCoordinateFromDurableSnapshot(this.requireDurableSnapshot()) === phase && !this._aborted) {
      const base = this.durableTurnSnapshot;
      if (!base) throw new Error("Converted phase has no durable execution snapshot");
      const cursor = base.execution.cursor;

      if (phase === "introduction" && cursor.kind === "phase_enter" && cursor.actor === "introduction") {
        const actorIds = this.gameState.getAlivePlayerIds();
        await this.executeDurableTurn({
          branch: "parallel_provider_batch",
          action: "introduction",
          actorIds,
          houseBeat: this.requireHouseBeat("introduction"),
          providerActions: actorIds.map((actorId) => ({
            actorId,
            action: "introduction",
            contractId: "agent-introduction-v1",
          })),
        }, async (ctx, scratchActor) => {
          ctx.logger.emitPhaseChange(Phase.INTRODUCTION);
          ctx.logger.logSystem("=== INTRODUCTION PHASE ===", Phase.INTRODUCTION);
          const batch = await collectIntroductionBatch(ctx);
          await applyIntroductionBatch(ctx, batch);
          await ctx.diaryRoom.runDiaryRoom(Phase.INTRODUCTION);
          scratchActor.send({
            type: "UPDATE_ALIVE_PLAYERS",
            aliveIds: ctx.gameState.getAlivePlayerIds(),
          });
          scratchActor.send({ type: "PHASE_COMPLETE" });
          return { version: 1, kind: "phase_enter", actor: "lobby" };
        });
        continue;
      }

      if (phase === "lobby" && cursor.kind === "phase_enter" && cursor.actor === "lobby") {
        const actorIds = this.gameState.getAlivePlayerIds();
        await this.executeDurableTurn({
          branch: "engine",
          action: "round-start",
          actorIds,
        }, async (ctx) => {
          await beginLobbyPhase(ctx);
          return {
            version: 1,
            kind: "serial_actor",
            lane: "lobby_speech",
            actorIds,
            actorIndex: 0,
            pass: 1,
          };
        });
        continue;
      }

      if (phase === "lobby" && cursor.kind === "serial_actor" && cursor.lane === "lobby_speech") {
        const playerId = cursor.actorIds[cursor.actorIndex];
        if (!playerId) throw new Error("Lobby durable cursor points past its actor roster");
        const passes = computeLobbyMessagesPerPlayer(
          cursor.actorIds.length,
          this.config.lobbyMessagesPerPlayer,
        );
        await this.executeDurableTurn({
          branch: "single_provider",
          action: "lobby-speech",
          actorIds: [playerId],
          providerActions: [{
            actorId: playerId,
            action: "lobby",
            contractId: "agent-lobby-message-v1",
          }],
        }, async (ctx) => {
          const pass = cursor.pass ?? 1;
          await runLobbySpeakerTurn(ctx, playerId, pass - 1, passes);
          const nextIndex = cursor.actorIndex + 1;
          if (nextIndex < cursor.actorIds.length) {
            return { ...cursor, actorIndex: nextIndex };
          }
          if (pass < passes) {
            return { ...cursor, actorIndex: 0, pass: pass + 1 };
          }
          return { version: 1, kind: "rules", operation: "phase_close" };
        });
        continue;
      }

      if (phase === "lobby" && cursor.kind === "rules" && cursor.operation === "phase_close") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "lobby-close",
          houseBeat: this.requireHouseBeat("lobby"),
        }, async (_ctx, scratchActor) => {
          scratchActor.send({ type: "PHASE_COMPLETE" });
          return { version: 1, kind: "phase_enter", actor: "vote" };
        });
        continue;
      }

      if (phase === "vote" && cursor.kind === "phase_enter" && cursor.actor === "vote") {
        const actorIds = this.gameState.getAlivePlayerIds();
        await this.executeDurableTurn({
          branch: "parallel_provider_batch",
          action: "empower-vote",
          actorIds,
          providerActions: actorIds.map((actorId) => ({
            actorId,
            action: "vote",
            contractId: "agent-empower-vote-v1",
          })),
        }, async (ctx) => {
          ctx.logger.emitPhaseChange(Phase.VOTE);
          ctx.logger.logSystem("=== VOTE PHASE ===", Phase.VOTE);
          const batch = await collectEmpowerVoteBatch(ctx);
          await applyEmpowerVoteBatch(ctx, batch);
          return { version: 1, kind: "rules", operation: "empower_tally" };
        });
        continue;
      }

      if (phase === "vote" && cursor.kind === "rules" && cursor.operation === "empower_tally") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "empower-tally",
        }, async (ctx) => {
          const tally = await tallyEmpowerVote(ctx);
          return tally.tied
            ? { version: 1, kind: "parallel_batch", batch: "empower_revote" }
            : { version: 1, kind: "rules", operation: "empower_resolve" };
        });
        continue;
      }

      if (phase === "vote" && cursor.kind === "parallel_batch" && cursor.batch === "empower_revote") {
        const tallyEvent = [...this.gameState.getCanonicalEvents()].reverse().find(
          (event) => event.type === "vote.empower_tally_resolved" && event.round === this.gameState.round,
        );
        if (!tallyEvent || tallyEvent.type !== "vote.empower_tally_resolved" || !tallyEvent.payload.tied) {
          throw new Error("Empower re-vote cursor is missing a tied tally event");
        }
        const tied = [...tallyEvent.payload.tied];
        const actorIds = this.gameState.getAlivePlayerIds().filter((id) => !tied.includes(id));
        await this.executeDurableTurn({
          branch: "parallel_provider_batch",
          action: "empower-revote",
          actorIds,
          targetIds: tied,
          providerActions: actorIds.map((actorId) => ({
            actorId,
            action: "empower-revote",
            contractId: "agent-empower-revote-v1",
          })),
        }, async (ctx) => {
          const batch = await collectEmpowerRevoteBatch(ctx, tied);
          await applyEmpowerRevoteBatch(ctx, tied, batch);
          return { version: 1, kind: "rules", operation: "empower_resolve" };
        });
        continue;
      }

      if (phase === "vote" && cursor.kind === "rules" && cursor.operation === "empower_resolve") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "empower-resolve",
          houseBeat: this.requireHouseBeat("vote"),
        }, async (ctx, scratchActor) => {
          const tallyEvent = [...ctx.gameState.getCanonicalEvents()].reverse().find(
            (event) => event.type === "vote.empower_tally_resolved" && event.round === ctx.gameState.round,
          );
          if (!tallyEvent || tallyEvent.type !== "vote.empower_tally_resolved") {
            throw new Error("Empower resolve cursor is missing its tally event");
          }
          const empoweredId = tallyEvent.payload.tied
            ? await resolveEmpowerRevote(ctx, tallyEvent.payload.tied, ctx.random)
            : ctx.gameState.empoweredId;
          if (!empoweredId) throw new Error("Empower resolve produced no empowered player");
          finishEmpowerVote(ctx, empoweredId);
          scratchActor.send({ type: "VOTES_TALLIED", empoweredId });
          scratchActor.send({ type: "PHASE_COMPLETE" });
          return { version: 1, kind: "phase_enter", actor: "format_menu" };
        });
        continue;
      }

      if (phase === "format_menu" && cursor.kind === "phase_enter" && cursor.actor === "format_menu") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "format-menu",
          actorIds: this.gameState.empoweredId ? [this.gameState.empoweredId] : [],
          houseBeat: this.requireHouseBeat("format_menu"),
        }, async (ctx, scratchActor) => {
          await runFormatMenuPhase(ctx, scratchActor);
          return { version: 1, kind: "phase_enter", actor: "format_pick" };
        });
        continue;
      }

      if (phase === "format_pick" && cursor.kind === "phase_enter" && cursor.actor === "format_pick") {
        const empoweredId = this.gameState.empoweredId;
        if (!empoweredId) throw new Error("Format pick cursor has no empowered player");
        const alreadySelected = this.gameState.getCanonicalEvents().some(
          (event) => event.type === "format.selected" && event.round === this.gameState.round,
        );
        await this.executeDurableTurn({
          branch: alreadySelected ? "engine" : "single_provider",
          action: "format-pick",
          actorIds: [empoweredId],
          houseBeat: this.requireHouseBeat("format_pick"),
          providerActions: alreadySelected ? [] : [{
            actorId: empoweredId,
            action: "format-pick",
            contractId: "agent-format-pick-v1",
          }],
        }, async (ctx, scratchActor) => {
          await runFormatPickPhase(ctx, scratchActor);
          return { version: 1, kind: "phase_enter", actor: "format_mingle" };
        });
        continue;
      }

      if (phase === "format_mingle" && cursor.kind === "phase_enter" && cursor.actor === "format_mingle") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "format-mingle",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("format_mingle"),
        }, async (ctx, scratchActor) => {
          await runFormatMinglePhase(ctx, scratchActor, { completePhase: false });
          await runAllianceFormationPhase(ctx);
          await runAllianceHuddleWindow(ctx, scratchActor, Phase.FORMAT_MINGLE);
          if (String(scratchActor.getSnapshot().value) !== "format_resolve") {
            throw new Error("Format Mingle did not advance its scratch actor to format_resolve");
          }
          return { version: 1, kind: "phase_enter", actor: "format_resolve" };
        });
        continue;
      }

      if (phase === "format_resolve" && cursor.kind === "phase_enter" && cursor.actor === "format_resolve") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "format-resolve",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("format_resolve"),
        }, async (ctx, scratchActor) => {
          await runFormatResolvePhase(ctx, scratchActor);
          if (this.config.diaryRoomAfterPhases?.includes(Phase.FORMAT_RESOLVE)) {
            await ctx.diaryRoom.runDiaryRoom(Phase.FORMAT_RESOLVE);
          }
          return this.cursorAfterFormatResolve(scratchActor);
        });
        continue;
      }

      if (phase === "reckoning_lobby" && cursor.kind === "phase_enter" && cursor.actor === "reckoning_lobby") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "reckoning-lobby",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("reckoning_lobby"),
        }, async (ctx, scratchActor) => {
          await runReckoningLobby(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["reckoning_plea"]);
        });
        continue;
      }

      if (phase === "reckoning_plea" && cursor.kind === "phase_enter" && cursor.actor === "reckoning_plea") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "reckoning-plea",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("reckoning_plea"),
        }, async (ctx, scratchActor) => {
          await runReckoningPlea(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["reckoning_vote"]);
        });
        continue;
      }

      if (phase === "reckoning_vote" && cursor.kind === "phase_enter" && cursor.actor === "reckoning_vote") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "reckoning-vote",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("reckoning_vote"),
        }, async (ctx, scratchActor) => {
          await runReckoningVote(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["tribunal_lobby"]);
        });
        continue;
      }

      if (phase === "tribunal_lobby" && cursor.kind === "phase_enter" && cursor.actor === "tribunal_lobby") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "tribunal-lobby",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("tribunal_lobby"),
        }, async (ctx, scratchActor) => {
          await runTribunalLobby(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["tribunal_accusation"]);
        });
        continue;
      }

      if (phase === "tribunal_accusation" && cursor.kind === "phase_enter" && cursor.actor === "tribunal_accusation") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "tribunal-accusation",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("tribunal_accusation"),
        }, async (ctx, scratchActor) => {
          await runTribunalAccusation(ctx, scratchActor, new Map());
          return this.cursorAfterEndgamePhase(scratchActor, ["tribunal_defense"]);
        });
        continue;
      }

      if (phase === "tribunal_defense" && cursor.kind === "phase_enter" && cursor.actor === "tribunal_defense") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "tribunal-defense",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("tribunal_defense"),
        }, async (ctx, scratchActor) => {
          const accusations = this.tribunalAccusationsFromCanonical(ctx.gameState);
          await runTribunalDefense(ctx, scratchActor, accusations);
          return this.cursorAfterEndgamePhase(scratchActor, ["tribunal_vote"]);
        });
        continue;
      }

      if (phase === "tribunal_vote" && cursor.kind === "phase_enter" && cursor.actor === "tribunal_vote") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "tribunal-vote",
          actorIds: [...this.agents.keys()],
          houseBeat: this.requireHouseBeat("tribunal_vote"),
        }, async (ctx, scratchActor) => {
          await runTribunalVote(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["judgment_opening"]);
        });
        continue;
      }

      if (phase === "judgment_opening" && cursor.kind === "phase_enter" && cursor.actor === "judgment_opening") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "judgment-opening",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("judgment_opening"),
        }, async (ctx, scratchActor) => {
          await runJudgmentOpening(ctx, scratchActor);
          await ctx.diaryRoom.runDiaryRoom(Phase.OPENING_STATEMENTS);
          return this.cursorAfterEndgamePhase(scratchActor, ["judgment_jury_questions"]);
        });
        continue;
      }

      if (phase === "judgment_jury_questions" && cursor.kind === "phase_enter" && cursor.actor === "judgment_jury_questions") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "judgment-jury-questions",
          actorIds: [...this.agents.keys()],
          houseBeat: this.requireHouseBeat("judgment_jury_questions"),
        }, async (ctx, scratchActor) => {
          await runJudgmentJuryQuestions(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["judgment_closing"]);
        });
        continue;
      }

      if (phase === "judgment_closing" && cursor.kind === "phase_enter" && cursor.actor === "judgment_closing") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "judgment-closing",
          actorIds: this.gameState.getAlivePlayerIds(),
          houseBeat: this.requireHouseBeat("judgment_closing"),
        }, async (ctx, scratchActor) => {
          await runJudgmentClosing(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, ["judgment_jury_vote"]);
        });
        continue;
      }

      if (phase === "judgment_jury_vote" && cursor.kind === "phase_enter" && cursor.actor === "judgment_jury_vote") {
        await this.executeDurableTurn({
          branch: "engine",
          action: "judgment-jury-vote",
          actorIds: [...this.agents.keys()],
          houseBeat: this.requireHouseBeat("judgment_jury_vote"),
        }, async (ctx, scratchActor) => {
          await runJudgmentJuryVote(ctx, scratchActor);
          return this.cursorAfterEndgamePhase(scratchActor, []);
        });
        continue;
      }

      throw new Error(`Durable cursor ${cursor.kind} is invalid for actor coordinate ${phase}`);
    }
  }

  private async runDurableGameLoop(): Promise<void> {
    while (!this._aborted) {
      const snapshot = this.requireDurableSnapshot();
      if (snapshot.execution.cursor.kind === "terminal") return;
      const coordinate = this.actorCoordinateFromDurableSnapshot(snapshot);
      if (!this.isDurableConvertedActorCoordinate(coordinate)) {
        throw new Error(
          `Durable execution reached unconverted cursor ${JSON.stringify(snapshot.execution.cursor)} at actor ${coordinate}`,
        );
      }
      await this.runDurableConvertedPhase(coordinate);
      await this.tickPhaseActor();
    }
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

    if (this.resumeFrom?.kind === "phase_boundary") {
      await this.hydratePhaseActorForResume(actor, this.resumeFrom.actorCoordinate);
    } else {
      // Advance past INIT
      actor.send({ type: "PHASE_COMPLETE" });
    }
    await new Promise((r) => setTimeout(r, 0));

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

      const prc = this.buildPhaseRunnerContext();
      // --- Normal round phases ---
      if (state === "introduction") {
        await runIntroductionPhase(prc, actor);
        await this.diaryRoom.runDiaryRoom(Phase.INTRODUCTION);
      } else if (state === "lobby") {
        await runLobbyPhase(prc, actor);
      } else if (state === "vote") {
        await runVotePhase(prc, actor);
      } else if (state === "format_menu") {
        await runFormatMenuPhase(prc, actor);
      } else if (state === "format_pick") {
        await runFormatPickPhase(prc, actor);
      } else if (state === "format_mingle") {
        await runFormatMinglePhase(prc, actor, { completePhase: false });
        await runAllianceFormationPhase(prc);
        await runAllianceHuddleWindow(prc, actor, Phase.FORMAT_MINGLE);
      } else if (state === "format_resolve") {
        await runFormatResolvePhase(prc, actor);
        await this.runConfiguredDiaryRoom(Phase.FORMAT_RESOLVE);

        // Legacy classic path (not on default transitions; resume/old logs only)
      } else if (state === "post_vote_mingle") {
        await runMinglePhase(prc, actor, { phase: Phase.POST_VOTE_MINGLE });
      } else if (state === "power") {
        await runPowerPhase(prc, actor);
      } else if (state === "reveal") {
        await runRevealPhase(prc, actor);
      } else if (state === "pre_council_huddle") {
        await runAllianceHuddleWindow(prc, actor, Phase.PRE_COUNCIL_HUDDLE);
      } else if (state === "council") {
        await runCouncilPhase(prc, actor);
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
        this._currentAccusations.clear();
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
      if (this._aborted && (this.durableEventSink || this.durableTurnStore)) {
        this.logger.dropStreamBuffer();
        throw new Error("Game run aborted");
      }
      await this.flushDurableEvents({
        continueBuffering: true,
        releaseStream: false,
      });

      const houseBeat = this.houseBeatForActorCoordinate(state);
      if (houseBeat) {
        await this.emitHousePhaseBeat(
          houseBeat.actorCoordinate,
          houseBeat.phase,
          houseBeat.beatClass,
          houseBeat.roundMilestone,
        );
      }
      await this.flushDurableEvents({
        continueBuffering: true,
        checkpointKind: "phase_boundary",
        phase: this.phaseForActorCoordinate(String(actor.getSnapshot().value))
          ?? this.gameState.getCanonicalEvents().at(-1)?.phase
          ?? Phase.INIT,
        phaseActor: actor,
      });
    }

    if (!this._aborted) {
      await completionPromise;
    }
  }

  private async tickPhaseActor(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  private async completeResumePhase(actor: PhaseActor): Promise<void> {
    actor.send({ type: "PHASE_COMPLETE" });
    await this.tickPhaseActor();
  }

  private updateResumeAlivePlayers(actor: PhaseActor): void {
    actor.send({
      type: "UPDATE_ALIVE_PLAYERS",
      aliveIds: this.gameState.getAlivePlayers().map((player) => player.id),
    });
  }

  private assertResumeActorState(actor: PhaseActor, expected: GameRunnerResumeActorCoordinate): void {
    const actual = String(actor.getSnapshot().value);
    if (actual !== expected) {
      throw new Error(`Phase-boundary resume expected actor coordinate "${expected}" but hydrated "${actual}"`);
    }
  }

  private assertResumeActorRound(actor: PhaseActor, expectedRound: number): void {
    const actualRound = Number(actor.getSnapshot().context.round);
    if (actualRound !== expectedRound) {
      throw new Error(
        `Phase-boundary resume expected actor round ${expectedRound} but hydrated ${actualRound}`,
      );
    }
  }

  private latestCanonicalEvent<TType extends CanonicalGameEvent["type"]>(
    type: TType,
  ): Extract<CanonicalGameEvent, { type: TType }> | null {
    const events = this.resumeFrom?.canonicalEvents ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type === type) {
        return event as Extract<CanonicalGameEvent, { type: TType }>;
      }
    }
    return null;
  }

  private hasCanonicalEvent(type: CanonicalGameEvent["type"]): boolean {
    return Boolean(this.resumeFrom?.canonicalEvents.some((event) => event.type === type));
  }

  private resumeEmpoweredId(round: number = this.gameState.round): UUID {
    const events = this.resumeFrom?.canonicalEvents ?? [];
    const empoweredId = resolveEmpoweredIdForRound(events, round);
    if (empoweredId) return empoweredId;

    // Fallback for pre-format coordinates that only require any resolved empower.
    const setEvent = this.latestCanonicalEvent("vote.empowered_set");
    if (setEvent) return setEvent.payload.empowered;

    const tallyEvent = this.latestCanonicalEvent("vote.empower_tally_resolved");
    if (tallyEvent?.payload.tied === null) return tallyEvent.payload.empowered;

    throw new Error("Phase-boundary resume missing resolved empowered player");
  }

  /**
   * Non-effectfully walk one completed standard round from format_menu through the
   * next lobby entry so actor.context.round catches up to durable gameState.round.
   */
  private async advanceResumeThroughCompletedFormatRound(actor: PhaseActor): Promise<void> {
    await this.completeResumePhase(actor); // format_menu → format_pick
    await this.completeResumePhase(actor); // format_pick → format_mingle
    await this.completeResumePhase(actor); // format_mingle → format_resolve
    await this.completeResumePhase(actor); // format_resolve → checkGameOver → lobby/endgame
  }

  /**
   * From lobby of the current actor round, walk to format_menu of that same round.
   */
  private async advanceResumeFromLobbyToFormatMenu(
    actor: PhaseActor,
    round: number,
  ): Promise<void> {
    await this.completeResumePhase(actor); // lobby → vote
    const empoweredId = this.resumeEmpoweredId(round);
    actor.send({ type: "VOTES_TALLIED", empoweredId });
    await this.completeResumePhase(actor); // vote → format_menu
  }

  private resumeCandidateResolution(): {
    candidates: [UUID, UUID] | null;
    autoEliminated: UUID | null;
  } {
    const event = this.latestCanonicalEvent("power.candidates_resolved");
    if (!event) {
      throw new Error("Phase-boundary resume missing power candidate resolution");
    }
    return {
      candidates: event.payload.candidates ? [...event.payload.candidates] : null,
      autoEliminated: event.payload.autoEliminated,
    };
  }

  private async hydratePhaseActorForResume(
    actor: PhaseActor,
    target: GameRunnerResumeActorCoordinate,
  ): Promise<void> {
    if (target === "mingle_i" || target === "pre_vote_huddle") {
      throw new Error(`Phase-boundary resume coordinate "${target}" retired with the pre-format social window`);
    }
    await this.completeResumePhase(actor);
    this.updateResumeAlivePlayers(actor);
    await this.completeResumePhase(actor);
    if (target === "lobby") {
      this.assertResumeActorState(actor, target);
      return;
    }

    if (!this.hasCanonicalEvent("round.started")) {
      throw new Error(`Phase-boundary resume to "${target}" missing round.started event`);
    }
    await this.completeResumePhase(actor);
    if (target === "vote") {
      this.assertResumeActorState(actor, target);
      return;
    }

    // Format phase-entry targets need actor.context.round to match durable gameState.round
    // so maxRounds game-over cannot under-count after multi-round resume. Endgame targets
    // keep the pre-existing single format walk + alive-count entry (they do not depend on
    // mid-format maxRounds equality the same way).
    const isFormatTarget =
      target === "format_menu" ||
      target === "format_pick" ||
      target === "format_mingle" ||
      target === "format_resolve";

    if (isFormatTarget) {
      {
        const roundOneEmpoweredId = this.resumeEmpoweredId(1);
        actor.send({ type: "VOTES_TALLIED", empoweredId: roundOneEmpoweredId });
        await this.completeResumePhase(actor); // vote → format_menu (round 1)
      }

      const targetRound = this.gameState.round;
      let actorRound = Number(actor.getSnapshot().context.round);
      while (actorRound < targetRound) {
        await this.advanceResumeThroughCompletedFormatRound(actor);
        const after = String(actor.getSnapshot().value);
        if (after !== "lobby") {
          throw new Error(
            `Phase-boundary resume catch-up expected lobby while advancing to round ${targetRound}, hydrated "${after}"`,
          );
        }
        actorRound = Number(actor.getSnapshot().context.round);
        await this.advanceResumeFromLobbyToFormatMenu(actor, actorRound);
        actorRound = Number(actor.getSnapshot().context.round);
      }

      // Non-effectful mid-round walk to the format phase-entry target.
      if (target === "format_menu") {
        this.assertResumeActorState(actor, target);
        this.assertResumeActorRound(actor, targetRound);
        return;
      }
      if (target === "format_pick") {
        await this.completeResumePhase(actor); // format_menu → format_pick
        this.assertResumeActorState(actor, target);
        this.assertResumeActorRound(actor, targetRound);
        return;
      }
      if (target === "format_mingle") {
        await this.completeResumePhase(actor); // format_menu → format_pick
        await this.completeResumePhase(actor); // format_pick → format_mingle
        this.assertResumeActorState(actor, target);
        this.assertResumeActorRound(actor, targetRound);
        return;
      }
      // format_resolve
      await this.completeResumePhase(actor); // format_menu → format_pick
      await this.completeResumePhase(actor); // format_pick → format_mingle
      await this.completeResumePhase(actor); // format_mingle → format_resolve
      this.assertResumeActorState(actor, target);
      this.assertResumeActorRound(actor, targetRound);
      return;
    }

    // Endgame / post-elim resume after format kernel: single non-effectful format walk,
    // then alive-count checkGameOver (pre-existing endgame hydration contract).
    const empoweredId = this.resumeEmpoweredId();
    actor.send({ type: "VOTES_TALLIED", empoweredId });
    await this.completeResumePhase(actor); // vote → format_menu

    const isEndgameTarget =
      target.startsWith("reckoning_") ||
      target.startsWith("tribunal_") ||
      target.startsWith("judgment_");
    if (isEndgameTarget || target === "post_vote_mingle" || target === "power" || target === "reveal" || target === "pre_council_huddle" || target === "council") {
      await this.completeResumePhase(actor); // format_menu → format_pick
      await this.completeResumePhase(actor); // format_pick → format_mingle
      await this.completeResumePhase(actor); // format_mingle → format_resolve
      this.updateResumeAlivePlayers(actor);
      await this.completeResumePhase(actor); // format_resolve → checkGameOver → endgame/lobby
      if (isEndgameTarget) {
        // fall through to endgame stage walk below
      } else if (target === "post_vote_mingle" || target === "power" || target === "reveal" || target === "pre_council_huddle" || target === "council") {
        throw new Error(
          `Phase-boundary resume to classic coordinate "${target}" is not supported after format-kernel cutover.`,
        );
      }
    }

    if (
      target === "reckoning_lobby" ||
      target === "tribunal_lobby" ||
      target === "judgment_opening"
    ) {
      this.assertResumeActorState(actor, target);
      return;
    }

    if (target === "reckoning_plea" || target === "reckoning_vote") {
      this.assertResumeActorState(actor, "reckoning_lobby");
      await this.completeResumePhase(actor);
      if (target === "reckoning_plea") {
        this.assertResumeActorState(actor, target);
        return;
      }
      await this.completeResumePhase(actor);
      this.assertResumeActorState(actor, target);
      return;
    }

    if (target === "tribunal_accusation" || target === "tribunal_defense" || target === "tribunal_vote") {
      this.assertResumeActorState(actor, "tribunal_lobby");
      await this.completeResumePhase(actor);
      if (target === "tribunal_accusation") {
        this.assertResumeActorState(actor, target);
        return;
      }
      await this.completeResumePhase(actor);
      if (target === "tribunal_defense") {
        this.assertResumeActorState(actor, target);
        return;
      }
      await this.completeResumePhase(actor);
      this.assertResumeActorState(actor, target);
      return;
    }

    if (
      target === "judgment_jury_questions" ||
      target === "judgment_closing" ||
      target === "judgment_jury_vote"
    ) {
      this.assertResumeActorState(actor, "judgment_opening");
      await this.completeResumePhase(actor);
      if (target === "judgment_jury_questions") {
        this.assertResumeActorState(actor, target);
        return;
      }
      await this.completeResumePhase(actor);
      if (target === "judgment_closing") {
        this.assertResumeActorState(actor, target);
        return;
      }
      await this.completeResumePhase(actor);
      this.assertResumeActorState(actor, target);
      return;
    }

    this.assertResumeActorState(actor, target);
  }

  private houseRoundSummariesEnabled(): boolean {
    return this.config.enableHouseRoundSummaries !== false;
  }

  private houseLongFormSummariesEnabled(): boolean {
    return this.config.enableHouseLongFormSummaries === true;
  }

  private houseBeatForActorCoordinate(
    actorCoordinate: string,
  ): {
    actorCoordinate: HouseSummaryActorCoordinate;
    phase: Phase;
    beatClass: HouseBeatClass;
    roundMilestone: boolean;
  } | null {
    if (!isHouseSummaryActorCoordinate(actorCoordinate)) return null;
    const phase = this.phaseForActorCoordinate(actorCoordinate);
    if (!phase) return null;
    if (actorCoordinate === "power") {
      const automaticElimination = this.gameState.councilCandidates === null;
      return {
        actorCoordinate,
        phase,
        beatClass: automaticElimination ? "milestone" : "ordinary",
        roundMilestone: automaticElimination,
      };
    }
    const roundMilestone = actorCoordinate === "format_resolve" || actorCoordinate === "council";
    const endgameMilestone = actorCoordinate === "reckoning_vote"
      || actorCoordinate === "tribunal_vote"
      || actorCoordinate === "judgment_jury_vote";
    return {
      actorCoordinate,
      phase,
      beatClass: roundMilestone || endgameMilestone ? "milestone" : "ordinary",
      roundMilestone,
    };
  }

  private requireHouseBeat(actorCoordinate: string): DurableHouseBeatInput {
    const beat = this.houseBeatForActorCoordinate(actorCoordinate);
    if (!beat) {
      throw new Error(`Missing House cadence metadata for ${actorCoordinate}`);
    }
    return beat;
  }

  private emitHousePhaseTelemetry(
    telemetry: HouseSummaryPhaseTelemetry,
    logger: TranscriptLogger = this.logger,
  ): void {
    this.houseSummaryTelemetry.push(telemetry);
    logger.emitAgentTurn({
      phase: telemetry.phase,
      action: "house-summary-phase-telemetry",
      actor: { name: "House", role: "house" },
      visibility: "private",
      response: { telemetry },
      scope: "thinking",
    });
  }

  private buildHousePhaseTelemetry(
    result: HouseSummaryAttemptResult,
    pendingDelta: HouseSummaryPhaseTelemetry["pendingDelta"],
  ): HouseSummaryPhaseTelemetry {
    return {
      version: 2,
      boundaryId: result.boundary.id,
      actorCoordinate: result.boundary.actorCoordinate,
      round: result.boundary.round,
      phase: result.boundary.phase,
      beatClass: result.boundary.beatClass,
      status: result.status,
      providerCalls: result.providerCalls,
      usageAvailable: result.usage.every((entry) => (
        entry.responseId !== null
        && entry.serviceTier !== null
        && entry.promptTokens !== null
        && entry.cachedTokens !== null
        && entry.cacheWriteTokens !== null
        && entry.completionTokens !== null
        && entry.reasoningTokens !== null
        && entry.totalTokens !== null
      )),
      usage: result.usage.map((entry) => ({ ...entry })),
      pendingDelta,
    };
  }

  private async emitHousePhaseBeat(
    actorCoordinate: HouseSummaryActorCoordinate,
    phase: Phase,
    beatClass: HouseBeatClass,
    roundMilestone = false,
  ): Promise<void> {
    this.houseNarrativeContinuity = await this.emitHousePhaseBeatForContext(
      this.buildPhaseRunnerContext(),
      this.houseNarrativeContinuity,
      { actorCoordinate, phase, beatClass, roundMilestone },
    );
  }

  private async emitHousePhaseBeatForContext(
    context: PhaseRunnerContext,
    initialContinuity: HouseNarrativeContinuityV2,
    beat: DurableHouseBeatInput,
  ): Promise<HouseNarrativeContinuityV2> {
    const { actorCoordinate, phase, beatClass, roundMilestone } = beat;
    const continuity = structuredClone(initialContinuity);
    const round = context.gameState.round;
    if (!this.houseRoundSummariesEnabled()) {
      return continuity;
    }
    const projection = context.gameState.getDomainProjection();
    const events = context.gameState.getCanonicalEventsAfter(
      continuity.examinedCanonicalHead,
    );
    const narrationContext = compileHouseNarrationContext({
      actorCoordinate,
      round,
      phase,
      beatClass,
      events,
      projection,
      transcript: context.logger.dialogueEntriesAfter(
        continuity.examinedDialogueHead,
      ),
      diaryEntries: context.diaryRoom.diaryEntries,
      afterCanonicalSequence: continuity.examinedCanonicalHead,
      afterDialogueSequence: continuity.examinedDialogueHead,
    });

    if (!narrationContext.material) {
      continuity.examinedCanonicalHead = narrationContext.boundary.canonicalHead;
      continuity.examinedDialogueHead = narrationContext.boundary.dialogueHead;
      this.emitHousePhaseTelemetry({
        version: 2,
        boundaryId: narrationContext.boundary.id,
        actorCoordinate,
        round,
        phase,
        beatClass,
        status: "preflight_skipped",
        providerCalls: 0,
        usageAvailable: true,
        usage: [],
        pendingDelta: "none",
      }, context.logger);
      return continuity;
    }

    const isFirstRoundMilestone = roundMilestone && !continuity.recentBeats.some(
      (priorBeat) => priorBeat.boundary.round === round && priorBeat.boundary.beatClass === "milestone",
    );
    const hadPendingDelta = continuity.pendingDeltaCarry === 1;
    let result: HouseSummaryAttemptResult = await context.houseInterviewer.generateHouseSummary({
      narrationContext,
      continuity,
    });

    if (result.status === "emitted") {
      const maxSummaryCharacters = houseSummaryCharacterLimit(beatClass);
      const validSummary = result.beat === null || (
        houseSummaryBoundariesEqual(result.beat.boundary, narrationContext.boundary)
        && result.beat.version === 2
        && isBoundedHouseAuthoredText(result.beat.publicSummary, maxSummaryCharacters)
      );
      const validNotebook = result.privateNarrativeNotebook === null
        || isBoundedHouseAuthoredText(
          result.privateNarrativeNotebook,
          HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
        );
      const failureReason = !houseSummaryBoundariesEqual(result.boundary, narrationContext.boundary)
        ? "house_summary_boundary_mismatch"
        : result.beat === null && result.privateNarrativeNotebook === null
          ? "empty_house_narrative_update"
          : !validSummary
            ? "house_summary_presentation_invalid"
            : !validNotebook
              ? "house_notebook_presentation_invalid"
              : null;
      if (failureReason !== null) {
        result = {
          status: "failed",
          reason: failureReason,
          boundary: narrationContext.boundary,
          providerCalls: result.providerCalls,
          usage: result.usage.map((entry) => ({ ...entry })),
          ...(result.thinking ? { thinking: result.thinking } : {}),
          ...(result.reasoningContext ? { reasoningContext: result.reasoningContext } : {}),
        };
      }
    }

    let pendingDelta: HouseSummaryPhaseTelemetry["pendingDelta"] = "none";
    if (result.status === "emitted") {
      if (result.beat) {
        const publicSummary = result.beat.publicSummary;
        context.logger.emitAgentTurn({
          phase,
          action: "house-mc-summary",
          actor: { name: "House", role: "house" },
          visibility: "system",
          response: { summary: publicSummary },
          scope: "system",
          text: publicSummary,
        });
        context.logger.logSystem(publicSummary, phase, undefined, undefined, "house_summary");
      }
      const acceptedBeat = result.beat ? structuredClone(result.beat) : null;
      const nextContinuity: HouseNarrativeContinuityV2 = {
        version: 2,
        gameId: context.gameState.gameId,
        recentBeats: acceptedBeat
          ? appendRecentHouseNarrativeBeat(continuity.recentBeats, acceptedBeat)
          : continuity.recentBeats.map((priorBeat) => structuredClone(priorBeat)),
        privateNarrativeNotebook: result.privateNarrativeNotebook
          ?? continuity.privateNarrativeNotebook,
        examinedCanonicalHead: narrationContext.boundary.canonicalHead,
        examinedDialogueHead: context.logger.dialogueHead,
        pendingDeltaCarry: 0,
      };
      Object.assign(continuity, nextContinuity);
      pendingDelta = hadPendingDelta ? "carried" : "none";
    } else if (result.status === "model_skipped") {
      continuity.examinedCanonicalHead = narrationContext.boundary.canonicalHead;
      continuity.examinedDialogueHead = narrationContext.boundary.dialogueHead;
      continuity.pendingDeltaCarry = 0;
      pendingDelta = hadPendingDelta ? "dropped" : "none";
    } else if (hadPendingDelta) {
      continuity.examinedCanonicalHead = narrationContext.boundary.canonicalHead;
      continuity.examinedDialogueHead = narrationContext.boundary.dialogueHead;
      continuity.pendingDeltaCarry = 0;
      pendingDelta = "dropped";
    } else {
      continuity.pendingDeltaCarry = 1;
      pendingDelta = "carried";
    }
    this.emitHousePhaseTelemetry(
      this.buildHousePhaseTelemetry(result, pendingDelta),
      context.logger,
    );

    if (isFirstRoundMilestone && this.houseLongFormSummariesEnabled()) {
      await this.emitHouseLongFormSummary(context, continuity, phase, narrationContext);
    }
    return continuity;
  }

  private async emitHouseLongFormSummary(
    context: PhaseRunnerContext,
    continuity: HouseNarrativeContinuityV2,
    phase: Phase,
    narrationContext: import("./house-summary-frontier").HouseNarrationContext,
  ): Promise<void> {
    const coveredWindow: HouseCoveredWindow = {
      fromRound: 1,
      toRound: context.gameState.round,
      toPhase: phase,
    };
    const summary = await context.houseInterviewer.generateLongFormGameplaySummary({
      gameId: context.gameState.gameId,
      round: context.gameState.round,
      phase,
      kind: "long-form",
      coveredWindow,
      narrationContext,
      recentPublicBeats: continuity.recentBeats.map((priorBeat) => structuredClone(priorBeat)),
      privateNarrativeNotebook: continuity.privateNarrativeNotebook,
    });
    if (!summary) return;
    context.logger.emitAgentTurn({
      phase,
      action: "house-long-form-summary",
      actor: { name: "House", role: "house" },
      visibility: "private",
      response: {
        summary: summary.summary,
        kind: summary.kind,
        coveredWindow: summary.coveredWindow,
      },
      thinking: summary.thinking,
      reasoningContext: summary.reasoningContext,
      scope: "system",
      text: summary.summary,
    });
  }

  private async runConfiguredDiaryRoom(phase: Phase): Promise<void> {
    if (!this.config.diaryRoomAfterPhases?.includes(phase)) {
      return;
    }
    await this.diaryRoom.runDiaryRoom(phase);
  }
}
