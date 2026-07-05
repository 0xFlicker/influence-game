#!/usr/bin/env bun
/**
 * API-backed simulation launcher.
 *
 * Creates, fills, and starts real API games so local CLI evaluation writes to
 * the same Postgres-backed durable run path as the web UI.
 */

import { loadStoredMcpAccessToken } from "./game-mcp/oauth-token-store";
import { normalizeReasoningPolicy, type ModelReasoningPolicy } from "./model-catalog";

interface ApiSimArgs {
  apiBaseUrl: string;
  games: number;
  players: number;
  provider: "openai" | "lm-studio" | "katana" | "custom-openai-compatible";
  model?: string;
  modelCatalogId?: string;
  reasoningPolicy?: ModelReasoningPolicy;
  timingPreset: "fast" | "standard" | "slow";
  maxRounds: number | "auto";
  visibility: "public" | "unlisted" | "private";
  viewerMode: "live" | "speedrun";
  waitForAdvance: boolean;
  advanceTimeoutMs: number;
  pollIntervalMs: number;
}

interface AuthExchangeResponse {
  token: string;
  user: {
    id: string;
    roles: string[];
    permissions: string[];
  };
}

interface GameCreateResponse {
  id: string;
  slug?: string;
  gameNumber?: number;
}

interface GameDetailResponse {
  id: string;
  slug?: string;
  status: string;
  currentRound: number;
  currentPhase: string;
  watchState?: {
    eventCursor?: {
      sequence: number;
    };
  };
}

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";

export function defaultApiSimulationMaxRounds(playerCount: number): number {
  const normalRoundsToEndgame = Math.max(0, playerCount - 4);
  const endgameRounds = 3;
  const buffer = 2;
  return Math.max(5, normalRoundsToEndgame + endgameRounds + buffer);
}

export function parseArgs(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): ApiSimArgs {
  const envMaxRounds = parseMaxRounds(env.INFLUENCE_API_SIM_MAX_ROUNDS);
  let hasExplicitMaxRounds = envMaxRounds !== undefined;
  const args: ApiSimArgs = {
    apiBaseUrl: env.INFLUENCE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    games: readPositiveInt(env.INFLUENCE_API_SIM_GAMES, 1),
    players: readPositiveInt(env.INFLUENCE_API_SIM_PLAYERS, 4),
    provider: parseProvider(env.INFLUENCE_API_SIM_PROVIDER) ?? "openai",
    model: env.INFLUENCE_API_SIM_MODEL,
    modelCatalogId: env.INFLUENCE_API_SIM_MODEL_CATALOG_ID,
    reasoningPolicy: normalizeReasoningPolicy(env.INFLUENCE_API_SIM_REASONING_POLICY) ?? undefined,
    timingPreset: parseTimingPreset(env.INFLUENCE_API_SIM_TIMING_PRESET) ?? "fast",
    maxRounds: envMaxRounds ?? 5,
    visibility: parseVisibility(env.INFLUENCE_API_SIM_VISIBILITY) ?? "public",
    viewerMode: parseViewerMode(env.INFLUENCE_API_SIM_VIEWER_MODE) ?? "speedrun",
    waitForAdvance: env.INFLUENCE_API_SIM_WAIT_FOR_ADVANCE !== "false",
    advanceTimeoutMs: readPositiveInt(env.INFLUENCE_API_SIM_ADVANCE_TIMEOUT_MS, 120_000),
    pollIntervalMs: readPositiveInt(env.INFLUENCE_API_SIM_POLL_INTERVAL_MS, 3_000),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--api-url" || arg === "--api-base-url") && next) {
      args.apiBaseUrl = next;
      i++;
    } else if (arg === "--games" && next) {
      args.games = parseInt(next, 10);
      i++;
    } else if (arg === "--players" && next) {
      args.players = parseInt(next, 10);
      i++;
    } else if (arg === "--provider" && next) {
      args.provider = parseProvider(next) ?? args.provider;
      i++;
    } else if (arg === "--model" && next) {
      args.model = next;
      i++;
    } else if ((arg === "--model-catalog" || arg === "--model-catalog-id") && next) {
      args.modelCatalogId = next;
      i++;
    } else if ((arg === "--reasoning-policy" || arg === "--thinking-depth") && next) {
      const policy = normalizeReasoningPolicy(next);
      if (policy) args.reasoningPolicy = policy;
      i++;
    } else if (arg === "--timing-preset" && next) {
      args.timingPreset = parseTimingPreset(next) ?? args.timingPreset;
      i++;
    } else if (arg === "--max-rounds" && next) {
      args.maxRounds = parseMaxRounds(next) ?? args.maxRounds;
      hasExplicitMaxRounds = true;
      i++;
    } else if (arg === "--visibility" && next) {
      args.visibility = parseVisibility(next) ?? args.visibility;
      i++;
    } else if (arg === "--viewer-mode" && next) {
      args.viewerMode = parseViewerMode(next) ?? args.viewerMode;
      i++;
    } else if (arg === "--no-wait-for-advance") {
      args.waitForAdvance = false;
    } else if (arg === "--advance-timeout-ms" && next) {
      args.advanceTimeoutMs = parseInt(next, 10);
      i++;
    } else if (arg === "--poll-interval-ms" && next) {
      args.pollIntervalMs = parseInt(next, 10);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.games) || args.games < 1) throw new Error("--games must be a positive integer");
  if (!Number.isFinite(args.players) || args.players < 4) throw new Error("--players must be at least 4");
  if (!hasExplicitMaxRounds) {
    args.maxRounds = defaultApiSimulationMaxRounds(args.players);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const sessionToken = await resolveSessionToken(args.apiBaseUrl);
  const catalogId = args.modelCatalogId ?? catalogIdFromProviderAndModel(args.provider, args.model);
  const launched: GameCreateResponse[] = [];

  for (let index = 0; index < args.games; index++) {
    const game = await createGame(args, sessionToken, catalogId);
    launched.push(game);
    await fillGame(args.apiBaseUrl, sessionToken, game.id);
    await startGame(args.apiBaseUrl, sessionToken, game.id);
    console.log(`Started API game ${game.slug ?? game.id} (${game.id}) with ${catalogId}`);
  }

  if (args.waitForAdvance) {
    await Promise.all(launched.map((game) => waitForGameAdvance(args, game.id)));
  }

  console.log("API-backed simulation launch complete:");
  for (const game of launched) {
    console.log(`- ${new URL(`/games/${game.slug ?? game.id}`, args.apiBaseUrl).toString()} (${game.id})`);
  }
}

async function resolveSessionToken(apiBaseUrl: string): Promise<string> {
  const configured = process.env.INFLUENCE_API_SESSION_TOKEN?.trim();
  if (configured) return configured;

  const mcpToken = process.env.INFLUENCE_MCP_TOKEN?.trim() || loadStoredMcpAccessToken();
  const exchanged = await apiFetch<AuthExchangeResponse>(
    apiBaseUrl,
    "/api/auth/local-cli-session",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpToken}` },
      body: JSON.stringify({}),
    },
  );
  const missing = ["create_game", "fill_game", "start_game"].filter(
    (permission) => !exchanged.user.permissions.includes(permission),
  );
  if (missing.length > 0) {
    throw new Error(`Authenticated CLI user is missing permissions: ${missing.join(", ")}`);
  }
  return exchanged.token;
}

async function createGame(
  args: ApiSimArgs,
  sessionToken: string,
  catalogId: string,
): Promise<GameCreateResponse> {
  const body = {
    playerCount: args.players,
    modelSelection: {
      catalogId,
      ...(args.reasoningPolicy && { reasoningPolicy: args.reasoningPolicy }),
    },
    timingPreset: args.timingPreset,
    maxRounds: args.maxRounds,
    visibility: args.visibility,
    slotType: "all_ai",
    fillStrategy: "balanced",
    viewerMode: args.viewerMode,
  };
  return apiFetch<GameCreateResponse>(args.apiBaseUrl, "/api/games", {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify(body),
  });
}

async function fillGame(apiBaseUrl: string, sessionToken: string, gameId: string): Promise<void> {
  await apiFetch(apiBaseUrl, `/api/games/${gameId}/fill`, {
    method: "POST",
    headers: authHeaders(sessionToken),
  });
}

async function startGame(apiBaseUrl: string, sessionToken: string, gameId: string): Promise<void> {
  await apiFetch(apiBaseUrl, `/api/games/${gameId}/start`, {
    method: "POST",
    headers: authHeaders(sessionToken),
  });
}

async function waitForGameAdvance(args: ApiSimArgs, gameId: string): Promise<void> {
  const deadline = Date.now() + args.advanceTimeoutMs;
  while (Date.now() < deadline) {
    const detail = await apiFetch<GameDetailResponse>(args.apiBaseUrl, `/api/games/${gameId}`);
    const sequence = detail.watchState?.eventCursor?.sequence ?? 0;
    if (detail.status === "in_progress" && sequence > 0) {
      console.log(`Game ${detail.slug ?? gameId} advanced to ${detail.currentPhase} round ${detail.currentRound} (event ${sequence})`);
      return;
    }
    if (detail.status === "suspended" || detail.status === "cancelled" || detail.status === "completed") {
      throw new Error(`Game ${detail.slug ?? gameId} stopped before advancing: ${detail.status}`);
    }
    await sleep(args.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for game ${gameId} to advance`);
}

async function apiFetch<T = unknown>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${init?.method ?? "GET"} ${url.pathname} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function catalogIdFromProviderAndModel(
  provider: ApiSimArgs["provider"],
  model: string | undefined,
): string {
  if (model) return `${provider}:${model}`;
  if (provider === "lm-studio") {
    throw new Error("--model is required for --provider lm-studio");
  }
  if (provider === "katana") return "katana:grok-4-3";
  if (provider === "custom-openai-compatible") {
    throw new Error("--model is required for --provider custom-openai-compatible");
  }
  return "openai:gpt-5-nano";
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMaxRounds(value: string | undefined): number | "auto" | undefined {
  if (!value) return undefined;
  if (value === "auto") return "auto";
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseProvider(value: string | undefined): ApiSimArgs["provider"] | undefined {
  if (value === "openai" || value === "lm-studio" || value === "katana" || value === "custom-openai-compatible") {
    return value;
  }
  return undefined;
}

function parseTimingPreset(value: string | undefined): ApiSimArgs["timingPreset"] | undefined {
  if (value === "fast" || value === "standard" || value === "slow") return value;
  return undefined;
}

function parseVisibility(value: string | undefined): ApiSimArgs["visibility"] | undefined {
  if (value === "public" || value === "unlisted" || value === "private") return value;
  return undefined;
}

function parseViewerMode(value: string | undefined): ApiSimArgs["viewerMode"] | undefined {
  if (value === "live" || value === "speedrun") return value;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log(`Usage:
  bun run simulate:api -- --provider lm-studio --model <lm-studio-model-id>
  bun run simulate:api -- --provider katana --model deepseek-v4-flash

Defaults:
  --max-rounds scales with player count for short API smoke games (4 players -> 5)

Auth:
  Uses INFLUENCE_API_SESSION_TOKEN when set, otherwise exchanges INFLUENCE_MCP_TOKEN
  or ~/.influence-game/mcp-token.json through /api/auth/local-cli-session.
`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
