"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { WerewolfThinking as Thinking } from "@influence/engine/werewolf/thinking";

/** Mounted only by the Omniscient toggle; keyed reads prevent stale cursor paint. */
export function WerewolfThinking({ gameId, cursor, players }: { gameId: string; cursor: number; players: Array<{ id: string; name: string }> }) {
  const key = `${gameId}:${cursor}`;
  const [read, setRead] = useState<{ key: string; data?: Thinking; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Thinking>(`/api/werewolf/${encodeURIComponent(gameId)}/thinking?audience=omniscient&cursor=${cursor}`, { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) setRead({ key, data }); })
      .catch(error => { if (!controller.signal.aborted) setRead({ key, error: error instanceof Error ? error.message : "Could not load thinking" }); });
    return () => controller.abort();
  }, [gameId, cursor, key]);
  const current = read?.key === key ? read : null;
  const entries = current?.data?.entries;
  return <section aria-label="Player thinking" className="my-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
    <h2 className="font-semibold">Thinking</h2>
    <p className="mb-4 text-sm text-white/50">Private player thinking up to this moment. Sealed choices appear after resolution.</p>
    {!current && <p role="status">Loading thinking…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {entries?.length === 0 && <p>No thinking was captured for the turns available at this moment.</p>}
    <ol className="space-y-4">{entries?.map((entry, index) => <li key={index}>
      <p className="text-sm text-white/60">{players.find(p => p.id === entry.actorId)?.name ?? "Player"} · Day {entry.day} · {entry.action.replaceAll("_", " ")}</p>
      <p className="whitespace-pre-wrap">{entry.thinking}</p>
    </li>)}</ol>
  </section>;
}
