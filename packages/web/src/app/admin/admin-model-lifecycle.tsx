"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MODEL_CATALOG, modelCatalogEntryById, type GameProviderManifest } from "@influence/engine/model-catalog";
import type { GameModelRouting, ModelPreference } from "@influence/engine/game-model-routing";
import { isHouseModelCutoffActive, type HouseModelCutoff, type ModelRateCard } from "@influence/engine/model-route-metadata";
import { ModelPricing } from "@/components/model-pricing";
import { ApiError, apiFetch, getProviderModels, type ProviderModelInventoryEntry } from "@/lib/api";

const endpoint = "/api/admin/model-lifecycle";
const emptyChange = { sourceCatalogId: "", cutoffDate: "", replacementCatalogId: "" };
type Change = typeof emptyChange;
type Rule = HouseModelCutoff & { approvedAt: string };
type Lifecycle = { cutoffs: Record<string, Rule>; defaultManifest: GameProviderManifest };
type PreferenceChange = { id: string; before: ModelPreference; after: ModelPreference };
type Preview = {
  previewId: string;
  change: Change;
  accountCount: number;
  profiles: (PreferenceChange & { name: string; userId: string })[];
  lobbies: { id: string; slug: string; kind: string; before: GameModelRouting; after: GameModelRouting; routeChanged: boolean; seats: PreferenceChange[] }[];
  defaults: { before: GameProviderManifest; after: GameProviderManifest; changed: boolean };
  blocked: string[];
  sourceRateCard: ModelRateCard | null;
  replacementRateCard: ModelRateCard | null;
};

const control = "mt-1.5 block min-h-10 w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-sm text-white";
const action = "rounded-md border border-indigo-500/50 px-3 py-2 text-sm text-indigo-100 disabled:opacity-50";

export function AdminModelLifecycle() {
  const [settings, setSettings] = useState<Lifecycle>();
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [draft, setDraft] = useState<Change>(emptyChange);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let current = true;
    void apiFetch<Lifecycle>(endpoint).then(result => { if (current) setSettings(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Model lifecycle is unavailable."); });
    void getProviderModels().then(result => { if (current) setModels(result.models); })
      .catch(() => { if (current) setNotice("Live model listings are unavailable. Catalog IDs are still available."); });
    return () => { current = false; };
  }, []);

  const choices = new Map(MODEL_CATALOG.filter(model => model.metadata.documented).map(model => [model.id, model.displayName]));
  for (const model of models) {
    if (model.metadata.documented) choices.set(model.catalogId, model.displayName);
  }
  const announced = modelCatalogEntryById(draft.sourceCatalogId.trim())?.metadata.documented?.deprecation;
  const replacement = models.find(model => model.catalogId === draft.replacementCatalogId.trim());

  function edit(change: Partial<Change>) {
    setDraft(previous => ({ ...previous, ...change }));
    setPreview(undefined);
    setError("");
    setNotice("");
  }

  function chooseSource(sourceCatalogId: string) {
    const rule = settings?.cutoffs[sourceCatalogId.trim()];
    edit(rule ? { sourceCatalogId, cutoffDate: rule.cutoffDate, replacementCatalogId: rule.replacementCatalogId } : { sourceCatalogId });
  }

  async function previewChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("preview"); setError(""); setNotice(""); setPreview(undefined);
    try {
      setPreview(await apiFetch<Preview>(`${endpoint}/preview`, { method: "POST", body: JSON.stringify({
        ...draft, sourceCatalogId: draft.sourceCatalogId.trim(), replacementCatalogId: draft.replacementCatalogId.trim(),
      }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview failed."); }
    finally { setBusy(undefined); }
  }

  async function approve() {
    if (!preview) return;
    setBusy("apply"); setError("");
    try {
      const { rule } = await apiFetch<{ rule: Rule }>(`${endpoint}/apply`, { method: "POST",
        body: JSON.stringify({ ...preview.change, previewId: preview.previewId }) });
      const { sourceCatalogId } = preview.change;
      setSettings(previous => previous && ({
        cutoffs: { ...previous.cutoffs, [sourceCatalogId]: rule },
        defaultManifest: preview.defaults.after,
      }));
      setPreview(undefined);
      setNotice(`Migration applied. The House cutoff for ${sourceCatalogId} is ${rule.cutoffDate} (UTC).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The result is unknown. Retry this approval to check it.");
      if (cause instanceof ApiError && cause.status === 409) setPreview(undefined);
    } finally { setBusy(undefined); }
  }

  return <section className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-5" aria-labelledby="model-lifecycle-title">
    <h2 id="model-lifecycle-title" className="text-lg font-semibold text-white">Model lifecycle</h2>
    <p className="mt-1 max-w-2xl text-sm text-white/65">
      Set The House cutoff ahead of a provider retirement. Approval moves the reviewed preferences, waiting lobbies, and defaults immediately. The cutoff controls new selections.
    </p>
    {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    <p role="status" className={notice ? "mt-3 text-sm text-indigo-200" : "sr-only"}>{notice}</p>
    {!settings && !error && <p className="mt-4 text-sm text-white/60">Loading model lifecycle…</p>}
    {settings && <>
      {Object.entries(settings.cutoffs).length > 0 && <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
        {Object.entries(settings.cutoffs).map(([id, rule]) => <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span className="break-words text-white/80">{id} → {rule.replacementCatalogId}</span>
          <span className="text-white/60">{isHouseModelCutoffActive(rule) ? "Cutoff active" : "Upcoming cutoff"} · {rule.cutoffDate} UTC
            <button type="button" disabled={Boolean(busy)} className="ml-3 text-indigo-200 underline" onClick={() => chooseSource(id)}>Edit<span className="sr-only"> {id}</span></button>
          </span>
        </li>)}
      </ul>}
      <form className="mt-5" onSubmit={previewChanges}>
        <fieldset disabled={Boolean(busy)} className="grid gap-3 md:grid-cols-[1fr_1fr_11rem]">
          <label className="min-w-0 text-sm text-white/85">Model to retire
            <input className={control} list="lifecycle-model-ids" required value={draft.sourceCatalogId} onChange={event => chooseSource(event.target.value)} placeholder="Provider-qualified model ID" />
            {announced && <span className="mt-1 block break-words text-xs text-white/60">Provider retirement {announced.retirementDate} · {announced.replacementModelId} recommended</span>}
          </label>
          <label className="min-w-0 text-sm text-white/85">Replacement
            <input className={control} list="lifecycle-model-ids" required value={draft.replacementCatalogId} onChange={event => edit({ replacementCatalogId: event.target.value })} placeholder="Provider-qualified model ID" />
            {replacement?.configured === false && <span className="mt-1 block text-xs text-amber-200">Provider credentials are unavailable.</span>}
            {replacement?.configured && replacement.available === false && <span className="mt-1 block text-xs text-amber-200">The model is absent from the current provider listing.</span>}
          </label>
          <label className="min-w-0 text-sm text-white/85">House cutoff (UTC)
            <input className={control} type="date" max={announced?.retirementDate} required value={draft.cutoffDate} onChange={event => edit({ cutoffDate: event.target.value })} />
          </label>
          <datalist id="lifecycle-model-ids">
            {[...choices].sort((a, b) => a[0].localeCompare(b[0])).map(([id, label]) => <option key={id} value={id} label={label} />)}
          </datalist>
        </fieldset>
        <button className={`${action} mt-4`} disabled={Boolean(busy)}>{busy === "preview" ? "Previewing…" : "Preview changes"}</button>
      </form>
      {preview && <section className="mt-5 space-y-4 border-t border-white/10 pt-4" aria-labelledby="model-migration-preview">
        <h3 id="model-migration-preview" className="text-base font-semibold text-white">Migration preview</h3>
        <p className="break-words text-sm text-white/80">{preview.change.sourceCatalogId} → {preview.change.replacementCatalogId} · House cutoff {preview.change.cutoffDate} UTC</p>
        <div className="grid gap-3 text-sm text-white/70 sm:grid-cols-2">
          <div>Current model<ModelPricing rateCard={preview.sourceRateCard} /></div>
          <div>Replacement<ModelPricing rateCard={preview.replacementRateCard} /></div>
        </div>
        <details className="text-sm text-white/75">
          <summary className="cursor-pointer py-1 font-medium text-white">{preview.accountCount} {preview.accountCount === 1 ? "account" : "accounts"} · {preview.profiles.length} saved agent {preview.profiles.length === 1 ? "preference" : "preferences"}</summary>
          <ul className="mt-1 space-y-1 pl-4">{preview.profiles.map(profile => <li key={profile.id} className="break-words">
            {profile.name} ({profile.userId}) · {describePreference(profile.before)} → {describePreference(profile.after)}
          </li>)}</ul>
        </details>
        <details className="text-sm text-white/75">
          <summary className="cursor-pointer py-1 font-medium text-white">{preview.lobbies.length} waiting {preview.lobbies.length === 1 ? "lobby" : "lobbies"}</summary>
          <ul className="mt-1 space-y-3 pl-4">{preview.lobbies.map(lobby => <li key={lobby.id} className="break-words">
            {lobby.slug} · {lobby.kind}
            {lobby.routeChanged && <>
              <RouteDiff label="Contestants" before={lobby.before.defaultManifest} after={lobby.after.defaultManifest} />
              <RouteDiff label="House" before={lobby.before.houseManifest} after={lobby.after.houseManifest} />
              {Object.entries(lobby.after.overrides).map(([id, after]) => {
                const before = lobby.before.overrides[id];
                return before && describePreference(before) !== describePreference(after)
                  ? <p key={id}>Override {id} · {describePreference(before)} → {describePreference(after)}</p> : null;
              })}
            </>}
            {lobby.seats.map(seat => <p key={seat.id}>Seat {seat.id} · {describePreference(seat.before)} → {describePreference(seat.after)}</p>)}
          </li>)}</ul>
        </details>
        <div className="break-words text-sm text-white/75">
          <p className="font-medium text-white">Shared defaults</p>
          {preview.defaults.changed
            ? <RouteDiff label="New games and Daily Free" before={preview.defaults.before} after={preview.defaults.after} />
            : <p>Current default route stays in use.</p>}
        </div>
        {preview.blocked.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200" aria-label="Migration blockers">
          {preview.blocked.map(reason => <li key={reason}>{reason}</li>)}
        </ul>}
        <button type="button" className={action} disabled={Boolean(busy) || preview.blocked.length > 0} onClick={() => void approve()}>
          {busy === "apply" ? "Applying…" : "Approve and apply"}
        </button>
      </section>}
    </>}
  </section>;
}

function describePreference(preference: ModelPreference) {
  return preference === "default" ? "Default" : `${preference.catalogId} (${preference.reasoningPolicy ?? "default effort"})`;
}

function RouteDiff({ label, before, after }: { label: string; before: GameProviderManifest; after: GameProviderManifest }) {
  const describe = (route: GameProviderManifest) => route.map(entry =>
    `${describePreference(entry)}${entry.maxCallsPerGame === undefined ? "" : ` · ${entry.maxCallsPerGame} calls`}`).join(" → ");
  const original = describe(before);
  const next = describe(after);
  if (original === next) return null;
  return <div className="mt-1 space-y-1">
    <p className="font-medium">{label}</p>
    <p>Before · {original}</p>
    <p>After · {next}</p>
  </div>;
}
