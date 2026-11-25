import { DEFAULT_MODEL_CATALOG_ID, DEFAULT_GAME_FALLBACKS } from "@influence/engine/model-defaults";
import { normalizeProviderManifest, type GameProviderManifest } from "@influence/engine/model-catalog";
import { isHouseModelCutoffActive, type HouseModelCutoff } from "@influence/engine/model-route-metadata";
import type { ModelPreference } from "@influence/engine/game-model-routing";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";

export const MODEL_LIFECYCLE_KEY = "model_lifecycle";

export interface ModelLifecycleRule extends HouseModelCutoff {
  approvedAt: string;
  approvedBy: string;
  previewId: string;
}

export interface ModelLifecycleSettings {
  cutoffs: Record<string, ModelLifecycleRule>;
  defaultManifest?: GameProviderManifest;
}

export async function readModelLifecycle(db: Pick<DrizzleDB, "select">): Promise<ModelLifecycleSettings> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings)
    .where(eq(schema.appSettings.key, MODEL_LIFECYCLE_KEY));
  return row ? JSON.parse(row.value) as ModelLifecycleSettings : { cutoffs: {} };
}

export function lifecycleDefaultManifest(settings: ModelLifecycleSettings): GameProviderManifest {
  return settings.defaultManifest ?? normalizeProviderManifest([{ catalogId: DEFAULT_MODEL_CATALOG_ID }, ...DEFAULT_GAME_FALLBACKS]);
}

/** Publishing older character content must not revert the single operational preference. */
export async function currentPublishedModelPreference(
  db: Pick<DrizzleDB, "select">, saved: ModelPreference, submitted: ModelPreference, submittedAt: string,
): Promise<ModelPreference> {
  if (submitted === "default" || (saved !== "default" && saved.catalogId === submitted.catalogId)) return submitted;
  const { cutoffs } = await readModelLifecycle(db);
  const first = cutoffs[submitted.catalogId];
  if (isHouseModelCutoffActive(first)) return saved;
  if (!first || saved === "default" || !(Date.parse(submittedAt) <= Date.parse(first.approvedAt))) return submitted;

  let catalogId = first.replacementCatalogId;
  const visited = new Set([submitted.catalogId]);
  while (!visited.has(catalogId)) {
    if (catalogId === saved.catalogId) return saved;
    visited.add(catalogId);
    const rule = cutoffs[catalogId];
    if (!rule) break;
    catalogId = rule.replacementCatalogId;
  }
  return submitted;
}
