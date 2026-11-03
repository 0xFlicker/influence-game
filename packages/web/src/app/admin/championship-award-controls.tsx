"use client";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import type { RunChampionshipAction } from "./championship-admin-panel";
const button = "influence-button-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 block w-full rounded-lg border border-white/20 bg-surface-raised px-3 py-2 text-sm";
type Phase = { phase: string; frozen: boolean; deliveredAt: string | null; grants: Array<{ definitionCode: string; recipientName: string; recipient: { type: string; id: string } }> };
type Grant = { id: string; title: string; recipientType: string; recipientName: string; sourceEventId: string | null; revokedAt: string | null; grantedAt: string };
type History = { grant: { reason: string; evidence: Record<string, unknown> }; audit: Array<{ id: string; createdAt: string; action: string; reason: string }> };
export function ChampionshipAwardControls({ eventId, disabled, run }: { eventId: string; disabled: boolean; run: RunChampionshipAction }) {
  const [phases, setPhases] = useState<Phase[] | null>(null), [grants, setGrants] = useState<Grant[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Grant | null>(null), [history, setHistory] = useState<History | null>(null), [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false), [denied, setDenied] = useState(false);
  function fail(cause: unknown) {
    setError(String(cause));
    if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setDenied(true); setGrants([]); setChosen(null); setHistory(null); setPhases(null); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ grants: Grant[]; nextCursor: string | null }>(`/api/admin/awards?eventId=${encodeURIComponent(eventId)}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setGrants(result.grants); setCursor(result.nextCursor); } }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [eventId]);
  useEffect(() => {
    const controller = new AbortController(); setHistory(null); setReason("");
    if (chosen) void apiFetch<History>(`/api/admin/awards/${chosen.id}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setHistory(result); }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [chosen]);
  async function preview() {
    setLoading(true); setError(null);
    try { setPhases((await apiFetch<{ phases: Phase[] }>(`/api/admin/championships/${eventId}/award-preview`)).phases); }
    catch (cause) { fail(cause); } finally { setLoading(false); }
  }
  async function more() {
    if (!cursor) return; setLoading(true);
    try { const result = await apiFetch<{ grants: Grant[]; nextCursor: string | null }>(`/api/admin/awards?eventId=${encodeURIComponent(eventId)}&after=${encodeURIComponent(cursor)}`); setGrants(old => [...old, ...result.grants]); setCursor(result.nextCursor); }
    catch (cause) { fail(cause); } finally { setLoading(false); }
  }
  if (denied) return <p role="alert">Award access is no longer available. Refresh your session to check current permissions.</p>;
  return <section className="influence-panel space-y-4 rounded-xl p-5" aria-labelledby="championship-awards"><h3 id="championship-awards" className="text-lg font-semibold">Awards and corrections</h3>
    <p className="text-sm influence-copy-muted">Preview available allocations before activation. Champion allocations appear after results settle. Previewing does not grant badges or save allocations.</p>
    {error ? <p role="alert" className="text-red-300">{error}</p> : null}
    <button className={button} disabled={disabled || loading} onClick={() => void preview()}>Preview award allocations</button>
    {phases ? <div className="space-y-3">{phases.length === 0 ? <p>No allocation is available yet. Lock the field and verify the source season evidence.</p> : null}{phases.map(phase => <details key={phase.phase} className="rounded-lg border border-white/10 p-3"><summary>{phase.phase} · {phase.grants.length} awards · {phase.frozen ? phase.deliveredAt ? "Delivered" : "Frozen allocation" : "Preview only"}</summary><ul className="mt-3 space-y-2">{phase.grants.map((grant, index) => <li key={`${grant.definitionCode}:${grant.recipient.id}:${index}`} className="text-sm">{grant.definitionCode.replaceAll("-", " ")} · {grant.recipientName} ({grant.recipient.type})</li>)}</ul></details>)}<p className="text-sm influence-copy-muted">Unavailable phases await final source-season evidence or settled championship outcomes. Preview-only recipients may change before allocation is frozen.</p></div> : null}
    <h4 className="font-semibold">Issued badges for this event and its source season</h4>
    {grants.length ? <ul className="space-y-2">{grants.map(grant => <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3"><span>{grant.title} · {grant.recipientName} ({grant.recipientType}) · {grant.revokedAt ? "Revoked" : "Active"}</span><button className={button} disabled={disabled} onClick={() => setChosen(grant)}>Review badge</button></li>)}</ul> : <p className="text-sm influence-copy-muted">No badges have been issued.</p>}
    {cursor ? <button className={button} disabled={disabled || loading} onClick={() => void more()}>Load more badges</button> : null}
    {chosen ? <div className="space-y-3 rounded-lg border border-amber-200/30 p-4"><h4 className="font-semibold">{chosen.title} · {chosen.recipientName}</h4>
      <p className="text-sm">{chosen.revokedAt ? "Reinstating restores this same achievement and its original evidence." : "Revoking removes the public badge while retaining its evidence and history."}</p>
      {history ? <><ol className="space-y-2 text-sm">{history.audit.map(row => <li key={row.id}>{row.createdAt} · {row.action} · {row.reason}</li>)}</ol><details><summary>Original allocation evidence</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(history.grant.evidence, null, 2)}</pre></details></> : <p>Loading badge history…</p>}
      <label className="block">Reason for this correction<textarea className={input} disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className={button} disabled={disabled || !history || !reason.trim()} onClick={() => void run(chosen.revokedAt ? "Reinstate badge" : "Revoke badge", `/api/admin/awards/${chosen.id}/${chosen.revokedAt ? "reinstate" : "revoke"}`, { reason: reason.trim() })}>{chosen.revokedAt ? "Reinstate badge" : "Revoke badge"}</button>
    </div> : null}
  </section>;
}
