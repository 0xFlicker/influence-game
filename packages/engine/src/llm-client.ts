import OpenAI from "openai";

export type ModelTier = "budget" | "standard" | "premium";
export type LlmToolChoiceMode = "named" | "required" | "auto" | "json_schema";

export interface LlmClientConfig {
  client: OpenAI;
  apiKeySource: string;
  baseURL?: string;
  baseURLSource?: string;
  providerLabel: string;
  toolChoiceMode: LlmToolChoiceMode;
}

export interface CreateLlmClientOptions {
  timeout?: number;
  maxRetries?: number;
}

const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  budget: "gpt-5-nano",
  standard: "gpt-5-mini",
  premium: "gpt-5.4-mini",
};

const MODEL_ENV_BY_TIER: Record<ModelTier, string> = {
  budget: "INFLUENCE_MODEL_BUDGET",
  standard: "INFLUENCE_MODEL_STANDARD",
  premium: "INFLUENCE_MODEL_PREMIUM",
};

function firstEnv(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): { value: string; key: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { value, key };
  }
  return null;
}

function providerLabel(baseURL?: string): string {
  if (!baseURL) return "OpenAI";
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(baseURL)) {
    return "OpenAI-compatible local";
  }
  return "OpenAI-compatible";
}

function isLocalBaseURL(baseURL?: string): boolean {
  return Boolean(baseURL && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(baseURL));
}

function normalizeToolChoiceMode(value: string | undefined): LlmToolChoiceMode | null {
  const normalized = value?.trim().toLowerCase().replace("-", "_");
  if (!normalized) return null;
  if (normalized === "named" || normalized === "required" || normalized === "auto") {
    return normalized;
  }
  if (normalized === "json" || normalized === "json_schema" || normalized === "schema") {
    return "json_schema";
  }
  return null;
}

export function resolveToolChoiceMode(
  env: NodeJS.ProcessEnv = process.env,
  baseURL?: string,
): LlmToolChoiceMode {
  return normalizeToolChoiceMode(env.INFLUENCE_LLM_TOOL_CHOICE_MODE)
    ?? normalizeToolChoiceMode(env.INFLUENCE_LLM_TOOL_CHOICE)
    ?? (isLocalBaseURL(baseURL) ? "required" : "named");
}

export function resolveModelForTier(
  tier: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalized = tier === "premium" || tier === "standard" || tier === "budget"
    ? tier
    : "budget";
  const envKey = MODEL_ENV_BY_TIER[normalized];
  return env[envKey]?.trim() || DEFAULT_TIER_MODELS[normalized];
}

export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLlmClientOptions = {},
): LlmClientConfig | null {
  const baseURLConfig = firstEnv(env, [
    "INFLUENCE_LLM_BASE_URL",
    "OPENAI_BASE_URL",
    "LM_STUDIO_BASE_URL",
  ]);
  const apiKeyConfig = firstEnv(env, [
    "INFLUENCE_LLM_API_KEY",
    "OPENAI_API_KEY",
    "LM_STUDIO_API_KEY",
  ]);

  const baseURL = baseURLConfig?.value;
  const apiKey = apiKeyConfig?.value ?? (baseURL ? "lm-studio" : undefined);
  if (!apiKey) return null;

  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
      ...(options.timeout !== undefined && { timeout: options.timeout }),
      ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
    }),
    apiKeySource: apiKeyConfig?.key ?? "local-default",
    baseURL,
    baseURLSource: baseURLConfig?.key,
    providerLabel: providerLabel(baseURL),
    toolChoiceMode: resolveToolChoiceMode(env, baseURL),
  };
}

export function describeLlmProvider(config: LlmClientConfig): string {
  if (!config.baseURL) return config.providerLabel;
  return `${config.providerLabel} (${config.baseURL})`;
}
