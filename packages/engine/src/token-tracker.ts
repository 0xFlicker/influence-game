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
  totalTokens: number;
  callCount: number;
}

export interface ModelPricing {
  /** Cost per 1M input tokens in USD */
  inputPer1M: number;
  /** Cost per 1M cached input tokens in USD */
  cachedInputPer1M: number;
  /** Cost per 1M output tokens in USD */
  outputPer1M: number;
}

export interface CostEstimate {
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

// ---------------------------------------------------------------------------
// Pricing table (published OpenAI pricing)
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
};

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export function estimateCost(usage: TokenUsage, pricing: ModelPricing): CostEstimate;
export function estimateCost(usage: TokenUsage, model: string): CostEstimate;
export function estimateCost(usage: TokenUsage, pricingOrModel: ModelPricing | string): CostEstimate {
  const pricing = typeof pricingOrModel === "string"
    ? MODEL_PRICING[pricingOrModel] ?? MODEL_PRICING["gpt-5-nano"]!
    : pricingOrModel;
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

/**
 * Estimate costs for the given usage across ALL known model tiers.
 */
export function estimateCostAllModels(usage: TokenUsage): CostEstimate[] {
  return Object.entries(MODEL_PRICING).map(([model, pricing]) => ({
    ...estimateCost(usage, pricing),
    model,
  }));
}

// ---------------------------------------------------------------------------
// TokenTracker - accumulates usage per source (agent name or "house")
// ---------------------------------------------------------------------------

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  callCount: 0,
};

export class TokenTracker {
  private readonly perSource: Map<string, TokenUsage> = new Map();

  /** Record a single LLM call's usage. */
  record(source: string, promptTokens: number, completionTokens: number, cachedTokens = 0): void {
    const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
    existing.promptTokens += promptTokens;
    existing.cachedTokens += cachedTokens;
    existing.completionTokens += completionTokens;
    existing.totalTokens += promptTokens + completionTokens;
    existing.callCount += 1;
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
      total.completionTokens += usage.completionTokens;
      total.totalTokens += usage.totalTokens;
      total.callCount += usage.callCount;
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

  /** Merge another tracker's data into this one. */
  merge(other: TokenTracker): void {
    for (const [source, usage] of other.perSource) {
      const existing = this.perSource.get(source) ?? { ...EMPTY_USAGE };
      existing.promptTokens += usage.promptTokens;
      existing.cachedTokens += usage.cachedTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
      existing.callCount += usage.callCount;
      this.perSource.set(source, existing);
    }
  }
}
