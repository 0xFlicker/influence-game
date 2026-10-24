"use client";

import { useEffect, useState } from "react";
import type { GameModelRouting, ModelPreference } from "@influence/engine/game-model-routing";
import { apiFetch, getProviderModels, type ProviderModelInventoryEntry } from "@/lib/api";
import { ProviderRouteEditor, type ProviderRouteEntry } from "@/app/admin/games/new/create-game-form";
import { ModelPreferencePicker } from "./model-preference-picker";
import { AllowedModelsPicker } from "./allowed-models-picker";

interface RoutingRead {
  policy: GameModelRouting; frozen: boolean;
  seats: Array<{ id: string; name?: string; preference: ModelPreference; manifest: GameModelRouting["defaultManifest"]; source: string }>;
}
const entries = (route: GameModelRouting["defaultManifest"]): ProviderRouteEntry[] => route.map(entry => ({ ...entry, reasoningPolicy: entry.reasoningPolicy ?? "action-policy", uiId: entry.catalogId }));
const clean = (route: ProviderRouteEntry[]) => route.map(({ catalogId, reasoningPolicy, maxCallsPerGame }) => ({ catalogId, reasoningPolicy, ...(maxCallsPerGame !== undefined && { maxCallsPerGame }) }));

export function GameModelSettings({ gameId }: { gameId: string }) {
  const [data, setData] = useState<RoutingRead>();
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [policy, setPolicy] = useState<GameModelRouting>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/model-routing/games/${encodeURIComponent(gameId)}`;
  useEffect(() => { let active = true;
    void Promise.all([apiFetch<RoutingRead>(url), getProviderModels()]).then(([routing, inventory]) => {
      if (active) { setData(routing); setPolicy(routing.policy); setModels(inventory.models); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load model settings"); });
    return () => { active = false; };
  }, [url]);
  const options = models.map(model => ({ ...model, supportsImageInput: model.capabilities.supportsImageInput }));
  async function save() {
    setBusy(true); setError("");
    try { const saved = await apiFetch<RoutingRead>(url, { method: "PUT", body: JSON.stringify(policy) }); setData(saved); setPolicy(saved.policy); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save model settings"); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-4xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Game models</h1>
    {error && <p role="alert">{error}</p>}
    {!data || !policy ? <p role="status">Loading model assignments…</p> : <>
      {data.frozen && <p>Assignments are frozen for this game.</p>}
      <fieldset disabled={data.frozen || busy} className="space-y-6">
        {(["defaultManifest", "houseManifest"] as const).map(key => <section key={key} className="rounded-xl border border-white/15 p-4">
          <h2 className="mb-3 font-semibold">{key === "defaultManifest" ? "Default contestants and shared fallbacks" : "House and House fallbacks"}</h2>
          <ProviderRouteEditor labelPrefix={key === "houseManifest" ? "House " : ""} entries={entries(policy[key])} models={options} visualMode={false} activeRoute={entries(policy[key])} onChange={route => setPolicy({ ...policy, [key]: clean(route) })} />
        </section>)}
        <AllowedModelsPicker models={models} excludedIds={policy.excludedCatalogIds}
          inUseIds={[...policy.defaultManifest, ...policy.houseManifest].map(entry => entry.catalogId).concat(Object.values(policy.overrides).flatMap(value => value === "default" ? [] : [value.catalogId]))}
          onChange={excludedCatalogIds => setPolicy({ ...policy, excludedCatalogIds })} />
        <h2 className="font-semibold">Cast preferences</h2>
        {data.seats.map(seat => <section key={seat.id} className="rounded-xl border border-white/15 p-4">
          <h3 className="mb-2 font-medium">{seat.name ?? seat.id}</h3>
          <ModelPreferencePicker inventory={models} value={policy.overrides[seat.id] ?? seat.preference} onChange={preference => setPolicy({ ...policy, overrides: { ...policy.overrides, [seat.id]: preference } })} />
          <button className="mt-2 text-sm underline" type="button" onClick={() => { const overrides = { ...policy.overrides }; delete overrides[seat.id]; setPolicy({ ...policy, overrides }); }}>Use enrolled preference</button>
          <p className="mt-2 text-xs text-text-muted">Saved route: {seat.manifest.map(entry => entry.catalogId).join(" → ")}{seat.manifest.length === 1 ? " · No alternate route" : ""}</p>
        </section>)}
        <button type="button" onClick={() => void save()} className="influence-button-primary rounded px-4 py-2">{busy ? "Saving…" : "Save model settings"}</button>
      </fieldset>
    </>}
  </section>;
}
