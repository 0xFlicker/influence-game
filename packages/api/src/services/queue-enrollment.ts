import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  normalizeGameModelSelection,
  resolveModelSelection,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus, TrackType } from "../db/schema.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import {
  getOwnedAgent,
  type AgentProfileManagementContext,
  type AgentSummary,
} from "./agent-profile-management.js";
import { tryRefreshGameWatchStateSummary } from "./game-watch-state-summary.js";

export type QueueType = "daily-free" | "open-game";

const SUPPORTED_JOIN_QUEUE_TYPES = ["daily-free", "open-game"] as const;
const SUPPORTED_STATUS_QUEUE_TYPES = ["daily-free"] as const;
const SUPPORTED_LEAVE_QUEUE_TYPES = ["daily-free"] as const;
const DEFAULT_OPEN_GAME_LIMIT = 20;
const MAX_OPEN_GAME_LIMIT = 100;

export type QueueEnrollmentErrorCode =
  | "unsupported_queue_type"
  | "invalid_queue_input"
  | "agent_already_queued"
  | "agent_already_in_active_game"
  | "queue_full"
  | "game_not_joinable";

export class QueueEnrollmentError extends Error {
  constructor(
    public readonly code: QueueEnrollmentErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "QueueEnrollmentError";
  }
}

export interface QueueEnrollmentContext extends AgentProfileManagementContext {}

export interface GetQueueStatusInput {
  queueType?: unknown;
}

export interface JoinQueueInput {
  queueType?: unknown;
  agentId?: unknown;
  gameIdOrSlug?: unknown;
}

export interface LeaveQueueInput {
  queueType?: unknown;
}

export interface ListOpenGamesInput {
  limit?: unknown;
}

export interface QueueAgentEntry {
  agent: AgentSummary;
  joinedAt?: string;
}

export interface DailyFreeQueueStatusRead {
  schemaVersion: 1;
  queue: {
    queueType: "daily-free";
    displayName: "Daily Free";
    status: "queued" | "not-queued";
    count: number;
    selectionMethod: "random-draw";
    estimatedDrawAt: string;
    entry: QueueAgentEntry | null;
  };
  latestGame: {
    id: string;
    slug?: string;
    status: GameStatus;
    createdAt: string;
  } | null;
}

export interface QueueMutationRead {
  schemaVersion: 1;
  ok: true;
  message: string;
  queue: {
    queueType: QueueType;
    displayName: string;
    status: "queued" | "already-queued" | "not-queued" | "left-queue" | "joined-open-game";
    joinedAt?: string;
    estimatedDrawAt?: string;
    selectionMethod?: "random-draw";
  };
  agent?: AgentSummary;
  game?: OpenGameSummary;
}

export interface OpenGameSummary {
  id: string;
  slug?: string;
  queueType: "open-game";
  status: "waiting";
  playerCount: number;
  slotsRemaining: number;
  minPlayers: number;
  maxPlayers: number;
  ruleset: {
    trackType: TrackType;
    modelTier: string;
    modelLabel: string;
    maxRounds: number;
    visibility: string;
    viewerMode: string;
  };
  estimatedStart: string | null;
  createdAt: string;
}

export interface OpenGamesRead {
  schemaVersion: 1;
  openGames: OpenGameSummary[];
}

type GameRow = typeof schema.games.$inferSelect;

export async function getQueueStatus(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  input: GetQueueStatusInput = {},
): Promise<DailyFreeQueueStatusRead> {
  const queueType = parseQueueType(input.queueType, "daily-free");
  if (queueType !== "daily-free") {
    throw unsupportedQueueType(queueType, SUPPORTED_STATUS_QUEUE_TYPES, "get_queue_status");
  }

  const [allEntries, userEntry, latestGame] = await Promise.all([
    db.select().from(schema.freeGameQueue),
    db
      .select()
      .from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, context.userId))
      .limit(1),
    db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        createdAt: schema.games.createdAt,
      })
      .from(schema.games)
      .where(eq(schema.games.trackType, "free"))
      .orderBy(desc(schema.games.createdAt))
      .limit(1),
  ]);

  const entry = userEntry[0]
    ? {
        agent: (await getOwnedAgent(db, {
          userId: context.userId,
          publicBaseUrl: context.publicBaseUrl,
          agentId: userEntry[0].agentProfileId,
        })).agent,
        joinedAt: userEntry[0].joinedAt,
      }
    : null;

  return {
    schemaVersion: 1,
    queue: {
      queueType: "daily-free",
      displayName: "Daily Free",
      status: entry ? "queued" : "not-queued",
      count: allEntries.length,
      selectionMethod: "random-draw",
      estimatedDrawAt: getNextDailyFreeDrawAt(),
      entry,
    },
    latestGame: latestGame[0]
      ? {
          id: latestGame[0].id,
          ...(latestGame[0].slug && { slug: latestGame[0].slug }),
          status: latestGame[0].status,
          createdAt: latestGame[0].createdAt,
        }
      : null,
  };
}

export async function joinQueue(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  input: JoinQueueInput,
): Promise<QueueMutationRead> {
  const queueType = parseQueueType(input.queueType);
  if (!SUPPORTED_JOIN_QUEUE_TYPES.includes(queueType)) {
    throw unsupportedQueueType(queueType, SUPPORTED_JOIN_QUEUE_TYPES, "join_queue");
  }
  const agentId = requiredString(input.agentId, "agentId");

  if (queueType === "open-game") {
    return joinOpenGame(db, context, agentId, requiredString(input.gameIdOrSlug, "gameIdOrSlug"));
  }
  return joinDailyFreeQueue(db, context, agentId);
}

export async function leaveQueue(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  input: LeaveQueueInput = {},
): Promise<QueueMutationRead> {
  const queueType = parseQueueType(input.queueType, "daily-free");
  if (queueType !== "daily-free") {
    throw unsupportedQueueType(queueType, SUPPORTED_LEAVE_QUEUE_TYPES, "leave_queue");
  }

  const entry = (await db
    .select()
    .from(schema.freeGameQueue)
    .where(eq(schema.freeGameQueue.userId, context.userId))
    .limit(1))[0];

  if (!entry) {
    return {
      schemaVersion: 1,
      ok: true,
      message: "You are not queued for Daily Free.",
      queue: {
        queueType: "daily-free",
        displayName: "Daily Free",
        status: "not-queued",
        estimatedDrawAt: getNextDailyFreeDrawAt(),
        selectionMethod: "random-draw",
      },
    };
  }

  await db.delete(schema.freeGameQueue).where(eq(schema.freeGameQueue.id, entry.id));
  const agent = (await getOwnedAgent(db, {
    userId: context.userId,
    publicBaseUrl: context.publicBaseUrl,
    agentId: entry.agentProfileId,
  })).agent;

  return {
    schemaVersion: 1,
    ok: true,
    message: `${agent.displayName} left the Daily Free queue.`,
    queue: {
      queueType: "daily-free",
      displayName: "Daily Free",
      status: "left-queue",
      estimatedDrawAt: getNextDailyFreeDrawAt(),
      selectionMethod: "random-draw",
    },
    agent,
  };
}

export async function listOpenGames(
  db: DrizzleDB,
  input: ListOpenGamesInput = {},
): Promise<OpenGamesRead> {
  const limit = clampLimit(input.limit, DEFAULT_OPEN_GAME_LIMIT, MAX_OPEN_GAME_LIMIT);
  const games = await db
    .select()
    .from(schema.games)
    .where(and(
      eq(schema.games.status, "waiting"),
      eq(schema.games.trackType, "custom"),
      isNull(schema.games.hiddenAt),
    ))
    .orderBy(desc(schema.games.createdAt))
    .limit(MAX_OPEN_GAME_LIMIT);

  const playerCounts = await loadPlayerCounts(db, games.map((game) => game.id));
  return {
    schemaVersion: 1,
    openGames: games
      .map((game) => openGameSummary(game, playerCounts.get(game.id) ?? 0))
      .filter((game) => game.slotsRemaining > 0)
      .slice(0, limit),
  };
}

async function joinDailyFreeQueue(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  agentId: string,
): Promise<QueueMutationRead> {
  const agent = (await getOwnedAgent(db, {
    userId: context.userId,
    publicBaseUrl: context.publicBaseUrl,
    agentId,
  })).agent;

  const existing = await getDailyFreeQueueEntry(db, context.userId);
  if (existing) {
    if (existing.agentProfileId === agentId) {
      return dailyFreeQueueRead("already-queued", `${agent.displayName} is already queued for Daily Free.`, agent, existing.joinedAt);
    }
    const existingAgent = (await getOwnedAgent(db, {
      userId: context.userId,
      publicBaseUrl: context.publicBaseUrl,
      agentId: existing.agentProfileId,
    })).agent;
    throw new QueueEnrollmentError(
      "agent_already_queued",
      `${existingAgent.displayName} is already queued for Daily Free. Leave the queue before joining with another agent.`,
      409,
      {
        queueType: "daily-free",
        queuedAgent: existingAgent,
      },
    );
  }

  const activeEnrollment = await getActiveEnrollmentForAgent(db, context.userId, agentId);
  if (activeEnrollment) {
    throw new QueueEnrollmentError(
      "agent_already_in_active_game",
      `${agent.displayName} is already enrolled in a ${activeEnrollment.status} game.`,
      409,
      {
        agent,
        activeEnrollment,
      },
    );
  }

  const id = randomUUID();
  try {
    await db.insert(schema.freeGameQueue).values({
      id,
      userId: context.userId,
      agentProfileId: agentId,
    });
  } catch (error) {
    const racedEntry = await getDailyFreeQueueEntry(db, context.userId);
    if (racedEntry) {
      if (racedEntry.agentProfileId === agentId) {
        const refreshedAgent = (await getOwnedAgent(db, {
          userId: context.userId,
          publicBaseUrl: context.publicBaseUrl,
          agentId,
        })).agent;
        return dailyFreeQueueRead("already-queued", `${refreshedAgent.displayName} is already queued for Daily Free.`, refreshedAgent, racedEntry.joinedAt);
      }
      const existingAgent = (await getOwnedAgent(db, {
        userId: context.userId,
        publicBaseUrl: context.publicBaseUrl,
        agentId: racedEntry.agentProfileId,
      })).agent;
      throw new QueueEnrollmentError(
        "agent_already_queued",
        `${existingAgent.displayName} is already queued for Daily Free. Leave the queue before joining with another agent.`,
        409,
        {
          queueType: "daily-free",
          queuedAgent: existingAgent,
        },
      );
    }
    throw error;
  }

  const entry = await getDailyFreeQueueEntry(db, context.userId);
  return dailyFreeQueueRead("queued", `${agent.displayName} joined the Daily Free queue.`, agent, entry?.joinedAt);
}

async function joinOpenGame(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  agentId: string,
  gameIdOrSlug: string,
): Promise<QueueMutationRead> {
  const agent = (await getOwnedAgent(db, {
    userId: context.userId,
    publicBaseUrl: context.publicBaseUrl,
    agentId,
  })).agent;

  const dailyEntry = await getDailyFreeQueueEntry(db, context.userId);
  if (dailyEntry?.agentProfileId === agentId) {
    throw new QueueEnrollmentError(
      "agent_already_queued",
      `${agent.displayName} is already queued for Daily Free. Leave that queue before joining an open game.`,
      409,
      {
        queueType: "daily-free",
        queuedAgent: agent,
      },
    );
  }

  const activeEnrollment = await getActiveEnrollmentForAgent(db, context.userId, agentId);
  if (activeEnrollment) {
    throw new QueueEnrollmentError(
      "agent_already_in_active_game",
      `${agent.displayName} is already enrolled in a ${activeEnrollment.status} game.`,
      409,
      {
        agent,
        activeEnrollment,
      },
    );
  }

  const game = await resolveJoinableOpenGame(db, gameIdOrSlug);
  const currentPlayers = await db
    .select()
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, game.id));

  if (currentPlayers.length >= game.maxPlayers) {
    throw new QueueEnrollmentError("queue_full", "Open game is full.", 409, {
      gameId: game.id,
      slug: game.slug,
      maxPlayers: game.maxPlayers,
    });
  }

  const normalizedJoinName = agent.displayName.trim().toLowerCase();
  const nameCollision = currentPlayers.some((player) => {
    const persona = JSON.parse(player.persona) as { name?: string };
    return persona.name?.trim().toLowerCase() === normalizedJoinName;
  });
  if (nameCollision) {
    throw new QueueEnrollmentError(
      "invalid_queue_input",
      "A player with that agent name already exists in this game.",
      409,
      { gameId: game.id, agentId },
    );
  }

  const gameConfig = JSON.parse(game.config) as Record<string, unknown>;
  const resolvedModelSelection = resolveModelSelection(
    normalizeGameModelSelection(gameConfig.modelSelection),
    typeof gameConfig.modelTier === "string" ? gameConfig.modelTier : "budget",
  );
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: game.id,
    userId: context.userId,
    agentProfileId: agentId,
    persona: JSON.stringify({
      name: agent.displayName,
      personality: agent.personalityPrompt,
      strategyHints: agent.strategyStyle,
      personaKey: agent.archetype,
    }),
    agentConfig: JSON.stringify({ model: resolvedModelSelection.modelId, temperature: 0.9 }),
  });
  await tryRefreshGameWatchStateSummary(db, game.id, "mcp_open_game_joined");

  const refreshedAgent = (await getOwnedAgent(db, {
    userId: context.userId,
    publicBaseUrl: context.publicBaseUrl,
    agentId,
  })).agent;
  const playerCounts = await loadPlayerCounts(db, [game.id]);

  return {
    schemaVersion: 1,
    ok: true,
    message: `${agent.displayName} joined open game ${game.slug ?? game.id}.`,
    queue: {
      queueType: "open-game",
      displayName: "Open Game",
      status: "joined-open-game",
    },
    agent: refreshedAgent,
    game: openGameSummary(game, playerCounts.get(game.id) ?? currentPlayers.length + 1),
  };
}

function dailyFreeQueueRead(
  status: "queued" | "already-queued",
  message: string,
  agent: AgentSummary,
  joinedAt?: string,
): QueueMutationRead {
  return {
    schemaVersion: 1,
    ok: true,
    message,
    queue: {
      queueType: "daily-free",
      displayName: "Daily Free",
      status,
      ...(joinedAt && { joinedAt }),
      estimatedDrawAt: getNextDailyFreeDrawAt(),
      selectionMethod: "random-draw",
    },
    agent,
  };
}

async function resolveJoinableOpenGame(db: DrizzleDB, gameIdOrSlug: string): Promise<GameRow> {
  const game = (await db
    .select()
    .from(schema.games)
    .where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug)))
    .limit(1))[0];

  if (!game || game.hiddenAt || game.trackType !== "custom" || game.status !== "waiting") {
    throw new QueueEnrollmentError(
      "game_not_joinable",
      "Open game is not joinable. It may have started, finished, been hidden, or not exist.",
      404,
      { gameIdOrSlug },
    );
  }
  return game;
}

async function getDailyFreeQueueEntry(db: DrizzleDB, userId: string) {
  return (await db
    .select()
    .from(schema.freeGameQueue)
    .where(eq(schema.freeGameQueue.userId, userId))
    .limit(1))[0];
}

async function getActiveEnrollmentForAgent(
  db: DrizzleDB,
  userId: string,
  agentId: string,
): Promise<{
  gameId: string;
  slug?: string;
  status: "waiting" | "in_progress";
  queueType: QueueType;
} | null> {
  const row = (await db
    .select({
      gameId: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      trackType: schema.games.trackType,
      createdAt: schema.games.createdAt,
    })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(and(
      eq(schema.gamePlayers.userId, userId),
      eq(schema.gamePlayers.agentProfileId, agentId),
      inArray(schema.games.status, ["waiting", "in_progress"]),
    ))
    .orderBy(desc(schema.games.createdAt))
    .limit(1))[0];

  if (!row || (row.status !== "waiting" && row.status !== "in_progress")) return null;
  return {
    gameId: row.gameId,
    ...(row.slug && { slug: row.slug }),
    status: row.status,
    queueType: row.trackType === "free" ? "daily-free" : "open-game",
  };
}

async function loadPlayerCounts(db: DrizzleDB, gameIds: string[]): Promise<Map<string, number>> {
  if (gameIds.length === 0) return new Map();
  const players = await db
    .select({ gameId: schema.gamePlayers.gameId })
    .from(schema.gamePlayers)
    .where(inArray(schema.gamePlayers.gameId, gameIds));
  const counts = new Map<string, number>();
  for (const player of players) {
    counts.set(player.gameId, (counts.get(player.gameId) ?? 0) + 1);
  }
  return counts;
}

function openGameSummary(game: GameRow, playerCount: number): OpenGameSummary {
  const config = JSON.parse(game.config) as Record<string, unknown>;
  return {
    id: game.id,
    ...(game.slug && { slug: game.slug }),
    queueType: "open-game",
    status: "waiting",
    playerCount,
    slotsRemaining: Math.max(0, game.maxPlayers - playerCount),
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    ruleset: {
      trackType: game.trackType,
      modelTier: typeof config.modelTier === "string" ? config.modelTier : "budget",
      modelLabel: modelLabelFromConfig(config),
      maxRounds: typeof config.maxRounds === "number" ? config.maxRounds : 10,
      visibility: typeof config.visibility === "string" ? config.visibility : "public",
      viewerMode: typeof config.viewerMode === "string" ? config.viewerMode : "speedrun",
    },
    estimatedStart: null,
    createdAt: game.createdAt,
  };
}

export function getNextDailyFreeDrawAt(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  if (now >= next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

function parseQueueType(value: unknown, fallback?: QueueType): QueueType {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw new QueueEnrollmentError(
      "invalid_queue_input",
      "queueType is required.",
      400,
      { supportedQueueTypes: SUPPORTED_JOIN_QUEUE_TYPES },
    );
  }
  if (typeof value !== "string") {
    throw new QueueEnrollmentError("invalid_queue_input", "queueType must be a string.", 400);
  }
  return value.trim() as QueueType;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new QueueEnrollmentError("invalid_queue_input", `${field} is required.`, 400, { field });
  }
  return value.trim();
}

function unsupportedQueueType(
  queueType: string,
  supported: readonly string[],
  operation: string,
): QueueEnrollmentError {
  return new QueueEnrollmentError(
    "unsupported_queue_type",
    `Queue type ${queueType} is not supported for ${operation}. Supported values: ${supported.join(", ")}.`,
    400,
    {
      queueType,
      operation,
      supportedQueueTypes: supported,
    },
  );
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
