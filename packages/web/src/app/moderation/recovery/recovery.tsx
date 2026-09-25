"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
type Inventory = { resolved: { id: string; name: string; version: number; disposition: string }[]; archived: { id: string; name: string; version: number; archivedAt: string }[]; nextOffset: number | null };
export function Recovery() {
  const [data, setData] = useState<Inventory | null>(null);
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    apiFetch<Inventory>(`/api/moderation/recovery?offset=${offset}`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [offset]);
  async function recover(kind: "reopen" | "restore", id: string, version: number) {
    if (pending.current || !reason.trim()) return;
    pending.current = true; setBusy(true); setError(null); setReceipt(null);
    try {
      await apiFetch(`/api/moderation/${kind === "reopen" ? "reviews" : "profiles"}/${id}/${kind}`, { method: "POST", body: JSON.stringify({ ...(kind === "reopen" ? { actionId: crypto.randomUUID() } : {}), version, reason }) });
      setReceipt(kind === "reopen" ? "Review reopened. Claim it in the inbox to review its disposition." : "Archive removed. Moderation restrictions and queue enrollment are unchanged.");
      setData(await apiFetch<Inventory>(`/api/moderation/recovery?offset=${offset}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery failed"); }
    finally { pending.current = false; setBusy(false); }
  }
  const button = "influence-button-secondary min-h-11 rounded-lg px-4 text-sm disabled:opacity-40";
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-8"><Link href="/moderation" className="influence-link">← Moderation inbox</Link><h1 className="text-3xl font-semibold">Admin recovery</h1><p className="text-sm text-white/60">Reopen a resolved review for a new decision, or restore an archived character. Restoring an archive does not approve its content.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}{receipt && <p role="status">{receipt}</p>}
    <label className="block">Recovery reason<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} className="mt-2 block w-full rounded-lg border border-border-active bg-surface-raised p-3" /></label>
    <section><h2 className="mb-3 text-xl font-semibold">Archived characters</h2>{data?.archived.length === 0 && <p>No archived characters.</p>}{data?.archived.map(item => <div key={item.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-active p-4"><span>{item.name}</span><button className={button} disabled={busy || !reason.trim()} onClick={() => void recover("restore", item.id, item.version)}>Restore archive</button></div>)}</section>
    <section><h2 className="mb-3 text-xl font-semibold">Resolved reviews</h2>{data?.resolved.length === 0 && <p>No resolved reviews.</p>}{data?.resolved.map(item => <div key={item.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-active p-4"><Link href={`/moderation?review=${encodeURIComponent(item.id)}`} className="influence-link">{item.name} · {item.disposition} — View review</Link><button className={button} disabled={busy || !reason.trim()} onClick={() => void recover("reopen", item.id, item.version)}>Reopen review</button></div>)}</section>
    <div className="flex gap-3"><button className={button} disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><button className={button} disabled={busy || data?.nextOffset == null} onClick={() => setOffset(data!.nextOffset!)}>Next</button></div>
  </main>;
}
