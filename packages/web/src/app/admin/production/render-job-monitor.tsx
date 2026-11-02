"use client";
import {Fragment,useState,type FormEvent} from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useQuery} from "@tanstack/react-query";
import {usePermissions} from "@/hooks/use-permissions";
import {useAdminSession,useAdminValue} from "../admin-session";
import {RenderDownloadButton,RenderJobActions} from "./render-jobs-panel";
import {renderStateLabels,renderFailureLabels,type RenderMonitorPage,type RenderJobRow} from "@/lib/render-jobs";
import styles from "./render-job-monitor.module.css";

const route="/admin/production/renders";
export function RenderJobMonitor() {
  const session=useAdminSession(),params=useSearchParams(),{roles}=usePermissions();
  const allowed=roles.includes("producer")||roles.includes("sysop");
  const [denied]=useAdminValue("access-denied:/api/admin/renders",false);
  const [error,setError]=useState<string|null>(null);
  const status=params.get("status")??"all",workload=params.get("workload")??"",gameId=params.get("gameId");
  const query=new URLSearchParams(params);query.set("limit","25");
  const url=`/api/admin/renders/jobs?${query}`;
  const jobs=useQuery({queryKey:["admin",session.scope,url],enabled:allowed&&!denied,queryFn:({signal})=>session.read<RenderMonitorPage>(url,signal),
    retry:false,refetchInterval:15000,refetchIntervalInBackground:false});
  function change(values:Record<string,string|null>) {
    const next=new URLSearchParams(window.location.search);next.delete("cursor");
    for(const [key,value] of Object.entries(values))if(value&&value!=="all")next.set(key,value);else next.delete(key);
    // This page's data is client-fetched. Next's native-history integration keeps
    // useSearchParams in sync and lets rapid changes merge against the current URL.
    window.history.replaceState(null,"",`${route}${next.size?`?${next}`:""}`);
  }
  function search(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();change({search:String(new FormData(event.currentTarget).get("search")??"").trim()||null});
  }
  async function refresh() {
    setError(null);
    if(params.has("cursor")){change({});return;}
    await jobs.refetch();
  }
  const data=denied?undefined:jobs.data,filtered=!!(params.get("status")||workload||gameId||params.get("search"));
  const next=new URLSearchParams(params);if(data?.nextCursor)next.set("cursor",data.nextCursor);
  const scopeName=data?.jobs.find(job=>job.gameId===gameId)?.game.title??data?.jobs.find(job=>job.gameId===gameId)?.game.slug??gameId;
  if(!allowed)return <p role="alert">Current Producer or Sysop access is required to view render jobs.</p>;
  return <section className={styles.monitor} aria-label="Global render monitor">
    <header className={styles.header}>
      <div><p className={styles.breadcrumb}><Link href="/admin/production">Production library</Link><span aria-hidden="true"> / </span>Render jobs</p>
        <h1>Render jobs</h1><p className={styles.subtitle}>Trailers and Studio exports, across every game.</p></div>
      <div className={styles.refresh}><span>{jobs.dataUpdatedAt?`Updated ${new Date(jobs.dataUpdatedAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`:"Waiting for status"}<small>Refreshes every 15 seconds while visible</small></span>
        <button onClick={()=>void refresh()} disabled={jobs.isFetching}>{jobs.isFetching?"Refreshing…":"Refresh"}</button></div>
    </header>
    {denied?<div role="alert" className={styles.alert}>Producer access changed. Render details have been hidden. <button onClick={()=>void refresh()}>Check access again</button></div>:<>
      <div className={styles.metrics} aria-label="Render job summary">
        {[{label:"Active",value:data?.summary.active,filter:"active",note:"Waiting, rendering or verifying",tone:"active"},
          {label:"Failed",value:data?.summary.failed,filter:"failed",note:"Review before retrying",tone:"failed"},
          {label:"Completed",value:data?.summary.succeeded,filter:"succeeded",note:"Verified outputs",tone:"complete"}].map(metric=><button key={metric.label} className={styles.metric} data-tone={metric.tone} aria-pressed={status===metric.filter} onClick={()=>change({status:metric.filter})}>
            <span>{metric.label}</span><strong>{metric.value??"—"}</strong><small>{metric.note}</small></button>)}
      </div>
      <form className={styles.filters} onSubmit={search} aria-label="Filter render jobs">
        <label>Status<select aria-label="Render status" value={status} onChange={e=>change({status:e.target.value})}>
          <option value="all">All statuses</option><option value="active">Active jobs</option>{Object.entries(renderStateLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Output type<select aria-label="Render output type" value={workload} onChange={e=>change({workload:e.target.value})}><option value="">All output types</option><option value="studio-export">Studio exports</option><option value="trailer">Trailers</option></select></label>
        <label className={styles.search}>Game or job<input key={params.get("search")??""} name="search" aria-label="Search render jobs" type="search" placeholder="Game title, slug or job ID" defaultValue={params.get("search")??""} maxLength={200}/></label>
        <button type="submit">Search</button>{filtered&&<Link className={styles.reset} href={route}>Clear filters</Link>}
      </form>
      {gameId&&<p className={styles.scope}>Game: <strong>{scopeName}</strong><button onClick={()=>change({gameId:null})}>Show all games</button></p>}
      <div className={styles.listHeading}><h2>{status==="all"?"All render jobs":status==="active"?"Active render jobs":`${renderStateLabels[status]??"Filtered"} render jobs`}</h2>
        <p>{data?`${data.summary.matching} ${data.summary.matching===1?"job":"jobs"}${params.has("cursor")?" · older page":" · active first, newest first"}`:"Loading status…"}</p></div>
      {(jobs.error||error)&&<p role="alert" className={styles.alert}>{error??"Render status could not be refreshed. Try Refresh; any visible rows are the last loaded results."}</p>}
      {!data&&!jobs.error&&<p className={styles.empty} role="status">Loading render jobs…</p>}
      {data?.jobs.length===0&&<div className={styles.empty}><h3>{filtered?"No jobs match these filters":"No render jobs yet"}</h3><p>{filtered?"Try another status or game, or clear the filters.":"Open an episode in Studio to order its first cloud export."}</p><Link href={filtered?route:"/admin/production"}>{filtered?"Clear filters":"Open Production library"} →</Link></div>}
      {!!data?.jobs.length&&<table className={styles.table}><thead><tr><th>Game</th><th>Output</th><th>Status</th><th>Ordered</th><th>Actions</th></tr></thead>
        <tbody>{data.jobs.map(job=><RenderMonitorRow key={job.id} job={job} refresh={()=>jobs.refetch()} onError={setError}/>)}</tbody></table>}
      {data&&<footer className={styles.footer}><p>Studio outputs are private. Download links are issued only after verification.</p><div>{params.has("cursor")&&<button onClick={()=>change({})}>Back to newest</button>}{data.nextCursor&&<Link href={`${route}?${next}`}>Next page →</Link>}</div></footer>}
    </>}
  </section>;
}

function RenderMonitorRow({job,refresh,onError}:{job:RenderJobRow;refresh:()=>Promise<unknown>;onError:(message:string)=>void}) {
  const [expanded,setExpanded]=useState(false),[copied,setCopied]=useState(false);
  const title=job.game.title??job.game.slug,state=renderStateLabels[job.state]??job.state;
  const failed=job.failure?(renderFailureLabels[job.failure]??job.failure.replaceAll("_"," ")):null;
  async function copy() {try {await navigator.clipboard.writeText(job.id);setCopied(true);}catch {onError("Clipboard unavailable. Select the full job ID in Details to copy it.");}}
  return <Fragment><tr data-render-job-id={job.id} data-state={job.state}>
    <td data-label="Game"><Link className={styles.game} href={`/admin/production/games/${encodeURIComponent(job.gameId)}`}>{title}</Link><span className={styles.secondary}>{job.game.kind==="werewolf"?"Werewolf":"Influence"} · {job.game.slug}</span>
      <Link className={styles.scopeLink} href={`${route}?gameId=${encodeURIComponent(job.gameId)}`}>Jobs for this game →</Link></td>
    <td data-label="Output"><strong>{job.workload==="trailer"?"Trailer":"Studio export"}</strong><span className={styles.secondary}>{job.workload==="trailer"?"Public trailer":"Private output"} · {job.requester}</span><code className={styles.shortId} title={job.id}>{job.id.slice(0,8)}</code></td>
    <td data-label="Status"><span className={styles.badge} data-state={job.state}><i aria-hidden="true"/>{state}</span>
      {job.state==="rendering"&&job.progress>0&&<div className={styles.progress}><progress max="100" value={job.progress} aria-label={`Render progress for ${title}`}/><span>{job.progress}%</span></div>}
      {failed&&<span className={styles.failure}>{failed}</span>}</td>
    <td data-label="Ordered"><time dateTime={new Date(job.createdAt).toISOString()} title={new Date(job.createdAt).toLocaleString()}>{new Date(job.createdAt).toLocaleDateString([],{month:"short",day:"numeric"})}<span className={styles.secondary}>{new Date(job.createdAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</span></time></td>
    <td data-label="Actions"><div className={styles.actions}>{job.state==="succeeded"&&job.workload==="studio-export"&&<RenderDownloadButton jobId={job.id} onError={onError}/>}<RenderJobActions job={job} refresh={refresh}/>
      <button aria-expanded={expanded} aria-controls={`render-details-${job.id}`} onClick={()=>setExpanded(value=>!value)}>{expanded?"Hide details":"Details"}</button></div></td>
  </tr>{expanded&&<tr className={styles.detailRow} id={`render-details-${job.id}`}><td colSpan={5}><div role="region" aria-label={`Render details for ${title}`} className={styles.details}>
    <div className={styles.detailHeading}><strong>Render details</strong><button onClick={()=>void copy()}>{copied?"Job ID copied":"Copy job ID"}</button></div>
    <dl><div><dt>Job ID</dt><dd><code>{job.id}</code></dd></div><div><dt>Execution ID</dt><dd><code>{job.executionId}</code></dd></div>
      <div><dt>Attempts started</dt><dd>{job.attempt}</dd></div><div><dt>Last update</dt><dd>{new Date(job.updatedAt).toLocaleString()}</dd></div>
      <div className={styles.wide}><dt>Renderer</dt><dd><code>{job.rendererDigest}</code></dd></div>
      {job.output?.sha256&&<div className={styles.wide}><dt>Verified output</dt><dd>{job.output.byteLength?.toLocaleString()} bytes · <code>{job.output.sha256}</code></dd></div>}
      {job.failure&&<div className={styles.wide}><dt>Failure</dt><dd>{failed} <code>({job.failure})</code></dd></div>}
    </dl><Link href={`${route}?search=${encodeURIComponent(job.id)}`}>Open monitor link for this job →</Link>
  </div></td></tr>}</Fragment>;
}
