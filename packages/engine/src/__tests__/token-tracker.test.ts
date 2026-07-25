import { describe, expect, it } from "bun:test";
import { estimateCostForKnownModel, TokenTracker, type TokenUsage } from "../token-tracker";

const usage: TokenUsage = {
  promptTokens: 1000,
  cachedTokens: 0,
  completionTokens: 500,
  reasoningTokens: 0,
  totalTokens: 1500,
  callCount: 1,
  emptyResponses: 0,
};

describe("token cost estimation", () => {
  it("returns null instead of fallback pricing for unknown models", () => {
    expect(estimateCostForKnownModel(usage, "not-a-real-model")).toBeNull();
  });

  it("estimates known OpenAI models", () => {
    expect(estimateCostForKnownModel(usage, "gpt-5-nano")?.totalCost).toBeGreaterThan(0);
  });

  it("estimates Grok models without falling back to OpenAI pricing", () => {
    expect(estimateCostForKnownModel(usage, "grok-4-3")?.totalCost).toBeCloseTo(0.00275, 10);
    expect(estimateCostForKnownModel(usage, "grok-4.3")?.totalCost).toBeCloseTo(0.0025, 10);
  });

  it("uses Katana's higher Grok rate above the 200k-token request tier", () => {
    const longContextUsage: TokenUsage = {
      ...usage,
      promptTokens: 250_000,
      completionTokens: 0,
      totalTokens: 250_000,
    };

    expect(estimateCostForKnownModel(longContextUsage, "grok-4-3")?.totalCost).toBeCloseTo(0.6875, 10);
  });
});

describe("effective service-tier accounting", () => {
  it("preserves the provider-returned tiers in durable cursors", () => {
    const tracker = new TokenTracker();
    tracker.record("vote", 100, 20, 0, 0, "flex");
    tracker.record("mingle", 80, 10, 0, 0, "auto");
    tracker.record("mingle", 70, 10, 0, 0, "auto");

    const cursor = tracker.toCursor();
    expect(cursor.effectiveServiceTiers).toEqual({ flex: 1, auto: 2 });
    expect(cursor.effectiveServiceTierUsage).toMatchObject({
      flex: { promptTokens: 100, completionTokens: 20, callCount: 1 },
      auto: { promptTokens: 150, completionTokens: 20, callCount: 2 },
    });

    const restored = new TokenTracker();
    restored.loadCursor(cursor);
    expect(restored.getEffectiveServiceTierCounts()).toEqual({ flex: 1, auto: 2 });
    expect(restored.getEffectiveServiceTierUsage()).toEqual(cursor.effectiveServiceTierUsage!);
  });

  it("hydrates legacy count-only tier cursors without duplicate tracker state", () => {
    const restored = new TokenTracker();
    restored.loadCursor({
      version: 1,
      totals: usage,
      perSource: { vote: usage },
      effectiveServiceTiers: { flex: 1 },
    });

    expect(restored.getEffectiveServiceTierCounts()).toEqual({ flex: 1 });
    expect(restored.getEffectiveServiceTierUsage()).toMatchObject({
      flex: { callCount: 1, totalTokens: 0 },
    });
  });

  it("rejects malformed effective-tier usage during cursor recovery", () => {
    const restored = new TokenTracker();
    expect(() => restored.loadCursor({
      version: 1,
      totals: usage,
      perSource: { vote: usage },
      effectiveServiceTiers: { flex: 1 },
      effectiveServiceTierUsage: {
        flex: { ...usage, promptTokens: Number.NaN, totalTokens: Number.NaN },
      },
    })).toThrow("Invalid token cost cursor");
  });

  it("prices mixed OpenAI Flex and auto responses by their effective tiers", () => {
    const tracker = new TokenTracker();
    tracker.record("vote", 1_000_000, 1_000_000, 0, 0, "flex");
    tracker.record("mingle", 1_000_000, 1_000_000, 0, 0, "auto");

    expect(estimateCostForKnownModel(
      tracker.getTotalUsage(),
      "gpt-5-nano",
      {
        providerProfileId: "openai",
        effectiveServiceTierUsage: tracker.getEffectiveServiceTierUsage(),
      },
    )?.totalCost).toBeCloseTo(0.675, 10);
  });

  it("uses standard pricing when effective-tier buckets exceed total usage", () => {
    expect(estimateCostForKnownModel(
      usage,
      "gpt-5-nano",
      {
        providerProfileId: "openai",
        effectiveServiceTierUsage: {
          flex: { ...usage, promptTokens: usage.promptTokens + 1, totalTokens: usage.totalTokens + 1 },
        },
      },
    )?.totalCost).toBeCloseTo(0.00025, 10);
  });

  it("keeps standard provider pricing when the provider does not support Flex", () => {
    expect(estimateCostForKnownModel(
      usage,
      "grok-4-3",
      {
        providerProfileId: "katana",
        effectiveServiceTierUsage: {
          flex: usage,
        },
      },
    )?.totalCost).toBeCloseTo(0.00275, 10);
  });
});
