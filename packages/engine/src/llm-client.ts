import OpenAI from "openai";
import { lmStudioTimeoutMs } from "./local-inference";
import {
  PROVIDER_PROFILES,
  type ModelReasoningPolicy,
  type ModelReasoningEffort,
  type ModelRequestCapabilities,
  type ProviderProfileId,
  type ResolvedProviderManifestEntry,
} from "./model-catalog";
import { createProviderEvidenceFetch } from "./provider-execution";
import { createProviderAdapter } from "./provider-adapters";
import type { LlmProviderAdapter } from "./model-invocation";

export type OpenAIReasoningSummaryMode = "auto" | "concise" | "detailed";
export type OpenAIRequestServiceTier = "flex" | "auto";

export interface LlmClientConfig {
  client: OpenAI;
  apiKeySource: string;
  baseURL?: string;
  baseURLSource?: string;
  providerLabel: string;
  providerProfileId: ProviderProfileId;
  openAIReasoningSummary?: OpenAIReasoningSummaryMode;
  /** True when this client adds Flex tiering and retry/fallback handling to OpenAI requests. */
  flexProcessingEnabled: boolean;
  /** Requested game capacity lane. Present only for hosted OpenAI. */
  openAIServiceTier?: OpenAIRequestServiceTier;
}

/** One credential-free sealed manifest entry paired with its runtime client. */
export interface LlmProviderRuntime {
  /** Includes generation and any server-side queueing; concurrent dispatch stays enabled. */
  localRequestTimeoutMs?: number;
  adapter: LlmProviderAdapter;
  catalogId: string;
  providerProfileId: ProviderProfileId;
  modelId: string;
  modelCapabilities: ModelRequestCapabilities;
  reasoningPolicy: ModelReasoningPolicy;
  allowedReasoningEfforts?: readonly ModelReasoningEffort[];
  openAIReasoningSummary?: OpenAIReasoningSummaryMode;
  openAIServiceTier?: OpenAIRequestServiceTier;
  position: number;
  role: "primary" | "fallback";
  maxCallsPerGame?: number;
}

export interface CreateLlmClientOptions {
  /** Coordinator owns every retry and receipt; transport must dispatch once. */
  coordinated?: boolean;
  timeout?: number;
  maxRetries?: number;
  providerProfileId?: ProviderProfileId;
  /** Use OpenAI Flex processing for supported request routes. Hosted OpenAI only. */
  flexProcessing?: boolean;
  /** Explicit hosted OpenAI capacity lane. Defaults to Flex. */
  openAIServiceTier?: OpenAIRequestServiceTier;
}

const FLEX_429_RETRY_LIMIT = 3;
const FLEX_RETRY_BASE_DELAY_MS = 1_000;
const FLEX_RETRY_MAX_DELAY_MS = 30_000;
export const NO_FLEX_TRANSPORT_RETRY_HEADER = "x-influence-no-flex-transport-retry";

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
type FlexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FlexTransportDispatchIntent {
  transportOrdinal: number;
  attemptedTier: "flex" | "auto";
  dispatchedAtMs: number;
}

export interface FlexTransportTerminalOutcome {
  transportOrdinal: number;
  attemptedTier: "flex" | "auto";
  httpStatus: number;
  latencyMs: number;
  providerRequestId?: string;
  backoffMs?: number;
  completedAtMs: number;
}

export interface FlexProcessingObserver {
  onDispatchIntent(event: FlexTransportDispatchIntent): Promise<void>;
  onTerminalOutcome(event: FlexTransportTerminalOutcome): Promise<void>;
}

export interface FlexProcessingFetchOptions {
  observer?: FlexProcessingObserver;
  nowMs?: () => number;
  /** Durable recovery state after persisted terminal Flex 429 outcomes. */
  resume?: {
    flex429Count: number;
    nextTransportOrdinal: number;
    nextTier: "flex" | "auto";
    initialBackoffMs?: number;
  };
}

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
    headers.delete(NO_FLEX_TRANSPORT_RETRY_HEADER);
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
  options: FlexProcessingFetchOptions = {},
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

    const disableTransportRetry = originalRequest.headers.get(NO_FLEX_TRANSPORT_RETRY_HEADER) === "1";

    const resume = options.resume;
    let serviceTier: "flex" | "auto" = resume?.nextTier ?? "flex";
    let flex429s = resume?.flex429Count ?? 0;
    let transportOrdinal = (resume?.nextTransportOrdinal ?? 1) - 1;
    const nowMs = options.nowMs ?? Date.now;
    if (resume?.initialBackoffMs && resume.initialBackoffMs > 0) {
      await wait(resume.initialBackoffMs, originalRequest.signal);
    }
    while (true) {
      const request = await requestWithServiceTier(originalRequest, serviceTier);
      if (!request) return await baseFetch(originalRequest);

      transportOrdinal += 1;
      const dispatchedAtMs = nowMs();
      await options.observer?.onDispatchIntent({
        transportOrdinal,
        attemptedTier: serviceTier,
        dispatchedAtMs,
      });
      const response = await baseFetch(request);
      const completedAtMs = nowMs();
      const backoffMs = response.status === 429 && serviceTier === "flex"
        ? retryDelayMs(response, flex429s + 1)
        : undefined;
      try {
        await options.observer?.onTerminalOutcome({
          transportOrdinal,
          attemptedTier: serviceTier,
          httpStatus: response.status,
          latencyMs: Math.max(0, Math.round(completedAtMs - dispatchedAtMs)),
          ...(providerRequestId(response) ? { providerRequestId: providerRequestId(response) } : {}),
          ...(backoffMs !== undefined ? { backoffMs } : {}),
          completedAtMs,
        });
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      if (response.status !== 429) return response;

      if (disableTransportRetry) return response;

      if (serviceTier === "auto") return response;

      flex429s++;
      await response.body?.cancel().catch(() => undefined);
      await wait(backoffMs!, originalRequest.signal);
      if (flex429s === FLEX_429_RETRY_LIMIT) {
        console.warn("[openai-flex] received 3 Flex 429 responses; retrying on the auto tier.");
        serviceTier = "auto";
      }
    }
  };
}

function providerRequestId(response: Response): string | undefined {
  return response.headers.get("x-request-id")
    ?? response.headers.get("request-id")
    ?? undefined;
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

export function normalizeOpenAIRequestServiceTier(value: unknown): OpenAIRequestServiceTier | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "flex") return "flex";
  if (normalized === "auto" || normalized === "standard" || normalized === "default") return "auto";
  return null;
}

export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLlmClientOptions = {},
): LlmClientConfig | null {
  const explicitProfileId = options.providerProfileId;
  const katanaKey = env.API_KAT_IMGNAI_KEY?.trim();
  const katanaSecret = env.API_KAT_IMGNAI_SECRET?.trim();
  const explicitKatana = explicitProfileId === "katana";
  const explicitMetaMuse = explicitProfileId === "meta-muse";
  const explicitOpenAI = explicitProfileId === "openai";

  const baseURLConfig = explicitKatana
    ? { value: PROVIDER_PROFILES.katana.baseURL!, key: "katana-profile" }
    : explicitMetaMuse
      ? { value: PROVIDER_PROFILES["meta-muse"].baseURL!, key: "meta-muse-profile" }
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
    : explicitMetaMuse
      ? firstEnv(env, ["META_MUSE_API_KEY"])
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
  const openAIServiceTier = providerProfileId === "openai"
    ? options.openAIServiceTier
      ?? (options.flexProcessing === false ? "auto" : "flex")
    : undefined;
  const flexProcessingEnabled = openAIServiceTier === "flex";
  const evidenceFetch = createProviderEvidenceFetch(
    providerProfileId === "lm-studio" ? (input, init) => {
      // Non-streaming local inference may send no bytes for many minutes.
      // Let the SDK/attempt deadline and cancellation own the wait, not Bun's
      // independent five-minute socket idle timer.
      const localInit: RequestInit & { timeout: false } = { ...init, timeout: false };
      return fetch(input, localInit);
    } : fetch,
    [apiKey, katanaKey, katanaSecret].filter((value): value is string =>
      Boolean(value),
    ),
  );
  const providerFetch = flexProcessingEnabled && !options.coordinated
    ? createFlexProcessingFetch(evidenceFetch)
    : evidenceFetch;

  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
      ...(options.timeout !== undefined ? { timeout: options.timeout }
        : providerProfileId === "lm-studio" ? { timeout: lmStudioTimeoutMs(env) } : {}),
      ...(options.maxRetries !== undefined && { maxRetries: options.maxRetries }),
      fetch: providerFetch,
    }),
    apiKeySource: apiKeyConfig?.key ?? "local-default",
    baseURL,
    baseURLSource: baseURLConfig?.key,
    providerLabel: explicitProfileId ? profile.label : providerLabel(baseURL),
    providerProfileId,
    flexProcessingEnabled,
    ...(openAIServiceTier && { openAIServiceTier }),
    ...(providerProfileId === "openai" && openAIReasoningSummary && { openAIReasoningSummary }),
  };
}

/** Resolve one client per provider profile, then bind every sealed entry. */
export function createLlmProviderRuntimesFromEnv(
  manifest: readonly ResolvedProviderManifestEntry[],
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<CreateLlmClientOptions, "providerProfileId"> = {},
): LlmProviderRuntime[] | null {
  const clients = new Map<ProviderProfileId, LlmClientConfig>();
  const adapters = new Map<ProviderProfileId, LlmProviderAdapter>();
  const runtimes: LlmProviderRuntime[] = [];
  for (const entry of manifest) {
    let config = clients.get(entry.providerProfile.id);
    if (!config) {
      config = createLlmClientFromEnv(env, {
        ...options,
        ...(entry.providerProfile.id === "lm-studio" && { timeout: lmStudioTimeoutMs(env) }),
        maxRetries: 0,
        coordinated: true,
        providerProfileId: entry.providerProfile.id,
      }) ?? undefined;
      if (!config) {
        const unavailable = () => { throw new Error(`Provider ${entry.providerProfile.id} is not configured`); };
        runtimes.push({ catalogId: entry.catalogId, providerProfileId: entry.providerProfile.id, modelId: entry.modelId,
          modelCapabilities: entry.model.capabilities, reasoningPolicy: entry.reasoningPolicy, allowedReasoningEfforts: entry.model.allowedReasoningEfforts, position: entry.position, role: entry.role,
          ...(entry.maxCallsPerGame !== undefined && { maxCallsPerGame: entry.maxCallsPerGame }),
          adapter: { id: entry.providerProfile.id, validate: () => ({ compatible: false, reason: `Provider ${entry.providerProfile.id} is not configured` }),
            compile: unavailable, dispatch: unavailable, classifyError: () => ({ kind: "configuration", message: "Provider configuration unavailable", retryable: false }) } });
        continue;
      }
      clients.set(entry.providerProfile.id, config);
    }
    let adapter = adapters.get(entry.providerProfile.id);
    if (!adapter) {
      adapter = createProviderAdapter(entry.providerProfile.id, config.client);
      adapters.set(entry.providerProfile.id, adapter);
    }
    runtimes.push({
      adapter,
      ...(entry.providerProfile.id === "lm-studio" && {
        localRequestTimeoutMs: lmStudioTimeoutMs(env),
      }),
      catalogId: entry.catalogId,
      providerProfileId: entry.providerProfile.id,
      modelId: entry.modelId,
      modelCapabilities: entry.model.capabilities,
      reasoningPolicy: entry.reasoningPolicy,
      allowedReasoningEfforts: entry.model.allowedReasoningEfforts,
      ...(config.openAIReasoningSummary && entry.model.capabilities.supportsReasoningEffort && {
        openAIReasoningSummary: config.openAIReasoningSummary,
      }),
      ...(config.openAIServiceTier && {
        openAIServiceTier: entry.modelId === "gpt-6-luna" ? "flex"
          : config.openAIServiceTier === "flex" && (entry.model.capabilities.supportsFlexProcessing === false
            || !entry.model.capabilities.supportsReasoningEffort) ? "auto"
          : config.openAIServiceTier,
      }),
      position: entry.position,
      role: entry.role,
      ...(entry.maxCallsPerGame !== undefined && {
        maxCallsPerGame: entry.maxCallsPerGame,
      }),
    });
  }
  return runtimes;
}

export function describeLlmProvider(config: LlmClientConfig): string {
  if (!config.baseURL) return config.providerLabel;
  return `${config.providerLabel} (${config.baseURL})`;
}
