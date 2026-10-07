"use client";
import { usePermissions } from "@/hooks/use-permissions";
import { VisualFailurePolicyControl } from "./visual-failure-policy-control";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminRead, useAdminSession, useAdminValue, useAdminPending, type Operation } from "./admin-session";
import { WerewolfScenePreview } from "./werewolf/scene-preview";

import { useCallback, useEffect, useRef, useState } from "react";
import { SceneRepairPanel, isActiveMediaJob, type MediaRecords, type MediaAttempt } from "./games/[id]/visual/scene-repair-panel";


export type Inventory = {
  gameId: string; slug: string; warnings: string[];
  recovery?: {pauseId:string; reason:string; kind:"scene" | "form"; playerName?:string; policy:"best_effort" | "require_visuals"} | null;
  scenes: Array<{ key: string; previewHash: string; sceneId: string | null; roomName: string; round: number | null;
    purpose?: "village" | "pack" | "hunt"; wolfIds?: string[]; boundarySequence: number; participants: Array<{ id: string; name: string }>; available: boolean; originalFailed: boolean; coverage?: Array<{ id: string; name: string; verified: boolean; fallback: string }>; panelCount?: number }>;
  media: MediaRecords;
  attempts: Array<MediaAttempt & { provider: string; model: string }>;
};
const root = "/api/admin/production/games";
const button = "influence-button-secondary min-h-10 rounded-lg px-3 py-2 text-sm disabled:opacity-40";

export function ReplayVisualProductionPanel({ gameId, onLocked, werewolf = false }: { gameId: string; onLocked: (value: boolean) => void; werewolf?: boolean }) {
  return <section aria-label="Replay image production" className="space-y-4 rounded-xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
    <div><h3 className="text-xl font-semibold text-white">Replay images</h3><p className="mt-2 text-sm text-white/60">Render one missing scene, then review and publish its verified image for this replay.</p></div>
    <ReplayScenes key={gameId} gameId={gameId} onLocked={onLocked} werewolf={werewolf} />
  </section>;
}

function ReplayScenes({ gameId, onLocked, werewolf = false }: { gameId: string; onLocked: (value: boolean) => void; werewolf?: boolean }) {
  const session = useAdminSession(), client = useQueryClient();
  const resource = `${root}/${gameId}/visual`, operationKey = `operation:${resource}/missing`;
  const { data, error, denied, refresh: refetch } = useAdminRead<Inventory>(resource);
  const [operation] = useAdminValue<Operation | undefined>(operationKey, undefined);
  const acceptedJob = operation?.phase === "accepted" ? (operation.result as { jobId?: string } | undefined)?.jobId : undefined;
  const waitingForJob = Boolean(acceptedJob && !data?.media.jobs.some(job => job.id === acceptedJob));
  const busy = operation?.phase === "submitting" || waitingForJob, unknown = operation?.phase === "unknown";
  const controlPending = useAdminPending(`operation:${resource}/media`);
  const recoveryPending = useAdminPending(`operation:${resource}/recovery`);
  const mutationError = operation?.phase === "rejected" || unknown ? operation.error : null;
  const feedback = operation?.phase === "accepted" ? (operation.result as { message?: string } | undefined)?.message : null;
  const [showPublished, setShowPublished] = useAdminValue(`ui:${resource}:showPublished`, werewolf);
  const [previewScene, setPreviewScene] = useAdminValue<string | null>(`ui:${resource}:preview`, null);
  const [image, setImage] = useState<{ url: string; label: string } | null>(null);
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  useEffect(() => { onLocked(busy || unknown || controlPending || recoveryPending); }, [onLocked, busy, unknown, controlPending, recoveryPending]);
  useEffect(() => {
    if (!denied) return;
    session.clearMatching(key => (key.startsWith("operation:") || key.startsWith("draft:") || key.startsWith("ui:")) && key.includes(`${root}/${gameId}/`));
    void client.invalidateQueries({ queryKey: ["admin", session.scope, `/api/admin/werewolf/${gameId}`] });
  }, [denied, session, client, gameId]);
  const activeJob = data?.media.jobs.find(isActiveMediaJob);
  const activeJobId = activeJob?.id;
  useEffect(() => {
    if (!activeJobId) return;
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [activeJobId, refresh]);
  async function renderScene(scene?: Inventory["scenes"][number]) {
    const body = operation?.phase === "unknown" ? operation.body : scene ? { key: scene.key, previewHash: scene.previewHash, requestId: crypto.randomUUID() } : null;
    if (!body) return;
    try {
      await session.execute(operationKey, `${resource}/missing`, body);
      await client.invalidateQueries({ queryKey: ["admin", session.scope, `/api/admin/werewolf/${gameId}/costs`] });
      await refresh();
    } catch { /* The session operation retains the typed rejection or unknown response for recovery. */ }
  }
  if (denied) return <p role="alert">Production access is no longer available. {error} <button className={button} onClick={() => void refresh()}>Check access again</button></p>;
  const visible = data?.scenes.filter(scene => showPublished || !scene.available) ?? [];
  return <div className="space-y-4">
    {data?.recovery && <VisualRecovery gameId={gameId} data={data} refresh={refresh} />}
    <div className="flex flex-wrap items-center gap-4"><button className={button} disabled={operation?.phase === "submitting"} onClick={() => void refresh()}>Refresh scenes</button><label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={showPublished} onChange={event => setShowPublished(event.target.checked)} />Show available images</label>
      {data && <span className="text-sm text-white/60">{data.scenes.filter(scene => !scene.available).length} scenes need images or publication</span>}</div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}{mutationError && <p role="alert" className="text-sm text-red-300">{mutationError}</p>}{feedback && <p role="status" className="text-sm text-green-200">{feedback}</p>}
    {unknown && <button className={button} disabled={busy} onClick={() => void renderScene()}>Check render request</button>}
    {activeJob && <p role="status" className="text-sm text-amber-200">One image is {activeJob.status}. Other renders are available when it finishes.</p>}
    {data?.warnings.map(warning => <p key={warning} className="text-sm text-amber-200">{warning}</p>)}
    {!data && !error && <p role="status">Reading recorded scenes…</p>}
    {data && !data.scenes.length && <p className="text-sm text-white/60">No room scenes can be reconstructed from this game’s committed records.</p>}
    {data && data.scenes.length > 0 && !visible.length && <p className="text-sm text-white/60">All recorded scenes have an available image.</p>}
    {visible.map(scene => <article key={scene.key} className="space-y-3 rounded-lg border border-white/15 bg-black/20 p-4">
      <div><h3 className="font-semibold">{scene.roomName}{werewolf && scene.round === 0 ? " · Introductions" : scene.round !== null ? ` · ${werewolf ? "Day" : "Round"} ${scene.round}` : ""}</h3><p className="mt-1 text-sm text-white/60">{scene.participants.map(member => member.name).join(" · ")}</p><p className="mt-1 text-xs text-white/40">Recorded scene {scene.boundarySequence}{scene.available ? " · Available to viewers" : ""}</p></div>
      {scene.coverage && <ul className="grid gap-2 text-sm sm:grid-cols-2" aria-label="Character coverage">{scene.coverage.map(person => <li key={person.id}>{person.name}: {person.verified ? "Verified panel" : person.fallback === "missing" ? "Reference unavailable" : `${person.fallback.replaceAll("_", " ")} fallback`}</li>)}</ul>}
      {werewolf && scene.sceneId && <div><button type="button" className="cursor-pointer py-3" aria-expanded={previewScene === scene.sceneId} onClick={() => setPreviewScene(current => current === scene.sceneId ? null : scene.sceneId)}>Preview character framing · {scene.panelCount ?? 0} panels</button>{previewScene === scene.sceneId && <WerewolfScenePreview key={`${scene.sceneId}:${data?.media.versions.length}`} gameId={gameId} sceneId={scene.sceneId} />}</div>}
      {!scene.sceneId ? <button className={button} disabled={busy || unknown || controlPending || Boolean(activeJob)} onClick={() => void renderScene(scene)}>Render missing image</button>
        : <SceneRepairPanel wolfForms={Boolean(scene.wolfIds?.length)} gameId={gameId} sceneId={scene.sceneId} publicationAudience="viewers" requirePublication={werewolf} originalFailed={scene.originalFailed} media={data!.media} attempts={data!.attempts}
          canOperate={!busy && !unknown} apiPrefix={root} renderLabel={data!.media.versions.some(version => version.sceneId === scene.sceneId) ? "Regenerate scene" : "Render missing image"} renderDisabled={controlPending || Boolean(activeJob)} refresh={refresh} refreshError={error}
          onOpen={(url, label) => setImage({ url, label })} />}
    </article>)}
    {data && <section id="provider-attempts" className="space-y-3 border-t border-white/15 pt-4">
      <h3 className="font-semibold">Provider receipts</h3>
      <p className="text-sm text-white/60">{data.attempts.some(attempt => attempt.costMicrousd !== null) ? `$${(data.attempts.reduce((sum, attempt) => sum + (attempt.costMicrousd ?? 0), 0) / 1_000_000).toFixed(4)} known` : "No priced attempts"} · {data.attempts.filter(attempt => attempt.costMicrousd === null).length} unpriced attempts</p>
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

function VisualRecovery({ gameId, data, refresh }: {gameId:string; data:Inventory; refresh:()=>Promise<void>}) {
  const session = useAdminSession(), client = useQueryClient();
  const {hasPermission} = usePermissions();
  const resource = `${root}/${gameId}/visual`, key = `operation:${resource}/recovery`;
  const [operation] = useAdminValue<Operation | undefined>(key,undefined);
  const recovery = data.recovery!;
  const uncertainForm = data.attempts.some(attempt => attempt.operationKey.startsWith("wolf-form:") && ["pending", "needs_reconciliation"].includes(attempt.status));
  const formJob = data.media.jobs.filter(job => job.sceneId === null && job.reusePrefix === recovery.pauseId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  const busy = operation?.phase === "submitting" || data.media.jobs.some(isActiveMediaJob);
  const unknown = operation?.phase === "unknown";
  async function act(action: "policy" | "resume" | "forms", policy?: "best_effort" | "require_visuals") {
    const body = unknown ? operation.body : action === "forms" ? {pauseId:recovery.pauseId,requestId:crypto.randomUUID()} : action === "policy" ? {action,policy} : {action};
    try {
      await session.execute(key,`${resource}/${action === "forms" ? "forms" : "control"}`,body);
      await client.invalidateQueries({queryKey:["admin",session.scope,`/api/admin/werewolf/${gameId}`]});
      if (action !== "resume") await refresh();
    } catch { /* Admin session retains rejection and uncertain request state. */ }
  }
  return <section aria-label="Visual recovery" className="space-y-3 rounded-lg border border-amber-300/40 p-4">
    <h3 className="font-semibold">Paused for visuals</h3><p className="text-sm text-amber-100">{recovery.reason}</p>
    <VisualFailurePolicyControl value={recovery.policy} disabled={busy || unknown || !hasPermission("start_game")} onChange={policy => void act("policy",policy)} />
    {recovery.kind === "form" ? <><p>Wolf form for {recovery.playerName}</p>
      {formJob && <p role="status">{formJob.step} · {formJob.status}{formJob.failure ? `: ${formJob.failure}` : ""}</p>}
      <button className={button} disabled={busy || unknown || formJob?.status === "ready" || uncertainForm} onClick={()=>void act("forms")}>Repair wolf form</button>
      <p className="text-sm text-white/60">This creates a verified reusable form. Provider charges may apply.</p></> : <p className="text-sm text-white/60">Repair and publish the scene below, then resume. To continue with portraits, choose Best effort and resume.</p>}
    {hasPermission("start_game") && <button className={button} disabled={busy || unknown} onClick={()=>void act("resume")}>Resume game</button>}
    {operation?.error && <p role="alert" className="text-red-300">{operation.error}</p>}
    {unknown && <button className={button} onClick={()=>void act("pauseId" in operation.body ? "forms" : operation.body.action === "resume" ? "resume" : "policy")}>Check saved request</button>}
  </section>;
}

function ReconcileAttempt({ gameId, attemptId, refresh }: { gameId: string; attemptId: string; refresh: () => Promise<void> }) {
  const session = useAdminSession(), client = useQueryClient();
  const resource = `${root}/${gameId}/visual`, key = `operation:${resource}/reconcile:${attemptId}`;
  const [operation] = useAdminValue<Operation | undefined>(key, undefined);
  const [note, setNote] = useAdminValue(`draft:${resource}/reconcile:${attemptId}:note`, "");
  const [cost, setCost] = useAdminValue(`draft:${resource}/reconcile:${attemptId}:cost`, "");
  const [readError, setReadError] = useState<string | null>(null);
  const busy = operation?.phase === "submitting", unknown = operation?.phase === "unknown";
  const checking = useRef(false);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  async function checkReceipt() {
    if (checking.current || operation?.phase !== "unknown" || session.get(key) !== operation) return;
    const checked = operation;
    checking.current = true; setCheckingReceipt(true);
    try {
      const saved = await session.read<Inventory>(resource);
      if (!session.active || session.get(key) !== checked) return;
      const attempt = saved.attempts.find(candidate => candidate.id === attemptId);
      if (attempt?.status === "reconciled") { session.delete(key); await refresh(); }
      else if (attempt?.status === "needs_reconciliation" && operation) {
        session.set<Operation>(key, { ...operation, phase: "rejected", error: "No reconciliation is recorded. Review the evidence before submitting again." });
        setReadError(null);
      }
      else setReadError("The receipt is not confirmed yet. Refresh and check again before submitting another reconciliation.");
    } catch (cause) {
      if (session.active && session.get(key) === checked) setReadError(cause instanceof Error ? cause.message : "Could not check receipt");
    } finally { checking.current = false; setCheckingReceipt(false); }
  }
  return <form className="mt-3 flex flex-wrap gap-3" onSubmit={async event => {
    event.preventDefault();
    try {
      await session.execute(key, `${resource}/attempts/${attemptId}/reconcile`, { note, costMicrousd: Math.round(Number(cost) * 1_000_000) }, false);
      await client.invalidateQueries({ queryKey: ["admin", session.scope, `/api/admin/werewolf/${gameId}/costs`] });
      await refresh();
    } catch { /* Recorded operation state distinguishes uncertain writes from refresh errors. */ }
  }}>
    <input aria-label="Reconciliation evidence" value={note} onInput={event => setNote(event.currentTarget.value)} required maxLength={2000} placeholder="Provider receipt or billing evidence" className="min-w-48 flex-1 rounded bg-white/10 px-3 py-2" />
    <input aria-label="Confirmed cost in dollars" value={cost} onInput={event => setCost(event.currentTarget.value)} required type="number" min="0" step="0.000001" placeholder="USD" className="w-32 rounded bg-white/10 px-3 py-2" />
    <button disabled={busy || unknown} className={button}>Record reconciliation</button>
    {unknown && <button type="button" className={button} disabled={checkingReceipt} onClick={() => void checkReceipt()}>Check reconciliation receipt</button>}
    {(operation?.error || readError) && <p role="alert" className="w-full text-red-300">{readError ?? operation?.error}</p>}
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
