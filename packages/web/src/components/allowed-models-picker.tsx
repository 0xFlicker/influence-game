"use client";

import { useId, useState } from "react";
import { modelCatalogEntryById, PROVIDER_PROFILES } from "@influence/engine/model-catalog";
import styles from "./allowed-models-picker.module.css";

export function AllowedModelsPicker({ models, excludedIds, inUseIds = [], onChange }: {
  models: readonly { catalogId: string; displayName: string }[];
  excludedIds: string[];
  inUseIds?: string[];
  onChange: (ids: string[]) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const choices = new Map(models.map(model => [model.catalogId, model.displayName]));
  for (const id of [...excludedIds, ...inUseIds]) {
    if (!choices.has(id)) choices.set(id, modelCatalogEntryById(id)?.displayName ?? id);
  }
  const excluded = new Set(excludedIds);
  const inUse = new Set(inUseIds);
  const matching = [...choices].filter(([id, name]) => `${name} ${id}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <details className={styles.panel}>
    <summary className={styles.summary}>
      <span className={styles.title}>Allowed models</span>
      <span className={styles.count}>{excluded.size === 0 ? "All allowed" : `${excluded.size} excluded`}</span>
      <svg className={styles.chevron} width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </summary>
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <p>Uncheck models you don’t want in this game.</p>
        {excluded.size > 0 && <button type="button" className={styles.reset} onClick={() => onChange([])}>Allow all</button>}
      </div>
      {choices.size > 8 && <div className={styles.search}>
        <label htmlFor={searchId} className="sr-only">Search models</label>
        <input id={searchId} type="search" placeholder="Search models…" value={query} onInput={event => setQuery(event.currentTarget.value)} className="influence-field" />
      </div>}
      <div className={styles.list} role="group" aria-label="Allowed models">
        {matching.map(([id, name]) => {
          const provider = modelCatalogEntryById(id)?.providerProfileId;
          const used = inUse.has(id);
          return <label key={id} className={styles.option}>
            <input type="checkbox" checked={!excluded.has(id)} disabled={used && !excluded.has(id)}
              aria-label={`Allow ${name}`} title={used ? "Selected in a route or cast assignment" : undefined}
              onChange={event => onChange(event.target.checked ? excludedIds.filter(value => value !== id) : [...excludedIds, id])} />
            <span className={styles.name}>{name}<span className={styles.provider}>{provider ? provider === "lm-studio" ? "LM Studio" : PROVIDER_PROFILES[provider].label : id}</span></span>
            {used && <span className={styles.used}>In use</span>}
          </label>;
        })}
        {matching.length === 0 && <p className={styles.empty}>No models match “{query}”.</p>}
      </div>
    </div>
  </details>;
}
