import {
  resolveProviderManifest,
  type ResolvedProviderManifestEntry,
} from "@influence/engine";

export const DAILY_FREE_MODEL = "gpt-5.6-luna";

export const DAILY_FREE_MODEL_SELECTION = {
  catalogId: `openai:${DAILY_FREE_MODEL}`,
  reasoningPolicy: "action-policy",
} as const;

export const DAILY_FREE_PROVIDER_MANIFEST = [
  DAILY_FREE_MODEL_SELECTION,
  {
    catalogId: "katana:glm-5-2",
    reasoningPolicy: "action-policy",
    maxCallsPerGame: 24,
  },
  {
    catalogId: "katana:grok-4-5",
    reasoningPolicy: "action-policy",
    maxCallsPerGame: 12,
  },
] as const;

export function resolveDailyFreeProviderManifest(): ResolvedProviderManifestEntry[] {
  return resolveProviderManifest(DAILY_FREE_PROVIDER_MANIFEST);
}
