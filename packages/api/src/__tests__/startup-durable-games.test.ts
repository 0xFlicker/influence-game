import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { GameExecutionStatusV1 } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { createDurableGameRunnerStore } from "../services/durable-game-runner-store.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  createCheckpointCapsule,
  enrichCapsuleForV1Candidate,
  insertCanonicalEventRows,
} from "./durable-run-test-utils.js";

describe("durable game startup adoption", () => {
  test("continues an in-progress game from its committed cursor", async () => {
    const db = await setupTestDB();
    const fixture = await insertDurableInProgressGame(db, "ready");
    await expireActiveOwner(db, fixture.gameId);
    const starts: Array<{ gameId: string; ownerEpoch: string; turnSequence: number }> = [];

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      processId: "fresh-runtime",
      start: (input) => {
        if (!input.executionState) throw new Error("expected committed execution state");
        starts.push({
          gameId: input.gameId,
          ownerEpoch: input.ownerEpoch,
          turnSequence: input.executionState.heads.turnSequence,
        });
      },
    });

    expect(result).toEqual({ scanned: 1, adopted: [fixture.gameId], skipped: [] });
    expect(starts).toEqual([{
      gameId: fixture.gameId,
      ownerEpoch: expect.any(String),
      turnSequence: 7,
    }]);
    expect(starts[0]!.ownerEpoch).not.toBe(fixture.ownerEpoch);
    const game = (await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]!;
    expect(game.status).toBe("in_progress");
    expect(game.endedAt).toBeNull();
    const owners = await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId));
    expect(owners.find((owner) => owner.ownerEpoch === fixture.ownerEpoch)?.status)
      .toBe("expired");
    expect(owners.find((owner) => owner.ownerEpoch === starts[0]!.ownerEpoch))
      .toMatchObject({ status: "active", processId: "fresh-runtime" });
  });

  test("a local construction failure relinquishes ownership without suspending", async () => {
    const db = await setupTestDB();
    const fixture = await insertDurableInProgressGame(db, "ready");
    await expireActiveOwner(db, fixture.gameId);

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      start: () => {
        throw new Error("temporary local bootstrap failure");
      },
    });

    expect(result).toMatchObject({
      scanned: 1,
      adopted: [],
      skipped: [{
        gameId: fixture.gameId,
        reason: "start_failed",
        detail: "temporary local bootstrap failure",
      }],
    });
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, fixture.gameId)))[0]?.status).toBe("in_progress");
    const owners = await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId));
    expect(owners.filter((owner) => owner.status === "active")).toHaveLength(0);
  });

  test("does not reclaim a failed start until its worker retry window opens", async () => {
    const db = await setupTestDB();
    const fixture = await insertDurableInProgressGame(db, "ready");
    await expireActiveOwner(db, fixture.gameId);
    const failures: string[] = [];
    const first = await adoptInProgressDurableGamesOnStartup(db, {
      start: () => { throw new Error("worker bootstrap unavailable"); },
      onStartFailed: (gameId) => { failures.push(gameId); },
    });
    expect(first.skipped).toEqual([{
      gameId: fixture.gameId,
      reason: "start_failed",
      detail: "worker bootstrap unavailable",
    }]);

    const second = await adoptInProgressDurableGamesOnStartup(db, {
      start: () => { throw new Error("must not claim during backoff"); },
      canAttemptStart: () => false,
    });
    expect(second).toEqual({
      scanned: 1,
      adopted: [],
      skipped: [{ gameId: fixture.gameId, reason: "start_backoff" }],
    });
    expect(failures).toEqual([fixture.gameId]);
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId)))
      .filter((owner) => owner.status === "active")).toHaveLength(0);
  });

  test("adopts the empty owner-claim frontier before execution initialization", async () => {
    const db = await setupTestDB();
    const gameId = await insertInProgressGame(db);
    const priorOwnerEpoch = randomUUID();
    await db.insert(schema.gameRunOwners).values({
      id: randomUUID(),
      gameId,
      ownerEpoch: priorOwnerEpoch,
      processId: "interrupted-starter",
      lastPersistedEventSequence: 0,
    });
    await db.insert(schema.gameTranscriptStates).values(
      initialGameTranscriptStateValues(gameId),
    );
    await expireActiveOwner(db, gameId);
    const starts: Array<{ gameId: string; ownerEpoch: string; executionState: null }> = [];

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      processId: "replacement-starter",
      start: (input) => {
        expect(input.executionState).toBeNull();
        starts.push({
          gameId: input.gameId,
          ownerEpoch: input.ownerEpoch,
          executionState: null,
        });
      },
    });

    expect(result).toEqual({ scanned: 1, adopted: [gameId], skipped: [] });
    expect(starts).toEqual([{
      gameId,
      ownerEpoch: expect.any(String),
      executionState: null,
    }]);
    const owners = await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, gameId));
    expect(owners.find((owner) => owner.ownerEpoch === priorOwnerEpoch))
      .toMatchObject({
        status: "expired",
        failureReason: "worker_lease_expired_before_initialization",
      });
    expect(owners.find((owner) => owner.ownerEpoch === starts[0]!.ownerEpoch))
      .toMatchObject({ status: "active", processId: "replacement-starter" });
  });

  test("upgrades a valid pre-logical-turn game in place without draining or changing its canonical frontier", async () => {
    const db = await setupTestDB();
    const gameId = await insertInProgressGame(db);
    await db.update(schema.games).set({
      transcriptCaptureVersion: 1,
      formalSpeechCaptureVersion: 1,
    }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values(
      initialGameTranscriptStateValues(gameId),
    );
    const events = createCanonicalEventFixture(gameId);
    const finalEvent = events.at(-1)!;
    const priorOwnerEpoch = randomUUID();
    await db.insert(schema.gameRunOwners).values({
      id: randomUUID(),
      gameId,
      ownerEpoch: priorOwnerEpoch,
      processId: "pre-logical-turn-runtime",
      lastPersistedEventSequence: events.length,
    });
    await insertCanonicalEventRows(db, gameId, priorOwnerEpoch, events);
    const capsule = enrichCapsuleForV1Candidate(
      createCheckpointCapsule(events),
      {
        ownerEpoch: priorOwnerEpoch,
        eventHeadHash: hashCanonicalEvent(finalEvent),
        actorCoordinate: "vote",
      },
    );
    expect(await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch: priorOwnerEpoch,
      checkpoint: { ...capsule, transcriptReplay: { version: 2, entries: [] } },
    })).toEqual({ ok: true });
    await expireActiveOwner(db, gameId);

    let adoptedOwnerEpoch: string | null = null;
    const result = await adoptInProgressDurableGamesOnStartup(db, {
      processId: "durable-upgrader",
      start: async (input) => {
        expect(input.executionState).toBeNull();
        expect(input.upgradeFrom).toBeDefined();
        const upgrade = input.upgradeFrom!;
        adoptedOwnerEpoch = input.ownerEpoch;
        await createDurableGameRunnerStore(db, {
          gameId,
          ownerEpoch: input.ownerEpoch,
        }).initialize({
          version: 1,
          gameId,
          xstateSnapshot: { value: "vote" },
          cursor: { version: 1, kind: "phase_enter", actor: "vote" },
          playerContinuityCapsules: (upgrade.playerContinuityCapsules ?? [])
            .map((capsule) => structuredClone(capsule)),
          houseNarrativeContinuity: upgrade.houseNarrativeContinuityCapsule,
          canonicalEvents: upgrade.canonicalEvents.map((event) => structuredClone(event)),
          transcriptEntries: upgrade.transcriptReplay.map((entry) => structuredClone(entry)),
        });
      },
    });

    expect(result).toEqual({ scanned: 1, adopted: [gameId], skipped: [] });
    expect((await db.select().from(schema.games)
      .where(eq(schema.games.id, gameId)))[0]).toMatchObject({
      status: "in_progress",
      endedAt: null,
    });
    expect(await db.select().from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId))).toHaveLength(events.length);
    expect((await db.select().from(schema.gameExecutionStates)
      .where(eq(schema.gameExecutionStates.gameId, gameId)))[0]).toMatchObject({
      ownerEpoch: adoptedOwnerEpoch,
      status: "ready",
      committedTurnSequence: 1,
      eventHeadSequence: events.length,
      publicationHeadSequence: 0,
    });
    expect(await db.select().from(schema.gameTurns)
      .where(eq(schema.gameTurns.gameId, gameId))).toHaveLength(1);
  });

  test("leaves historical and repair-required rows for their own authorities", async () => {
    const db = await setupTestDB();
    const missingGameId = await insertInProgressGame(db);
    const repair = await insertDurableInProgressGame(db, "repair_required");

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      start: () => {
        throw new Error("skipped rows must not start");
      },
    });

    expect(result.scanned).toBe(2);
    expect(result.adopted).toEqual([]);
    const expected: typeof result.skipped = [
      {
        gameId: missingGameId,
        reason: "missing_execution_state",
        detail: "Game has durable facts but no execution authority",
      },
      { gameId: repair.gameId, reason: "repair_required" },
    ];
    expect(result.skipped).toEqual(
      expected.sort((left, right) => left.gameId.localeCompare(right.gameId)),
    );
  });

  test("adopts terminal execution so the durable start path can settle it", async () => {
    const db = await setupTestDB();
    const terminal = await insertDurableInProgressGame(db, "terminal");
    await expireActiveOwner(db, terminal.gameId);
    const starts: Array<{ gameId: string; status: GameExecutionStatusV1 }> = [];

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      processId: "terminal-settler",
      start: (input) => {
        if (!input.executionState) throw new Error("expected terminal execution state");
        starts.push({
          gameId: input.gameId,
          status: input.executionState.status,
        });
      },
    });

    expect(result).toEqual({ scanned: 1, adopted: [terminal.gameId], skipped: [] });
    expect(starts).toEqual([{ gameId: terminal.gameId, status: "terminal" }]);
  });

  test("does not replace a runner already active in this process", async () => {
    const db = await setupTestDB();
    const fixture = await insertDurableInProgressGame(db, "ready");

    const result = await adoptInProgressDurableGamesOnStartup(db, {
      isAlreadyRunning: (gameId) => gameId === fixture.gameId,
      start: () => {
        throw new Error("an active local runner must not restart");
      },
    });

    expect(result).toEqual({
      scanned: 1,
      adopted: [],
      skipped: [{ gameId: fixture.gameId, reason: "already_running" }],
    });
    expect((await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, fixture.gameId)))
      .filter((owner) => owner.status === "active")).toHaveLength(1);
  });
});

async function insertDurableInProgressGame(
  db: DrizzleDB,
  status: GameExecutionStatusV1,
): Promise<{ gameId: string; ownerEpoch: string }> {
  const gameId = await insertInProgressGame(db);
  const ownerEpoch = randomUUID();
  await db.insert(schema.gameRunOwners).values({
    id: randomUUID(),
    gameId,
    ownerEpoch,
    processId: "prior-runtime",
    lastPersistedEventSequence: 0,
  });
  await db.insert(schema.gameExecutionStates).values({
    gameId,
    ownerEpoch,
    status,
    committedTurnSequence: 7,
    xstateSnapshot: {},
    executionCursor: status === "terminal"
      ? { version: 1, kind: "terminal", stage: "commit_game" }
      : { version: 1, kind: "phase_enter", actor: "lobby" },
    playerContinuityCapsules: [],
    houseNarrativeContinuity: null,
    retryState: null,
  });
  return { gameId, ownerEpoch };
}

async function insertInProgressGame(db: DrizzleDB): Promise<string> {
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `durable-startup-${gameId}`,
    config: "{}",
    status: "in_progress",
    minPlayers: 2,
    maxPlayers: 12,
    startedAt: new Date().toISOString(),
  });
  return gameId;
}

async function expireActiveOwner(db: DrizzleDB, gameId: string): Promise<void> {
  await db.update(schema.gameRunOwners).set({
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  }).where(eq(schema.gameRunOwners.gameId, gameId));
}
