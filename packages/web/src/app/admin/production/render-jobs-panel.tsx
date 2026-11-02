"use client";
import {useState} from "react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {apiFetch} from "@/lib/api";
import {useAdminSession,useAdminValue,type Operation} from "../admin-session";
import type {RenderJobRow as Job} from "@/lib/render-jobs";
export function RenderJobsPanel({gameId}:{gameId:string}) {
  const session=useAdminSession(),[error,setError]=useState<string|null>(null);
  const url=`/api/admin/renders/jobs?gameId=${encodeURIComponent(gameId)}`;
  const [denied]=useAdminValue("access-denied:/api/admin/renders",false);
  const jobs=useQuery({queryKey:["admin",session.scope,url],enabled:!denied,queryFn:({signal})=>session.read<{jobs:Job[]}>(url,signal),
    refetchInterval:query=>query.state.data?.jobs.some(job=>!["succeeded","failed","cancelled"].includes(job.state))?15000:false,
    refetchIntervalInBackground:false});
  if(denied)return <p role="alert">Current producer access is required to view render jobs. <button onClick={()=>void jobs.refetch()}>Check access again</button></p>;
  return <section aria-label="Render jobs"><h3>Render jobs</h3>
    <button onClick={()=>void jobs.refetch()}>Refresh renders</button>
    <Link href="/admin/production/renders">View all render jobs →</Link>
    {jobs.error && <p role="alert">Render status could not be loaded.</p>}
    {error && <p role="alert">{error}</p>}
    {jobs.data?.jobs.length===0 && <p>No renders ordered for this game.</p>}
    <ul>{jobs.data?.jobs.map(job=><li key={job.id}>
      <strong>{job.workload==="trailer"?"Trailer":"Studio export"}</strong>{" · "}{job.state}{job.state==="rendering"?` · ${job.progress}%`:""}
      <br/><small>{job.id} · {new Date(job.createdAt).toLocaleString()}</small>
      {job.failure && <p>{job.failure}</p>}
      {job.state==="succeeded"&&job.workload==="studio-export"&&<RenderDownloadButton jobId={job.id} onError={setError}/>}
      <RenderJobActions job={job} refresh={()=>jobs.refetch()}/>
    </li>)}</ul>
  </section>;
}
export function RenderJobActions({job,refresh}:{job:Job;refresh:()=>Promise<unknown>}) {
  const session=useAdminSession(),[error,setError]=useState<string|null>(null);
  const action=["failed","cancelled"].includes(job.state)?"retry":"cancel",key=`operation:/api/admin/renders/${job.id}/${action}/${job.executionId}`;
  const [operation]=useAdminValue<Operation|undefined>(key,undefined);
  if(job.state==="succeeded"||job.failure==="renderer_unavailable"||action==="retry"&&job.workload!=="studio-export")return null;
  async function act() {
    setError(null);
    try {await session.execute(key,`/api/admin/renders/${job.id}/${action}`,action==="retry"?{executionId:job.executionId}:{});await refresh();}
    catch {setError("Render action could not be confirmed. Refresh status or retry the same action.");}
  }
  return <><button disabled={operation?.phase==="submitting"} onClick={()=>void act()}>{operation?.phase==="submitting"?"Updating…":action==="retry"?"Retry render":"Cancel render"}</button>{error&&<p role="alert">{error}</p>}</>;
}
export function RenderDownloadButton({jobId,onError}:{jobId:string;onError:(message:string)=>void}) {
  const session=useAdminSession();
  async function download() {
    try {
      const path=`/api/admin/renders/${jobId}/download`;
      const result=await session.read<{url:string}>(path,undefined,()=>apiFetch(path,{method:"POST"}));
      window.open(result.url,"_blank","noopener,noreferrer");
    }catch {onError("Download unavailable. Refresh to check current access and render status.");}
  }
  return <button onClick={()=>void download()}>Download video</button>;
}
