import {
  DEFAULT_MODEL_ID,
  resolveProviderManifest,
  type ResolvedProviderManifestEntry,
} from "@influence/engine";

export const DAILY_FREE_MODEL = DEFAULT_MODEL_ID;

export const DAILY_FREE_MODEL_SELECTION = {
  catalogId: `openai:${DAILY_FREE_MODEL}`,
  reasoningPolicy: "action-policy",
} as const;

export const DAILY_FREE_PROVIDER_MANIFEST = [
  DAILY_FREE_MODEL_SELECTION,
] as const;

export function resolveDailyFreeProviderManifest(): ResolvedProviderManifestEntry[] {
  return resolveProviderManifest(DAILY_FREE_PROVIDER_MANIFEST);
}
