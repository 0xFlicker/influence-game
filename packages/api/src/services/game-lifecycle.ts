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
  LEGACY_FORMAT_MANIFEST,
  LLMHouseInterviewer,
  Phase,
  TokenTracker,
  createLlmClientFromEnv,
  createLlmProviderRuntimesFromEnv,
  normalizeOpenAIRequestServiceTier,
  resolveProviderManifestFromGameConfig,
  resolveFormatManifest,
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
  PlayerContinuityCapsule,
  ProviderProfileId,
  ResolvedProviderManifestEntry,
  PrivateDecisionTrace,
  PrivateTraceSink,
  PowerAction,
  TargetDecision,
  UUID,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { PgMemoryStore } from "../db/memory-store.js";
import {
  broadcastRaw,
  broadcastViewerDecisionEvent,
  broadcastWatchState,
  getObserverCount,
} from "./ws-manager.js";
import { appendGameEvents } from "./game-events.js";
import { getGameWatchState, type GameWatchState } from "./game-watch-state.js";
import { tryRefreshGameWatchStateSummary } from "./game-watch-state-summary.js";
import {
  assertOwnerActive,
  GameOwnerTransitionError,
  markOwnerStartupFailed,
  relinquishDurableGameRunOwner,
  renewGameRunOwner,
  type OwnerStartupFailureResult,
} from "./game-ownership.js";
import { writePrivateDecisionTrace } from "./private-trace-writer.js";
import { writeCognitiveArtifactsForTrace } from "./cognitive-artifact-writer.js";
import { recordPromptReuseForTrace } from "./prompt-reuse-accounting.js";
import { isUserSelectableAgentArchetype } from "./agent-archetypes.js";
import { reconcilePostgameMediaForGame } from "./postgame-media-coordinator.js";
import { CompetitionSettlementRepairRequiredError } from "./competition-completion.js";
import {
  checkGameStartAdmission,
} from "./deployment-admission.js";
import {
  GameCompletionSettlementError,
  getGameCompletionSettlementSummary,
} from "./game-completion-settlement.js";
import { tryReconcileAcceptedActionCorrelations } from "./accepted-action-correlation.js";
import { createApiProviderExecutionHooks } from "./provider-call-journal.js";
import { checkDailyProviderAdmission } from "./provider-health.js";
import { createDurableGameRunnerStore } from "./durable-game-runner-store.js";
import { settleDurableTerminalGame } from "./durable-game-terminal.js";
import { getDueGamePublicationHead } from "./game-publications.js";

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
        await relinquishDurableGameRunOwner(
          db,
          gameId,
          ownerEpoch,
          "owner_heartbeat_failed",
        ).catch(() => false);
        await tryRefreshGameWatchStateSummary(db, gameId, "owner_heartbeat_failed");
        broadcastRaw(gameId, {
          type: "error",
          message: "The game runner disconnected; committed play remains available for restart.",
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
      }
    } catch (error) {
      console.warn(`[game-lifecycle] Private trace sink failed for game ${gameId}:`, error);
    }

    try {
      await recordPromptReuseForTrace(db, { gameId, ownerEpoch, trace: enrichedTrace, eventSequence: trace.boundary?.finalEventSequence });
    } catch (error) {
      console.warn(`[game-lifecycle] Prompt reuse capture failed for game ${gameId}:`, error);
    }

  };
}

/** Map of gameId → active game. Prevents double-starts and enables status queries. */
const activeGames = new Map<string, ActiveGame>();
/** Games establishing their initial durable frontier before background execution. */
const startingGames = new Set<string>();

export function isGameRunning(gameId: string): boolean {
  return startingGames.has(gameId) || activeGames.has(gameId);
}

export function getActiveGameCount(): number {
  return activeGames.size + startingGames.size;
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
  const insertedEvents = await appendGameEvents(db, params);
  for (const event of insertedEvents) {
    broadcastViewerDecisionEvent(params.gameId, event);
  }
  await reconcileAcceptedActionsForLifecycle(db, {
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    ...(insertedEvents.length > 0 && { events: insertedEvents }),
  });
  if (params.events.some((event) => event.type === "jury.winner_determined")) {
    return;
  }
  const refresh = await tryRefreshGameWatchStateSummary(db, params.gameId, "durable_append");
  await publishCurrentWatchState(db, params.gameId, "durable append", refresh?.watchState);
}

export async function reconcileAcceptedActionsForLifecycle(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    events?: readonly CanonicalGameEvent[];
  },
): Promise<void> {
  const correlation = await tryReconcileAcceptedActionCorrelations(db, params);
  if (!correlation.ok) {
    console.warn(
      `[game-lifecycle] Accepted-action correlation degraded for game ${params.gameId}: ${correlation.error}`,
    );
  } else if (correlation.result.diagnostics.length > 0) {
    console.warn(
      `[game-lifecycle] Accepted-action correlation incomplete for game ${params.gameId}: `
      + `${correlation.result.missingCaptureDecisionCount} missing capture, `
      + `${correlation.result.conflictDecisionCount} conflict`,
    );
  }
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
      broadcastWatchState(
        gameId,
        watchState,
        await getDueGamePublicationHead(db, gameId),
      );
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
  getContinuityCapsule(): Omit<PlayerContinuityCapsule, "playerId" | "playerName"> {
    return {
      version: 2,
      compactStrategy: {
        lifecycle: "opening",
        baseline: null,
        deltas: [],
        priorEpoch: null,
        revision: 0,
      },
      notes: [],
      relationships: { allies: [], threats: [] },
      powerActionMemory: [],
      roundHistory: [],
    };
  }
  restoreContinuityCapsule(_capsule: PlayerContinuityCapsule): void {
    // Test mock has no private strategy state to hydrate.
  }
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
  async getEliminationMessage() { return mockResponse("goodbye"); }
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
  updateAlly(_playerName: string): void {}
  updateThreat(_playerName: string): void {}
  addNote(_playerName: string, _note: string): void {}
  removeFromMemory(_playerName: string): void {}
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
    formatManifest: resolveFormatManifest(
      gameConfig.formatManifest ?? LEGACY_FORMAT_MANIFEST,
    ),
    timers: {
      ...defaultTimers,
      ...currentTimers,
      mingle: roomPhaseTimer,
    },
    diaryRoomAfterPhases: [Phase.FORMAT_RESOLVE, Phase.COUNCIL],
    // Preserve House narration configuration sealed into the game record.
    ...(typeof gameConfig.enableHouseRoundSummaries === "boolean" && {
      enableHouseRoundSummaries: gameConfig.enableHouseRoundSummaries,
    }),
    ...(typeof gameConfig.enableHouseLongFormSummaries === "boolean" && {
      enableHouseLongFormSummaries: gameConfig.enableHouseLongFormSummaries,
    }),
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

const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 45_000;
const MIN_PROVIDER_REQUEST_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60_000;

export function providerRequestTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.INFLUENCE_LLM_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  }
  return Math.max(
    MIN_PROVIDER_REQUEST_TIMEOUT_MS,
    Math.min(MAX_PROVIDER_REQUEST_TIMEOUT_MS, Math.floor(configured)),
  );
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

export async function preflightProviderManifest(
  manifest: readonly ResolvedProviderManifestEntry[],
  createClient: (providerProfileId: ProviderProfileId) => ModelPreflightClient | null,
): Promise<void> {
  const providerEntries = new Map<
    ProviderProfileId,
    { client: ModelPreflightClient; modelIds: string[] }
  >();
  for (const entry of manifest) {
    const providerProfileId = entry.providerProfile.id;
    let provider = providerEntries.get(providerProfileId);
    if (!provider) {
      const client = createClient(providerProfileId);
      if (!client) {
        throw new Error("LLM provider not configured");
      }
      provider = { client, modelIds: [] };
      providerEntries.set(providerProfileId, provider);
    }
    provider.modelIds.push(entry.modelId);
  }

  await Promise.all([...providerEntries].map(async ([providerProfileId, provider]) => {
    if (providerProfileId === "katana") {
      const models = await provider.client.client.models.list();
      const availableModelIds = new Set(models.data?.map((model) => model.id) ?? []);
      const unavailableModelId = provider.modelIds.find(
        (modelId) => !availableModelIds.has(modelId),
      );
      if (unavailableModelId) {
        throw new Error(
          `Model ${unavailableModelId} is not available from ${provider.client.providerLabel}`,
        );
      }
      return;
    }

    await Promise.all(provider.modelIds.map(
      (modelId) => preflightSelectedModel(provider.client, modelId, providerProfileId),
    ));
  }));
}

export async function validateGameStartReadiness(
  db: DrizzleDB,
  gameId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  error?: string;
  code?:
    | "deployment_admission_closed"
    | "deployment_admission_unavailable"
    | "provider_admission_closed"
    | "provider_admission_unavailable";
  retryable?: boolean;
}> {
  const admission = await checkGameStartAdmission(db);
  if (!admission.ok) return admission;

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

  let resolvedProviderManifest;
  try {
    resolvedProviderManifest = resolveProviderManifestFromGameConfig(gameConfig);
  } catch (error) {
    return { error: publicProviderStartupError(error) };
  }

  if (game.trackType === "free") {
    const providerAdmission = await checkDailyProviderAdmission(db, resolvedProviderManifest);
    if (!providerAdmission.ok) return providerAdmission;
  }

  if (env.INFLUENCE_API_TEST_MOCK_RUNNER === "true") {
    return {};
  }

  if (!providerPreflightEnabled(env)) {
    return {};
  }

  try {
    await preflightProviderManifest(
      resolvedProviderManifest,
      (providerProfileId) => createLlmClientFromEnv(env, {
        maxRetries: 0,
        providerProfileId,
        timeout: providerPreflightTimeoutMs(env),
        openAIServiceTier: normalizeOpenAIRequestServiceTier(gameConfig.serviceTier) ?? "flex",
      }),
    );
  } catch (error) {
    const message = publicProviderStartupError(error);
    if (message === "LLM provider not configured") {
      return { error: message };
    }
    return {
      error: `LLM provider preflight failed: ${message}`,
    };
  }

  return {};
}

export async function startGame(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch?: string,
  options: Pick<GameRunnerOptions, "durableUpgradeFrom"> = {},
): Promise<{ error?: string }> {
  if (isGameRunning(gameId)) {
    return { error: "Game is already running" };
  }
  startingGames.add(gameId);
  try {
    return await startGameWithOwner(db, gameId, ownerEpoch, options);
  } finally {
    startingGames.delete(gameId);
  }
}

async function startGameWithOwner(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch?: string,
  options: Pick<GameRunnerOptions, "durableUpgradeFrom"> = {},
): Promise<{ error?: string }> {
  if (!ownerEpoch) {
    return { error: "Durable game owner is required" };
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
  const resolvedModelSelection = resolveProviderManifestFromGameConfig(gameConfig)[0]!;

  const providerRuntimes = useTestMockRunner
    ? null
    : createLlmProviderRuntimesFromEnv(
        resolveProviderManifestFromGameConfig(gameConfig),
        process.env,
        {
          openAIServiceTier: normalizeOpenAIRequestServiceTier(gameConfig.serviceTier) ?? "flex",
          timeout: providerRequestTimeoutMs(process.env),
        },
      );
  const primaryRuntime = providerRuntimes?.[0];
  if (!primaryRuntime) {
    if (!useTestMockRunner) {
      return { error: "LLM provider not configured" };
    }
  }

  // Create token tracker
  const tokenTracker = new TokenTracker();
  const privateTraceSink = ownerEpoch
    ? createPrivateTraceSink(db, gameId, ownerEpoch, game.cognitiveArtifactCaptureVersion)
    : undefined;
  const providerExecutionHooks = ownerEpoch
    ? createApiProviderExecutionHooks(db, { gameId, ownerEpoch })
    : undefined;
  const toolChoiceMode = primaryRuntime?.toolChoiceMode;

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

    if (!primaryRuntime || !providerRuntimes) {
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
      primaryRuntime.adapter,
      model,
      persona.backstory,
      memoryStore,
      {
        ...(playerToolChoiceMode && { toolChoiceMode: playerToolChoiceMode }),
        ...(primaryRuntime.openAIReasoningSummary && { openAIReasoningSummary: primaryRuntime.openAIReasoningSummary }),
        providerProfileId: resolvedModelSelection.providerProfile.id,
        catalogId: resolvedModelSelection.catalogId,
        modelCapabilities: resolvedModelSelection.model.capabilities,
        reasoningPolicy: resolvedModelSelection.reasoningPolicy,
        ...(player.agentProfileId && persona.personality && { personalityPrompt: persona.personality }),
        ...(player.agentProfileId && persona.strategyHints && { strategyInstructions: persona.strategyHints }),
        ...(agentCfg.temperature !== undefined && { temperature: agentCfg.temperature }),
        ...(privateTraceSink && { privateTraceSink }),
        ...(providerExecutionHooks && { providerExecutionHooks }),
        providerManifest: providerRuntimes,
      },
    );
    agent.setTokenTracker(tokenTracker);
    return agent;
  });

  const engineConfig = buildEngineConfigFromGameRecord(gameConfig, game.minPlayers, game.maxPlayers);

  const houseInterviewer = !useTestMockRunner && primaryRuntime && providerRuntimes
    ? new LLMHouseInterviewer(
        primaryRuntime.adapter,
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
          ...(providerExecutionHooks && { providerExecutionHooks }),
          providerManifest: providerRuntimes,
        },
      )
    : undefined;
  houseInterviewer?.setTokenTracker(tokenTracker);

  // Create runner
  const runner = new GameRunner(agents, engineConfig, houseInterviewer, {
    gameId,
    ...(options.durableUpgradeFrom && {
      durableUpgradeFrom: options.durableUpgradeFrom,
    }),
    ...(privateTraceSink && { privateTraceSink }),
    tokenTracker,
    durableTurnStore: createDurableGameRunnerStore(db, { gameId, ownerEpoch }, {
      onCommitted: async (result) => {
        await reconcileAcceptedActionsForLifecycle(db, {
          gameId,
          ownerEpoch,
          ...(result.canonicalEvents.length > 0 && {
            events: result.canonicalEvents.map((entry) => entry.event),
          }),
        });
        const refresh = await tryRefreshGameWatchStateSummary(
          db,
          gameId,
          "durable_turn_committed",
        );
        await publishCurrentWatchState(
          db,
          gameId,
          "durable turn commit",
          refresh?.watchState,
        );
      },
    }),
    beforeAcceptedCommit: () => assertOwnerActive(db, gameId, ownerEpoch),
  });

  // Close the owner-claim-to-runner-init crash window before returning to the
  // request or startup reconciler. This is idempotent for adopted games and
  // commits the explicit roster bootstrap for a new game.
  await runner.prepareDurableExecution();

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
  | { outcome: "retained_for_resume" }
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
    if (
      error instanceof GameOwnerTransitionError
      && error.code === "stale_owner"
      && await relinquishDurableGameRunOwner(
        db,
        gameId,
        ownerEpoch,
        "startup_failed_after_durable_initialization",
      )
    ) {
      return { outcome: "retained_for_resume" };
    }
    return {
      outcome: "not_returned",
      cleanupFailure: {
        code: error instanceof GameOwnerTransitionError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
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

async function relinquishInterruptedGame(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
): Promise<void> {
  await relinquishDurableGameRunOwner(
    db,
    gameId,
    ownerEpoch,
    "runner_interrupted",
  ).catch(() => false);
  await tryRefreshGameWatchStateSummary(db, gameId, "runner_interrupted");
}

async function runGameAsync(
  db: DrizzleDB,
  gameId: string,
  runner: GameRunner,
  tokenTracker: TokenTracker,
  gameConfig: Record<string, unknown>,
  ownerEpoch?: string,
  heartbeat?: OwnerHeartbeat,
): Promise<void> {
  let clearMemoryOnExit = false;
  try {
    await runner.run();
    if (!ownerEpoch) {
      throw new Error(`Durable completion owner is required for game ${gameId}`);
    }
    await reconcileAcceptedActionsForLifecycle(db, { gameId, ownerEpoch });
    await settleDurableTerminalGame(db, { gameId, ownerEpoch });
    clearMemoryOnExit = true;
    const refresh = await tryRefreshGameWatchStateSummary(db, gameId, "completion");
    await publishCurrentWatchState(db, gameId, "completion", refresh?.watchState);
    await reconcilePostgameMediaAfterCompletion(db, gameId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[game-lifecycle] Durable runner for ${gameId} stopped:`, errorMessage);

    if (ownerEpoch) {
      try {
        const settlement = await getGameCompletionSettlementSummary(db, gameId);
        if (settlement.state === "completed") {
          clearMemoryOnExit = true;
          const refresh = await tryRefreshGameWatchStateSummary(db, gameId, "completion_confirmed");
          await publishCurrentWatchState(db, gameId, "completion confirmed", refresh?.watchState);
          await reconcilePostgameMediaAfterCompletion(db, gameId);
          return;
        }
        if (settlement.state === "repair_required") {
          await db.update(schema.gameExecutionStates).set({
            status: "repair_required",
            updatedAt: new Date().toISOString(),
          }).where(and(
            eq(schema.gameExecutionStates.gameId, gameId),
            eq(schema.gameExecutionStates.ownerEpoch, ownerEpoch),
          ));
        }
      } catch (transitionError) {
        console.error(
          `[game-lifecycle] Failed to inspect completion settlement state for game ${gameId}:`,
          transitionError,
        );
      }
    }

    if (ownerEpoch && runner.aborted) {
      const currentGame = (await db
        .select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];
      // The admin stop route commits `cancelled` before aborting the local
      // runner. Every other abort is process/ownership lifecycle: preserve the
      // committed game and let a current or replacement runtime adopt it.
      if (currentGame?.status === "in_progress") {
        clearMemoryOnExit = false;
        await relinquishInterruptedGame(db, gameId, ownerEpoch);
      }
      return;
    }
    if (ownerEpoch) {
      await relinquishInterruptedGame(db, gameId, ownerEpoch);
      broadcastRaw(gameId, {
        type: "error",
        message: "The game runner disconnected; committed play remains available for restart.",
      });
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
  }
}
