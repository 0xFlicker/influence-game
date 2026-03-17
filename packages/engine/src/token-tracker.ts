/**
 * Influence Game - Token Usage Tracking & Cost Estimation
 *
 * Tracks LLM token usage per-agent and per-game, and estimates costs
 * across multiple model pricing tiers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface ModelPricing {
  /** Cost per 1M input tokens in USD */
  inputPer1M: number;
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
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.0 },
  "o4-mini": { inputPer1M: 1.10, outputPer1M: 4.40 },
  "gpt-4.1-nano": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gpt-4.1-mini": { inputPer1M: 0.40, outputPer1M: 1.60 },
  "gpt-4.1": { inputPer1M: 2.00, outputPer1M: 8.00 },
};

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export function estimateCost(usage: TokenUsage, pricing: ModelPricing): CostEstimate;
export function estimateCost(usage: TokenUsage, model: string): CostEstimate;
export function estimateCost(usage: TokenUsage, pricingOrModel: ModelPricing | string): CostEstimate {
  const pricing = typeof pricingOrModel === "string"
    ? MODEL_PRICING[pricingOrModel] ?? MODEL_PRICING["gpt-4o-mini"]!
    : pricingOrModel;
  const model = typeof pricingOrModel === "string" ? pricingOrModel : "custom";

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
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

export class TokenTracker {
  private readonly perSource: Map<string, TokenUsage> = new Map();

  /** Record a single LLM call's usage. */
  record(source: string, promptTokens: number, completionTokens: number): void {
    const existing = this.perSource.get(source) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
    existing.promptTokens += promptTokens;
    existing.completionTokens += completionTokens;
    existing.totalTokens += promptTokens + completionTokens;
    existing.callCount += 1;
    this.perSource.set(source, existing);
  }

  /** Get usage for a specific source. */
  getUsage(source: string): TokenUsage {
    return this.perSource.get(source) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
  }

  /** Get aggregated usage across all sources. */
  getTotalUsage(): TokenUsage {
    const total: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
    for (const usage of this.perSource.values()) {
      total.promptTokens += usage.promptTokens;
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
      const existing = this.perSource.get(source) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        callCount: 0,
      };
      existing.promptTokens += usage.promptTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
      existing.callCount += usage.callCount;
      this.perSource.set(source, existing);
    }
  }
}
