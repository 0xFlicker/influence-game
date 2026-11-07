"use client";

import { useEffect, useState } from "react";
import {
  FREE_MODEL_CATALOG_IDS,
  type ModelPreference,
} from "@influence/engine/game-model-routing";
import { modelCatalogEntryById } from "@influence/engine/model-catalog";
import { getProviderModels, type ProviderModelInventoryEntry } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { ModelCombobox } from "./model-combobox";
import { ModelPricing } from "./model-pricing";
import styles from "./model-preference-picker.module.css";

export function ModelPreferencePicker({
  value,
  onChange,
  allowDefault = true,
  disabled = false,
  inventory,
  compact = false,
}: {
  compact?: boolean;
  value: ModelPreference;
  onChange: (value: ModelPreference) => void;
  allowDefault?: boolean;
  disabled?: boolean;
  inventory?: ProviderModelInventoryEntry[];
}) {
  const { account } = useAuth();
  const privileged =
    account?.roles?.some((role) => role === "admin" || role === "sysop") ??
    false;
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  useEffect(() => {
    if (!privileged || inventory) return;
    let active = true;
    void getProviderModels()
      .then((result) => {
        if (!Array.isArray(result.models))
          throw new Error("Invalid model inventory");
        if (active) setModels(result.models);
      })
      .catch(() => {
        if (active)
          console.warn(
            "Model catalog request failed; retaining current choices.",
          );
      });
    return () => {
      active = false;
    };
  }, [privileged, inventory]);
  const selected = value === "default" ? "default" : value.catalogId;
  const choices = new Map(
    FREE_MODEL_CATALOG_IDS.map((id) => [
      id as string,
      modelCatalogEntryById(id)!.displayName,
    ]),
  );
  for (const model of inventory ?? models)
    choices.set(model.catalogId, model.displayName);
  if (selected !== "default" && !choices.has(selected))
    choices.set(selected, selected);
  const details = (inventory ?? models).find(
    (model) => model.catalogId === selected,
  );
  const metadata =
    details?.metadata ?? modelCatalogEntryById(selected)?.metadata;
  const options = [
    ...(allowDefault
      ? [
          {
            value: "default",
            label: compact ? "House choice" : "Default — Let the House decide",
          },
        ]
      : []),
    ...[...choices].map(([key, label]) => ({ value: key, label })),
  ];
  return (
    <div className="space-y-2">
      <div className={`${styles.layout} ${compact ? styles.compact : ""}`}>
        <ModelCombobox
          label="Preferred model"
          disabled={disabled}
          value={selected}
          options={options}
          onChange={(next) =>
            onChange(next === "default" ? "default" : { catalogId: next })
          }
        />
      </div>
      {privileged && selected !== "default" && (
        <ModelPricing rateCard={metadata?.rateCard} />
      )}
    </div>
  );
}
