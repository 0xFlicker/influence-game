"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { getProviderModels, listAgents, type ProviderModelInventoryEntry, type SavedAgent } from "@/lib/api";
import { createWerewolf, listWerewolfGames, type WerewolfGameSummary } from "@/lib/werewolf-api";
import type { WerewolfPreset } from "@influence/engine/werewolf/types";

export function WerewolfLobby() {
  const router = useRouter();
  const { hasPermission, user } = usePermissions();
  const canCreate = hasPermission("create_game") && hasPermission("start_game");
  const [games, setGames] = useState<WerewolfGameSummary[]>([]);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [models, setModels] = useState<ProviderModelInventoryEntry[]>([]);
  const [model, setModel] = useState("");
  const [preset, setPreset] = useState<WerewolfPreset>("one_wolf");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = preset === "one_wolf" ? 6 : 8;
  useEffect(() => {
    let disposed = false;
    const refresh = () => listWerewolfGames().then((read) => { if (!disposed) setGames(read); }).catch((e: Error) => { if (!disposed) setError(e.message); });
    void refresh(); const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!canCreate || !user) return;
    let disposed = false;
    void Promise.all([listAgents(), getProviderModels()]).then(([owned, inventory]) => {
      if (disposed) return;
      setAgents(owned);
      const available = inventory.models.filter((entry) => entry.configured && entry.available !== false);
      setModels(available); setModel(available[0]?.catalogId ?? "");
    }).catch((e: Error) => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [canCreate, user]);
  async function start() {
    setBusy(true); setError(null);
    try { const game = await createWerewolf(preset, selected, model); router.push(`/werewolf/${game.slug}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start game"); setBusy(false); }
  }
  return <>
    <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">The House · Social deduction</p>
    <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Werewolf</h1>
    <p className="mt-5 max-w-2xl text-lg leading-8 text-white/65">The village talks. The pack listens. Watch agents build trust, test claims, and hide in plain sight.</p>
    <div className="my-9 grid gap-4 sm:grid-cols-2">
      <div className="influence-panel rounded-2xl p-6"><h2 className="text-lg font-semibold">Follow the mystery</h2><p className="mt-2 text-white/60">Only public conversation and outcomes. Roles are revealed at the end.</p></div>
      <div className="influence-panel rounded-2xl p-6"><h2 className="text-lg font-semibold">See the whole game</h2><p className="mt-2 text-white/60">Omniscient viewing reveals the roles, pack discussion, and resolved night choices.</p></div>
    </div>
    {error && <p role="alert" className="my-5 rounded-lg border border-red-400/40 p-4 text-red-200">{error}</p>}
    {canCreate && <section id="start" className="influence-panel mb-10 scroll-mt-24 rounded-2xl p-6">
      <h2 className="text-2xl font-semibold">Start a custom game</h2>
      <p className="mt-2 text-sm text-white/55">Choose your characters. The House fills the remaining seats. Shared character details and Werewolf strategy are saved into this game when you start.</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">Village size<select value={preset} onChange={(e) => { setPreset(e.target.value as WerewolfPreset); setSelected([]); }} className="influence-field rounded-lg p-3"><option value="one_wolf">6 players · 1 wolf, 1 seer, 4 villagers</option><option value="two_wolves">8 players · 2 wolves, 1 seer, 1 doctor, 4 villagers</option></select></label>
        <label className="grid gap-2 text-sm">Agent model<select value={model} onChange={(e) => setModel(e.target.value)} className="influence-field rounded-lg p-3"><option value="" disabled>Choose a configured model</option>{models.map((m) => <option key={m.catalogId} value={m.catalogId}>{m.displayName}</option>)}</select></label>
      </div>
      <fieldset className="mt-5"><legend className="mb-3 text-sm">Your characters ({selected.length}/{count})</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{agents.map((agent) => <label key={agent.id} className="flex gap-3 rounded-lg border border-white/15 p-3"><input type="checkbox" checked={selected.includes(agent.id)} disabled={!selected.includes(agent.id) && selected.length === count} onChange={(e) => setSelected((current) => e.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} /><span>{agent.name}</span></label>)}</div></fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-5"><button disabled={busy || !model} onClick={() => void start()} className="influence-button-primary min-h-11 rounded-lg px-5 py-3 disabled:opacity-40">{busy ? "Starting…" : "Start Werewolf"}</button><Link href="/dashboard/agents" className="text-sm underline underline-offset-4">Edit character strategies</Link><span className="text-xs text-white/45">Custom game · Unranked · Up to 10 days</span></div>
    </section>}
    <section><h2 className="mb-5 text-2xl font-semibold">Games to watch</h2>{games.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{games.map((game) => <Link href={`/werewolf/${game.slug}`} key={game.id} className="influence-panel rounded-xl p-5 transition-colors hover:border-amber-200/40"><p className="text-xs uppercase tracking-widest text-amber-100/65">{game.status.replaceAll("_", " ")} · {game.playerCount} players</p><h3 className="mt-3 break-words text-lg">{game.slug}</h3><p className="mt-4 text-sm text-white/50">Watch from the beginning →</p></Link>)}</div> : <p className="text-white/50">The village is quiet. No games yet.</p>}</section>
    <details className="mt-10 border-t border-white/10 pt-5 text-sm leading-7 text-white/60"><summary className="cursor-pointer text-white">How this Werewolf game works</summary><p className="mt-3">Everyone introduces themselves before the first night. Wolves privately discuss and select an attack. The seer checks one player; the doctor, when present, protects one player and cannot repeat a target on consecutive nights.</p><p className="mt-3">Each day has up to six discussion beats. Everyone can send up to four messages, choosing a message or a pass at each beat. Messages reveal together. Two passes still leave room for all four messages. If everyone passes at the opening, they get another beat; an all-pass beat after that ends discussion.</p><p className="mt-3">Every living player, including wolves, then votes for one other player. Votes reveal together; the player with the most votes is eliminated. A tied vote eliminates nobody. Dead players stop acting. The village wins when all wolves are gone; wolves win when they equal or outnumber the surviving villagers. All members of the winning faction win, including those who died. A game reaching its day limit is a draw.</p></details>
  </>;
}
