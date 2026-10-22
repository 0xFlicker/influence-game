"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch, getAuthToken, resolveApiUrl } from "@/lib/api";

type Route = "ordinary" | "escalated";
type Filter = "all" | "available" | "mine" | "flagged" | "ai_review" | "screening_incomplete";
type Disposition = "allowed" | "rejected";
type Queue = { activeClaim: { reviewId: string; route: Route } | null; items: { id: string; name: string; disposition: Disposition; flagged: boolean; ownSubmission: boolean; claimedBy: string | null; screeningStatus: string | null; aiRecommendation: string | null; reviewStatus: string }[]; nextOffset: number | null; serverTime: string; canEscalateReview: boolean; canUndo: boolean };
type Screening = {
  status: "pending" | "running" | "completed" | "incomplete"; policyVersion: string; models: string[]; failureCode: string | null; finishedAt: string | null;
  recommendation: "no_concern" | "review" | "inconclusive" | null; assessmentScope: "full" | "collusion_only"; safetyRefused: boolean;
  attempts: { stage: string; ordinal: number; outcome: string | null; httpStatus: number | null; providerCode: string | null; refusal: string | null }[];
  result: { recommendation: "no_concern" | "review" | "inconclusive"; summary: string; findings: { category: string; source: "text" | "image"; field: string; quote: string; assetHash: string; explanation: string }[] } | null;
  safetySignals: { model: string; flagged: boolean; categories: Record<string, boolean>; scores: Record<string, number> } | null;
};
type Revision = { userId?: string; snapshot: Record<string, unknown> };
type Detail = { screening: Screening | null; isLatestSubmission: boolean; canUndo: boolean; archived: boolean; review: { id: string; version: number; status: string; route: Route; disposition: Disposition; held: boolean }; revision: Revision; parent: Revision | null; claim: { token?: string; expiresAt: string } | null; serverTime: string; history: { id: string; kind: string; actorId: string; decisionVersion?: number; beforeDisposition?: Disposition; disposition?: Disposition; reason: string | null; createdAt: string }[] };
type Preview = { fingerprint: string; reviewVersion: number; beforeDisposition: Disposition; afterDisposition: Disposition; unavailable: boolean; archived: boolean; heldRevisionCount: number; recovery: string | null; scope: string };
const post = <T,>(path: string, body: object) => apiFetch<T>(`/api/moderation/${path}`, { method: "POST", body: JSON.stringify(body) });
const fieldLabels: Record<string, string> = { name: "Name", gender: "Gender", personaKey: "Archetype", personality: "Personality", backstory: "Backstory", strategyStyle: "Influence strategy", werewolfStrategyStyle: "Werewolf strategy", performanceInstructions: "Character performance", visualDesign: "Visual design" };
const button = "influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm disabled:opacity-40";

function Evidence({ reviewId, hash }: { reviewId: string; hash: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    void fetch(resolveApiUrl(`/api/moderation/reviews/${encodeURIComponent(reviewId)}/evidence/${encodeURIComponent(hash)}`), {
      headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: abort.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Evidence unavailable");
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob); setSource(url);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [reviewId, hash]);
  if (error) return <p role="alert">Evidence unavailable. Refresh, flag, or pass this item.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return source ? <img src={source} alt="Retained submitted artwork" className="max-h-96 max-w-full rounded-lg object-contain" /> : <p role="status">Loading evidence…</p>;
}
function Snapshot({ title, revision, reviewId }: { title: string; revision: Revision | null; reviewId: string }) {
  const snapshot = revision?.snapshot;
  const assets = snapshot?.assets && typeof snapshot.assets === "object" ? Object.values(snapshot.assets).filter((hash): hash is string => typeof hash === "string") : [];
  return <section className="min-w-0 rounded-xl border border-border-active p-4">
    <h3 className="mb-3 font-semibold">{title}</h3>
    {!snapshot ? <p className="text-sm text-white/50">No accessible comparison.</p> : <>
      <dl className="space-y-3">{["name", "gender", "personaKey", "personality", "backstory", "strategyStyle", "werewolfStrategyStyle", "performanceInstructions", "visualDesign"].map(key => <div key={key}><dt className="text-xs text-white/50">{fieldLabels[key]}</dt><dd className="whitespace-pre-wrap break-words text-sm">{typeof snapshot[key] === "string" ? snapshot[key] as string : "—"}</dd></div>)}</dl>
      <div className="mt-4 space-y-3">{[...new Set(assets)].map(hash => <Evidence key={`${reviewId}:${hash}`} reviewId={reviewId} hash={hash} />)}</div>
    </>}
  </section>;
}

type ScreeningOverviewData = {
  scope: "all_queues" | "ordinary"; policyVersion: string; serverTime: string; total: number;
  statuses: Record<"pending" | "running" | "completed" | "incomplete", number>;
  recommendations: Record<"no_concern" | "review" | "inconclusive", number>;
  failures: { code: string; count: number }[];
};

function ScreeningOverview({ data }: { data: ScreeningOverviewData }) {
  return <section aria-label="Screening overview" className="mb-6 rounded-xl border border-border-active p-4">
    <h2 className="text-lg font-semibold">Screening overview · Shadow mode</h2>
    <p className="mt-2 text-sm text-white/60">Screening is advisory. Saves publish immediately unless restricted by an existing human decision.</p>
    {data && <>
      <p className="mt-3 text-sm">{data.total} screened or queued revisions · {data.scope === "all_queues" ? "All review queues" : "Moderator queue only"}</p>
      <p className="mt-1 text-xs text-white/50">Includes older revisions and resolved reviews for the current policy. Queue filters below do not change these counts. Profiles awaiting backfill are not included.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{([['pending', 'Pending'], ['running', 'Running'], ['completed', 'Completed'], ['incomplete', 'Incomplete']] as const).map(([key, label]) => <div key={key} className="rounded-lg bg-surface-raised p-3"><dt className="text-sm text-white/60">{label}</dt><dd className="mt-1 text-2xl font-semibold">{data.statuses[key]}</dd></div>)}</dl>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">{([['review', 'Human review recommended'], ['no_concern', 'No concern detected'], ['inconclusive', 'Inconclusive']] as const).map(([key, label]) => <div key={key}><dt className="inline text-white/60">{label}: </dt><dd className="inline font-semibold">{data.recommendations[key]}</dd></div>)}</dl>
      <h3 className="mt-4 text-sm font-semibold">Failures</h3>
      {data.failures.length === 0 ? <p className="mt-1 text-sm text-white/60">No screening failures recorded.</p> : <ul className="mt-2 space-y-1 text-sm">{data.failures.map(failure => <li key={failure.code} className="break-words"><code>{failure.code}</code>: {failure.count}</li>)}</ul>}
      <p className="mt-3 text-xs text-white/50">Updated {new Date(data.serverTime).toLocaleString()} · {data.policyVersion}</p>
    </>}
  </section>;
}

function ShadowScreening({ screening, latest }: { screening: Screening | null; latest: boolean }) {
  const labels = { no_concern: "No concern detected", review: "Human review recommended", inconclusive: "Inconclusive" };
  return <section aria-label="AI shadow screening" className="rounded-xl border border-border-active p-4">
    <h3 className="font-semibold">AI recommendation · Shadow mode</h3>
    <p className="mt-1 text-sm text-white/60">Advisory only. AI screening does not change publication or make a moderation decision.</p>
    {!latest && <p className="mt-2 text-sm text-amber-200">This is an older submission. Findings apply only to the revision shown.</p>}
    {!screening ? <p className="mt-3">Not yet queued for screening.</p> : <>
      <p className="mt-3 font-medium">{screening.recommendation ? labels[screening.recommendation] : screening.status === "incomplete" ? "Screening incomplete — no clearance" : screening.status === "running" ? "Screening in progress" : "Awaiting screening"}</p>
      {screening.safetyRefused && <p className="mt-2 text-sm text-amber-200">A provider refused the safety assessment. Human review is recommended; offensive content and the image have not been cleared. This shadow signal does not pause publication.</p>}
      {screening.failureCode && <p className="mt-1 text-sm">Screening could not finish ({screening.failureCode}). Review the submission manually.</p>}
      {screening.result && <>
        {screening.assessmentScope === "collusion_only" && <p className="mt-2 text-sm font-medium">Text-only collusion result: {labels[screening.result.recommendation]}</p>}
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{screening.result.summary}</p>
        <ul className="mt-3 space-y-4">{screening.result.findings.map((finding, index) => <li key={index} className="rounded-lg bg-surface-raised p-3">
          <strong className="text-sm">{finding.category === "outside_game_collusion" ? "Outside-game collusion" : "Offensive content"}</strong>
          {finding.source === "text" ? <><p className="mt-1 text-xs text-white/60">{fieldLabels[finding.field] ?? finding.field}</p><blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-amber-300/40 pl-3 text-sm">{finding.quote}</blockquote></> : <p className="mt-1 break-all text-xs text-white/60">Retained image: {finding.assetHash}</p>}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{finding.explanation}</p>
        </li>)}</ul>
      </>}
      {screening.safetySignals && <details className="mt-3 text-sm"><summary>OpenAI safety signals{screening.safetySignals.flagged ? " · Potential harm detected" : " · No categories flagged"}</summary>
        <p className="mt-2 text-white/60">Classifier signals are not a House policy decision. Image coverage varies by category.</p>
        <table className="mt-2 w-full text-left"><thead><tr><th>Category</th><th>Flagged</th><th>Score</th></tr></thead><tbody>{Object.entries(screening.safetySignals.scores).map(([category, score]) => <tr key={category}><td>{category}</td><td>{screening.safetySignals!.categories[category] ? "Yes" : "No"}</td><td>{score === 0 ? "0" : score.toPrecision(5)}</td></tr>)}</tbody></table>
      </details>}
      {screening.attempts.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-medium">Screening operations</caption><thead><tr><th>Operation</th><th>Attempt</th><th>HTTP</th><th>Outcome / code</th></tr></thead><tbody>{screening.attempts.map(attempt => <tr key={`${attempt.stage}:${attempt.ordinal}`}><td>{attempt.stage}</td><td>{attempt.ordinal}</td><td>{attempt.httpStatus ?? "—"}</td><td>{attempt.outcome ?? "Pending"}{attempt.refusal ? ` · ${attempt.refusal}` : attempt.providerCode ? ` · ${attempt.providerCode}` : ""}</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-xs text-white/50">{screening.models.join(" + ")} · {screening.policyVersion}{screening.finishedAt ? ` · ${new Date(screening.finishedAt).toLocaleString()}` : ""}</p>
    </>}
  </section>;
}

export function ModerationInbox() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [overview, setOverview] = useState<ScreeningOverviewData | null>(null);
  const [route, setRoute] = useState<Route>("ordinary");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [undoActionId, setUndoActionId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"accept" | "reject">("accept");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const pending = useRef(false);
  const lastCommand = useRef<{ signature: string; actionId: string } | null>(null);
  async function command<T>(path: string, body: object): Promise<T> {
    const fields = { ...body, actionId: undefined };
    const signature = JSON.stringify({ path, fields });
    if (lastCommand.current?.signature !== signature) lastCommand.current = { signature, actionId: crypto.randomUUID() };
    sessionStorage.setItem("moderation-pending-action", lastCommand.current.actionId);
    setPendingReceipt(lastCommand.current.actionId);
    let result: T;
    try { result = await post<T>(path, { ...body, actionId: lastCommand.current.actionId }); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        sessionStorage.removeItem("moderation-pending-action"); setPendingReceipt(null); lastCommand.current = null;
      }
      throw cause;
    }
    sessionStorage.removeItem("moderation-pending-action"); setPendingReceipt(null);
    lastCommand.current = null;
    return result;
  }
  const detailRequest = useRef(0);
  const initialReviewLoaded = useRef(false);
  const inboxRequest = useRef(0);
  const fetchInbox = useCallback(() => Promise.all([
    apiFetch<Queue>(`/api/moderation/queue?route=${route}&filter=${filter}&offset=${offset}`),
    apiFetch<ScreeningOverviewData>("/api/moderation/screening-overview"),
  ]), [route, filter, offset]);
  const loadQueue = useCallback(async () => {
    const request = ++inboxRequest.current;
    const [next, counts] = await fetchInbox();
    if (request === inboxRequest.current) { setQueue(next); setOverview(counts); }
  }, [fetchInbox]);
  async function refreshInbox() {
    const request = ++inboxRequest.current;
    const selectedRequest = ++detailRequest.current;
    setPreview(null); setUndoActionId(null);
    const [[next, counts], selected] = await Promise.all([
      fetchInbox(),
      detail ? apiFetch<Detail>(`/api/moderation/reviews/${encodeURIComponent(detail.review.id)}`) : Promise.resolve(null),
    ]);
    if (request !== inboxRequest.current || selectedRequest !== detailRequest.current) return;
    setQueue(next); setOverview(counts); setDetail(selected);
  }
  useEffect(() => {
    let active = true;
    async function load() {
      const request = ++inboxRequest.current;
      try {
        const [next, counts] = await fetchInbox();
        if (active && request === inboxRequest.current) {
          setQueue(next); setOverview(counts); setError(null); setPendingReceipt(sessionStorage.getItem("moderation-pending-action"));
          const reviewId = new URL(window.location.href).searchParams.get("review");
          if (reviewId && !initialReviewLoaded.current) {
            const selected = await apiFetch<Detail>(`/api/moderation/reviews/${encodeURIComponent(reviewId)}`);
            if (active && request === inboxRequest.current) { initialReviewLoaded.current = true; setDetail(selected); }
          }
        }
      } catch (cause) { if (active && request === inboxRequest.current) { setQueue(null); setOverview(null); setError(cause instanceof Error ? cause.message : "Queue unavailable"); } }
    }
    void load(); window.addEventListener("auth:session-ready", load);
    return () => { active = false; window.removeEventListener("auth:session-ready", load); };
  }, [fetchInbox]);
  useEffect(() => {
    const deadline = detail?.claim ? Date.now() + new Date(detail.claim.expiresAt).getTime() - new Date(detail.serverTime).getTime() : 0;
    const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [detail]);
  async function open(id: string) {
    const sequence = ++detailRequest.current;
    setPreview(null); setUndoActionId(null); setReason(""); setDetail(null);
    const next = await apiFetch<Detail>(`/api/moderation/reviews/${encodeURIComponent(id)}`);
    if (sequence === detailRequest.current) setDetail(next);
  }
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setReceipt(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed. Refresh before retrying."); setPreview(null); }
    finally { pending.current = false; setBusy(false); }
  }
  async function claim(reviewId?: string) {
    const result = await command<{ reviewId: string } | null>("claim", { actionId: crypto.randomUUID(), route, ...(reviewId ? { reviewId } : {}) });
    if (result) await open(result.reviewId);
    else setReceipt("No available work in this queue.");
    await loadQueue();
  }
  async function triage(action: "extend" | "release" | "flag" | "pass" | "return") {
    if (!detail?.claim?.token) return;
    const id = detail.review.id;
    await command(`reviews/${id}/triage`, { actionId: crypto.randomUUID(), action, token: detail.claim.token, version: detail.review.version, ...(reason.trim() ? { reason } : {}) });
    setPreview(null); setReceipt(`${action === "pass" ? "Passed to admin review" : action === "flag" ? "Flagged; remains in queue" : action === "release" ? "Claim released" : action === "return" ? "Returned to moderator queue" : "Claim extended"}.`);
    if (action === "pass" || action === "return") setDetail(null); else await open(id);
    await loadQueue();
  }
  const mine = Boolean(detail?.claim?.token && seconds > 0);
  return <main className="mx-auto max-w-7xl px-4 py-8 text-text-primary sm:px-6">
    <header className="mb-6"><h1 className="text-3xl font-semibold">Moderation inbox</h1><p className="mt-2 text-sm text-white/60">Review whole character revisions. Profiles are read-only here.</p></header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/40 p-4 text-red-300">{error}</p>}
    {pendingReceipt && <button className={`${button} mb-4`} disabled={busy} onClick={() => void run(async () => {
      const recovered = await apiFetch<{ kind: string }>(`/api/moderation/receipts/${pendingReceipt}`);
      setReceipt(`Recovered recorded action: ${recovered.kind}. Refresh the review before acting again.`);
      sessionStorage.removeItem("moderation-pending-action"); setPendingReceipt(null); lastCommand.current = null; setDetail(null); setPreview(null); await loadQueue();
    })}>Recover last action receipt</button>}
    {receipt && <p role="status" className="mb-4 rounded-lg border border-border-active p-4">{receipt}</p>}
    {queue?.canUndo && <Link href="/moderation/recovery" className="influence-link mb-4 inline-block">Admin recovery and resolved reviews →</Link>}
    {queue && overview && <ScreeningOverview data={overview} />}
    <div className="mb-5 flex flex-wrap gap-3">
      <select aria-label="Queue" value={route} disabled={busy} onChange={event => { setRoute(event.target.value as Route); setOffset(0); setDetail(null); setPreview(null); }} className={button}><option value="ordinary">Moderator queue</option>{queue?.canEscalateReview && <option value="escalated">Admin escalations</option>}</select>
      <select aria-label="Filter" value={filter} disabled={busy} onChange={event => { setFilter(event.target.value as Filter); setOffset(0); }} className={button}>{(["all", "available", "mine", "flagged", "ai_review", "screening_incomplete"] as const).map(value => <option key={value} value={value}>{value === "ai_review" ? "AI recommends review" : value === "screening_incomplete" ? "Screening incomplete" : value}</option>)}</select>
      <button className={button} disabled={busy || !queue} onClick={() => void run(() => claim())}>Take next</button>
      <button className={button} disabled={busy} onClick={() => void run(refreshInbox)}>Refresh</button>
    </div>
    {queue?.activeClaim && <button className={`${button} mb-4`} disabled={busy} onClick={() => void run(() => open(queue.activeClaim!.reviewId))}>Resume your claimed review</button>}
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside aria-label="Review queue" className="space-y-2">
        {queue?.items.length === 0 && <p className="p-4 text-sm text-white/50">No items in this view.</p>}
        {queue?.items.map(item => <button key={item.id} disabled={busy} onClick={() => void run(() => open(item.id))} className={`${button} block w-full text-left ${detail?.review.id === item.id ? "border-accent" : ""}`}><strong className="block">{item.name}</strong><span className="text-xs text-white/50">{item.disposition}{item.flagged ? " · Flagged" : ""}{item.claimedBy ? " · Claimed" : ""}{item.ownSubmission ? " · Your submission" : ""}</span><span className="block text-xs text-amber-200">{item.aiRecommendation === "review" ? "AI recommends review" : item.aiRecommendation === "inconclusive" ? "AI inconclusive" : item.screeningStatus === "incomplete" ? "Screening incomplete" : item.aiRecommendation === "no_concern" ? "AI: no concern detected" : "AI: awaiting screening"}</span></button>)}
        <div className="flex gap-2"><button className={button} disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className={button} disabled={busy || queue?.nextOffset == null} onClick={() => setOffset(queue!.nextOffset!)}>Next</button></div>
      </aside>
      {!detail ? <p className="p-4 text-white/50">Select a revision to inspect it, or take the next available item.</p> : <section className="min-w-0 space-y-4">
        <div className="influence-panel rounded-xl p-4"><h2 className="text-xl font-semibold">{String(detail.revision.snapshot.name ?? "Character")}</h2><p className="mt-1 text-sm">{detail.archived ? "Archived · " : ""}{detail.review.disposition} · {detail.review.status}{detail.review.held ? " · Held from publication" : ""}</p>
          {detail.claim?.token ? <p role="status" className="mt-2 text-sm">{seconds ? `Your claim: ${Math.floor(seconds / 60)}m ${seconds % 60}s remaining` : "Claim expired. Refresh and claim again before acting."}</p> : detail.claim ? <p className="mt-2 text-sm">Claimed by another reviewer.</p> : <button className={`${button} mt-3`} disabled={busy || detail.review.status !== "pending"} onClick={() => void run(() => claim(detail.review.id))}>Claim revision</button>}
        </div>
        {detail.canUndo && detail.revision.userId && <Link className="text-sm text-indigo-300 underline" href={`/admin/inference?userId=${encodeURIComponent(detail.revision.userId)}`}>Owner spending and generation controls</Link>}
        <ShadowScreening screening={detail.screening} latest={detail.isLatestSubmission} />
        {detail.review.status !== "pending" && <p className="text-sm text-white/60">This human review is resolved. AI findings do not reopen it. An admin can reopen it through Admin recovery if further review is needed.</p>}
        <div className="grid gap-4 xl:grid-cols-2"><Snapshot title="Previous revision" revision={detail.parent} reviewId={detail.review.id} /><Snapshot title="Submitted revision" revision={detail.revision} reviewId={detail.review.id} /></div>
        <label className="block text-sm">Decision or handoff reason<textarea maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className="mt-2 block min-h-24 w-full rounded-lg border border-border-active bg-surface-raised p-3" /></label>
        <div className="flex flex-wrap gap-2">
          {(["accept", "reject"] as const).map(action => <button key={action} className={button} disabled={!mine || busy} onClick={() => void run(async () => { setUndoActionId(null); setDecision(action); setPreview(await post<Preview>(`reviews/${detail.review.id}/preview`, { action })); })}>{action === "accept" ? `Accept — keep ${detail.review.disposition}` : detail.review.disposition === "allowed" ? "Reject — remove revision" : "Reject — restore revision"}</button>)}
          {(["extend", "release", "flag", detail.review.route === "ordinary" ? "pass" : "return"] as const).map(action => <button className={button} key={action} disabled={!mine || busy || (["flag", "pass", "return"].includes(action) && !reason.trim())} onClick={() => void run(() => triage(action))}>{action === "pass" ? "Pass to admin" : action === "return" ? "Return to moderators" : action.charAt(0).toUpperCase() + action.slice(1)}</button>)}
        </div>
        {preview && <section className="rounded-xl border border-amber-300/40 p-4" aria-label="Decision preview"><h3 className="font-semibold">Confirm whole-revision decision</h3><p className="mt-2">Disposition: {preview.beforeDisposition} → {preview.afterDisposition}. {preview.unavailable ? "Character will be unavailable for future games." : "A permitted revision will be available for future games."}</p><p>{preview.heldRevisionCount} dependent revisions held.</p>{preview.recovery && <p className="text-amber-200">Admin recovery: {preview.recovery}</p>}<p className="mt-2 text-sm text-white/60">{preview.scope}</p><button className={`${button} mt-4`} disabled={busy || (!mine && !undoActionId) || (decision === "reject" && !reason.trim())} onClick={() => void run(async () => {
          await command(`reviews/${detail.review.id}/decide`, { actionId: crypto.randomUUID(), action: decision, token: detail.claim?.token, ...(undoActionId ? { undoActionId } : {}), version: preview.reviewVersion, previewFingerprint: preview.fingerprint, expectedDisposition: preview.beforeDisposition, disposition: preview.afterDisposition, ...(reason.trim() ? { reason } : {}) });
          setReceipt("Decision recorded. Take next when ready."); setDetail(null); setPreview(null); await loadQueue();
        })}>Confirm decision</button></section>}
        <details className="rounded-xl border border-border-active p-4"><summary>Review history</summary><ol className="mt-3 space-y-2 text-sm">{detail.history.map(event => <li key={event.id}>{event.kind} · {new Date(event.createdAt).toLocaleString()} · Reviewer {event.actorId}{event.reason ? ` — ${event.reason}` : ""}
          {event.disposition && <span className="block text-white/60">{event.beforeDisposition} → {event.disposition}</span>}
          {detail.canUndo && event.kind === "reject" && event.decisionVersion === detail.review.version && <button className={`${button} mt-2`} disabled={busy} onClick={() => void run(async () => { setDecision("reject"); setUndoActionId(event.id); setPreview(await post<Preview>(`reviews/${detail.review.id}/preview`, { action: "reject" })); })}>Preview undo</button>}
        </li>)}</ol></details>
      </section>}
    </div>
  </main>;
}
