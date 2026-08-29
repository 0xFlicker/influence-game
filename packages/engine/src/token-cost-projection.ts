export interface TokenCostRateCard {
  uncachedInputPer1M: number;
  cachedReadPer1M: number;
  cacheWritePer1M: number;
  outputPer1M: number;
}

export interface CostedTokenRequest {
  promptTokens: number;
  cachedReadTokens: number;
  /** Null means the provider did not report cache writes; it does not mean zero. */
  cacheWriteTokens: number | null;
  outputTokens: number;
  /** Informational subset of outputTokens. It is never priced separately. */
  reasoningTokens?: number;
}

export interface TokenCostProjection {
  uncachedInputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheWriteReporting: "reported" | "unreported";
  uncachedInputCost: number;
  cachedReadCost: number;
  cacheWriteCost: number;
  outputCost: number;
  totalCost: number;
}

export const GPT_5_6_LUNA_STANDARD_RATE_CARD: TokenCostRateCard = {
  uncachedInputPer1M: 0.2,
  cachedReadPer1M: 0.02,
  cacheWritePer1M: 0.25,
  outputPer1M: 1.2,
};

export const GPT_5_6_LUNA_FLEX_RATE_CARD: TokenCostRateCard = {
  uncachedInputPer1M: 0.1,
  cachedReadPer1M: 0.01,
  cacheWritePer1M: 0.125,
  outputPer1M: 0.6,
};

export const COMPACT_ENVELOPE_REFERENCE_WORKLOAD = Object.freeze({
  calls: 1_225,
  uncachedInputTokens: 11_866_004,
  cachedReadTokens: 1_260_099,
  outputTokens: 541_616,
  reasoningTokens: 108_686,
  estimatedCost: 1.82,
  reflectionCalls: 184,
  reflectionTokens: 2_480_236,
  reflectionEstimatedCost: 0.39,
  structuralPromptReuseTokens: 1_033_497,
});

/**
 * Deliberately conservative envelope assumptions for the stored reference
 * workload. Delta output is charged on every retained call even though House,
 * juror, and non-strategic calls do not all carry player strategy.
 */
export const COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS = Object.freeze({
  deltaTokensPerRetainedCall: 96,
  fullStrategyUpdates: 28,
  fullStrategyTokensPerUpdate: 256,
  repairUpdates: 4,
  repairTokensPerUpdate: 256,
});

export interface CompactEnvelopeReferenceProjection {
  label: "estimate";
  costSource: "static_estimate";
  reference: TokenCostProjection & { calls: number };
  removedReflection: TokenCostProjection & { calls: number };
  candidate: TokenCostProjection & { calls: number };
  incrementalEnvelopeOutputTokens: number;
  estimatedSavings: number;
  effectiveStandardTokenShare: number;
  reflectionAllocation: {
    method: "reconciled_assumption";
    detail: string;
  };
  structuralPromptReuse: {
    tokens: number;
    billingTreatment: "provider_neutral_excluded";
  };
}

function tokenCost(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

/**
 * Projects provider spend from mutually exclusive prompt-token buckets.
 * Cache writes are explicit because they are not present in the current live
 * TokenUsage receipt; callers must not infer them from structural prompt reuse.
 */
export function projectTokenCost(
  requests: readonly CostedTokenRequest[],
  rateCard: TokenCostRateCard,
): TokenCostProjection {
  const totals = requests.reduce(
    (sum, request) => {
      const cachedReadTokens = Math.max(0, request.cachedReadTokens);
      const cacheWriteTokens = request.cacheWriteTokens === null
        ? 0
        : Math.max(0, request.cacheWriteTokens);
      const promptTokens = Math.max(0, request.promptTokens);
      const outputTokens = Math.max(0, request.outputTokens);
      const reasoningTokens = Math.max(0, request.reasoningTokens ?? 0);
      if (cachedReadTokens + cacheWriteTokens > promptTokens) {
        throw new Error("Cached read and cache write tokens cannot exceed prompt tokens");
      }
      if (reasoningTokens > outputTokens) {
        throw new Error("Reasoning tokens cannot exceed total output tokens");
      }
      sum.uncachedInputTokens += promptTokens - cachedReadTokens - cacheWriteTokens;
      sum.cachedReadTokens += cachedReadTokens;
      sum.cacheWriteTokens += cacheWriteTokens;
      sum.outputTokens += outputTokens;
      sum.reasoningTokens += reasoningTokens;
      if (request.cacheWriteTokens === null) sum.hasUnreportedCacheWrites = true;
      return sum;
    },
    {
      uncachedInputTokens: 0,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      hasUnreportedCacheWrites: false,
    },
  );

  const uncachedInputCost = tokenCost(totals.uncachedInputTokens, rateCard.uncachedInputPer1M);
  const cachedReadCost = tokenCost(totals.cachedReadTokens, rateCard.cachedReadPer1M);
  const cacheWriteCost = tokenCost(totals.cacheWriteTokens, rateCard.cacheWritePer1M);
  const outputCost = tokenCost(totals.outputTokens, rateCard.outputPer1M);
  return {
    uncachedInputTokens: totals.uncachedInputTokens,
    cachedReadTokens: totals.cachedReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    cacheWriteReporting: totals.hasUnreportedCacheWrites ? "unreported" : "reported",
    uncachedInputCost,
    cachedReadCost,
    cacheWriteCost,
    outputCost,
    totalCost: uncachedInputCost + cachedReadCost + cacheWriteCost + outputCost,
  };
}

function blendRateCards(
  lower: TokenCostRateCard,
  upper: TokenCostRateCard,
  upperShare: number,
): TokenCostRateCard {
  const blend = (low: number, high: number): number => low + ((high - low) * upperShare);
  return {
    uncachedInputPer1M: blend(lower.uncachedInputPer1M, upper.uncachedInputPer1M),
    cachedReadPer1M: blend(lower.cachedReadPer1M, upper.cachedReadPer1M),
    cacheWritePer1M: blend(lower.cacheWritePer1M, upper.cacheWritePer1M),
    outputPer1M: blend(lower.outputPer1M, upper.outputPer1M),
  };
}

function totalTokens(projection: TokenCostProjection): number {
  return projection.uncachedInputTokens
    + projection.cachedReadTokens
    + projection.cacheWriteTokens
    + projection.outputTokens;
}

/**
 * Directional, provider-free comparison for the 2026-08-14 production cost
 * snapshot. The snapshot did not retain per-action service-tier or cache-write
 * buckets, so the effective Standard/Flex share and reflection allocation are
 * reconciled assumptions, not billing facts.
 */
export function projectCompactEnvelopeReferenceScenario(): CompactEnvelopeReferenceProjection {
  const reference = COMPACT_ENVELOPE_REFERENCE_WORKLOAD;
  const referenceRequest: CostedTokenRequest = {
    promptTokens: reference.uncachedInputTokens + reference.cachedReadTokens,
    cachedReadTokens: reference.cachedReadTokens,
    cacheWriteTokens: null,
    outputTokens: reference.outputTokens,
    reasoningTokens: reference.reasoningTokens,
  };
  const flexReference = projectTokenCost([referenceRequest], GPT_5_6_LUNA_FLEX_RATE_CARD);
  const standardReference = projectTokenCost([referenceRequest], GPT_5_6_LUNA_STANDARD_RATE_CARD);
  const effectiveStandardTokenShare =
    (reference.estimatedCost - flexReference.totalCost)
    / (standardReference.totalCost - flexReference.totalCost);
  if (effectiveStandardTokenShare < 0 || effectiveStandardTokenShare > 1) {
    throw new Error("Stored reference cost cannot be reconciled between Luna Flex and Standard estimates");
  }
  const effectiveRateCard = blendRateCards(
    GPT_5_6_LUNA_FLEX_RATE_CARD,
    GPT_5_6_LUNA_STANDARD_RATE_CARD,
    effectiveStandardTokenShare,
  );
  const referenceProjection = projectTokenCost([referenceRequest], effectiveRateCard);

  // The snapshot retained reflection total tokens and cost, but not its bucket
  // split. Preserve the workload's cached-read share, solve the output bucket
  // needed to reconcile $0.39, and assign the remainder to uncached input.
  const reflectionCachedReadTokens = Math.round(
    reference.reflectionTokens
      * (reference.cachedReadTokens
        / (reference.uncachedInputTokens + reference.cachedReadTokens + reference.outputTokens)),
  );
  const reflectionOutputTokens = Math.round(
    (
      (reference.reflectionEstimatedCost * 1_000_000)
      - ((reference.reflectionTokens - reflectionCachedReadTokens) * effectiveRateCard.uncachedInputPer1M)
      - (reflectionCachedReadTokens * effectiveRateCard.cachedReadPer1M)
    ) / (effectiveRateCard.outputPer1M - effectiveRateCard.uncachedInputPer1M),
  );
  const reflectionUncachedInputTokens = reference.reflectionTokens
    - reflectionCachedReadTokens
    - reflectionOutputTokens;
  const reflectionReasoningTokens = Math.round(
    reflectionOutputTokens * (reference.reasoningTokens / reference.outputTokens),
  );
  const removedReflection = projectTokenCost([{
    promptTokens: reflectionUncachedInputTokens + reflectionCachedReadTokens,
    cachedReadTokens: reflectionCachedReadTokens,
    cacheWriteTokens: null,
    outputTokens: reflectionOutputTokens,
    reasoningTokens: reflectionReasoningTokens,
  }], effectiveRateCard);
  if (totalTokens(removedReflection) !== reference.reflectionTokens) {
    throw new Error("Reflection allocation must reconcile to the stored reflection token total");
  }

  const retainedCalls = reference.calls - reference.reflectionCalls;
  const incrementalEnvelopeOutputTokens =
    retainedCalls * COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS.deltaTokensPerRetainedCall
    + COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS.fullStrategyUpdates
      * COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS.fullStrategyTokensPerUpdate
    + COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS.repairUpdates
      * COMPACT_ENVELOPE_OUTPUT_ASSUMPTIONS.repairTokensPerUpdate;
  const candidate = projectTokenCost([{
    promptTokens:
      referenceProjection.uncachedInputTokens
      + referenceProjection.cachedReadTokens
      - removedReflection.uncachedInputTokens
      - removedReflection.cachedReadTokens,
    cachedReadTokens: referenceProjection.cachedReadTokens - removedReflection.cachedReadTokens,
    cacheWriteTokens: null,
    outputTokens:
      referenceProjection.outputTokens
      - removedReflection.outputTokens
      + incrementalEnvelopeOutputTokens,
    reasoningTokens: referenceProjection.reasoningTokens - removedReflection.reasoningTokens,
  }], effectiveRateCard);

  return {
    label: "estimate",
    costSource: "static_estimate",
    reference: { ...referenceProjection, calls: reference.calls },
    removedReflection: { ...removedReflection, calls: reference.reflectionCalls },
    candidate: { ...candidate, calls: retainedCalls },
    incrementalEnvelopeOutputTokens,
    estimatedSavings: referenceProjection.totalCost - candidate.totalCost,
    effectiveStandardTokenShare,
    reflectionAllocation: {
      method: "reconciled_assumption",
      detail: "Preserve the workload cached-read share, solve output to the stored $0.39 estimate, and treat unreported cache writes as unknown with zero assumed for projection.",
    },
    structuralPromptReuse: {
      tokens: reference.structuralPromptReuseTokens,
      billingTreatment: "provider_neutral_excluded",
    },
  };
}

export function projectedSavingsFraction(
  baseline: TokenCostProjection,
  candidate: TokenCostProjection,
): number {
  if (baseline.totalCost <= 0) return 0;
  return (baseline.totalCost - candidate.totalCost) / baseline.totalCost;
}
