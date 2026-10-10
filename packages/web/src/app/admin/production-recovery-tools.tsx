"use client";
import { usePermissions } from "@/hooks/use-permissions";
import { VisualFailurePolicyControl } from "./visual-failure-policy-control";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminRead, useAdminSession, useAdminValue, type Operation } from "./admin-session";

import { useEffect, useRef, useState } from "react";
import type { MediaAttempt } from "./games/[id]/visual/scene-repair-panel";


const root = "/api/admin/production/games";
const button = "influence-button-secondary min-h-10 rounded-lg px-3 py-2 text-sm disabled:opacity-40";

/** Exact-request owner for the studio's missing-scene inspector. */
export function useMissingProductionScene(gameId: string, refresh: () => Promise<void>) {
  const session = useAdminSession(), client = useQueryClient();
  const resource = `${root}/${gameId}/visual`, key = `operation:${resource}/missing`;
  const [operation] = useAdminValue<Operation | undefined>(key, undefined);
  const render = async (scene?: {key: string; previewHash: string}) => {
    const body = operation?.phase === "unknown" ? operation.body : scene ? {key: scene.key, previewHash: scene.previewHash, requestId: crypto.randomUUID()} : null;
    if (!body) return;
    await session.execute(key, `${resource}/missing`, body);
    await client.invalidateQueries({queryKey: ["admin", session.scope, `/api/admin/werewolf/${gameId}/costs`]});
    await refresh();
  };
  return {operation, render};
}

export type ProductionRecovery = {
  gameId:string;status:string;nextOffset:number|null;unresolvedForm:boolean;
  recovery:{pauseId:string;reason:string;kind:"scene"|"form";playerName?:string;policy:"best_effort"|"require_visuals"}|null;
  formJob:{id:string;status:string;step:string;failure:string|null}|null;
  attempts:Array<MediaAttempt & {provider:string;model:string}>;
};

/** Scene repair lives in the inspector; these controls retain game-owned recovery. */
export function GameProductionRecovery({gameId}:{gameId:string}) {
  const session=useAdminSession(),client=useQueryClient(),{hasPermission}=usePermissions();
  const resource=`${root}/${gameId}/visual`,key=`operation:${resource}/recovery`;
  const [operation]=useAdminValue<Operation|undefined>(key,undefined);
  const [offset,setOffset]=useState(0),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState<string|null>(null);
  const url=`${root}/${gameId}/recovery?limit=25&offset=${offset}`;
  const {data,error,denied,refresh}=useAdminRead<ProductionRecovery>(url);
  const recovery=data?.recovery;
  const busy=operation?.phase==="submitting" || Boolean(data?.formJob && ["queued","rendering","verifying"].includes(data.formJob.status));
  const unknown=operation?.phase==="unknown",resumed=operation?.phase==="accepted" && operation.body.action==="resume";
  useEffect(()=>{if (!busy) return;const timer=setInterval(()=>void refresh(),3000);return ()=>clearInterval(timer);},[busy,refresh]);
  async function act(action:"policy"|"resume"|"forms",policy?:"best_effort"|"require_visuals") {
    if(!recovery) return;
    const body=action==="forms" ? {pauseId:recovery.pauseId,requestId:crypto.randomUUID()} : action==="policy" ? {action,policy} : {action};
    try {
      await session.execute(key,`${resource}/${action==="forms" ? "forms" : "control"}`,body,false);
      await client.invalidateQueries({queryKey:["admin",session.scope,`/api/admin/werewolf/${gameId}`]});await refresh();
    } catch { /* Session retains rejection and unknown outcomes. */ }
  }
  async function check() {
    if(!operation || !unknown || checking) return;
    setChecking(true);setCheckError(null);
    try {
      const saved=await session.read<ProductionRecovery>(url);
      if(session.get(key)!==operation) return;
      const accepted=operation.body.action==="resume" ? ["in_progress","completed"].includes(saved.status) : operation.body.action==="policy" ? saved.recovery?.policy===operation.body.policy : Boolean(saved.formJob && saved.formJob.id===operation.body.requestId && saved.recovery?.pauseId===operation.body.pauseId);
      if(accepted) session.set<Operation>(key,{...operation,phase:"accepted",error:undefined});
      else if("pauseId" in operation.body) await session.execute(key,operation.url,operation.body);
      else session.set<Operation>(key,{...operation,phase:"rejected",error:"No saved change is recorded. Review the current state before trying again."});
      await refresh();
    } catch(cause) {setCheckError(cause instanceof Error ? cause.message : "Saved recovery state unavailable");}
    finally {setChecking(false);}
  }
  if(denied) return <p role="alert">Production access is no longer available. {error}</p>;
  return <section id="game-production-recovery" aria-label="Game production recovery" className="space-y-4">
    <button className={button} onClick={()=>void refresh()}>Refresh recovery</button>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Loading recovery and receipt page…</p>}
    {resumed ? <p role="status">Resume accepted. The preview retains its pinned accepted prefix. <a href={`/admin/werewolf/${gameId}`}>Open game operations</a></p>
      : recovery && <section aria-label="Visual recovery" className="space-y-3 rounded-lg border border-amber-300/40 p-4"><h3>Paused for visuals</h3><p>{recovery.reason}</p>
        <VisualFailurePolicyControl value={recovery.policy} disabled={busy||unknown||!hasPermission("start_game")} onChange={policy=>void act("policy",policy)} />
        {recovery.kind==="form" ? <><p>Wolf form for {recovery.playerName}</p>{data.formJob && <p role="status">{data.formJob.step} · {data.formJob.status}{data.formJob.failure ? `: ${data.formJob.failure}` : ""}</p>}
          <button className={button} disabled={busy||unknown||data.formJob?.status==="ready"||data.unresolvedForm} onClick={()=>void act("forms")}>Repair wolf form</button><p>Creates a verified reusable form. Provider charges may apply.</p></> : <p>Repair and publish in the scene inspector, then resume. To continue with portraits, choose Best effort and resume.</p>}
        {hasPermission("start_game") && <button className={button} disabled={busy||unknown} onClick={()=>void act("resume")}>Resume game</button>}
      </section>}
    {(operation?.error||checkError) && <p role="alert">{checkError??operation?.error}</p>}{unknown && <button className={button} disabled={checking} onClick={()=>void check()}>Check saved request</button>}
    {data && <section className="space-y-3"><h3>Game provider receipts</h3><p>Scene receipts are in the scene inspector. These receipts cover forms and other game production requests.</p>
      {data.attempts.map(attempt=><details key={attempt.id}><summary>{attempt.provider} · {attempt.model} · {attempt.status} · {attempt.costMicrousd===null ? "Cost unknown" : `$${(attempt.costMicrousd/1_000_000).toFixed(4)}`}</summary>
        <p>{attempt.status==="pending" ? "Request in progress; waiting for the provider receipt." : `HTTP ${attempt.receipt?.status??"unknown"} · ${attempt.status}`}</p>
        {attempt.receipt?.failure && <p>{attempt.receipt.failure.kind}: {attempt.receipt.failure.message}</p>}
        {attempt.status==="needs_reconciliation" && <ReconcileAttempt gameId={gameId} attemptId={attempt.id} refresh={async()=>{await refresh();}} readAttempt={async()=> (await session.read<ProductionRecovery>(url)).attempts.find(row=>row.id===attempt.id)} />}
      </details>)}
      <div className="flex gap-3">{offset>0 && <button onClick={()=>setOffset(Math.max(0,offset-25))}>Newer receipts</button>}{data.nextOffset!==null && <button onClick={()=>setOffset(data.nextOffset!)}>Older receipts</button>}</div>
    </section>}
  </section>;
}

export function ReconcileAttempt({ gameId, attemptId, refresh, readAttempt, apiPrefix = root }: { gameId: string; attemptId: string; refresh: () => Promise<void>; readAttempt?: () => Promise<MediaAttempt | undefined>; apiPrefix?: string }) {
  const session = useAdminSession(), client = useQueryClient();
  const resource = `${apiPrefix}/${gameId}/visual`, key = `operation:${resource}/reconcile:${attemptId}`;
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
      const attempt = readAttempt ? await readAttempt() : (await session.read<ProductionRecovery>(`${root}/${gameId}/recovery`)).attempts.find(candidate => candidate.id === attemptId);
      if (!session.active || session.get(key) !== checked) return;
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

