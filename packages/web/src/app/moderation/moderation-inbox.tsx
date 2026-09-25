"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch, getAuthToken, resolveApiUrl } from "@/lib/api";

type Route = "ordinary" | "escalated";
type Filter = "all" | "available" | "mine" | "flagged";
type Disposition = "allowed" | "rejected";
type Queue = { activeClaim: { reviewId: string; route: Route } | null; items: { id: string; name: string; disposition: Disposition; flagged: boolean; ownSubmission: boolean; claimedBy: string | null }[]; nextOffset: number | null; serverTime: string; canEscalateReview: boolean; canUndo: boolean };
type Revision = { userId?: string; snapshot: Record<string, unknown> };
type Detail = { canUndo: boolean; archived: boolean; review: { id: string; version: number; status: string; route: Route; disposition: Disposition; held: boolean }; revision: Revision; parent: Revision | null; claim: { token?: string; expiresAt: string } | null; serverTime: string; history: { id: string; kind: string; actorId: string; decisionVersion?: number; beforeDisposition?: Disposition; disposition?: Disposition; reason: string | null; createdAt: string }[] };
type Preview = { fingerprint: string; reviewVersion: number; beforeDisposition: Disposition; afterDisposition: Disposition; unavailable: boolean; archived: boolean; heldRevisionCount: number; recovery: string | null; scope: string };
const post = <T,>(path: string, body: object) => apiFetch<T>(`/api/moderation/${path}`, { method: "POST", body: JSON.stringify(body) });
const fieldLabels: Record<string, string> = { name: "Name", gender: "Gender", personaKey: "Archetype", personality: "Personality", backstory: "Backstory", strategyStyle: "Strategy", performanceInstructions: "Character performance", visualDesign: "Visual design" };
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
      <dl className="space-y-3">{["name", "gender", "personaKey", "personality", "backstory", "strategyStyle", "performanceInstructions", "visualDesign"].map(key => <div key={key}><dt className="text-xs text-white/50">{fieldLabels[key]}</dt><dd className="whitespace-pre-wrap break-words text-sm">{typeof snapshot[key] === "string" ? snapshot[key] as string : "—"}</dd></div>)}</dl>
      <div className="mt-4 space-y-3">{[...new Set(assets)].map(hash => <Evidence key={`${reviewId}:${hash}`} reviewId={reviewId} hash={hash} />)}</div>
    </>}
  </section>;
}

export function ModerationInbox() {
  const [queue, setQueue] = useState<Queue | null>(null);
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
  const loadQueue = useCallback(async () => {
    const next = await apiFetch<Queue>(`/api/moderation/queue?route=${route}&filter=${filter}&offset=${offset}`);
    setQueue(next);
  }, [route, filter, offset]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await apiFetch<Queue>(`/api/moderation/queue?route=${route}&filter=${filter}&offset=${offset}`);
        if (active) {
          setQueue(next); setError(null); setPendingReceipt(sessionStorage.getItem("moderation-pending-action"));
          const reviewId = new URL(window.location.href).searchParams.get("review");
          if (reviewId && !initialReviewLoaded.current) {
            const selected = await apiFetch<Detail>(`/api/moderation/reviews/${encodeURIComponent(reviewId)}`);
            if (active) { initialReviewLoaded.current = true; setDetail(selected); }
          }
        }
      } catch (cause) { if (active) { setQueue(null); setError(cause instanceof Error ? cause.message : "Queue unavailable"); } }
    }
    void load(); window.addEventListener("auth:session-ready", load);
    return () => { active = false; window.removeEventListener("auth:session-ready", load); };
  }, [route, filter, offset]);
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
    <div className="mb-5 flex flex-wrap gap-3">
      <select aria-label="Queue" value={route} disabled={busy} onChange={event => { setRoute(event.target.value as Route); setOffset(0); setDetail(null); setPreview(null); }} className={button}><option value="ordinary">Moderator queue</option>{queue?.canEscalateReview && <option value="escalated">Admin escalations</option>}</select>
      <select aria-label="Filter" value={filter} disabled={busy} onChange={event => { setFilter(event.target.value as Filter); setOffset(0); }} className={button}>{(["all", "available", "mine", "flagged"] as const).map(value => <option key={value} value={value}>{value}</option>)}</select>
      <button className={button} disabled={busy || !queue} onClick={() => void run(() => claim())}>Take next</button>
      <button className={button} disabled={busy} onClick={() => void run(async () => { await loadQueue(); if (detail) await open(detail.review.id); })}>Refresh</button>
    </div>
    {queue?.activeClaim && <button className={`${button} mb-4`} disabled={busy} onClick={() => void run(() => open(queue.activeClaim!.reviewId))}>Resume your claimed review</button>}
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside aria-label="Review queue" className="space-y-2">
        {queue?.items.length === 0 && <p className="p-4 text-sm text-white/50">No items in this view.</p>}
        {queue?.items.map(item => <button key={item.id} disabled={busy} onClick={() => void run(() => open(item.id))} className={`${button} block w-full text-left ${detail?.review.id === item.id ? "border-accent" : ""}`}><strong className="block">{item.name}</strong><span className="text-xs text-white/50">{item.disposition}{item.flagged ? " · Flagged" : ""}{item.claimedBy ? " · Claimed" : ""}{item.ownSubmission ? " · Your submission" : ""}</span></button>)}
        <div className="flex gap-2"><button className={button} disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className={button} disabled={busy || queue?.nextOffset == null} onClick={() => setOffset(queue!.nextOffset!)}>Next</button></div>
      </aside>
      {!detail ? <p className="p-4 text-white/50">Select a revision to inspect it, or take the next available item.</p> : <section className="min-w-0 space-y-4">
        <div className="influence-panel rounded-xl p-4"><h2 className="text-xl font-semibold">{String(detail.revision.snapshot.name ?? "Character")}</h2><p className="mt-1 text-sm">{detail.archived ? "Archived · " : ""}{detail.review.disposition} · {detail.review.status}{detail.review.held ? " · Held from publication" : ""}</p>
          {detail.claim?.token ? <p role="status" className="mt-2 text-sm">{seconds ? `Your claim: ${Math.floor(seconds / 60)}m ${seconds % 60}s remaining` : "Claim expired. Refresh and claim again before acting."}</p> : detail.claim ? <p className="mt-2 text-sm">Claimed by another reviewer.</p> : <button className={`${button} mt-3`} disabled={busy || detail.review.status !== "pending"} onClick={() => void run(() => claim(detail.review.id))}>Claim revision</button>}
        </div>
        {detail.canUndo && detail.revision.userId && <Link className="text-sm text-indigo-300 underline" href={`/admin/inference?userId=${encodeURIComponent(detail.revision.userId)}`}>Owner spending and generation controls</Link>}
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
