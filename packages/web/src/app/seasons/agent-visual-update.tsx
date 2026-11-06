"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./seasons.module.css";
import { getAgentVisualUpdate, startAgentVisualUpdate, type AgentVisualUpdate, type SavedAgent } from "@/lib/api";

const stages = {details:"Preparing appearance…",body:"Creating full-body image…",head:"Locating head…",portrait:"Preparing portrait…",saving:"Saving update…"};
const active = (state: AgentVisualUpdate | null) => Boolean(state?.job && ["queued","processing"].includes(state.job.status));
export function AgentVisualUpdateControl({agent,onComplete}: {agent:SavedAgent;onComplete:()=>void}) {
  const [state,setState] = useState<AgentVisualUpdate|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [actionError,setActionError] = useState<string|null>(null);
  const [starting,setStarting] = useState(false);
  const [reload,setReload] = useState(0);
  const callback = useRef(onComplete);
  const completed = useRef<string|null>(null);
  const posting = useRef(false);
  const requestEpoch = useRef(0);
  useEffect(()=>{callback.current=onComplete;},[onComplete]);
  useEffect(()=>{
    let disposed=false;
    let timer:ReturnType<typeof setTimeout>;
    let reading=false;
    const read = async()=>{
      if(reading)return;
      reading=true;clearTimeout(timer);
      const epoch=requestEpoch.current;
      try {
        const next=await getAgentVisualUpdate(agent.id);
        if(disposed || epoch!==requestEpoch.current)return;
        if (!posting.current) setState(next);
        setError(null);
        if(next.job?.status==="completed" && completed.current!==next.job.id) {completed.current=next.job.id;callback.current();}
        if(active(next) || next.job?.status==="held") timer=setTimeout(()=>void read(),2000);
      } catch {if(!disposed && epoch===requestEpoch.current){setError("Could not check the update. Reconnecting…");timer=setTimeout(()=>void read(),5000);}}
      finally{reading=false;}
    };
    void read();
    const reconnect=()=>void read();window.addEventListener("online",reconnect);
    return()=>{disposed=true;clearTimeout(timer);window.removeEventListener("online",reconnect);};
  },[agent.id,reload]);
  async function update() {
    if(posting.current)return;
    ++requestEpoch.current;posting.current=true;setStarting(true);setActionError(null);
    try {setState(await startAgentVisualUpdate(agent.id));}
    catch(err){setActionError(err instanceof Error ? err.message : "Could not start the update.");}
    finally{posting.current=false;setStarting(false);setReload(value=>value+1);}
  }
  const needsUpdate=state?.needsUpdate ?? (!agent.avatarUrl || !agent.fullBodyReferenceUrl || !agent.visualDesign?.trim() || !agent.performanceInstructions?.trim());
  const working=starting || active(state);
  const held=state?.job?.status==="held";
  const rejected=state?.job?.errorCode==="review_rejected";
  return <div>
    {working ? <p role="status" aria-live="polite"><span className={styles.updateSpinner} aria-hidden="true"/> {starting || state?.job?.status==="queued" ? "Starting update…" : stages[state!.job!.stage]}</p>
      : held ? <p role="status">Update saved · awaiting review</p>
      : needsUpdate && !rejected ? <button type="button" onClick={()=>void update()} disabled={!state}>{state?.job && ["failed","conflict"].includes(state.job.status) ? "Retry update" : "Update"}</button>
      : <Link href={`/dashboard/agents/${agent.id}/edit`}>Edit agent</Link>}
    {!working && state?.job?.message && <p role="status">{state.job.message}</p>}
    {(actionError || error) && <p role="alert">{actionError || error}</p>}
  </div>;
}
