"use client";
import { useAdminSession, useAdminValue, type Operation } from "../../../admin-session";
import { useQueryClient } from "@tanstack/react-query";
import type { StoredVisualShot, VisualShotPresentation } from "@influence/engine/visual-mode";
import { useEffect, useState } from "react";
import { ImageReviewEditor } from "./image-review-editor";

export interface MediaJob {
  id: string; sceneId: string | null; reusePrefix?: string | null; version: number; status: string; step: string; failure: string | null;
  candidateArtifactId: string | null; sourceImageId: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
interface MediaVersion {
  plan?: { cast: Array<{ id: string; name: string; referenceArtifactId: string; variant?: { resolved?: boolean } }> };
  id: string; sceneId: string; version: number; imageArtifactId: string; annotatedArtifactId: string;
  shots?: VisualShotPresentation<StoredVisualShot> | null;
  verificationVersion: string; localization: { count: number; verifiedParticipantIds?: string[]; anchors: unknown[] };
}
export interface MediaRecords {
  jobs: MediaJob[]; versions: MediaVersion[];
  publications: Array<{ id: string; sceneId: string; versionId: string; revision: number; createdAt: string; operatorId: string; audience?: "public" | "private" }>;
  requests: Array<{ id: string; input: Record<string, unknown>; receipt: Receipt }>;
}
export interface MediaAttempt {
  id: string; operationKey: string; repairJobId?: string | null; status: "pending" | "finished" | "needs_reconciliation" | "reconciled";
  costMicrousd: number | null; receipt?: { chargeUncertain: boolean; status?: number | null; failure?: { kind: string; message: string } } | null; reconciliation?: unknown;
}
interface Receipt { accepted: boolean; code: string; message: string; jobId?: string; versionId?: string; version?: number; publicationId?: string }
const button = "rounded border border-white/25 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";
export const isActiveMediaJob = (job: MediaJob) => ["queued", "rendering", "verifying"].includes(job.status);

function VersionImage({ gameId, artifactId, label, onOpen, apiPrefix }: { gameId: string; artifactId: string; label: string; onOpen: (url: string, label: string) => void; apiPrefix: string }) {
  const session = useAdminSession();
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    session.read<{ imageUrl: string }>(`${apiPrefix}/${gameId}/visual/evidence/artifact/${artifactId}`).then(data => {
      if (!cancelled) setResult({ url: data.imageUrl });
    }).catch(error => { if (!cancelled) setResult({ error: error instanceof Error ? error.message : "Image unavailable" }); });
    return () => { cancelled = true; };
  }, [gameId, artifactId, apiPrefix, session]);
  return <div><p className="mb-2 text-xs text-white/60">{label}</p>{result.url ? <button type="button" className="w-full cursor-zoom-in" onClick={() => onOpen(result.url!, label)} aria-label={`Enlarge ${label}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated immutable media evidence */}
    <img alt={label} src={result.url} className="aspect-video w-full rounded object-contain" />
  </button> : <p role={result.error ? "alert" : "status"}>{result.error ?? "Loading image…"}</p>}</div>;
}

function VersionImages({version, label, annotated = false, ...props}: {
  version: MediaVersion; label: string; annotated?: boolean;
  gameId: string; apiPrefix: string; onOpen: (url: string, label: string) => void;
}) {
  const shots = version.shots;
  const pictures = shots ? [
    ...(shots.overview ? [{shot: shots.overview, name: shots.groups.length > 1 ? "Harmonized scene" : "Scene"}] : []),
    ...shots.groups.filter(shot => shot.imageArtifactId !== shots.overview?.imageArtifactId).map((shot, index) => ({shot, name: `Panel ${index + 1}`})),
  ] : [];
  return <div className="space-y-3" aria-label={label}>
    {pictures.length ? pictures.map(({shot, name}) => <VersionImage key={`${shot.imageArtifactId}:${annotated}`} {...props}
      artifactId={annotated ? shot.annotatedArtifactId : shot.imageArtifactId} label={`${label} · ${name}${annotated ? " annotations" : ""}`} />)
      : <VersionImage key={`${version.id}:${annotated}`} {...props} artifactId={annotated ? version.annotatedArtifactId : version.imageArtifactId} label={`${label}${annotated ? " annotations" : ""}`} />}
  </div>;
}

export function SceneRepairPanel({ gameId, sceneId, originalFailed, media, canOperate, refresh, refreshError, onOpen, attempts, apiPrefix = "/api/admin/games", renderDisabled = false, renderLabel = "Regenerate scene", publicationAudience = "viewers", requirePublication = false, wolfForms = false, onRequestPending }: {
  wolfForms?: boolean; requirePublication?: boolean; apiPrefix?: string; renderDisabled?: boolean; renderLabel?: string; publicationAudience?: "viewers" | "private production";
  onRequestPending?: (pending: boolean) => void;
  gameId: string; sceneId: string; originalFailed: boolean; media: MediaRecords; canOperate: boolean;
  refresh: () => Promise<void>; refreshError: string | null; onOpen: (url: string, label: string) => void;
  attempts: MediaAttempt[];
}) {
  const jobs = media.jobs.filter(job => job.sceneId === sceneId);
  const latest = jobs[0];
  const active = jobs.find(isActiveMediaJob);
  const versions = media.versions.filter(version => version.sceneId === sceneId);
  const publications = media.publications.filter(publication => publication.sceneId === sceneId);
  const publication = publications.find(p => (p.audience ?? "public") === (publicationAudience === "viewers" ? "public" : "private"));
  const published = versions.find(version => version.id === publication?.versionId) ?? (!requirePublication ? versions.find(version => version.version === 0) : undefined);
  const session = useAdminSession(), client = useQueryClient();
  const resource = `${apiPrefix}/${gameId}/visual`, operationKey = `operation:${resource}/media:${sceneId}`;
  const [operation] = useAdminValue<Operation | undefined>(operationKey, undefined);
  const [selection, setSelection] = useAdminValue<string | null>(`ui:${resource}:${sceneId}:version`, null);
  const selected = versions.find(version => version.id === selection) ?? versions[0];
  const [editingVersion, setEditingVersion] = useAdminValue<number | null>(`ui:${resource}:${sceneId}:editing`, null);
  const selectedAnchors = selected?.shots ? new Set([...selected.shots.groups, ...(selected.shots.overview ? [selected.shots.overview] : [])].flatMap(shot => shot.anchors.map(anchor => anchor.playerId))).size : selected?.localization.anchors.length ?? 0;
  const [regenerateForms, setRegenerateForms] = useState(false);
  const [review, setReview] = useState(false);
  const [annotated, setAnnotated] = useState(false);
  const accepted = operation?.phase === "accepted" ? operation.result as Receipt : undefined;
  const awaitingReceipt = Boolean(accepted?.accepted && (
    accepted.jobId && !jobs.some(job => job.id === accepted.jobId)
    || accepted.versionId && !versions.some(version => version.id === accepted.versionId)
    || accepted.publicationId && !publications.some(publication => publication.id === accepted.publicationId)
  ));
  const busy = operation?.phase === "submitting" || awaitingReceipt, uncertain = operation?.phase === "unknown";
  const feedback = operation?.phase === "accepted" ? operation.result as Receipt : operation?.error ? { accepted: false, code: operation.phase, message: operation.error } : null;
  useEffect(() => { onRequestPending?.(busy || uncertain); }, [onRequestPending, busy, uncertain]);
  const [time, setTime] = useState(0);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setTime(Date.now()), 1000); return () => clearInterval(timer); }, [active?.id, active]);
  const send = async (action: Record<string, unknown>) => {
    const body = { ...action, sceneId, expectedVersion: action.expectedVersion ?? latest?.version ?? 0, requestId: crypto.randomUUID() };
    try {
      const receipt = await session.execute<Receipt>(operationKey, `${resource}/media`, body);
      if (!receipt) return;
      if (receipt.accepted && receipt.code === "reviewed") { setEditingVersion(null); setSelection(receipt.versionId ?? null); setReview(true); session.delete(`draft:${resource}:${sceneId}`); }
      await client.invalidateQueries({ queryKey: ["admin", session.scope, `/api/admin/werewolf/${gameId}/costs`] });
      await refresh();
    } catch { /* Failure is retained in the operation record; a GET failure never changes POST acceptance. */ }
  };
  const lastReceipt = feedback ?? media.requests.find(request => request.input.sceneId === sceneId)?.receipt;
  const jobAttempts = latest ? attempts.filter(attempt => (attempt.repairJobId === latest.id || attempt.operationKey.startsWith(`media:${latest.id}:`))) : [];
  const unresolved = attempts.filter(attempt => (attempt.operationKey.startsWith(`${sceneId}:render:`) || jobs.some(job => (attempt.repairJobId === job.id || attempt.operationKey.startsWith(`media:${job.id}:`)))) && attempt.status === "needs_reconciliation");
  return <section aria-label="Scene repair" className="space-y-3 border-t border-white/15 pt-3">
    <p className="text-xs text-white/60">{publicationAudience === "viewers" ? "Viewer version" : "Production version"}: {published ? `v${published.version}` : publicationAudience === "viewers" ? "Portraits" : "Unpublished"} · Publication {publications[0]?.revision ?? 0}</p>
    {canOperate && <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !!active || uncertain} onClick={() => setEditingVersion(latest?.version ?? 0)}>Correct images</button>
      <button className={button} disabled={busy || !!active || uncertain || renderDisabled} onClick={() => void send({ action: "regenerate", ...(wolfForms && regenerateForms ? { regenerateForms: true } : {}) })}>{renderLabel}</button>
      {(latest && ["failed", "needs_reconciliation"].includes(latest.status) || !latest && originalFailed) && <button className={button} disabled={busy || !!active || uncertain || renderDisabled} onClick={() => void send({ action: "continue", ...(latest && { sourceJobId: latest.id }) })}>Continue failed repair</button>}
      {uncertain && <button className={button} disabled={busy} onClick={() => void send({})}>Check request</button>}
    </div>}
    {canOperate && wolfForms && <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={regenerateForms} onChange={event => setRegenerateForms(event.target.checked)} />Regenerate wolf forms too</label>}
    {canOperate && editingVersion !== null && <ImageReviewEditor key={editingVersion} gameId={gameId} sceneId={sceneId} apiPrefix={apiPrefix} disabled={busy || !!active || uncertain} onClose={() => setEditingVersion(null)} onSave={review => void send({ action: "review", review, expectedVersion: editingVersion })} />}
    <p className="text-xs text-white/50">Repairs may incur provider charges. Regeneration includes harmonization for multi-panel scenes. Candidates need review and publication; gameplay is unchanged.</p>
    {unresolved.length > 0 && <div role="status" className="rounded bg-amber-400/10 p-3 text-sm text-amber-200">
      <p>Needs reconciliation: {unresolved.length} provider request(s) have an uncertain outcome.</p>
      {unresolved.map(attempt => <p key={attempt.id} className="break-all text-xs">{attempt.operationKey.split(":").at(-1)} · Attempt {attempt.id}</p>)}
      <a href="#provider-attempts" className="underline">Review receipts before another paid request</a>
    </div>}
    {lastReceipt && <p role={lastReceipt.accepted ? "status" : "alert"} className={`break-words text-sm ${lastReceipt.accepted ? "text-green-200" : "text-amber-200"}`}>{lastReceipt.message}{lastReceipt.jobId && <span className="block text-xs">Job {lastReceipt.jobId}</span>}</p>}
    {latest && <div className="rounded bg-white/5 p-3 text-sm" aria-live="polite">
      <p>{latest.status === "ready" ? "Ready for review" : latest.status.replaceAll("_", " ")} · v{latest.version} · {latest.step}</p>
      <p className="break-all text-xs text-white/50">Job {latest.id}</p>
      <p className="text-xs text-white/60">{Math.max(0, Math.floor(((latest.finishedAt ? Date.parse(latest.finishedAt) : time || Date.parse(latest.startedAt ?? latest.createdAt)) - Date.parse(latest.startedAt ?? latest.createdAt)) / 1000))}s elapsed · ${(jobAttempts.reduce((sum, a) => sum + (a.costMicrousd ?? 0), 0) / 1_000_000).toFixed(4)} known · {jobAttempts.filter(a => a.costMicrousd === null).length} unpriced</p>
      {latest.failure && <p className="mt-2 text-amber-200">{latest.failure}</p>}
      {latest.status === "failed" && jobAttempts.some(attempt => attempt.receipt?.failure?.kind === "identity") && <p className="mt-2 text-amber-200">The image was generated, but character identities could not be verified. Review the saved candidate below before choosing a recheck or a new render.</p>}
      {latest.status === "needs_reconciliation" && <a href="#provider-attempts" className="underline">Review provider receipts and record reconciliation below</a>}
    </div>}
    {awaitingReceipt && <p role="status" className="text-sm text-white/60">Request accepted. Refreshing the saved version before another action.</p>}
    {refreshError && <p role="alert" className="text-sm text-amber-200">Progress refresh failed. Showing the last saved state. <button className="underline" onClick={() => void refresh()}>Retry refresh</button></p>}
    {(versions.length > 0 || jobs.length > 0) && <button className={button} onClick={() => setReview(!review)}>{review ? "Close versions" : "Versions and review"}</button>}
    {review && <div className="space-y-3">
      {selected && <>
        <label className="block text-sm">Candidate <select aria-label="Candidate version" className="ml-2 rounded bg-neutral-900 p-2" value={selected.id} onChange={event => setSelection(event.target.value)}>{versions.map(version => <option value={version.id} key={version.id}>v{version.version}{version.version === 0 ? " · Original gameplay image" : " · Reviewed"}</option>)}</select></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={annotated} onChange={event => setAnnotated(event.target.checked)} />Numbered annotations</label>
        <div className="grid gap-3 sm:grid-cols-2">
          {published ? <VersionImages version={published} annotated={annotated} gameId={gameId} label={`Published v${published.version}`} onOpen={onOpen} apiPrefix={apiPrefix} /> : <p>{publicationAudience === "viewers" ? "Viewers currently see portraits." : "No published production version yet."}</p>}
          <VersionImages version={selected} annotated={annotated} gameId={gameId} label={`Candidate v${selected.version}`} onOpen={onOpen} apiPrefix={apiPrefix} />
        </div>
        {selected.plan?.cast.some(member => member.variant?.resolved) && <details><summary className="text-sm">Wolf forms used</summary><div className="grid gap-3 sm:grid-cols-2">{selected.plan.cast.filter(member => member.variant?.resolved).map(member => <VersionImage key={member.id} gameId={gameId} artifactId={member.referenceArtifactId} label={member.name} onOpen={onOpen} apiPrefix={apiPrefix} />)}</div></details>}
        <p className="text-sm">{selected.localization.count} verified people · {selectedAnchors} head anchors</p>
        {!selectedAnchors && selected.localization.count > 0 && <p className="text-sm text-amber-200">Head positions are uncertain. Viewers use named portrait speech panels.</p>}
        {selected.shots && selected.shots.mode !== "scene" && <p className="text-sm text-white/60">{selected.shots.mode === "portraits" ? "This version uses portraits." : `${selected.shots.groups.length} group shots. Open Correct images to inspect each picture.`}</p>}
        <details><summary className="text-sm">Identity and head findings</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ verifier: selected.verificationVersion, ...selected.localization }, null, 2)}</pre></details>
        {canOperate && <div className="flex flex-wrap gap-2">
          {(!selected.shots || selected.shots.mode === "scene") && <button className={button} disabled={busy || !!active || uncertain || renderDisabled} onClick={() => void send({ action: "verify", sourceVersionId: selected.id })}>Recheck image</button>}
          <button className={button} disabled={busy || uncertain || selected.id === published?.id} onClick={() => void send({ action: "publish", ...(requirePublication ? { audience: publicationAudience === "viewers" ? "public" : "private" } : {}), versionId: selected.id, expectedPublication: publications[0]?.revision ?? 0 })}>{publications.some(p => p.versionId === selected.id && (p.audience ?? "public") === (publicationAudience === "viewers" ? "public" : "private")) || !requirePublication && selected.version === 0 ? `Restore for ${publicationAudience}` : `Publish for ${publicationAudience}`}</button>
        </div>}
      </>}
      {jobs.map(job => <details key={job.id}><summary className="cursor-pointer text-sm">v{job.version} · {job.status.replaceAll("_", " ")}</summary>
        <p className="break-all text-xs">{job.id} · {job.step}</p>{job.failure && <p className="text-sm text-amber-200">{job.failure}</p>}
        <ul className="text-xs text-white/60">{attempts.filter(attempt => (attempt.repairJobId === job.id || attempt.operationKey.startsWith(`media:${job.id}:`))).map(attempt => <li key={attempt.id} className="break-all">{attempt.operationKey.startsWith(`media:${job.id}:`) ? attempt.operationKey.slice(`media:${job.id}:`.length) : attempt.operationKey} · {attempt.costMicrousd === null ? "Cost unknown" : `$${(attempt.costMicrousd / 1_000_000).toFixed(4)}`} · <a href="#provider-attempts" className="underline">Receipt {attempt.id}</a></li>)}</ul>
        {job.candidateArtifactId && !versions.some(v => v.id === job.id) && <><VersionImage gameId={gameId} artifactId={job.candidateArtifactId} label={`Unverified v${job.version}`} onOpen={onOpen} apiPrefix={apiPrefix} />{canOperate && <button className={button} disabled={busy || !!active || uncertain || renderDisabled} onClick={() => void send({ action: "verify", sourceVersionId: job.id })}>Recheck image</button>}</>}
      </details>)}
      <details><summary className="text-sm">Publication history</summary><ul className="space-y-2 text-xs">{publications.map(p => <li key={p.id}>Publication {p.revision} · {p.createdAt} · {p.operatorId} · {p.versionId}</li>)}</ul></details>
    </div>}
  </section>;
}
