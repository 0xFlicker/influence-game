/**
 * Influence API client.
 * All API calls go through apiFetch so the base URL and auth headers are consistent.
 */

const API_BASE =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL) ?? "http://localhost:3000";

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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
  | "wildcard";

export type ModelTier = "budget" | "standard" | "premium";
export type FillStrategy = "random" | "balanced";
export type TimingPreset = "fast" | "standard" | "slow" | "custom";
export type GameVisibility = "public" | "unlisted" | "private";
export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled";

export interface CreateGameParams {
  playerCount: 4 | 6 | 8 | 10 | 12;
  slotType: "all_ai" | "mixed";
  modelTier: ModelTier;
  personaPool: PersonaKey[];
  fillStrategy: FillStrategy;
  timingPreset: TimingPreset;
  maxRounds: number | "auto";
  visibility: GameVisibility;
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
  finalists?: [string, string];
  winner?: string;
  winnerPersona?: string;
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

export async function fillGame(id: string): Promise<FillGameResult> {
  return apiFetch(`/api/games/${id}/fill`, { method: "POST" });
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
  roles: { isAdmin: boolean };
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

export interface JoinGameConfig {
  agentName: string;
  personality: string;
  strategyHints?: string;
  personaKey: PersonaKey;
}

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
    };

// ---------------------------------------------------------------------------
// Game detail API calls
// ---------------------------------------------------------------------------

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
