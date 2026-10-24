"use client";

import { useEffect, useState } from "react";
import { FREE_MODEL_CATALOG_IDS, type ModelPreference } from "@influence/engine/game-model-routing";
import { modelCatalogEntryById } from "@influence/engine/model-catalog";
import { getProviderModels, type ProviderModelInventoryEntry } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { ModelCombobox } from "./model-combobox";
import { ModelPricing } from "./model-pricing";
import styles from "./model-preference-picker.module.css";

export function ModelPreferencePicker({ value, onChange, allowDefault = true, disabled = false, inventory }: {
  value: ModelPreference; onChange: (value: ModelPreference) => void; allowDefault?: boolean; disabled?: boolean; inventory?: ProviderModelInventoryEntry[];
}) {
  const { account } = useAuth();
  const privileged = account?.roles?.some(role => role === "admin" || role === "sysop") ?? false;
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!privileged || inventory) return; let active = true;
    void getProviderModels().then(result => { if (!Array.isArray(result.models)) throw new Error("Invalid model inventory"); if (active) setModels(result.models); }).catch(() => { if (active) console.warn("Model catalog request failed; retaining current choices."); });
    return () => { active = false; };
  }, [privileged, inventory]);
  const selected = value === "default" ? "default" : value.catalogId;
  const choices = new Map(FREE_MODEL_CATALOG_IDS.map(id => [id as string, modelCatalogEntryById(id)!.displayName]));
  for (const model of inventory ?? models) choices.set(model.catalogId, model.displayName);
  if (selected !== "default" && !choices.has(selected)) choices.set(selected, selected);
  const details = (inventory ?? models).find(model => model.catalogId === selected);
  const metadata = details?.metadata ?? modelCatalogEntryById(selected)?.metadata;
  const options = [
    ...(allowDefault ? [{ value: "default", label: "Default — Let the House decide" }] : []),
    ...[...choices].map(([key, label]) => ({ value: key, label })),
  ];
  return <div className="space-y-2">
    <div className={styles.layout}>
      <ModelCombobox label="Preferred model" disabled={disabled} value={selected} options={options}
        onChange={next => onChange(next === "default" ? "default" : { catalogId: next })} />
      <p className={styles.hint}>Best effort. The House may use another model to keep the game running.</p>
    </div>
    {privileged && <details className="text-xs text-text-muted">
      <summary className="w-fit cursor-pointer py-1 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Use an exact model ID</summary>
      <div className="mt-2 flex max-w-md gap-2">
        <input aria-label="Exact provider:model ID" placeholder="provider:exact-model-id" value={manual} disabled={disabled} onChange={e => setManual(e.target.value)} className="influence-field min-h-10 min-w-0 flex-1 rounded-lg px-3 text-sm" />
        <button type="button" className="influence-button-secondary rounded-lg px-3 text-sm disabled:opacity-40" disabled={disabled || !manual.trim()} onClick={() => { const entry = modelCatalogEntryById(manual.trim()); if (!entry) { setError("Use an exact text model ID from a configured provider."); return; } setError(""); onChange({ catalogId: entry.id }); }}>Use ID</button>
      </div>
    </details>}
    {privileged && selected !== "default" && <ModelPricing rateCard={metadata?.rateCard} />}
    {error && <p role="status" className="text-xs text-text-muted">{error}</p>}
  </div>;
}

