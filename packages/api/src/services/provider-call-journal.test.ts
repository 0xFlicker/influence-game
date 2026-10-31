import { deferProviderGame, providerRetryPending } from "./provider-game-retry.js";
import { normalizeAudioPayload } from "@influence/engine/audio-delivery";
import { testPayloadStore } from "../__tests__/payload-test-store.js";
import { getProviderFailureDetail } from "./provider-failure-read-model.js";
import { randomUUID } from "node:crypto";
import { loadPayloads, storeFields, storeJson, setPayloadObjectStoreForTests } from "./payload-storage.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import {
  Phase, normalizeGameModelRouting, sealGameModelRouting, modelRateCard,
  ProviderAttemptError,
  ProviderDeferredError,
  ProviderCallBudgetExhaustedError,
  ProviderCircuitOpenError,
  ProviderExecutionCoordinator,
  createProviderEvidenceFetch,
  durableProviderLogicalCallId,
  providerAcceptedDecisionId,
  providerLogicalCallId,
  type GameTurnIntentV1,
  type ProviderAttemptIntent,
  type ProviderAttemptRecord,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createCanonicalEventFixture,
  insertGame,
  insertOwner,
} from "../__tests__/durable-run-test-utils.js";
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
import { appendGameEvents } from "./game-events.js";
import { sha256StableJson } from "./stable-hash.js";
import { cloneCompactStrategyState, createOpeningStrategyState, contextSourceHash, executeModelInvocation,
  modelCatalogEntryById, classifyProviderError, type LlmProviderRuntime, type ModelInvocation } from "@influence/engine";

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
      semantic: {
        version: 1,
        kind: "phase_call",
        phase: Phase.VOTE,
        round: 2,
        canonicalEventSequence: 3,
        callSlot: 1,
      },
    },
    attemptOrdinal,
    attemptId: `transport-${gameId}-${attemptOrdinal}`,
    preparedRequest: {
      transport: "katana.chat_completions",
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
  const record: ProviderAttemptRecord = {
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
  if (record.outcome.kind === "usable" && record.acceptedValue === undefined) {
    record.acceptedValue = {
      id: `accepted-${intent.attemptOrdinal}`,
      choices: [{ message: { content: "accepted" } }],
    };
  }
  return record;
}

async function insertPlannedDurableTurn(
  db: DrizzleDB,
  input: {
    gameId: string;
    ownerEpoch: string;
    turnId?: string;
    preR33?: boolean;
  },
): Promise<NonNullable<ProviderAttemptIntent["coordinate"]["durableTurn"]>> {
  const turnId = input.turnId ?? `turn:${input.gameId}`;
  const semanticCoordinate = {
    version: 1 as const,
    kind: "durable_turn" as const,
    turnId,
    subcallSlot: 1,
  };
  const logicalCallId = durableProviderLogicalCallId({
    gameId: input.gameId,
    turnId,
    subcallSlot: 1,
  });
  const intent: GameTurnIntentV1 = {
    version: 1,
    gameId: input.gameId,
    turnId,
    turnSequence: 1,
    seed: `seed:${turnId}`,
    baseHeads: {
      version: 1,
      turnSequence: 0,
      eventSequence: 0,
      eventHash: null,
      dialogueSequence: 0,
      publicationSequence: 0,
    },
    branch: { version: 1, kind: "single_provider", action: "vote" },
    actorIds: ["atlas-id"],
    targetIds: [],
    handles: [],
    participantIds: ["atlas-id"],
    providerSubcalls: [{
      version: 1,
      slot: 1,
      logicalCallId,
      ...(input.preR33 ? {} : { semanticCoordinate }),
      actorId: "atlas-id",
      action: "vote",
      contractId: "agent-vote-v1",
    }],
  };
  await db.insert(schema.gameTurns).values(await storeFields({
    id: turnId,
    gameId: input.gameId,
    turnSequence: 1,
    plannedOwnerEpoch: input.ownerEpoch,
    baseEventSequence: 0,
    baseDialogueSequence: 0,
    basePublicationSequence: 0,
    intent,
    intentHash: sha256StableJson(intent),
  }, {"intent":"json-gzip","commitResult":"json-gzip"}));
  return { turnId, subcallSlot: 1 };
}

function bindDurableTurn(
  intent: ProviderAttemptIntent,
  durableTurn: NonNullable<ProviderAttemptIntent["coordinate"]["durableTurn"]>,
): ProviderAttemptIntent {
  return {
    ...intent,
    coordinate: {
      ...intent.coordinate,
      semantic: { version: 1 as const, kind: "durable_turn" as const, turnId: durableTurn.turnId, subcallSlot: durableTurn.subcallSlot },
      durableTurn,
    },
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



  test("both tiers unavailable preserve the same turn and durably delay its next owner", async () => {
    const gameId = await insertGame(db, { status: "in_progress" }), ownerEpoch = await insertOwner(db, gameId);
    const coordinate = makeIntent(gameId, ownerEpoch).coordinate;
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const before = await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, gameId));
    const tiers: string[] = [];
    const call = new ProviderExecutionCoordinator({ hooks: createApiProviderExecutionHooks(db, { gameId, ownerEpoch }) }).startCall(coordinate);
    let deferred: ProviderDeferredError | undefined;
    try {
      await call.executeManifest({ entries: [{ catalogId: "openai:gpt-6-luna", maxAttempts: 1,
        preparedRequest: { transport: "openai.responses", providerProfileId: "openai", catalogId: "openai:gpt-6-luna", model: "gpt-6-luna", body: { service_tier: "flex" } },
        dispatch: async ({ serviceTier }) => { tiers.push(serviceTier ?? "flex"); throw Object.assign(new Error("unavailable"), {
          status: 429, headers: { "retry-after": "300" }, error: { code: serviceTier ? "rate_limit_exceeded" : "flex_unavailable" },
        }); }, validate: (value: unknown) => ({ status: "usable", value }),
      }] });
    } catch (error) { if (!(error instanceof ProviderDeferredError)) throw error; deferred = error; }
    expect(deferred).toBeDefined();
    await deferProviderGame(db, gameId, ownerEpoch, deferred!);
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    expect(game!.status).toBe("in_progress");
    expect(providerRetryPending(game!.config)).toBe(true);
    expect(providerRetryPending(game!.config, Date.now() + 61_000)).toBe(false);
    expect(tiers).toEqual(["flex", "default"]);
    expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, gameId))).toEqual(before);
    expect((await db.select().from(schema.providerLogicalCalls).where(eq(schema.providerLogicalCalls.gameId, gameId)))[0]!.acceptedAttemptId).toBeNull();
    expect((await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!.failureReason).toBe("provider_execution_deferred");
    // Bounded recovery eventually suspends, retaining the exact same logical call.
    const config = JSON.parse(game!.config); config.providerRetry.attempt = 23;
    await db.update(schema.games).set({ config: JSON.stringify(config) }).where(eq(schema.games.id, gameId));
    const nextOwner = await insertOwner(db, gameId);
    await deferProviderGame(db, gameId, nextOwner, deferred!);
    expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]!.status).toBe("suspended");
    expect(await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.gameId, gameId))).toEqual(before);
  });

  test.each(["after-flex", "after-standard"])("Flex failover survives restart %s with one accepted result", async boundary => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const coordinate = makeIntent(gameId, ownerEpoch).coordinate;
    const tiers: string[] = [];
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const entry = { catalogId: "openai:gpt-6-luna", maxAttempts: 1,
      contextIdentity: () => ({ sourceHash: `sha256:${"a".repeat(64)}`, revision: 0, maxAttempts: 1 }),
      preparedRequest: { transport: "openai.responses", providerProfileId: "openai" as const, catalogId: "openai:gpt-6-luna", model: "gpt-6-luna", body: { service_tier: "flex", input: "Vote", reasoning: { effort: "low" } } },
      dispatch: async ({ serviceTier }: { serviceTier?: "default" }) => {
        tiers.push(serviceTier ?? "flex");
        if (!serviceTier) throw Object.assign(new Error("capacity"), { status: 429, headers: { "retry-after": "300" }, error: { code: "flex_unavailable" } });
        return { target: "Bea" };
      }, validate: (value: { target: string }) => ({ status: "usable" as const, value }),
      accounting: () => ({ effectiveServiceTier: "default", usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 } }),
    };
    let crashed = false;
    const interrupted = new ProviderExecutionCoordinator({ hooks: { ...hooks, onTerminal: async record => {
      const receipt = await hooks.onTerminal?.(record);
      if (!crashed && (boundary === "after-flex" ? record.outcome.kind !== "usable" : record.outcome.kind === "usable")) {
        crashed = true; throw new Error("simulated process loss");
      }
      return receipt;
    } } });
    await expect(interrupted.startCall(coordinate).executeManifest({ entries: [entry] })).rejects.toThrow("simulated process loss");
    const recovered = new ProviderExecutionCoordinator({ hooks: createApiProviderExecutionHooks(db, { gameId, ownerEpoch }) });
    await expect(recovered.startCall(coordinate).executeManifest({ entries: [entry] })).resolves.toMatchObject({ value: { target: "Bea" }, acceptedAttemptOrdinal: 2 });
    await recovered.startCall(coordinate).executeManifest({ entries: [entry] });
    expect(tiers).toEqual(["flex", "default"]);
    const attempts = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId)).orderBy(schema.providerCallAttempts.attemptOrdinal);
    expect(attempts.map(a => a.disposition)).toEqual(["retry_scheduled", "accepted"]);
    expect(attempts[1]!.rateCard).toEqual(modelRateCard("openai:gpt-6-luna", "default"));
    const spend = await db.select().from(schema.gameProviderSpendEntries).where(eq(schema.gameProviderSpendEntries.gameId, gameId));
    expect(spend.find(row => row.attemptOrdinal === 2)).toMatchObject({ estimatedCostMicrousd: 150,
      costSource: "static_estimate", safeMetadata: { effectiveServiceTier: "default" } });
    expect((await db.select().from(schema.providerAttemptEvidenceOutbox).where(eq(schema.providerAttemptEvidenceOutbox.gameId, gameId)))).toHaveLength(2);
  });

  test("a failed fallback resumes with the same context after strategy traverses JSONB", async () => {
    const gameId = await insertGame(db);
    let ownerEpoch = await insertOwner(db, gameId);
    const ids = ["katana:glm-5-2", "katana:grok-4-5"];
    await db.update(schema.games).set({ config: JSON.stringify({ providerManifest: [
      { catalogId: ids[0] }, { catalogId: ids[1], maxCallsPerGame: 8 },
    ] }) }).where(eq(schema.games.id, gameId));
    const binding = await insertPlannedDurableTurn(db, { gameId, ownerEpoch });
    const coordinate = bindDurableTurn(makeIntent(gameId, ownerEpoch), binding).coordinate;
    const state = createOpeningStrategyState();
    const makeInvocation = (strategy: typeof state): ModelInvocation => ({
      messages: [{ role: "user", content: "same frozen turn" }], contextSpans: [{ text: "same frozen turn", format: "text" }],
      compactionCharacter: { personality: "Patient", backstory: "Teacher", strategy: "Listen",
        currentStrategy: JSON.stringify(cloneCompactStrategyState(strategy)) },
      result: { kind: "text" }, outputTokenLimit: 100,
    });
    let dispatches = 0, recovered = false;
    const runtimes: LlmProviderRuntime[] = ids.map((id, position) => {
      const model = modelCatalogEntryById(id)!;
      return { catalogId: id, modelId: model.modelId, providerProfileId: model.providerProfileId, modelCapabilities: model.capabilities,
        position, role: position === 0 ? "primary" : "fallback", reasoningPolicy: "low",
        adapter: { id: "test", validate: () => ({ compatible: true }), classifyError: classifyProviderError,
          compile: () => ({ transport: "test.chat", body: {} }), dispatch: async () => {
            dispatches++;
            if (position === 0) throw Object.assign(new Error("request rejected"), { status: 400 });
            if (!recovered) throw Object.assign(new Error("Request timed out"), { name: "APITimeoutError" });
            return { transport: "test.chat", nativeResponse: {}, toolCalls: [], text: "accepted" };
          } },
      };
    });
    const run = (invocation: ModelInvocation) => {
      const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
      return executeModelInvocation({
        call: new ProviderExecutionCoordinator({ hooks: { ...hooks, onTerminal: async record => {
          const receipt = await hooks.onTerminal?.(record);
          if (!recovered && record.preparedRequest.catalogId === ids[1]) throw new Error("process interrupted after fallback failure");
          return receipt;
        } } }).startCall(coordinate),
        invocation, runtimes, maxAttempts: 2, validate: response => ({ status: "usable", value: response.text }),
      });
    };
    await expect(run(makeInvocation(state))).rejects.toThrow("process interrupted after fallback failure");
    expect(dispatches).toBe(2);
    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)));
    ownerEpoch = await insertOwner(db, gameId);
    coordinate.ownerEpoch = ownerEpoch;
    await db.update(schema.gameTurns).set({ plannedOwnerEpoch: ownerEpoch }).where(eq(schema.gameTurns.id, binding.turnId));
    const [row] = await db.execute(sql`SELECT ${JSON.stringify(state)}::jsonb AS strategy`);
    const restored = row!.strategy as typeof state;
    expect(JSON.stringify(restored)).not.toBe(JSON.stringify(state));
    expect(contextSourceHash(makeInvocation(restored))).toBe(contextSourceHash(makeInvocation(state)));
    await expect(run(makeInvocation({ ...restored, revision: 1 }))).rejects.toThrow("Context source changed");
    expect(dispatches).toBe(2);
    recovered = true;
    expect((await run(makeInvocation(restored))).value).toBe("accepted");
    expect(dispatches).toBe(4);
    expect((await run(makeInvocation(restored))).value).toBe("accepted");
    expect(dispatches).toBe(4);
    const attempts = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId));
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts.map(attempt => attempt.contextSourceHash)).size).toBe(1);
    expect(new Set(attempts.map(attempt => attempt.ownerEpoch)).size).toBe(2);
  });

  test("contestants share fallback caps, House has its own cap, and primary/replay consume no recovery allowance", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const policy = normalizeGameModelRouting({ version: 1,
      defaultManifest: [{ catalogId: "openai:gpt-6-luna" }, { catalogId: "katana:glm-5-2", maxCallsPerGame: 1 }],
      houseManifest: [{ catalogId: "meta-muse:muse-spark-1.3-contributor" }, { catalogId: "katana:glm-5-2", maxCallsPerGame: 1 }],
      overrides: {}, excludedCatalogIds: [] });
    const modelRouting = sealGameModelRouting(policy, [{ id: "primary", preference: { catalogId: "katana:glm-5-2" } }, { id: "a" }, { id: "b" }]);
    await db.update(schema.games).set({ config: JSON.stringify({ modelRouting }) }).where(eq(schema.games.id, gameId));
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = (id: string, role: "player" | "house" = "player") => { const value = makeIntent(gameId, ownerEpoch); value.coordinate.actor = { id, name: id, role }; value.attemptId += `-${id}`; return value; };
    const primary = intent("primary"); await allocateAndReserve(hooks, primary);
    await hooks.onTerminal?.(makeRecord(primary, { outcome: { kind: "usable" }, disposition: "accepted", acceptedValue: { target: "Bea" } }));
    expect(await hooks.onReadAccepted?.(primary.coordinate)).toMatchObject({ value: { target: "Bea" } });
    const a = intent("a"); await allocateAndReserve(hooks, a);
    const b = intent("b");
    await expect(allocateAndReserve(hooks, b)).rejects.toBeInstanceOf(ProviderCallBudgetExhaustedError);
    const house = intent("house", "house"); await allocateAndReserve(hooks, house);
    const resumed = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    // The uncommitted contestant reservation still consumes the allowance after reload.
    await expect(allocateAndReserve(resumed, { ...intent("b"), attemptOrdinal: 2 })).rejects.toBeInstanceOf(ProviderCallBudgetExhaustedError);
    const attempts = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId));
    expect(attempts.map(row => row.fallbackBudgetKey).sort()).toEqual([null, "contestants:katana:glm-5-2", "house:katana:glm-5-2"].sort());
    expect(attempts.every(row => row.rateCard?.catalogId === "katana:glm-5-2")).toBe(true);
    const detail = await getProviderFailureDetail(db, gameId);
    expect(detail.budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "contestants", catalogId: "katana:glm-5-2", role: "primary", usedCalls: 1, maxCallsPerGame: null }),
      expect.objectContaining({ scope: "contestants", catalogId: "katana:glm-5-2", role: "fallback", usedCalls: 1, remainingCalls: 0 }),
      expect.objectContaining({ scope: "house", catalogId: "katana:glm-5-2", role: "fallback", usedCalls: 1, remainingCalls: 0 }),
    ]));
  });

  test("freezes native Anthropic Standard pricing before dispatch and replays accepted decisions", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const catalogId = "anthropic:claude-haiku-5-5";
    await db.update(schema.games).set({ config: JSON.stringify({providerManifest: [{catalogId, reasoningPolicy: "low"}]}) }).where(eq(schema.games.id, gameId));
    const intent = makeIntent(gameId, ownerEpoch);
    intent.preparedRequest = { transport: "anthropic.messages", providerProfileId: "anthropic", catalogId, model: "claude-haiku-5-5",
      body: {model: "claude-haiku-5-5", max_tokens: 8192, service_tier: "standard_only"} };
    const hooks = createApiProviderExecutionHooks(db, {gameId, ownerEpoch});
    await allocateAndReserve(hooks, intent);
    const [reserved] = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId));
    expect(reserved!.rateCard).toMatchObject({catalogId, serviceTier: "standard", rates: {inputPer1M: 0.1, outputPer1M: 0.5}});
    await hooks.onTerminal?.(makeRecord(intent, {outcome: {kind: "usable"}, disposition: "accepted", acceptedValue: {target: "Bea"},
      accounting: {effectiveServiceTier: "standard", usage: {promptTokens: 1000, completionTokens: 100, reasoningTokens: 90}} }));
    expect(await createApiProviderExecutionHooks(db, {gameId, ownerEpoch}).onReadAccepted?.(intent.coordinate)).toMatchObject({value: {target: "Bea"}});
    const [spend] = await db.select().from(schema.gameProviderSpendEntries).where(eq(schema.gameProviderSpendEntries.gameId, gameId));
    expect(spend).toMatchObject({costSource: "static_estimate", estimatedCostMicrousd: 150, actualCostMicrousd: null});
  });

  test("the game default has a shared fallback cap without charging default-primary calls", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const policy = normalizeGameModelRouting({ version: 1,
      defaultManifest: [{ catalogId: "katana:glm-5-2" }], defaultModelMaxFallbackCalls: 1,
      houseManifest: [{ catalogId: "openai:gpt-6-luna" }], overrides: {}, excludedCatalogIds: [] });
    const modelRouting = sealGameModelRouting(policy, [{ id: "default" },
      ...["a", "b"].map(id => ({ id, preference: { catalogId: "openai:gpt-6-luna" } }))]);
    await db.update(schema.games).set({ config: JSON.stringify({ modelRouting }) }).where(eq(schema.games.id, gameId));
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = (id: string) => {
      const value = makeIntent(gameId, ownerEpoch);
      value.coordinate.actor = { id, name: id, role: "player" };
      value.attemptId += `-${id}`;
      return value;
    };
    await allocateAndReserve(hooks, intent("default"));
    await allocateAndReserve(hooks, intent("a"));
    await expect(allocateAndReserve(hooks, intent("b"))).rejects.toBeInstanceOf(ProviderCallBudgetExhaustedError);
    const rows = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId));
    expect(rows.map(row => row.fallbackBudgetKey).sort()).toEqual([null, "contestants:katana:glm-5-2"].sort());
  });

  test("episode naming uses independent House authority and rejects expired or misused leases", async () => {
    const gameId = await insertGame(db), lease = randomUUID();
    const policy = normalizeGameModelRouting({ version: 1,
      defaultManifest: [{ catalogId: "openai:gpt-6-luna" }],
      houseManifest: [{ catalogId: "katana:glm-5-2" }], overrides: {}, excludedCatalogIds: [] });
    await db.update(schema.games).set({ config: JSON.stringify({ modelRouting: policy }) }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameEpisodePresentations).values({ gameId, status: "generating", revision: 3, leaseToken: lease, leaseUntil: new Date(Date.now() + 60_000).toISOString() });
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch: lease, episodeLease: { revision: 3 } });
    const intent = makeIntent(gameId, lease);
    intent.coordinate.actor = { role: "house", name: "The House" };
    intent.coordinate.action = "house.episode_copy";
    intent.coordinate.semantic = { version: 1, kind: "episode_copy", revision: 3 };
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent, { outcome: { kind: "usable" }, disposition: "accepted", acceptedValue: { title: "Eight Voices", description: "Meet the cast." } }));
    expect(await hooks.onReadAccepted?.(intent.coordinate)).toMatchObject({ value: { title: "Eight Voices" } });
    await expect(hooks.onAllocateAttemptOrdinal?.({ ...intent.coordinate, actor: { role: "player", name: "Intruder", id: "intruder" } })).rejects.toThrow("another responsibility");
    await db.update(schema.gameEpisodePresentations).set({ leaseUntil: new Date(0).toISOString() }).where(eq(schema.gameEpisodePresentations.gameId, gameId));
    await expect(hooks.onReadAccepted?.(intent.coordinate)).rejects.toThrow("lease expired");
  });

  test("accepted delivery is a separate durable bucket document and never enters recovery", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);
    const normalized = normalizeAudioPayload({ message: "<soft>Trust Ada.</soft>", thinking: "Check her vote." },
      { fields: ["message", "thinking"], nighttime: true });
    const record = makeRecord(intent, { outcome: { kind: "usable" }, disposition: "accepted",
      acceptedValue: normalized.value, audioDelivery: normalized.audioDelivery });
    await hooks.onTerminal?.(record);
    await hooks.onTerminal?.(record);
    const [row] = await db.select().from(schema.providerLogicalCalls).where(eq(schema.providerLogicalCalls.gameId, gameId));
    expect(row!.audioDelivery).toMatchObject({ storage: "private-payload-v1", codec: "json-gzip" });
    expect(JSON.stringify(row!.audioDelivery)).not.toContain("Trust Ada");
    const [hydrated] = await loadPayloads([row!]);
    expect(hydrated!.audioDelivery).toEqual(normalized.audioDelivery);
    const ref = row!.audioDelivery!;
    // Production corruption must not turn gameplay recovery into an audio read.
    const bytes = testPayloadStore.objects.get(ref.key)!;
    testPayloadStore.objects.delete(ref.key);
    try {
      const restored = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
      const replay = await restored.onReadAccepted?.(intent.coordinate);
      expect(replay?.value).toEqual({ message: "Trust Ada.", thinking: "Check her vote." });
      expect(JSON.stringify(replay)).not.toContain("<soft>");
      await expect(loadPayloads([row!])).rejects.toThrow("Test payload missing");
    } finally { testPayloadStore.objects.set(ref.key, bytes); }
    await expect(hooks.onTerminal?.({ ...record, audioDelivery: { version: 1, fields: [] } })).rejects.toThrow();
  });

  test("annotation upload failure cannot publish a partial accepted result", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);
    const normalized = normalizeAudioPayload({ message: "<soft>Wait.</soft>" }, { fields: ["message"], nighttime: true });
    const ref = await storeJson(normalized.audioDelivery);
    testPayloadStore.objects.delete(ref.key);
    setPayloadObjectStoreForTests({
      get: key => testPayloadStore.get(key),
      putIfAbsent: (key, bytes) => {
        if (key === ref.key) throw new Error("Annotation storage unavailable");
        return testPayloadStore.putIfAbsent(key, bytes);
      },
    });
    try {
      await expect(hooks.onTerminal?.(makeRecord(intent, { outcome: { kind: "usable" }, disposition: "accepted",
        acceptedValue: normalized.value, audioDelivery: normalized.audioDelivery }))).rejects.toThrow("Annotation storage unavailable");
      const [row] = await db.select().from(schema.providerLogicalCalls).where(eq(schema.providerLogicalCalls.gameId, gameId));
      expect(row).toMatchObject({ acceptedAttemptId: null, acceptedValue: null, audioDelivery: null });
    } finally { setPayloadObjectStoreForTests(testPayloadStore); }
  });

  test("context overflow survives restart, fences the rejected revision, and permits an adapted request", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const intent = { ...makeIntent(gameId, ownerEpoch), context: { sourceHash: sha256StableJson({ frozen: true }), revision: 0, maxAttempts: 2 } };
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent, { outcome: { kind: "context_overflow", message: "context window exceeded", retryable: false }, disposition: "retry_scheduled" }));
    const recovered = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    expect(await recovered.onReadContextAttempts?.(intent.coordinate)).toEqual([{ catalogId: "katana:glm-5-2", sourceHash: intent.context.sourceHash, revision: 0, outcome: "context_overflow" }]);
    const retry = { ...makeIntent(gameId, ownerEpoch, 2), context: intent.context };
    expect(await recovered.onAllocateAttemptOrdinal?.(retry.coordinate)).toBe(2);
    await expect(recovered.onReserve?.(retry)).rejects.toThrow("exhausted");
    const adapted = { ...makeIntent(gameId, ownerEpoch, 3), context: { ...intent.context, revision: 1 } };
    await allocateAndReserve(recovered, adapted);
    await recovered.onTerminal?.(makeRecord(adapted, { outcome: { kind: "usable" }, disposition: "accepted", acceptedValue: { target: "Bea" } }));
    expect(await recovered.onReadAccepted?.(intent.coordinate)).toMatchObject({ value: { target: "Bea" } });
    const [row] = await db.select().from(schema.providerLogicalCalls);
    expect(row!.acceptedValue).toHaveProperty("key");
  });

  test("explicit retrospective recovery reopens the latest context revision and its failed summaries", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const original = makeIntent(gameId, ownerEpoch);
    const parent = { ...original, coordinate: { ...original.coordinate, action: "retrospective-statement" },
      context: { sourceHash: sha256StableJson({ frozen: true }), revision: 3, maxAttempts: 2 } };
    await allocateAndReserve(hooks, parent);
    await hooks.onTerminal?.(makeRecord(parent, { outcome: { kind: "context_overflow", message: "too long", retryable: false } }));
    const child = new ProviderExecutionCoordinator({ hooks }).startCall(parent.coordinate).startContextCall(parent.context.sourceHash, 3, 1);
    const summary = { ...original, coordinate: child.coordinate, attemptId: "summary" };
    await allocateAndReserve(hooks, summary);
    await hooks.onTerminal?.(makeRecord(summary, { outcome: { kind: "context_overflow", message: "chunk too long", retryable: false } }));
    const parentId = providerLogicalCallId(gameId, parent.coordinate);
    await db.update(schema.games).set({ config: JSON.stringify({ retrospectiveResume: {
      logicalCallId: parentId, resumedAt: "2026-08-23T00:00:02.000Z",
    } }) }).where(eq(schema.games.id, gameId));
    expect(await hooks.onReadContextAttempts?.(parent.coordinate)).toMatchObject([{ revision: 3, outcome: null }]);
    expect(await hooks.onReadContextAttempts?.(child.coordinate)).toMatchObject([{ revision: 3, outcome: null }]);
    await allocateAndReserve(hooks, { ...parent, attemptOrdinal: 2, attemptId: "resumed-parent", startedAt: "2026-08-23T00:00:03.000Z" });
    await allocateAndReserve(hooks, { ...summary, attemptOrdinal: 2, attemptId: "resumed-summary", startedAt: "2026-08-23T00:00:03.000Z" });
  });

  test("summary child acceptance uses object storage without accepting or occupying the planned parent slot", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const binding = await insertPlannedDurableTurn(db, { gameId, ownerEpoch });
    const parent = bindDurableTurn(makeIntent(gameId, ownerEpoch), binding);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const call = new ProviderExecutionCoordinator({ hooks }).startCall(parent.coordinate);
    const child = call.startContextCall(sha256StableJson({ frozen: true }), 1, 0);
    const intent = { ...makeIntent(gameId, ownerEpoch), coordinate: child.coordinate };
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent, { outcome: { kind: "usable" }, disposition: "accepted", acceptedValue: { summary: "Ada promised protection." } }));
    expect(await hooks.onReadAccepted?.(parent.coordinate)).toBeUndefined();
    expect(await hooks.onReadAccepted?.(child.coordinate)).toMatchObject({ value: { summary: "Ada promised protection." } });
    const [row] = await db.select().from(schema.providerLogicalCalls);
    expect(row!.gameTurnId).toBeNull();
    expect(row!.acceptedValue).toHaveProperty("key");
    await allocateAndReserve(hooks, { ...parent, attemptId: "parent-dispatch" });
    expect(await db.select().from(schema.providerLogicalCalls)).toHaveLength(2);
    await db.update(schema.gameRunOwners).set({ status: "revoked" }).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
    await expect(hooks.onReadAccepted?.(child.coordinate)).rejects.toThrow("revoked");
  });

  test("summary failures keep a durable attempt budget and inherit parent intent authorization", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const binding = await insertPlannedDurableTurn(db, { gameId, ownerEpoch });
    const parent = bindDurableTurn(makeIntent(gameId, ownerEpoch), binding);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const child = new ProviderExecutionCoordinator({ hooks }).startCall(parent.coordinate).startContextCall(sha256StableJson({ frozen: true }), 1, 0);
    for (let ordinal = 1; ordinal <= 2; ordinal++) {
      const intent = { ...makeIntent(gameId, ownerEpoch, ordinal), coordinate: child.coordinate };
      await allocateAndReserve(hooks, intent); await hooks.onTerminal?.(makeRecord(intent));
    }
    const retry = { ...makeIntent(gameId, ownerEpoch, 3), coordinate: child.coordinate };
    expect(await hooks.onAllocateAttemptOrdinal?.(retry.coordinate)).toBe(3);
    await expect(hooks.onReserve?.(retry)).rejects.toThrow("exhausted");
    await expect(hooks.onAllocateAttemptOrdinal?.({ ...child.coordinate, action: "different-action" })).rejects.toThrow("planned intent");
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

    const logicalCalls = await loadPayloads(db.select().from(schema.providerLogicalCalls));
    const attempts = await db.select().from(schema.providerCallAttempts);
    expect(logicalCalls).toHaveLength(1);
    expect(logicalCalls[0]).toMatchObject({
      gameId,
      actorId: "atlas-id",
      action: "vote",
      round: 2,
      semanticCoordinate: expect.objectContaining({ kind: "phase_call", canonicalEventSequence: 3 }),
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      logicalCallId: logicalCalls[0]!.id,
      attemptOrdinal: 1,
      transportAttemptId: `transport-${gameId}-1`,
      status: "reserved",
    });
  });

  test("persists a semantic coordinate without packed numeric ordinals", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const baseIntent = makeIntent(gameId, ownerEpoch);
    const intent: ProviderAttemptIntent = {
      ...baseIntent,
      coordinate: {
        ...baseIntent.coordinate,
        semantic: {
          version: 1,
          kind: "diary_exchange",
          sessionEventSequence: 4,
          playerId: "atlas-id",
          exchangeOrdinal: 2,
        },
      },
    };

    await allocateAndReserve(hooks, intent);

    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0])
      .toMatchObject({
        semanticCoordinate: {
          version: 1,
          kind: "diary_exchange",
          sessionEventSequence: 4,
          playerId: "atlas-id",
          exchangeOrdinal: 2,
        },
      });
  });

  test("persists the exact planned durable subcall binding before dispatch", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const durableTurn = await insertPlannedDurableTurn(db, { gameId, ownerEpoch });
    const intent = bindDurableTurn(makeIntent(gameId, ownerEpoch), durableTurn);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });

    expect(await hooks.onAllocateAttemptOrdinal?.(intent.coordinate)).toBe(1);
    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
      id: durableProviderLogicalCallId({ gameId, turnId: durableTurn.turnId, subcallSlot: 1 }),
      gameId,
      actorId: "atlas-id",
      action: "vote",
      gameTurnId: durableTurn.turnId,
      gameTurnSubcallSlot: 1,
    });
    await hooks.onReserve?.(intent);
    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      logicalCallId: durableProviderLogicalCallId({ gameId, turnId: durableTurn.turnId, subcallSlot: 1 }),
      status: "reserved",
    });
  });

  test("rejects any durable coordinate or reservation outside the planned subcall", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const durableTurn = await insertPlannedDurableTurn(db, { gameId, ownerEpoch });
    const intent = bindDurableTurn(makeIntent(gameId, ownerEpoch), durableTurn);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const invalidCoordinates = [{
      ...intent.coordinate,
      actor: { ...intent.coordinate.actor, id: "maya-id" },
    }, {
      ...intent.coordinate,
      action: "lobby",
    }, {
      ...intent.coordinate,
      semantic: { version: 1 as const, kind: "durable_turn" as const, turnId: durableTurn.turnId, subcallSlot: 2 },
      durableTurn: { ...durableTurn, subcallSlot: 2 },
    }, {
      ...intent.coordinate,
      semantic: { version: 1 as const, kind: "durable_turn" as const, turnId: "turn:unplanned", subcallSlot: 1 },
      durableTurn: { ...durableTurn, turnId: "turn:unplanned" },
    }];
    for (const coordinate of invalidCoordinates) {
      await expect(hooks.onAllocateAttemptOrdinal?.(coordinate)).rejects.toThrow(
        /was not planned|does not match its planned intent/,
      );
    }
    expect(await loadPayloads(db.select().from(schema.providerLogicalCalls))).toHaveLength(0);

    expect(await hooks.onAllocateAttemptOrdinal?.(intent.coordinate)).toBe(1);
    await expect(hooks.onReserve?.({
      ...intent,
      coordinate: { ...intent.coordinate, action: "lobby" },
    })).rejects.toThrow("does not match its planned intent");
    expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(0);
  });

  test("replays a durable accepted value after the planned turn is adopted", async () => {
    const gameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, gameId);
    const durableTurn = await insertPlannedDurableTurn(db, {
      gameId,
      ownerEpoch: firstOwnerEpoch,
    });
    const firstIntent = bindDurableTurn(
      makeIntent(gameId, firstOwnerEpoch),
      durableTurn,
    );
    let dispatches = 0;
    const execute = (
      hooks: ReturnType<typeof createApiProviderExecutionHooks>,
      intent: ProviderAttemptIntent,
    ) => new ProviderExecutionCoordinator({ hooks }).startCall(intent.coordinate).execute({
      preparedRequest: intent.preparedRequest,
      maxAttempts: 1,
      dispatch: async () => {
        dispatches += 1;
        return { target: "maya", rationale: "best move" };
      },
      validate: (response) => ({ status: "usable", value: response }),
    });

    expect(await execute(
      createApiProviderExecutionHooks(db, { gameId, ownerEpoch: firstOwnerEpoch }),
      firstIntent,
    )).toEqual({ target: "maya", rationale: "best move" });
    expect(dispatches).toBe(1);

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, firstOwnerEpoch),
    ));
    const secondOwnerEpoch = await insertOwner(db, gameId);
    const recoveredIntent = bindDurableTurn(
      makeIntent(gameId, secondOwnerEpoch),
      durableTurn,
    );
    const recoveredHooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch: secondOwnerEpoch,
    });
    await expect(execute(recoveredHooks, recoveredIntent)).rejects.toThrow(
      "was not adopted by the active owner",
    );

    await db.update(schema.gameTurns).set({ plannedOwnerEpoch: secondOwnerEpoch })
      .where(eq(schema.gameTurns.id, durableTurn.turnId));
    expect(await execute(recoveredHooks, recoveredIntent)).toEqual({
      target: "maya",
      rationale: "best move",
    });
    expect(dispatches).toBe(1);
    expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(1);
  });

  test("replays a pre-R33 planned turn after deriving its semantic binding", async () => {
    const gameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, gameId);
    const durableTurn = await insertPlannedDurableTurn(db, {
      gameId,
      ownerEpoch: firstOwnerEpoch,
      preR33: true,
    });
    const firstIntent = bindDurableTurn(makeIntent(gameId, firstOwnerEpoch), durableTurn);
    let dispatches = 0;
    const execute = (
      hooks: ReturnType<typeof createApiProviderExecutionHooks>,
      intent: ProviderAttemptIntent,
    ) => new ProviderExecutionCoordinator({ hooks }).startCall(intent.coordinate).execute({
      preparedRequest: intent.preparedRequest,
      maxAttempts: 1,
      dispatch: async () => {
        dispatches += 1;
        return { target: "maya", rationale: "best move" };
      },
      validate: (response) => ({ status: "usable", value: response }),
    });

    await expect(execute(
      createApiProviderExecutionHooks(db, { gameId, ownerEpoch: firstOwnerEpoch }),
      firstIntent,
    )).resolves.toEqual({ target: "maya", rationale: "best move" });
    await db.execute(sql`
      UPDATE ${schema.providerLogicalCalls}
      SET semantic_coordinate = NULL, semantic_coordinate_hash = NULL
      WHERE game_id = ${gameId}
    `);

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, firstOwnerEpoch),
    ));
    const secondOwnerEpoch = await insertOwner(db, gameId);
    await db.update(schema.gameTurns).set({ plannedOwnerEpoch: secondOwnerEpoch })
      .where(eq(schema.gameTurns.id, durableTurn.turnId));
    const recoveredIntent = bindDurableTurn(makeIntent(gameId, secondOwnerEpoch), durableTurn);
    await expect(execute(
      createApiProviderExecutionHooks(db, { gameId, ownerEpoch: secondOwnerEpoch }),
      recoveredIntent,
    )).resolves.toEqual({ target: "maya", rationale: "best move" });
    expect(dispatches).toBe(1);
  });

  test("keeps reservation identity immutable while transport evidence captures the exact HTTP request", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const evidenceStorage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage,
    });
    const credential = "katana-secret-value";
    const evidenceFetch = createProviderEvidenceFetch(
      async () => Response.json(
        { error: { code: "invalid_prompt", message: "Prompt rejected" } },
        {
          status: 400,
          headers: { "x-request-id": "req-transport-capture" },
        },
      ),
      [credential],
    );
    const preparedRequest = makeIntent(gameId, ownerEpoch).preparedRequest;
    const call = new ProviderExecutionCoordinator({ hooks }).startCall(
      makeIntent(gameId, ownerEpoch).coordinate,
    );

    await expect(call.execute({
      preparedRequest: {
        ...preparedRequest,
        credentialValues: [credential],
      },
      maxAttempts: 1,
      dispatch: async ({ requestOptions }) => {
        const response = await evidenceFetch(
          "https://kat.imgnai.com/v1/chat/completions?api_key=reflected",
          {
            method: "POST",
            headers: {
              ...requestOptions.headers,
              authorization: `Bearer ${credential}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(preparedRequest.body),
          },
        );
        return {
          status: response.status,
          body: await response.json(),
        };
      },
      validate: () => ({
        status: "unusable" as const,
        kind: "refusal" as const,
        message: "Prompt rejected",
        retryable: false,
      }),
    })).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

    const attempt = (await db.select().from(schema.providerCallAttempts))[0]!;
    expect(attempt).toMatchObject({
      status: "terminal",
      outcomeKind: "refusal",
      providerRequestId: "req-transport-capture",
    });
    expect(evidenceStorage.puts).toHaveLength(1);
    const evidence = JSON.parse(evidenceStorage.puts[0]!.body) as {
      attempt: {
        preparedRequest: { catalogId?: string; url?: string };
        rawRequest?: { catalogId?: string; url?: string; headers?: Record<string, string> };
      };
    };
    expect(evidence.attempt.preparedRequest).toMatchObject({
      catalogId: "katana:glm-5-2",
    });
    expect(evidence.attempt.rawRequest).toMatchObject({
      catalogId: "katana:glm-5-2",
      url: "https://kat.imgnai.com/v1/chat/completions?api_key=%5BREDACTED%5D",
    });
    expect(evidence.attempt.rawRequest?.headers).not.toHaveProperty("authorization");
    expect(evidenceStorage.puts[0]!.body).not.toContain(credential);
  });

  test("atomically permits only one concurrent dispatch for the final fallback budget unit", async () => {
    const gameId = await insertGame(db);
    await db.update(schema.games).set({
      config: JSON.stringify({
        providerManifest: [
          {
            catalogId: "openai:gpt-5.6-luna",
            reasoningPolicy: "action-policy",
          },
          {
            catalogId: "katana:glm-5-2",
            reasoningPolicy: "action-policy",
            maxCallsPerGame: 1,
          },
        ],
        modelSelection: {
          catalogId: "openai:gpt-5.6-luna",
          reasoningPolicy: "action-policy",
        },
      }),
    }).where(eq(schema.games.id, gameId));
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const first = makeIntent(gameId, ownerEpoch);
    const second: ProviderAttemptIntent = {
      ...makeIntent(gameId, ownerEpoch),
      coordinate: {
        ...makeIntent(gameId, ownerEpoch).coordinate,
        semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 2, canonicalEventSequence: 3, callSlot: 2 },
      },
      attemptId: `transport-${gameId}-second-call`,
    };

    expect(await hooks.onAllocateAttemptOrdinal?.(first.coordinate)).toBe(1);
    expect(await hooks.onAllocateAttemptOrdinal?.(second.coordinate)).toBe(1);
    const outcomes = await Promise.allSettled([
      hooks.onReserve?.(first),
      hooks.onReserve?.(second),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(ProviderCallBudgetExhaustedError);
    expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(1);
  });

  test("opens provider health atomically while allowing calls reserved before the open to finish", async () => {
    const gameId = await insertGame(db);
    await db.update(schema.games).set({
      config: JSON.stringify({
        modelSelection: {
          catalogId: "openai:gpt-5.6-luna",
          reasoningPolicy: "action-policy",
        },
        providerManifest: [
          {
            catalogId: "openai:gpt-5.6-luna",
            reasoningPolicy: "action-policy",
          },
          {
            catalogId: "katana:glm-5-2",
            reasoningPolicy: "action-policy",
            maxCallsPerGame: 8,
          },
        ],
      }),
    }).where(eq(schema.games.id, gameId));
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const opensCircuit = makeIntent(gameId, ownerEpoch);
    const alreadyReserved: ProviderAttemptIntent = {
      ...makeIntent(gameId, ownerEpoch),
      coordinate: {
        ...makeIntent(gameId, ownerEpoch).coordinate,
        semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 2, canonicalEventSequence: 3, callSlot: 2 },
      },
      attemptId: `transport-${gameId}-already-reserved`,
    };
    await allocateAndReserve(hooks, opensCircuit);
    await allocateAndReserve(hooks, alreadyReserved);

    await expect(hooks.onTerminal?.(makeRecord(opensCircuit, {
      outcome: { kind: "authentication", message: "expired key", retryable: false },
    }))).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    await expect(hooks.onTerminal?.(makeRecord(alreadyReserved, {
      outcome: { kind: "usable" },
      disposition: "accepted",
      rawResponse: undefined,
    }))).resolves.toMatchObject({ acceptedAttemptId: expect.any(String) });

    const future: ProviderAttemptIntent = {
      ...makeIntent(gameId, ownerEpoch),
      coordinate: {
        ...makeIntent(gameId, ownerEpoch).coordinate,
        semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 2, canonicalEventSequence: 3, callSlot: 3 },
      },
      attemptId: `transport-${gameId}-future`,
    };
    expect(await hooks.onAllocateAttemptOrdinal?.(future.coordinate)).toBe(1);
    await expect(hooks.onReserve?.(future)).rejects.toMatchObject({
      name: "ProviderCircuitOpenError",
      scopeKey: "provider:katana",
      haltManifest: true,
    });
    expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(2);
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

    const logicalCalls = await loadPayloads(db.select().from(schema.providerLogicalCalls));
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

    await expect(firstHooks.onTerminal?.(makeRecord(firstIntent, {
      accounting: {
        actualCostMicrousd: 4_200,
        actualCostSource: "router_actual",
      },
    }))).rejects.toThrow(/owner/i);
    attempts = await db.select().from(schema.providerCallAttempts)
      .orderBy(schema.providerCallAttempts.attemptOrdinal);
    expect(attempts[0]).toMatchObject({
      status: "indeterminate",
      indeterminateReason: "owner_lost_before_terminal",
      spendProjectionState: "projected",
    });
    expect((await db.select().from(schema.gameProviderSpendEntries))[0]).toMatchObject({
      callStatus: "unknown",
      costSource: "unavailable",
    });
  });

  test("replays one accepted validated result after owner recovery without redispatch", async () => {
    const gameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, gameId);
    const coordinate = makeIntent(gameId, firstOwnerEpoch).coordinate;
    let dispatches = 0;
    const first = await new ProviderExecutionCoordinator({
      hooks: createApiProviderExecutionHooks(db, {
        gameId,
        ownerEpoch: firstOwnerEpoch,
      }),
    }).startCall(coordinate).executeManifest({
      entries: [{
        catalogId: "katana:glm-5-2",
        preparedRequest: {
          transport: "openai.chat_completions",
          providerProfileId: "katana",
          catalogId: "katana:glm-5-2",
          model: "glm-5-2",
          body: { model: "glm-5-2", messages: [{ role: "user", content: "Vote." }] },
        },
        maxAttempts: 1,
        dispatch: async () => {
          dispatches += 1;
          return { target: "maya", rationale: "best move" };
        },
        validate: (response) => ({ status: "usable", value: response }),
      }],
    });
    expect(first.value).toEqual({ target: "maya", rationale: "best move" });
    expect(first.acceptedAttemptId).toBeString();
    expect(dispatches).toBe(1);

    const decisionId = providerAcceptedDecisionId(first.acceptedAttemptId!);
    let linkedSequence = 0;
    const committedEvents = createCanonicalEventFixture(gameId).map((event) => {
      if (linkedSequence === 0 && event.type === "vote.cast") {
        linkedSequence = event.sequence;
        return {
          ...event,
          sourcePointers: [{
            kind: "agent_turn" as const,
            actorId: "atlas-id",
            action: "vote",
            round: event.round,
            phase: Phase.VOTE,
            decisionId,
          }],
        };
      }
      return event;
    });
    await appendGameEvents(db, {
      gameId,
      ownerEpoch: firstOwnerEpoch,
      events: committedEvents,
    });
    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
      canonicalEventSequence: linkedSequence,
    });

    await db.update(schema.gameRunOwners).set({ status: "closed" }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, firstOwnerEpoch),
    ));
    const secondOwnerEpoch = await insertOwner(db, gameId);
    const recoveredCoordinate = {
      ...coordinate,
      ownerEpoch: secondOwnerEpoch,
    };
    const recovered = await new ProviderExecutionCoordinator({
      hooks: createApiProviderExecutionHooks(db, {
        gameId,
        ownerEpoch: secondOwnerEpoch,
      }),
    }).startCall(recoveredCoordinate).executeManifest({
      entries: [{
        catalogId: "katana:glm-5-2",
        preparedRequest: {
          transport: "openai.chat_completions",
          providerProfileId: "katana",
          catalogId: "katana:glm-5-2",
          model: "glm-5-2",
          body: { model: "glm-5-2", messages: [{ role: "user", content: "Vote." }] },
        },
        maxAttempts: 1,
        dispatch: async () => {
          dispatches += 1;
          return { target: "orion" };
        },
        validate: (response) => ({ status: "usable", value: response }),
      }],
    });

    expect(recovered).toMatchObject({
      value: { target: "maya", rationale: "best move" },
      catalogId: "katana:glm-5-2",
      manifestPosition: 0,
    });
    expect(dispatches).toBe(1);
    expect(await db.select().from(schema.providerCallAttempts)).toHaveLength(1);
  });

  test("commits accepted provider provenance with the canonical event transaction", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const intent = makeIntent(gameId, ownerEpoch);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    await allocateAndReserve(hooks, intent);
    const receipt = await hooks.onTerminal?.(makeRecord(intent, {
      outcome: { kind: "usable" },
      disposition: "accepted",
      rawResponse: undefined,
    }));
    expect(receipt?.acceptedAttemptId).toBeString();
    const decisionId = providerAcceptedDecisionId(receipt!.acceptedAttemptId!);
    let linkedSequence = 0;
    const events = createCanonicalEventFixture(gameId).map((event) => {
      if (linkedSequence === 0 && event.type === "vote.cast") {
        linkedSequence = event.sequence;
        return {
          ...event,
          sourcePointers: [{
            kind: "agent_turn" as const,
            actorId: "atlas",
            action: "vote",
            round: event.round,
            phase: Phase.VOTE,
            decisionId,
          }],
        };
      }
      return event;
    });

    await appendGameEvents(db, { gameId, ownerEpoch, events });
    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
      acceptedAttemptId: receipt!.acceptedAttemptId,
      canonicalEventSequence: linkedSequence,
      canonicalCommittedAt: events[linkedSequence - 1]!.timestamp,
    });
  });

  test("a stale owner cannot replace indeterminate spend with a late terminal result", async () => {
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

    await expect(firstHooks.onTerminal?.(makeRecord(firstIntent, {
      accounting: {
        actualCostMicrousd: 9_100,
        actualCostSource: "router_actual",
      },
    }))).rejects.toThrow(/owner/i);
    releaseStaleProjection();
    expect(await staleReconciliation).toEqual({
      attempted: 1,
      projected: 1,
      failed: 0,
    });

    expect((await db.select().from(schema.gameProviderSpendEntries))[0]).toMatchObject({
      sourceKey: expect.stringContaining("provider-attempt:"),
      callStatus: "unknown",
      costSource: "unavailable",
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
      await runtime.runOnce();
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
    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

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
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(1);
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
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(0);
  });

  test("manifest failure is nonfatal and leaves the exact handoff retryable", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const evidenceDependencies = {
      createManifest: async () => {
        throw new Error("manifest unavailable");
      },
    };
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies,
    });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);

    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
      dependencies: evidenceDependencies,
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(1);
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
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(0);
  });

  test("state-finalization failure reuses the manifest and object on reconciliation", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const evidenceDependencies = {
      finalize: async () => {
        throw new Error("attempt state unavailable");
      },
    };
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
      evidenceDependencies,
    });
    const intent = makeIntent(gameId, ownerEpoch);
    await allocateAndReserve(hooks, intent);

    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
      dependencies: evidenceDependencies,
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });
    expect(storage.puts).toHaveLength(1);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(1);
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(1);

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect(storage.puts).toHaveLength(1);
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(0);
    expect((await db.select().from(schema.providerCallAttempts))[0]!.evidenceState)
      .toBe("stored");
  });

  test("keeps raw evidence degradation nonfatal and marks the attempt", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage(
      new Error("object storage unavailable"),
    );
    const hooks = createApiProviderExecutionHooks(db, {
      gameId,
      ownerEpoch,
      evidenceStorage: storage,
    });
    const intent = makeIntent(gameId, ownerEpoch);

    await allocateAndReserve(hooks, intent);
    await expect(hooks.onTerminal?.(makeRecord(intent))).resolves.toBeUndefined();
    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });

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

  test("preserves successful thinking/native reasoning and rate-limit evidence alongside aggregates", async () => {
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
      acceptedValue: { text: null, thinking: "Nothing consequential to add; listen." },
      rawResponse: { status: 200, body: { reasoning: "native summary", encrypted_content: "opaque-native-reasoning" } },
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

    const call = (await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]!;
    expect(call).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "recovered",
    });
    expect(storage.puts).toHaveLength(0);
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);
    expect(await reconcileProviderAttemptEvidence(db, { evidenceStorage: storage })).toMatchObject({ stored: 2, failed: 0 });
    const retained = storage.puts.map(put => JSON.parse(put.body).attempt);
    expect(retained.find(attempt => attempt.outcome.kind === "usable")).toMatchObject({
      acceptedValue: { text: null, thinking: "Nothing consequential to add; listen." },
      rawResponse: { body: { reasoning: "native summary", encrypted_content: "opaque-native-reasoning" } },
    });
    expect(retained.find(attempt => attempt.outcome.kind === "rate_limit").rawResponse.body).toEqual({ error: { message: "slow down" } });

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
    const exhaustedCall = (await loadPayloads(db
      .select()
      .from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.gameId, exhaustedGameId))))[0]!;
    expect(exhaustedCall).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "exhausted",
      rateLimitTerminalReason: "rate limit exhausted",
    });
    expect(await reconcileProviderAttemptEvidence(db, { evidenceStorage: storage })).toMatchObject({ stored: 1, failed: 0 });
    expect(storage.puts).toHaveLength(3);
  });

  test("retains introduction evidence at round zero", async () => {
    const gameId = await insertGame(db), ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const base = makeIntent(gameId, ownerEpoch);
    const intent: ProviderAttemptIntent = { ...base, coordinate: { ...base.coordinate, round: 0,
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 } } };
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent, { outcome: { kind: "usable" }, disposition: "accepted", acceptedValue: { thinking: "Introduction rationale" } }));
    expect(await reconcileProviderAttemptEvidence(db, { evidenceStorage: storage })).toMatchObject({ stored: 1, failed: 0 });
    expect(JSON.parse(storage.puts[0]!.body).attempt.coordinate.round).toBe(0);
  });

  test("does not report a pending rate limit as recovered after unrelated failures", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    const rateLimitedIntent = makeIntent(gameId, ownerEpoch, 1);
    const retryFailureIntent = makeIntent(gameId, ownerEpoch, 2);
    const terminalFailureIntent = makeIntent(gameId, ownerEpoch, 3);

    await allocateAndReserve(hooks, rateLimitedIntent);
    await hooks.onTerminal?.(makeRecord(rateLimitedIntent, {
      outcome: { kind: "rate_limit", message: "slow down", retryable: true },
      disposition: "retry_scheduled",
      rawResponse: { status: 429, body: { error: "slow down" } },
    }));
    await allocateAndReserve(hooks, retryFailureIntent);
    await hooks.onTerminal?.(makeRecord(retryFailureIntent, {
      outcome: { kind: "service_error", message: "upstream unavailable", retryable: true },
      disposition: "retry_scheduled",
      rawResponse: { status: 503, body: { error: "unavailable" } },
    }));

    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "pending",
      rateLimitTerminalReason: null,
    });

    await allocateAndReserve(hooks, terminalFailureIntent);
    await hooks.onTerminal?.(makeRecord(terminalFailureIntent, {
      outcome: { kind: "refusal", message: "invalid prompt", retryable: false },
      disposition: "exhausted",
      rawResponse: { status: 400, body: { error: "invalid prompt" } },
    }));

    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
      rateLimitCount: 1,
      rateLimitOutcome: "exhausted",
      rateLimitTerminalReason: "invalid prompt",
    });
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
    expect((await loadPayloads(db.select().from(schema.providerLogicalCalls)))[0]).toMatchObject({
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

    let releaseWrite!: () => void;
    const writeMayContinue = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writes = 0;
    const delayedWrite: NonNullable<
      import("./provider-call-journal.js").ProviderEvidenceReconciliationDependencies["write"]
    > = async (writeDb, prepared) => {
      writes += 1;
      await writeMayContinue;
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
    await Bun.sleep(10);
    expect(writes).toBe(1);
    releaseWrite();
    expect(await Promise.all([first, second])).toEqual([
      { attempted: 1, stored: 1, failed: 0 },
      { attempted: 0, stored: 0, failed: 0 },
    ]);

    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      evidenceState: "stored",
      evidenceError: null,
    });
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(0);
  });

  test("rejects corrupt evidence metadata before storage and backs the row off", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakeProviderEvidenceStorage();
    const intent = makeIntent(gameId, ownerEpoch);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent));
    await db.update(schema.providerAttemptEvidenceOutbox).set({
      manifestMetadata: { formatVersion: 1 },
    }).where(eq(schema.providerAttemptEvidenceOutbox.gameId, gameId));

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });
    expect(storage.puts).toHaveLength(0);
    const outbox = (await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox)))[0]!;
    expect(outbox).toMatchObject({
      reconciliationAttemptCount: 1,
      claimToken: null,
      claimExpiresAt: null,
    });
    expect(Date.parse(outbox.nextReconciliationAt)).toBeGreaterThan(Date.now());
    expect((await db.select().from(schema.providerCallAttempts))[0]).toMatchObject({
      evidenceState: "degraded",
      evidenceError: expect.stringContaining("manifest actor"),
    });
  });

  test("backs off a failing oldest row so newer evidence is not starved", async () => {
    const firstGameId = await insertGame(db);
    const firstOwnerEpoch = await insertOwner(db, firstGameId);
    const firstIntent = makeIntent(firstGameId, firstOwnerEpoch);
    const firstHooks = createApiProviderExecutionHooks(db, {
      gameId: firstGameId,
      ownerEpoch: firstOwnerEpoch,
    });
    await allocateAndReserve(firstHooks, firstIntent);
    await firstHooks.onTerminal?.(makeRecord(firstIntent));

    const secondGameId = await insertGame(db);
    const secondOwnerEpoch = await insertOwner(db, secondGameId);
    const secondIntent = makeIntent(secondGameId, secondOwnerEpoch);
    const secondHooks = createApiProviderExecutionHooks(db, {
      gameId: secondGameId,
      ownerEpoch: secondOwnerEpoch,
    });
    await allocateAndReserve(secondHooks, secondIntent);
    await secondHooks.onTerminal?.(makeRecord(secondIntent));
    const storage = new FakeProviderEvidenceStorage();

    expect(await reconcileProviderAttemptEvidence(db, {
      limit: 1,
      evidenceStorage: storage,
      dependencies: {
        write: async () => ({ ok: false, error: "first object unavailable" }),
      },
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });
    expect(await reconcileProviderAttemptEvidence(db, {
      limit: 1,
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect((await db.select().from(schema.providerCallAttempts)
      .where(eq(schema.providerCallAttempts.gameId, secondGameId)))[0])
      .toMatchObject({ evidenceState: "stored" });
  });

  test("reclaims an expired evidence worker claim", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const intent = makeIntent(gameId, ownerEpoch);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent));
    await db.update(schema.providerAttemptEvidenceOutbox).set({
      claimToken: "abandoned-worker",
      claimExpiresAt: "2020-01-01T00:00:00.000Z",
      nextReconciliationAt: "2020-01-01T00:00:00.000Z",
    });

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: new FakeProviderEvidenceStorage(),
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });
    expect(await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox))).toHaveLength(0);
  });

  test("runtime startup does not wait for stalled evidence storage", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const intent = makeIntent(gameId, ownerEpoch);
    const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
    await allocateAndReserve(hooks, intent);
    await hooks.onTerminal?.(makeRecord(intent));
    const stalledStorage: PrivateTraceStorageAdapter = {
      putObject: (input) => new Promise((_resolve, reject) => {
        input.abortSignal?.addEventListener("abort", () => {
          reject(input.abortSignal?.reason ?? new Error("aborted"));
        }, { once: true });
      }),
      getObject: async () => ({ body: "" }),
      headObject: async () => ({}),
    };
    const startedAt = Date.now();
    const runtime = await startProviderAttemptReconciliationRuntime(db, {
      intervalMs: 60_000,
      evidenceWriteTimeoutMs: 5,
      evidenceStorage: stalledStorage,
    });
    expect(Date.now() - startedAt).toBeLessThan(100);
    try {
      expect((await runtime.runOnce()).evidence).toEqual({
        attempted: 1, stored: 0, failed: 1,
      });
      const outbox = (await loadPayloads(db.select().from(schema.providerAttemptEvidenceOutbox)))[0];
      expect(outbox?.claimToken).toBeNull();
    } finally {
      await runtime.stop();
    }
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
      costSource: "static_estimate",
      estimatedCostMicrousd: 520,
      pricingSourceId: "https://kat.imgnai.com/v1/models/text",
      rateCardVersion: "2026-10-23",
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
          transport: "openai.chat_completions",
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

    expect(await reconcileProviderAttemptEvidence(db, {
      evidenceStorage: storage,
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

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
