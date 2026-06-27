/**
 * Influence API client.
 * All API calls go through apiFetch so the base URL and auth headers are consistent.
 */

let API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000";

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

const TOKEN_KEY = "influence_session";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new CustomEvent("auth:session-ready"));
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
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
      clearAuthToken();
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
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

export type ModelTier = "budget" | "standard" | "premium";
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
  schemaVersion: 2;
  gameId: string;
  slug?: string;
  status: GameStatus;
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
  schemaVersion: 1;
  gameId: string;
  slug?: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  round: number;
  phase: PhaseKey;
  players: GameWatchPlayer[];
  counts: GameWatchState["counts"];
}

export type GameWatchStateSummary = Omit<GameWatchState, "players">;

export interface CreateGameParams {
  playerCount: 4 | 6 | 8 | 10 | 12;
  slotType: "all_ai" | "mixed";
  modelTier: ModelTier;
  personaPool: PersonaKey[];
  fillStrategy: FillStrategy;
  timingPreset: TimingPreset;
  maxRounds: number | "auto";
  visibility: GameVisibility;
  viewerMode: "live" | "speedrun";
}

export interface GameSummary {
  id: string;
  slug?: string;
  gameNumber: number;
  status: GameStatus;
  playerCount: number;
  currentRound: number;
  maxRounds: number;
  currentPhase: string;
  phaseTimeRemaining: number | null;
  alivePlayers: number;
  eliminatedPlayers: number;
  modelTier: ModelTier;
  visibility: GameVisibility;
  viewerMode: ViewerMode;
  trackType?: TrackType;
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
): Promise<{ id: string; slug: string; gameNumber: number }> {
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
}

export async function listAdminGames(): Promise<AdminGameSummary[]> {
  return apiFetch("/api/admin/games");
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
      clearAuthToken();
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
      slug?: string;
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
      slug?: string;
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
      slug?: string;
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
export type RevealedFactsStatus = "available" | "not_yet_resolved" | "not_yet_flushed" | "unavailable";
export type RevealedCanonicalFactsStatus = "available" | "not_yet_flushed" | "unavailable";

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

export interface PublicWatchIntelligenceRoundFacts {
  round: number;
  phase: string | null;
  players: {
    alive: Array<{ id: string; name: string }>;
    eliminated: Array<{ id: string; name: string }>;
  };
  standardVote: {
    status: RevealedFactsStatus;
    ledger: unknown[];
    empowerTally: unknown[];
    empowered: { id: string; name: string } | null;
    method: string | null;
    tied: unknown[];
  };
  power: {
    status: RevealedFactsStatus;
    exposureScores: unknown[];
    exposureBench: Record<string, unknown>;
    shieldReplacement: Record<string, unknown> | null;
    action: Record<string, unknown> | null;
    shieldGranted: { id: string; name: string } | null;
    autoEliminated: { id: string; name: string } | null;
    finalCouncilCandidates: Array<{ id: string; name: string }>;
    method: string | null;
  };
  council: {
    status: RevealedFactsStatus;
    ledger: unknown[];
    eliminated: { id: string; name: string } | null;
    method: string | null;
    candidates: Array<{ id: string; name: string }>;
  };
}

export interface PublicWatchIntelligenceReceipts {
  status: "available" | "unavailable";
  canonicalGameFacts: {
    roundFacts: PublicWatchIntelligenceRoundFacts;
    availability: {
      canonicalFactsStatus: RevealedCanonicalFactsStatus;
      eventLogStatus: string;
      projectionStatus: string;
      artifactDerivedFacts: {
        status: "not_used";
        reason: string;
      };
      diagnostics: Array<{
        code: string;
        severity: "info" | "warning" | "error";
        message: string;
      }>;
    };
  };
  reason?: string;
}

export type PublicWatchIntelligenceResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: {
        id: string;
        slug?: string;
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

// ---------------------------------------------------------------------------
// Auth API calls
// ---------------------------------------------------------------------------

export interface AuthMe {
  id: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
}

export async function getMe(): Promise<AuthMe> {
  return apiFetch("/api/auth/me");
}

export async function loginWithPrivyToken(
  privyToken: string,
  inviteCode?: string,
): Promise<{ token: string }> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token: privyToken, ...(inviteCode ? { inviteCode } : {}) }),
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
  resource: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

export type McpOAuthDecision = "inspect" | "approve" | "deny" | "cancel";

export interface McpOAuthAuthorizePreview {
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  authProfile?: "games_subject" | "producer_mcp";
  hasMcpRole: boolean;
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
): Promise<McpOAuthAuthorizeResponse> {
  return apiFetch("/api/oauth/mcp/authorize", {
    method: "POST",
    body: JSON.stringify({ ...request, decision }),
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
  gameSlug?: string;
  gameNumber: number;
  agentName: string;
  persona: PersonaKey;
  placement: number;
  totalPlayers: number;
  eliminated: boolean;
  winner: boolean;
  rounds: number;
  completedAt: string;
  modelTier: ModelTier;
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
  avatarUrl: string | null;
  gamesPlayed: number;
  gamesWon: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentParams {
  name: string;
  personality: string;
  backstory?: string;
  strategyStyle?: string;
  personaKey?: PersonaKey;
  avatarUrl?: string;
}

export type UpdateAgentParams = Partial<CreateAgentParams>;

export interface GeneratePersonalityParams {
  traits?: string;
  occupation?: string;
  backstoryIdea?: string;
  archetype?: string;
  name?: string;
  existingProfile?: {
    name?: string;
    backstory?: string;
    personality?: string;
    strategyStyle?: string;
    personaKey?: string;
  };
}

export interface GeneratePersonalityResult {
  name: string;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
  personaKey: PersonaKey;
}

// ---------------------------------------------------------------------------
// Saved agent profile API calls
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<SavedAgent[]> {
  return apiFetch("/api/agent-profiles");
}

export async function createAgent(
  params: CreateAgentParams,
): Promise<SavedAgent> {
  return apiFetch("/api/agent-profiles", {
    method: "POST",
    body: JSON.stringify(params),
  });
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

export async function deleteAgent(id: string): Promise<void> {
  await apiFetch(`/api/agent-profiles/${id}`, { method: "DELETE" });
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

export type PhaseKey =
  | "INIT"
  | "INTRODUCTION"
  | "LOBBY"
  | "MINGLE" | "WHISPER"
  | "RUMOR"
  | "VOTE"
  | "POWER"
  | "REVEAL"
  | "COUNCIL"
  | "DIARY_ROOM"
  | "PLEA"
  | "ACCUSATION"
  | "DEFENSE"
  | "OPENING_STATEMENTS"
  | "JURY_QUESTIONS"
  | "CLOSING_ARGUMENTS"
  | "JURY_VOTE"
  | "SUSPENDED"
  | "END";

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
}

export type TranscriptScope = "public" | "mingle" | "whisper" | "system" | "diary" | "thinking";

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
  slug?: string;
  gameNumber: number;
  status: GameStatus;
  currentRound: number;
  maxRounds: number;
  currentPhase: PhaseKey;
  players: GamePlayer[];
  modelTier: ModelTier;
  visibility: GameVisibility;
  viewerMode: ViewerMode;
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
): Promise<GameWatchReplayFrame[]> {
  return apiFetch(`/api/games/${id}/replay-watch-frames`);
}

// ---------------------------------------------------------------------------
// Cost estimation (client-side, informational only)
// Rates per 1k tokens: budget $0.00015, standard $0.0025, premium $0.015
// Est tokens/game: ~15k budget, ~22k standard, ~30k premium (scaled by player count)
// ---------------------------------------------------------------------------

const BASE_COST_USD: Record<ModelTier, number> = {
  budget: 0.05,
  standard: 0.79,
  premium: 2.1,
};

export function estimateCost(
  playerCount: number,
  modelTier: ModelTier,
): string {
  const base = BASE_COST_USD[modelTier];
  const scaled = base * (playerCount / 6);
  if (scaled < 0.01) return "<$0.01";
  return `~$${scaled.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Admin agent profile types
// ---------------------------------------------------------------------------

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
  todayGame: {
    id: string;
    slug: string;
    gameNumber: number;
    status: GameStatus;
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
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  peakRating: number;
}

// Keep for backwards compat during transition
export type FreeTrackLeaderboardEntry = LeaderboardEntry;

// ---------------------------------------------------------------------------
// Player profile types
// ---------------------------------------------------------------------------

export interface PlayerProfile {
  id: string;
  displayName: string | null;
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

export async function getFreeQueueLeaderboard(): Promise<LeaderboardEntry[]> {
  return apiFetch("/api/free-queue/leaderboard");
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

export async function updateProfile(displayName: string): Promise<PlayerProfile> {
  return apiFetch("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
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
  gameNumber: number;
  status: GameStatus;
  playerCount: number;
  currentRound: number;
  maxRounds: number;
  kernelHealth?: KernelHealthSummary;
  createdAt: string;
}

export interface ImportGameResult {
  id: string;
  slug: string;
  gameNumber: number;
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
