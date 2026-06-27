import {
  formatGameModelSelectionLabel,
  normalizeGameModelSelection,
} from "@influence/engine";

export function modelLabelFromConfig(config: Record<string, unknown>): string {
  const selection = normalizeGameModelSelection(config.modelSelection);
  const legacyTier = typeof config.modelTier === "string" ? config.modelTier : undefined;
  try {
    return formatGameModelSelectionLabel(selection, legacyTier);
  } catch {
    if (selection) {
      return "Selected model";
    }
  }
  const tier = legacyTier ?? "budget";
  return `${tier.charAt(0).toUpperCase()}${tier.slice(1)} tier`;
}
