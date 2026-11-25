import {
  resolveProviderManifest,
  type ResolvedProviderManifestEntry,
} from "@influence/engine";
import { assertCurrentGameModelRouting, gameModelPolicy } from "@influence/engine/game-model-routing";
import type { DrizzleDB } from "../db/index.js";
import { lifecycleDefaultManifest, readModelLifecycle } from "./model-lifecycle-settings.js";

export async function dailyFreeModelRouting(db: Pick<DrizzleDB, "select">) {
  const settings = await readModelLifecycle(db);
  const policy = gameModelPolicy({ providerManifest: lifecycleDefaultManifest(settings) });
  assertCurrentGameModelRouting(policy, settings.cutoffs);
  return policy;
}

export async function resolveDailyFreeProviderManifest(db: Pick<DrizzleDB, "select">): Promise<ResolvedProviderManifestEntry[]> {
  return resolveProviderManifest((await dailyFreeModelRouting(db)).defaultManifest);
}
