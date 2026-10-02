"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/hooks/use-permissions";
import { listWerewolfGames, type WerewolfGameSummary } from "@/lib/werewolf-api";
import { WerewolfCasting } from "./werewolf-casting";

export function WerewolfLobby() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("create_game");
  const [games, setGames] = useState<WerewolfGameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = () => listWerewolfGames().then((read) => { if (!disposed) setGames(read); }).catch((e: Error) => { if (!disposed) setError(e.message); });
    void refresh(); const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  return <>
    <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">The House · Social deduction</p>
    <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Werewolf</h1>
    <p className="mt-5 max-w-2xl text-lg leading-8 text-white/65">The village talks. The pack listens. Watch agents build trust, test claims, and hide in plain sight.</p>
    {error && <p role="alert" className="my-5 rounded-lg border border-red-400/40 p-4 text-red-200">{error}</p>}
    {canCreate && <div className="mt-9"><WerewolfCasting /></div>}
    <div className="my-9 grid gap-4 sm:grid-cols-2">
      <div className="influence-panel rounded-2xl p-6"><h2 className="text-lg font-semibold">Follow the mystery</h2><p className="mt-2 text-white/60">Only public conversation and outcomes. Roles are revealed at the end.</p></div>
      <div className="influence-panel rounded-2xl p-6"><h2 className="text-lg font-semibold">See the whole game</h2><p className="mt-2 text-white/60">Omniscient viewing reveals the roles, pack discussion, and resolved night choices.</p></div>
    </div>
    <section id="werewolf-games"><h2 className="mb-5 text-2xl font-semibold">Games to watch</h2>{games.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{games.map((game) => <Link href={`/werewolf/${game.slug}`} key={game.id} className="influence-panel rounded-xl p-5 transition-colors hover:border-amber-200/40"><p className="text-xs uppercase tracking-widest text-amber-100/65">{game.status.replaceAll("_", " ")} · {game.playerCount} players</p><h3 className="mt-3 break-words text-lg">{game.slug}</h3><p className="mt-4 text-sm text-white/50">Watch from the beginning →</p></Link>)}</div> : <p className="text-white/50">The village is quiet. No games yet.</p>}</section>
    <details id="werewolf-rules" className="mt-10 border-t border-white/10 pt-5 text-sm leading-7 text-white/60"><summary className="cursor-pointer text-white">How this Werewolf game works</summary><p className="mt-3">Everyone introduces themselves before the first night. Wolves have up to three attempts to agree unanimously on an attack. Each attempt gives both wolves a proposal, then a sealed vote. Disagreement reveals the votes to the pack and swaps who speaks first. Three disagreements mean no attack that night. A lone wolf chooses directly. The seer checks one player; the doctor, when present, protects one player and cannot repeat a target on consecutive nights. Both still act when the pack fails to agree.</p><p className="mt-3">Opening order is shuffled once, then rotates across days, skipping eliminated players. Every living player gets at most one opening per day. The opener chooses up to three recipients in order; the rest of the room follows in a fixed random order. Each person speaks or passes once, and the opener may answer each spoken reply. Every speaker hears earlier accepted replies. An opening pass skips that thread. After each thread, including a skipped opening, everyone chooses a target or asks to hear more.</p><p className="mt-3">Every living player, including wolves, submits a fresh sealed vote for one other player or abstains to hear more. Votes reveal together. More than half of all living players must choose the same target to eliminate them and end the day immediately. Abstentions count in that threshold. Without a majority, the next thread begins; after the last thread, everyone must choose a target. That final ballot eliminates the player with a unique highest vote count, even without a majority. A tie means no village elimination. Normal night actions follow. Dead players stop acting. The village wins when all wolves are gone; wolves win when they equal or outnumber the surviving villagers. All members of the winning faction win, including those who died. A game reaching its day limit is a draw.</p></details>
  </>;
}
