"use client";

import { useCallback, useEffect, useState } from "react";
import { backfillEpisodes, listAdminGames, type AdminGameSummary } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { EpisodeEditor } from "./episode-editor";
import { AdminPostgameMediaPanel } from "./admin-postgame-media";
import { AdminGameFilterBar, DEFAULT_ADMIN_GAME_FILTERS, filterAdminGames, type AdminGameFilters } from "./admin-game-filters";
import "../games/episodes.css";

type BatchReview = Awaited<ReturnType<typeof backfillEpisodes>>;

export function ProductionPanel() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("manage_postgame_media") || hasPermission("manage_roles");
  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [filters, setFilters] = useState<AdminGameFilters>(DEFAULT_ADMIN_GAME_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [regenerate, setRegenerate] = useState(false);
  const [review, setReview] = useState<BatchReview | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mediaGame, setMediaGame] = useState<AdminGameSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setGames(await listAdminGames()); setError(null); setReview(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const visible = filterAdminGames(games, filters);
  // The submitted set is always intersected with the current filters.
  const selectedVisible = visible.filter(g => selected.includes(g.id));
  const changeSelection = (ids: string[]) => { setSelected(ids); setReview(null); setMessage(null); };
  async function reviewBatch() {
    setPending(true); setError(null);
    try { setReview(await backfillEpisodes(selectedVisible.map(g => g.id), regenerate, true)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  }
  async function queueBatch() {
    if (!review) return;
    setPending(true); setError(null);
    try {
      const result = await backfillEpisodes(review.gameIds, regenerate, false);
      setMessage(`${result.calls} episodes queued. ${result.skipped} skipped because their state changed.`);
      setReview(null); setSelected([]); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  }
  return <section aria-label="Episode and video production">
    <div className="mb-6 flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">Episode & video production</h1><p className="mt-2 text-sm text-white/50">Titles, covers, preview order, trailers and posters. Select individual games before reviewing a batch.</p></div><button disabled={pending} onClick={() => void refresh()}>Refresh</button></div>
    {error && <p role="alert" className="my-4 text-red-300">{error}</p>}{message && <p role="status" className="my-4">{message}</p>}
    <fieldset disabled={pending}>
      <AdminGameFilterBar filters={filters} hiddenCount={games.filter(g => g.hidden).length} onChange={next => { setFilters(next); changeSelection([]); }} />
      {canManage && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-white/15 p-4">
        <span role="status">{visible.length} matching · {selectedVisible.length} selected</span>
        <button className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-35" disabled={!visible.length || visible.length > 50} onClick={() => changeSelection(visible.map(g => g.id))}>Select all {visible.length} matching</button>
        <button className="rounded border border-white/20 px-3 py-2 text-sm disabled:opacity-35" disabled={!selected.length} onClick={() => changeSelection([])}>Clear selection</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={regenerate} onChange={e => { setRegenerate(e.target.checked); setReview(null); }} /> Replace existing titles</label>
        <button className="influence-button-primary rounded px-3 py-2" disabled={!selectedVisible.length || selectedVisible.length > 50} onClick={() => void reviewBatch()}>Review {selectedVisible.length} selected</button>
        {visible.length > 50 && <p className="w-full text-sm text-white/50">Narrow the filters or select up to 50 games individually. Nothing is selected automatically.</p>}
      </div>}
      {review && <div className="mb-5 rounded-lg border border-indigo-400/50 p-5" aria-label="Review generation batch">
        <h2 className="font-semibold">{review.calls} House naming calls · {review.skipped} skipped</h2>
        <p className="my-2 text-sm text-white/60">Only these episodes will be submitted. This generates text; no images or videos.</p>
        <ul className="mb-4 space-y-1">{review.gameIds.map(id => { const game = games.find(g => g.id === id); return <li key={id}>{game?.episode?.title ?? game?.slug}<span className="ml-2 text-xs text-white/45">{game?.slug} · {id}</span></li>; })}</ul>
        <button className="influence-button-primary rounded px-3 py-2" disabled={!review.calls} onClick={() => void queueBatch()}>Queue {review.calls} episodes</button>
        <button className="ml-4" onClick={() => setReview(null)}>Cancel</button>
      </div>}
      {loading ? <p role="status">Loading production…</p> : <div className="space-y-2">{visible.map(game => <article key={game.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-white/10 p-4">
        {canManage && <input type="checkbox" aria-label={`Select ${game.slug}`} checked={selected.includes(game.id)} disabled={!selected.includes(game.id) && selected.length >= 50} onChange={e => changeSelection(e.target.checked ? [...selected, game.id] : selected.filter(id => id !== game.id))} />}
        <div className="min-w-0 flex-1"><h2 className="font-medium">{game.episode?.title ?? game.slug}</h2><p className="text-xs text-white/50">{game.slug} · {game.season?.name ?? "Custom"} · {game.status} · Naming: {game.episode?.status ?? "unrequested"}{game.episode?.locked ? " · Protected" : ""}</p></div>
        {canManage && <button className="influence-button-secondary rounded px-3 py-2 text-sm" onClick={() => setEditing(game.id)}>Edit episode</button>}
        {game.status === "completed" && <button className="influence-button-secondary rounded px-3 py-2 text-sm" onClick={() => setMediaGame(game)}>Trailer & poster</button>}
      </article>)}{!visible.length && <p>No games match these filters.</p>}</div>}
    </fieldset>
    {editing && <EpisodeEditor gameId={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    {mediaGame && <AdminPostgameMediaPanel game={mediaGame} canManage={canManage} onClose={() => setMediaGame(null)} />}
  </section>;
}
