import { describe, expect, it } from "bun:test";
import { estimateCostForKnownModel, type TokenUsage } from "../token-tracker";

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
    expect(estimateCostForKnownModel(usage, "grok-4-3")).toBeNull();
  });

  it("estimates known OpenAI models", () => {
    expect(estimateCostForKnownModel(usage, "gpt-5-nano")?.totalCost).toBeGreaterThan(0);
  });
});
