import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import { insertGame, insertOwner } from "../__tests__/durable-run-test-utils.js";
import {
  backfillGameCostAccounting,
  getGameCostDetail,
  recordProviderSpendForTrace,
} from "./provider-cost-accounting.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-provider-cost-accounting";
});

function createTrace(overrides: Partial<PrivateDecisionTrace> = {}): PrivateDecisionTrace {
  return {
    version: 2,
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 2,
    createdAt: "2026-07-03T12:00:00.000Z",
    model: {
      provider: "openai",
      providerProfileId: "openai",
      catalogId: "openai:gpt-5-nano",
      name: "gpt-5-nano",
    },
    prompt: { messages: [{ role: "user", content: "private prompt" }] },
    response: {
      raw: {
        id: "resp_test_1",
        object: "response",
        usage: {
          input_tokens: 1000,
          output_tokens: 2000,
          input_tokens_details: { cached_tokens: 100 },
          output_tokens_details: { reasoning_tokens: 300 },
          total_tokens: 3000,
          imgnai: {
            credits_charged: 1.25,
            prompt: "must redact",
          },
        },
      },
      finishReason: "stop",
      content: "public-ish output",
    },
    ...overrides,
  };
}

describe("provider cost accounting", () => {
  test("records OpenAI Responses usage with pricing provenance and idempotent source keys", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const trace = createTrace({ gameId, ownerEpoch });

    const first = await recordProviderSpendForTrace(db, { gameId, ownerEpoch, trace });
    const second = await recordProviderSpendForTrace(db, { gameId, ownerEpoch, trace });

    expect(first.inserted).toBeTrue();
    expect(second.inserted).toBeFalse();

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gameId,
      ownerEpoch,
      captureSource: "live_trace",
      costSource: "static_estimate",
      apiSurface: "openai_responses",
      promptTokens: 1000,
      cachedTokens: 100,
      completionTokens: 2000,
      reasoningTokens: 300,
      totalTokens: 3000,
      providerNativeUnit: "katana_credit",
      providerNativeAmount: "1.25",
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-04",
    });
    expect(rows[0]!.estimatedCostMicrousd).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0]!.routerBilling)).not.toContain("must redact");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.callCount).toBe(1);
    expect(detail.detail.ownerEpochBreakdowns).toHaveLength(1);
    expect(detail.detail.providerNativeTotals.katana_credit).toBe(1.25);
    expect(detail.detail.pricing.rateCardVersions).toContain("2026-07-04");
  });

  test("records Katana router USD billing as actual cost", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch,
      trace: createTrace({
        model: {
          provider: "katana",
          providerProfileId: "katana",
          catalogId: "katana:grok-4-3",
          name: "grok-4-3",
        },
        response: {
          raw: {
            id: "katana-router-actual",
            usage: {
              prompt_tokens: 100,
              completion_tokens: 25,
              total_tokens: 125,
              imgnai: {
                credits: "17",
                providerCostUsd: "0.0042",
                prompt: "must redact",
              },
            },
          },
          finishReason: "stop",
          content: "ok",
        },
      }),
    });

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "katana",
      modelName: "grok-4-3",
      costSource: "router_actual",
      actualCostMicrousd: 4200,
      estimatedCostMicrousd: null,
      providerNativeUnit: "katana_credit",
      providerNativeAmount: "17",
    });
    expect(JSON.stringify(rows[0]!.routerBilling)).not.toContain("must redact");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.state).toBe("actual");
    expect(detail.detail.unpricedCallCount).toBe(0);
    expect(detail.detail.actualCostMicrousd).toBe(4200);
  });

  test("classifies incomplete provider responses as failed spend", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch,
      trace: createTrace({
        response: {
          raw: {
            id: "resp_failed_status",
            object: "response",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
          finishReason: "failed",
        },
      }),
    });

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.failedCallCount).toBe(1);
    expect(detail.detail.retryFailureSpend.failedCallCount).toBe(1);
  });

  test("sums per-game cost across recovered owner epochs", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const firstOwner = await insertOwner(db, gameId, { ownerEpoch: "owner-one", status: "closed" });
    const secondOwner = await insertOwner(db, gameId, { ownerEpoch: "owner-two" });

    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch: firstOwner,
      trace: createTrace({ createdAt: "2026-07-03T12:00:00.000Z" }),
    });
    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch: secondOwner,
      trace: createTrace({
        createdAt: "2026-07-03T12:01:00.000Z",
        response: {
          raw: {
            id: "resp_test_2",
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          },
          finishReason: "stop",
        },
      }),
    });

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.callCount).toBe(2);
    expect(detail.detail.ownerEpochBreakdowns.map((entry) => entry.ownerEpoch).sort()).toEqual([
      "owner-one",
      "owner-two",
    ]);
  });

  test("backfills trace manifests once without double-counting terminal aggregates", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-cost-test",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "house", name: "House", role: "house" },
        action: "question",
        phase: "JURY_QUESTIONS",
        round: 4,
        model: { provider: "openai", providerProfileId: "openai-default", catalogId: "openai:gpt-5-nano", name: "gpt-5-nano" },
        modelName: "gpt-5-nano",
        usage: {
          promptTokens: 400,
          completionTokens: 100,
          totalTokens: 500,
        },
        createdAt: "2026-07-03T13:00:00.000Z",
      },
    });
    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: null,
      roundsPlayed: 4,
      tokenUsage: JSON.stringify({ totalTokens: 57000 }),
      finishedAt: "2026-07-03T14:00:00.000Z",
    });

    const first = await backfillGameCostAccounting(db, gameId);
    const second = await backfillGameCostAccounting(db, gameId);

    expect(first.inserted).toBe(1);
    expect(first.diagnostics).toEqual(["terminal_result:skipped_call_level_rows_present"]);
    expect(second.inserted).toBe(0);

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.backfill.traceBackfilledEntries).toBe(1);
    expect(detail.detail.backfill.terminalBackfilledEntries).toBe(0);
    expect(detail.detail.callCount).toBe(1);
  });

  test("backfills total-token-only trace manifests with conservative estimates", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-total-only-cost-test",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "lobby",
        phase: "LOBBY",
        round: 1,
        model: { provider: "openai", providerProfileId: "openai-default", catalogId: "openai:gpt-5-nano", name: "gpt-5-nano" },
        modelName: "gpt-5-nano",
        usage: { totalTokens: 100_000 },
        createdAt: "2026-07-03T13:00:00.000Z",
      },
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(1);
    expect(result.diagnostics).toEqual([]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorName: "Atlas",
      actorRole: "player",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 100_000,
      costSource: "static_estimate",
    });
    expect(rows[0]!.estimatedCostMicrousd).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("aggregate_usage_estimate");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    const actorBreakdowns = detail.detail.breakdowns.actor as Record<string, { estimatedCostMicrousd: number }>;
    expect(actorBreakdowns.Atlas?.estimatedCostMicrousd).toBeGreaterThan(0);
  });

  test("backfills Grok trace manifests with Katana rate-card estimates when billing is absent", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-grok-total-only-cost-test",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "orion", name: "Orion", role: "player" },
        action: "introduction",
        phase: "INTRODUCTION",
        round: 0,
        model: { provider: "katana", providerProfileId: "katana", catalogId: "katana:grok-4-3", name: "grok-4-3" },
        modelName: "grok-4-3",
        usage: { totalTokens: 100_000 },
        createdAt: "2026-07-03T13:00:00.000Z",
      },
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(1);
    expect(result.diagnostics).toEqual([]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorName: "Orion",
      provider: "katana",
      modelName: "grok-4-3",
      costSource: "static_estimate",
      totalTokens: 100_000,
      estimatedCostMicrousd: 137500,
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-04",
    });
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("aggregate_usage_estimate");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.unpricedCallCount).toBe(0);
    expect(detail.detail.estimatedCostMicrousd).toBe(137500);
  });

  test("uses Katana's high-context Grok rate card for large backfilled calls", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-grok-high-context-cost-test",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "orion", name: "Orion", role: "player" },
        action: "reflection",
        model: { provider: "katana", providerProfileId: "katana", catalogId: "katana:grok-4-3", name: "grok-4-3" },
        modelName: "grok-4-3",
        usage: { totalTokens: 250_000 },
        createdAt: "2026-07-03T13:00:00.000Z",
      },
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(1);
    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costSource: "static_estimate",
      modelName: "grok-4-3",
      totalTokens: 250_000,
      estimatedCostMicrousd: 687500,
      rateCardVersion: "2026-07-04",
    });
  });

  test("reprices existing zero-cost total-token-only backfill rows on rerun", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-existing-zero-cost",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "lobby",
        model: { provider: "openai", name: "gpt-5-nano" },
        modelName: "gpt-5-nano",
        usage: { totalTokens: 100_000 },
      },
    });
    await db.insert(schema.gameProviderSpendEntries).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      sourceKey: "manifest:manifest-existing-zero-cost",
      captureSource: "trace_manifest_backfill",
      costSource: "static_estimate",
      callStatus: "unknown",
      traceManifestId: "manifest-existing-zero-cost",
      actorName: "Atlas",
      actorRole: "player",
      action: "lobby",
      modelName: "gpt-5-nano",
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100_000,
      estimatedCostMicrousd: 0,
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-03",
      diagnostics: { items: [] },
      observedAt: "2026-07-03T13:00:00.000Z",
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual([
      "spend_entries:repriced_static_estimate_rows",
      "spend_entries:repriced_aggregate_usage_rows",
    ]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estimatedCostMicrousd).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-04",
    });
    expect(rows[0]!.pricedAt).not.toBe("2026-07-03T13:00:00.000Z");
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("repriced_existing_spend_entry");
  });

  test("upgrades existing zero-cost estimate rows from Katana router billing on rerun", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-existing-katana-actual",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "orion", name: "Orion", role: "player" },
        action: "introduction",
        model: { provider: "katana", name: "grok-4-3" },
        modelName: "grok-4-3",
        usage: {
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          routerBilling: { credits: "17", providerCostUsd: "0.0042" },
        },
      },
    });
    await db.insert(schema.gameProviderSpendEntries).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      sourceKey: "manifest:manifest-existing-katana-actual",
      captureSource: "trace_manifest_backfill",
      costSource: "static_estimate",
      callStatus: "unknown",
      traceManifestId: "manifest-existing-katana-actual",
      actorName: "Orion",
      actorRole: "player",
      action: "introduction",
      provider: "katana",
      modelName: "grok-4-3",
      promptTokens: 100,
      cachedTokens: 0,
      completionTokens: 25,
      reasoningTokens: 0,
      totalTokens: 125,
      estimatedCostMicrousd: 0,
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-03",
      pricedAt: "2026-07-03T13:00:00.000Z",
      routerBilling: { credits: "17", providerCostUsd: "0.0042" },
      diagnostics: { items: [] },
      observedAt: "2026-07-03T13:00:00.000Z",
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual(["spend_entries:repriced_router_actual_rows"]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costSource: "router_actual",
      actualCostMicrousd: 4200,
      estimatedCostMicrousd: null,
      pricingSourceId: null,
      rateCardVersion: null,
      pricedAt: null,
    });
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("repriced_existing_spend_entry");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.state).toBe("actual");
    expect(detail.detail.unpricedCallCount).toBe(0);
  });

  test("reprices existing unavailable total-token-only Grok backfill rows on rerun", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-existing-grok-unavailable",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "orion", name: "Orion", role: "player" },
        action: "lobby",
        model: { provider: "katana", name: "grok-4-3" },
        modelName: "grok-4-3",
        usage: { totalTokens: 100_000 },
      },
    });
    await db.insert(schema.gameProviderSpendEntries).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      sourceKey: "manifest:manifest-existing-grok-unavailable",
      captureSource: "trace_manifest_backfill",
      costSource: "unavailable",
      callStatus: "unknown",
      traceManifestId: "manifest-existing-grok-unavailable",
      actorName: "Orion",
      actorRole: "player",
      action: "lobby",
      provider: "katana",
      modelName: "grok-4-3",
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100_000,
      diagnostics: { items: ["cost_unavailable"] },
      observedAt: "2026-07-03T13:00:00.000Z",
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual([
      "spend_entries:repriced_static_estimate_rows",
      "spend_entries:repriced_aggregate_usage_rows",
    ]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costSource: "static_estimate",
      estimatedCostMicrousd: 137500,
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-04",
    });
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("aggregate_usage_estimate");
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("repriced_existing_spend_entry");
    expect(JSON.stringify(rows[0]!.diagnostics)).not.toContain("cost_unavailable");
  });

  test("reprices existing unavailable live trace rows on backfill rerun", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-existing-live-grok-unavailable",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "orion", name: "Orion", role: "player" },
        action: "lobby",
        model: { provider: "katana", name: "grok-4-3" },
        modelName: "grok-4-3",
        usage: { totalTokens: 100_000 },
      },
    });
    await db.insert(schema.gameProviderSpendEntries).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      sourceKey: `live:${gameId}:${ownerEpoch}:existing-unavailable`,
      captureSource: "live_trace",
      costSource: "unavailable",
      callStatus: "unknown",
      traceManifestId: "manifest-existing-live-grok-unavailable",
      actorName: "Orion",
      actorRole: "player",
      action: "lobby",
      provider: "katana",
      modelName: "grok-4-3",
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 100_000,
      diagnostics: { items: ["cost_unavailable"] },
      observedAt: "2026-07-03T13:00:00.000Z",
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual([
      "spend_entries:repriced_static_estimate_rows",
      "spend_entries:repriced_aggregate_usage_rows",
    ]);

    const rows = await db.select().from(schema.gameProviderSpendEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      captureSource: "live_trace",
      costSource: "static_estimate",
      estimatedCostMicrousd: 137500,
      pricingSourceId: "engine.MODEL_PRICING",
      rateCardVersion: "2026-07-04",
    });
    expect(JSON.stringify(rows[0]!.diagnostics)).toContain("repriced_existing_spend_entry");
    expect(JSON.stringify(rows[0]!.diagnostics)).not.toContain("cost_unavailable");

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.unpricedCallCount).toBe(0);
    expect(detail.detail.estimatedCostMicrousd).toBe(137500);
  });

  test("uses terminal result backfill only when no call-level ledger rows exist", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);

    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: null,
      roundsPlayed: 4,
      tokenUsage: JSON.stringify({ totalTokens: 57000, estimatedCost: 0.42 }),
      finishedAt: "2026-07-03T14:00:00.000Z",
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(1);
    expect(result.diagnostics).toEqual([]);

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.backfill.traceBackfilledEntries).toBe(0);
    expect(detail.detail.backfill.terminalBackfilledEntries).toBe(1);
    expect(detail.detail.callCount).toBe(1);
    expect(detail.detail.estimatedCostMicrousd).toBe(420000);
  });

  test("removes terminal aggregate fallback once call-level rows become available", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: null,
      roundsPlayed: 4,
      tokenUsage: JSON.stringify({ totalTokens: 57000, estimatedCost: 0.42 }),
      finishedAt: "2026-07-03T14:00:00.000Z",
    });
    await backfillGameCostAccounting(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-after-terminal-fallback",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        phase: "VOTE",
        round: 1,
        model: { provider: "openai", providerProfileId: "openai-default", catalogId: "openai:gpt-5-nano", name: "gpt-5-nano" },
        modelName: "gpt-5-nano",
        usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
        createdAt: "2026-07-03T13:00:00.000Z",
      },
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(1);
    expect(result.diagnostics).toEqual([
      "terminal_result:removed_after_call_level_rows",
      "terminal_result:skipped_call_level_rows_present",
    ]);

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.callCount).toBe(1);
    expect(detail.detail.backfill.traceBackfilledEntries).toBe(1);
    expect(detail.detail.backfill.terminalBackfilledEntries).toBe(0);
    expect(detail.detail.totalTokens).toBe(50);
  });

  test("does not backfill manifests already represented by live trace rows", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "manifest-live-cost-test",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        model: { provider: "openai", name: "gpt-5-nano" },
        usage: { promptTokens: 400, completionTokens: 100, totalTokens: 500 },
      },
    });
    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: null,
      roundsPlayed: 4,
      tokenUsage: JSON.stringify({ totalTokens: 57000, estimatedCost: 0.5 }),
      finishedAt: "2026-07-03T14:00:00.000Z",
    });
    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch,
      traceManifestId: "manifest-live-cost-test",
      trace: createTrace(),
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual(["terminal_result:skipped_call_level_rows_present"]);

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.callCount).toBe(1);
    expect(detail.detail.backfill.traceBackfilledEntries).toBe(0);
    expect(detail.detail.backfill.terminalBackfilledEntries).toBe(0);
  });

  test("omits private manifest IDs from backfill diagnostics", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await db.insert(schema.gameEvidenceManifests).values({
      id: "secret-manifest-id",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: { action: "vote" },
    });

    const result = await backfillGameCostAccounting(db, gameId);

    expect(result.inserted).toBe(0);
    expect(result.diagnostics).toEqual(["trace_manifest:missing_usage"]);
    expect(JSON.stringify(result)).not.toContain("secret-manifest-id");
  });

  test("keeps rollups complete after parallel live spend captures", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    await Promise.all([1, 2, 3].map((index) => recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch,
      trace: createTrace({
        createdAt: `2026-07-03T12:0${index}:00.000Z`,
        response: {
          raw: {
            id: `resp_parallel_${index}`,
            object: "response",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
          finishReason: "completed",
        },
      }),
    })));

    const detail = await getGameCostDetail(db, gameId);
    expect(detail.ok).toBeTrue();
    if (!detail.ok) throw new Error("expected cost detail");
    expect(detail.detail.callCount).toBe(3);
    expect(detail.detail.totalTokens).toBe(45);
  });
});
