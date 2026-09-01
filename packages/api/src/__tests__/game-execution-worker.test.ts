import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { insertGame } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";
import {
  acknowledgeGameWorkerDrain,
  readApiRuntimeRole,
  startGameExecutionWorkerRuntime,
} from "../services/game-execution-worker.js";

describe("game worker boundary", () => {
  test("defaults every API runtime to the non-claiming gateway role", () => {
    expect(readApiRuntimeRole({})).toBe("gateway");
    expect(readApiRuntimeRole({ INFLUENCE_API_ROLE: "game-worker" })).toBe("game-worker");
    expect(() => readApiRuntimeRole({ INFLUENCE_API_ROLE: "active" }))
      .toThrow("INFLUENCE_API_ROLE must be gateway or game-worker");
  });

  test("gives concurrent game workers distinct process identities without a global lease", () => {
    const first = startGameExecutionWorkerRuntime();
    const second = startGameExecutionWorkerRuntime();
    expect(first.workerId).not.toBe(second.workerId);
  });

  test("backs off repeated local startup failures without disabling unrelated claims", () => {
    const worker = startGameExecutionWorkerRuntime();
    expect(worker.canAttemptGameStart("game-a")).toBeTrue();
    worker.recordGameStartFailed("game-a");
    expect(worker.canAttemptGameStart("game-a")).toBeFalse();
    expect(worker.canAttemptGameStart("game-b")).toBeTrue();
    worker.recordGameStartSucceeded("game-a");
    expect(worker.canAttemptGameStart("game-a")).toBeTrue();
  });

  test("acknowledges drain only after its own durable leases are gone", async () => {
    const db = await setupTestDB();
    const worker = startGameExecutionWorkerRuntime();
    const gameId = await insertGame(db, { status: "in_progress" });
    await db.insert(schema.gameRunOwners).values({
      id: randomUUID(),
      gameId,
      ownerEpoch: randomUUID(),
      processId: worker.workerId,
      status: "active",
      runSource: "api",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastPersistedEventSequence: 0,
      kernelHealth: "healthy",
    });
    const lease = {
      id: randomUUID(),
      fencingToken: 4,
      phase: "draining" as const,
    };

    const waiting = await acknowledgeGameWorkerDrain(db, worker, lease, async () => {});
    expect(waiting).toMatchObject({
      state: "draining",
      observedLease: { id: lease.id, fencingToken: lease.fencingToken },
      claimsStoppedAt: expect.any(String),
      ownedGameCount: 1,
    });
    expect(worker.canClaimGames()).toBeFalse();

    await db.update(schema.gameRunOwners).set({ status: "closed" })
      .where(eq(schema.gameRunOwners.gameId, gameId));
    const drained = await acknowledgeGameWorkerDrain(db, worker, lease, async () => {});
    expect(drained).toMatchObject({
      state: "drained",
      observedLease: { id: lease.id, fencingToken: lease.fencingToken },
      ownedGameCount: 0,
    });
  });

  test("remains non-claiming and retries a failed drain acknowledgement", async () => {
    const worker = startGameExecutionWorkerRuntime();
    const lease = {
      id: randomUUID(),
      fencingToken: 4,
      phase: "draining" as const,
    };

    await expect(worker.acknowledgeDrain(lease, async () => {
      throw new Error("durable owner query unavailable");
    })).rejects.toThrow("durable owner query unavailable");
    expect(worker.getDrainStatus()).toMatchObject({
      state: "draining",
      observedLease: { id: lease.id, fencingToken: lease.fencingToken },
      ownedGameCount: null,
    });
    expect(worker.canClaimGames()).toBeFalse();

    await expect(worker.acknowledgeDrain(
      { ...lease, phase: "validating" },
      async () => 0,
    )).resolves.toMatchObject({
      state: "drained",
      observedLease: { id: lease.id, fencingToken: lease.fencingToken },
      ownedGameCount: 0,
    });
  });

  test("resumes claims only after the deployment admission has reopened", async () => {
    const worker = startGameExecutionWorkerRuntime();
    const firstLease = {
      id: randomUUID(),
      fencingToken: 4,
      phase: "draining" as const,
    };
    await worker.acknowledgeDrain(firstLease, async () => 0);

    expect(worker.canClaimGames()).toBeFalse();
    worker.resumeClaimingAfterAdmissionReopens();
    expect(worker.getDrainStatus()).toMatchObject({
      state: "claiming",
      observedLease: null,
      claimsStoppedAt: null,
      ownedGameCount: null,
    });
    expect(worker.canClaimGames()).toBeTrue();

    const secondLease = {
      id: randomUUID(),
      fencingToken: 5,
      phase: "draining" as const,
    };
    await worker.acknowledgeDrain(secondLease, async () => 0);
    expect(worker.getDrainStatus()).toMatchObject({
      state: "drained",
      observedLease: { id: secondLease.id, fencingToken: secondLease.fencingToken },
      ownedGameCount: 0,
    });
  });

  test("reacknowledges a later deployment fence instead of returning a stale status", async () => {
    const worker = startGameExecutionWorkerRuntime();
    const firstLease = { id: randomUUID(), fencingToken: 4, phase: "draining" as const };
    const secondLease = { id: randomUUID(), fencingToken: 5, phase: "validating" as const };

    await worker.acknowledgeDrain(firstLease, async () => 0);
    const second = await worker.acknowledgeDrain(secondLease, async () => 0);

    expect(second).toMatchObject({
      state: "drained",
      observedLease: { id: secondLease.id, fencingToken: secondLease.fencingToken },
      claimsStoppedAt: expect.any(String),
      ownedGameCount: 0,
    });
  });
});
