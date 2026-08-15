import { describe, expect, it } from "bun:test";
import {
  COMPACT_ENVELOPE_REFERENCE_WORKLOAD,
  GPT_5_6_LUNA_FLEX_RATE_CARD,
  projectCompactEnvelopeReferenceScenario,
  projectTokenCost,
} from "../token-cost-projection";

describe("compact decision envelope cost model", () => {
  it("removes stored reflection work and adds only incremental envelope output", () => {
    const projection = projectCompactEnvelopeReferenceScenario();

    expect(projection.label).toBe("estimate");
    expect(projection.costSource).toBe("static_estimate");
    expect(projection.reference.calls).toBe(1_225);
    expect(projection.reference.totalCost).toBeCloseTo(1.82, 10);
    expect(projection.removedReflection.calls).toBe(184);
    expect(projection.removedReflection.totalCost).toBeCloseTo(0.39, 5);
    expect(projection.candidate.calls).toBe(1_041);
    expect(projection.incrementalEnvelopeOutputTokens).toBeGreaterThan(0);
    expect(projection.candidate.totalCost).toBeLessThan(projection.reference.totalCost);
    expect(projection.estimatedSavings).toBeGreaterThan(0);

    const removedTokens = projection.removedReflection.uncachedInputTokens
      + projection.removedReflection.cachedReadTokens
      + projection.removedReflection.cacheWriteTokens
      + projection.removedReflection.outputTokens;
    expect(removedTokens).toBe(COMPACT_ENVELOPE_REFERENCE_WORKLOAD.reflectionTokens);
  });

  it("prices reasoning once as an informational subset of total output", () => {
    const withReasoning = projectTokenCost([{
      promptTokens: 1_000,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500,
      reasoningTokens: 400,
    }], GPT_5_6_LUNA_FLEX_RATE_CARD);
    const withoutReasoningBreakout = projectTokenCost([{
      promptTokens: 1_000,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 500,
    }], GPT_5_6_LUNA_FLEX_RATE_CARD);

    expect(withReasoning.reasoningTokens).toBe(400);
    expect(withReasoning.outputTokens).toBe(500);
    expect(withReasoning.outputCost).toBe(withoutReasoningBreakout.outputCost);
    expect(() => projectTokenCost([{
      promptTokens: 1,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 10,
      reasoningTokens: 11,
    }], GPT_5_6_LUNA_FLEX_RATE_CARD)).toThrow("cannot exceed total output tokens");
  });

  it("distinguishes reported zero cache writes from unreported cache writes", () => {
    const reportedZero = projectTokenCost([{
      promptTokens: 100,
      cachedReadTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 10,
    }], GPT_5_6_LUNA_FLEX_RATE_CARD);
    const unreported = projectTokenCost([{
      promptTokens: 100,
      cachedReadTokens: 20,
      cacheWriteTokens: null,
      outputTokens: 10,
    }], GPT_5_6_LUNA_FLEX_RATE_CARD);

    expect(reportedZero.cacheWriteTokens).toBe(0);
    expect(reportedZero.cacheWriteReporting).toBe("reported");
    expect(unreported.cacheWriteTokens).toBe(0);
    expect(unreported.cacheWriteReporting).toBe("unreported");
  });

  it("keeps provider-neutral structural reuse outside billing claims", () => {
    const projection = projectCompactEnvelopeReferenceScenario();

    expect(projection.structuralPromptReuse).toEqual({
      tokens: 1_033_497,
      billingTreatment: "provider_neutral_excluded",
    });
    expect(projection.reflectionAllocation.method).toBe("reconciled_assumption");
  });
});
