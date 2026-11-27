import { APIError } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { estimateCostForKnownModel, MODEL_PRICING } from "@influence/engine";
import { sha256StableJson } from "./stable-hash.js";

export type TextProviderAttempt = (request: () => Promise<ChatCompletion>) => Promise<ChatCompletion>;

interface TextUsage {
  model: string;
  providerRequestId: string;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  estimatedCostMicrousd: number | null;
  pricingSource: string | null;
}

/** Track the outcome of the latest dispatch and retain usage from earlier steps. */
export function textProviderAttempts(limit: 1 | 2, persist: (usage: TextUsage) => Promise<void>) {
  let count = 0;
  let inFlight = false;
  let uncertain = false;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let costTotal: number | null = 0;
  const priceSources = new Set<string>();
  const attempt: TextProviderAttempt = async request => {
    if (inFlight || uncertain || count >= limit) throw new Error("Text provider attempt limit reached");
    count++;
    inFlight = true;
    try {
      let response: ChatCompletion;
      try { response = await request(); }
      catch (error) {
        uncertain = !(error instanceof APIError && error.status !== undefined);
        throw error;
      }
      const usage = response.usage;
      if (usage) {
        promptTokens = (promptTokens ?? 0) + usage.prompt_tokens;
        completionTokens = (completionTokens ?? 0) + usage.completion_tokens;
      }
      const cost = usage ? estimateCostForKnownModel({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0, reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: usage.total_tokens, callCount: 1, emptyResponses: 0 }, response.model) : null;
      if (cost) priceSources.add(`engine.MODEL_PRICING:${sha256StableJson(MODEL_PRICING[response.model])}`);
      costTotal = cost && costTotal !== null ? costTotal + cost.totalCost : null;
      await persist({
        model: response.model, providerRequestId: response.id, promptTokens, completionTokens,
        estimatedCostMicrousd: costTotal === null ? null : Math.round(costTotal * 1_000_000),
        pricingSource: costTotal === null ? null : [...priceSources].join(","),
      });
      return response;
    } finally { inFlight = false; }
  };
  return { attempt, get uncertain() { return uncertain; } };
}
