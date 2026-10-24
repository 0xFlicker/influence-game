import { modelCatalogEntryById } from "@influence/engine/model-catalog";
import type { ModelPreference } from "@influence/engine/game-model-routing";

export function agentModelLabel(preference: ModelPreference | null | undefined): string | null {
  if (!preference || preference === "default") return null;
  return modelCatalogEntryById(preference.catalogId)?.displayName ?? preference.catalogId;
}

/** Current character preference; never infer a historical game's actual model. */
export function AgentModelLabel({ preference, className = "text-xs text-text-secondary" }: {
  preference: ModelPreference | null | undefined;
  className?: string;
}) {
  const label = agentModelLabel(preference);
  return label ? <span className={className} title={preference && preference !== "default" ? preference.catalogId : undefined}>{label}</span> : null;
}
