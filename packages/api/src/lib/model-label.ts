import {
  formatResolvedModelSelectionLabel,
  normalizeGameModelSelection,
  resolveModelSelection,
} from "@influence/engine";

export function modelLabelFromConfig(config: Record<string, unknown>): string {
  const storedPrimary = Array.isArray(config.providerManifest)
    ? config.providerManifest[0]
    : config.modelSelection;
  const selection = normalizeGameModelSelection(storedPrimary);
  if (!selection) {
    throw new Error("Stored game model selection is invalid");
  }
  return formatResolvedModelSelectionLabel(resolveModelSelection(selection));
}
