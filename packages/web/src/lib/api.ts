/**
 * Influence API client.
 * All API calls go through apiFetch so the base URL and auth headers are consistent.
 */

const API_BASE =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL) ?? "http://localhost:3000";

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
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
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
export type GameStatus = "waiting" | "in_progress" | "complete" | "stopped";

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
): Promise<{ id: string; gameNumber: number }> {
  return apiFetch("/api/games", { method: "POST", body: JSON.stringify(params) });
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

export async function joinGame(gameId: string, config: JoinGameConfig): Promise<void> {
  await apiFetch(`/api/games/${gameId}/join`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function getPlayerGames(): Promise<PlayerGameResult[]> {
  return apiFetch("/api/player/games");
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
