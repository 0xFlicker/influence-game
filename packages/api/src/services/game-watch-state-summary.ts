import { asc, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import {
  getGameWatchState,
  type GameWatchState,
} from "./game-watch-state.js";

export const GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION = 2;

export type GameWatchStateSummary = Omit<GameWatchState, "players">;
export type GameWatchStateSummaryStatus = "current" | "missing" | "stale";

type SummaryRow = typeof schema.gameWatchStateSummaries.$inferSelect;
type SummaryInsert = typeof schema.gameWatchStateSummaries.$inferInsert;

export type GameWatchStateSummaryRead =
  | { status: "current"; summary: GameWatchStateSummary; row: SummaryRow }
  | { status: "stale"; row: SummaryRow }
  | { status: "missing" };

export interface GameWatchStateSummaryRefreshResult {
  ok: boolean;
  gameId: string;
  watchState?: GameWatchState;
  summary?: GameWatchStateSummary;
  error?: string;
}

export interface GameWatchStateSummaryBackfillResult {
  scanned: number;
  refreshed: number;
  skipped: number;
  failed: number;
  failures: Array<{ gameId: string; error: string }>;
}

interface FallbackGameRow {
  id: string;
  slug: string | null;
  status: GameStatus;
}

export function summarizeGameWatchState(state: GameWatchState): GameWatchStateSummary {
  const { players: _players, ...summary } = state;
  return summary;
}

export async function refreshGameWatchStateSummary(
  db: DrizzleDB,
  gameId: string,
  reason = "manual",
): Promise<GameWatchStateSummaryRefreshResult> {
  const watchState = await getGameWatchState(db, gameId);
  if (!watchState) {
    return {
      ok: false,
      gameId,
      error: "game_not_found",
    };
  }

  const summary = summarizeGameWatchState(watchState);
  await upsertGameWatchStateSummary(db, summary, reason);
  return {
    ok: true,
    gameId,
    watchState,
    summary,
  };
}

export async function tryRefreshGameWatchStateSummary(
  db: DrizzleDB,
  gameId: string,
  reason: string,
): Promise<GameWatchStateSummaryRefreshResult | null> {
  try {
    const result = await refreshGameWatchStateSummary(db, gameId, reason);
    if (!result.ok) {
      console.warn(`[game-watch-state-summary] Refresh skipped for game ${gameId} after ${reason}: ${result.error}`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[game-watch-state-summary] Refresh failed for game ${gameId} after ${reason}: ${message}`);
    return {
      ok: false,
      gameId,
      error: "refresh_failed",
    };
  }
}

export async function getGameWatchStateSummaryReadsByGameIds(
  db: DrizzleDB,
  gameIds: readonly string[],
): Promise<Map<string, GameWatchStateSummaryRead>> {
  const reads = new Map<string, GameWatchStateSummaryRead>();
  if (gameIds.length === 0) return reads;

  const rows = await db
    .select()
    .from(schema.gameWatchStateSummaries)
    .where(inArray(schema.gameWatchStateSummaries.gameId, [...gameIds]));

  for (const row of rows) {
    reads.set(row.gameId, readForRow(row));
  }
  for (const gameId of gameIds) {
    if (!reads.has(gameId)) {
      reads.set(gameId, { status: "missing" });
    }
  }
  return reads;
}

export function buildFallbackGameWatchStateSummary(
  game: FallbackGameRow,
  config: Record<string, unknown>,
): GameWatchStateSummary {
  return {
    schemaVersion: GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION,
    gameId: game.id,
    ...(game.slug && { slug: game.slug }),
    status: game.status,
    source: "pre_kernel_empty",
    currentRound: 0,
    currentPhase: fallbackPhaseFor(game.status),
    maxRounds: numberFromConfig(config.maxRounds, 10),
    eventCursor: { sequence: 0, source: "none" },
    projection: {
      availability: "unavailable",
      eventLogStatus: "empty",
      projectionStatus: "empty",
      eventCount: 0,
      trustedEventCount: 0,
      validPrefixLength: 0,
      lastTrustedSequence: 0,
      diagnostics: [],
    },
    counts: {
      totalPlayers: 0,
      alivePlayers: 0,
      eliminatedPlayers: 0,
      unknownPlayers: 0,
    },
    final: {
      status: game.status === "completed" || game.status === "cancelled" ? "final" : "not_final",
    },
  };
}

export async function backfillGameWatchStateSummaries(
  db: DrizzleDB,
  options: { force?: boolean; limit?: number } = {},
): Promise<GameWatchStateSummaryBackfillResult> {
  const gameRows = options.limit === undefined
    ? await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .orderBy(asc(schema.games.createdAt), asc(schema.games.id))
    : await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .orderBy(asc(schema.games.createdAt), asc(schema.games.id))
      .limit(Math.max(0, options.limit));
  const existing = await getRawSummaryRowsByGameIds(db, gameRows.map((game) => game.id));
  const eventHeads = await getEventHeadSequencesByGameIds(db, gameRows.map((game) => game.id));
  const result: GameWatchStateSummaryBackfillResult = {
    scanned: gameRows.length,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const game of gameRows) {
    const existingRow = existing.get(game.id);
    const eventHeadSequence = eventHeads.get(game.id) ?? 0;
    if (
      !options.force
      && existingRow?.schemaVersion === GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION
      && existingRow.eventCursorSequence >= eventHeadSequence
    ) {
      result.skipped += 1;
      continue;
    }

    try {
      const refresh = await refreshGameWatchStateSummary(db, game.id, "backfill");
      if (refresh.ok) {
        result.refreshed += 1;
      } else {
        result.failed += 1;
        result.failures.push({ gameId: game.id, error: refresh.error ?? "unknown_error" });
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        gameId: game.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function readForRow(row: SummaryRow): GameWatchStateSummaryRead {
  if (row.schemaVersion !== GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION) {
    return { status: "stale", row };
  }
  return {
    status: "current",
    row,
    summary: summaryFromRow(row),
  };
}

function summaryFromRow(row: SummaryRow): GameWatchStateSummary {
  const finalWinner = row.winnerId && row.winnerName && row.winnerSource
    ? {
        id: row.winnerId,
        name: row.winnerName,
        ...(row.winnerMethod && { method: row.winnerMethod }),
        source: row.winnerSource,
      }
    : undefined;
  const topLevelWinner = row.winnerId && row.winnerName
    ? {
        id: row.winnerId,
        name: row.winnerName,
        ...(row.winnerMethod && { method: row.winnerMethod }),
      }
    : undefined;

  return {
    schemaVersion: GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION,
    gameId: row.gameId,
    ...(row.slug && { slug: row.slug }),
    status: row.status,
    source: row.source,
    currentRound: row.currentRound,
    currentPhase: row.currentPhase,
    maxRounds: row.maxRounds,
    eventCursor: {
      sequence: row.eventCursorSequence,
      source: row.eventCursorSource,
      ...(row.eventCursorEventType && { eventType: row.eventCursorEventType }),
      ...(row.eventCursorCreatedAt && { createdAt: row.eventCursorCreatedAt }),
    },
    projection: {
      availability: row.projectionAvailability,
      eventLogStatus: row.projectionEventLogStatus,
      projectionStatus: row.projectionStatus,
      eventCount: row.projectionEventCount,
      trustedEventCount: row.projectionTrustedEventCount,
      validPrefixLength: row.projectionValidPrefixLength,
      lastTrustedSequence: row.projectionLastTrustedSequence,
      ...(row.projectionFirstInvalidSequence !== null && {
        firstInvalidSequence: row.projectionFirstInvalidSequence,
      }),
      ...(row.projectionPersistedHead && { persistedHead: row.projectionPersistedHead }),
      diagnostics: diagnosticsFromRow(row.projectionDiagnostics),
    },
    counts: {
      totalPlayers: row.totalPlayers,
      alivePlayers: row.alivePlayers,
      eliminatedPlayers: row.eliminatedPlayers,
      unknownPlayers: row.unknownPlayers,
    },
    final: {
      status: row.finalStatus,
      ...(finalWinner && { winner: finalWinner }),
      ...(row.roundsPlayed !== null && { roundsPlayed: row.roundsPlayed }),
    },
    ...(topLevelWinner && { winner: topLevelWinner }),
  };
}

async function upsertGameWatchStateSummary(
  db: DrizzleDB,
  summary: GameWatchStateSummary,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const values = insertValuesFromSummary(summary, reason, now);
  const { gameId: _gameId, createdAt: _createdAt, ...updateValues } = values;
  await db
    .insert(schema.gameWatchStateSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: schema.gameWatchStateSummaries.gameId,
      set: updateValues,
    });
}

function insertValuesFromSummary(
  summary: GameWatchStateSummary,
  reason: string,
  now: string,
): SummaryInsert {
  const finalWinner = summary.final.winner;
  return {
    gameId: summary.gameId,
    slug: summary.slug ?? null,
    schemaVersion: GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION,
    status: summary.status,
    source: summary.source,
    currentRound: summary.currentRound,
    currentPhase: summary.currentPhase,
    maxRounds: summary.maxRounds,
    totalPlayers: summary.counts.totalPlayers,
    alivePlayers: summary.counts.alivePlayers,
    eliminatedPlayers: summary.counts.eliminatedPlayers,
    unknownPlayers: summary.counts.unknownPlayers,
    eventCursorSequence: summary.eventCursor.sequence,
    eventCursorSource: summary.eventCursor.source,
    eventCursorEventType: summary.eventCursor.eventType ?? null,
    eventCursorCreatedAt: summary.eventCursor.createdAt ?? null,
    projectionAvailability: summary.projection.availability,
    projectionEventLogStatus: summary.projection.eventLogStatus,
    projectionStatus: summary.projection.projectionStatus,
    projectionEventCount: summary.projection.eventCount,
    projectionTrustedEventCount: summary.projection.trustedEventCount,
    projectionValidPrefixLength: summary.projection.validPrefixLength,
    projectionLastTrustedSequence: summary.projection.lastTrustedSequence,
    projectionFirstInvalidSequence: summary.projection.firstInvalidSequence ?? null,
    projectionPersistedHead: summary.projection.persistedHead ?? null,
    projectionDiagnostics: summary.projection.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    finalStatus: summary.final.status,
    winnerId: finalWinner?.id ?? summary.winner?.id ?? null,
    winnerName: finalWinner?.name ?? summary.winner?.name ?? null,
    winnerMethod: finalWinner?.method ?? summary.winner?.method ?? null,
    winnerSource: finalWinner?.source ?? null,
    roundsPlayed: summary.final.roundsPlayed ?? null,
    lastRefreshReason: reason,
    refreshedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function getRawSummaryRowsByGameIds(
  db: DrizzleDB,
  gameIds: readonly string[],
): Promise<Map<string, SummaryRow>> {
  const rowsByGameId = new Map<string, SummaryRow>();
  if (gameIds.length === 0) return rowsByGameId;
  const rows = await db
    .select()
    .from(schema.gameWatchStateSummaries)
    .where(inArray(schema.gameWatchStateSummaries.gameId, [...gameIds]));
  for (const row of rows) {
    rowsByGameId.set(row.gameId, row);
  }
  return rowsByGameId;
}

async function getEventHeadSequencesByGameIds(
  db: DrizzleDB,
  gameIds: readonly string[],
): Promise<Map<string, number>> {
  const headsByGameId = new Map<string, number>();
  if (gameIds.length === 0) return headsByGameId;
  const rows = await db
    .select({
      gameId: schema.gameEvents.gameId,
      maxSequence: sql<number>`coalesce(max(${schema.gameEvents.sequence}), 0)::int`,
    })
    .from(schema.gameEvents)
    .where(inArray(schema.gameEvents.gameId, [...gameIds]))
    .groupBy(schema.gameEvents.gameId);
  for (const row of rows) {
    headsByGameId.set(row.gameId, row.maxSequence);
  }
  return headsByGameId;
}

function fallbackPhaseFor(status: GameStatus): string {
  if (status === "completed" || status === "cancelled") return "END";
  if (status === "suspended") return "SUSPENDED";
  return "INIT";
}

function numberFromConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function diagnosticsFromRow(
  diagnostics: SummaryRow["projectionDiagnostics"],
): GameWatchStateSummary["projection"]["diagnostics"] {
  return diagnostics.map((diagnostic) => {
    const code = typeof diagnostic.code === "string"
      ? diagnostic.code as GameWatchStateSummary["projection"]["diagnostics"][number]["code"]
      : "projection_replay_failed";
    const message = typeof diagnostic.message === "string"
      ? diagnostic.message
      : "The persisted projection could not replay the trusted event prefix.";
    return {
      code,
      severity: "error",
      message,
      ...(typeof diagnostic.sequence === "number" && { sequence: diagnostic.sequence }),
      ...(typeof diagnostic.eventType === "string" && { eventType: diagnostic.eventType }),
    };
  });
}
