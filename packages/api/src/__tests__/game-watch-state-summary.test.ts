import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Phase, type CanonicalGameEvent } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import {
  GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION,
  backfillGameWatchStateSummaries,
  buildFallbackGameWatchStateSummary,
  getGameWatchStateSummaryReadsByGameIds,
  refreshGameWatchStateSummary,
} from "../services/game-watch-state-summary.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createResolvedRoundCanonicalEventFixture,
  insertGame,
  insertOwner,
  withJuryWinner,
} from "./durable-run-test-utils.js";

describe("GameWatchState summaries", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("uses schema v4 so persisted v3 summaries are rebuilt", async () => {
    expect(GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION).toBe(4);
    const gameId = await insertGame(db, {
      slug: "summary-v3-rebuild",
      status: "waiting",
      config: gameConfig(),
    });
    await refreshGameWatchStateSummary(db, gameId, "test");
    await db.update(schema.gameWatchStateSummaries)
      .set({ schemaVersion: 3 })
      .where(eq(schema.gameWatchStateSummaries.gameId, gameId));

    expect((await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId)?.status)
      .toBe("stale");
    expect(await backfillGameWatchStateSummaries(db)).toMatchObject({
      scanned: 1,
      refreshed: 1,
      skipped: 0,
      failed: 0,
    });
    expect((await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId)?.status)
      .toBe("current");
  });

  test("refreshes a durable projection summary row", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-live-projection",
      status: "in_progress",
      config: gameConfig({ maxRounds: 7 }),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = advanceToRoundTwo(createResolvedRoundCanonicalEventFixture(gameId));
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const refresh = await refreshGameWatchStateSummary(db, gameId, "test");
    const reads = await getGameWatchStateSummaryReadsByGameIds(db, [gameId]);
    const read = reads.get(gameId);

    expect(refresh.ok).toBe(true);
    expect(read?.status).toBe("current");
    if (read?.status !== "current") throw new Error("Expected current summary");
    expect(read.summary).toMatchObject({
      schemaVersion: GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION,
      gameId,
      slug: "summary-live-projection",
      source: "durable_projection",
      status: "in_progress",
      currentRound: 2,
      currentPhase: "LOBBY",
      counts: {
        totalPlayers: 4,
        alivePlayers: 3,
        eliminatedPlayers: 1,
      },
      eventCursor: {
        sequence: events.length,
        source: "trusted_prefix",
      },
      projection: {
        availability: "available",
        projectionStatus: "complete",
        trustedEventCount: events.length,
      },
    });
  });

  test("refreshes an older terminal fallback summary", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-terminal-fallback",
      status: "completed",
      config: gameConfig({ maxRounds: 9 }),
    });
    await insertFixturePlayers(db, gameId);
    await insertResult(db, gameId, { winnerId: "mira", roundsPlayed: 4 });

    await refreshGameWatchStateSummary(db, gameId, "test");
    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);

    expect(read?.status).toBe("current");
    if (read?.status !== "current") throw new Error("Expected current summary");
    expect(read.summary).toMatchObject({
      source: "best_available_terminal_result",
      currentRound: 4,
      currentPhase: "END",
      projection: {
        availability: "unavailable",
        eventLogStatus: "empty",
      },
      final: {
        status: "final",
        winner: {
          id: "mira",
          name: "Mira",
          source: "best_available_terminal_result",
        },
      },
      winner: {
        id: "mira",
        name: "Mira",
      },
    });
  });

  test("persists no final or winner fields for a suspended terminal projection", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-pending-completion-settlement",
      status: "suspended",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = withJuryWinner(createCanonicalEventFixture(gameId), "mira");
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    await db.update(schema.gameRunOwners).set({
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "completion_settlement_transient_failure",
    }).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));

    await refreshGameWatchStateSummary(db, gameId, "completion_settlement_transient_failure");
    const row = (await db.select()
      .from(schema.gameWatchStateSummaries)
      .where(eq(schema.gameWatchStateSummaries.gameId, gameId)))[0];
    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);

    expect(row).toMatchObject({
      status: "suspended",
      finalStatus: "not_final",
      winnerId: null,
      winnerName: null,
      roundsPlayed: null,
    });
    expect(read?.status).toBe("current");
    if (read?.status !== "current") throw new Error("Expected current summary");
    expect(read.summary.final).toEqual({ status: "not_final" });
    expect(read.summary.winner).toBeUndefined();
  });

  test("stores only viewer-safe summary data", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-private-stripped",
      status: "in_progress",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const events = withPrivatePointers(createCanonicalEventFixture(gameId));
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    await refreshGameWatchStateSummary(db, gameId, "test");
    const rows = await db
      .select()
      .from(schema.gameWatchStateSummaries)
      .where(eq(schema.gameWatchStateSummaries.gameId, gameId));
    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);
    const serialized = JSON.stringify({ row: rows[0], read });

    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("canonicalPayload");
    expect(serialized).not.toContain("privateTrace");
    expect(serialized).not.toContain("thinking");
    expect(serialized).not.toContain("reasoningContext");
    expect(serialized).not.toContain("ownerEpoch");
    expect(serialized).not.toContain("eventHash");
  });

  test("flags stale schema versions without mapping them as current", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-stale-version",
      status: "waiting",
      config: gameConfig(),
    });
    await refreshGameWatchStateSummary(db, gameId, "test");
    await db.update(schema.gameWatchStateSummaries)
      .set({ schemaVersion: GAME_WATCH_STATE_SUMMARY_SCHEMA_VERSION + 1 })
      .where(eq(schema.gameWatchStateSummaries.gameId, gameId));

    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);

    expect(read?.status).toBe("stale");
  });

  test("returns missing summaries separately from viewer-safe fallback construction", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-missing",
      status: "suspended",
      config: gameConfig({ maxRounds: 12 }),
    });

    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);
    const fallback = buildFallbackGameWatchStateSummary({
      id: gameId,
      slug: "summary-missing",
      status: "suspended",
    }, gameConfig({ maxRounds: 12 }));

    expect(read?.status).toBe("missing");
    expect(fallback).toMatchObject({
      source: "pre_kernel_empty",
      currentPhase: "SUSPENDED",
      maxRounds: 12,
      projection: {
        availability: "unavailable",
      },
    });
  });

  test("backfills missing summaries and skips current rows", async () => {
    const completedGameId = await insertGame(db, {
      slug: "summary-backfill-completed",
      status: "completed",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, completedGameId);
    await insertResult(db, completedGameId, { winnerId: "atlas", roundsPlayed: 3 });
    const currentGameId = await insertGame(db, {
      slug: "summary-backfill-current",
      status: "waiting",
      config: gameConfig(),
    });
    await refreshGameWatchStateSummary(db, currentGameId, "test");

    const result = await backfillGameWatchStateSummaries(db);
    const completedRead = (await getGameWatchStateSummaryReadsByGameIds(db, [completedGameId])).get(completedGameId);

    expect(result).toMatchObject({
      scanned: 2,
      refreshed: 1,
      skipped: 1,
      failed: 0,
    });
    expect(completedRead?.status).toBe("current");
    if (completedRead?.status !== "current") throw new Error("Expected current summary");
    expect(completedRead.summary.source).toBe("best_available_terminal_result");
  });

  test("backfills current-schema summaries that are behind the durable event head", async () => {
    const gameId = await insertGame(db, {
      slug: "summary-backfill-behind-head",
      status: "in_progress",
      config: gameConfig(),
    });
    await insertFixturePlayers(db, gameId);
    const ownerEpoch = await insertOwner(db, gameId);
    const firstRoundEvents = createResolvedRoundCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events: firstRoundEvents });
    await refreshGameWatchStateSummary(db, gameId, "test");

    const secondRoundEvent = advanceToRoundTwo(firstRoundEvents).slice(firstRoundEvents.length);
    await appendGameEvents(db, { gameId, ownerEpoch, events: secondRoundEvent });

    const result = await backfillGameWatchStateSummaries(db);
    const read = (await getGameWatchStateSummaryReadsByGameIds(db, [gameId])).get(gameId);

    expect(result).toMatchObject({
      scanned: 1,
      refreshed: 1,
      skipped: 0,
      failed: 0,
    });
    expect(read?.status).toBe("current");
    if (read?.status !== "current") throw new Error("Expected current summary");
    expect(read.summary.eventCursor.sequence).toBe(firstRoundEvents.length + secondRoundEvent.length);
    expect(read.summary.currentRound).toBe(2);
  });
});

function gameConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    maxRounds: 10,
    modelTier: "budget",
    visibility: "public",
    viewerMode: "speedrun",
    ...overrides,
  };
}

async function insertFixturePlayers(
  db: DrizzleDB,
  gameId: string,
  ids: readonly string[] = ["atlas", "echo", "mira", "nyx"],
): Promise<void> {
  await db.insert(schema.gamePlayers).values(ids.map((id) => ({
    id,
    gameId,
    persona: JSON.stringify({
      name: titleCase(id),
      personality: `${id} persona`,
      personaKey: "strategic",
    }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
}

async function insertResult(
  db: DrizzleDB,
  gameId: string,
  params: {
    winnerId: string | null;
    roundsPlayed: number;
  },
): Promise<void> {
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: params.winnerId,
    roundsPlayed: params.roundsPlayed,
    tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  });
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function advanceToRoundTwo(events: readonly CanonicalGameEvent[]): readonly CanonicalGameEvent[] {
  const last = events.at(-1);
  if (!last) throw new Error("Expected fixture events");
  return [
    ...events,
    {
      sequence: last.sequence + 1,
      gameId: last.gameId,
      round: 2,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-20T00:00:00.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 2 },
    },
  ];
}

function withPrivatePointers(events: readonly CanonicalGameEvent[]): readonly CanonicalGameEvent[] {
  return events.map((event) => ({
    ...event,
    sourcePointers: [
      {
        kind: "agent_turn",
        action: "vote",
        round: event.round,
        phase: event.phase ?? Phase.INIT,
        actorId: "atlas",
      },
    ],
  }));
}
