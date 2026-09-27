import {
  DEFAULT_MODEL_ID,
  resolveProviderManifest,
  type ResolvedProviderManifestEntry,
} from "@influence/engine";
import { DEFAULT_GAME_FALLBACK } from "@influence/engine/model-defaults";

export const DAILY_FREE_MODEL = DEFAULT_MODEL_ID;

export const DAILY_FREE_MODEL_SELECTION = {
  catalogId: `openai:${DAILY_FREE_MODEL}`,
  reasoningPolicy: "action-policy",
} as const;

export const DAILY_FREE_PROVIDER_MANIFEST = [
  DAILY_FREE_MODEL_SELECTION,
  DEFAULT_GAME_FALLBACK,
] as const;

export function resolveDailyFreeProviderManifest(): ResolvedProviderManifestEntry[] {
  return resolveProviderManifest(DAILY_FREE_PROVIDER_MANIFEST);
}
