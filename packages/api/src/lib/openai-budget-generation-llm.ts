/**
 * Shared OpenAI budget generation client for cheap flavor/copy LLM calls.
 *
 * Always pairs catalog entry `openai:gpt-5-nano` with the hosted OpenAI provider
 * profile, even when `INFLUENCE_LLM_BASE_URL` points at LM Studio for game runs.
 * Call sites that need game-runtime models must use the game's modelSelection
 * path instead of this helper.
 */

import {
  createLlmClientFromEnv,
  resolveModelSelection,
  type LlmClientConfig,
} from "@influence/engine";

export const OPENAI_BUDGET_GENERATION_CATALOG_ID = "openai:gpt-5-nano";

export type OpenAIBudgetGenerationLlm = LlmClientConfig & {
  modelId: string;
};

/**
 * Resolve a hosted OpenAI client + model id for budget generation tasks
 * (house-fill persona blurbs, agent-profile AI help, etc.).
 *
 * Returns null when OPENAI_API_KEY is unavailable — callers should fall back
 * to defaults rather than routing gpt-5-nano at a local base URL.
 */
export function resolveOpenAIBudgetGenerationLlm(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIBudgetGenerationLlm | null {
  const selection = resolveModelSelection(
    { catalogId: OPENAI_BUDGET_GENERATION_CATALOG_ID },
    null,
  );
  const llmConfig = createLlmClientFromEnv(env, {
    providerProfileId: selection.providerProfile.id,
  });

  return llmConfig
    ? { ...llmConfig, modelId: selection.modelId }
    : null;
}
