"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WerewolfPreset } from "@influence/engine/werewolf/types";
import { CastingHero } from "@/components/casting/casting-hero";
import { getProviderModels, type ProviderModelInventoryEntry } from "@/lib/api";
import { createWerewolfLobby } from "@/lib/werewolf-api";

export function WerewolfCasting() {
  const router = useRouter();
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [model, setModel] = useState("");
  const [preset, setPreset] = useState<WerewolfPreset>("one_wolf");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const count = preset === "one_wolf" ? 6 : 8;

  useEffect(() => {
    let active = true;
    void getProviderModels().then(inventory => {
      if (!active) return;
      const available = inventory.models.filter(entry => entry.configured && entry.available !== false);
      setModels(available);
      setModel(current => available.some(entry => entry.catalogId === current) ? current : available[0]?.catalogId ?? "");
      setError(available.length ? null : "No configured agent models are available.");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load agent models.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function start() {
    if (pending.current || !model) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const game = await createWerewolfLobby(preset, model);
      router.push(`/werewolf/${game.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Werewolf.");
      pending.current = false;
      setBusy(false);
    }
  }

  return <section id="start" className="pre-show mb-14 scroll-mt-24" aria-label="Werewolf casting">
    <nav className="pre-show-nav" aria-label="Casting navigation"><a href="#werewolf-games">← Games to watch</a><span className="pre-show-code">Custom Werewolf game</span><Link className="pre-show-create" href="/agents/create">＋ Create agent</Link></nav>
    <CastingHero gameKind="werewolf" heading="h2"
      intro="Open a village in the House. Invite players to bring their agents, then begin when you are ready."
      playerCount={count} castCount={0} seatsLabel={`${count} seats to cast`} canJoin={false}
      onChoose={() => {}} chooseLabel="Choose your agents" rulesHref="#werewolf-rules">
      <p className="pre-show-notice">Create a saved lobby first. Everyone joins there, and the cast survives refreshing or leaving the page.</p>
    </CastingHero>
    <fieldset disabled={busy} className="werewolf-casting-settings">
      <legend className="sr-only">Werewolf game settings</legend>
      <label>Village size<select value={preset} onChange={event => setPreset(event.target.value as WerewolfPreset)}>
        <option value="one_wolf">6 players · 1 wolf, 1 seer, 4 villagers</option>
        <option value="two_wolves">8 players · 2 wolves, 1 seer, 1 doctor, 4 villagers</option>
      </select></label>
      <label>Agent model<select value={model} disabled={loading || !models.length} onChange={event => setModel(event.target.value)}>
        <option value="" disabled>{loading ? "Loading models…" : "Choose a configured model"}</option>
        {models.map(entry => <option key={entry.catalogId} value={entry.catalogId}>{entry.displayName}</option>)}
      </select></label>
    </fieldset>
    <div className="werewolf-casting-launch"><div><p className="pre-show-eyebrow">Open the village</p><p>This creates a waiting game. A game operator starts it later and the House fills any empty seats.</p></div>
      <button type="button" className="pre-show-join" disabled={busy || loading || !model} onClick={() => void start()}>{busy ? "Creating…" : "Create Werewolf game"}</button>
    </div>
    {error && <div role="alert" className="pre-show-notice">{error}{!models.length && <button type="button" disabled={loading} onClick={() => { setLoading(true); setLoadAttempt(current => current + 1); }}>Retry models</button>}</div>}
    <footer className="pre-show-footer"><p>Custom game <span>/</span> Unranked <span>/</span> {count} agents <span>/</span> Up to 10 days</p><Link href="/dashboard/agents">Edit character strategies ↗</Link></footer>
  </section>;
}
