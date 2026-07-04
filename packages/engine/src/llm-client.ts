import OpenAI from "openai";
import {
  DEFAULT_TIER_MODELS,
  PROVIDER_PROFILES,
  type ProviderProfileId,
} from "./model-catalog";

export type ModelTier = "budget" | "standard" | "premium";
export type LlmToolChoiceMode = "named" | "required" | "auto" | "json_schema";
export type OpenAIReasoningSummaryMode = "auto" | "concise" | "detailed";

export interface LlmClientConfig {
  client: OpenAI;
  apiKeySource: string;
  baseURL?: string;
  baseURLSource?: string;
  providerLabel: string;
  providerProfileId: ProviderProfileId;
  toolChoiceMode: LlmToolChoiceMode;
  openAIReasoningSummary?: OpenAIReasoningSummaryMode;
}

export interface CreateLlmClientOptions {
  timeout?: number;
  maxRetries?: number;
  providerProfileId?: ProviderProfileId;
}

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

function normalizeOpenAIReasoningSummaryMode(value: string | undefined): OpenAIReasoningSummaryMode | "off" | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") {
    return normalized;
  }
  if (normalized === "off" || normalized === "none" || normalized === "false" || normalized === "disabled") {
    return "off";
  }
  return null;
}

function resolveProfileId(baseURL: string | undefined, explicitProfileId?: ProviderProfileId): ProviderProfileId {
  if (explicitProfileId) return explicitProfileId;
  if (!baseURL) return "openai";
  return isLocalBaseURL(baseURL) ? "lm-studio" : "custom-openai-compatible";
}

function requiresExplicitBaseURL(providerProfileId: ProviderProfileId): boolean {
  return providerProfileId === "lm-studio" || providerProfileId === "custom-openai-compatible";
}

export function resolveToolChoiceMode(
  env: NodeJS.ProcessEnv = process.env,
  baseURL?: string,
  providerProfileId?: ProviderProfileId,
): LlmToolChoiceMode {
  const profile = providerProfileId ? PROVIDER_PROFILES[providerProfileId] : undefined;
  return normalizeToolChoiceMode(env.INFLUENCE_LLM_TOOL_CHOICE_MODE)
    ?? normalizeToolChoiceMode(env.INFLUENCE_LLM_TOOL_CHOICE)
    ?? profile?.defaultToolChoiceMode
    ?? (isLocalBaseURL(baseURL) ? "required" : "named");
}

export function resolveOpenAIReasoningSummaryMode(
  env: NodeJS.ProcessEnv = process.env,
  baseURL?: string,
): OpenAIReasoningSummaryMode | undefined {
  const configured = normalizeOpenAIReasoningSummaryMode(
    env.INFLUENCE_OPENAI_REASONING_SUMMARY ??
      env.INFLUENCE_LLM_REASONING_SUMMARY,
  );
  if (configured === "off") return undefined;
  if (configured) return baseURL ? undefined : configured;
  return baseURL ? undefined : "auto";
}

export function resolveModelForTier(
  tier: string | null | undefined,
): string {
  const normalized = tier === "premium" || tier === "standard" || tier === "budget"
    ? tier
    : "budget";
  return DEFAULT_TIER_MODELS[normalized];
}

export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLlmClientOptions = {},
): LlmClientConfig | null {
  const explicitProfileId = options.providerProfileId;
  const katanaKey = env.API_KAT_IMGNAI_KEY?.trim();
  const katanaSecret = env.API_KAT_IMGNAI_SECRET?.trim();
  const explicitKatana = explicitProfileId === "katana";
  const explicitOpenAI = explicitProfileId === "openai";

  const baseURLConfig = explicitKatana
    ? { value: PROVIDER_PROFILES.katana.baseURL!, key: "katana-profile" }
    : explicitOpenAI
      ? null
    : firstEnv(env, [
        "INFLUENCE_LLM_BASE_URL",
        "OPENAI_BASE_URL",
        "LM_STUDIO_BASE_URL",
      ]);
  const apiKeyConfig = explicitKatana
    ? katanaKey && katanaSecret
      ? { value: `${katanaKey}:${katanaSecret}`, key: "API_KAT_IMGNAI_KEY+API_KAT_IMGNAI_SECRET" }
      : null
    : explicitOpenAI
      ? firstEnv(env, ["OPENAI_API_KEY"])
    : firstEnv(env, [
        "INFLUENCE_LLM_API_KEY",
        "OPENAI_API_KEY",
        "LM_STUDIO_API_KEY",
      ]);

  const baseURL = baseURLConfig?.value;
  const providerProfileId = resolveProfileId(baseURL, explicitProfileId);
  if (requiresExplicitBaseURL(providerProfileId) && !baseURL) {
    return null;
  }
  const apiKey = apiKeyConfig?.value ?? (baseURL && providerProfileId === "lm-studio" ? "lm-studio" : undefined);
  if (!apiKey) return null;
  const openAIReasoningSummary = resolveOpenAIReasoningSummaryMode(env, baseURL);
  const profile = PROVIDER_PROFILES[providerProfileId];

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
    providerLabel: explicitProfileId ? profile.label : providerLabel(baseURL),
    providerProfileId,
    toolChoiceMode: resolveToolChoiceMode(env, baseURL, providerProfileId),
    ...(providerProfileId === "openai" && openAIReasoningSummary && { openAIReasoningSummary }),
  };
}

export function describeLlmProvider(config: LlmClientConfig): string {
  if (!config.baseURL) return config.providerLabel;
  return `${config.providerLabel} (${config.baseURL})`;
}
