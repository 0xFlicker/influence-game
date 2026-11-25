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
import { ModelRetirement, modelRetirement } from "./model-retirement";
import type { HouseModelCutoffs } from "@influence/engine/model-route-metadata";
import styles from "./model-preference-picker.module.css";

export function ModelPreferencePicker({
  value,
  onChange,
  allowDefault = true,
  disabled = false,
  inventory,
  cutoffs,
  compact = false,
}: {
  compact?: boolean;
  value: ModelPreference;
  onChange: (value: ModelPreference) => void;
  allowDefault?: boolean;
  disabled?: boolean;
  inventory?: ProviderModelInventoryEntry[];
  cutoffs?: HouseModelCutoffs;
}) {
  const { account } = useAuth();
  const privileged =
    account?.roles?.some((role) => role === "admin" || role === "sysop") ??
    false;
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [loadedCutoffs, setLoadedCutoffs] = useState<HouseModelCutoffs>({});
  const [opened, setOpened] = useState(false);
  const accountId = account?.id;
  const shouldLoad = privileged || opened || value !== "default";
  useEffect(() => {
    if (!accountId || inventory || !shouldLoad) return;
    let active = true;
    void getProviderModels()
      .then((result) => {
        if (!Array.isArray(result.models))
          throw new Error("Invalid model inventory");
        if (active) {
          setModels(result.models);
          setLoadedCutoffs(result.cutoffs ?? {});
        }
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
  }, [accountId, inventory, shouldLoad]);
  const effectiveCutoffs = cutoffs ?? loadedCutoffs;
  const selected = value === "default" ? "default" : value.catalogId;
  const discovered = new Map((inventory ?? models).map(model => [model.catalogId, model]));
  const choices = new Map(
    FREE_MODEL_CATALOG_IDS.map((id) => [
      id as string,
      modelCatalogEntryById(id)!.displayName,
    ]),
  );
  for (const model of discovered.values())
    choices.set(model.catalogId, model.displayName);
  if (selected !== "default" && !choices.has(selected))
    choices.set(selected, modelCatalogEntryById(selected)?.displayName ?? selected);
  const details = discovered.get(selected);
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
    ...[...choices].map(([key, label]) => {
      const retirement = modelRetirement(key, discovered.get(key)?.metadata, effectiveCutoffs[key]);
      return { value: key, label, detail: retirement?.text, disabled: retirement?.retired };
    }),
  ];
  return (
    <div className="space-y-2">
      <div className={`${styles.layout} ${compact ? styles.compact : ""}`}>
        <ModelCombobox
          label="Preferred model"
          disabled={disabled}
          value={selected}
          options={options}
          onOpen={() => setOpened(true)}
          onChange={(next) =>
            onChange(next === "default" ? "default" : { catalogId: next })
          }
        />
      </div>
      <ModelRetirement catalogId={selected} metadata={metadata} cutoff={effectiveCutoffs[selected]} />
      {privileged && selected !== "default" && (
        <ModelPricing rateCard={metadata?.rateCard} />
      )}
    </div>
  );
}
