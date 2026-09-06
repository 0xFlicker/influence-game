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

  test("gives concurrent game workers distinct process identities without a global lease", async () => {
    const first = startGameExecutionWorkerRuntime();
    const second = startGameExecutionWorkerRuntime();
    expect(first.workerId).not.toBe(second.workerId);
    await first.stop();
    await second.stop();
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
      observedLease: lease,
      claimsStoppedAt: expect.any(String),
      ownedGameCount: 1,
      releasedAt: null,
    });
    expect(worker.canClaimGames()).toBeFalse();

    await db.update(schema.gameRunOwners).set({ status: "closed" })
      .where(eq(schema.gameRunOwners.gameId, gameId));
    const drained = await acknowledgeGameWorkerDrain(db, worker, lease, async () => {});
    expect(drained).toMatchObject({
      state: "drained",
      observedLease: lease,
      ownedGameCount: 0,
      releasedAt: expect.any(String),
      lastError: null,
    });
    await worker.stop();
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
      observedLease: lease,
      lastError: "durable owner query unavailable",
    });
    expect(worker.canClaimGames()).toBeFalse();

    await expect(worker.acknowledgeDrain(
      { ...lease, phase: "validating" },
      async () => 0,
    )).resolves.toMatchObject({
      state: "drained",
      observedLease: { ...lease, phase: "validating" },
      ownedGameCount: 0,
      lastError: null,
    });
    await worker.stop();
  });
});
