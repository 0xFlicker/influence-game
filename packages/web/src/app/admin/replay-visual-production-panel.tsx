"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { SceneRepairPanel, isActiveMediaJob, type MediaRecords, type MediaAttempt } from "./games/[id]/visual/scene-repair-panel";

type Inventory = {
  gameId: string; slug: string; warnings: string[];
  scenes: Array<{ key: string; previewHash: string; sceneId: string | null; roomName: string; round: number | null;
    boundarySequence: number; participants: Array<{ id: string; name: string }>; available: boolean; originalFailed: boolean }>;
  media: MediaRecords;
  attempts: Array<MediaAttempt & { provider: string; model: string }>;
};
type MissingRequest = { key: string; previewHash: string; requestId: string };
const root = "/api/admin/production/games";
const button = "influence-button-secondary min-h-10 rounded-lg px-3 py-2 text-sm disabled:opacity-40";

export function ReplayVisualProductionPanel({ gameId, onLocked }: { gameId: string; onLocked: (value: boolean) => void }) {
  return <section aria-label="Replay image production" className="space-y-4 rounded-xl border border-amber-200/20 bg-amber-100/[.025] p-4 sm:p-6">
    <div><h3 className="text-xl font-semibold text-amber-100">Replay images</h3><p className="mt-2 text-sm text-white/60">Render one missing scene, then review and publish its verified image for this replay.</p></div>
    <ReplayScenes key={gameId} gameId={gameId} onLocked={onLocked} />
  </section>;
}

function ReplayScenes({ gameId, onLocked }: { gameId: string; onLocked: (value: boolean) => void }) {
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [showPublished, setShowPublished] = useState(false);
  const [image, setImage] = useState<{ url: string; label: string } | null>(null);
  const request = useRef<MissingRequest | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    try { const value = await apiFetch<Inventory>(`${root}/${gameId}/visual`); if (mounted.current) { setData(value); setError(null); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Scene progress could not refresh"); }
  }, [gameId]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  const activeJob = data?.media.jobs.find(isActiveMediaJob);
  const activeJobId = activeJob?.id;
  useEffect(() => {
    if (!activeJobId) return;
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [activeJobId, refresh]);
  async function renderScene(scene?: Inventory["scenes"][number]) {
    if (inFlight.current) return;
    const body = request.current ?? (scene ? { key: scene.key, previewHash: scene.previewHash, requestId: crypto.randomUUID() } : null);
    if (!body) return;
    request.current = body; inFlight.current = true; setBusy(true); setMutationError(null); setFeedback(null); onLocked(true);
    try {
      const receipt = await apiFetch<{ message: string }>(`${root}/${gameId}/visual/missing`, { method: "POST", body: JSON.stringify(body) });
      request.current = null; setUnknown(false); setFeedback(receipt.message); onLocked(false); await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) { request.current = null; setUnknown(false); onLocked(false); setMutationError(cause.message); await refresh(); }
      else { setUnknown(true); setMutationError("The response was lost. Check the same request before rendering another image."); }
    } finally { setBusy(false); inFlight.current = false; }
  }
  const visible = data?.scenes.filter(scene => showPublished || !scene.available) ?? [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-4"><button className={button} disabled={busy} onClick={() => void refresh()}>Refresh scenes</button><label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={showPublished} onChange={event => setShowPublished(event.target.checked)} />Show available images</label>
      {data && <span className="text-sm text-white/60">{data.scenes.filter(scene => !scene.available).length} scenes need images or publication</span>}</div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}{mutationError && <p role="alert" className="text-sm text-red-300">{mutationError}</p>}{feedback && <p role="status" className="text-sm text-green-200">{feedback}</p>}
    {unknown && <button className={button} disabled={busy} onClick={() => void renderScene()}>Check render request</button>}
    {activeJob && <p role="status" className="text-sm text-amber-200">One image is {activeJob.status}. Other renders are available when it finishes.</p>}
    {data?.warnings.map(warning => <p key={warning} className="text-sm text-amber-200">{warning}</p>)}
    {!data && !error && <p role="status">Reading recorded scenes…</p>}
    {data && !data.scenes.length && <p className="text-sm text-white/60">No room scenes can be reconstructed from this game’s committed records.</p>}
    {data && data.scenes.length > 0 && !visible.length && <p className="text-sm text-white/60">All recorded scenes have an available image.</p>}
    {visible.map(scene => <article key={scene.key} className="space-y-3 rounded-lg border border-white/15 bg-black/20 p-4">
      <div><h3 className="font-semibold">{scene.roomName}{scene.round !== null ? ` · Round ${scene.round}` : ""}</h3><p className="mt-1 text-sm text-white/60">{scene.participants.map(member => member.name).join(" · ")}</p><p className="mt-1 text-xs text-white/40">Recorded scene {scene.boundarySequence}{scene.available ? " · Available to viewers" : ""}</p></div>
      {!scene.sceneId ? <button className={button} disabled={busy || unknown || controlPending || Boolean(activeJob)} onClick={() => void renderScene(scene)}>Render missing image</button>
        : <SceneRepairPanel gameId={gameId} sceneId={scene.sceneId} originalFailed={scene.originalFailed} media={data!.media} attempts={data!.attempts}
          canOperate={!busy && !unknown} apiPrefix={root} renderLabel="Render missing image" renderDisabled={controlPending || Boolean(activeJob)} refresh={refresh} refreshError={error}
          onRequestPending={value => { setControlPending(value); onLocked(value); }}
          onOpen={(url, label) => setImage({ url, label })} />}
    </article>)}
    {data && <section id="provider-attempts" className="space-y-3 border-t border-white/15 pt-4">
      <h3 className="font-semibold">Provider receipts</h3>
      <p className="text-sm text-white/60">${(data.attempts.reduce((sum, attempt) => sum + (attempt.costMicrousd ?? 0), 0) / 1_000_000).toFixed(4)} known · {data.attempts.filter(attempt => attempt.costMicrousd === null).length} unpriced attempts</p>
      {data.attempts.map(attempt => <details key={attempt.id} className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer break-words text-sm">{attempt.provider} · {attempt.model} · {attempt.costMicrousd === null ? "Cost unknown" : `$${(attempt.costMicrousd / 1_000_000).toFixed(4)}`} · {attempt.id}</summary>
        <p className="mt-3 text-sm text-white/70">{attempt.status === "pending" ? "Request in progress; waiting for the provider receipt." : `HTTP ${attempt.receipt?.status ?? "unknown"} · ${attempt.status.replaceAll("_", " ")}`}</p>
        {attempt.receipt?.failure && <p className="mt-2 text-sm text-amber-200">{attempt.receipt.failure.kind}: {attempt.receipt.failure.message}</p>}
        <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(attempt, null, 2)}</pre>
        {attempt.status === "needs_reconciliation" && <ReconcileAttempt gameId={gameId} attemptId={attempt.id} refresh={refresh} />}
      </details>)}
    </section>}
    {image && <ImagePreview image={image} onClose={() => setImage(null)} />}
  </div>;
}

function ReconcileAttempt({ gameId, attemptId, refresh }: { gameId: string; attemptId: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <form className="mt-3 flex flex-wrap gap-3" onSubmit={async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await apiFetch(`${root}/${gameId}/visual/attempts/${attemptId}/reconcile`, { method: "POST", body: JSON.stringify({ note: String(form.get("note")), costMicrousd: Math.round(Number(form.get("cost")) * 1_000_000) }) });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reconciliation failed"); }
    finally { setBusy(false); }
  }}>
    <input name="note" aria-label="Reconciliation evidence" required maxLength={2000} placeholder="Provider receipt or billing evidence" className="min-w-48 flex-1 rounded bg-white/10 px-3 py-2" />
    <input name="cost" aria-label="Confirmed cost in dollars" required type="number" min="0" step="0.000001" placeholder="USD" className="w-32 rounded bg-white/10 px-3 py-2" />
    <button disabled={busy} className={button}>Record reconciliation</button>{error && <p role="alert" className="w-full text-sm text-red-300">{error}</p>}
  </form>;
}

function ImagePreview({ image, onClose }: { image: { url: string; label: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label={image.label} onCancel={onClose} className="fixed inset-0 max-h-[95vh] max-w-[95vw] rounded-lg border border-white/20 bg-neutral-950 p-4 text-white backdrop:bg-black/90">
    <button className={`${button} mb-4`} onClick={onClose}>Close image</button>
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated immutable image */}
    <img src={image.url} alt={image.label} className="max-h-[80vh] max-w-full object-contain" />
  </dialog>;
}
