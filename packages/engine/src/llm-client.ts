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
  /** True when this client adds Flex tiering and retry/fallback handling to OpenAI requests. */
  flexProcessingEnabled: boolean;
}

export interface CreateLlmClientOptions {
  timeout?: number;
  maxRetries?: number;
  providerProfileId?: ProviderProfileId;
  /** Use OpenAI Flex processing for supported request routes. Hosted OpenAI only. */
  flexProcessing?: boolean;
}

const FLEX_429_RETRY_LIMIT = 3;
const FLEX_RETRY_BASE_DELAY_MS = 1_000;
const FLEX_RETRY_MAX_DELAY_MS = 30_000;

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
type FlexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, ms);
    function finish(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort(): void {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal!));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isFlexEligibleRequest(request: Request): boolean {
  if (request.method !== "POST") return false;
  const pathname = new URL(request.url).pathname;
  return pathname.endsWith("/responses") || pathname.endsWith("/chat/completions");
}

async function requestWithServiceTier(request: Request, serviceTier: "flex" | "auto"): Promise<Request | null> {
  try {
    const body = await request.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify({ ...body, service_tier: serviceTier }),
      signal: request.signal,
    });
  } catch {
    return null;
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const exponentialDelay = Math.min(
    FLEX_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    FLEX_RETRY_MAX_DELAY_MS,
  );
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return exponentialDelay;

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.max(exponentialDelay, Math.min(retryAfterSeconds * 1_000, FLEX_RETRY_MAX_DELAY_MS));
  }

  const retryAfterDate = Date.parse(retryAfter);
  return Number.isNaN(retryAfterDate)
    ? exponentialDelay
    : Math.max(exponentialDelay, Math.min(Math.max(retryAfterDate - Date.now(), 0), FLEX_RETRY_MAX_DELAY_MS));
}

/**
 * Adds Flex tiering to OpenAI Responses and Chat Completions requests.
 *
 * A 429 from Flex means capacity is temporarily unavailable. Retry three times
 * with exponential backoff, then submit the same request on the standard auto
 * tier as recommended by OpenAI's Flex processing guide.
 */
export function createFlexProcessingFetch(
  baseFetch: FlexFetch = fetch,
  wait: Sleep = sleep,
): FlexFetch {
  return async (input, init) => {
    const originalRequest = typeof input === "string"
      ? new Request(input, init)
      : input instanceof URL
        ? new Request(input.toString(), init)
        : new Request(input, init);
    if (!isFlexEligibleRequest(originalRequest)) {
      return await baseFetch(originalRequest);
    }

    let serviceTier: "flex" | "auto" = "flex";
    let flex429s = 0;
    while (true) {
      const request = await requestWithServiceTier(originalRequest, serviceTier);
      if (!request) return await baseFetch(originalRequest);

      const response = await baseFetch(request);
      if (response.status !== 429) return response;

      if (serviceTier === "auto") return response;

      flex429s++;
      await response.body?.cancel().catch(() => undefined);
      await wait(retryDelayMs(response, flex429s), originalRequest.signal);
      if (flex429s === FLEX_429_RETRY_LIMIT) {
        console.warn("[openai-flex] received 3 Flex 429 responses; retrying on the auto tier.");
        serviceTier = "auto";
      }
    }
  };
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
  const flexProcessingEnabled = providerProfileId === "openai" && options.flexProcessing === true;

  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
      ...(options.timeout !== undefined && { timeout: options.timeout }),
      ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
      ...(flexProcessingEnabled && { fetch: createFlexProcessingFetch() }),
    }),
    apiKeySource: apiKeyConfig?.key ?? "local-default",
    baseURL,
    baseURLSource: baseURLConfig?.key,
    providerLabel: explicitProfileId ? profile.label : providerLabel(baseURL),
    providerProfileId,
    toolChoiceMode: resolveToolChoiceMode(env, baseURL, providerProfileId),
    flexProcessingEnabled,
    ...(providerProfileId === "openai" && openAIReasoningSummary && { openAIReasoningSummary }),
  };
}

export function describeLlmProvider(config: LlmClientConfig): string {
  if (!config.baseURL) return config.providerLabel;
  return `${config.providerLabel} (${config.baseURL})`;
}
