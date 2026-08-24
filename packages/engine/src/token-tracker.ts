/**
 * Influence Game - Token Usage Tracking & Cost Estimation
 *
 * Tracks LLM token usage per-agent and per-game, and estimates costs
 * across multiple model pricing tiers. Supports cached input token tracking
 * for OpenAI gpt-5 family models.
 */

import { DEFAULT_MODEL_ID } from "./model-catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  /** Number of prompt tokens served from OpenAI's prefix cache. */
  cachedTokens: number;
  /** Number of prompt tokens written to OpenAI's explicit or implicit cache. */
  cacheWriteTokens?: number;
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
  /** Cost per 1M cache-write input tokens in USD. Defaults to the uncached input rate. */
  cacheWriteInputPer1M?: number;
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
  cacheWriteInputPer1M?: number;
  outputPer1M: number;
}

export interface CostEstimate {
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export const OPENAI_SERVICE_TIERS = ["flex", "auto", "default", "priority"] as const;
export type OpenAIServiceTier = typeof OPENAI_SERVICE_TIERS[number];
export type ServiceTierUsage = Partial<Record<OpenAIServiceTier, TokenUsage>>;

export interface TierAwareCostEstimate {
  flexCost: number;
  fallbackCost: number;
  totalCost: number;
  flexCalls: number;
  fallbackCalls: number;
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
  "gpt-5.4-nano": { inputPer1M: 0.20, cachedInputPer1M: 0.02, outputPer1M: 1.25 },
  "gpt-5.4-mini": { inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.50 },
  // GPT-5.6 Luna rates published after the July 30, 2026 price reduction.
  "gpt-5.6-luna": {
    inputPer1M: 0.20,
    cachedInputPer1M: 0.02,
    cacheWriteInputPer1M: 0.25,
    outputPer1M: 1.20,
  },
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
  // Katana catalog rates published August 2026.
  "grok-4-5": {
    inputPer1M: 2.02,
    cachedInputPer1M: 0.303,
    outputPer1M: 6.06,
  },
  "glm-5-2": {
    inputPer1M: 0.98049,
    cachedInputPer1M: 0.196098,
    outputPer1M: 3.08154,
  },
  // xAI native APIs use the dotted ID.
  "grok-4.3": { inputPer1M: 1.25, cachedInputPer1M: 0.20, outputPer1M: 2.50 },
};

/** Flex uses the current OpenAI Batch-rate card. Only Flex-supported hosted OpenAI models belong here. */
export const OPENAI_FLEX_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5-nano": { inputPer1M: 0.025, cachedInputPer1M: 0.0025, outputPer1M: 0.20 },
  "gpt-5-mini": { inputPer1M: 0.125, cachedInputPer1M: 0.0125, outputPer1M: 1.00 },
  "gpt-5.4-nano": { inputPer1M: 0.10, cachedInputPer1M: 0.01, outputPer1M: 0.625 },
  "gpt-5.4-mini": { inputPer1M: 0.375, cachedInputPer1M: 0.0375, outputPer1M: 2.25 },
  "gpt-5.6-luna": {
    inputPer1M: 0.10,
    cachedInputPer1M: 0.01,
    cacheWriteInputPer1M: 0.125,
    outputPer1M: 0.60,
  },
};

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export function estimateCost(usage: TokenUsage, pricing: ModelPricing): CostEstimate;
export function estimateCost(usage: TokenUsage, model: string): CostEstimate;
export function estimateCost(usage: TokenUsage, pricingOrModel: ModelPricing | string): CostEstimate {
  const basePricing = typeof pricingOrModel === "string"
    ? MODEL_PRICING[pricingOrModel] ?? MODEL_PRICING[DEFAULT_MODEL_ID]!
    : pricingOrModel;
  const pricing = pricingForUsage(basePricing, usage.totalTokens);
  const model = typeof pricingOrModel === "string" ? pricingOrModel : "custom";

  const cached = usage.cachedTokens ?? 0;
  const cacheWrites = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.promptTokens - cached - cacheWrites);
  const inputCost =
    (uncached / 1_000_000) * pricing.inputPer1M +
    (cached / 1_000_000) * pricing.cachedInputPer1M +
    (cacheWrites / 1_000_000) * (pricing.cacheWriteInputPer1M ?? pricing.inputPer1M);
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

export function estimateCostForKnownModel(usage: TokenUsage, model: string): CostEstimate | null {
  const pricing = MODEL_PRICING[model];
  return pricing ? { ...estimateCost(usage, pricing), model } : null;
}

/**
 * Estimate costs for the given usage across ALL known model tiers.
 */
export function estimateCostAllModels(usage: TokenUsage): CostEstimate[] {
  return Object.entries(MODEL_PRICING).map(([model, pricing]) => ({
    ...estimateCost(usage, pricing),
    model,
  }));
}

/**
 * Estimate a Flex simulation across the familiar catalog in one table. Models
 * supported by Flex use its rate card; unsupported OpenAI models and Grok keep
 * their standard rates so they remain comparable without inventing prices.
 */
export function estimateCostAllModelsForFlexRun(usage: TokenUsage): CostEstimate[] {
  return Object.entries(MODEL_PRICING).map(([model, standardPricing]) => ({
    ...estimateCost(usage, OPENAI_FLEX_MODEL_PRICING[model] ?? standardPricing),
    model,
  }));
}

/**
 * Cost the successful responses seen during a Flex simulation. Flex responses use
 * Flex rates; `auto` and `default` responses use the standard rate card because
 * they represent the fallback path under the simulator's project-default setup.
 */
export function estimateTierAwareOpenAICost(
  usageByServiceTier: ServiceTierUsage,
  model: string,
): TierAwareCostEstimate | null {
  const flexPricing = OPENAI_FLEX_MODEL_PRICING[model];
  const standardPricing = MODEL_PRICING[model];
  if (!flexPricing || !standardPricing) return null;

  const flex = usageByServiceTier.flex ? estimateCost(usageByServiceTier.flex, flexPricing).totalCost : 0;
  const fallbackUsage = [usageByServiceTier.auto, usageByServiceTier.default]
    .filter((usage): usage is TokenUsage => usage !== undefined)
    .reduce<TokenUsage>((total, usage) => addUsage(total, usage), { ...EMPTY_USAGE });
  const fallbackCost = estimateCost(fallbackUsage, standardPricing).totalCost;

  return {
    flexCost: flex,
    fallbackCost,
    totalCost: flex + fallbackCost,
    flexCalls: usageByServiceTier.flex?.callCount ?? 0,
    fallbackCalls: fallbackUsage.callCount,
  };
}

// ---------------------------------------------------------------------------
// TokenTracker - accumulates usage per source (agent name or "house")
// ---------------------------------------------------------------------------

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  callCount: 0,
  emptyResponses: 0,
};

function addUsage(target: TokenUsage, usage: TokenUsage): TokenUsage {
  target.promptTokens += usage.promptTokens;
  target.cachedTokens += usage.cachedTokens;
  target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  target.completionTokens += usage.completionTokens;
  target.reasoningTokens += usage.reasoningTokens;
  target.totalTokens += usage.totalTokens;
  target.callCount += usage.callCount;
  target.emptyResponses += usage.emptyResponses;
  return target;
}

export function parseOpenAIServiceTier(value: unknown): OpenAIServiceTier | undefined {
  return typeof value === "string" && (OPENAI_SERVICE_TIERS as readonly string[]).includes(value)
    ? value as OpenAIServiceTier
    : undefined;
}

export class TokenTracker {
  private readonly perSource: Map<string, TokenUsage> = new Map();
  private readonly perServiceTier: Map<OpenAIServiceTier, TokenUsage> = new Map();

  /** Record a single LLM call's usage. */
  record(
    source: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0,
    reasoningTokens = 0,
    serviceTier?: OpenAIServiceTier,
    cacheWriteTokens = 0,
  ): void {
    const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
    existing.promptTokens += promptTokens;
    existing.cachedTokens += cachedTokens;
    existing.cacheWriteTokens = (existing.cacheWriteTokens ?? 0) + cacheWriteTokens;
    existing.completionTokens += completionTokens;
    existing.reasoningTokens += reasoningTokens;
    existing.totalTokens += promptTokens + completionTokens;
    existing.callCount += 1;
    this.perSource.set(source, existing);

    if (serviceTier) {
      const tierUsage = this.perServiceTier.get(serviceTier) ?? { ...EMPTY_USAGE };
      tierUsage.promptTokens += promptTokens;
      tierUsage.cachedTokens += cachedTokens;
      tierUsage.cacheWriteTokens = (tierUsage.cacheWriteTokens ?? 0) + cacheWriteTokens;
      tierUsage.completionTokens += completionTokens;
      tierUsage.reasoningTokens += reasoningTokens;
      tierUsage.totalTokens += promptTokens + completionTokens;
      tierUsage.callCount += 1;
      this.perServiceTier.set(serviceTier, tierUsage);
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
    const total: TokenUsage = { ...EMPTY_USAGE };
    for (const usage of this.perSource.values()) {
      total.promptTokens += usage.promptTokens;
      total.cachedTokens += usage.cachedTokens;
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      total.completionTokens += usage.completionTokens;
      total.reasoningTokens += usage.reasoningTokens;
      total.totalTokens += usage.totalTokens;
      total.callCount += usage.callCount;
      total.emptyResponses += usage.emptyResponses;
    }
    return total;
  }

  /** Get all per-source usage as a plain object. */
  getAllUsage(): Record<string, TokenUsage> {
    const result: Record<string, TokenUsage> = {};
    for (const [source, usage] of this.perSource) {
      result[source] = { ...usage };
    }
    return result;
  }

  /** Get successful-response usage grouped by the tier returned by OpenAI. */
  getUsageByServiceTier(): ServiceTierUsage {
    return Object.fromEntries(
      [...this.perServiceTier.entries()].map(([tier, usage]) => [tier, { ...usage }]),
    ) as ServiceTierUsage;
  }

  /** Merge another tracker's data into this one. */
  merge(other: TokenTracker): void {
    for (const [source, usage] of other.perSource) {
      const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
      existing.promptTokens += usage.promptTokens;
      existing.cachedTokens += usage.cachedTokens;
      existing.cacheWriteTokens = (existing.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      existing.completionTokens += usage.completionTokens;
      existing.reasoningTokens += usage.reasoningTokens;
      existing.totalTokens += usage.totalTokens;
      existing.callCount += usage.callCount;
      existing.emptyResponses += usage.emptyResponses;
      this.perSource.set(source, existing);
    }
    for (const [tier, usage] of other.perServiceTier) {
      const existing = this.perServiceTier.get(tier) ?? { ...EMPTY_USAGE };
      this.perServiceTier.set(tier, addUsage(existing, usage));
    }
  }

  loadCursor(cursor: TokenCostCursor): void {
    this.perSource.clear();
    this.perServiceTier.clear();
    for (const [source, usage] of Object.entries(cursor.perSource)) {
      this.perSource.set(source, { ...EMPTY_USAGE, ...usage });
    }
    for (const [tier, usage] of Object.entries(cursor.byServiceTier ?? {}) as Array<[OpenAIServiceTier, TokenUsage]>) {
      this.perServiceTier.set(tier, { ...EMPTY_USAGE, ...usage });
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
  byServiceTier?: ServiceTierUsage;
  boundary?: TokenCostCursorBoundary;
}

export interface TokenTracker {
  toCursor(): TokenCostCursor;
  loadCursor(cursor: TokenCostCursor): void;
}

TokenTracker.prototype.toCursor = function (this: TokenTracker): TokenCostCursor {
  return {
    version: 1,
    totals: this.getTotalUsage(),
    perSource: this.getAllUsage(),
    byServiceTier: this.getUsageByServiceTier(),
  };
};
