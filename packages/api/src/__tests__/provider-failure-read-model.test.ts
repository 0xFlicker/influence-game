import { describe, expect, test } from "bun:test";
import {
  getProviderFailureDetail,
  getProviderFailureSummaryMap,
} from "../services/provider-failure-read-model.js";

describe("provider failure read model", () => {
  test("projects exact non-429 failures and aggregate recovered and exhausted rate limits chronologically", async () => {
    const calls = [
      logicalCall({
        id: "call-recovered",
        rateLimitCount: 2,
        rateLimitOutcome: "recovered",
        updatedAt: "2026-08-23T10:01:00.000Z",
      }),
      logicalCall({
        id: "call-terminal",
        action: "nominate",
        rateLimitCount: 3,
        rateLimitOutcome: "exhausted",
        rateLimitTerminalReason: "retry_budget_exhausted",
        createdAt: "2026-08-23T10:02:00.000Z",
        updatedAt: "2026-08-23T10:03:00.000Z",
      }),
    ];
    const attempts = [
      attempt({
        id: "refusal",
        logicalCallId: "call-recovered",
        attemptOrdinal: 1,
        outcomeKind: "refusal",
        outcomeMessage: "invalid_prompt",
        disposition: "retry_scheduled",
        evidenceState: "stored",
        evidenceManifestId: "manifest-refusal",
        completedAt: "2026-08-23T10:00:30.000Z",
      }),
      attempt({
        id: "usable",
        logicalCallId: "call-recovered",
        attemptOrdinal: 2,
        outcomeKind: "usable",
        disposition: "accepted",
        completedAt: "2026-08-23T10:01:00.000Z",
      }),
      attempt({
        id: "service-error",
        logicalCallId: "call-terminal",
        attemptOrdinal: 1,
        outcomeKind: "service_error",
        outcomeMessage: "provider unavailable",
        disposition: "exhausted",
        evidenceState: "degraded",
        evidenceError: "object storage unavailable",
        completedAt: "2026-08-23T10:02:30.000Z",
      }),
    ];
    const db = fakeSelectDb(calls, attempts);

    const detail = await getProviderFailureDetail(db as never, "game-1");

    expect(detail.summary).toMatchObject({
      state: "terminal",
      failureCount: 7,
      exactFailureCount: 2,
      rateLimitCount: 5,
      recoveredCount: 2,
      terminalCount: 1,
      degradedCount: 1,
    });
    expect(detail.failures.map((failure) => [failure.kind, failure.state])).toEqual([
      ["attempt", "recovered"],
      ["rate_limit", "recovered"],
      ["attempt", "degraded"],
      ["rate_limit", "terminal"],
    ]);
    expect(detail.failures[0]).toMatchObject({
      kind: "attempt",
      transport: "openai.responses",
      evidence: { state: "available", manifestId: "manifest-refusal" },
    });
    expect(detail.failures[3]).toMatchObject({
      kind: "rate_limit",
      count: 3,
      terminalReason: "retry_budget_exhausted",
    });
    expect(detail.budgets).toEqual([
      expect.objectContaining({
        catalogId: "openai:gpt-5.6-luna",
        role: "primary",
        usedCalls: 3,
        maxCallsPerGame: null,
        remainingCalls: null,
        state: "unbounded",
      }),
    ]);
  });

  test("keeps the admin list read to one grouped query regardless of game count", async () => {
    const gameIds = Array.from({ length: 200 }, (_, index) => `game-${index}`);
    const db = fakeSelectDb([], []);

    const summaries = await getProviderFailureSummaryMap(db as never, gameIds);

    expect(db.executeCount).toBe(1);
    expect(summaries.size).toBe(200);
    expect(summaries.get("game-199")?.state).toBe("empty");
  });

  test("reports exhausted fallback budgets and does not render unavailable cost as zero", async () => {
    const attempts = [
      attempt({ id: "grok-1", catalogId: "katana:grok-4-5" }),
      attempt({ id: "grok-2", catalogId: "katana:grok-4-5", attemptOrdinal: 2 }),
      attempt({ id: "glm-1", catalogId: "katana:glm-5-2" }),
    ];
    const db = fakeSelectDb([], attempts, {
      providerManifest: [
        { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
        { catalogId: "katana:grok-4-5", reasoningPolicy: "high", maxCallsPerGame: 2 },
        { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy", maxCallsPerGame: 3 },
      ],
      modelSelection: {
        catalogId: "openai:gpt-5.6-luna",
        reasoningPolicy: "action-policy",
      },
    }, [
      {
        catalogId: "katana:grok-4-5",
        costSource: "router_actual",
        actualCostMicrousd: 0,
        estimatedCostMicrousd: null,
      },
      {
        catalogId: "katana:glm-5-2",
        costSource: "unavailable",
        actualCostMicrousd: null,
        estimatedCostMicrousd: null,
      },
    ]);

    const detail = await getProviderFailureDetail(db as never, "game-1");

    expect(detail.budgets).toEqual([
      expect.objectContaining({
        catalogId: "openai:gpt-5.6-luna",
        usedCalls: 0,
        state: "unbounded",
        cost: expect.objectContaining({ state: "no_calls" }),
      }),
      expect.objectContaining({
        catalogId: "katana:grok-4-5",
        usedCalls: 2,
        remainingCalls: 0,
        state: "exhausted",
        cost: expect.objectContaining({
          state: "actual",
          actualCostMicrousd: 0,
        }),
      }),
      expect.objectContaining({
        catalogId: "katana:glm-5-2",
        usedCalls: 1,
        remainingCalls: 2,
        state: "available",
        cost: expect.objectContaining({
          state: "unavailable",
          unpricedCallCount: 1,
        }),
      }),
    ]);
  });
});

function fakeSelectDb(
  calls: unknown[],
  attempts: unknown[],
  config: Record<string, unknown> = {
    providerManifest: [{
      catalogId: "openai:gpt-5.6-luna",
      reasoningPolicy: "action-policy",
    }],
    modelSelection: {
      catalogId: "openai:gpt-5.6-luna",
      reasoningPolicy: "action-policy",
    },
  },
  spendRows: unknown[] = [],
) {
  let selectCount = 0;
  let executeCount = 0;
  return {
    get selectCount() {
      return selectCount;
    },
    get executeCount() {
      return executeCount;
    },
    execute() {
      executeCount += 1;
      return Promise.resolve([]);
    },
    select(fields: Record<string, unknown>) {
      selectCount += 1;
      const rows = Object.hasOwn(fields, "actorName")
        ? calls
        : Object.hasOwn(fields, "logicalCallId")
          ? attempts
          : Object.hasOwn(fields, "config")
            ? [{ config: JSON.stringify(config) }]
            : spendRows;
      return {
        from() {
          return {
            where() {
              const query = {
                orderBy() {
                  return Promise.resolve(rows);
                },
                then<TResult1 = unknown, TResult2 = never>(
                  onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
                  onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
                ) {
                  return Promise.resolve(rows).then(onfulfilled, onrejected);
                },
              };
              return query;
            },
          };
        },
      };
    },
  };
}

function logicalCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-recovered",
    gameId: "game-1",
    actorName: "Atlas",
    actorRole: "player",
    action: "vote",
    phase: "VOTE",
    round: 2,
    rateLimitCount: 0,
    rateLimitOutcome: null,
    rateLimitTerminalReason: null,
    diagnosticsDegraded: false,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
    ...overrides,
  };
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt",
    logicalCallId: "call-recovered",
    gameId: "game-1",
    attemptOrdinal: 1,
    providerProfileId: "openai",
    transport: "openai.responses",
    catalogId: "openai:gpt-5.6-luna",
    modelName: "gpt-5.6-luna",
    status: "terminal",
    startedAt: "2026-08-23T10:00:00.000Z",
    completedAt: "2026-08-23T10:00:10.000Z",
    outcomeKind: "refusal",
    outcomeMessage: null,
    retryable: false,
    disposition: "retry_scheduled",
    providerRequestId: null,
    evidenceState: "not_required",
    evidenceManifestId: null,
    evidenceError: null,
    ...overrides,
  };
}
