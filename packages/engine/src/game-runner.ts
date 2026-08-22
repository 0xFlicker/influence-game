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
import {
  TemplateHouseInterviewer,
  publicHouseDialogueAttributionsAreSupported,
  publicHousePlayerCountClaimsAreSupported,
  validatePublicHouseSummaryProse,
} from "./house-interviewer";
import type { IHouseInterviewer } from "./house-interviewer";
import type { UUID, GameConfig } from "./types";
import { Phase, PlayerStatus, computeMaxRounds } from "./types";
import { hydrateMingleInboxFromReplay } from "./mingle-inbox-replay";
import {
  buildFormatKernelStateForResume,
  isFormatResumeCoordinate,
  resolveEmpoweredIdForRound,
  validateFormatResumePrerequisites,
} from "./format-recovery";
import {
  buildHouseFormatResolutionFacts,
  displayNameForFormat,
  resolveFormatManifest,
  type LaunchFormatId,
} from "./formats";

// Re-export types from the extracted module for backward compatibility
export type { ActorWitnessV1, AgentCallOptions, AgentResponse, AgentTurnEvent, AllianceAction, AllianceActionBase, AllianceActionKind, AllianceActionOpportunity, AllianceActionOpportunityTerms, AllianceAmendAction, AllianceCounterAction, AllianceHuddlePromptContext, AllianceHuddleTurnAction, AlliancePassAction, AllianceProposalAction, AllianceProposalResponseAction, BoundaryCertificate, CandidateChoiceRequest, CandidateSelectionDecision, CheckpointBoundaryIdentityV1, CurrentAccusationRecordV1, CurrentAccusationsAccumulatorV1, EliminationContext, EliminationVoteDisclosure, EmpowerRevoteAction, FormatDecisionFallbackReason, FormatDecisionProvenance, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, GameStreamEvent, GameStateSnapshot, HouseAllianceHypothesis, HouseContinuityCapsule, HouseContinuityRequirement, HouseCouncilRole, HouseCouncilRoleFact, HouseEvidenceBundle, HouseGameplaySummaryResult, HouseProducerBrief, HouseRoundFacts, HouseStrategyBiblePacket, HouseVoteCount, IAgent, MingleInboxReplay, MingleIntentAction, MingleIntentSummary, MinglePreferredRoomSize, MingleTurnAction, PhaseAccumulatorRegistryV1, PhaseContext, PlayerAllianceContext, PlayerAllianceContextAlliance, PlayerAllianceContextProposal, PlayerAllianceContextTerms, PlayerContinuityCapsule, PlayerPowerActionMemoryEntry, PlayerRoundHistoryEntry, PowerActionDecision, PowerActionOptions, PowerLobbyExposure, PrivateDecisionTrace, PrivateDecisionTraceActor, PrivateDecisionTraceActorRole, PrivateDecisionTraceBoundary, PrivateDecisionTraceContext, PrivateDecisionTraceMessage, PrivateDecisionTraceToolCall, PrivateTraceSink, PromptReuseReceipt, ProviderReasoningSummary, ProviderReasoningSummaryMode, RecentDecisionContextEntry, RuntimeSnapshotV1, StrategicLens, StrategicDecisionMetadata, TargetDecision, TokenCostCursor, TranscriptDialogueContext, TranscriptDialogueContextV1, TranscriptDialogueKind, TranscriptEntry, TranscriptWatermarkV1, RecallPromptClass, RecallContinuitySnapshot, RecallBoardContractFacts, RecallProtectedHuddleOutcome, RecallHotMessage, RecallHistoryDialogueEvidence, RecallPlanBudgetLedger, RecallPlanProtectedLane, RecallPlanHotLane, RecallPlanHistoryLane, RecallPlanReceipt, RecallPlan } from "./game-runner.types";
export type {
  HouseSelectiveSummaryContext,
  HouseSummaryAttemptResult,
  HouseSummaryEmittedResult,
  HouseSummaryFailedResult,
  HouseSummaryModelSkippedResult,
} from "./game-runner.types";
export { PLAYER_CONTINUITY_CAPSULE_VERSION } from "./game-runner.types";
export {
  HOUSE_FACT_CATEGORIES,
  HOUSE_SUMMARY_FRONTIER_VERSION,
  compileHouseSummaryFrontier,
  createEmptyHouseNarrativeContinuity,
  isHouseFactCategory,
  isHouseSummaryActorCoordinate,
  readHouseFactSlice,
} from "./house-summary-frontier";
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
  HouseSummaryActorCoordinate,
} from "./house-summary-frontier";
export {
  admitHouseContinuityForRecovery,
  isHouseContinuityCapsuleShape,
  isHouseContinuityRequirement,
  parsePlayerContinuityCapsule,
  sealHouseContinuityRequirement,
  validatePlayerContinuitySetForRecovery,
} from "./player-continuity";
import type { AccumulatorEntryV1, BoundaryCertificate, CheckpointBoundaryIdentityV1, CurrentAccusationRecordV1, CurrentAccusationsAccumulatorV1, GameCheckpointCapsule, GameCheckpointKind, GameRunnerOptions, GameRunnerResumeActorCoordinate, GameStreamEvent, GameStateSnapshot, HouseContinuityCapsule, HouseCouncilRoleFact, HouseCoveredWindow, HouseEvidenceBundle, HouseGameplaySummaryResult, HouseRoundFacts, HouseStrategyBiblePacket, HouseSummaryAttemptResult, HouseVoteCount, IAgent, PlayerContinuityCapsule, RuntimeSnapshotV1, TranscriptEntry } from "./game-runner.types";
import { sealHouseContinuityRequirement } from "./player-continuity";
import type { TokenTracker } from "./token-tracker";
import {
  compileHouseSummaryFrontier,
  createEmptyHouseNarrativeContinuity,
  isHouseSummaryActorCoordinate,
  retainHouseSummaryAtActorCoordinate,
  type HouseBeatClass,
  type HouseFactRow,
  type HouseNarrativeContinuity,
  type HouseSummaryActorCoordinate,
  type HouseSourceCoordinate,
  type HouseSummaryBoundary,
  type HouseSummaryPhaseReceipt,
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

// ---------------------------------------------------------------------------
// Game Runner
// ---------------------------------------------------------------------------

const HOUSE_SUMMARY_GAME_MAX_FACT_CALLS = 1;

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

function houseSourceCoordinatesEqual(
  left: HouseSourceCoordinate,
  right: HouseSourceCoordinate,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "canonical_event" && right.kind === "canonical_event") {
    return left.sequence === right.sequence
      && left.type === right.type
      && left.round === right.round
      && left.phase === right.phase;
  }
  if (left.kind === "canonical_projection" && right.kind === "canonical_projection") {
    return left.headSequence === right.headSequence
      && left.projection === right.projection
      && left.round === right.round
      && left.phase === right.phase;
  }
  if (left.kind === "transcript_entry" && right.kind === "transcript_entry") {
    return left.sequence === right.sequence
      && left.round === right.round
      && left.phase === right.phase
      && left.dialogueKind === right.dialogueKind;
  }
  return false;
}

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
  private flushedCanonicalSequence = 0;
  private terminalStreamReleased = false;
  private terminalOutcomeDurablyAccepted = false;
  private readonly writtenCheckpointKeys = new Set<string>();
  private houseStrategyBible: HouseStrategyBiblePacket | null = null;
  private readonly completedHouseRoundMilestones = new Set<number>();
  private readonly attemptedHouseSummaryBoundaries = new Set<string>();
  private readonly houseSummaryReceipts: HouseSummaryPhaseReceipt[] = [];
  private houseSummaryFactCallsUsed = 0;
  private houseNarrativeContinuity: HouseNarrativeContinuity = createEmptyHouseNarrativeContinuity();
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
    this.resumeFrom = options.resumeFrom;
    this.gameState = options.resumeFrom
      ? GameState.fromCanonicalEvents(options.resumeFrom.canonicalEvents)
      : new GameState(agents.map((a) => ({ id: a.id, name: a.name })), {
          ...gameStateOptions,
          formatManifest: resolveFormatManifest(config.formatManifest),
        });
    this.config = {
      ...config,
      maxRounds,
      formatManifest: [...this.gameState.formatManifest],
    };
    this.random = options.random;
    if (options.resumeFrom) {
      for (const event of options.resumeFrom.canonicalEvents) {
        if (event.type !== "player.eliminated") continue;
        this.eliminationOrderPlayerIds.push(event.payload.playerId);
        this.eliminationOrder.push(event.payload.playerName);
      }
      this.hydrateFormatKernelStateFromEvents(
        options.resumeFrom.canonicalEvents,
        options.resumeFrom.actorCoordinate,
      );
    }
    this.machine = createPhaseMachine();
    this.houseInterviewer = houseInterviewer ?? new TemplateHouseInterviewer();
    this.durableEventSink = options.durableEventSink;
    this.durableCheckpointSink = options.durableCheckpointSink;
    this.beforeAcceptedCommit = options.beforeAcceptedCommit;
    this.tokenTracker = options.tokenTracker;
    if (this.resumeFrom) {
      this.flushedCanonicalSequence = this.resumeFrom.lastEventSequence;
      this.writtenCheckpointKeys.add(`initial:${this.flushedCanonicalSequence}`);
      this.writtenCheckpointKeys.add(`phase_boundary:${this.flushedCanonicalSequence}`);
      if (this.resumeFrom.houseContinuityCapsule) {
        this.houseStrategyBible = {
          ...this.resumeFrom.houseContinuityCapsule,
          coveredWindow: {
            fromRound: this.resumeFrom.houseContinuityCapsule.updatedAtRound,
            toRound: this.resumeFrom.houseContinuityCapsule.updatedAtRound,
            fromPhase: this.resumeFrom.houseContinuityCapsule.updatedAtPhase,
            toPhase: this.resumeFrom.houseContinuityCapsule.updatedAtPhase,
          },
        };
      }
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
      this.houseNarrativeContinuity.examinedCanonicalHead = canonicalHead;
      this.houseNarrativeContinuity.examinedDialogueHead = dialogueHead;
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
      () => this.houseStrategyBible,
      () => this.buildHouseRoundFacts(this.gameState.round),
      this.beforeAcceptedCommit,
    );
    if (this.durableEventSink) {
      this.logger.beginStreamBuffering();
    }
  }

  get transcriptLog(): readonly TranscriptEntry[] {
    return this.logger.transcript;
  }

  /** Content-free per-boundary House summary receipts for simulation/accounting. */
  get houseSummaryPhaseReceipts(): readonly HouseSummaryPhaseReceipt[] {
    return this.houseSummaryReceipts;
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

  async run(): Promise<{
    winner?: UUID;
    winnerName?: string;
    rounds: number;
    transcript: TranscriptEntry[];
    eliminationOrder: string[];
    rankedPlayerIds: UUID[];
  }> {
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

    if (this.resumeFrom?.playerContinuityCapsules?.length) {
      const livingPlayerNames = this.gameState.getAlivePlayers().map((player) => player.name);
      for (const capsule of this.resumeFrom.playerContinuityCapsules) {
        const agent = this.agents.get(capsule.playerId);
        if (!agent?.restoreContinuityCapsule) {
          throw new Error(`Missing agent for continuity capsule ${capsule.playerName}/${capsule.playerId}`);
        }
        agent.restoreContinuityCapsule(capsule, { livingPlayerNames });
      }
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
      if (releaseStream) {
        this.logger.flushStreamBuffer();
      }
      if (options.checkpointKind) {
        await this.writeCheckpoint(options.checkpointKind, options.phase, options.phaseActor);
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
    const houseContinuityCapsule: HouseContinuityCapsule | null = this.houseStrategyBible
      ? { ...this.houseStrategyBible }
      : null;
    const houseContinuityRequirement = sealHouseContinuityRequirement({
      bibleEnabled: this.houseStrategyBibleEnabled(),
      hasValidHousePacket: houseContinuityCapsule != null,
    });

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
      houseContinuityCapsule,
      houseContinuityRequirement,
      transcriptReplay: hasRuntimeSnapshot ? this.buildTranscriptReplay() : null,
      // Transient write input for API product-dialogue watermark; not player-facing.
      productDialogueProjection: this.buildProductDialogueProjection(),
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

    if (this.resumeFrom?.kind === "phase_boundary") {
      await this.hydratePhaseActorForResume(actor, this.resumeFrom.actorCoordinate);
    } else {
      // Advance past INIT
      actor.send({ type: "PHASE_COMPLETE" });
    }
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
      if (this._aborted && this.durableEventSink) {
        this.logger.dropStreamBuffer();
        throw new Error("Game run aborted");
      }
      await this.flushDurableEvents({
        continueBuffering: true,
        checkpointKind: "phase_boundary",
        phase: this.phaseForActorCoordinate(String(actor.getSnapshot().value))
          ?? this.gameState.getCanonicalEvents().at(-1)?.phase
          ?? Phase.INIT,
        phaseActor: actor,
      });

      const houseBeat = this.houseBeatForActorCoordinate(state);
      if (houseBeat) {
        await this.emitHousePhaseBeat(
          houseBeat.actorCoordinate,
          houseBeat.phase,
          houseBeat.beatClass,
          houseBeat.roundMilestone,
        );
        await this.flushDurableEvents({ continueBuffering: true });
      }
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

  private houseStrategyBibleEnabled(): boolean {
    return this.config.enableHouseStrategyBible === true;
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

  private emitHousePhaseReceipt(receipt: HouseSummaryPhaseReceipt): void {
    this.houseSummaryReceipts.push(receipt);
    this.logger.emitAgentTurn({
      phase: receipt.phase,
      action: "house-summary-phase-receipt",
      actor: { name: "House", role: "house" },
      visibility: "private",
      response: { receipt },
      scope: "thinking",
    });
  }

  private buildHousePhaseReceipt(
    result: HouseSummaryAttemptResult,
    pendingDelta: HouseSummaryPhaseReceipt["pendingDelta"],
  ): HouseSummaryPhaseReceipt {
    return {
      version: 1,
      boundaryId: result.boundary.id,
      actorCoordinate: result.boundary.actorCoordinate,
      round: result.boundary.round,
      phase: result.boundary.phase,
      beatClass: result.boundary.beatClass,
      status: result.status,
      providerCalls: result.providerCalls,
      factCalls: result.factCalls,
      requestedCategories: [...result.requestedCategories],
      returnedBytes: result.returnedBytes,
      selectedSourceCount: result.status === "emitted" ? result.sources.length : 0,
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
    const round = this.gameState.round;
    if (!this.houseRoundSummariesEnabled()) {
      return;
    }
    const projection = this.gameState.getDomainProjection();
    const events = this.gameState.getCanonicalEventsAfter(
      this.houseNarrativeContinuity.examinedCanonicalHead,
    );
    const frontier = compileHouseSummaryFrontier({
      actorCoordinate,
      round,
      phase,
      beatClass,
      events,
      projection,
      transcript: this.logger.dialogueEntriesAfter(
        this.houseNarrativeContinuity.examinedDialogueHead,
      ),
      afterCanonicalSequence: this.houseNarrativeContinuity.examinedCanonicalHead,
      afterDialogueSequence: this.houseNarrativeContinuity.examinedDialogueHead,
    });
    if (this.attemptedHouseSummaryBoundaries.has(frontier.boundary.id)) return;
    this.attemptedHouseSummaryBoundaries.add(frontier.boundary.id);

    if (!frontier.material) {
      this.houseNarrativeContinuity.examinedCanonicalHead = frontier.boundary.canonicalHead;
      this.houseNarrativeContinuity.examinedDialogueHead = frontier.boundary.dialogueHead;
      this.emitHousePhaseReceipt({
        version: 1,
        boundaryId: frontier.boundary.id,
        actorCoordinate,
        round,
        phase,
        beatClass,
        status: "preflight_skipped",
        providerCalls: 0,
        factCalls: 0,
        requestedCategories: [],
        returnedBytes: 0,
        selectedSourceCount: 0,
        usageAvailable: true,
        usage: [],
        pendingDelta: "none",
      });
      return;
    }

    const isFirstRoundMilestone = roundMilestone && !this.completedHouseRoundMilestones.has(round);
    if (isFirstRoundMilestone) this.completedHouseRoundMilestones.add(round);
    const coveredWindow = isFirstRoundMilestone ? this.buildHouseCoveredWindow(phase) : null;
    const evidence = isFirstRoundMilestone && (this.houseStrategyBibleEnabled() || this.houseLongFormSummariesEnabled())
      ? this.buildHouseEvidenceBundle(phase)
      : null;

    if (isFirstRoundMilestone && this.houseStrategyBibleEnabled() && evidence && coveredWindow) {
      try {
        const update = await this.houseInterviewer.updateStrategyBible({
          round,
          phase,
          previousPacket: this.houseStrategyBible,
          evidence,
          coveredWindow,
        });
        if (update.packet) {
          this.houseStrategyBible = update.packet;
          this.logger.emitAgentTurn({
            phase,
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
    const hadPendingDelta = this.houseNarrativeContinuity.pendingDeltaCarry === 1;
    const factReadAllowed = beatClass === "milestone"
      && this.houseSummaryFactCallsUsed < HOUSE_SUMMARY_GAME_MAX_FACT_CALLS;
    let result: HouseSummaryAttemptResult;
    try {
      result = await this.houseInterviewer.generateHouseSummary({
        frontier,
        continuity: this.houseNarrativeContinuity,
        factReadAllowed,
      });
    } catch {
      result = {
        status: "failed",
        reason: "house_interviewer_threw",
        boundary: frontier.boundary,
        providerCalls: 0,
        factCalls: 0,
        requestedCategories: [],
        returnedBytes: 0,
        usage: [],
      };
    }

    const reportedFactCalls = Number.isInteger(result.factCalls) && result.factCalls >= 0
      ? result.factCalls
      : 0;
    this.houseSummaryFactCallsUsed += reportedFactCalls;
    const factBudgetExceeded = reportedFactCalls !== result.factCalls
      || result.factCalls > (factReadAllowed ? 1 : 0)
      || this.houseSummaryFactCallsUsed > HOUSE_SUMMARY_GAME_MAX_FACT_CALLS;
    if (factBudgetExceeded) {
      result = {
        status: "failed",
        reason: "house_summary_fact_budget_exceeded",
        boundary: frontier.boundary,
        providerCalls: result.providerCalls,
        factCalls: result.factCalls,
        requestedCategories: [...result.requestedCategories],
        returnedBytes: result.returnedBytes,
        usage: result.usage.map((entry) => ({ ...entry })),
        ...(result.thinking ? { thinking: result.thinking } : {}),
        ...(result.reasoningContext ? { reasoningContext: result.reasoningContext } : {}),
      };
    }

    if (result.status === "emitted") {
      const validatedSummary = validatePublicHouseSummaryProse(result.summary, beatClass);
      const supportedSourceByAlias = new Map<string, HouseSourceCoordinate>();
      const supportedFactByAlias = new Map<string, HouseFactRow>();
      for (const item of frontier.catalog) supportedSourceByAlias.set(item.alias, item.source);
      for (const rows of Object.values(frontier.factStore)) {
        for (const row of rows) {
          supportedSourceByAlias.set(row.alias, row.source);
          supportedFactByAlias.set(row.alias, row);
        }
      }
      const hasSupportedSources = result.sourceAliases.length > 0
        && result.sourceAliases.length === result.sources.length
        && new Set(result.sourceAliases).size === result.sourceAliases.length
        && result.sourceAliases.every((alias, index) => {
          const expectedSource = supportedSourceByAlias.get(alias);
          const actualSource = result.status === "emitted" ? result.sources[index] : undefined;
          return expectedSource !== undefined
            && actualSource !== undefined
            && houseSourceCoordinatesEqual(expectedSource, actualSource);
        });
      const selectedFacts = result.sourceAliases.flatMap((alias) => {
        const fact = supportedFactByAlias.get(alias);
        return fact ? [fact] : [];
      });
      const failureReason = validatedSummary === null
        ? "public_house_summary_validation_failed"
        : !houseSummaryBoundariesEqual(result.boundary, frontier.boundary)
          ? "house_summary_boundary_mismatch"
          : !hasSupportedSources
            ? "unsupported_house_summary_sources"
            : !publicHousePlayerCountClaimsAreSupported(result.summary, selectedFacts)
              ? "unsupported_house_summary_player_count"
              : !publicHouseDialogueAttributionsAreSupported(
                  result.summary,
                  selectedFacts,
                  [...supportedFactByAlias.values()],
                )
                ? "unsupported_house_summary_dialogue_attribution"
                : null;
      if (failureReason !== null) {
        result = {
          status: "failed",
          reason: failureReason,
          boundary: frontier.boundary,
          providerCalls: result.providerCalls,
          factCalls: result.factCalls,
          requestedCategories: [...result.requestedCategories],
          returnedBytes: result.returnedBytes,
          usage: result.usage.map((entry) => ({ ...entry })),
          ...(result.thinking ? { thinking: result.thinking } : {}),
          ...(result.reasoningContext ? { reasoningContext: result.reasoningContext } : {}),
        };
      } else if (validatedSummary !== null && validatedSummary !== result.summary) {
        result = { ...result, summary: validatedSummary };
      }
    }

    let pendingDelta: HouseSummaryPhaseReceipt["pendingDelta"] = "none";
    if (result.status === "emitted") {
      this.logger.emitAgentTurn({
        phase,
        action: "house-mc-summary",
        actor: { name: "House", role: "house" },
        visibility: "system",
        response: { summary: result.summary },
        scope: "system",
        text: result.summary,
      });
      this.logger.logSystem(result.summary, phase, undefined, undefined, "house_summary");
      this.houseNarrativeContinuity = {
        version: 1,
        lastBoundaryId: frontier.boundary.id,
        lastSummary: result.summary,
        lastSummaryByActorCoordinate: retainHouseSummaryAtActorCoordinate(
          this.houseNarrativeContinuity.lastSummaryByActorCoordinate,
          frontier.boundary.actorCoordinate,
          result.summary,
        ),
        openQuestions: result.openQuestions.slice(0, 3),
        threadIds: result.threadIds.slice(0, 3),
        supportingSources: result.sources.slice(0, 8),
        examinedCanonicalHead: frontier.boundary.canonicalHead,
        examinedDialogueHead: this.logger.dialogueHead,
        emittedCanonicalHead: frontier.boundary.canonicalHead,
        emittedDialogueHead: frontier.boundary.dialogueHead,
        pendingDeltaCarry: 0,
      };
      pendingDelta = hadPendingDelta ? "carried" : "none";
    } else if (result.status === "model_skipped") {
      this.houseNarrativeContinuity.examinedCanonicalHead = frontier.boundary.canonicalHead;
      this.houseNarrativeContinuity.examinedDialogueHead = frontier.boundary.dialogueHead;
      this.houseNarrativeContinuity.pendingDeltaCarry = 0;
      pendingDelta = hadPendingDelta ? "dropped" : "none";
    } else if (hadPendingDelta) {
      this.houseNarrativeContinuity.examinedCanonicalHead = frontier.boundary.canonicalHead;
      this.houseNarrativeContinuity.examinedDialogueHead = frontier.boundary.dialogueHead;
      this.houseNarrativeContinuity.pendingDeltaCarry = 0;
      pendingDelta = "dropped";
    } else {
      this.houseNarrativeContinuity.pendingDeltaCarry = 1;
      pendingDelta = "carried";
    }
    this.emitHousePhaseReceipt(this.buildHousePhaseReceipt(result, pendingDelta));

    if (isFirstRoundMilestone && this.houseLongFormSummariesEnabled() && evidence && coveredWindow) {
      try {
        const longForm = await this.houseInterviewer.generateLongFormGameplaySummary({
          gameId: this.gameState.gameId,
          round,
          phase,
          kind: "long-form",
          alivePlayers: this.gameState.getAlivePlayers().map((player) => player.name),
          packet: this.houseStrategyBible,
          evidence,
          coveredWindow,
        });
        this.emitHouseSummaryTurn("house-long-form-summary", phase, longForm, "private", evidence.roundFacts);
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
      if (player.id === empoweredId && councilResolved?.payload.method === "plurality") {
        return {
          playerName: player.name,
          role: "empowered_no_tiebreak_needed",
          candidateNames,
          eliminatedName,
          survivingCandidateName,
          votedForName: null,
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
    const roundResult = this.latestRoundEvent(events, "round.result_recorded");

    const councilCandidates = councilResolved?.payload.candidates
      ?? candidatesResolved?.payload.candidates
      ?? this.gameState.councilCandidates;
    const empoweredId = empoweredSet?.payload.empowered
      ?? councilResolved?.payload.empoweredId
      ?? this.gameState.empoweredId;

    // Always derive omniscient format facts from durable events (R14 option A).
    const formatResolution = buildHouseFormatResolutionFacts(
      this.gameState.getCanonicalEvents(),
      round,
      (playerId) => this.gameState.getPlayerName(playerId),
    );
    const selectedFormatId =
      formatResolution?.formatId
      ?? roundResult?.payload.result.formatId
      ?? this.formatKernelState.selectedFormat
      ?? this.formatKernelState.lastSelectedFormat
      ?? null;
    const offeredFormatIds =
      (formatResolution?.offeredFormatIds as [LaunchFormatId, LaunchFormatId] | null)
      ?? this.formatKernelState.offeredFormats;
    const formatMethod =
      formatResolution?.resolutionKind
      ?? roundResult?.payload.result.formatMethod
      ?? selectedFormatId;
    const eliminationPath: HouseRoundFacts["eliminationPath"] =
      formatResolution || selectedFormatId || playerEliminated?.phase === "FORMAT_RESOLVE"
        ? "format"
        : councilResolved
          ? "council"
          : candidatesResolved?.payload.autoEliminated
            ? "power_auto"
            : "unknown";

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
        ?? formatResolution?.eliminatedName
        ?? (councilResolved?.payload.eliminated ? this.gameState.getPlayerName(councilResolved.payload.eliminated) : null),
      councilRoles: this.buildHouseCouncilRoles(councilCandidates, councilResolved),
      selectedFormatId,
      selectedFormatName: selectedFormatId ? displayNameForFormat(selectedFormatId) : null,
      offeredFormatIds: offeredFormatIds ? [...offeredFormatIds] : null,
      offeredFormatNames: offeredFormatIds
        ? [displayNameForFormat(offeredFormatIds[0]), displayNameForFormat(offeredFormatIds[1])]
        : null,
      formatMethod: formatMethod ?? null,
      eliminationPath,
      formatResolution,
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
