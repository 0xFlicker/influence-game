/**
 * Game Lifecycle Service
 *
 * Bridges the API server with the engine's GameRunner.
 * Handles constructing agents from DB records, running games asynchronously,
 * and persisting transcripts + results back to the database.
 */

import { and, eq } from "drizzle-orm";
import {
  GameRunner,
  InfluenceAgent,
  LLMHouseInterviewer,
  Phase,
  TokenTracker,
  createLlmClientFromEnv,
  estimateCostForKnownModel,
  normalizeGameModelSelection,
  resolveModelSelection,
} from "@influence/engine";
import type {
  AgentResponse,
  CanonicalGameEvent,
  IAgent,
  MingleIntentAction,
  LlmToolChoiceMode,
  Personality,
  GameConfig,
  GameRunnerOptions,
  PhaseContext,
  ProviderProfileId,
  PrivateDecisionTrace,
  PrivateTraceSink,
  PowerAction,
  StrategicReflectionAction,
  TargetDecision,
  TranscriptEntry,
  UUID,
  ViewerMode,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { PgMemoryStore } from "../db/memory-store.js";
import { broadcastGameEvent, broadcastRaw, broadcastWatchState, getObserverCount } from "./ws-manager.js";
import { ViewerEventPacer } from "./viewer-event-pacer.js";
import { appendGameEvents, hashCanonicalEvent } from "./game-events.js";
import { getGameWatchState, type GameWatchState } from "./game-watch-state.js";
import { tryRefreshGameWatchStateSummary } from "./game-watch-state-summary.js";
import { writeGameCheckpoint } from "./game-checkpoints.js";
import {
  acquireRecoveryGameRunOwner,
  assertOwnerActive,
  GameOwnerTransitionError,
  markGameSuspended,
  markOwnerStartupFailed,
  renewGameRunOwner,
  type OwnerStartupFailureResult,
} from "./game-ownership.js";
import { writePrivateDecisionTrace } from "./private-trace-writer.js";
import { writeCognitiveArtifactsForTrace } from "./cognitive-artifact-writer.js";
import { recordProviderSpendForTrace } from "./provider-cost-accounting.js";
import {
  findStartupRecoverableGameIds,
  getSupportedRecovery,
} from "./game-recovery.js";
import { isUserSelectableAgentArchetype } from "./agent-archetypes.js";
import { reconcilePostgameMediaForGame } from "./postgame-media-coordinator.js";
import { CompetitionSettlementRepairRequiredError } from "./competition-completion.js";
import {
  COMPLETION_SETTLEMENT_REPAIR_REQUIRED,
  COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
  captureGameCompletionSettlement,
  GameCompletionSettlementError,
  getGameCompletionSettlementSummary,
  prepareCapturedCompletionAfterRunnerExit,
  settleCapturedGameCompletion,
} from "./game-completion-settlement.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";

export { serializeTranscriptEntry } from "./transcript-serialization.js";

// ---------------------------------------------------------------------------
// Active game tracking
// ---------------------------------------------------------------------------

interface ActiveGame {
  gameId: string;
  runner: GameRunner;
  ownerEpoch?: string;
  heartbeat?: OwnerHeartbeat;
  startedAt: Date;
  promise: Promise<void>;
}

const OWNER_LEASE_MS = 10 * 60 * 1000;
const OWNER_HEARTBEAT_MS = 2 * 60 * 1000;

interface OwnerHeartbeat {
  stop: () => void;
}

function startOwnerHeartbeat(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  runner: GameRunner,
): OwnerHeartbeat {
  let stopped = false;
  const interval = setInterval(() => {
    if (stopped) return;
    renewGameRunOwner(db, gameId, ownerEpoch, { leaseMs: OWNER_LEASE_MS })
      .catch(async (error) => {
        if (stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[game-lifecycle] Owner heartbeat failed for game ${gameId}:`, message);
        stopped = true;
        clearInterval(interval);
        runner.abort();
        await markGameSuspended(db, gameId, "owner_heartbeat_failed", { message }).catch(() => {});
        await tryRefreshGameWatchStateSummary(db, gameId, "owner_heartbeat_failed");
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "suspended",
          terminal: true,
          reasonCode: "owner_heartbeat_failed",
          message: "The game failed and cannot be resumed.",
        });
      });
  }, OWNER_HEARTBEAT_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

function createPrivateTraceSink(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  cognitiveArtifactCaptureVersion: number,
): PrivateTraceSink {
  return async (trace) => {
    const enrichedTrace: PrivateDecisionTrace = {
      ...trace,
      gameId,
      ownerEpoch,
    };
    let traceManifestId: string | undefined;
    try {
      const cognitiveResult = await writeCognitiveArtifactsForTrace(db, {
        gameId,
        trace: enrichedTrace,
        captureVersion: cognitiveArtifactCaptureVersion,
        eventSequence: trace.boundary?.finalEventSequence,
      });
      if (!cognitiveResult.ok) {
        console.warn(`[game-lifecycle] Cognitive artifact capture failed for game ${gameId}: ${cognitiveResult.error}`);
      } else if (cognitiveResult.degradedArtifactIds.length > 0) {
        console.warn(`[game-lifecycle] Cognitive artifact capture degraded for game ${gameId}: ${cognitiveResult.degradedArtifactIds.length} oversized artifact(s)`);
      }
    } catch (error) {
      console.warn(`[game-lifecycle] Cognitive artifact capture failed for game ${gameId}:`, error);
    }

    try {
      const result = await writePrivateDecisionTrace(db, {
        gameId,
        ownerEpoch,
        trace: enrichedTrace,
        eventSequence: trace.boundary?.finalEventSequence,
      });
      if (!result.ok) {
        console.warn(`[game-lifecycle] Private trace degraded for game ${gameId}: ${result.error}`);
      } else {
        traceManifestId = result.manifestId;
      }
    } catch (error) {
      console.warn(`[game-lifecycle] Private trace sink failed for game ${gameId}:`, error);
    }

    try {
      await recordProviderSpendForTrace(db, {
        gameId,
        ownerEpoch,
        trace: enrichedTrace,
        eventSequence: trace.boundary?.finalEventSequence,
        ...(traceManifestId && { traceManifestId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[game-lifecycle] Cost accounting capture failed for game ${gameId}: ${message}`);
    }
  };
}

/** Map of gameId → active game. Prevents double-starts and enables status queries. */
const activeGames = new Map<string, ActiveGame>();

export function isGameRunning(gameId: string): boolean {
  return activeGames.has(gameId);
}

export function getActiveGameCount(): number {
  return activeGames.size;
}

export function abortGame(gameId: string): boolean {
  const active = activeGames.get(gameId);
  if (!active) return false;
  active.runner.abort();
  return true;
}

/** Abort and await all active games — used by tests to prevent cross-file pollution. */
export async function abortAllGames(): Promise<void> {
  for (const game of activeGames.values()) {
    game.runner.abort();
  }
  const promises = [...activeGames.values()].map((g) =>
    g.promise.catch(() => {}),
  );
  await Promise.all(promises);
}

export async function appendDurableEventsAndPublishWatchState(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    events: readonly CanonicalGameEvent[];
  },
): Promise<void> {
  await appendGameEvents(db, params);
  if (params.events.some((event) => event.type === "jury.winner_determined")) {
    return;
  }
  const refresh = await tryRefreshGameWatchStateSummary(db, params.gameId, "durable_append");
  await publishCurrentWatchState(db, params.gameId, "durable append", refresh?.watchState);
}

async function publishCurrentWatchState(
  db: DrizzleDB,
  gameId: string,
  reason: string,
  prebuiltWatchState?: GameWatchState,
): Promise<void> {
  if (getObserverCount(gameId) === 0) return;
  try {
    const watchState = prebuiltWatchState ?? await getGameWatchState(db, gameId);
    if (watchState) {
      broadcastWatchState(gameId, watchState);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[game-lifecycle] Watch-state publish failed after ${reason} for game ${gameId}: ${message}`);
  }
}

function resolvePersonality(key: string | null | undefined): Personality {
  if (isUserSelectableAgentArchetype(key)) {
    return key as Personality;
  }
  return "strategic";
}

function mockResponse(message: string): AgentResponse {
  return { thinking: "", message };
}

class ApiTestMockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart() {}
  async onPhaseStart() {}
  async getIntroduction() { return mockResponse(`Hi, I'm ${this.name}`); }
  async getLobbyMessage(ctx: PhaseContext) { return mockResponse(`${this.name} round ${ctx.round}`); }
  async getWhispers(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) return [];
    return [{ to: [others[0]!.id], text: "secret" }];
  }
  async getMingleIntent(ctx: PhaseContext): Promise<MingleIntentAction> {
    const other = ctx.alivePlayers.find((p) => p.id !== this.id)?.name ?? null;
    return {
      seekPlayers: other ? [other] : [],
      avoidPlayers: [],
      preferredRoomSize: "any",
      purpose: "api route test Mingle intent",
      provisionalTarget: null,
      noTargetReason: "api route test mock does not pick a target",
      openingAsk: "compare notes",
      strategicLens: "room_traffic",
      strategicLensRationale: "api route test mock watches room traffic",
      thinking: "api route test Mingle intent",
    };
  }
  async sendRoomMessage(
    _ctx: PhaseContext,
    roomMates: string[],
    conversationHistory?: Array<{ from: string; text: string }>,
  ) {
    const alreadySpoke = conversationHistory?.some((m) => m.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    return others.length > 0 ? mockResponse(`whisper to ${others.join(", ")}`) : null;
  }
  async getRumorMessage() { return mockResponse("rumor"); }
  async getVotes(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return {
      empowerTarget: others[0]?.id ?? this.id,
      exposeTarget: others[others.length - 1]?.id ?? this.id,
    };
  }
  async getEmpowerRevote(ctx: PhaseContext, tiedCandidates: UUID[]) {
    return {
      empowerTarget: tiedCandidates[0] ?? ctx.alivePlayers.find((p) => p.id !== this.id)?.id ?? this.id,
      thinking: "api route test empower revote",
    };
  }
  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }
  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID }> {
    return { target: candidates[0] };
  }
  async getLastMessage() { return mockResponse("goodbye"); }
  async getDiaryEntry() { return mockResponse("diary entry"); }
  async getPlea() { return mockResponse("please keep me"); }
  async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return { target: others[0]?.id ?? this.id, thinking: "api route test endgame vote" };
  }
  async getAccusation(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return { targetId: others[0]?.id ?? this.id, text: "accusation" };
  }
  async getDefense(_ctx: PhaseContext, accusationText?: string, accuserName?: string) {
    return mockResponse(`defense against ${accuserName ?? "unknown"}: ${accusationText ?? "unknown accusation"}`);
  }
  async getOpeningStatement() { return mockResponse("opening"); }
  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]) {
    return { targetFinalistId: finalistIds[0], question: "why?" };
  }
  async getJuryAnswer() { return mockResponse("because"); }
  async getClosingArgument() { return mockResponse("closing"); }
  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<TargetDecision> {
    return { target: finalistIds[0], thinking: "api route test jury vote" };
  }
  async getStrategicReflection(_ctx: PhaseContext): Promise<StrategicReflectionAction> {
    return {
      certainties: [],
      suspicions: [],
      allies: [],
      threats: [],
      plan: "api route test plan",
      strategicLens: "broad_read",
      strategicLensRationale: "api route test broad reflection",
      thinking: "api route test strategic reflection",
    };
  }

  updateAlly(_playerName: string): void {}
  updateThreat(_playerName: string): void {}
  addNote(_playerName: string, _note: string): void {}
  removeFromMemory(_playerName: string): void {}
}

interface CompletedGameRunResult {
  winner?: string;
  winnerName?: string;
  rounds: number;
  transcript: TranscriptEntry[];
  eliminationOrder: string[];
  rankedPlayerIds: string[];
}

async function captureCompletedGame(
  db: DrizzleDB,
  params: {
    gameId: string;
    resultGameId: string;
    ownerEpoch: string;
    result: CompletedGameRunResult;
    finalEventSequence: number;
    finalEventHash: string;
    tokenTracker: TokenTracker;
    gameConfig: Record<string, unknown>;
  },
): Promise<void> {
  const resolvedModelSelection = resolveModelSelection(
    normalizeGameModelSelection(params.gameConfig.modelSelection),
    params.gameConfig.modelTier as string | undefined,
  );
  const model = resolvedModelSelection.modelId;
  const usage = params.tokenTracker.getTotalUsage();
  const cost = estimateCostForKnownModel(usage, model);
  await captureGameCompletionSettlement(db, {
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    finalEventSequence: params.finalEventSequence,
    finalEventHash: params.finalEventHash,
    terminalResult: {
      gameId: params.resultGameId,
      winnerId: params.result.winner ?? null,
      winnerName: params.result.winnerName ?? null,
      rounds: params.result.rounds,
      transcript: params.result.transcript,
      eliminationOrder: params.result.eliminationOrder,
      rankedPlayerIds: params.result.rankedPlayerIds,
    },
    tokenUsage: {
      total: usage,
      perAction: params.tokenTracker.getAllUsage(),
    },
    resolvedModel: model,
    calculatedCost: cost,
    completionConfig: { ...params.gameConfig, viewerMode: "replay" },
    finishedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Start a game
// ---------------------------------------------------------------------------

export function buildEngineConfigFromGameRecord(
  gameConfig: Record<string, unknown>,
  minPlayers: number,
  maxPlayers: number,
): GameConfig {
  const defaultTimers = {
    introduction: 30000,
    lobby: 30000,
    mingle: 45000,
    rumor: 30000,
    vote: 20000,
    power: 15000,
    council: 20000,
  };
  const storedTimers = (gameConfig.timers ?? {}) as Record<string, number>;

  const roomPhaseTimer = storedTimers.mingle ?? defaultTimers.mingle;
  const { whisper: _unsupportedWhisperTimer, ...currentTimers } = storedTimers;

  return {
    maxRounds: (gameConfig.maxRounds as number) ?? 10,
    minPlayers,
    maxPlayers,
    timers: {
      ...defaultTimers,
      ...currentTimers,
      mingle: roomPhaseTimer,
    },
    diaryRoomAfterPhases: [Phase.COUNCIL],
  };
}

function providerPreflightEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.INFLUENCE_LLM_PREFLIGHT?.trim().toLowerCase();
  return value !== "off" && value !== "false" && value !== "0";
}

function providerPreflightTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.INFLUENCE_LLM_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

function publicProviderStartupError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

export interface ModelPreflightClient {
  providerLabel: string;
  client: {
    models: {
      list: () => Promise<{ data?: Array<{ id: string }> }>;
      retrieve: (modelId: string) => Promise<unknown>;
    };
  };
}

export async function preflightSelectedModel(
  llmConfig: ModelPreflightClient,
  modelId: string,
  providerProfileId: ProviderProfileId,
): Promise<void> {
  if (providerProfileId === "katana") {
    const models = await llmConfig.client.models.list();
    const modelIds = models.data?.map((model) => model.id) ?? [];
    if (!modelIds.includes(modelId)) {
      throw new Error(`Model ${modelId} is not available from ${llmConfig.providerLabel}`);
    }
    return;
  }

  await llmConfig.client.models.retrieve(modelId);
}

export async function validateGameStartReadiness(
  db: DrizzleDB,
  gameId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ error?: string }> {
  const game = (await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId)))[0];

  if (!game) {
    return { error: "Game not found" };
  }

  let gameConfig: Record<string, unknown>;
  try {
    gameConfig = JSON.parse(game.config) as Record<string, unknown>;
  } catch {
    return { error: "Invalid game configuration" };
  }

  let resolvedModelSelection;
  try {
    resolvedModelSelection = resolveModelSelection(
      normalizeGameModelSelection(gameConfig.modelSelection),
      gameConfig.modelTier as string | undefined,
    );
  } catch (error) {
    return { error: publicProviderStartupError(error) };
  }

  if (env.INFLUENCE_API_TEST_MOCK_RUNNER === "true") {
    return {};
  }

  const llmConfig = createLlmClientFromEnv(env, {
    maxRetries: 0,
    providerProfileId: resolvedModelSelection.providerProfile.id,
    timeout: providerPreflightTimeoutMs(env),
  });
  if (!llmConfig) {
    return { error: "LLM provider not configured" };
  }

  if (!providerPreflightEnabled(env)) {
    return {};
  }

  try {
    await preflightSelectedModel(
      llmConfig,
      resolvedModelSelection.modelId,
      resolvedModelSelection.providerProfile.id,
    );
  } catch (error) {
    return {
      error: `LLM provider preflight failed: ${publicProviderStartupError(error)}`,
    };
  }

  return {};
}

export async function startGame(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch?: string,
  options: { resumeFrom?: GameRunnerOptions["resumeFrom"] } = {},
): Promise<{ error?: string }> {
  // Prevent double-start
  if (activeGames.has(gameId)) {
    return { error: "Game is already running" };
  }

  // Load game record
  const game = (await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId)))[0];

  if (!game) {
    return { error: "Game not found" };
  }

  if (game.status !== "in_progress") {
    return { error: "Game must be in_progress to run" };
  }

  // Load players
  const players = await db
    .select()
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));

  if (players.length < game.minPlayers) {
    return { error: `Not enough players: ${players.length} < ${game.minPlayers}` };
  }

  // Parse game config
  const gameConfig = JSON.parse(game.config) as Record<string, unknown>;

  const useTestMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER === "true";
  const resolvedModelSelection = resolveModelSelection(
    normalizeGameModelSelection(gameConfig.modelSelection),
    gameConfig.modelTier as string | undefined,
  );

  const llmConfig = useTestMockRunner
    ? null
    : createLlmClientFromEnv(process.env, {
        providerProfileId: resolvedModelSelection.providerProfile.id,
      });
  if (!llmConfig) {
    if (!useTestMockRunner) {
      return { error: "LLM provider not configured" };
    }
  }

  // Create token tracker
  const tokenTracker = new TokenTracker();
  const privateTraceSink = ownerEpoch
    ? createPrivateTraceSink(db, gameId, ownerEpoch, game.cognitiveArtifactCaptureVersion)
    : undefined;
  const toolChoiceMode = resolvedModelSelection.model.preferredToolChoiceMode ?? llmConfig?.toolChoiceMode;

  // Construct agents from player records
  const agents: IAgent[] = players.map((player) => {
    const persona = JSON.parse(player.persona) as {
      name: string;
      personality?: string;
      strategyHints?: string;
      personaKey?: string;
      backstory?: string;
    };
    if (useTestMockRunner) {
      return new ApiTestMockAgent(player.id, persona.name);
    }

    if (!llmConfig) {
      throw new Error("LLM provider not configured");
    }

    const agentCfg = JSON.parse(player.agentConfig) as {
      model?: string;
      temperature?: number;
      toolChoiceMode?: unknown;
    };

    const personality = resolvePersonality(
      persona.personaKey ?? persona.personality,
    );
    const model = agentCfg.model ?? resolvedModelSelection.modelId;
    const playerToolChoiceMode = player.agentProfileId
      ? parseToolChoiceMode(agentCfg.toolChoiceMode) ?? toolChoiceMode
      : toolChoiceMode;

    const memoryStore = new PgMemoryStore(db);
    const agent = new InfluenceAgent(
      player.id,
      persona.name,
      personality,
      llmConfig.client,
      model,
      persona.backstory,
      memoryStore,
      {
        ...(playerToolChoiceMode && { toolChoiceMode: playerToolChoiceMode }),
        ...(llmConfig.openAIReasoningSummary && { openAIReasoningSummary: llmConfig.openAIReasoningSummary }),
        providerProfileId: resolvedModelSelection.providerProfile.id,
        catalogId: resolvedModelSelection.catalogId,
        modelCapabilities: resolvedModelSelection.model.capabilities,
        reasoningPolicy: resolvedModelSelection.reasoningPolicy,
        ...(player.agentProfileId && persona.personality && { personalityPrompt: persona.personality }),
        ...(player.agentProfileId && persona.strategyHints && { strategyInstructions: persona.strategyHints }),
        ...(agentCfg.temperature !== undefined && { temperature: agentCfg.temperature }),
        ...(privateTraceSink && { privateTraceSink }),
      },
    );
    agent.setTokenTracker(tokenTracker);
    return agent;
  });

  const engineConfig = buildEngineConfigFromGameRecord(gameConfig, game.minPlayers, game.maxPlayers);

  const houseInterviewer = !useTestMockRunner && llmConfig
    ? new LLMHouseInterviewer(
        llmConfig.client,
        resolvedModelSelection.modelId,
        {
          gameId,
          ...(toolChoiceMode && { toolChoiceMode }),
          providerProfileId: resolvedModelSelection.providerProfile.id,
          catalogId: resolvedModelSelection.catalogId,
          modelCapabilities: resolvedModelSelection.model.capabilities,
          reasoningPolicy: resolvedModelSelection.reasoningPolicy,
          ...(ownerEpoch && { ownerEpoch }),
          ...(privateTraceSink && { privateTraceSink }),
        },
      )
    : undefined;
  houseInterviewer?.setTokenTracker(tokenTracker);

  // Create runner
  const runner = new GameRunner(agents, engineConfig, houseInterviewer, {
    gameId,
    ...(options.resumeFrom && { resumeFrom: options.resumeFrom }),
    ...(privateTraceSink && { privateTraceSink }),
    tokenTracker,
    ...(ownerEpoch && {
      durableEventSink: (events) => appendDurableEventsAndPublishWatchState(db, { gameId, ownerEpoch, events }),
      durableCheckpointSink: async (checkpoint) => {
        const result = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
        if (!result.ok) {
          console.warn(`[game-lifecycle] Checkpoint degraded for game ${gameId}: ${result.error}`);
        }
      },
      beforeAcceptedCommit: () => assertOwnerActive(db, gameId, ownerEpoch),
    }),
  });

  // Stream game events to WebSocket observers via the display-hold pacer
  const viewerMode: ViewerMode =
    (gameConfig.viewerMode as ViewerMode) ?? "speedrun";
  const pacer = new ViewerEventPacer(
    viewerMode === "replay" ? "speedrun" : viewerMode,
    (event) => broadcastGameEvent(gameId, event),
  );
  runner.setStreamListener((event) => pacer.emit(event));

  // Run game asynchronously
  const heartbeat = ownerEpoch
    ? startOwnerHeartbeat(db, gameId, ownerEpoch, runner)
    : undefined;
  const promise = runGameAsync(db, gameId, runner, tokenTracker, gameConfig, ownerEpoch, heartbeat);

  activeGames.set(gameId, {
    gameId,
    runner,
    ...(ownerEpoch && { ownerEpoch }),
    ...(heartbeat && { heartbeat }),
    startedAt: new Date(),
    promise,
  });

  return {};
}

function parseToolChoiceMode(value: unknown): LlmToolChoiceMode | undefined {
  return value === "named" || value === "required" || value === "auto" || value === "json_schema"
    ? value
    : undefined;
}

export function classifyGameRunFailure(error: unknown): {
  failureReason: string;
  failureDetails: Record<string, unknown>;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CompetitionSettlementRepairRequiredError) {
    return {
      failureReason: error.code,
      failureDetails: { reason: error.reason, message },
    };
  }
  if (error instanceof GameCompletionSettlementError) {
    return {
      failureReason: error.code,
      failureDetails: { safeFailureCode: error.safeFailureCode, message },
    };
  }
  return { failureReason: "runner_failed", failureDetails: { message } };
}

export async function tryReturnZeroEventOwnerFailureToWaiting(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  errorMessage: string,
): Promise<
  | { outcome: "returned_to_waiting"; cleanup: OwnerStartupFailureResult }
  | {
      outcome: "not_returned";
      cleanupFailure: { code: "stale_owner" | "invalid_state" | "unknown"; message: string };
    }
> {
  try {
    return {
      outcome: "returned_to_waiting",
      cleanup: await markOwnerStartupFailed(db, gameId, ownerEpoch, errorMessage),
    };
  } catch (error) {
    return {
      outcome: "not_returned",
      cleanupFailure: {
        code: error instanceof GameOwnerTransitionError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function recoverGame(
  db: DrizzleDB,
  gameId: string,
): Promise<{ error?: string; recovered?: boolean; skippedReason?: string }> {
  if (activeGames.has(gameId)) {
    return { error: "Game is already running" };
  }

  const candidate = await getSupportedRecovery(db, gameId);
  if (!candidate.ok) {
    return { skippedReason: candidate.reason };
  }

  const owner = await acquireRecoveryGameRunOwner(db, gameId, candidate.resumeFrom.lastEventSequence);
  if (!owner.ok) {
    return { error: owner.error };
  }

  let startupError: string | undefined;
  try {
    const result = await startGame(db, gameId, owner.claim.ownerEpoch, {
      resumeFrom: candidate.resumeFrom,
    });
    startupError = result.error;
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
  }

  if (startupError) {
    await markGameSuspended(db, gameId, "recovery_startup_failed", { message: startupError });
    await tryRefreshGameWatchStateSummary(db, gameId, "recovery_startup_failed");
    return { error: startupError };
  }

  await tryRefreshGameWatchStateSummary(db, gameId, "recovery_started");
  return { recovered: true };
}

export async function recoverGamesOnStartup(
  db: DrizzleDB,
): Promise<{ attempted: number; recovered: number; skipped: Array<{ gameId: string; reason: string }> }> {
  const gameIds = await findStartupRecoverableGameIds(db);
  const skipped: Array<{ gameId: string; reason: string }> = [];
  let recovered = 0;

  for (const gameId of gameIds) {
    const result = await recoverGame(db, gameId);
    if (result.recovered) {
      recovered += 1;
      continue;
    }
    skipped.push({ gameId, reason: result.error ?? result.skippedReason ?? "unknown" });
  }

  return {
    attempted: gameIds.length,
    recovered,
    skipped,
  };
}

export async function reconcilePostgameMediaAfterCompletion(
  db: DrizzleDB,
  gameId: string,
  reconcile: typeof reconcilePostgameMediaForGame = reconcilePostgameMediaForGame,
): Promise<boolean> {
  try {
    await reconcile(db, gameId);
    return true;
  } catch {
    console.warn("[postgame-media] Completion reconciliation deferred");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Async game execution
// ---------------------------------------------------------------------------

async function runGameAsync(
  db: DrizzleDB,
  gameId: string,
  runner: GameRunner,
  tokenTracker: TokenTracker,
  gameConfig: Record<string, unknown>,
  ownerEpoch?: string,
  heartbeat?: OwnerHeartbeat,
): Promise<void> {
  let clearMemoryOnExit = true;
  let persistedTranscriptEntries = 0;
  let completionCaptured = false;
  try {
    const result = await runner.run();
    if (!ownerEpoch) {
      throw new Error(`Durable completion owner is required for game ${gameId}`);
    }
    const finalEvent = runner.getCanonicalEvents().at(-1);
    if (!finalEvent) {
      throw new Error(`Durable completion event boundary is missing for game ${gameId}`);
    }
    await captureCompletedGame(db, {
      gameId,
      resultGameId: runner.getStateSnapshot().gameId,
      ownerEpoch,
      result,
      finalEventSequence: finalEvent.sequence,
      finalEventHash: hashCanonicalEvent(finalEvent),
      tokenTracker,
      gameConfig,
    });
    completionCaptured = true;
    await settleCapturedGameCompletion(db, gameId, { source: "runner" });
    runner.releaseTerminalStream();
    const refresh = await tryRefreshGameWatchStateSummary(db, gameId, "completion");
    await publishCurrentWatchState(db, gameId, "completion", refresh?.watchState);
    await reconcilePostgameMediaAfterCompletion(db, gameId);
    persistedTranscriptEntries = result.transcript.length;
  } catch (err) {
    // Game failed — owner-backed runs fail closed instead of pretending to cancel/complete.
    const errorMessage = err instanceof Error ? err.message : String(err);
    let failure = classifyGameRunFailure(err);
    console.error(`[game-lifecycle] Game ${gameId} failed:`, errorMessage);

    if (ownerEpoch) {
      try {
        const settlement = await getGameCompletionSettlementSummary(db, gameId);
        if (settlement.state === "completed") {
          runner.releaseTerminalStream();
          const refresh = await tryRefreshGameWatchStateSummary(db, gameId, "completion_confirmed");
          await publishCurrentWatchState(db, gameId, "completion confirmed", refresh?.watchState);
          await reconcilePostgameMediaAfterCompletion(db, gameId);
          return;
        }
        if (settlement.state === "pending" || settlement.state === "repair_required") return;
      } catch (transitionError) {
        console.error(
          `[game-lifecycle] Failed to inspect completion settlement state for game ${gameId}:`,
          transitionError,
        );
      }
      // Capture may have committed even when the caller observed an ambiguous
      // transport error. The finally block derives the transition from the
      // durable row; avoid overwriting it with the generic runner-failure path.
      if (completionCaptured) return;
    }

    if (!ownerEpoch) {
      // Legacy non-owner path keeps best-effort partial transcripts. Durable runs
      // only publish transcript rows after event-backed terminal completion.
      try {
        const partialTranscript = runner.transcriptLog.slice(persistedTranscriptEntries);
        if (partialTranscript.length > 0) {
          const CHUNK_SIZE = 100;
          for (let i = 0; i < partialTranscript.length; i += CHUNK_SIZE) {
            const chunk = partialTranscript.slice(i, i + CHUNK_SIZE);
            await db.insert(schema.transcripts)
              .values(
                chunk.map((entry) => serializeTranscriptEntry(gameId, entry)),
              );
          }
          console.error(`[game-lifecycle] Saved ${partialTranscript.length} partial transcript entries for game ${gameId}`);
        }
      } catch (transcriptErr) {
        console.error(`[game-lifecycle] Failed to save partial transcript for game ${gameId}:`, transcriptErr);
      }
    }

    if (ownerEpoch && runner.aborted) {
      const currentGame = (await db
        .select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];
      if (currentGame?.status === "suspended") {
        clearMemoryOnExit = false;
        return;
      }

      const cancelled = await db.update(schema.games)
        .set({
          status: "cancelled",
          endedAt: new Date().toISOString(),
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "in_progress")))
        .returning({ id: schema.games.id });
      if (cancelled.length > 0) {
        await tryRefreshGameWatchStateSummary(db, gameId, "runner_cancelled");
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "cancelled",
          terminal: true,
          reasonCode: "admin_stop",
          message: "Game cancelled.",
        });
      }
      return;
    }

    const startupCleanup = ownerEpoch
      ? await tryReturnZeroEventOwnerFailureToWaiting(
          db,
          gameId,
          ownerEpoch,
          failure.failureReason,
        )
      : null;
    if (startupCleanup?.outcome === "returned_to_waiting") {
      if (startupCleanup.cleanup.rosterDisposition === "repair_required") {
        console.warn("[game-lifecycle] Startup failure roster requires repair", {
          gameId,
          ...startupCleanup.cleanup.reconciliationError,
        });
      }
      const refresh = await tryRefreshGameWatchStateSummary(db, gameId, "runner_startup_failed");
      await publishCurrentWatchState(db, gameId, "runner startup failed", refresh?.watchState);
      return;
    }
    if (startupCleanup?.outcome === "not_returned") {
      failure = {
        failureReason: "startup_cleanup_conflict",
        failureDetails: {
          originalFailure: failure,
          cleanupFailure: startupCleanup.cleanupFailure,
        },
      };
    }

    // Notify live viewers that the game cannot resume.
    broadcastRaw(gameId, { type: "error", message: "The game failed and cannot be resumed." });

    try {
      // Read current config and append errorInfo
      const game = (await db
        .select({ config: schema.games.config })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];
      const currentConfig = game ? JSON.parse(game.config) : {};
      const updatedConfig = {
        ...currentConfig,
        errorInfo: errorMessage,
      };

      if (ownerEpoch) {
        clearMemoryOnExit = false;
        await db.update(schema.games)
          .set({ config: JSON.stringify(updatedConfig) })
          .where(eq(schema.games.id, gameId));
        await markGameSuspended(
          db,
          gameId,
          failure.failureReason,
          failure.failureDetails,
        );
        await tryRefreshGameWatchStateSummary(db, gameId, failure.failureReason);
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "suspended",
          terminal: true,
          reasonCode: failure.failureReason,
          message: "The game failed and cannot be resumed.",
        });
      } else {
        const fallbackConfig = { ...updatedConfig, viewerMode: "replay" };
        broadcastRaw(gameId, { type: "game_over", totalRounds: 0 });
        await db.update(schema.games)
          .set({
            status: "cancelled",
            endedAt: new Date().toISOString(),
            config: JSON.stringify(fallbackConfig),
          })
          .where(eq(schema.games.id, gameId));
        await tryRefreshGameWatchStateSummary(db, gameId, "legacy_runner_failed");
      }
    } catch (dbErr) {
      console.error(`[game-lifecycle] Failed to update game ${gameId} status after error:`, dbErr);
    }
  } finally {
    heartbeat?.stop();
    // Clear operational memories — they exist only for game duration
    if (clearMemoryOnExit) {
      try {
        await new PgMemoryStore(db).clear(gameId);
      } catch (err) {
        console.warn(`[game-lifecycle] memory cleanup failed for game=${gameId}:`, err instanceof Error ? err.message : err);
      }
    }
    activeGames.delete(gameId);
    if (ownerEpoch) {
      try {
        const prepared = await prepareCapturedCompletionAfterRunnerExit(db, gameId, "runner_exit");
        if (prepared.prepared
          && (prepared.state === "pending" || prepared.state === "repair_required")) {
          const failureReason = prepared.state === "repair_required"
            ? COMPLETION_SETTLEMENT_REPAIR_REQUIRED
            : COMPLETION_SETTLEMENT_TRANSIENT_FAILURE;
          const refresh = await tryRefreshGameWatchStateSummary(db, gameId, failureReason);
          await publishCurrentWatchState(db, gameId, failureReason, refresh?.watchState);
          broadcastRaw(gameId, {
            type: "game_status",
            gameId,
            status: "suspended",
            terminal: true,
            reasonCode: failureReason,
            message: prepared.state === "repair_required"
              ? "Results under review."
              : "Finalizing results.",
          });
        }
      } catch (error) {
        console.error(
          `[game-lifecycle] Failed to prepare sealed completion after runner exit for game ${gameId}:`,
          error,
        );
      }
    }
  }
}
