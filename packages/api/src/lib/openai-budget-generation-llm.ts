/**
 * Shared OpenAI budget generation client for cheap flavor/copy LLM calls.
 *
 * Always pairs the GPT-5.6 Luna baseline catalog entry with the hosted OpenAI provider
 * profile, even when `INFLUENCE_LLM_BASE_URL` points at LM Studio for game runs.
 * Call sites that need game-runtime models must use the game's modelSelection
 * path instead of this helper.
 */

import {
  createLlmClientFromEnv,
  DEFAULT_MODEL_CATALOG_ID,
  resolveModelSelection,
  type LlmClientConfig,
} from "@influence/engine";

export const OPENAI_BUDGET_GENERATION_CATALOG_ID = DEFAULT_MODEL_CATALOG_ID;

export type OpenAIBudgetGenerationLlm = LlmClientConfig & {
  modelId: string;
};

/**
 * Resolve a hosted OpenAI client + model id for budget generation tasks
 * (house-fill persona blurbs, agent-profile AI help, etc.).
 *
 * Returns null when OPENAI_API_KEY is unavailable — callers should fall back
 * to defaults rather than routing the hosted baseline at a local base URL.
 */
export function resolveOpenAIBudgetGenerationLlm(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIBudgetGenerationLlm | null {
  const selection = resolveModelSelection(
    { catalogId: OPENAI_BUDGET_GENERATION_CATALOG_ID },
  );
  const llmConfig = createLlmClientFromEnv(env, {
    providerProfileId: selection.providerProfile.id,
  });

  return llmConfig
    ? { ...llmConfig, modelId: selection.modelId }
    : null;
}
