import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { preparePendingCompletionSettlementsOnStartup } from "../services/game-completion-settlement.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { suspendOrphanedInProgressGamesOnStartup } from "../services/startup-orphaned-games.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("startup orphaned game cleanup", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("returns recent and old exact zero-event owners to waiting", async () => {
    const now = new Date("2026-06-29T19:00:30.000Z");
    const fixtures = [
      { id: "old-zero-event-orphan", startedAt: "2026-06-28T19:00:00.000Z" },
      { id: "recent-zero-event-orphan", startedAt: "2026-06-29T19:00:00.000Z" },
    ];
    const ownerEpochs = new Map<string, string>();
    for (const fixture of fixtures) {
      const gameId = await insertGame(db, { id: fixture.id, status: "in_progress" });
      ownerEpochs.set(gameId, await insertOwner(db, gameId, { status: "active" }));
      await db.update(schema.games).set({ startedAt: fixture.startedAt })
        .where(eq(schema.games.id, gameId));
    }

    const result = await suspendOrphanedInProgressGamesOnStartup(db, { now });

    expect(result).toEqual({
      scanned: 2,
      returnedToWaiting: [
        {
          gameId: "old-zero-event-orphan",
          ownerEpoch: ownerEpochs.get("old-zero-event-orphan")!,
          startedAt: "2026-06-28T19:00:00.000Z",
          ageMs: 86_430_000,
          rosterDisposition: "reconciled",
        },
        {
          gameId: "recent-zero-event-orphan",
          ownerEpoch: ownerEpochs.get("recent-zero-event-orphan")!,
          startedAt: "2026-06-29T19:00:00.000Z",
          ageMs: 30_000,
          rosterDisposition: "reconciled",
        },
      ],
      repairRequired: [],
      suspended: [],
    });

    const games = await db.select({ id: schema.games.id, status: schema.games.status })
      .from(schema.games);
    expect(games.every((game) => game.status === "waiting")).toBeTrue();
    const owners = await db.select({
      status: schema.gameRunOwners.status,
      failureReason: schema.gameRunOwners.failureReason,
    }).from(schema.gameRunOwners);
    expect(owners.every((owner) => owner.status === "closed")).toBeTrue();
    expect(owners.every((owner) => owner.failureReason === "API process restarted before gameplay began"))
      .toBeTrue();
  });

  test("reports waiting-roster repair without undoing authoritative teardown", async () => {
    const gameId = await insertGame(db, {
      id: "zero-event-roster-repair",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId, { status: "active" });
    await db.insert(schema.gamePlayers).values({
      id: "invalid-persona-seat",
      gameId,
      persona: "{",
      agentConfig: "{}",
    });

    const result = await suspendOrphanedInProgressGamesOnStartup(db);

    expect(result).toMatchObject({
      scanned: 1,
      returnedToWaiting: [],
      repairRequired: [{
        gameId,
        ownerEpoch,
        rosterDisposition: "repair_required",
        reconciliationError: { reason: "name_conflict" },
      }],
      suspended: [],
    });
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]?.status)
      .toBe("waiting");
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]?.status).toBe("closed");
  });

  test("suspends a positive owner head even when the event log is empty", async () => {
    const gameId = await insertGame(db, {
      id: "positive-owner-head-orphan",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId, {
      status: "active",
      lastPersistedEventSequence: 1,
    });

    const result = await suspendOrphanedInProgressGamesOnStartup(db);

    expect(result.suspended).toEqual([expect.objectContaining({
      gameId,
      reason: "owner_event_head_disagreement",
      details: expect.objectContaining({ ownerHead: 1, eventCount: 0, eventHead: 0 }),
    })]);
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]?.status)
      .toBe("suspended");
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]).toMatchObject({
      status: "expired",
      failureReason: "startup_orphaned",
      failureDetails: expect.objectContaining({ reason: "owner_event_head_disagreement" }),
    });
  });

  test("suspends an accepted durable event instead of resetting gameplay", async () => {
    const gameId = await insertGame(db, { id: "durable-event-orphan", status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId, { status: "active" });
    const events = createCanonicalEventFixture(gameId);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
    const finalEvent = events.at(-1);
    if (!finalEvent) throw new Error("Expected canonical event fixture");
    await db.update(schema.gameRunOwners)
      .set({ lastPersistedEventSequence: finalEvent.sequence })
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));

    const result = await suspendOrphanedInProgressGamesOnStartup(db);

    expect(result.suspended).toEqual([expect.objectContaining({
      gameId,
      reason: "durable_event_present",
      details: expect.objectContaining({
        ownerHead: finalEvent.sequence,
        eventCount: events.length,
        eventHead: finalEvent.sequence,
      }),
    })]);
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]?.status)
      .toBe("suspended");
  });

  test("suspends missing ownership as ambiguous startup evidence", async () => {
    const gameId = await insertGame(db, { id: "missing-owner-orphan", status: "in_progress" });

    const result = await suspendOrphanedInProgressGamesOnStartup(db);

    expect(result.suspended).toEqual([expect.objectContaining({
      gameId,
      reason: "active_owner_missing",
      details: expect.objectContaining({ activeOwnerCount: 0 }),
    })]);
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]?.status)
      .toBe("suspended");
  });

  test("suspends sealed completion for startup preparation without redriving it", async () => {
    const gameId = await insertGame(db, {
      id: "sealed-completion-startup-orphan",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId, { status: "active" });
    const events = createCanonicalEventFixture(gameId);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
    const finalEvent = events.at(-1);
    if (!finalEvent) throw new Error("Expected canonical event fixture");
    await db.update(schema.gameRunOwners)
      .set({ lastPersistedEventSequence: finalEvent.sequence })
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
    await db.insert(schema.gameCompletionSettlements).values({
      id: `settlement-${gameId}`,
      gameId,
      ownerEpoch,
      finalEventSequence: finalEvent.sequence,
      finalEventHash: hashCanonicalEvent(finalEvent),
      payload: {},
      payloadHash: `sha256:${"a".repeat(64)}`,
      state: "pending",
    });

    const result = await suspendOrphanedInProgressGamesOnStartup(db);

    expect(result.suspended).toEqual([expect.objectContaining({
      gameId,
      reason: "sealed_completion_present",
      details: expect.objectContaining({ settlementState: "pending" }),
    })]);
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId)))[0]).toMatchObject({
      state: "pending",
      retryReadyAt: null,
    });

    expect(await preparePendingCompletionSettlementsOnStartup(db)).toEqual({
      scanned: 1,
      readyGameIds: [gameId],
    });
    expect((await db.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId)))[0]?.retryReadyAt).not.toBeNull();
  });
});
