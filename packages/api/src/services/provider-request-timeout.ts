const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 300_000;
const MIN_PROVIDER_REQUEST_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60_000;

export function providerRequestTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.INFLUENCE_LLM_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  }
  return Math.max(
    MIN_PROVIDER_REQUEST_TIMEOUT_MS,
    Math.min(MAX_PROVIDER_REQUEST_TIMEOUT_MS, Math.floor(configured)),
  );
}

