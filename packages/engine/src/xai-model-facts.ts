import type { ProviderModelFacts } from "./provider-model-facts";

// Audited 2026-10-26: https://docs.x.ai/developers/models and /developers/pricing.
// These native routes preserve model generations; discovery alone never enables a model.
export const XAI_MODEL_FACTS: Readonly<Record<string, ProviderModelFacts>> = Object.fromEntries(
  ["grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20-multi-agent-0309"].map(id => {
    const newer = id === "grok-4.6" || id === "grok-4.5";
    const inputPer1M = newer ? 2 : 1.25;
    const cachedInputPer1M = newer ? id === "grok-4.5" ? 0.30 : 0.50 : 0.20;
    const outputPer1M = newer ? 6 : 2.50;
    return [id, {
      source: "https://docs.x.ai/developers/pricing", checkedAt: "2026-10-26",
      contextTokens: newer ? 500_000 : 1_000_000, outputTokens: null,
      parameters: ["max_output_tokens", "text.format", "include", "store", "reasoning.effort"],
      allowedReasoningEfforts: ["low", "medium", "high"],
      capabilities: { supportsImageInput: true, supportsStructuredOutput: true, supportsTools: false,
        supportsReasoningEffort: true, supportsToolReasoningEffort: false,
        usesMaxCompletionTokens: false, supportsTemperature: false,
        supportsOpenAIResponses: false, supportsPromptCacheRetention: false },
      pricing: { inputPer1M, cachedInputPer1M, outputPer1M,
        tiers: [{ minPromptTokens: 200_000, inputPer1M: inputPer1M * 2,
          cachedInputPer1M: cachedInputPer1M * 2, outputPer1M: outputPer1M * 2 }] },
    } satisfies ProviderModelFacts];
  }),
);
