import {
  formatGameModelSelectionLabel,
  normalizeGameModelSelection,
} from "@influence/engine";

export function modelLabelFromConfig(config: Record<string, unknown>): string {
  const selection = normalizeGameModelSelection(config.modelSelection);
  return formatGameModelSelectionLabel(selection);
}
