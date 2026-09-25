"use client";
import { useEffect, useRef, useState } from "react";
import { backfillEpisodes, getAdminEpisode, requestAdminPostgameMedia, saveEpisode, type EpisodePresentation, type EpisodePreview } from "@/lib/api";

export function EpisodeEditor({ gameId, onClose, onSaved }: { gameId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<(EpisodePreview & { failure: string | null }) | null>(null);
  const [draft, setDraft] = useState<EpisodePresentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { const d = dialog.current!; const prior = document.activeElement as HTMLElement | null; d.showModal(); let alive = true; getAdminEpisode(gameId).then(v => { if (alive) { setData(v); setDraft(v.episode); } }).catch(e => { if (alive) setError(String(e)); }); return () => { alive = false; d.close(); prior?.focus(); }; }, [gameId]);
  async function run(action: () => Promise<unknown>, success: string) { setPending(true); setError(null); try { await action(); setMessage(success); await onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); } }
  return <dialog ref={dialog} className="episode-editor" aria-label="Edit episode presentation" onCancel={onClose}><div className="flex justify-between gap-4"><h2 className="text-xl font-semibold">Episode presentation</h2><button onClick={onClose}>Close</button></div>
    {!draft && !error && <p>Loading presentation…</p>}
    {draft && <><p className="mt-3 text-sm text-white/50">House naming: {draft.status}{data?.failure ? ` · ${data.failure}` : ""}</p>
      <label>Title<input maxLength={90} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Description<textarea rows={3} maxLength={280} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label>Cover<select value={draft.coverUrl ?? ""} onChange={e => setDraft({ ...draft, coverUrl: e.target.value || null })}><option value="">Automatic scene / cast artwork</option>{data?.frames.filter(f => f.imageUrl).map(f => <option key={f.id} value={f.imageUrl}>{f.label} · {f.id.slice(0, 8)}</option>)}{data?.media.status === "ready" && <option value={data.media.poster.url}>Trailer poster</option>}</select></label>
      <fieldset><legend className="text-sm">Preview sequence</legend>{data?.frames.map((frame, i) => <div key={frame.id} className="flex items-center justify-between gap-2 py-1 text-sm"><span>{frame.label}</span><button disabled={i === 0} aria-label={`Move ${frame.label} earlier`} onClick={() => { const frames = [...data.frames]; [frames[i - 1], frames[i]] = [frames[i]!, frames[i - 1]!]; setData({ ...data, frames }); setDraft({ ...draft, frameOrder: frames.map(f => f.id) }); }}>↑ Earlier</button></div>)}</fieldset>
      <label><input type="checkbox" checked={draft.locked} onChange={e => setDraft({ ...draft, locked: e.target.checked })} /> Protect these edits from House regeneration</label>
      <div className="editor-actions"><button disabled={pending} onClick={() => void run(async () => { await saveEpisode(gameId, { title: draft.title, description: draft.description, locked: draft.locked, revision: draft.revision, coverUrl: draft.coverUrl, frameOrder: draft.frameOrder }); const v = await getAdminEpisode(gameId); setData(v); setDraft(v.episode); }, "Presentation saved.")}>Save presentation</button>
      <button disabled={pending || data?.episode.locked} onClick={() => void run(async () => { const result = await backfillEpisodes([gameId], true, false); if (!result.calls) throw new Error("This presentation is protected. Save with protection off before regenerating."); }, "One House naming request queued. Refresh to see the result.")}>Regenerate title & description</button>
      <button disabled={pending} onClick={() => void run(async () => { const v = await getAdminEpisode(gameId); setData(v); setDraft(v.episode); }, "Presentation refreshed.")}>Refresh</button>
      <button disabled={pending} onClick={() => void run(() => requestAdminPostgameMedia(gameId, data?.media.status === "ready" ? "rerender" : "backfill", "Episode library presentation"), "Trailer and poster requested. Existing published media stays available while rendering.")}>{data?.media.status === "ready" ? "Redo trailer & poster" : "Backfill trailer & poster"}</button></div></>}
    {error && <p role="alert">{error}</p>}{message && <p role="status" className="mt-3">{message}</p>}
  </dialog>;
}
