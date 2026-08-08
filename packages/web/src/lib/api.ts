/**
 * Influence API client.
 * All API calls go through apiFetch so the base URL and auth headers are consistent.
 */

import { gamePathSegment } from "./game-links";
import type { CreateGamePlayerCount } from "./game-creation";
import type {
  CompletedGameResultsAvailabilityStatus as EngineCompletedGameResultsAvailabilityStatus,
  CompletedGameResultsElimination as EngineCompletedGameResultsElimination,
  CompletedGameResultsEndgameElimination as EngineCompletedGameResultsEndgameElimination,
  CompletedGameResultsFormatRecap as EngineCompletedGameResultsFormatRecap,
  CompletedGameResultsFormatScoring as EngineCompletedGameResultsFormatScoring,
  CompletedGameResultsJury as EngineCompletedGameResultsJury,
  CompletedGameResultsPlayer as EngineCompletedGameResultsPlayer,
  CompletedGameResultsRead as EngineCompletedGameResultsRead,
  CompletedGameResultsSource as EngineCompletedGameResultsSource,
  GameKernel as EngineGameKernel,
  GameKernelContradictionDiagnostic as EngineGameKernelContradictionDiagnostic,
  GameKernelSource as EngineGameKernelSource,
  LaunchFormatId as EngineLaunchFormatId,
  Phase as EnginePhase,
  RevealedCanonicalFactsStatus as EngineRevealedCanonicalFactsStatus,
  RevealedFactsStatus as EngineRevealedFactsStatus,
  RevealedPlayerRef as EngineRevealedPlayerRef,
  RevealedRoundFacts as EngineRevealedRoundFacts,
  RevealedRoundFactsAvailability as EngineRevealedRoundFactsAvailability,
  ViewerDecisionEvent as EngineViewerDecisionEvent,
} from "@influence/engine";

/** Viewer-safe canonical decisions shared by live websocket and replay v3 transport. */
export type ViewerDecisionEvent = EngineViewerDecisionEvent;
export type GameKernel = EngineGameKernel;
export type GameKernelSource = EngineGameKernelSource;
export type GameKernelContradictionDiagnostic = EngineGameKernelContradictionDiagnostic;

let API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

/** Called by RuntimeConfigProvider once runtime config is fetched. */
export function setApiBase(url: string): void {
  API_BASE = url;
}

export function resolveApiUrl(pathOrUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith("/")) {
    return `${API_BASE.replace(/\/$/, "")}${pathOrUrl}`;
  }
  return pathOrUrl;
}

// ---------------------------------------------------------------------------
// Auth token storage (client-side only)
// ---------------------------------------------------------------------------

export const AUTH_TOKEN_KEY = "influence_session";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function storeAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function setAuthToken(token: string): void {
  storeAuthToken(token);
  window.dispatchEvent(new CustomEvent("auth:session-ready"));
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryable?: boolean,
    public readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (typeof window === "undefined" && process.env.NEXT_RUNTIME) {
    throw new Error(
      "apiFetch is browser-only in Next.js; use serverApiFetch for server-side requests",
    );
  }

  const token = getAuthToken();
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    // Skip Content-Type for FormData — browser sets it with the correct boundary
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const url = resolveApiUrl(path);
  console.log(`API ${options?.method ?? "GET"} ${url}`);
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401 && typeof window !== "undefined" && token) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    throw apiErrorFromResponse(res.status, text);
  }
  return res.json() as Promise<T>;
}

/**
 * Provider assertions are deliberately exchanged without the Influence JWT.
 * A provider-auth 401 belongs to that explicit attempt and must never expire a
 * still-valid Influence browser session.
 */
export async function providerAuthFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const url = resolveApiUrl(path);
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw apiErrorFromResponse(res.status, text);
  }
  return res.json() as Promise<T>;
}

function apiErrorFromResponse(status: number, body: string): ApiError {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const error = parsed as Record<string, unknown>;
      if (typeof error.error === "string" && typeof error.code === "string") {
        return new ApiError(
          status,
          error.error,
          error.code,
          typeof error.retryable === "boolean" ? error.retryable : undefined,
          error,
        );
      }
    }
  } catch {
    // Preserve non-JSON error bodies verbatim.
  }
  return new ApiError(status, body);
}

// ---------------------------------------------------------------------------
// Game types
// ---------------------------------------------------------------------------

export type PersonaKey =
  | "honest"
  | "strategic"
  | "deceptive"
  | "paranoid"
  | "social"
  | "aggressive"
  | "loyalist"
  | "observer"
  | "diplomat"
  | "wildcard"
  | "contrarian"
  | "provocateur"
  | "martyr";

export interface PublicPlayerIdentityRef {
  publicId: string;
  handle: string | null;
  displayName: string;
}

export interface PublicCompetitionResult {
  gameSlug: string;
  agentName: string;
  placement: number;
  lobbySize: number;
  totalPoints: number;
  earnedAt: string;
}

export interface PublicAgentPreview {
  name: string;
  avatarUrl: string | null;
  role: null | {
    key: PersonaKey;
    label: string;
  };
  competition: {
    gamesPlayed: number;
    wins: number;
    winRate: number;
  };
}

export interface PublicReplayAgentPreview extends PublicAgentPreview {
  owner?: PublicPlayerIdentityRef | null;
}

export interface PublicPlayerProfile {
  identity: PublicPlayerIdentityRef;
  currentSeason: null | {
    season: {
      slug: string;
      name: string;
      status: "active" | "closing" | "final";
    };
    architectStanding: null | {
      rank: number;
      totalPointsHundredths: number;
      wins: number;
      contributions: Array<{
        agentName: string;
        sourcePoints: number;
        weightPercent: 100 | 50 | 25;
        weightedPointsHundredths: number;
      }>;
    };
    honors: {
      agentChampion: boolean;
      architectChampion: boolean;
    };
  };
  career: {
    rating: number;
    peakRating: number;
    gamesPlayed: number;
    wins: number;
    winRate: number;
  };
  recentResults: PublicCompetitionResult[];
  agents: PublicAgentPreview[];
}

export type PublicPlayerProfileEnvelope =
  | {
      schemaVersion: 1;
      status: "found";
      profile: PublicPlayerProfile;
    }
  | {
      schemaVersion: 1;
      status: "not_found";
    };

export type FillStrategy = "random" | "balanced";
export type TimingPreset = "fast" | "standard" | "slow" | "custom";
export type GameVisibility = "public" | "unlisted" | "private";
export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled" | "suspended";
export type ViewerMode = "live" | "speedrun" | "replay";
export type TrackType = "custom" | "free";
export type KernelHealthStatus = "healthy" | "degraded" | "suspended" | "unknown";
export type CognitiveArtifactType = "reasoning" | "thinking" | "strategy";
export type CognitiveArtifactActorRole = "player" | "juror" | "house" | "system" | "producer";
export type GameWatchStateSource = "durable_projection" | "degraded" | "best_available_terminal_result" | "pre_kernel_empty";
export type GameWatchProjectionAvailability = "available" | "degraded" | "unavailable";
export type GameWatchPlayerStatus = "alive" | "eliminated" | "unknown";
export type GameWatchPlayerPressureStatus =
  | "empowered"
  | "locked_at_risk"
  | "empowered_selected"
  | "selectable_exposed"
  | "replacement_risk"
  | "fallback_risk";
export type GameWatchDiagnosticCode =
  | "duplicate_sequence"
  | "hash_mismatch"
  | "invalid_envelope"
  | "metadata_mismatch"
  | "projection_replay_failed"
  | "sequence_gap"
  | "unsupported_payload_version"
  | "wrong_game";

export interface KernelHealthSummary {
  status: KernelHealthStatus;
  lastPersistedEventSequence: number;
  durableEventCount: number;
  checkpointCount: number;
  evidenceManifestCount: number;
  hasDurableEvents: boolean;
  hasCheckpoints: boolean;
  hasEvidenceManifests: boolean;
}

export interface GameWatchDiagnosticSummary {
  code: GameWatchDiagnosticCode;
  severity: "error";
  message: string;
  sequence?: number;
  eventType?: string;
}

export interface GameWatchEventCursor {
  sequence: number;
  source: "trusted_prefix" | "none";
  eventType?: string;
  createdAt?: string;
}

export interface GameWatchProjectionState {
  availability: GameWatchProjectionAvailability;
  eventLogStatus: "empty" | "complete" | "invalid";
  projectionStatus: "empty" | "complete" | "incomplete" | "failed";
  eventCount: number;
  trustedEventCount: number;
  validPrefixLength: number;
  lastTrustedSequence: number;
  firstInvalidSequence?: number;
  persistedHead?: {
    sequence: number;
    eventType: string;
    createdAt: string;
  };
  diagnostics: GameWatchDiagnosticSummary[];
}

export interface GameWatchPlayer {
  id: string;
  name: string;
  persona: string;
  personaKey?: string;
  status: GameWatchPlayerStatus;
  shielded: boolean;
  pressureStatus?: GameWatchPlayerPressureStatus;
  exposeScore?: number;
  avatarUrl?: string;
  currentAgent?: PublicReplayAgentPreview | null;
}

export interface GameWatchFinalState {
  status: "not_final" | "final";
  winner?: {
    id: string;
    name: string;
    method?: string;
    source: "durable_projection" | "degraded" | "best_available_terminal_result";
  };
  roundsPlayed?: number;
}

export interface GameWatchState {
  schemaVersion: 3 | 4 | 5;
  gameId: string;
  slug: string;
  status: GameStatus;
  /** Added in schema v5. Missing legacy watch states preserve classic routing. */
  gameKernel?: GameKernel;
  gameKernelSource?: GameKernelSource;
  gameKernelDiagnostics?: GameKernelContradictionDiagnostic[];
  source: GameWatchStateSource;
  currentRound: number;
  currentPhase: string;
  maxRounds: number;
  eventCursor: GameWatchEventCursor;
  projection: GameWatchProjectionState;
  players: GameWatchPlayer[];
  counts: {
    totalPlayers: number;
    alivePlayers: number;
    eliminatedPlayers: number;
    unknownPlayers: number;
  };
  final: GameWatchFinalState;
  winner?: {
    id: string;
    name: string;
    method?: string;
  };
}

export interface GameWatchReplayFrame {
  /** v1/v2 frames remain readable; v3 adds a viewer-safe canonical decision. */
  schemaVersion: 1 | 2 | 3;
  gameId: string;
  slug: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  round: number;
  phase: PhaseKey;
  players: GameWatchPlayer[];
  counts: GameWatchState["counts"];
  viewerDecisionEvent?: ViewerDecisionEvent;
}

export type GameWatchStateSummary = Omit<GameWatchState, "players">;

export interface CreateGameParams {
  playerCount: CreateGamePlayerCount;
  slotType: "all_ai" | "mixed";
  modelSelection: GameModelSelection;
  personaPool: PersonaKey[];
  fillStrategy: FillStrategy;
  timingPreset: TimingPreset;
  maxRounds: number | "auto";
  visibility: GameVisibility;
  viewerMode: "live" | "speedrun";
  formatManifest?: EngineLaunchFormatId[];
}

export type ModelReasoningPolicy = "action-policy" | "low" | "medium" | "high";

export interface GameModelSelection {
  catalogId: string;
  reasoningPolicy: ModelReasoningPolicy;
}

export interface GameSummary {
  id: string;
  slug: string;
  status: GameStatus;
  playerCount: number;
  currentRound: number;
  maxRounds: number;
  currentPhase: string;
  phaseTimeRemaining: number | null;
  alivePlayers: number;
  eliminatedPlayers: number;
  modelLabel: string;
  visibility: GameVisibility;
  viewerMode: ViewerMode;
  /** Frozen game configuration; absent only on historical/mock payloads. */
  formatManifest?: EngineLaunchFormatId[];
  trackType?: TrackType;
  seasonId?: string;
  season?: Pick<SeasonIdentity, "id" | "slug" | "name">;
  rated?: boolean;
  finalists?: [string, string];
  winner?: string;
  winnerPersona?: string;
  errorInfo?: string;
  kernelHealth?: KernelHealthSummary;
  watchState?: GameWatchStateSummary;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Game API calls
// ---------------------------------------------------------------------------

export async function createGame(
  params: CreateGameParams,
): Promise<{ id: string; slug: string }> {
  return apiFetch("/api/games", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function listGames(
  status?: GameStatus | GameStatus[],
): Promise<GameSummary[]> {
  const q = status
    ? `?status=${Array.isArray(status) ? status.join(",") : status}`
    : "";
  return apiFetch(`/api/games${q}`);
}

export interface AdminGameSummary extends GameSummary {
  hidden: boolean;
  hiddenAt?: string;
  cost?: AdminGameCostSummary | null;
  completionSettlement: GameCompletionSettlementSummary;
}

export interface GameCompletionSettlementSummary {
  schemaVersion: 1;
  state: "not_applicable" | "pending" | "repair_required" | "completed";
  retryEligible: boolean;
  attemptCount: number;
  resultHash: string | null;
  boundary: {
    ownerEpoch: string;
    finalEventSequence: number;
    finalEventHash: string;
  } | null;
  failureCode: string | null;
  capturedAt: string | null;
  retryReadyAt: string | null;
  lastAttemptedAt: string | null;
  completedAt: string | null;
}

export interface RetryGameSettlementResult {
  outcome: "completed" | "already_completed";
  settlement: GameCompletionSettlementSummary;
  watchRefreshed: boolean;
  mediaReconciliation: {
    outcome: "queued" | "waiting_inputs" | "suppressed" | "not_completed";
    gameId: string;
    previousRenderVersion: number | null;
    currentRenderVersion: number | null;
  } | null;
}

export type AdminGameCostState = "no_calls" | "unavailable" | "estimated" | "actual";

export interface AdminGameCostSummary {
  callCount: number;
  failedCallCount: number;
  unpricedCallCount: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  costCurrency: string;
  costSourceCounts: Record<string, number>;
  captureSourceCounts: Record<string, number>;
  providerNativeTotals: Record<string, number>;
  lastEntryAt?: string;
  state: AdminGameCostState;
}

export interface AdminGameCostDetail extends AdminGameCostSummary {
  gameId: string;
  ownerEpochBreakdowns: Array<{
    ownerEpoch: string;
    summary: AdminGameCostSummary;
  }>;
  breakdowns: Record<string, Record<string, {
    callCount: number;
    actualCostMicrousd: number;
    estimatedCostMicrousd: number;
    totalTokens: number;
  }>>;
  expensiveCalls: Array<{
    actorName?: string | null;
    actorRole?: string | null;
    action?: string | null;
    phase?: string | null;
    round?: number | null;
    provider?: string | null;
    modelName?: string | null;
    costSource: string;
    actualCostMicrousd?: number | null;
    estimatedCostMicrousd?: number | null;
    totalTokens: number;
    callStatus: string;
  }>;
  retryFailureSpend: {
    failedCallCount: number;
    retryCallCount: number;
    actualCostMicrousd: number;
    estimatedCostMicrousd: number;
  };
  backfill: {
    traceBackfilledEntries: number;
    terminalBackfilledEntries: number;
    hasTerminalAggregate: boolean;
  };
  pricing: {
    rateCardVersions: string[];
    pricingSourceIds: string[];
    pricedAt: string[];
  };
  reconciliation: Array<Record<string, unknown>>;
  promptReuse?: { version: number; coverage: "none" | "partial"; ownerEpochs: Array<{ ownerEpoch: string; requestCount: number; comparableCount: number; reusableCharacters: number; reusableTokenEstimate: number; firstBreakCounts: Record<string, number>; watermark: number; coverage: string }> };
}

export async function listAdminGames(): Promise<AdminGameSummary[]> {
  return apiFetch("/api/admin/games");
}

export async function retryGameSettlement(
  idOrSlug: string,
  reason: string,
): Promise<RetryGameSettlementResult> {
  return apiFetch(`/api/admin/games/${encodeURIComponent(idOrSlug)}/completion-settlement/retry`, {
    method: "POST",
    body: JSON.stringify({ reason, confirmation: "RETRY_SETTLEMENT" }),
  });
}

export async function getAdminGameCosts(idOrSlug: string): Promise<AdminGameCostDetail> {
  return apiFetch(`/api/admin/games/${idOrSlug}/costs`);
}

export async function backfillAdminGameCosts(idOrSlug: string): Promise<{
  gameId: string;
  inserted: number;
  skipped: number;
  rebuilt: boolean;
  diagnostics: string[];
}> {
  return apiFetch(`/api/admin/games/${idOrSlug}/costs/backfill`, { method: "POST" });
}

export async function stopGame(id: string): Promise<void> {
  await apiFetch(`/api/games/${id}/stop`, { method: "POST" });
}

export async function startGame(id: string): Promise<void> {
  await apiFetch(`/api/games/${id}/start`, { method: "POST" });
}

export interface FillGameResult {
  filled: number;
  totalPlayers: number;
  maxPlayers: number;
  players: Array<{ id: string; name: string; archetype: string }>;
}

export interface FillGameAccepted {
  filling: true;
  slotsToFill: number;
  filled: number;
  totalPlayers: number;
  maxPlayers: number;
  players: Array<{ id: string; name: string; archetype: string }>;
}

export type FillGameResponse = FillGameResult | FillGameAccepted;

export async function fillGame(id: string): Promise<FillGameResponse> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const url = `${API_BASE}/api/games/${id}/fill`;
  console.log(`API POST ${url}`);
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401 && typeof window !== "undefined" && token) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<FillGameResponse>;
}

export function isFillAccepted(r: FillGameResponse): r is FillGameAccepted {
  return "filling" in r && r.filling === true;
}

export interface CognitiveArtifactIndexEntry {
  id: string;
  uri: string;
  gameId: string;
  artifactType: CognitiveArtifactType;
  actorRole: CognitiveArtifactActorRole;
  actorPlayerId?: string;
  actorUserId?: string;
  actorAgentProfileId?: string;
  action: string;
  phase?: string;
  round?: number;
  eventSequence?: number;
  visibilityStatus: "active" | "capture_degraded";
  redactionStatus: "active" | "expired" | "redacted";
  payloadByteLength: number;
  createdAt: string;
}

export type CognitiveArtifactListResult =
  | {
    ok: true;
    game: {
      id: string;
      slug: string;
      status: GameStatus;
      cognitiveArtifactCaptureVersion: number;
    };
    artifacts: CognitiveArtifactIndexEntry[];
  }
  | {
    ok: false;
    status: "denied" | "not_found" | "not_captured_for_game";
    error: string;
  };

export type CognitiveArtifactReadResult =
  | {
    ok: true;
    game: {
      id: string;
      slug: string;
      status: GameStatus;
      cognitiveArtifactCaptureVersion: number;
    };
    artifact: CognitiveArtifactIndexEntry & { payload: Record<string, unknown> };
  }
  | {
    ok: false;
    status: "denied" | "not_found" | "not_captured" | "not_captured_for_game" | "capture_degraded" | "expired" | "redacted";
    error: string;
    game?: {
      id: string;
      slug: string;
      status: GameStatus;
      cognitiveArtifactCaptureVersion: number;
    };
    artifact?: CognitiveArtifactIndexEntry;
  };

export async function listCognitiveArtifacts(
  gameIdOrSlug: string,
  params: {
    artifactType?: CognitiveArtifactType;
    actorPlayerId?: string;
    limit?: number;
  } = {},
): Promise<CognitiveArtifactListResult> {
  const search = new URLSearchParams();
  if (params.artifactType) search.set("artifactType", params.artifactType);
  if (params.actorPlayerId) search.set("actorPlayerId", params.actorPlayerId);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const query = search.toString();
  return apiFetch(`/api/games/${gameIdOrSlug}/cognitive-artifacts${query ? `?${query}` : ""}`);
}

export async function readCognitiveArtifact(
  gameIdOrSlug: string,
  artifactId: string,
  params: {
    artifactType?: CognitiveArtifactType;
    actorRole?: CognitiveArtifactActorRole;
    actorPlayerId?: string;
  } = {},
): Promise<CognitiveArtifactReadResult> {
  const search = new URLSearchParams();
  if (params.artifactType) search.set("artifactType", params.artifactType);
  if (params.actorRole) search.set("actorRole", params.actorRole);
  if (params.actorPlayerId) search.set("actorPlayerId", params.actorPlayerId);
  const query = search.toString();
  return apiFetch(`/api/games/${gameIdOrSlug}/cognitive-artifacts/${artifactId}${query ? `?${query}` : ""}`);
}

export type PublicWatchIntelligenceSectionStatus = "available" | "select_player" | "unavailable";
export type PublicWatchIntelligenceCardKind = "thinking" | "strategy";
export type PublicWatchIntelligenceCardSource = "cognitive_artifact" | "transcript";
export type PublicWatchIntelligenceCardContext = "current_phase" | "current_round" | "recent";
export type RevealedFactsStatus = EngineRevealedFactsStatus;
export type RevealedCanonicalFactsStatus = EngineRevealedCanonicalFactsStatus;

export interface PublicWatchIntelligenceCard {
  id: string;
  kind: PublicWatchIntelligenceCardKind;
  source: PublicWatchIntelligenceCardSource;
  actorPlayerId: string;
  title: string;
  text: string;
  context: PublicWatchIntelligenceCardContext;
  round?: number;
  phase?: string;
  action?: string;
  eventSequence?: number;
  createdAt?: string;
}

export interface PublicWatchIntelligenceSection {
  status: PublicWatchIntelligenceSectionStatus;
  cards: PublicWatchIntelligenceCard[];
  reason?: string;
}

/** Canonical-event-derived round facts; the engine owns this dual-kernel shape. */
export type PublicWatchIntelligenceRoundFacts = EngineRevealedRoundFacts;

export interface PublicWatchIntelligenceReceipts {
  status: "available" | "unavailable";
  canonicalGameFacts: {
    roundFacts: PublicWatchIntelligenceRoundFacts;
    availability: EngineRevealedRoundFactsAvailability;
  };
  reason?: string;
}

export type PublicWatchIntelligenceResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: {
        id: string;
        slug: string;
        status: GameStatus;
      };
      context: {
        selectedPlayerId?: string;
        selectedPlayerName?: string;
        round: number;
        phase: string;
        source: string;
      };
      intelligence: {
        thinking: PublicWatchIntelligenceSection;
        strategy: PublicWatchIntelligenceSection;
        receipts: PublicWatchIntelligenceReceipts;
      };
    }
  | {
      ok: false;
      status: "not_found";
      error: string;
    };

export async function getPublicWatchIntelligence(
  gameIdOrSlug: string,
  params: {
    actorPlayerId?: string;
    round?: number;
    phase?: string;
    limit?: number;
  } = {},
): Promise<PublicWatchIntelligenceResult> {
  const search = new URLSearchParams();
  if (params.actorPlayerId) search.set("actorPlayerId", params.actorPlayerId);
  if (params.round !== undefined) search.set("round", String(params.round));
  if (params.phase) search.set("phase", params.phase);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const query = search.toString();
  return apiFetch(`/api/games/${gameIdOrSlug}/watch-intelligence${query ? `?${query}` : ""}`);
}

/** The results endpoint returns the engine's canonical-event-derived read model verbatim. */
export type CompletedGameResultsSource = EngineCompletedGameResultsSource;
export type CompletedGameResultsAvailabilityStatus = EngineCompletedGameResultsAvailabilityStatus;
export type CompletedGameResultsPlayerRef = EngineRevealedPlayerRef;
export type CompletedGameResultsPlayer = EngineCompletedGameResultsPlayer;
export type CompletedGameResultsElimination = EngineCompletedGameResultsElimination;
export type CompletedGameResultsEndgameElimination = EngineCompletedGameResultsEndgameElimination;
export type CompletedGameResultsFormatRecap = EngineCompletedGameResultsFormatRecap;
export type CompletedGameResultsFormatScoring = EngineCompletedGameResultsFormatScoring;
export type CompletedGameResultsJury = EngineCompletedGameResultsJury;
export type CompletedGameResultsRead = EngineCompletedGameResultsRead;

export interface CompletedGameResultsResponse {
  ok: true;
  /** v2 adds kernel routing; v1 remains accepted for cached legacy fixtures. */
  schemaVersion: 1 | 2;
  game: {
    id: string;
    slug: string;
    status: GameStatus;
    completedAt?: string;
    gameKernel?: GameKernel;
    gameKernelSource?: GameKernelSource;
    gameKernelDiagnostics?: GameKernelContradictionDiagnostic[];
  };
  results: CompletedGameResultsRead;
}

export async function getCompletedGameResults(gameIdOrSlug: string): Promise<CompletedGameResultsResponse> {
  return apiFetch(`/api/games/${gameIdOrSlug}/results`);
}

export type HouseHighlightsState =
  | "main_cut"
  | "mini_highlight_pack"
  | "no_cut"
  | "unsupported_ineligible";

export type HouseHighlightCategory =
  | "betrayal"
  | "suspense"
  | "irony"
  | "revenge"
  | "loyalty"
  | "chaos"
  | "collapse"
  | "triumph"
  | "humiliation"
  | "jury_judgment"
  | "unlikely_survival";

export type HouseHighlightReceiptTier =
  | "vote_record"
  | "alliance_receipt"
  | "derived_signal"
  | "public_quote"
  | "presentation_direction";

export type HouseHighlightConfidence = "low" | "medium" | "high";

export interface HouseHighlightPlayerRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
  persona?: string;
  personaKey?: string;
  currentAgent?: PublicAgentPreview | null;
}

export interface HouseHighlightEvidenceRef {
  eventType: string;
  round: number | null;
  sequence: number;
  players: HouseHighlightPlayerRef[];
}

export interface HouseHighlightReceipt {
  id: string;
  tier: HouseHighlightReceiptTier;
  label: string;
  description: string;
  factRefs: string[];
}

export interface AdminHouseHighlightReceipt extends HouseHighlightReceipt {
  eventRefs?: HouseHighlightEvidenceRef[];
}

export interface HouseHighlightDeepLink {
  surface: "results" | "replay";
  label: string;
  round: number | null;
  anchor: string;
}

export type HouseHighlightVisualType =
  | "alliance_formation"
  | "alliance_rupture"
  | "betrayal_vote"
  | "vote_flip"
  | "unlikely_survival"
  | "shield_survival"
  | "power_streak"
  | "council_slate"
  | "revenge_vote"
  | "jury_judgment"
  | "endgame_collapse";

export type HouseHighlightVisualSlotKey =
  | "primary_agent"
  | "exposed_agent"
  | "targeted_agent"
  | "eliminated_agent"
  | "surviving_agent"
  | "protected_agent"
  | "voters"
  | "alliance_members"
  | "finalists"
  | "jurors"
  | "round"
  | "vote_outcome"
  | "receipt_types";

export type HouseHighlightVisualSlotSource = "receipt" | "canonical_fact" | "scene_context";

export interface HouseHighlightVisualSlot {
  key: HouseHighlightVisualSlotKey;
  label: string;
  status: "filled" | "missing";
  source: HouseHighlightVisualSlotSource;
  agents?: HouseHighlightPlayerRef[];
  value?: string;
  receiptIds: string[];
}

export type HouseHighlightTruthOverlay =
  | "agent_identity"
  | "round_label"
  | "vote_marker"
  | "alliance_line"
  | "receipt_badge"
  | "outcome_caption"
  | "proof_link"
  | "shield_marker"
  | "jury_tally"
  | "power_tally";

export type HouseHighlightBackdropCategory =
  | "none"
  | "empty_council_chamber"
  | "jury_wall"
  | "abstract_vote_board"
  | "fractured_alliance_table"
  | "spotlight_stage"
  | "surveillance_board_texture";

export interface HouseHighlightVisualBackdrop {
  category: HouseHighlightBackdropCategory;
  generatedAllowed: boolean;
  description: string;
}

export type HouseHighlightShareFraming = "page_native" | "square" | "vertical" | "wide";

export interface HouseHighlightVisualBriefDiagnostics {
  forbiddenInventions: string[];
  warnings: string[];
  rejectedBackdropCategories: HouseHighlightBackdropCategory[];
}

export interface HouseHighlightVisualBrief {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightVisualBackdrop;
  shareFraming: HouseHighlightShareFraming[];
}

export type HouseHighlightVisualCardTemplate =
  | "hero_vote_action"
  | "generic_scene";

export type HouseHighlightVisualCardFactKind =
  | "vote_action"
  | "alliance_membership"
  | "elimination"
  | "protection"
  | "survival"
  | "jury_outcome"
  | "round_context"
  | "outcome";

export interface HouseHighlightVisualCardFact {
  id: string;
  kind: HouseHighlightVisualCardFactKind;
  text: string;
  agentIds: string[];
  receiptIds: string[];
}

export interface HouseHighlightVisualCard {
  template: HouseHighlightVisualCardTemplate;
  title: string;
  eyebrow: string;
  altText: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents: HouseHighlightPlayerRef[];
  roundLabel: string | null;
  outcome: string;
  factLines: HouseHighlightVisualCardFact[];
  backdrop: HouseHighlightVisualBackdrop;
  shareFraming: HouseHighlightShareFraming[];
}

export interface AdminHouseHighlightVisualBrief extends HouseHighlightVisualBrief {
  factualSlots: HouseHighlightVisualSlot[];
  truthOverlays: HouseHighlightTruthOverlay[];
  diagnostics: HouseHighlightVisualBriefDiagnostics;
}

export interface HouseHighlightSceneCard {
  id: string;
  title: string;
  category: HouseHighlightCategory;
  involvedAgents: HouseHighlightPlayerRef[];
  houseHook: string;
  setup: string;
  conflict: string;
  payoff: string;
  receipts: HouseHighlightReceipt[];
  deepLink: HouseHighlightDeepLink;
  visualBrief: HouseHighlightVisualBrief;
  visualCard: HouseHighlightVisualCard;
}

export interface HouseHighlightsCut {
  kind: "main" | "mini_pack";
  title: string;
  thesis: string | null;
  shareCaption: string;
  scenes: HouseHighlightSceneCard[];
}

export interface PublicHouseHighlightsProjection {
  schemaVersion: 3;
  state: HouseHighlightsState;
  eligibility: {
    status: "eligible" | "unsupported";
    reason: string | null;
    allianceReceiptCount: number;
  };
  thesis: string | null;
  cut: HouseHighlightsCut | null;
  scenes: HouseHighlightSceneCard[];
  noCutReason: string | null;
  fallbackLinks: HouseHighlightDeepLink[];
}

export interface HouseHighlightsResponse {
  ok: true;
  schemaVersion: 3;
  game: {
    id: string;
    slug: string;
    status: GameStatus;
    trackType: string;
    startedAt?: string;
    endedAt?: string;
    playerCount: number;
    roundCount: number;
  };
  highlights: PublicHouseHighlightsProjection;
}

export async function getPostgameHighlights(gameIdOrSlug: string): Promise<HouseHighlightsResponse> {
  return apiFetch(`/api/games/${gamePathSegment(gameIdOrSlug)}/postgame/highlights`);
}

export type PublicPostgameMediaStatus =
  | "not_requested"
  | "waiting_inputs"
  | "waiting_music"
  | "queued"
  | "rendering"
  | "ready"
  | "failed";

export type PublicPostgameMediaResponse =
  | {
      schemaVersion: 1;
      mediaType: "house_highlights_trailer";
      status: Exclude<PublicPostgameMediaStatus, "ready">;
    }
  | {
      schemaVersion: 1;
      mediaType: "house_highlights_trailer";
      status: "ready";
      renderVersion: number;
      durationSeconds: number;
      preview: {
        title: string;
        description: string;
      };
      video: {
        url: string;
        contentType: string;
        width: number;
        height: number;
      };
      poster: {
        url: string;
        contentType: string;
        altText: string;
      };
      captions: {
        url: string;
        contentType: string;
        language: string;
        label: string;
      };
      manifest: {
        url: string;
        contentType: string;
      };
    };

export async function getPostgameMedia(
  gameIdOrSlug: string,
): Promise<PublicPostgameMediaResponse> {
  return apiFetch(`/api/games/${gamePathSegment(gameIdOrSlug)}/postgame/media`);
}

export interface AdminHouseHighlightSceneCard extends Omit<HouseHighlightSceneCard, "receipts" | "visualBrief" | "visualCard"> {
  confidence: HouseHighlightConfidence;
  receipts: AdminHouseHighlightReceipt[];
  visualBrief: AdminHouseHighlightVisualBrief;
}

export interface AdminHouseHighlightsCut extends Omit<HouseHighlightsCut, "scenes"> {
  scenes: AdminHouseHighlightSceneCard[];
}

export interface HouseHighlightsCandidateDiagnostic {
  id: string;
  title: string;
  category: HouseHighlightCategory;
  source: string;
  confidence: HouseHighlightConfidence;
  selected: boolean;
  score: number;
  receiptCount: number;
  reasons: string[];
  visualBrief: Pick<AdminHouseHighlightVisualBrief, "visualType" | "templateLabel" | "factualSlots" | "backdrop" | "diagnostics">;
}

export interface AdminHouseHighlightsProjection extends Omit<PublicHouseHighlightsProjection, "schemaVersion" | "cut" | "scenes"> {
  schemaVersion: 2;
  cut: AdminHouseHighlightsCut | null;
  scenes: AdminHouseHighlightSceneCard[];
  diagnostics: {
    selectedSceneIds: string[];
    selectedCandidates: HouseHighlightsCandidateDiagnostic[];
    rejectedCandidates: HouseHighlightsCandidateDiagnostic[];
    notes: Array<{ code: string; severity: "info" | "warning"; message: string }>;
  };
}

export interface AdminHouseHighlightsDiagnosticsResponse {
  ok: true;
  schemaVersion: 2;
  game: HouseHighlightsResponse["game"];
  highlights: AdminHouseHighlightsProjection;
}

export async function getAdminPostgameHighlightsDiagnostics(
  gameIdOrSlug: string,
): Promise<AdminHouseHighlightsDiagnosticsResponse> {
  return apiFetch(`/api/admin/games/${gamePathSegment(gameIdOrSlug)}/postgame/highlights/diagnostics`);
}

export type AdminPostgameMediaStatus =
  | "waiting_inputs"
  | "waiting_music"
  | "queued"
  | "claimed"
  | "rendering"
  | "composing"
  | "uploading"
  | "ready"
  | "failed";

export interface AdminPostgameMediaArtifact {
  publicUrl: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface AdminPostgameMediaArtifactMetadata {
  preview: { title: string; description: string };
  video: AdminPostgameMediaArtifact & { width: number; height: number };
  poster: AdminPostgameMediaArtifact & { altText: string };
  captions: AdminPostgameMediaArtifact & { language: string; label: string };
  manifest: AdminPostgameMediaArtifact;
  storage: { provider: string; bucket: string };
}

export type AdminPostgameMediaResponse =
  | {
      schemaVersion: 1;
      mediaType: "house_highlights_trailer";
      status: "not_requested";
    }
  | {
      schemaVersion: 1;
      mediaType: "house_highlights_trailer";
      status: AdminPostgameMediaStatus;
      renderVersion: number;
      artifactVersion?: string;
      attemptNumber: number;
      lease?: { active: boolean; expiresAt: string | null };
      failure?: { category: string | null; message: string | null };
      artifactMetadata?: AdminPostgameMediaArtifactMetadata;
      cueMetadata?: Record<string, unknown>;
      diagnostics?: Record<string, unknown>;
      provenance?: {
        renderInputSnapshotHash: string;
        renderInputSnapshotVersion: number;
        rendererVersion: string;
        timingContractVersion: string;
        musicAssetId: string;
      };
      currentReady?: {
        renderVersion: number;
        durationSeconds: number;
        publishedAt: string;
        artifactMetadata: AdminPostgameMediaArtifactMetadata;
      };
      timestamps: {
        createdAt: string;
        updatedAt: string;
        claimedAt: string | null;
        attemptStartedAt: string | null;
        attemptFinishedAt: string | null;
      };
    };

export type AdminPostgameMediaAction = "backfill" | "rerender";

export async function getAdminPostgameMedia(
  gameIdOrSlug: string,
): Promise<AdminPostgameMediaResponse> {
  return apiFetch(`/api/admin/games/${gamePathSegment(gameIdOrSlug)}/postgame/media`);
}

export async function requestAdminPostgameMedia(
  gameIdOrSlug: string,
  action: AdminPostgameMediaAction,
  reason: string,
): Promise<{ outcome: string }> {
  return apiFetch(`/api/admin/games/${gamePathSegment(gameIdOrSlug)}/postgame/media/${action}`, {
    method: "POST",
    body: JSON.stringify({ reason, confirmation: action.toUpperCase() }),
  });
}

export interface PublicAlliancePlayerRead {
  id: string;
  name: string;
  agentProfileId?: string;
}

export interface PublicAllianceTermsRead {
  name: string;
  memberIds: string[];
  memberNames: string[];
  purpose: string;
  timebox: string | null;
}

export interface PublicAllianceProposalRead {
  lineageId: string;
  allianceId: string;
  name: string;
  status: string;
  proposedRound: number;
  proposedPhase?: PhaseKey | null;
  resolvedRound?: number;
  resolvedPhase?: PhaseKey | null;
  memberNames: string[];
  currentVersionId: string;
  currentTerms: PublicAllianceTermsRead;
  proposer: { id: string; name: string };
  responses: Array<{ player: { id: string; name: string }; response: string }>;
  finalResult: string;
}

export interface PublicAllianceOutcomeRead {
  id: string;
  round: number;
  window: string;
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: string;
  posture: string;
  leakOrBetrayalClaims: string[];
}

export interface PublicAllianceConsequenceRead {
  type: "alliance_member_cut";
  round: number;
  description: string;
  confidence: string;
  playerNames: string[];
}

export interface PublicAllianceRecordRead extends PublicAllianceTermsRead {
  id: string;
  status: string;
  createdRound: number;
  createdPhase?: PhaseKey | null;
  updatedRound: number;
  updatedPhase?: PhaseKey | null;
  huddleOutcomeCount: number;
  latestOutcome?: PublicAllianceOutcomeRead;
  consequences: PublicAllianceConsequenceRead[];
}

export interface PublicAllianceHuddleRead {
  allianceId: string;
  allianceName: string;
  round: number;
  phase?: PhaseKey | null;
  window: string;
  pass: number;
  speakers: Array<{ id: string; name: string }>;
  messages: Array<{ from: { id?: string; name: string }; text: string; timestamp: number }>;
  outcome?: PublicAllianceOutcomeRead;
}

export interface PublicAllianceFactsRead {
  summary: {
    proposalCount: number;
    activeAllianceCount: number;
    closedAllianceCount: number;
    archivedAllianceCount: number;
    huddleCount: number;
    latestHuddleRound: number | null;
  };
  proposals: PublicAllianceProposalRead[];
  alliances: PublicAllianceRecordRead[];
  huddles: PublicAllianceHuddleRead[];
}

export interface PublicGameAlliancesResponse {
  ok: true;
  schemaVersion: 1;
  game: {
    id: string;
    slug: string;
    status: GameStatus;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
  };
  players: PublicAlliancePlayerRead[];
  allianceFacts: PublicAllianceFactsRead;
  availability: {
    status: "available";
    eventLogStatus: string;
    transcriptStatus: "available" | "not_available";
    diagnostics: Array<{ code: string; severity: "info" | "warning"; message: string }>;
  };
}

export async function getGameAlliances(gameIdOrSlug: string): Promise<PublicGameAlliancesResponse> {
  return apiFetch(`/api/games/${gameIdOrSlug}/alliances`);
}

// ---------------------------------------------------------------------------
// Auth API calls
// ---------------------------------------------------------------------------

export type PublicIdentityOnboardingState = "complete" | "required" | "deferrable";

export interface AuthenticatedPublicIdentity {
  publicId: string;
  handle: string | null;
  displayName: string;
  publicIdentityOnboarding: {
    state: PublicIdentityOnboardingState;
    diagnosticCode:
      | "created_at_missing"
      | "created_at_invalid"
      | "created_at_timezone_required"
      | null;
  };
}

export interface AuthMe extends AuthenticatedPublicIdentity {
  id: string;
  walletAddress: string | null;
  email: string | null;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
  loginMethods: {
    privy: boolean;
    emailPassword: boolean;
    farcaster?: boolean;
  };
}

export async function getMe(): Promise<AuthMe> {
  return apiFetch("/api/auth/me");
}

export async function loginWithPrivyToken(
  privyToken: string,
  inviteCode?: string,
): Promise<{
  token: string;
  user: Omit<AuthMe, "isAdmin">;
}> {
  return providerAuthFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token: privyToken, ...(inviteCode ? { inviteCode } : {}) }),
  });
}

export async function loginWithFarcasterToken(
  farcasterToken: string,
  inviteCode?: string,
): Promise<{
  token: string;
  user: Omit<AuthMe, "isAdmin">;
}> {
  return providerAuthFetch("/api/auth/farcaster/login", {
    method: "POST",
    body: JSON.stringify({
      token: farcasterToken,
      ...(inviteCode ? { inviteCode } : {}),
    }),
  });
}

export type InfluenceSessionResult = {
  token: string;
  user: Omit<AuthMe, "isAdmin">;
};

export async function exchangeManagedAuthentication(
  token: string,
  correlationId?: string,
): Promise<InfluenceSessionResult> {
  return providerAuthFetch("/api/auth/managed/exchange", {
    method: "POST",
    headers: correlationId ? { "x-correlation-id": correlationId } : undefined,
    body: JSON.stringify({ token }),
  });
}

export async function createManagedAuthentication(
  token: string,
  correlationId?: string,
): Promise<InfluenceSessionResult> {
  return providerAuthFetch("/api/auth/managed/create", {
    method: "POST",
    headers: correlationId ? { "x-correlation-id": correlationId } : undefined,
    body: JSON.stringify({ token, confirm: true }),
  });
}

export async function linkManagedAuthentication(
  token: string,
  privyToken?: string,
  correlationId?: string,
): Promise<InfluenceSessionResult> {
  const influenceToken = getAuthToken();
  return providerAuthFetch("/api/auth/managed/link", {
    method: "POST",
    headers: {
      ...(influenceToken ? { Authorization: `Bearer ${influenceToken}` } : {}),
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    },
    body: JSON.stringify({
      token,
      confirm: true,
      ...(privyToken ? { privyToken } : {}),
    }),
  });
}

export async function linkPrivyAuthentication(
  privyToken: string,
  influenceToken: string,
  correlationId?: string,
): Promise<InfluenceSessionResult> {
  return providerAuthFetch("/api/auth/privy/link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${influenceToken}`,
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    },
    body: JSON.stringify({
      token: privyToken,
      confirm: true,
    }),
  });
}

export async function checkInviteRequired(): Promise<{ required: boolean }> {
  return apiFetch("/api/auth/invite-required");
}

// ---------------------------------------------------------------------------
// MCP OAuth API calls
// ---------------------------------------------------------------------------

export interface McpOAuthAuthorizeRequest {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  resource?: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

export type McpOAuthDecision = "inspect" | "approve" | "deny" | "cancel";
export type McpOAuthScope = "agents:read" | "agents:write" | "games:read" | "producer";

export interface McpOAuthScopePreview {
  scope: McpOAuthScope;
  label: string;
  description: string;
  group: "agents" | "games" | "developer";
  requiredScopes: McpOAuthScope[];
}

export interface McpOAuthBlockedScopePreview extends McpOAuthScopePreview {
  reason: string;
}

export interface McpOAuthAuthorizePreview {
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  requestedScopes: McpOAuthScopePreview[];
  grantableScopes: McpOAuthScopePreview[];
  blockedScopes: McpOAuthBlockedScopePreview[];
  defaultSelectedScopes: McpOAuthScope[];
  selectedScopes: McpOAuthScope[];
  authProfile?: "subject" | "producer";
  hasProducerRole: boolean;
  expiresIn: number;
  walletAddress: string | null;
}

export interface McpOAuthAuthorizeRedirect {
  redirectTo: string;
  expiresIn?: number;
}

export type McpOAuthAuthorizeResponse =
  | McpOAuthAuthorizePreview
  | McpOAuthAuthorizeRedirect;

export async function authorizeMcpOAuth(
  request: McpOAuthAuthorizeRequest,
  decision: McpOAuthDecision,
  selectedScopes?: string[],
): Promise<McpOAuthAuthorizeResponse> {
  return apiFetch("/api/oauth/mcp/authorize", {
    method: "POST",
    body: JSON.stringify({
      ...request,
      decision,
      ...(selectedScopes ? { selected_scope: selectedScopes.join(" ") } : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// Invite code types
// ---------------------------------------------------------------------------

export interface InviteCodesResponse {
  available: { code: string; createdAt: string }[];
  used: { code: string; usedAt: string | null }[];
  totalAvailable: number;
  totalUsed: number;
}

export async function getMyInviteCodes(): Promise<InviteCodesResponse> {
  return apiFetch("/api/profile/invite-codes");
}

// ---------------------------------------------------------------------------
// Admin invite code types & calls
// ---------------------------------------------------------------------------

export interface AdminInviteCode {
  id: string;
  code: string;
  ownerId: string;
  usedById: string | null;
  usedAt: string | null;
  createdAt: string;
  ownerDisplayName: string | null;
}

export async function getAdminInviteSetting(): Promise<{ inviteRequired: boolean }> {
  return apiFetch("/api/admin/settings/invite");
}

export async function setAdminInviteSetting(inviteRequired: boolean): Promise<{ inviteRequired: boolean }> {
  return apiFetch("/api/admin/settings/invite", {
    method: "PATCH",
    body: JSON.stringify({ inviteRequired }),
  });
}

export async function getAdminInviteCodes(params?: { userId?: string; status?: "available" | "used" }): Promise<AdminInviteCode[]> {
  const qs = new URLSearchParams();
  if (params?.userId) qs.set("userId", params.userId);
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();
  return apiFetch(`/api/admin/invite-codes${query ? `?${query}` : ""}`);
}

export async function adminGenerateInviteCodes(userId: string, count?: number): Promise<{ generated: number; codes: string[] }> {
  return apiFetch("/api/admin/invite-codes", {
    method: "POST",
    body: JSON.stringify({ userId, count }),
  });
}

export async function adminRefillInviteCodes(minCodes: number, minAgeDays?: number): Promise<{ usersProcessed: number; totalGenerated: number }> {
  return apiFetch("/api/admin/invite-codes/refill", {
    method: "POST",
    body: JSON.stringify({ minCodes, minAgeDays }),
  });
}

// ---------------------------------------------------------------------------
// Player types
// ---------------------------------------------------------------------------

export type JoinGameConfig =
  | { agentProfileId: string }
  | {
      agentName: string;
      personality: string;
      strategyHints?: string;
      personaKey: PersonaKey;
    };

export interface PlayerGameResult {
  gameId: string;
  gameSlug: string;
  agentName: string;
  persona: PersonaKey;
  placement: number;
  totalPlayers: number;
  eliminated: boolean;
  winner: boolean;
  rounds: number;
  completedAt: string;
  modelLabel: string;
}

// ---------------------------------------------------------------------------
// Player API calls
// ---------------------------------------------------------------------------

export async function joinGame(
  gameId: string,
  config: JoinGameConfig,
): Promise<void> {
  await apiFetch(`/api/games/${gameId}/join`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function getPlayerGames(): Promise<PlayerGameResult[]> {
  return apiFetch("/api/player/games");
}

// ---------------------------------------------------------------------------
// Saved agent profile types
// ---------------------------------------------------------------------------

export interface SavedAgent {
  id: string;
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
  personaKey: PersonaKey | null;
  gender?: AgentGender | null;
  avatarUrl: string | null;
  gamesPlayed: number;
  gamesWon: number;
  createdAt: string;
  updatedAt: string;
  avatarCompletion?: AvatarCompletion;
  receipt?: AgentMutationReceipt;
}

export interface AgentMutationReceipt {
  schemaVersion: 1;
  operation: "created" | "updated";
  agent: {
    agentProfileId: string;
    identityDisposition: "created" | "preserved";
  };
  profileRevision: {
    revisionId: string;
    ordinal: number;
    outcome: "created" | "preserved";
    active: true;
  };
  dailyFree: "not_enrolled" | "preserved_follows_profile";
  waitingSeats: {
    total: number;
    reconciled: number;
    alreadyCurrent: number;
    crossedFreeze: number;
    games: Array<{
      gameId: string;
      slug: string;
      disposition: "reconciled" | "already_current" | "crossed_freeze";
      effectiveRevisionId: string | null;
    }>;
    truncatedCount: number;
  };
  frozenSeats: { unchanged: number };
  avatarCompletion?: AvatarCompletion;
  warnings: Array<"avatar_generation_failed">;
}

export interface CreateAgentParams {
  name: string;
  personality: string;
  backstory?: string;
  strategyStyle?: string;
  personaKey?: PersonaKey;
  gender: AgentGender;
  avatarUrl?: string;
  avatarGenerationRequestId?: string;
}

export const AGENT_GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
] as const;

export type AgentGender = typeof AGENT_GENDER_OPTIONS[number]["value"];

export type UpdateAgentParams = Partial<Omit<CreateAgentParams, "avatarGenerationRequestId">> & {
  sourceReviewId?: string;
};

export type OwnerLearningAnalysisTrack =
  | "awaiting_evidence"
  | "evidence_rich"
  | "strategy_health_check";

export type OwnerLearningAnalysisStatus = "queued" | "running" | "ready" | "no_change" | "failed";
export type OwnerLearningStage =
  | "evidence_ready"
  | "scanning_narratives"
  | "investigating_moments"
  | "drafting_recommendations"
  | "complete";
export type OwnerLearningResolution =
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded";
export type OwnerLearningApplyDisposition =
  | "not_ready"
  | "awaiting_owner"
  | "available"
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded"
  | "unavailable";

interface OwnerLearningCreditDetails {
  latestEligibleCompletion: { gameId: string; completionAt: string } | null;
  refillCompletion: { gameId: string; completionAt: string } | null;
  qualifyingCompletionCount: number;
}

export type OwnerLearningCredit = OwnerLearningCreditDetails & (
  | { mode: "metered"; balance: 1; nextAvailableAt: null }
  | { mode: "metered"; balance: 0; nextAvailableAt: string | null }
  | { mode: "unlimited"; balance: null; nextAvailableAt: null }
);

export interface OwnerLearningEligibleInputs {
  eligibilityPolicyVersion: string;
  credit: OwnerLearningCredit;
  profiles: Array<{
    agentProfileId: string;
    name: string;
    currentRevisionId: string;
    strategyStyle: string | null;
    qualifyingGameCount: number;
    games: Array<{
      gameId: string;
      slug: string;
      playerId: string;
      completionAt: string;
      analyticalRevisionId: string;
      transcriptCaptureVersion: number;
      cognitiveArtifactCaptureVersion: number;
      previouslyAnalyzed: boolean;
    }>;
    recommendedGameIds: string[];
  }>;
  recommendedAgentProfileId: string | null;
  prompt: {
    threshold: 1 | 3 | null;
    prominent: boolean;
    suppressedByDismissal: boolean;
  };
  openReview: null | {
    id: string;
    agentProfileId: string;
    analysisStatus: OwnerLearningAnalysisStatus;
    stage: OwnerLearningStage;
    analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  };
  mcp: {
    connectionState: "connected" | "not_connected";
    requiredScopesVersion: string;
  };
}

export interface OwnerLearningRecommendation {
  id?: string;
  title: string;
  disposition: "change" | "keep" | "gather_more_evidence";
  confidence: "low" | "medium" | "high";
  rationale: string;
  keepGuidance?: string;
  evidenceRefs: OwnerLearningEvidenceRef[];
  proof?: {
    kind: "observed_pattern" | "prompt_guidance_defect" | "combined";
    rubricCategory?: string;
    observedEvidence: string;
    strategicInterpretation: string;
    proposedGuidance: string;
    exactGuidanceTarget: string;
  };
}

export interface OwnerLearningEvidenceRef {
  kind: "canonical_event" | "decision" | "dialogue" | "cognition" | "game_summary";
  gameId: string;
  coordinate: string;
  sourceHash: string;
  sourceVersion: string;
}

export interface OwnerLearningReview {
  id: string;
  agentProfileId: string;
  reviewedRevisionId: string;
  selectedGameIds: string[];
  analysisTrack: OwnerLearningAnalysisTrack;
  analysisStatus: OwnerLearningAnalysisStatus;
  stage: OwnerLearningStage;
  capacitySubstatus: "waiting_for_capacity" | "using_standard_capacity" | null;
  resolution: OwnerLearningResolution | null;
  result: null | {
    diagnosis: string;
    analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
    strategyHealthClassification?: "guidance_gap" | "execution_gap" | "no_clear_strategy_defect";
    recommendations: OwnerLearningRecommendation[];
    proposal?: { field: "strategyStyle"; before: string; after: string };
    noChange?: { rationale: string };
  };
  proposalFingerprint: string | null;
  safeFailureCode: string | null;
  retryable: boolean;
  logicalCallCount: number;
  diveCount: number;
  applyDisposition: OwnerLearningApplyDisposition;
  evidence: {
    games: Array<{
      gameId: string;
      position: number;
      canonicalFacts: unknown;
      candidateMoments: Array<Record<string, unknown>>;
      sourceCaptureVersion: string;
      sourceHash: string;
    }>;
  };
  application: null | {
    sourceRecommendationIds: string[];
    priorRevisionId: string;
    resultingRevisionId: string;
    priorStrategyStyle: string;
    resultingStrategyStyle: string;
    mutationReceipt: Record<string, unknown>;
    appliedAt: string;
  };
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type OwnerLearningReviewStatus = Pick<
  OwnerLearningReview,
  | "analysisStatus"
  | "stage"
  | "capacitySubstatus"
  | "resolution"
  | "proposalFingerprint"
  | "safeFailureCode"
  | "retryable"
  | "logicalCallCount"
  | "diveCount"
  | "applyDisposition"
  | "updatedAt"
  | "resolvedAt"
>;

export interface OwnerLearningPreflight {
  status: "awaiting_evidence" | "ready" | "generation_unavailable";
  selection: {
    agentProfileId: string;
    agentProfileName: string;
    reviewedRevisionId: string;
    gameIds: string[];
  };
  evidence: {
    analysisTrack: OwnerLearningAnalysisTrack;
    games: Array<{
      gameId: string;
      canonicalFacts: unknown;
      candidateMoments: Array<{
        id: string;
        gameId: string;
        anchorKind: "canonical_event" | "decision" | "dialogue" | "cognition";
        sourceCoordinate: string;
        sourceHash: string;
        round: number | null;
        phase: string | null;
      }>;
      narrativeCoverage: "rich" | "thin";
      sourceHash: string;
      sourceCaptureVersion: string;
    }>;
  };
}

export interface OwnerLearningStartResult {
  status:
    | "started"
    | "existing_review"
    | "existing_open_review"
    | "awaiting_evidence"
    | "generation_unavailable"
    | "no_credit"
    | "rolling_limited";
  reviewId: string | null;
  nextEligibleAt: string | null;
  preflight: OwnerLearningPreflight | null;
}

export interface OwnerLearningApplyResult {
  reviewId: string;
  proposalFingerprint: string;
  sourceRecommendationIds: string[];
  priorRevisionId: string;
  resultingRevisionId: string;
  priorStrategyStyle: string;
  resultingStrategyStyle: string;
  receipt: AgentMutationReceipt;
  appliedAt: string;
  replayed: boolean;
}

export interface AvatarCompletion {
  status: "already_provided" | "accepted" | "queued" | "processing" | "completed" | "skipped" | "failed";
  generationRequestId?: string;
  avatarUrl?: string | null;
  failureCode?: string;
  failureStage?: "provider_submit" | "provider_poll" | "asset_select" | "asset_download" | "avatar_store" | "profile_update";
  retryable?: boolean;
  reason?: string;
  profileFingerprint?: string;
}

export interface GeneratePersonalityParams {
  traits?: string;
  occupation?: string;
  backstoryIdea?: string;
  archetype?: string;
  name?: string;
  gender?: AgentGender;
  existingProfile?: {
    name?: string;
    backstory?: string;
    personality?: string;
    strategyStyle?: string;
    personaKey?: string;
    gender?: AgentGender;
  };
}

export interface GeneratePersonalityResult {
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
  personaKey: PersonaKey;
  gender: AgentGender;
}

// ---------------------------------------------------------------------------
// Saved agent profile API calls
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<SavedAgent[]> {
  return apiFetch("/api/agent-profiles");
}

export async function getAgent(id: string): Promise<SavedAgent> {
  return apiFetch(`/api/agent-profiles/${id}`);
}

export async function createAgent(
  params: CreateAgentParams,
): Promise<SavedAgent> {
  const agent = await apiFetch<SavedAgent>("/api/agent-profiles", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (typeof window !== "undefined" && agent.avatarCompletion) {
    window.dispatchEvent(new CustomEvent("agent-avatar:generation", {
      detail: {
        agentId: agent.id,
        agentName: agent.name,
        completion: agent.avatarCompletion,
      },
    }));
  }
  return agent;
}

export async function updateAgent(
  id: string,
  params: UpdateAgentParams,
): Promise<SavedAgent> {
  return apiFetch(`/api/agent-profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

export async function getOwnerLearningEligibleInputs(): Promise<OwnerLearningEligibleInputs> {
  return apiFetch("/api/agent-learning/eligible-inputs");
}

export async function recordOwnerLearningPromptImpression(
  threshold: 1 | 3,
): Promise<{ recorded: boolean }> {
  return apiFetch("/api/agent-learning/prompts/impression", {
    method: "POST",
    body: JSON.stringify({ threshold }),
  });
}

export async function dismissOwnerLearningPrompt(): Promise<{ recorded: boolean }> {
  return apiFetch("/api/agent-learning/prompts/dismiss", { method: "POST" });
}

export async function preflightOwnerLearningReview(input: {
  agentProfileId: string;
  gameIds: string[];
}): Promise<OwnerLearningPreflight> {
  return apiFetch("/api/agent-learning/reviews/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listOpenOwnerLearningReviews(): Promise<OwnerLearningReview[]> {
  return apiFetch("/api/agent-learning/reviews/open");
}

export async function startOwnerLearningReview(input: {
  agentProfileId: string;
  gameIds: string[];
  idempotencyKey: string;
}): Promise<OwnerLearningStartResult> {
  return apiFetch("/api/agent-learning/reviews", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getOwnerLearningReview(
  reviewId: string,
  agentProfileId?: string,
): Promise<OwnerLearningReview> {
  const query = agentProfileId
    ? `?agentProfileId=${encodeURIComponent(agentProfileId)}`
    : "";
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}${query}`);
}

export async function getOwnerLearningReviewStatus(
  reviewId: string,
  agentProfileId?: string,
): Promise<OwnerLearningReviewStatus> {
  const query = agentProfileId
    ? `?agentProfileId=${encodeURIComponent(agentProfileId)}`
    : "";
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/status${query}`);
}

export async function retryOwnerLearningReview(reviewId: string): Promise<OwnerLearningReview> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/retry`, {
    method: "POST",
  });
}

export async function recordOwnerLearningRecommendationsViewed(
  reviewId: string,
): Promise<{ recorded: boolean }> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/viewed`, {
    method: "POST",
  });
}

export async function recordOwnerLearningManualEditorOpened(
  reviewId: string,
): Promise<{ recorded: boolean }> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/manual-editor-opened`, {
    method: "POST",
    keepalive: true,
  });
}

export async function recordOwnerLearningMcpOfferViewed(
  reviewId: string,
): Promise<{ recorded: boolean }> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/mcp-offer-viewed`, {
    method: "POST",
  });
}

export async function applyOwnerLearningReview(
  reviewId: string,
  proposalFingerprint: string,
): Promise<OwnerLearningApplyResult> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/apply`, {
    method: "POST",
    body: JSON.stringify({ proposalFingerprint }),
  });
}

export async function resolveOwnerLearningReview(
  reviewId: string,
  resolution: "declined" | "failed",
): Promise<OwnerLearningReview> {
  return apiFetch(`/api/agent-learning/reviews/${encodeURIComponent(reviewId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution }),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await apiFetch(`/api/agent-profiles/${id}`, { method: "DELETE" });
}

export async function requestAgentAvatarGeneration(
  id: string,
): Promise<{ avatarCompletion: AvatarCompletion }> {
  return apiFetch(`/api/agent-profiles/${id}/avatar/generate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface DraftAgentAvatarParams {
  name: string;
  gender: AgentGender;
  backstory?: string;
  personality: string;
  strategyStyle?: string;
  personaKey: PersonaKey;
}

export function avatarDraftProfileFingerprint(params: DraftAgentAvatarParams): string {
  return JSON.stringify([
    params.gender,
    params.backstory?.trim() || null,
    params.personality.trim(),
    params.strategyStyle?.trim() || null,
    params.personaKey,
  ]);
}

export async function requestDraftAgentAvatarGeneration(
  params: DraftAgentAvatarParams,
): Promise<{ avatarCompletion: AvatarCompletion }> {
  return apiFetch("/api/agent-profiles/avatar/generate-draft", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getDraftAgentAvatarGeneration(
  generationRequestId: string,
): Promise<{ avatarCompletion: AvatarCompletion }> {
  return apiFetch(`/api/agent-profiles/avatar/generation-drafts/${generationRequestId}`);
}

export async function getAgentAvatarGeneration(
  id: string,
): Promise<{ avatarUrl: string | null; avatarCompletion: AvatarCompletion }> {
  return apiFetch(`/api/agent-profiles/${id}/avatar/generation`);
}

export async function getAgentAvatarGenerations(
  ids: string[],
): Promise<{ avatarCompletions: Record<string, AvatarCompletion> }> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return apiFetch(`/api/agent-profiles/avatar-generations?${params}`);
}

export async function generatePersonality(
  params: GeneratePersonalityParams,
): Promise<GeneratePersonalityResult> {
  return apiFetch("/api/agent-profiles/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------------------------------------------------------------------------
// Game detail types (for the game viewer)
// ---------------------------------------------------------------------------

/** Engine phase names plus the web-only suspended transport state. */
export type PhaseKey = `${EnginePhase}` | "SUSPENDED";

export type PlayerState = "alive" | "eliminated" | "unknown";

export interface GamePlayer {
  id: string;
  name: string;
  persona: string;
  personaKey?: string;
  status: PlayerState;
  shielded: boolean;
  pressureStatus?: GameWatchPlayerPressureStatus;
  exposeScore?: number;
  avatarUrl?: string;
  currentAgent?: PublicReplayAgentPreview | null;
}

export type TranscriptScope = "public" | "mingle" | "huddle" | "whisper" | "system" | "diary" | "thinking";

export interface WhisperRoomPlayerRef {
  id: string;
  name: string;
}

export interface WhisperRoomAllocation {
  roomId: number;
  round: number;
  beat: number;
  playerIds: string[];
}

export interface WhisperSessionDiagnostics {
  round: number;
  beat: number;
  roomCount: number;
  eligiblePlayers: WhisperRoomPlayerRef[];
  choices: Array<{
    player: WhisperRoomPlayerRef;
    requestedRoomId: number | null;
    assignedRoomId: number;
    status: "valid" | "missing" | "invalid";
  }>;
  allocatedRooms: Array<{
    roomId: number;
    beat: number;
    players: WhisperRoomPlayerRef[];
    conversationRan: boolean;
  }>;
}

export interface WhisperRoomMetadata {
  rooms: WhisperRoomAllocation[];
  excluded: string[];
  diagnostics?: WhisperSessionDiagnostics;
}

export interface WsRoomMetadata {
  rooms: WhisperRoomAllocation[];
  excluded: string[];
}

export interface TranscriptEntry {
  id: number;
  gameId: string;
  round: number;
  phase: PhaseKey;
  fromPlayerId: string | null;
  fromPlayerName: string | null;
  scope: TranscriptScope;
  toPlayerIds: string[] | null;
  roomId?: number;
  roomMetadata?: WhisperRoomMetadata;
  text: string;
  thinking?: string | null;
  timestamp: number;
}

export interface GameDetail {
  id: string;
  slug: string;
  status: GameStatus;
  /** Missing only on legacy/mock payloads; the presentation router defaults those to classic. */
  gameKernel?: GameKernel;
  gameKernelSource?: GameKernelSource;
  gameKernelDiagnostics?: GameKernelContradictionDiagnostic[];
  currentRound: number;
  maxRounds: number;
  currentPhase: PhaseKey;
  players: GamePlayer[];
  modelLabel: string;
  visibility: GameVisibility;
  viewerMode: ViewerMode;
  /** Frozen game configuration; absent only on historical/mock payloads. */
  formatManifest?: EngineLaunchFormatId[];
  seasonId?: string;
  season?: Pick<SeasonIdentity, "id" | "slug" | "name">;
  rated?: boolean;
  competitionReceipts?: GameCompetitionReceipt[];
  winner?: string;
  winnerPersona?: string;
  finalists?: [string, string];
  errorInfo?: string;
  kernelHealth?: KernelHealthSummary;
  watchState?: GameWatchState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Public transcript entry received over WebSocket (matches PublicWsTranscriptEntry in packages/api) */
export interface WsTranscriptEntry {
  round: number;
  phase: string;
  from: string; // player UUID or "SYSTEM"
  scope: TranscriptScope;
  to?: string[];
  roomId?: number;
  roomMetadata?: WsRoomMetadata;
  text: string;
  thinking?: string | null;
  anonymous?: boolean;
  displayOrder?: number;
  timestamp: number;
}

/** WebSocket event types pushed from the server (matches WsOutboundEvent in packages/api) */
export type WsGameEvent =
  | {
      type: "watch_state";
      state: GameWatchState;
    }
  | {
      type: "viewer_decision_event";
      /** Combined with event.sequence, this is the idempotent client key. */
      gameId: string;
      event: ViewerDecisionEvent;
    }
  | {
      type: "phase_change";
      phase: PhaseKey;
      round: number;
      alivePlayers: string[];
    }
  | { type: "message"; entry: WsTranscriptEntry }
  | {
      type: "player_eliminated";
      playerId: string;
      playerName: string;
      round: number;
    }
  | {
      type: "game_over";
      winner?: string;
      winnerName?: string;
      totalRounds: number;
    }
  | {
      type: "game_status";
      gameId: string;
      status: "suspended" | "cancelled";
      terminal: true;
      reasonCode: string;
      message?: string;
    }
  | {
      type: "error";
      message: string;
    };

// ---------------------------------------------------------------------------
// Game detail API calls
// ---------------------------------------------------------------------------

export async function hideGame(id: string): Promise<void> {
  await apiFetch(`/api/games/${id}/hide`, { method: "PATCH" });
}

export async function unhideGame(id: string): Promise<void> {
  await apiFetch(`/api/games/${id}/unhide`, { method: "PATCH" });
}

export async function getGame(id: string): Promise<GameDetail> {
  return apiFetch(`/api/games/${id}`);
}

export async function getGameTranscript(
  id: string,
): Promise<TranscriptEntry[]> {
  return apiFetch(`/api/games/${id}/transcript`);
}

export async function getGameReplayWatchFrames(
  id: string,
  options: {
    afterSequence?: number;
    presentationOnly?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GameWatchReplayFrame[]> {
  const params = new URLSearchParams();
  if (options.afterSequence !== undefined) {
    params.set("afterSequence", String(options.afterSequence));
  }
  if (options.presentationOnly !== undefined) {
    params.set("presentationOnly", String(options.presentationOnly));
  }
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  return apiFetch(`/api/games/${id}/replay-watch-frames${query}`, {
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// Admin agent profile types
// ---------------------------------------------------------------------------

export type AdminOwnerLearningAcceptance = "accepted" | "not_accepted" | "not_applicable" | "pending";
export type AdminOwnerLearningDisposition =
  | "not_ready"
  | "awaiting_owner"
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded";

export interface AdminOwnerLearningTokenTotals {
  input: number;
  cachedInput: number;
  totalOutput: number;
  reasoning: number;
  visibleOutput: number;
  unavailableCallCount: number;
}

export interface AdminOwnerLearningCostTotals {
  actualMicrousd: number;
  estimatedMicrousd: number;
  unavailableCallCount: number;
}

export interface AdminOwnerLearningReviewSummary {
  id: string;
  owner: { userId: string; displayName: string | null; handle: string | null };
  agent: { profileId: string; name: string };
  reviewedRevision: { id: string; ordinal: number };
  track: "evidence_rich" | "strategy_health_check";
  status: OwnerLearningAnalysisStatus;
  stage: OwnerLearningStage;
  resolution: OwnerLearningResolution | null;
  model: string;
  disposition: AdminOwnerLearningDisposition;
  acceptance: AdminOwnerLearningAcceptance;
  logicalCallCount: number;
  diveCount: number;
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  createdAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
}

export interface AdminOwnerLearningAnalytics {
  reviewCount: number;
  eventCounts: Record<string, number | undefined>;
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  averageCompletionLatencyMs: number | null;
}

export interface AdminOwnerLearningReviewList {
  reviews: AdminOwnerLearningReviewSummary[];
  analytics: AdminOwnerLearningAnalytics;
  truncated: boolean;
}

export interface AdminOwnerLearningReviewDetail {
  id: string;
  owner: AdminOwnerLearningReviewSummary["owner"];
  agent: AdminOwnerLearningReviewSummary["agent"];
  reviewedRevision: AdminOwnerLearningReviewSummary["reviewedRevision"];
  policy: {
    eligibility: string;
    evidence: string;
    reviewer: string;
    prompt: string;
    schema: string;
    provider: string;
    model: string;
  };
  lifecycle: {
    track: "evidence_rich" | "strategy_health_check";
    status: OwnerLearningAnalysisStatus;
    stage: OwnerLearningStage;
    capacitySubstatus: string | null;
    resolution: OwnerLearningResolution | null;
    safeFailureCode: string | null;
    retryable: boolean;
    logicalCallCount: number;
    diveCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    resolvedAt: string | null;
    updatedAt: string;
  };
  disposition: AdminOwnerLearningDisposition;
  acceptance: AdminOwnerLearningAcceptance;
  calls: Array<{
    ordinal: number;
    state: string;
    stage: string;
    requestedTier: string;
    effectiveTier: string | null;
    requestedReasoningEffort: string;
    capacityPath: string | null;
    flex429Count: number;
    terminalHttpStatus: number | null;
    providerRequestId: string | null;
    safeFailureCode: string | null;
    latencyMs: number | null;
    tokens: {
      input: number | null;
      cachedInput: number | null;
      totalOutput: number | null;
      reasoning: number | null;
      visibleOutput: number | null;
    };
    cost: {
      source: "actual" | "estimated" | "unavailable";
      microusd: number | null;
      pricingSourceId: string | null;
      rateCardVersion: string | null;
      pricedAt: string | null;
    };
    dispatchedAt: string | null;
    completedAt: string | null;
  }>;
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  application: null | {
    appliedAt: string;
  };
}

export interface AdminOwnerLearningReviewFilters {
  dateFrom?: string;
  dateTo?: string;
  track?: "evidence_rich" | "strategy_health_check";
  status?: OwnerLearningAnalysisStatus;
  model?: string;
  resolution?: OwnerLearningResolution | "open";
  application?: AdminOwnerLearningAcceptance;
}

export async function listAdminOwnerLearningReviews(
  filters: AdminOwnerLearningReviewFilters = {},
): Promise<AdminOwnerLearningReviewList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return apiFetch(`/api/admin/owner-learning-reviews${query ? `?${query}` : ""}`);
}

export async function getAdminOwnerLearningReview(
  reviewId: string,
): Promise<AdminOwnerLearningReviewDetail> {
  return apiFetch(`/api/admin/owner-learning-reviews/${encodeURIComponent(reviewId)}`);
}

export interface AdminAgent {
  id: string;
  userId: string;
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
  personaKey: PersonaKey | null;
  avatarUrl: string | null;
  gamesPlayed: number;
  gamesWon: number;
  ownerWallet: string | null;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Admin agent profile API calls
// ---------------------------------------------------------------------------

export async function listAdminAgents(): Promise<AdminAgent[]> {
  return apiFetch("/api/admin/agents");
}

// ---------------------------------------------------------------------------
// Admin RBAC types
// ---------------------------------------------------------------------------

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
}

export interface AddressRoleAssignment {
  walletAddress: string;
  roleId: string;
  roleName: string;
  grantedBy: string;
  grantedAt: string;
}

export interface AdminUser {
  id: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
  roles: string[];
  permissions: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin RBAC API calls
// ---------------------------------------------------------------------------

export async function listRoles(): Promise<AdminRole[]> {
  return apiFetch("/api/admin/roles");
}

export async function listAddressRoles(): Promise<AddressRoleAssignment[]> {
  return apiFetch("/api/admin/address-roles");
}

export async function assignRole(
  walletAddress: string,
  roleId: string,
): Promise<AddressRoleAssignment> {
  return apiFetch("/api/admin/address-roles", {
    method: "POST",
    body: JSON.stringify({ walletAddress, roleId }),
  });
}

export async function revokeRole(
  walletAddress: string,
  roleId: string,
): Promise<void> {
  await apiFetch("/api/admin/address-roles", {
    method: "DELETE",
    body: JSON.stringify({ walletAddress, roleId }),
  });
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  return apiFetch("/api/admin/users");
}

// ---------------------------------------------------------------------------
// Free game queue types
// ---------------------------------------------------------------------------

export interface FreeQueueStatus {
  queuedCount: number;
  nextGameAt: string; // ISO datetime of next midnight UTC
  userEntry: {
    agentProfileId: string;
    agentName: string;
    joinedAt: string;
  } | null;
  eligibility?: "eligible" | "temporarily-ineligible" | "absent" | null;
  promptEligible?: boolean;
  relevantGame?: {
    id: string;
    slug: string;
    status: "waiting" | "in_progress" | "suspended";
  } | null;
  todayGame: {
    id: string;
    slug: string;
    status: GameStatus;
    season?: Pick<SeasonIdentity, "id" | "slug" | "name">;
    kernelHealth?: KernelHealthSummary;
  } | null;
}

interface FreeQueueStatusResponse {
  count?: number;
  queuedCount?: number;
  nextGameTime?: string;
  nextGameAt?: string;
  userEntry?: FreeQueueStatus["userEntry"];
  todayGame?: FreeQueueStatus["todayGame"];
  eligibility?: FreeQueueStatus["eligibility"];
  promptEligible?: boolean;
  relevantGame?: FreeQueueStatus["relevantGame"];
}

export interface LeaderboardEntry {
  rank: number;
  player?: PublicPlayerIdentityRef | null;
  displayName: string;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  peakRating: number;
}

export interface AdminFreeQueueEntry {
  userId: string;
  ownerLabel: string;
  agentProfileId: string;
  agentName: string;
  joinedAt: string;
  consecutiveMisses: number;
  status: "eligible" | "in-game";
  activeGame: { id: string; slug: string; status: GameStatus } | null;
  lastGame: { id: string; slug: string; status: GameStatus; createdAt: string } | null;
}

export interface AdminFreeQueueStatus {
  eligibleCount: number;
  availableHumanSeats: 12;
  longestWaitSince: string | null;
  waitingGame: { id: string; slug: string; status: "waiting" } | null;
  entries: AdminFreeQueueEntry[];
}

export type FreeQueueDrawResult = {
  drawn: true;
  gameId: string;
  gameSlug: string;
  playersDrawn: number;
  aiPlayersFilled: number;
  totalPlayers: number;
  supersededGameCount: number;
  rated: boolean;
  seasonId: string | null;
} | {
  drawn: false;
  reason: string;
  gameId?: undefined;
  gameSlug?: undefined;
} | {
  drawn: false;
  reason: string;
  gameId: string;
  gameSlug: string;
};

export interface FreeQueueStartResult {
  started: true;
  gameId: string;
  gameSlug: string;
  players: number;
}

export interface SeasonIdentity {
  id: string;
  slug: string;
  name: string;
  status: "active" | "closing" | "final";
  ratedPool: "free";
  admissionStartsAt: string | null;
  admissionClosesAt: string | null;
  finalizedAt: string | null;
}

export interface AgentSeasonStanding {
  rank: number;
  agentId: string;
  agentName: string;
  owner?: PublicPlayerIdentityRef | null;
  ownerName: string | null;
  totalPoints: number;
  gamesPlayed: number;
  wins: number;
  runnerUpFinishes: number;
  averageNormalizedPlacement: number;
}

export interface ArchitectSeasonStanding {
  rank: number;
  owner?: PublicPlayerIdentityRef | null;
  ownerName: string | null;
  totalPointsHundredths: number;
  wins: number;
  contributions: Array<{
    agentId: string;
    agentName: string;
    sourcePoints: number;
    weightPercent: 100 | 50 | 25;
    weightedPointsHundredths: number;
  }>;
}

export interface SeasonDashboard {
  schemaVersion: 1 | 2;
  season: SeasonIdentity;
  agentStandings: AgentSeasonStanding[];
  architectStandings: ArchitectSeasonStanding[];
  honors: null | {
    agentChampion: {
      agentId: string;
      agentName: string;
      owner?: PublicPlayerIdentityRef | null;
      ownerName: string | null;
      points: number;
    };
    architectChampion: {
      owner?: PublicPlayerIdentityRef | null;
      ownerName: string | null;
      pointsHundredths: number;
      contributions: Array<Record<string, unknown>>;
    };
  };
}

export interface CompetitionReceipt {
  gameId: string;
  gameSlug: string | null;
  agentId: string;
  agentName: string;
  owner?: PublicPlayerIdentityRef | null;
  ownerName: string | null;
  lobbySize: number;
  placement: number | null;
  basePoints: number;
  fieldBonus: number;
  totalPoints: number;
  eligibilityStatus: "eligible" | "ineligible";
  eligibilityReason: string | null;
  accountRatingDelta: number | null;
  earnedAt: string;
}

export interface GameCompetitionReceipt extends CompetitionReceipt {
  seasonTotalPoints: number;
}

export interface OwnedCompetitionReceipt extends Omit<CompetitionReceipt, "owner"> {
  ownerId: string;
  revisionId: string;
}

export interface AgentSeasonAnalysis {
  schemaVersion: 1;
  season: SeasonIdentity;
  agent: { id: string; name: string };
  summary: {
    totalPoints: number;
    gamesPlayed: number;
    wins: number;
    averagePlacement: number | null;
    placementDistribution: Record<string, number>;
  };
  revisions: Array<{
    revisionId: string;
    ordinal: number;
    gamesPlayed: number;
    wins: number;
    totalPoints: number;
    averagePlacement: number | null;
  }>;
  receipts: OwnedCompetitionReceipt[];
}

export interface ProducerSeasonDiagnostics {
  schemaVersion: 1;
  seasonId: string;
  season: {
    status: SeasonIdentity["status"];
  };
  readiness: {
    assignedGames: number;
    nonTerminalGames: number;
    unsettledOwnedSeats: number;
    canFinalize: boolean;
  };
  ratings: Array<{
    agentProfileId: string;
    effectiveRevisionId: string;
    mu: number;
    sigma: number;
    gamesPlayed: number;
    ratingPolicyVersion: string;
  }>;
  ratingEvents: Array<{
    id: string;
    eventType: "initialization" | "revision_recalibration" | "game_result";
    agentProfileId: string;
    agentRevisionId: string;
    beforeMu: number | null;
    beforeSigma: number | null;
    afterMu: number;
    afterSigma: number;
    ratingPolicyVersion: string;
    revisionPolicyVersion: string | null;
    evidence: Record<string, unknown>;
    createdAt: string;
  }>;
  ratingSnapshots: Array<{
    id: string;
    gameId: string;
    agentProfileId: string;
    agentRevisionId: string;
    mu: number;
    sigma: number;
    ratingPolicyVersion: string;
    capturedAt: string;
  }>;
  receiptEvidence: Array<{
    receiptId: string;
    ratingPolicyVersion: string;
    pregameRating: Record<string, unknown>;
    postgameRating: Record<string, unknown> | null;
    opponentRatings: Array<Record<string, unknown>>;
    fieldStrengthEvidence: Record<string, unknown>;
  }>;
  revisions: Array<{
    id: string;
    agentProfileId: string;
    ordinal: number;
    magnitude: "initial" | "small" | "material" | "execution";
    fingerprint: string;
    behaviorSnapshot: Record<string, unknown>;
    effectiveRuntimeSnapshot: Record<string, unknown>;
    createdAt: string;
  }>;
}

// Keep for backwards compat during transition
export type FreeTrackLeaderboardEntry = LeaderboardEntry;

// ---------------------------------------------------------------------------
// Player profile types
// ---------------------------------------------------------------------------

export interface PlayerProfile extends AuthenticatedPublicIdentity {
  id: string;
  walletAddress: string | null;
  email: string | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  peakRating: number;
  lastGameAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Free game queue API calls
// ---------------------------------------------------------------------------

export async function getFreeQueueStatus(): Promise<FreeQueueStatus> {
  const status = await apiFetch<FreeQueueStatusResponse>("/api/free-queue");

  return {
    queuedCount: status.queuedCount ?? status.count ?? 0,
    nextGameAt: status.nextGameAt ?? status.nextGameTime ?? new Date().toISOString(),
    userEntry: status.userEntry ?? null,
    eligibility: status.eligibility ?? null,
    promptEligible: status.promptEligible ?? false,
    relevantGame: status.relevantGame ?? null,
    todayGame: status.todayGame ?? null,
  };
}

export async function joinFreeQueue(agentProfileId: string): Promise<void> {
  await apiFetch("/api/free-queue/join", {
    method: "POST",
    body: JSON.stringify({ agentProfileId }),
  });
}

export async function leaveFreeQueue(): Promise<void> {
  await apiFetch("/api/free-queue/leave", { method: "DELETE" });
}

export async function maybeLaterFreeQueue(): Promise<void> {
  await apiFetch("/api/free-queue/maybe-later", { method: "POST" });
}

export async function getFreeQueueLeaderboard(): Promise<LeaderboardEntry[]> {
  return apiFetch("/api/free-queue/leaderboard");
}

export async function getAdminFreeQueue(): Promise<AdminFreeQueueStatus> {
  return apiFetch("/api/admin/free-queue");
}

export async function drawFreeQueueGame(idempotencyKey: string): Promise<FreeQueueDrawResult> {
  return apiFetch("/api/free-queue/draw", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function startFreeQueueGame(gameId: string): Promise<FreeQueueStartResult> {
  return apiFetch(`/api/free-queue/start?gameId=${encodeURIComponent(gameId)}`, {
    method: "POST",
  });
}

export async function removeAdminFreeQueueEntry(userId: string): Promise<void> {
  await apiFetch(`/api/admin/free-queue/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function listSeasons(): Promise<SeasonIdentity[]> {
  const response = await apiFetch<{ schemaVersion: 1; seasons: SeasonIdentity[] }>("/api/seasons");
  return response.seasons;
}

export async function getSeasonDashboard(idOrSlug: string): Promise<SeasonDashboard> {
  return apiFetch(`/api/seasons/${encodeURIComponent(idOrSlug)}`);
}

export async function getAgentSeasonAnalysis(
  seasonIdOrSlug: string,
  agentId: string,
): Promise<AgentSeasonAnalysis> {
  return apiFetch(
    `/api/seasons/${encodeURIComponent(seasonIdOrSlug)}/agents/${encodeURIComponent(agentId)}`,
  );
}

export function agentSeasonExportUrl(
  seasonIdOrSlug: string,
  format: "json" | "csv",
  agentId?: string,
): string {
  const query = new URLSearchParams({ format });
  if (agentId) query.set("agentId", agentId);
  return resolveApiUrl(`/api/seasons/${encodeURIComponent(seasonIdOrSlug)}/export?${query}`);
}

export async function getProducerSeasonDiagnostics(idOrSlug: string): Promise<ProducerSeasonDiagnostics> {
  return apiFetch(`/api/admin/seasons/${encodeURIComponent(idOrSlug)}/diagnostics`);
}

export async function createAdminSeason(input: {
  slug: string;
  name: string;
  admissionStartsAt?: string | null;
  admissionClosesAt?: string | null;
}): Promise<SeasonIdentity> {
  const response = await apiFetch<{ schemaVersion: 1; season: SeasonIdentity }>("/api/admin/seasons", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.season;
}

export async function closeAdminSeason(id: string): Promise<SeasonIdentity> {
  const response = await apiFetch<{ schemaVersion: 1; season: SeasonIdentity }>(`/api/admin/seasons/${id}/close`, {
    method: "POST",
  });
  return response.season;
}

export async function finalizeAdminSeason(id: string): Promise<void> {
  await apiFetch(`/api/admin/seasons/${id}/finalize`, { method: "POST" });
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return apiFetch("/api/leaderboard");
}

// ---------------------------------------------------------------------------
// Profile API calls
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<PlayerProfile> {
  return apiFetch("/api/profile");
}

export async function updateProfile(
  displayName: string,
  handle: string,
): Promise<PlayerProfile> {
  return apiFetch("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName, handle }),
  });
}

export async function suggestProfileHandle(displayName: string): Promise<string> {
  const result = await apiFetch<{ suggestion: string }>(
    `/api/profile/handle-suggestion?displayName=${encodeURIComponent(displayName)}`,
  );
  return result.suggestion;
}

// ---------------------------------------------------------------------------
// Upload API calls
// ---------------------------------------------------------------------------

export interface UploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadProfilePicture(file: File): Promise<UploadResult> {
  // Step 1: Get a presigned PUT URL from our API
  const { uploadUrl, publicUrl, key } = await apiFetch<{
    uploadUrl: string;
    publicUrl: string;
    key: string;
  }>("/api/upload/pfp", {
    method: "POST",
    body: JSON.stringify({ contentType: file.type }),
  });

  // Step 2: PUT the file directly to object storage
  const putRes = await fetch(resolveApiUrl(uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": file.type, "x-amz-acl": "public-read" },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`Upload failed: ${putRes.status}`);
  }

  return { publicUrl: resolveApiUrl(publicUrl), key };
}

// ---------------------------------------------------------------------------
// Admin import game types & API calls
// ---------------------------------------------------------------------------

export interface RemoteGame {
  slug: string;
  status: GameStatus;
  playerCount: number;
  currentRound: number;
  maxRounds: number;
  kernelHealth?: KernelHealthSummary;
  createdAt: string;
}

export interface ImportGameResult {
  id: string;
  gameId?: string;
  slug: string;
}

export async function listRemoteGames(
  sourceUrl: string,
): Promise<RemoteGame[]> {
  const qs = new URLSearchParams({ url: sourceUrl });
  return apiFetch(`/api/admin/remote-games?${qs}`);
}

export async function importGame(
  sourceUrl: string,
  slug: string,
): Promise<ImportGameResult> {
  return apiFetch("/api/admin/import-game", {
    method: "POST",
    body: JSON.stringify({ sourceUrl, slug }),
  });
}
