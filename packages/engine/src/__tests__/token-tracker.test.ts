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

    const restored = new TokenTracker();
    restored.loadCursor(cursor);
    expect(restored.getEffectiveServiceTierCounts()).toEqual({ flex: 1, auto: 2 });
  });
});
