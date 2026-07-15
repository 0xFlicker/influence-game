import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus, TrackType } from "../db/schema.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import {
  AgentProfileManagementError,
  getOwnedAgent,
  type AgentProfileManagementContext,
  type AgentSummary,
} from "./agent-profile-management.js";
import { tryRefreshGameWatchStateSummary } from "./game-watch-state-summary.js";
import { getActiveSeason } from "./seasons.js";
import {
  admitOwnedSeatInTransaction,
  OwnedSeatProjectionError,
} from "./owned-seat-projection.js";

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
  | "no_active_season"
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
  schemaVersion: 2;
  queue: {
    queueType: "daily-free";
    displayName: "Daily Free";
    status: "queued" | "not-queued";
    count: number;
    selectionMethod: "random-draw";
    estimatedDrawAt: string;
    entry: QueueAgentEntry | null;
    eligibility: "eligible" | "temporarily-ineligible" | "absent";
  };
  promptEligible: boolean;
  relevantGame: {
    id: string;
    slug: string;
    status: "waiting" | "in_progress" | "suspended";
  } | null;
  latestGame: {
    id: string;
    slug: string;
    status: GameStatus;
    seasonId: string | null;
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
    status: "queued" | "switched" | "already-queued" | "not-queued" | "left-queue" | "joined-open-game";
    joinedAt?: string;
    estimatedDrawAt?: string;
    selectionMethod?: "random-draw";
    entryId?: string;
  };
  agent?: AgentSummary;
  game?: OpenGameSummary;
}

export interface OpenGameSummary {
  id: string;
  slug: string;
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
type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type DatabaseExecutor = DrizzleDB | DrizzleTransaction;

export async function getQueueStatus(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
  input: GetQueueStatusInput = {},
): Promise<DailyFreeQueueStatusRead> {
  const queueType = parseQueueType(input.queueType, "daily-free");
  if (queueType !== "daily-free") {
    throw unsupportedQueueType(queueType, SUPPORTED_STATUS_QUEUE_TYPES, "get_queue_status");
  }

  const [queueCount, userEntry, latestGame, activeSeason, relevantGame] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.freeGameQueue),
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
        seasonId: schema.games.seasonId,
        createdAt: schema.games.createdAt,
      })
      .from(schema.games)
      .where(eq(schema.games.trackType, "free"))
      .orderBy(desc(schema.games.createdAt))
      .limit(1),
    getActiveSeason(db),
    getRelevantDailyFreeGame(db, context.userId),
  ]);

  const suppression = activeSeason
    ? (await db.select().from(schema.freeQueuePromptSuppressions).where(and(
        eq(schema.freeQueuePromptSuppressions.userId, context.userId),
        eq(schema.freeQueuePromptSuppressions.seasonId, activeSeason.id),
      )).limit(1))[0]
    : null;
  const suppressionActive = Boolean(suppression && (
    suppression.suppressedUntil === null || Date.parse(suppression.suppressedUntil) > Date.now()
  ));

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
    schemaVersion: 2,
    queue: {
      queueType: "daily-free",
      displayName: "Daily Free",
      status: entry ? "queued" : "not-queued",
      count: queueCount[0]?.count ?? 0,
      selectionMethod: "random-draw",
      estimatedDrawAt: getNextDailyFreeDrawAt(),
      entry,
      eligibility: !entry ? "absent" : relevantGame ? "temporarily-ineligible" : "eligible",
    },
    promptEligible: Boolean(activeSeason && !entry && !suppressionActive),
    relevantGame,
    latestGame: latestGame[0]
      ? {
          id: latestGame[0].id,
          slug: latestGame[0].slug,
          status: latestGame[0].status,
          seasonId: latestGame[0].seasonId,
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

  const result = await db.transaction(async (tx) => {
    await acquireDailyFreeLocks(tx);
    const current = await getDailyFreeQueueEntry(tx, context.userId);
    if (!current) return { entry: null, agent: null };
    const season = await getActiveSeason(tx);
    await tx.delete(schema.freeGameQueue).where(eq(schema.freeGameQueue.userId, context.userId));
    if (season) {
      await upsertPromptSuppression(tx, context.userId, season.id, "left_queue", null);
    }
    const agent = (await getOwnedAgent(tx, {
      userId: context.userId,
      publicBaseUrl: context.publicBaseUrl,
      agentId: current.agentProfileId,
    })).agent;
    return { entry: current, agent };
  });
  const { entry } = result;
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
  const agent = result.agent!;

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

export async function deferDailyFreePrompt(
  db: DrizzleDB,
  context: QueueEnrollmentContext,
): Promise<{ ok: true; suppressedUntil: string }> {
  const suppressedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await db.transaction(async (tx) => {
    await acquireDailyFreeLocks(tx);
    const season = await requireActiveFreeSeason(tx);
    await upsertPromptSuppression(tx, context.userId, season.id, "maybe_later", suppressedUntil);
  });
  return { ok: true, suppressedUntil };
}

export async function removeStandingDailyAgentByAdmin(
  db: DrizzleDB,
  userId: string,
): Promise<{ removed: boolean }> {
  return db.transaction(async (tx) => {
    await acquireDailyFreeLocks(tx);
    const season = await requireActiveFreeSeason(tx);
    const entry = await getDailyFreeQueueEntry(tx, userId);
    await tx.delete(schema.freeGameQueue).where(eq(schema.freeGameQueue.userId, userId));
    await upsertPromptSuppression(tx, userId, season.id, "admin_removed", null);
    return { removed: Boolean(entry) };
  });
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

  const result = await db.transaction(async (tx) => {
    await acquireDailyFreeLocks(tx);
    await requireActiveFreeSeason(tx);
    await requireOwnedDailyFreeAgent(tx, context.userId, agentId);
    const existing = await getDailyFreeQueueEntry(tx, context.userId);
    if (existing?.agentProfileId === agentId) return { status: "already-queued" as const, entry: existing };
    if (existing) {
      const updated = (await tx.update(schema.freeGameQueue).set({ agentProfileId: agentId })
        .where(eq(schema.freeGameQueue.id, existing.id)).returning())[0]!;
      await tx.delete(schema.freeQueuePromptSuppressions)
        .where(eq(schema.freeQueuePromptSuppressions.userId, context.userId));
      return { status: "switched" as const, entry: updated };
    }
    const inserted = (await tx.insert(schema.freeGameQueue).values({
      id: randomUUID(),
      userId: context.userId,
      agentProfileId: agentId,
    }).returning())[0]!;
    await tx.delete(schema.freeQueuePromptSuppressions)
      .where(eq(schema.freeQueuePromptSuppressions.userId, context.userId));
    return { status: "queued" as const, entry: inserted };
  });
  const message = result.status === "already-queued"
    ? `${agent.displayName} is already queued for Daily Free.`
    : result.status === "switched"
      ? `${agent.displayName} is now your Standing Daily Agent.`
      : `${agent.displayName} joined the Daily Free queue.`;
  return dailyFreeQueueRead(result.status, message, agent, result.entry.id, result.entry.joinedAt);
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
  let admission: Awaited<ReturnType<typeof admitOwnedSeatInTransaction>>;
  try {
    admission = await db.transaction(async (tx) => {
      // Standing membership and open-game admission must not pass each other.
      // These advisory locks remain outermost; the roster order is game then
      // season/profile inside the shared admission authority.
      await acquireDailyFreeLocks(tx);
      const game = await resolveJoinableOpenGame(tx, gameIdOrSlug);
      const admitted = await admitOwnedSeatInTransaction(tx, {
        gameId: game.id,
        userId: context.userId,
        agentProfileId: agentId,
      });
      if (admitted.game.hiddenAt || admitted.game.trackType !== "custom") {
        throw new QueueEnrollmentError(
          "game_not_joinable",
          "Open game is not joinable. It may have started, finished, been hidden, or not exist.",
          404,
        );
      }
      const dailyEntry = await getDailyFreeQueueEntry(tx, context.userId);
      if (dailyEntry?.agentProfileId === agentId) {
        throw new QueueEnrollmentError(
          "agent_already_queued",
          `${agent.displayName} is already queued for Daily Free. Leave that queue before joining an open game.`,
          409,
          { queueType: "daily-free", queuedAgent: agent },
        );
      }
      const activeEnrollment = await getActiveEnrollmentForAgent(
        tx,
        context.userId,
        agentId,
        admitted.game.id,
      );
      if (activeEnrollment) {
        throw new QueueEnrollmentError(
          "agent_already_in_active_game",
          `${agent.displayName} is already enrolled in a ${activeEnrollment.status} game.`,
          409,
          { agent, activeEnrollment },
        );
      }
      return admitted;
    });
  } catch (error) {
    if (error instanceof OwnedSeatProjectionError) throw mapOpenGameProjectionError(error, agentId);
    throw error;
  }
  const game = admission.game;
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
    message: `${agent.displayName} joined open game ${game.slug}.`,
    queue: {
      queueType: "open-game",
      displayName: "Open Game",
      status: "joined-open-game",
    },
    agent: refreshedAgent,
    game: openGameSummary(game, playerCounts.get(game.id) ?? 1),
  };
}

function dailyFreeQueueRead(
  status: "queued" | "switched" | "already-queued",
  message: string,
  agent: AgentSummary,
  entryId: string,
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
      entryId,
      estimatedDrawAt: getNextDailyFreeDrawAt(),
      selectionMethod: "random-draw",
    },
    agent,
  };
}

async function resolveJoinableOpenGame(db: DatabaseExecutor, gameIdOrSlug: string): Promise<GameRow> {
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

async function getDailyFreeQueueEntry(db: DatabaseExecutor, userId: string) {
  return (await db
    .select()
    .from(schema.freeGameQueue)
    .where(eq(schema.freeGameQueue.userId, userId))
    .limit(1))[0];
}

export async function getRelevantDailyFreeGame(
  db: DatabaseExecutor,
  userId: string,
): Promise<DailyFreeQueueStatusRead["relevantGame"]> {
  const row = (await db.select({
    id: schema.games.id,
    slug: schema.games.slug,
    status: schema.games.status,
    createdAt: schema.games.createdAt,
  }).from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(and(
      eq(schema.gamePlayers.userId, userId),
      eq(schema.games.trackType, "free"),
      inArray(schema.games.status, ["waiting", "in_progress", "suspended"]),
    ))
    .orderBy(desc(schema.games.createdAt))
    .limit(1))[0];
  if (!row || !["waiting", "in_progress", "suspended"].includes(row.status)) return null;
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as "waiting" | "in_progress" | "suspended",
  };
}

export async function acquireDailyFreeLocks(tx: DrizzleTransaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence-season-free'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence-daily-free-draw'))`);
}

async function requireOwnedDailyFreeAgent(
  tx: DrizzleTransaction,
  userId: string,
  agentId: string,
): Promise<void> {
  const profile = await tx.select({ id: schema.agentProfiles.id })
    .from(schema.agentProfiles)
    .where(and(
      eq(schema.agentProfiles.id, agentId),
      eq(schema.agentProfiles.userId, userId),
    ))
    .limit(1);
  if (profile.length === 0) {
    throw new AgentProfileManagementError(
      "agent_not_found",
      "Agent not found.",
      404,
      { agentId },
    );
  }
}

async function requireActiveFreeSeason(tx: DrizzleTransaction) {
  const season = await getActiveSeason(tx);
  if (!season) {
    throw new QueueEnrollmentError(
      "no_active_season",
      "Daily Free is between seasons right now.",
      409,
    );
  }
  return season;
}

async function upsertPromptSuppression(
  tx: DrizzleTransaction,
  userId: string,
  seasonId: string,
  reason: "maybe_later" | "left_queue" | "admin_removed",
  suppressedUntil: string | null,
): Promise<void> {
  await tx.insert(schema.freeQueuePromptSuppressions).values({
    id: randomUUID(),
    userId,
    seasonId,
    reason,
    suppressedUntil,
  }).onConflictDoUpdate({
    target: schema.freeQueuePromptSuppressions.userId,
    set: { seasonId, reason, suppressedUntil, createdAt: new Date().toISOString() },
  });
}

async function getActiveEnrollmentForAgent(
  db: DatabaseExecutor,
  userId: string,
  agentId: string,
  excludeGameId?: string,
): Promise<{
  gameId: string;
  slug: string;
  status: "waiting" | "in_progress" | "suspended";
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
      inArray(schema.games.status, ["waiting", "in_progress", "suspended"]),
      ...(excludeGameId ? [ne(schema.games.id, excludeGameId)] : []),
    ))
    .orderBy(desc(schema.games.createdAt))
    .limit(1))[0];

  if (!row || (row.status !== "waiting" && row.status !== "in_progress" && row.status !== "suspended")) return null;
  return {
    gameId: row.gameId,
    slug: row.slug,
    status: row.status,
    queueType: row.trackType === "free" ? "daily-free" : "open-game",
  };
}

function mapOpenGameProjectionError(
  error: OwnedSeatProjectionError,
  agentId: string,
): QueueEnrollmentError | AgentProfileManagementError {
  if (error.reason === "profile_not_owned") {
    return new AgentProfileManagementError(
      "agent_not_found",
      "Agent not found.",
      404,
      { agentId },
    );
  }
  if (error.reason === "capacity") {
    return new QueueEnrollmentError("queue_full", "Open game is full.", 409, error.details);
  }
  if (error.reason === "name_conflict") {
    return new QueueEnrollmentError(
      "invalid_queue_input",
      "A player with that agent name already exists in this game.",
      409,
      error.details,
    );
  }
  return new QueueEnrollmentError(
    "game_not_joinable",
    "Open game is not joinable. It may have started, finished, been hidden, or not exist.",
    404,
  );
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
    slug: game.slug,
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
