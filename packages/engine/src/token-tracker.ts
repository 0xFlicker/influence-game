/**
 * Influence Game - Token Usage Tracking & Cost Estimation
 *
 * Tracks LLM token usage per-agent and per-game, and estimates costs
 * across multiple model pricing tiers. Supports cached input token tracking
 * for OpenAI gpt-5 family models.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  /** Number of prompt tokens served from OpenAI's prefix cache. */
  cachedTokens: number;
  completionTokens: number;
  /** Number of completion tokens consumed by internal reasoning (CoT). */
  reasoningTokens: number;
  totalTokens: number;
  callCount: number;
  /** Number of calls that returned empty/fallback due to budget exhaustion. */
  emptyResponses: number;
}

export interface ModelPricing {
  /** Cost per 1M input tokens in USD */
  inputPer1M: number;
  /** Cost per 1M cached input tokens in USD */
  cachedInputPer1M: number;
  /** Cost per 1M output tokens in USD */
  outputPer1M: number;
  /** Optional total-token request tiers. When matched, the tier rate applies to the whole request. */
  tiers?: ModelPricingTier[];
}

export interface ModelPricingTier {
  minTotalTokens?: number;
  maxTotalTokens?: number;
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export interface CostEstimate {
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface ServiceTierCostContext {
  /** Only hosted OpenAI supports Flex pricing. */
  providerProfileId?: string;
  /** Provider-returned usage buckets. Missing or non-Flex buckets use standard pricing. */
  effectiveServiceTierUsage?: Record<string, TokenUsage>;
  /** Convenience for pricing one provider response. */
  effectiveServiceTier?: string;
}

// ---------------------------------------------------------------------------
// Pricing table (published provider pricing)
// ---------------------------------------------------------------------------

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Legacy models (no cache discount — cached = uncached)
  "gpt-4o-mini": { inputPer1M: 0.15, cachedInputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4o": { inputPer1M: 2.50, cachedInputPer1M: 2.50, outputPer1M: 10.0 },
  "o4-mini": { inputPer1M: 1.10, cachedInputPer1M: 1.10, outputPer1M: 4.40 },
  "gpt-4.1-nano": { inputPer1M: 0.10, cachedInputPer1M: 0.10, outputPer1M: 0.40 },
  "gpt-4.1-mini": { inputPer1M: 0.40, cachedInputPer1M: 0.40, outputPer1M: 1.60 },
  "gpt-4.1": { inputPer1M: 2.00, cachedInputPer1M: 2.00, outputPer1M: 8.00 },
  // gpt-5 family (90% cache discount)
  "gpt-5-nano": { inputPer1M: 0.05, cachedInputPer1M: 0.005, outputPer1M: 0.40 },
  "gpt-5-mini": { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2.00 },
  "gpt-5": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10.00 },
  "gpt-5.4-mini": { inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.50 },
  // Grok 4.3 family. Katana uses hyphenated model IDs and includes router markup.
  "grok-4-3": {
    inputPer1M: 1.375,
    cachedInputPer1M: 0.22,
    outputPer1M: 2.75,
    tiers: [
      { maxTotalTokens: 200_000, inputPer1M: 1.375, cachedInputPer1M: 0.22, outputPer1M: 2.75 },
      { minTotalTokens: 200_001, inputPer1M: 2.75, cachedInputPer1M: 0.44, outputPer1M: 5.50 },
    ],
  },
  // xAI native APIs use the dotted ID.
  "grok-4.3": { inputPer1M: 1.25, cachedInputPer1M: 0.20, outputPer1M: 2.50 },
};

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export function estimateCost(usage: TokenUsage, pricing: ModelPricing): CostEstimate;
export function estimateCost(usage: TokenUsage, model: string): CostEstimate;
export function estimateCost(usage: TokenUsage, pricingOrModel: ModelPricing | string): CostEstimate {
  const basePricing = typeof pricingOrModel === "string"
    ? MODEL_PRICING[pricingOrModel] ?? MODEL_PRICING["gpt-5-nano"]!
    : pricingOrModel;
  const pricing = pricingForUsage(basePricing, usage.totalTokens);
  const model = typeof pricingOrModel === "string" ? pricingOrModel : "custom";

  const cached = usage.cachedTokens ?? 0;
  const uncached = usage.promptTokens - cached;
  const inputCost =
    (uncached / 1_000_000) * pricing.inputPer1M +
    (cached / 1_000_000) * pricing.cachedInputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;

  return {
    model,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

function pricingForUsage(pricing: ModelPricing, totalTokens: number): ModelPricing {
  const tier = pricing.tiers?.find((candidate) => {
    const aboveMinimum = candidate.minTotalTokens === undefined || totalTokens >= candidate.minTotalTokens;
    const belowMaximum = candidate.maxTotalTokens === undefined || totalTokens <= candidate.maxTotalTokens;
    return aboveMinimum && belowMaximum;
  });
  return tier ?? pricing;
}

const OPENAI_FLEX_RATE_MULTIPLIER = 0.5;

function scaleCost(estimate: CostEstimate, multiplier: number): CostEstimate {
  return {
    ...estimate,
    inputCost: estimate.inputCost * multiplier,
    outputCost: estimate.outputCost * multiplier,
    totalCost: estimate.totalCost * multiplier,
  };
}

function estimateCostForServiceTier(
  usage: TokenUsage,
  pricing: ModelPricing,
  serviceTier: string | undefined,
  providerProfileId: string | undefined,
): CostEstimate {
  const estimate = estimateCost(usage, pricing);
  // OpenAI documents Flex tokens at Batch API rates (50% of standard for
  // the supported text models in this engine). Never discount compatible providers.
  return providerProfileId === "openai" && serviceTier === "flex"
    ? scaleCost(estimate, OPENAI_FLEX_RATE_MULTIPLIER)
    : estimate;
}

function subtractUsage(total: TokenUsage, used: TokenUsage): TokenUsage {
  return {
    promptTokens: Math.max(0, total.promptTokens - used.promptTokens),
    cachedTokens: Math.max(0, total.cachedTokens - used.cachedTokens),
    completionTokens: Math.max(0, total.completionTokens - used.completionTokens),
    reasoningTokens: Math.max(0, total.reasoningTokens - used.reasoningTokens),
    totalTokens: Math.max(0, total.totalTokens - used.totalTokens),
    callCount: Math.max(0, total.callCount - used.callCount),
    emptyResponses: Math.max(0, total.emptyResponses - used.emptyResponses),
  };
}

function addCost(left: CostEstimate, right: CostEstimate): CostEstimate {
  return {
    model: left.model,
    inputCost: left.inputCost + right.inputCost,
    outputCost: left.outputCost + right.outputCost,
    totalCost: left.totalCost + right.totalCost,
  };
}

export function estimateCostForKnownModel(
  usage: TokenUsage,
  model: string,
  context: ServiceTierCostContext = {},
): CostEstimate | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  if (context.effectiveServiceTier) {
    return {
      ...estimateCostForServiceTier(
        usage,
        pricing,
        context.effectiveServiceTier,
        context.providerProfileId,
      ),
      model,
    };
  }

  const tierUsage = context.effectiveServiceTierUsage;
  if (context.providerProfileId !== "openai" || !tierUsage || Object.keys(tierUsage).length === 0) {
    return { ...estimateCost(usage, pricing), model };
  }
  const classifiedUsage = sumTokenUsage(Object.values(tierUsage));
  if (Object.keys(usage).some(
    (key) => classifiedUsage[key as keyof TokenUsage] > usage[key as keyof TokenUsage],
  )) {
    return { ...estimateCost(usage, pricing), model };
  }

  let remainingUsage = { ...usage };
  let total: CostEstimate = { model, inputCost: 0, outputCost: 0, totalCost: 0 };
  for (const [serviceTier, bucket] of Object.entries(tierUsage)) {
    total = addCost(total, {
      ...estimateCostForServiceTier(bucket, pricing, serviceTier, context.providerProfileId),
      model,
    });
    remainingUsage = subtractUsage(remainingUsage, bucket);
  }

  // Unclassified response usage is intentionally priced at the standard rate.
  return addCost(total, { ...estimateCost(remainingUsage, pricing), model });
}

/**
 * Estimate costs for the given usage across ALL known model tiers.
 */
export function estimateCostAllModels(
  usage: TokenUsage,
  context: Pick<ServiceTierCostContext, "effectiveServiceTierUsage"> = {},
): CostEstimate[] {
  return Object.keys(MODEL_PRICING).map((model) => estimateCostForKnownModel(
    usage,
    model,
    {
      providerProfileId: model.startsWith("grok-") ? "katana" : "openai",
      effectiveServiceTierUsage: context.effectiveServiceTierUsage,
    },
  )!);
}

// ---------------------------------------------------------------------------
// TokenTracker - accumulates usage per source (agent name or "house")
// ---------------------------------------------------------------------------

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  callCount: 0,
  emptyResponses: 0,
};

export function sumTokenUsage(usages: Iterable<TokenUsage>): TokenUsage {
  const total = { ...EMPTY_USAGE };
  for (const usage of usages) {
    total.promptTokens += usage.promptTokens;
    total.cachedTokens += usage.cachedTokens;
    total.completionTokens += usage.completionTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.totalTokens += usage.totalTokens;
    total.callCount += usage.callCount;
    total.emptyResponses += usage.emptyResponses;
  }
  return total;
}

export function isValidTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<keyof TokenUsage, unknown>;
  const countKeys: Array<keyof TokenUsage> = [
    "promptTokens",
    "cachedTokens",
    "completionTokens",
    "reasoningTokens",
    "totalTokens",
    "callCount",
    "emptyResponses",
  ];
  if (!countKeys.every((key) =>
    typeof usage[key] === "number"
    && Number.isFinite(usage[key])
    && Number.isInteger(usage[key])
    && usage[key] >= 0
  )) {
    return false;
  }
  const typedUsage = usage as unknown as TokenUsage;
  return typedUsage.cachedTokens <= typedUsage.promptTokens
    && typedUsage.totalTokens === typedUsage.promptTokens + typedUsage.completionTokens;
}

export function readEffectiveOpenAIServiceTier(
  providerProfileId: string | undefined,
  response: unknown,
): string | undefined {
  if (providerProfileId !== "openai" || !response || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }
  const value = (response as Record<string, unknown>).service_tier;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export class TokenTracker {
  private readonly perSource: Map<string, TokenUsage> = new Map();
  private readonly effectiveServiceTierUsage: Map<string, TokenUsage> = new Map();

  /** Record a single LLM call's usage. */
  record(
    source: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0,
    reasoningTokens = 0,
    effectiveServiceTier?: string,
  ): void {
    const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
    existing.promptTokens += promptTokens;
    existing.cachedTokens += cachedTokens;
    existing.completionTokens += completionTokens;
    existing.reasoningTokens += reasoningTokens;
    existing.totalTokens += promptTokens + completionTokens;
    existing.callCount += 1;
    this.perSource.set(source, existing);
    if (effectiveServiceTier) {
      const tierUsage = this.effectiveServiceTierUsage.get(effectiveServiceTier) ?? { ...EMPTY_USAGE };
      tierUsage.promptTokens += promptTokens;
      tierUsage.cachedTokens += cachedTokens;
      tierUsage.completionTokens += completionTokens;
      tierUsage.reasoningTokens += reasoningTokens;
      tierUsage.totalTokens += promptTokens + completionTokens;
      tierUsage.callCount += 1;
      this.effectiveServiceTierUsage.set(effectiveServiceTier, tierUsage);
    }
  }

  /** Record an empty/fallback response for a source. */
  recordEmptyResponse(source: string): void {
    const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
    existing.emptyResponses += 1;
    this.perSource.set(source, existing);
  }

  /** Get usage for a specific source. */
  getUsage(source: string): TokenUsage {
    return this.perSource.get(source) ?? { ...EMPTY_USAGE };
  }

  /** Get aggregated usage across all sources. */
  getTotalUsage(): TokenUsage {
    return sumTokenUsage(this.perSource.values());
  }

  /** Get all per-source usage as a plain object. */
  getAllUsage(): Record<string, TokenUsage> {
    const result: Record<string, TokenUsage> = {};
    for (const [source, usage] of this.perSource) {
      result[source] = { ...usage };
    }
    return result;
  }

  /** Counts the actual tiers reported by the provider, rather than the requested tier. */
  getEffectiveServiceTierCounts(): Record<string, number> {
    return Object.fromEntries(
      [...this.effectiveServiceTierUsage].map(([tier, usage]) => [tier, usage.callCount]),
    );
  }

  /** Token usage grouped by the actual tier returned on each successful response. */
  getEffectiveServiceTierUsage(): Record<string, TokenUsage> {
    return Object.fromEntries(
      [...this.effectiveServiceTierUsage].map(([tier, usage]) => [tier, { ...usage }]),
    );
  }

  /** Merge another tracker's data into this one. */
  merge(other: TokenTracker): void {
    for (const [source, usage] of other.perSource) {
      this.perSource.set(source, sumTokenUsage([this.perSource.get(source) ?? EMPTY_USAGE, usage]));
    }
    for (const [tier, usage] of other.effectiveServiceTierUsage) {
      this.effectiveServiceTierUsage.set(
        tier,
        sumTokenUsage([this.effectiveServiceTierUsage.get(tier) ?? EMPTY_USAGE, usage]),
      );
    }
  }

  loadCursor(cursor: TokenCostCursor): void {
    if (!isTokenCostCursor(cursor)) {
      throw new Error("Invalid token cost cursor");
    }
    this.perSource.clear();
    this.effectiveServiceTierUsage.clear();
    for (const [source, usage] of Object.entries(cursor.perSource)) {
      this.perSource.set(source, { ...EMPTY_USAGE, ...usage });
    }
    for (const [tier, usage] of Object.entries(cursor.effectiveServiceTierUsage ?? {})) {
      this.effectiveServiceTierUsage.set(tier, { ...EMPTY_USAGE, ...usage });
    }
    for (const [tier, count] of Object.entries(cursor.effectiveServiceTiers ?? {})) {
      if (
        !this.effectiveServiceTierUsage.has(tier)
        && Number.isInteger(count)
        && count >= 0
      ) {
        this.effectiveServiceTierUsage.set(tier, { ...EMPTY_USAGE, callCount: count });
      }
    }
  }
}

/** Serializable token/cost cursor for checkpoint hydration passports (U4). */
export interface TokenCostCursorBoundary {
  version: 1;
  ownerEpoch: string;
  boundarySequence: number;
  eventHeadHash: string;
  projectionHash: string;
  checkpointKind: string;
  phase: string;
  round: number;
}

export interface TokenCostCursor {
  version: 1;
  totals: TokenUsage;
  perSource: Record<string, TokenUsage>;
  effectiveServiceTiers?: Record<string, number>;
  effectiveServiceTierUsage?: Record<string, TokenUsage>;
  boundary?: TokenCostCursorBoundary;
}

export interface TokenTracker {
  toCursor(): TokenCostCursor;
  loadCursor(cursor: TokenCostCursor): void;
}

export function isTokenCostCursor(value: unknown): value is TokenCostCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  if (cursor.version !== 1 || !isValidTokenUsage(cursor.totals)) return false;
  if (!cursor.perSource || typeof cursor.perSource !== "object" || Array.isArray(cursor.perSource)) return false;
  if (!Object.values(cursor.perSource).every(isValidTokenUsage)) return false;

  const tierUsageValue = cursor.effectiveServiceTierUsage;
  if (tierUsageValue !== undefined) {
    if (!tierUsageValue || typeof tierUsageValue !== "object" || Array.isArray(tierUsageValue)) return false;
    if (!Object.values(tierUsageValue).every(isValidTokenUsage)) return false;
    const classified = sumTokenUsage(Object.values(tierUsageValue));
    const totals = cursor.totals as TokenUsage;
    if (Object.keys(totals).some(
      (key) => classified[key as keyof TokenUsage] > totals[key as keyof TokenUsage],
    )) {
      return false;
    }
  }

  const tierCountsValue = cursor.effectiveServiceTiers;
  if (tierCountsValue !== undefined) {
    if (!tierCountsValue || typeof tierCountsValue !== "object" || Array.isArray(tierCountsValue)) return false;
    if (!Object.values(tierCountsValue).every(
      (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
    )) {
      return false;
    }
    if (tierUsageValue && Object.entries(tierUsageValue).some(
      ([tier, usage]) =>
        (tierCountsValue as Record<string, number>)[tier] !== undefined
        && (tierCountsValue as Record<string, number>)[tier] !== (usage as TokenUsage).callCount,
    )) {
      return false;
    }
  }
  return true;
}

TokenTracker.prototype.toCursor = function (this: TokenTracker): TokenCostCursor {
  return {
    version: 1,
    totals: this.getTotalUsage(),
    perSource: this.getAllUsage(),
    effectiveServiceTiers: this.getEffectiveServiceTierCounts(),
    effectiveServiceTierUsage: this.getEffectiveServiceTierUsage(),
  };
};
