export interface TokenCostRateCard {
  uncachedInputPer1M: number;
  cachedReadPer1M: number;
  cacheWritePer1M: number;
  outputPer1M: number;
}

export interface CostedTokenRequest {
  promptTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface TokenCostProjection {
  uncachedInputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  uncachedInputCost: number;
  cachedReadCost: number;
  cacheWriteCost: number;
  outputCost: number;
  totalCost: number;
}

export const GPT_5_6_LUNA_STANDARD_RATE_CARD: TokenCostRateCard = {
  uncachedInputPer1M: 1,
  cachedReadPer1M: 0.1,
  cacheWritePer1M: 1.25,
  outputPer1M: 6,
};

export const GPT_5_6_LUNA_FLEX_RATE_CARD: TokenCostRateCard = {
  uncachedInputPer1M: 0.1,
  cachedReadPer1M: 0.01,
  cacheWritePer1M: 0.125,
  outputPer1M: 0.6,
};

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
      const cacheWriteTokens = Math.max(0, request.cacheWriteTokens);
      const promptTokens = Math.max(0, request.promptTokens);
      if (cachedReadTokens + cacheWriteTokens > promptTokens) {
        throw new Error("Cached read and cache write tokens cannot exceed prompt tokens");
      }
      sum.uncachedInputTokens += promptTokens - cachedReadTokens - cacheWriteTokens;
      sum.cachedReadTokens += cachedReadTokens;
      sum.cacheWriteTokens += cacheWriteTokens;
      sum.outputTokens += Math.max(0, request.outputTokens);
      return sum;
    },
    {
      uncachedInputTokens: 0,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    },
  );

  const uncachedInputCost = tokenCost(totals.uncachedInputTokens, rateCard.uncachedInputPer1M);
  const cachedReadCost = tokenCost(totals.cachedReadTokens, rateCard.cachedReadPer1M);
  const cacheWriteCost = tokenCost(totals.cacheWriteTokens, rateCard.cacheWritePer1M);
  const outputCost = tokenCost(totals.outputTokens, rateCard.outputPer1M);
  return {
    ...totals,
    uncachedInputCost,
    cachedReadCost,
    cacheWriteCost,
    outputCost,
    totalCost: uncachedInputCost + cachedReadCost + cacheWriteCost + outputCost,
  };
}

export function projectedSavingsFraction(
  baseline: TokenCostProjection,
  candidate: TokenCostProjection,
): number {
  if (baseline.totalCost <= 0) return 0;
  return (baseline.totalCost - candidate.totalCost) / baseline.totalCost;
}
