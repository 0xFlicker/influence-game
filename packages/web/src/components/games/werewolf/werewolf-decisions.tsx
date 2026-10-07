"use client";
import { useEffect, useState } from "react";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { WerewolfDecisions as Decisions, WerewolfDecisionEntry } from "@influence/engine/werewolf/decisions";
import { werewolfMomentHref } from "@influence/engine/game-links";
import { apiFetch } from "@/lib/api";

export function WerewolfDecisions({ gameId, slug, audience, cursor, players, actorId, onSeek }: {
  gameId: string; slug: string; audience: WerewolfAudience; cursor: number;
  players: Array<{ id: string; name: string }>; actorId: string; onSeek: (cursor: number) => void;
}) {
  const key = `${gameId}:${audience}:${cursor}:${actorId}`;
  const [read, setRead] = useState<{ key: string; data?: Decisions; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Decisions>(`/api/werewolf/${encodeURIComponent(gameId)}/decisions?audience=${audience}&cursor=${cursor}&actorId=${encodeURIComponent(actorId)}`, { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) setRead({ key, data }); })
      .catch(error => { if (!controller.signal.aborted) setRead({ key, error: error instanceof Error ? error.message : "Could not load decisions" }); });
    return () => controller.abort();
  }, [gameId, audience, cursor, actorId, key, retry]);
  const current = read?.key === key ? read : null;
  const entries = current?.data?.entries.filter(entry => entry.cursor <= cursor && entry.actorId === actorId && (audience === "omniscient" || entry.action === "vote"));
  const target = (entry: WerewolfDecisionEntry) => players.find(player => player.id === entry.targetId)?.name ?? "Player";
  const choice = (entry: WerewolfDecisionEntry) => {
    if (!entry.targetId) return entry.unavailable ? "Choice unavailable" : entry.action === "vote" ? "Hear more" : "No target selected";
    const verb = { vote: "Voted for", attack: "Targeted", protect: "Protected", investigate: "Investigated" }[entry.action];
    return `${verb} ${target(entry)}`;
  };
  return <section aria-label="Player decisions" className="rounded-md border border-white/10 bg-white/[0.02] p-3">
    <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">Decisions</h3>
    {!current && <p role="status" className="text-xs text-white/50">Loading decisions…</p>}
    {current?.error && <p role="alert" className="text-xs text-amber-100">{current.error} <button onClick={() => { setRead(null); setRetry(value => value + 1); }} className="underline">Retry</button></p>}
    {entries?.length === 0 && <p className="py-3 text-xs text-white/50">No decisions yet.</p>}
    <ol className="space-y-4">{entries?.toReversed().map(entry => <li key={`${key}:${entry.cursor}:${entry.action}`} className="border-t border-white/10 pt-3 first:border-0 first:pt-0">
      <a href={werewolfMomentHref(slug, audience, entry.cursor)} onClick={event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSeek(entry.cursor); }
      }} className="text-[10px] text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white">{entry.context}</a>
      <p className="mt-2 text-sm font-medium text-white/90">{choice(entry)}</p>
      {entry.unavailable && entry.targetId && <p className="text-xs text-amber-100/70">Fallback choice</p>}
      <p className="mt-1 text-xs leading-5 text-white/55">{entry.result}</p>
      {audience === "omniscient" && entry.thinking && <details className="mt-2 text-xs leading-5 text-white/70">
        <summary className="cursor-pointer text-white/50 hover:text-white">Thinking</summary>
        <p className="mt-2 whitespace-pre-wrap">{entry.thinking}</p>
      </details>}
    </li>)}</ol>
  </section>;
}
