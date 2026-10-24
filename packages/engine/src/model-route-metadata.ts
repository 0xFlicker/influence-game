import { providerModelFacts } from "./provider-model-facts";
import { estimateCost, type ModelPricing, type TokenUsage } from "./token-tracker";

export interface ModelRateCard {
  version: string;
  catalogId: string;
  serviceTier: string;
  source: string;
  rates: ModelPricing;
  minimumUsd?: number;
  roundingUsd?: number;
}

/** Provider-qualified pricing. Unknown routes never inherit another model's rates. */
export function modelRateCard(catalogId: string, serviceTier = "default"): ModelRateCard | null {
  const [provider, model] = catalogId.split(":");
  if (!model) return null;
  const facts = providerModelFacts(provider!, model);
  if (!facts) return null;
  // Priority and future tiers must not silently inherit Standard prices.
  if (provider === "openai" && !["default", "auto", "flex"].includes(serviceTier)) return null;
  const rates = provider === "openai" && serviceTier === "flex" ? facts.flexPricing : facts.pricing;
  if (!rates) return null;
  return { version: facts.checkedAt, catalogId, serviceTier: provider === "katana" ? "provider" : serviceTier,
    source: provider === "openai" ? "https://developers.openai.com/api/docs/pricing"
      : provider === "meta-muse" ? "https://dev.meta.ai/docs/pricing-rate-limits" : facts.source,
    rates, ...(facts.minimumUsd !== undefined && { minimumUsd: facts.minimumUsd }),
    ...(facts.roundingUsd && { roundingUsd: facts.roundingUsd }) };
}

export function estimateRouteCost(usage: Partial<TokenUsage>, card: ModelRateCard): number {
  const total = estimateCost({ promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, callCount: 1, emptyResponses: 0, ...usage }, card.rates).totalCost;
  return Math.max(card.minimumUsd ?? 0, card.roundingUsd ? Math.ceil((total - Number.EPSILON) / card.roundingUsd) * card.roundingUsd : total);
}

export function modelRouteMetadata(catalogId: string) {
  const [provider, model] = catalogId.split(":");
  const facts = providerModelFacts(provider!, model!);
  return { rateCard: modelRateCard(catalogId, catalogId === "openai:gpt-6-luna" ? "flex" : "default"),
    documented: facts ? { source: facts.source, checkedAt: facts.checkedAt, inputImages: facts.capabilities.supportsImageInput,
      strictSchema: facts.capabilities.supportsStructuredOutput, contextTokens: facts.contextTokens, outputTokens: facts.outputTokens,
      parameters: facts.parameters, capabilities: facts.capabilities, allowedReasoningEfforts: facts.allowedReasoningEfforts,
      retired: facts.retired ?? false } : null,
    adapterContract: "provider-native strict JSON schema; exact schema and semantic validation required",
    unknownSchemaSubset: true };
}
