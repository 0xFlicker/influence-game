import { providerModelFacts, type ProviderModelFacts } from "./provider-model-facts";
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
  if (provider === "anthropic" && !["default", "standard", "standard_only"].includes(serviceTier)) return null;
  if (provider === "xai" && serviceTier !== "default") return null;
  const rates = provider === "openai" && serviceTier === "flex" ? facts.flexPricing : facts.pricing;
  if (!rates) return null;
  return { version: facts.checkedAt, catalogId, serviceTier: provider === "katana" ? "provider" : provider === "anthropic" ? "standard" : serviceTier,
    source: provider === "openai" ? "https://developers.openai.com/api/docs/pricing"
      : provider === "meta-muse" ? "https://dev.meta.ai/docs/pricing-rate-limits" : facts.source,
    rates, ...(facts.minimumUsd !== undefined && { minimumUsd: facts.minimumUsd }),
    ...(facts.roundingUsd && { roundingUsd: facts.roundingUsd }) };
}

export function estimateRouteCost(usage: Partial<TokenUsage>, card: ModelRateCard): number {
  const total = estimateCost({ promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, callCount: 1, emptyResponses: 0, ...usage }, card.rates).totalCost;
  return Math.max(card.minimumUsd ?? 0, card.roundingUsd ? Math.ceil((total - Number.EPSILON) / card.roundingUsd) * card.roundingUsd : total);
}

/** Provider date-only notices take effect at the start of the stated UTC day. */
export function isModelRetired(
  facts: Pick<ProviderModelFacts, "retired" | "deprecation"> | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(facts?.retired || (facts?.deprecation && now.toISOString().slice(0, 10) >= facts.deprecation.retirementDate));
}

export interface HouseModelCutoff {
  cutoffDate: string;
  replacementCatalogId: string;
}

export type HouseModelCutoffs = Readonly<Record<string, HouseModelCutoff>>;

export function isHouseModelCutoffActive(cutoff: HouseModelCutoff | undefined, now = new Date()): boolean {
  return cutoff !== undefined && now.toISOString().slice(0, 10) >= cutoff.cutoffDate;
}

export function modelRouteMetadata(catalogId: string) {
  const [provider, model] = catalogId.split(":");
  const facts = providerModelFacts(provider!, model!);
  return { rateCard: modelRateCard(catalogId, catalogId === "openai:gpt-6-luna" ? "flex" : "default"),
    documented: facts ? { source: facts.source, checkedAt: facts.checkedAt, inputImages: facts.capabilities.supportsImageInput,
      strictSchema: facts.capabilities.supportsStructuredOutput, contextTokens: facts.contextTokens, outputTokens: facts.outputTokens,
      parameters: facts.parameters, capabilities: facts.capabilities, allowedReasoningEfforts: facts.allowedReasoningEfforts,
      retired: facts.retired ?? false,
      ...(facts.deprecation && { deprecation: facts.deprecation }),
    } : null,
    adapterContract: "provider-native strict JSON schema; exact schema and semantic validation required",
    unknownSchemaSubset: true };
}
