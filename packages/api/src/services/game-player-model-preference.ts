import type { GameModelRouting, ModelPreference } from "@influence/engine/game-model-routing";

/** Public saved selection, not the model that answered any particular turn. */
export function gamePlayerModelPreference(
  config: { modelRouting?: GameModelRouting },
  playerId: string,
  enrollmentPreference?: ModelPreference | null,
): { modelPreference?: ModelPreference } {
  const preference = config.modelRouting?.overrides?.[playerId] ?? enrollmentPreference;
  return preference && preference !== "default"
    ? { modelPreference: { catalogId: preference.catalogId } }
    : {};
}
