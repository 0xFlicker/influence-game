import openai from "./openai-catalog-snapshot.json";
import katana from "./katana-catalog-snapshot.json";
import type { ModelRequestCapabilities, ModelReasoningEffort } from "./model-catalog";
import type { ModelPricing } from "./token-tracker";

/** Audited provider facts, shared by catalog resolution and cost accounting. */
export interface ProviderModelFacts {
  source: string;
  checkedAt: string;
  capabilities: ModelRequestCapabilities;
  allowedReasoningEfforts: readonly ModelReasoningEffort[];
  contextTokens: number | null;
  outputTokens: number | null;
  parameters: readonly string[];
  pricing: ModelPricing | null;
  flexPricing?: ModelPricing;
  retired?: boolean;
  minimumUsd?: number;
  roundingUsd?: number;
}

interface OpenAIModelRow extends Omit<ProviderModelFacts, "checkedAt" | "parameters"> {
  aliases: string[];
}

const openaiRows = openai.models as Record<string, OpenAIModelRow>;
export const OPENAI_MODEL_FACTS: Readonly<Record<string, ProviderModelFacts>> = Object.fromEntries(
  Object.entries(openaiRows).flatMap(([id, row]) => [id, ...row.aliases].map(alias => [alias, {
    ...row, checkedAt: openai.checkedAt, parameters: [],
  }])),
);

export const KATANA_MODEL_FACTS: Readonly<Record<string, ProviderModelFacts>> = Object.fromEntries(
  Object.entries(katana.models).map(([id, row]) => {
    const parameters: readonly string[] = row.parameters;
    const reasoning = parameters.includes("reasoning_effort");
    return [id, {
      source: katana.source, checkedAt: katana.checkedAt, contextTokens: row.contextTokens, outputTokens: row.outputTokens,
      parameters, pricing: row.pricing, minimumUsd: row.minimumUsd, roundingUsd: row.roundingUsd,
      allowedReasoningEfforts: reasoning ? ["low", "medium", "high"] : [],
      capabilities: {
        supportsImageInput: row.supportsImages, supportsStructuredOutput: row.supportsStructuredOutput,
        supportsTools: row.supportsTools, supportsReasoningEffort: reasoning,
        supportsToolReasoningEffort: reasoning && row.supportsTools,
        usesMaxCompletionTokens: parameters.includes("max_completion_tokens"),
        supportsTemperature: parameters.includes("temperature"),
        supportsOpenAIResponses: false, supportsPromptCacheRetention: false,
      },
    }];
  }),
);

// https://dev.meta.ai/docs/models and /docs/protocols/responses, checked 2026-10-23.
const museCapabilities: ModelRequestCapabilities = {
  supportsImageInput: true, supportsReasoningEffort: true, supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: true, supportsTemperature: true, supportsOpenAIResponses: false,
  supportsPromptCacheRetention: false, supportsStructuredOutput: true, supportsTools: true,
};
export const META_MODEL_FACTS: Readonly<Record<string, ProviderModelFacts>> = Object.fromEntries(
  ["muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.3", "muse-spark-1.3-contributor", "muse-wonder-1.0"].map(id => [id, {
    source: "https://dev.meta.ai/docs/models", checkedAt: "2026-10-23", capabilities: museCapabilities,
    allowedReasoningEfforts: ["low", "medium", "high"], contextTokens: 1_048_576, outputTokens: null,
    parameters: ["reasoning_effort", "temperature", "tools", "response_format"],
    pricing: id.includes("contributor") ? { inputPer1M: 0.10, cachedInputPer1M: 0.002, outputPer1M: 0.20 }
      : id.startsWith("muse-wonder") ? { inputPer1M: 4, cachedInputPer1M: 0.20, outputPer1M: 20 }
      : { inputPer1M: 1.25, cachedInputPer1M: 0.15, outputPer1M: 4.25 },
  }]),
);

export function providerModelFacts(provider: string, model: string): ProviderModelFacts | undefined {
  return (provider === "openai" ? OPENAI_MODEL_FACTS : provider === "katana" ? KATANA_MODEL_FACTS
    : provider === "meta-muse" ? META_MODEL_FACTS : {})[model];
}
