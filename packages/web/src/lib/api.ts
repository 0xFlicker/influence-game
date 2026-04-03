/**
 * Influence API client.
 * All API calls go through apiFetch so the base URL and auth headers are consistent.
 */

let API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/** Called by RuntimeConfigProvider once runtime config is fetched. */
export function setApiBase(url: string): void {
  API_BASE = url;
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
  const url = `${API_BASE}${path}`;
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
export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled";
export type ViewerMode = "live" | "speedrun" | "replay";
export type TrackType = "custom" | "free";

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
): Promise<{ token: string }> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token: privyToken }),
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
  | "WHISPER"
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
  | "END";

export type PlayerState = "alive" | "eliminated";

export interface GamePlayer {
  id: string;
  name: string;
  persona: string;
  status: PlayerState;
  shielded: boolean;
  avatarUrl?: string;
}

export type TranscriptScope = "public" | "whisper" | "system" | "diary";

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
  text: string;
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
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Engine-format transcript entry received over WebSocket (differs from DB TranscriptEntry) */
export interface WsTranscriptEntry {
  round: number;
  phase: string;
  from: string; // player UUID or "SYSTEM"
  scope: TranscriptScope;
  to?: string[];
  roomId?: number;
  text: string;
  timestamp: number;
}

/** WebSocket event types pushed from the server (matches WsOutboundEvent in packages/api) */
export type WsGameEvent =
  | {
      type: "game_state";
      snapshot: {
        gameId: string;
        round: number;
        alivePlayers: Array<{ id: string; name: string; shielded: boolean }>;
        eliminatedPlayers: Array<{ id: string; name: string }>;
        transcript: WsTranscriptEntry[];
      };
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
      type: "players_filled";
      gameId: string;
      players: Array<{ id: string; name: string; archetype: string }>;
      totalPlayers: number;
    }
  | {
      type: "players_updated";
      gameId: string;
      players: Array<{ id: string; name: string; archetype: string }>;
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
  } | null;
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
  return apiFetch("/api/free-queue");
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
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch("/api/upload/pfp", {
    method: "POST",
    body: formData,
  });
}

