import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  Phase,
  ProviderExecutionCoordinator,
  type ProviderAttemptIntent,
  type ProviderAttemptRecord,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { insertGame, insertOwner } from "../__tests__/durable-run-test-utils.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import type {
  PrivateTracePutObjectInput,
  PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import { PrivateTraceReadModel } from "./private-trace-read-model.js";
import { writePreparedProviderAttemptObject } from "./private-trace-writer.js";
import {
  createApiProviderExecutionHooks,
  finishRuntimeStartupWithProviderAttemptReconciliation,
  reconcileProviderAttemptEvidence,
  reconcileProviderAttemptSpend,
  startProviderAttemptReconciliationRuntime,
} from "./provider-call-journal.js";
import { backfillGameCostAccounting } from "./provider-cost-accounting.js";

class FakeProviderEvidenceStorage implements PrivateTraceStorageAdapter {
  readonly puts: PrivateTracePutObjectInput[] = [];

  constructor(private readonly failure?: Error) {}

  async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    if (this.failure) throw this.failure;
    this.puts.push(input);
    return { etag: "provider-evidence-etag" };
  }

  async getObject(input: {
    bucket: string;
    key: string;
    maxBytes?: number;
  }): Promise<{ body: string; contentLength?: number; contentType?: string }> {
    const found = this.puts.find(
      (put) => put.bucket === input.bucket && put.key === input.key,
    );
    if (!found) throw new Error("object not found");
    const bytes = Buffer.from(found.body, "utf8");
    const returned = input.maxBytes === undefined
      ? bytes
      : bytes.subarray(0, Math.max(1, Math.floor(input.maxBytes)));
    return {
      body: returned.toString("utf8"),
      contentLength: returned.byteLength,
      contentType: found.contentType,
    };
  }

  async headObject(input: {
    bucket: string;
    key: string;
  }): Promise<{ contentLength?: number; contentType?: string }> {
    const found = this.puts.find(
      (put) => put.bucket === input.bucket && put.key === input.key,
    );
    if (!found) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(found.body, "utf8"),
      contentType: found.contentType,
    };
  }
}

function makeIntent(
  gameId: string,
  ownerEpoch: string,
  attemptOrdinal = 1,
): ProviderAttemptIntent {
  return {
    coordinate: {
      gameId,
      ownerEpoch,
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      action: "vote",
      phase: Phase.VOTE,
      round: 2,
      logicalCallOrdinal: 3,
    },
    attemptOrdinal,
    attemptId: `transport-${gameId}-${attemptOrdinal}`,
    preparedRequest: {
      requestShape: "chat_completions",
      providerProfileId: "katana",
      catalogId: "katana:glm-5-2",
      model: "glm-5-2",
      body: {
        model: "glm-5-2",
        messages: [{ role: "user", content: "Vote for Maya." }],
      },
    },
    startedAt: `2026-08-23T00:00:0${attemptOrdinal}.000Z`,
  };
}

function makeRecord(
  intent: ProviderAttemptIntent,
  overrides: Partial<ProviderAttemptRecord> = {},
): ProviderAttemptRecord {
  return {
    ...intent,
    completedAt: "2026-08-23T00:00:10.000Z",
    latencyMs: 1_000,
    outcome: {
      kind: "refusal",
      message: "invalid prompt",
      retryable: false,
    },
    disposition: "exhausted",
    requestId: "req-invalid-prompt",
    rawResponse: {
      status: 400,
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-invalid-prompt",
      },
      body: {
        error: { code: "invalid_prompt", message: "invalid prompt" },
      },
    },
    ...overrides,
  };
}

async function allocateAndReserve(
  hooks: ReturnType<typeof createApiProviderExecutionHooks>,
  intent: ProviderAttemptIntent,
): Promise<void> {
  expect(await hooks.onAllocateAttemptOrdinal?.(intent.coordinate)).toBe(
    intent.attemptOrdinal,
  );
  await hooks.onReserve?.(intent);
}

describe("provider call journal", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content-bucket";
    db = await setupTestDB();
  });

  test("reserves one authoritative row for a logical call and attempt", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = makeIntent(gameId, ownerEpoch);

    await allocateAndReserve(hooks, intent);
    await expect(hooks.onReserve?.(intent)).rejects.toThrow(
      "already reserved",
    );

    const logicalCalls = await db.select().from(schema.providerLogicalCalls);
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(logicalCalls).toHaveLength(1);
    expect(logicalCalls[0]).toMatchObject({
      gameId,
      actorId: "atlas-id",
      action: "vote",
      round: 2,
      logicalCallOrdinal: 3,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      logicalCallId: logicalCalls[0]!.id,
      attemptOrdinal: 1,
      transportAttemptId: `transport-${gameId}-1`,
      status: "reserved",
    });
  });

  test("continues one logical call with a monotonic attempt ordinal after owner recovery", async () => {
    const gameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, gameId);
    const firstHooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch: firstOwnerEpoch,
    });
    const firstIntent = makeIntent(gameId, firstOwnerEpoch, 1);
    await allocateAndReserve(firstHooks, firstIntent);

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, firstOwnerEpoch),
    ));
    const secondOwnerEpoch = await insertOwner(db, gameId);
    const secondHooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch: secondOwnerEpoch,
    });
    const secondIntent = makeIntent(gameId, secondOwnerEpoch, 2);
    await allocateAndReserve(secondHooks, secondIntent);

    const logicalCalls = await db.select().from(schema.providerLogicalCalls);
    let attempts = await db.select().from(schema.providerCallAttempts)
      .orderBy(schema.providerCallAttempts.attemptOrdinal);
    expect(logicalCalls).toHaveLength(1);
    expect(logicalCalls[0]!.nextAttemptOrdinal).toBe(3);
    expect(attempts.map((attempt) => ({
      logicalCallId: attempt.logicalCallId,
      ownerEpoch: attempt.ownerEpoch,
      attemptOrdinal: attempt.attemptOrdinal,
      status: attempt.status,
      indeterminateReason: attempt.indeterminateReason,
    }))).toEqual([
      {
        logicalCallId: logicalCalls[0]!.id,
        ownerEpoch: firstOwnerEpoch,
        attemptOrdinal: 1,
        status: "indeterminate",
        indeterminateReason: "owner_lost_before_terminal",
      },
      {
        logicalCallId: logicalCalls[0]!.id,
        ownerEpoch: secondOwnerEpoch,
        attemptOrdinal: 2,
        status: "reserved",
        indeterminateReason: null,
      },
    ]);

    expect(await reconcileProviderAttemptSpend(db)).toEqual({
      attempted: 1,
      projected: 1,
      failed: 0,
    });
    expect((await db.select().from(schema.gameProviderSpendEntries))[0]).toMatchObject({
      callStatus: "unknown",
      costSource: "unavailable",
      sourceKey: `provider-attempt:${attempts[0]!.id}`,
    });

    await firstHooks.onTerminal?.(makeRecord(firstIntent, {
      accounting: {
        actualCostMicrousd: 4_200,
        actualCostSource: "router_actual",
      },
    }));
    attempts = await db.select().from(schema.providerCallAttempts)
      .orderBy(schema.providerCallAttempts.attemptOrdinal);
    expect(attempts[0]).toMatchObject({
      status: "terminal",
      indeterminateReason: "owner_lost_before_terminal",
      spendProjectionState: "projected",
    });
    expect((await db.select().from(schema.gameProviderSpendEntries))[0]).toMatchObject({
      callStatus: "failed",
      actualCostMicrousd: 4_200,
      costSource: "router_actual",
    });
  });

  test("terminal spend wins over a stale indeterminate reconciliation snapshot", async () => {
    const gameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, gameId);
    const firstHooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch: firstOwnerEpoch,
    });
    const firstIntent = makeIntent(gameId, firstOwnerEpoch, 1);
    await allocateAndReserve(firstHooks, firstIntent);

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, firstOwnerEpoch),
    ));
    const secondOwnerEpoch = await insertOwner(db, gameId);
    const secondHooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch: secondOwnerEpoch,
    });
    await allocateAndReserve(secondHooks, makeIntent(gameId, secondOwnerEpoch, 2));

    let snapshotCaptured!: () => void;
    const snapshotWasCaptured = new Promise<void>((resolve) => {
      snapshotCaptured = resolve;
    });
    let releaseStaleProjection!: () => void;
    const staleProjectionMayContinue = new Promise<void>((resolve) => {
      releaseStaleProjection = resolve;
    });
    const staleReconciliation = reconcileProviderAttemptSpend(db, 100, {
      beforeProject: async (attempt) => {
        if (attempt.status !== "indeterminate") return;
        snapshotCaptured();
        await staleProjectionMayContinue;
      },
    });
    await snapshotWasCaptured;

    await firstHooks.onTerminal?.(makeRecord(firstIntent, {
      accounting: {
        actualCostMicrousd: 9_100,
        actualCostSource: "router_actual",
      },
    }));
    releaseStaleProjection();
    expect(await staleReconciliation).toEqual({
      attempted: 1,
      projected: 1,
      failed: 0,
    });

    expect((await db.select().from(schema.gameProviderSpendEntries))[0]).toMatchObject({
      sourceKey: expect.stringContaining("provider-attempt:"),
      callStatus: "failed",
      actualCostMicrousd: 9_100,
      costSource: "router_actual",
    });
  });

  test("active reconciliation drains evidence and spend left by prior runtimes", async () => {
    const storage = new FakeProviderEvidenceStorage();
    const leaveDeferredAttempt = async () => {
      const gameId = await insertGame(db);
      const ownerEpoch = await insertOwner(db, gameId);
      const intent = makeIntent(gameId, ownerEpoch);
      const hooks = createApiProviderExecutionHooks(db, {
        gameId,
        ownerEpoch,
        evidenceStorage: storage,
        evidenceDependencies: {
          load: async () => {
            throw new Error("originating runtime stopped before evidence reconciliation");
          },
        },
        projectSpend: async () => {
          throw new Error("originating runtime stopped before spend projection");
        },
      });
      await allocateAndReserve(hooks, intent);
      await hooks.onTerminal?.(makeRecord(intent));
      return gameId;
    };

    const startupGameId = await leaveDeferredAttempt();
    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      evidenceState: "pending",
      spendProjectionState: "failed",
    });

    const runtime = await startProviderAttemptReconciliationRuntime(db, {
      evidenceStorage: storage,
      intervalMs: 60_000,
    });
    try {
      const startupAttempt = (await db.select().from(schema.providerCallAttempts)
        .where(eq(schema.providerCallAttempts.gameId, startupGameId)))[0]!;
      expect(startupAttempt).toMatchObject({
        evidenceState: "stored",
        spendProjectionState: "projected",
      });

      const recurringGameId = await leaveDeferredAttempt();
      await runtime.runOnce();
      const recurringAttempt = (await db.select().from(schema.providerCallAttempts)
        .where(eq(schema.providerCallAttempts.gameId, recurringGameId)))[0]!;
      expect(recurringAttempt).toMatchObject({
        evidenceState: "stored",
        spendProjectionState: "projected",
      });
    } finally {
      await runtime.stop();
    }
  });

  test("stops provider reconciliation when later background startup fails", async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    const reconciliation = {
      runOnce: async () => ({
        evidence: { attempted: 0, stored: 0, failed: 0 },
        spend: { attempted: 0, projected: 0, failed: 0 },
      }),
      stop: async () => {
        clearInterval(timer);
      },
    };

    await expect(finishRuntimeStartupWithProviderAttemptReconciliation(
      reconciliation,
      async () => {
        throw new Error("later startup dependency failed");
      },
    )).rejects.toThrow("later startup dependency failed");
    const ticksAfterCleanup = ticks;
    await Bun.sleep(20);
    expect(ticks).toBe(ticksAfterCleanup);
  });

  test("stores exact non-rate-limit evidence once under a deterministic key", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
    });
    const intent = makeIntent(gameId, ownerEpoch);
    const record = makeRecord(intent);

    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(record);
    await hooks.onTerminal?.(record);

    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.key).toMatch(
      new RegExp(`^content/${gameId}/provider-attempts/sha256-[0-9a-f]{64}/attempt-1\\.json$`),
    );
    expect(storage.puts[0]!.body).toContain("Vote for Maya.");
    expect(storage.puts[0]!.body).toContain("invalid_prompt");

    const manifests = await db
      .select()
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.evidenceType, "provider_attempt_failure"));
    expect(manifests).toHaveLength(1);

    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "terminal",
      outcomeKind: "refusal",
      evidenceState: "stored",
      evidenceManifestId: manifests[0]!.id,
      spendProjectionState: "projected",
    });

    const readModel = new PrivateTraceReadModel(db, () => storage);
    const read = await readModel.readProviderAttemptContent(manifests[0]!.id, {
      gameId,
      maxBytes: 64,
    });
    expect(read.ok).toBeTrue();
    if (!read.ok) throw new Error(read.error);
    expect(read.response.returnedByteLength).toBe(64);
    expect(read.response.truncated).toBeTrue();
  });

  test("terminal commit retains exact evidence until reconciliation survives lookup failure", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies: {
        load: async () => {
          throw new Error("evidence lookup unavailable");
        },
      },
    });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);

    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(storage.puts).toHaveLength(0);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(1);
    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      status: "terminal",
      evidenceState: "pending",
    });

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
    ));
    await insertOwner(db, gameId);

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(0);
  });

  test("manifest failure is nonfatal and leaves the exact handoff retryable", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies: {
        createManifest: async () => {
          throw new Error("manifest unavailable");
        },
      },
    });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);

    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(1);
    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      evidenceState: "degraded",
      evidenceError: "manifest unavailable",
    });

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect(storage.puts).toHaveLength(2);
    expect(new Set(storage.puts.map((put) => put.key)).size).toBe(1);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(1);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(0);
  });

  test("state-finalization failure reuses the manifest and object on reconciliation", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies: {
        finalize: async () => {
          throw new Error("attempt state unavailable");
        },
      },
    });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);

    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(1);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(1);

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(0);
    expect((await db.select().from(schema.providerCallAttempts))[0]!.evidenceState)
      .toBe("stored");
  });

  test("keeps raw evidence degradation nonfatal and marks the attempt", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: new FakeProviderEvidenceStorage(
        new Error("object storage unavailable"),
      ),
    });
    const intent = makeIntent(gameId, ownerEpoch);

    await allocateAndReserve(hooks, intent);
    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();

    const attempt = (await db.select().from(schema.providerCallAttempts))[0]!;
    expect(attempt).toMatchObject({
      status: "terminal",
      evidenceState: "degraded",
      spendProjectionState: "projected",
    });
    expect(attempt.evidenceError).toContain("object storage unavailable");
    const owner = (await db
      .select()
      .from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(owner.kernelHealth).toBe("degraded");
  });

  test("aggregates recovered and exhausted rate limits without raw objects", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
    });
    const firstIntent = makeIntent(gameId, ownerEpoch, 1);
    const secondIntent = makeIntent(gameId, ownerEpoch, 2);

    await allocateAndReserve(hooks, firstIntent);
    await hooks.onTerminal?.(makeRecord(firstIntent, {
      outcome: { kind: "rate_limit", message: "slow down", retryable: true },
      disposition: "retry_scheduled",
      rawResponse: {
        status: 429,
        headers: { "retry-after": "1" },
        body: { error: { message: "slow down" } },
      },
    }));
    await allocateAndReserve(hooks, secondIntent);
    await hooks.onTerminal?.(makeRecord(secondIntent, {
      outcome: { kind: "usable" },
      disposition: "accepted",
      requestId: "response-2",
      rawResponse: undefined,
      accounting: {
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        providerNativeUnit: "katana_credit",
        providerNativeAmount: "0.1",
      },
    }));

    const call = (await db.select().from(schema.providerLogicalCalls))[0]!;
    expect(call).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "recovered",
    });
    expect(storage.puts).toHaveLength(0);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);

    const exhaustedGameId = await insertGame(db);
    const exhaustedOwnerEpoch = await insertOwner(db, exhaustedGameId);
    const exhaustedHooks = createApiProviderExecutionHooks(db, {
      gameId: exhaustedGameId,
      ownerEpoch: exhaustedOwnerEpoch,
      evidenceStorage: storage,
    });
    const exhaustedIntent = makeIntent(exhaustedGameId, exhaustedOwnerEpoch);
    await allocateAndReserve(exhaustedHooks, exhaustedIntent);
    await exhaustedHooks.onTerminal?.(makeRecord(exhaustedIntent, {
      outcome: { kind: "rate_limit", message: "rate limit exhausted", retryable: true },
      disposition: "exhausted",
      rawResponse: { status: 429, body: { error: "rate limit exhausted" } },
    }));
    const exhaustedCall = (await db
      .select()
      .from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.gameId, exhaustedGameId)))[0]!;
    expect(exhaustedCall).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "exhausted",
      rateLimitTerminalReason: "rate limit exhausted",
    });
    expect(storage.puts).toHaveLength(0);
  });

  test("concurrent identical terminalization is idempotent and aggregates a rate limit once", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = makeIntent(gameId, ownerEpoch);
    const record = makeRecord(intent, {
      outcome: { kind: "rate_limit", message: "slow down", retryable: true },
      disposition: "exhausted",
      rawResponse: { status: 429, body: { error: "slow down" } },
    });
    await allocateAndReserve(hooks, intent);

    await expect(Promise.all([
      hooks.onTerminal?.(record),
      hooks.onTerminal?.(record),
    ])).resolves.toEqual([undefined, undefined]);
    expect((await db.select().from(schema.providerLogicalCalls))[0]).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "exhausted",
    });

    await expect(hooks.onTerminal?.({
      ...record,
      outcome: { kind: "rate_limit", message: "different", retryable: true },
    })).rejects.toThrow("conflict");
  });

  test("concurrent evidence reconciliation cannot downgrade a stored attempt", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const intent = makeIntent(gameId, ownerEpoch);
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies: {
        load: async () => {
          throw new Error("deferred to background reconciliation");
        },
      },
    });
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent));

    let releaseWrites!: () => void;
    const bothWritesMayContinue = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    let writes = 0;
    const delayedWrite: NonNullable<
      import("./provider-call-journal.js").ProviderEvidenceReconciliationDependencies["write"]
    > = async (writeDb, prepared) => {
      writes += 1;
      if (writes === 2) releaseWrites();
      await bothWritesMayContinue;
      return writePreparedProviderAttemptObject(writeDb, prepared, { storage });
    };

    const first = reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
      dependencies: { write: delayedWrite },
    });
    while (writes < 1) await Bun.sleep(1);
    const second = reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
      dependencies: { write: delayedWrite },
    });
    while (writes < 2) await Bun.sleep(1);
    expect(await Promise.all([first, second])).toEqual([
      { attempted: 1, stored: 1, failed: 0 },
      { attempted: 1, stored: 1, failed: 0 },
    ]);

    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      evidenceState: "stored",
      evidenceError: null,
    });
    expect(await db.select().from(schema.providerAttemptEvidenceOutbox)).toHaveLength(0);
  });

  test("reconciles failed spend projection idempotently from journaled facts", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      projectSpend: async () => {
        throw new Error("spend ledger unavailable");
      },
    });
    const intent = makeIntent(gameId, ownerEpoch);
    const record = makeRecord(intent, {
      outcome: { kind: "usable" },
      disposition: "accepted",
      rawResponse: undefined,
      accounting: {
        usage: {
          promptTokens: 100,
          cachedTokens: 20,
          completionTokens: 30,
          reasoningTokens: 5,
          totalTokens: 130,
        },
        providerNativeUnit: "katana_credit",
        providerNativeAmount: "0.1",
      },
    });

    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(record);
    let attempt = (await db.select().from(schema.providerCallAttempts))[0]!;
    expect(attempt.spendProjectionState).toBe("failed");
    expect(await db.select().from(schema.gameProviderSpendEntries)).toHaveLength(0);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "trace-after-failed-journal-projection",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "atlas-id", name: "Atlas", role: "player" },
        action: "vote",
        model: { provider: "katana", name: "glm-5-2" },
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      },
    });
    expect(await backfillGameCostAccounting(db, gameId)).toMatchObject({
      inserted: 0,
    });
    expect(await db.select().from(schema.gameProviderSpendEntries)).toHaveLength(0);

    expect(await reconcileProviderAttemptSpend(db)).toMatchObject({
      attempted: 1,
      projected: 1,
      failed: 0,
    });
    expect(await reconcileProviderAttemptSpend(db)).toMatchObject({
      attempted: 0,
      projected: 0,
      failed: 0,
    });

    attempt = (await db
      .select()
      .from(schema.providerCallAttempts)
      .where(and(
        eq(schema.providerCallAttempts.gameId, gameId),
        eq(schema.providerCallAttempts.attemptOrdinal, 1),
      )))[0]!;
    expect(attempt.spendProjectionState).toBe("projected");
    const spend = await db.select().from(schema.gameProviderSpendEntries);
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({
      gameId,
      callStatus: "succeeded",
      costSource: "unavailable",
      providerNativeUnit: "katana_credit",
      providerNativeAmount: "0.1",
      promptTokens: 100,
      cachedTokens: 20,
      completionTokens: 30,
      reasoningTokens: 5,
      totalTokens: 130,
    });
  });

  test("sanitizes credential values and credential query parameters before journaling evidence", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
    });
    const secret = "sk-private-journal-secret";

    await expect(new ProviderExecutionCoordinator({ hooks })
      .startCall({
        ...makeIntent(gameId, ownerEpoch).coordinate,
      })
      .execute({
        preparedRequest: {
          requestShape: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test", apiKey: secret },
          credentialValues: [secret],
        },
        maxAttempts: 1,
        dispatch: async () => {
          throw Object.assign(new Error(
            `bad credential ${secret} at https://provider.test/v1?api_key=url-secret-value`,
          ), {
            status: 400,
            request_id: `${secret}?access_token=url-secret-value&tail=${"x".repeat(400)}`,
          });
        },
        validate: (response: unknown) => ({ status: "usable", value: response }),
      })).rejects.toThrow("[REDACTED]");

    const attempt = (await db.select().from(schema.providerCallAttempts))[0]!;
    expect(attempt.outcomeMessage).not.toContain(secret);
    expect(attempt.outcomeMessage).not.toContain("url-secret-value");
    expect(attempt.providerRequestId).not.toContain(secret);
    expect(attempt.providerRequestId).not.toContain("url-secret-value");
    expect(attempt.providerRequestId?.length).toBeLessThanOrEqual(256);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.body).not.toContain(secret);
    expect(storage.puts[0]!.body).not.toContain("url-secret-value");
  });
});
