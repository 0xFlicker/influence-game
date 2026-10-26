import { formatResolvedModelSelectionLabel, resolveProviderManifestFromGameConfig } from "@influence/engine";

export function modelLabelFromConfig(config: Record<string, unknown>): string {
  return formatResolvedModelSelectionLabel(resolveProviderManifestFromGameConfig(config)[0]!);
}
