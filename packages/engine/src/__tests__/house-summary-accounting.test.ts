import { describe, expect, it } from "bun:test";
import {
  HOUSE_SUMMARY_NEAR_BUDGET_RATIO,
  costHouseProviderUsage,
  costHouseSummaryGame,
  isHouseSummaryCostWithinEnvelope,
} from "../house-summary-accounting";
import type { HouseProviderUsage, HouseSummaryPhaseReceipt } from "../house-summary-frontier";
import { Phase } from "../types";

function usage(overrides: Partial<HouseProviderUsage> = {}): HouseProviderUsage {
  return {
    callId: "call-1",
    responseId: "response-1",
    serviceTier: "flex",
    promptTokens: 1_000,
    cachedTokens: 200,
    cacheWriteTokens: 0,
    completionTokens: 100,
    reasoningTokens: 25,
    totalTokens: 1_100,
    ...overrides,
  };
}

function receipt(overrides: Partial<HouseSummaryPhaseReceipt> = {}): HouseSummaryPhaseReceipt {
  return {
    version: 1,
    boundaryId: "1:format_pick:10:2",
    actorCoordinate: "format_pick",
    round: 1,
    phase: Phase.FORMAT_PICK,
    beatClass: "ordinary",
    status: "emitted",
    providerCalls: 1,
    factCalls: 0,
    requestedCategories: [],
    returnedBytes: 0,
    selectedSourceCount: 1,
    usageAvailable: true,
    usage: [usage()],
    pendingDelta: "none",
    ...overrides,
  };
}

describe("House summary cost accounting", () => {
  it("defines the near-budget envelope as no more than 1.25x round-only cost", () => {
    expect(HOUSE_SUMMARY_NEAR_BUDGET_RATIO).toBe(1.25);
    expect(isHouseSummaryCostWithinEnvelope(0.0017892, 0.00145)).toBe(true);
    expect(isHouseSummaryCostWithinEnvelope(0.00182, 0.00145)).toBe(false);
    expect(isHouseSummaryCostWithinEnvelope(0, 0)).toBe(false);
  });

  it("prices every returned call by its realized service tier", () => {
    const result = costHouseProviderUsage([
      usage(),
      usage({ callId: "call-2", responseId: "response-2", serviceTier: "auto" }),
    ], "gpt-5.6-luna");

    expect(result.status).toBe("exact");
    if (result.status !== "exact") return;
    expect(result.providerCalls).toBe(2);
    expect(result.totalTokens).toBe(2_200);
    expect(result.calls[0]?.costUsd).toBeLessThan(result.calls[1]?.costUsd ?? 0);
  });

  it("is inconclusive when any paid attempt lacks usage, tier, pricing, or a unique call identity", () => {
    expect(costHouseProviderUsage([usage({ responseId: null, totalTokens: null })], "gpt-5.6-luna"))
      .toMatchObject({ status: "inconclusive", reasons: expect.arrayContaining(["missing_provider_usage"]) });
    expect(costHouseProviderUsage([usage({ serviceTier: null })], "gpt-5.6-luna"))
      .toMatchObject({ status: "inconclusive", reasons: expect.arrayContaining(["missing_service_tier"]) });
    expect(costHouseProviderUsage([usage()], "unknown-model"))
      .toMatchObject({ status: "inconclusive", reasons: expect.arrayContaining(["missing_model_pricing"]) });
    expect(costHouseProviderUsage([usage(), usage()], "gpt-5.6-luna"))
      .toMatchObject({ status: "inconclusive", reasons: expect.arrayContaining(["duplicate_call_id"]) });
  });

  it("refuses exact pricing when any optional provider token metric was unreported", () => {
    for (const partial of [
      { cachedTokens: null },
      { cacheWriteTokens: null },
      { reasoningTokens: null },
      { totalTokens: null },
    ] satisfies Array<Partial<HouseProviderUsage>>) {
      expect(costHouseProviderUsage([usage(partial)], "gpt-5.6-luna")).toMatchObject({
        status: "inconclusive",
        reasons: expect.arrayContaining(["missing_provider_usage"]),
      });
    }
  });

  it("reconciles receipt call counts per boundary and per game", () => {
    const game = costHouseSummaryGame([
      receipt(),
      receipt({
        boundaryId: "1:format_resolve:14:2",
        actorCoordinate: "format_resolve",
        usage: [],
        providerCalls: 0,
        status: "preflight_skipped",
      }),
    ], "gpt-5.6-luna");

    expect(game.accounting).toMatchObject({ status: "exact", providerCalls: 1 });
    expect(game.boundaries[1]?.accounting).toMatchObject({ status: "exact", providerCalls: 0 });
  });
});
