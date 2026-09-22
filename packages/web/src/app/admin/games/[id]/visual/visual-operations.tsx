"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, resolveApiUrl } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";

type Policy = "best_effort" | "require_visuals";
interface Failure { kind: string; name: string; message: string; stack?: string; responseBody?: string; truncated?: boolean }
interface VisualExport {
  gameId: string; gameStatus: string; policy: Policy; pause: { reason: string; boundarySequence: number } | null;
  assets: { status: string; failure: string | null } | null;
  rebuildPreview: { sceneId: string; roomId: string; boundarySequence: number; expectedRevision: number; previewHash: string;
    expectedParticipants: Array<{ id: string; name: string }>; sceneParticipants: Array<{ id: string; name: string }>; missingIds: string[]; extraIds: string[] } | null;
  rebuildError: string | null;
  contextFailures: Array<{ id: string; event: { boundarySequence: number | null; message: string }; evidence: { context?: { reason: string; sceneId: string | null; agentId: string; expectedParticipants: Array<{ id: string; name: string }>; sceneParticipants: Array<{ id: string; name: string }> } } | null }>;
  scenes: Array<{ id: string; roomId: string; boundarySequence: number; status: string; failure: string | null; imageArtifactId: string | null; candidateArtifactId: string | null; renderRevision: number; anchors: unknown[] | null }>;
  metrics: Array<{ provider: string; attempts: number; failed: number; uncertain: number; knownCostMicrousd: number; p50Ms: number | null; p95Ms: number | null }>;
  events: Array<{ id: string; event: { occurredAt: string; kind: string; outcome: string; message: string; operationId: string | null; sceneId: string | null; boundarySequence: number | null }; evidence: Failure | null }>;
  accounting: { knownCostMicrousd: number; unpricedAttempts: number; uncertainAttempts: number; attempts: Array<{ id: string; operationId: string; operationKey: string; generation: number; provider: string; model: string; imageHash: string | null; request: unknown; localization: unknown; costMicrousd: number | null; receipt: { status: number | null; requestId: string | null; elapsedMs: number; usage: unknown; chargeUncertain: boolean; failure?: Failure } | null; reconciliation: unknown }> };
}
const button = "rounded border border-white/25 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";
const money = (value: number | null) => value === null ? "Unpriced" : `$${(value / 1_000_000).toFixed(4)}`;
const seconds = (value: number | null) => value === null ? "—" : `${(value / 1000).toFixed(1)}s`;
function Evidence({ value }: { value: unknown }) {
  return <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-3 text-xs text-white/75">{JSON.stringify(value, null, 2)}</pre>;
}
function EvidenceImage({ gameId, id, kind }: { gameId: string; id: string; kind: "attempt" | "artifact" }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <div className="mt-3">
    <button className={button} disabled={busy} onClick={async () => {
      if (image) { setImage(null); return; }
      setBusy(true); setError(null);
      try { const result = await apiFetch<{ imageUrl: string }>(`/api/admin/games/${gameId}/visual/evidence/${kind}/${id}`); setImage(result.imageUrl); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Evidence unavailable"); }
      finally { setBusy(false); }
    }}>{busy ? "Loading evidence…" : image ? "Hide image" : "Inspect image"}</button>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated diagnostic image */}
    {image && <img src={image} alt="Generated image retained as diagnostic evidence" className="mt-3 w-full rounded object-contain" />}
  </div>;
}
export function VisualOperations({ gameId }: { gameId: string }) {
  const [data, setData] = useState<VisualExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const requestVersion = useRef(0);
  const { hasPermission } = usePermissions();
  const canOperate = hasPermission("start_game");
  const preparedRepair = data?.scenes.some((scene) => scene.boundarySequence === data.pause?.boundarySequence && scene.status === "preparing" && scene.renderRevision > 0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try { const result = await apiFetch<VisualExport>(`/api/admin/games/${gameId}/visual`); if (version === requestVersion.current) { setData(result); setError(null); } }
    catch (failure) { if (version === requestVersion.current) setError(failure instanceof Error ? failure.message : "Visual records unavailable"); }
  }, [gameId]);
  useEffect(() => {
    void refresh();
    const versionRef = requestVersion;
    return () => { versionRef.current++; };
  }, [refresh]);
  const control = async (body: Record<string, unknown>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await apiFetch(`/api/admin/games/${gameId}/visual/control`, { method: "POST", body: JSON.stringify(body) }); await refresh(); setNotice(message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Operation failed"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <Link href="/admin/games" className="text-sm text-white/50">← Games</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Visual production</h1><button className={button} onClick={() => void refresh()}>Refresh</button></div>
    {error && <p role="alert" className="rounded border border-red-400/30 p-3 text-red-300">{error}</p>}
    {notice && <p role="status" className="text-green-200">{notice}</p>}
    {!data ? <p role="status">Loading visual records…</p> : <>
      <section aria-label="Visual policy" className="space-y-3 rounded-xl border border-white/15 p-5">
        <p>Game: {data.gameStatus} · Assets: {data.assets?.status ?? "Not prepared"}</p>
        <label className="block">Failure policy <select aria-label="Visual failure policy" value={data.policy} disabled={!canOperate || busy} className="ml-3 rounded bg-neutral-900 p-2" onChange={(event) => void control({ action: "policy", policy: event.target.value }, "Policy saved. It applies at visual preparation boundaries.")}>
          <option value="best_effort">Best effort — continue with portraits</option><option value="require_visuals">Require visuals — pause for repair</option>
        </select></label>
        <p className="text-sm text-white/60">Both policies retain provider errors, verification evidence, timing and costs. Changing policy does not automatically resume a paused game.</p>
        {data.pause && <div className="space-y-3 border-t border-white/15 pt-3"><p className="text-amber-200">Paused at boundary {data.pause.boundarySequence}: {data.pause.reason}</p>
          {canOperate && <div className="flex flex-wrap gap-3">{data.assets?.status !== "ready" && <button className={button} disabled={busy} onClick={() => void control({ action: "repair_assets" }, "Asset repair prepared. Resume when ready to run it.")}>Prepare asset repair</button>}<button className={button} disabled={busy} onClick={() => void control({ action: "resume" }, "Resume queued for the game worker at the committed boundary.")}>Resume game</button></div>}
          <p className="text-sm text-white/60">Choose scene repairs below, then resume. Repairs may incur provider charges. Reconcile uncertain attempts first. To continue with portraits, select Best effort and resume.</p>
        </div>}
        {data.assets?.failure && <p className="text-amber-200">{data.assets.failure}</p>}
      </section>
      {data.pause && <section aria-label="Current visual problem" className="space-y-3 rounded-xl border border-amber-300/30 p-5">
        <h2 className="text-lg font-semibold">Current visual problem</h2>
        {data.rebuildPreview && (data.rebuildPreview.missingIds.length > 0 || data.rebuildPreview.extraIds.length > 0) ? <>
          <p className="text-amber-200">Finals participant mismatch: expected {data.rebuildPreview.expectedParticipants.length} people; scene contains {data.rebuildPreview.sceneParticipants.length}.</p>
          <p>Expected: {data.rebuildPreview.expectedParticipants.map((member) => member.name).join(", ")}</p>
          <p>In the image plan: {data.rebuildPreview.sceneParticipants.map((member) => member.name).join(", ")}</p>
          {data.rebuildPreview.extraIds.length > 0 && <p>Extra: {data.rebuildPreview.sceneParticipants.filter((member) => data.rebuildPreview!.extraIds.includes(member.id)).map((member) => member.name).join(", ")}</p>}
          <p className="text-sm text-white/60">The image was verified against the wrong cast. Rechecking or regenerating that plan will not correct it. Rebuild uses the eligible jury from committed game state, then Resume runs the new render. Provider charges apply when it runs.</p>
          {canOperate && <button className={button} disabled={busy} onClick={() => void control({ action: "repair_scene", mode: "rebuild", sceneId: data.rebuildPreview!.sceneId,
            expectedRevision: data.rebuildPreview!.expectedRevision, previewHash: data.rebuildPreview!.previewHash }, "Corrected Finals plan prepared. Resume game to render it and continue.")}>Rebuild scene from current game state</button>}
          <a className="block text-sm underline" href={`#scene-${data.rebuildPreview.sceneId}`}>View affected Finals scene</a>
        </> : <p>{preparedRepair ? "Scene repair is prepared. Resume game to render it and continue." : data.pause.reason}</p>}
        {data.rebuildError && <p className="text-sm text-amber-200">{data.rebuildError}</p>}
        {(data.contextFailures ?? []).filter((row) => row.event.boundarySequence === data.pause!.boundarySequence).map((row) => <details key={row.id}><summary>Agent context: {row.evidence?.context?.reason ?? row.event.message}</summary><Evidence value={row.evidence?.context} /></details>)}
      </section>}
      <section aria-label="Provider performance" className="overflow-x-auto rounded-xl border border-white/15 p-5">
        <p className="mb-4">Known spend: {money(data.accounting.knownCostMicrousd)} · {data.accounting.unpricedAttempts} unpriced · {data.accounting.uncertainAttempts} uncertain</p>
        <table className="w-full text-left text-sm"><thead><tr>{["Provider", "Attempts", "Provider failures", "Uncertain", "P50", "P95", "Known cost"].map((label) => <th key={label} className="pb-3 pr-4">{label}</th>)}</tr></thead><tbody>{data.metrics.map((metric) => <tr key={metric.provider}><td>{metric.provider}</td><td>{metric.attempts}</td><td>{metric.failed}</td><td>{metric.uncertain}</td><td>{seconds(metric.p50Ms)}</td><td>{seconds(metric.p95Ms)}</td><td>{money(metric.knownCostMicrousd)}</td></tr>)}</tbody></table>
        <button className={`${button} mt-4`} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${gameId}-visual-production.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export production records</button>
      </section>
      <h2 className="text-lg font-semibold">Scenes and verification</h2>
      <div className="grid gap-4 md:grid-cols-2">{data.scenes.map((scene) => <article id={`scene-${scene.id}`} key={scene.id} className="overflow-hidden rounded-xl border border-white/15">
        {/* eslint-disable-next-line @next/next/no-img-element -- immutable accepted artifact */}
        {scene.status === "ready" && scene.imageArtifactId && <img src={resolveApiUrl(`/api/games/${data.gameId}/visual/artifacts/${scene.imageArtifactId}`)} alt={`${scene.roomId}, scene ${scene.boundarySequence}`} className="aspect-video w-full object-contain" />}
        <div className="space-y-2 p-4"><p>{scene.roomId} · boundary {scene.boundarySequence} · revision {scene.renderRevision}</p><p>{scene.status === "ready" ? "Image verified" : scene.status} · {scene.anchors?.length ?? 0} verified anchors</p>{scene.failure && <p className="text-sm text-amber-200">{scene.failure}</p>}
          {scene.candidateArtifactId && <EvidenceImage key={scene.candidateArtifactId} gameId={gameId} id={scene.candidateArtifactId} kind="artifact" />}
          {data.rebuildPreview?.sceneId === scene.id && (data.rebuildPreview.extraIds.length > 0 || data.rebuildPreview.missingIds.length > 0) ? <p className="text-amber-200">Agent context unavailable: participant mismatch. Rebuild the plan above.</p> : data.pause && canOperate && scene.status !== "preparing" && <div className="flex flex-wrap gap-2">{scene.candidateArtifactId && <button className={button} disabled={busy} onClick={() => void control({ action: "repair_scene", sceneId: scene.id, expectedRevision: scene.renderRevision, mode: "verify" }, "Verification repair prepared; resume to run it.")}>Recheck existing image</button>}<button className={button} disabled={busy} onClick={() => void control({ action: "repair_scene", sceneId: scene.id, expectedRevision: scene.renderRevision, mode: "regenerate" }, "New render authorized; resume to run it.")}>Regenerate scene</button></div>}
        </div>
      </article>)}</div>
      <h2 className="text-lg font-semibold">Operational timeline</h2>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures and degraded presentation only</label>
      <div className="space-y-2">{data.events.filter((row) => !failuresOnly || ["failed", "uncertain", "portraits", "unanchored", "paused"].includes(row.event.outcome)).map((row) => <details key={row.id} className="rounded border border-white/15 p-3"><summary className="cursor-pointer text-sm">{row.event.occurredAt} · {row.event.kind} · {row.event.outcome} — {row.event.message}</summary><Evidence value={{ event: row.event, evidence: row.evidence }} /></details>)}</div>
      <h2 className="text-lg font-semibold">Provider attempts</h2>
      {data.accounting.attempts.map((attempt) => <article key={attempt.id} className="rounded-xl border border-white/15 p-4">
        <p>{attempt.provider} · {attempt.model} · {money(attempt.costMicrousd)} · {seconds(attempt.receipt?.elapsedMs ?? null)} · HTTP {attempt.receipt?.status ?? "unknown"}</p>
        <p className="mt-1 break-all text-xs text-white/50">{attempt.operationKey} · generation {attempt.generation}</p>
        {attempt.receipt?.failure && <p className="mt-2 text-amber-200">{attempt.receipt.failure.kind}: {attempt.receipt.failure.message}</p>}
        <details className="mt-3"><summary className="cursor-pointer text-sm">Request, receipt and verification evidence</summary><Evidence value={attempt} /></details>
        {attempt.imageHash && <EvidenceImage gameId={gameId} id={attempt.id} kind="attempt" />}
        {!attempt.reconciliation && (!attempt.receipt || attempt.receipt.chargeUncertain) && canOperate && <form className="mt-3 flex flex-wrap gap-3" onSubmit={async (event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget); setError(null); setBusy(true);
          try { await apiFetch(`/api/admin/games/${gameId}/visual/attempts/${attempt.id}/reconcile`, { method: "POST", body: JSON.stringify({ note: String(form.get("note")), costMicrousd: Math.round(Number(form.get("cost")) * 1_000_000) }) }); await refresh(); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Reconciliation failed"); }
          finally { setBusy(false); }
        }}><input name="note" aria-label="Reconciliation evidence" required placeholder="Provider receipt or billing evidence" className="min-w-48 flex-1 rounded bg-white/10 px-3 py-2" /><input name="cost" aria-label="Confirmed cost in dollars" required type="number" min="0" step="0.000001" placeholder="USD" className="w-32 rounded bg-white/10 px-3 py-2" /><button disabled={busy} className={button}>Record reconciliation</button></form>}
      </article>)}
    </>}
  </div>;
}
