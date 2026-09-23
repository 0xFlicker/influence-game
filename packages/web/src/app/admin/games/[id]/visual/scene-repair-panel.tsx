"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";

export interface MediaJob {
  id: string; sceneId: string; version: number; status: string; step: string; failure: string | null;
  candidateArtifactId: string | null; sourceImageId: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
interface MediaVersion {
  id: string; sceneId: string; version: number; imageArtifactId: string; annotatedArtifactId: string;
  verificationVersion: string; localization: { count: number; verifiedParticipantIds?: string[]; anchors: unknown[] };
}
export interface MediaRecords {
  jobs: MediaJob[]; versions: MediaVersion[];
  publications: Array<{ id: string; sceneId: string; versionId: string; revision: number; createdAt: string; operatorId: string }>;
  requests: Array<{ id: string; input: Record<string, unknown>; receipt: Receipt }>;
}
interface Receipt { accepted: boolean; code: string; message: string; jobId?: string; versionId?: string; version?: number }
const button = "rounded border border-white/25 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";
export const isActiveMediaJob = (job: MediaJob) => ["queued", "rendering", "verifying"].includes(job.status);

function VersionImage({ gameId, artifactId, label, onOpen }: { gameId: string; artifactId: string; label: string; onOpen: (url: string, label: string) => void }) {
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ imageUrl: string }>(`/api/admin/games/${gameId}/visual/evidence/artifact/${artifactId}`).then(data => {
      if (!cancelled) setResult({ url: data.imageUrl });
    }).catch(error => { if (!cancelled) setResult({ error: error instanceof Error ? error.message : "Image unavailable" }); });
    return () => { cancelled = true; };
  }, [gameId, artifactId]);
  return <div><p className="mb-2 text-xs text-white/60">{label}</p>{result.url ? <button type="button" className="w-full cursor-zoom-in" onClick={() => onOpen(result.url!, label)} aria-label={`Enlarge ${label}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated immutable media evidence */}
    <img alt={label} src={result.url} className="aspect-video w-full rounded object-contain" />
  </button> : <p role={result.error ? "alert" : "status"}>{result.error ?? "Loading image…"}</p>}</div>;
}

export function SceneRepairPanel({ gameId, sceneId, originalFailed, media, canOperate, refresh, refreshError, onOpen, attempts }: {
  gameId: string; sceneId: string; originalFailed: boolean; media: MediaRecords; canOperate: boolean;
  refresh: () => Promise<void>; refreshError: string | null; onOpen: (url: string, label: string) => void;
  attempts: Array<{ id: string; operationKey: string; costMicrousd: number | null; receipt?: { chargeUncertain: boolean } | null; reconciliation?: unknown }>;
}) {
  const jobs = media.jobs.filter(job => job.sceneId === sceneId);
  const latest = jobs[0];
  const active = jobs.find(isActiveMediaJob);
  const versions = media.versions.filter(version => version.sceneId === sceneId);
  const publications = media.publications.filter(publication => publication.sceneId === sceneId);
  const published = versions.find(version => version.id === publications[0]?.versionId) ?? versions.find(version => version.version === 0);
  const [selection, setSelection] = useState<string | null>(null);
  const selected = versions.find(version => version.id === selection) ?? versions[0];
  const [review, setReview] = useState(false);
  const [annotated, setAnnotated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Receipt | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const inFlight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setTime(Date.now()), 1000); return () => clearInterval(timer); }, [active?.id, active]);
  const send = async (action: Record<string, unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setUncertain(false);
    const body = pending.current ?? { ...action, sceneId, expectedVersion: latest?.version ?? 0, requestId: crypto.randomUUID() };
    pending.current = body;
    try {
      const receipt = await apiFetch<Receipt>(`/api/admin/games/${gameId}/visual/media`, { method: "POST", body: JSON.stringify(body) });
      pending.current = null; setFeedback(receipt); await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        pending.current = null;
        setFeedback({ accepted: false, code: error.code ?? "rejected", message: error.message }); await refresh();
      } else {
        setUncertain(true); setFeedback({ accepted: false, code: "response_unknown", message: "The request response was lost. Check this same request before starting another repair." });
      }
    } finally { setBusy(false); inFlight.current = false; }
  };
  const lastReceipt = feedback ?? media.requests.find(request => request.input.sceneId === sceneId)?.receipt;
  const jobAttempts = latest ? attempts.filter(attempt => attempt.operationKey.startsWith(`media:${latest.id}:`)) : [];
  const unresolved = attempts.filter(attempt => (attempt.operationKey.startsWith(`${sceneId}:render:`) || jobs.some(job => attempt.operationKey.startsWith(`media:${job.id}:`))) && !attempt.reconciliation && (!attempt.receipt || attempt.receipt.chargeUncertain));
  return <section aria-label="Scene repair" className="space-y-3 border-t border-white/15 pt-3">
    <p className="text-xs text-white/60">Viewer version: {published ? `v${published.version}` : "Portraits"} · Publication {publications[0]?.revision ?? 0}</p>
    {canOperate && <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !!active || uncertain} onClick={() => void send({ action: "regenerate" })}>Regenerate scene</button>
      {(latest && ["failed", "needs_reconciliation"].includes(latest.status) || !latest && originalFailed) && <button className={button} disabled={busy || !!active || uncertain} onClick={() => void send({ action: "continue", ...(latest && { sourceJobId: latest.id }) })}>Continue failed repair</button>}
      {uncertain && <button className={button} disabled={busy} onClick={() => void send({})}>Check request</button>}
    </div>}
    <p className="text-xs text-white/50">Repairs may incur provider charges. Candidates need review and publication; gameplay is unchanged.</p>
    {unresolved.length > 0 && <div role="status" className="rounded bg-amber-400/10 p-3 text-sm text-amber-200">
      <p>Needs reconciliation: {unresolved.length} provider request(s) have an uncertain outcome.</p>
      {unresolved.map(attempt => <p key={attempt.id} className="break-all text-xs">{attempt.operationKey.split(":").at(-1)} · Attempt {attempt.id}</p>)}
      <a href="#provider-attempts" className="underline">Review receipts before another paid request</a>
    </div>}
    {lastReceipt && <p role={lastReceipt.accepted ? "status" : "alert"} className={`break-words text-sm ${lastReceipt.accepted ? "text-green-200" : "text-amber-200"}`}>{lastReceipt.message}{lastReceipt.jobId && <span className="block text-xs">Job {lastReceipt.jobId}</span>}</p>}
    {latest && <div className="rounded bg-white/5 p-3 text-sm" aria-live="polite">
      <p>{latest.status === "ready" ? "Ready for review" : latest.status.replaceAll("_", " ")} · v{latest.version} · {latest.step}</p>
      <p className="break-all text-xs text-white/50">Job {latest.id}</p>
      <p className="text-xs text-white/60">{Math.max(0, Math.floor(((latest.finishedAt ? Date.parse(latest.finishedAt) : time || Date.now()) - Date.parse(latest.startedAt ?? latest.createdAt)) / 1000))}s elapsed · ${(jobAttempts.reduce((sum, a) => sum + (a.costMicrousd ?? 0), 0) / 1_000_000).toFixed(4)} known · {jobAttempts.filter(a => a.costMicrousd === null).length} unpriced</p>
      {latest.failure && <p className="mt-2 text-amber-200">{latest.failure}</p>}
      {latest.status === "needs_reconciliation" && <a href="#provider-attempts" className="underline">Review provider receipts and record reconciliation below</a>}
    </div>}
    {refreshError && <p role="alert" className="text-sm text-amber-200">Progress refresh failed. Showing the last saved state. <button className="underline" onClick={() => void refresh()}>Retry refresh</button></p>}
    {(versions.length > 0 || jobs.length > 0) && <button className={button} onClick={() => setReview(!review)}>{review ? "Close versions" : "Versions and review"}</button>}
    {review && <div className="space-y-3">
      {selected && <>
        <label className="block text-sm">Candidate <select aria-label="Candidate version" className="ml-2 rounded bg-neutral-900 p-2" value={selected.id} onChange={event => setSelection(event.target.value)}>{versions.map(version => <option value={version.id} key={version.id}>v{version.version}{version.version === 0 ? " · Original gameplay image" : " · Verified"}</option>)}</select></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={annotated} onChange={event => setAnnotated(event.target.checked)} />Numbered annotations</label>
        <div className="grid gap-3 sm:grid-cols-2">
          {published ? <VersionImage key={published.imageArtifactId} gameId={gameId} artifactId={published.imageArtifactId} label={`Published v${published.version}`} onOpen={onOpen} /> : <p>Viewers currently see portraits.</p>}
          <VersionImage key={`${selected.id}:${annotated}`} gameId={gameId} artifactId={annotated ? selected.annotatedArtifactId : selected.imageArtifactId} label={`Candidate v${selected.version}${annotated ? " annotations" : ""}`} onOpen={onOpen} />
        </div>
        <p className="text-sm">{selected.localization.count} verified people · {selected.localization.anchors.length} head anchors</p>
        {!selected.localization.anchors.length && selected.localization.count > 0 && <p className="text-sm text-amber-200">Head positions are uncertain. Viewers use named portrait speech panels.</p>}
        <details><summary className="text-sm">Identity and head findings</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ verifier: selected.verificationVersion, ...selected.localization }, null, 2)}</pre></details>
        {canOperate && <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !!active || uncertain} onClick={() => void send({ action: "verify", sourceVersionId: selected.id })}>Recheck image</button>
          <button className={button} disabled={busy || uncertain || selected.id === published?.id} onClick={() => void send({ action: "publish", versionId: selected.id, expectedPublication: publications[0]?.revision ?? 0 })}>{publications.some(p => p.versionId === selected.id) || selected.version === 0 ? "Restore for viewers" : "Publish for viewers"}</button>
        </div>}
      </>}
      {jobs.map(job => <details key={job.id}><summary className="cursor-pointer text-sm">v{job.version} · {job.status.replaceAll("_", " ")}</summary>
        <p className="break-all text-xs">{job.id} · {job.step}</p>{job.failure && <p className="text-sm text-amber-200">{job.failure}</p>}
        <ul className="text-xs text-white/60">{attempts.filter(attempt => attempt.operationKey.startsWith(`media:${job.id}:`)).map(attempt => <li key={attempt.id} className="break-all">{attempt.operationKey.slice(`media:${job.id}:`.length)} · {attempt.costMicrousd === null ? "Cost unknown" : `$${(attempt.costMicrousd / 1_000_000).toFixed(4)}`} · <a href="#provider-attempts" className="underline">Receipt {attempt.id}</a></li>)}</ul>
        {job.candidateArtifactId && !versions.some(v => v.id === job.id) && <><VersionImage gameId={gameId} artifactId={job.candidateArtifactId} label={`Unverified v${job.version}`} onOpen={onOpen} />{canOperate && <button className={button} disabled={busy || !!active || uncertain} onClick={() => void send({ action: "verify", sourceVersionId: job.id })}>Recheck image</button>}</>}
      </details>)}
      <details><summary className="text-sm">Publication history</summary><ul className="space-y-2 text-xs">{publications.map(p => <li key={p.id}>Publication {p.revision} · {p.createdAt} · {p.operatorId} · {p.versionId}</li>)}</ul></details>
    </div>}
  </section>;
}
