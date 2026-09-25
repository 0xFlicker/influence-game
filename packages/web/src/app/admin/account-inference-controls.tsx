"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
type Policy = {text:number;image:number;renewal:'none'|'monthly';textBurst:number;imageDaily:number;textConcurrency:number;imageConcurrency:number};
type Plan={id:string;name:string;version:number;policy:Policy};
type Details={account:{planId:string;textBalance:number;imageBalance:number;textGrant:number;imageGrant:number;paused:boolean;overrides:Partial<Policy>};policy:Policy;imageExempt:boolean;history:Record<string,unknown>[];pending:{id:string;state:string;category:string}[]};
export function AccountInferenceControls({userId}:{userId:string}) {
 const [data,setData]=useState<Details|null>(null),[plans,setPlans]=useState<Plan[]>([]),[sysop,setSysop]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState('');const pending=useRef<{key:string;id:string}|null>(null);
 const refresh=useCallback(async()=>{
  const [details,catalog]=await Promise.all([apiFetch<Details>(`/api/admin/inference/accounts/${encodeURIComponent(userId)}`),apiFetch<{plans:Plan[];sysop:boolean}>('/api/admin/inference/plans')]);
  setData(details);setPlans(catalog.plans);setSysop(catalog.sysop);
 },[userId]);
 useEffect(()=>{let active=true;
  Promise.all([apiFetch<Details>(`/api/admin/inference/accounts/${encodeURIComponent(userId)}`),apiFetch<{plans:Plan[];sysop:boolean}>('/api/admin/inference/plans')]).then(([d,p])=>{if(active){setData(d);setPlans(p.plans);setSysop(p.sysop);}}).catch(e=>{if(active)setError(e.message);});
  return ()=>{active=false;};
 },[userId]);
 async function command(body:Record<string,unknown>) {
  if(!reason.trim()) {setError('Enter a reason for this adjustment.');return;}
  const payload={...body,userId,reason};const key=JSON.stringify(payload);
  if(pending.current?.key!==key) pending.current={key,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try {await apiFetch('/api/admin/inference/actions',{method:'POST',body:JSON.stringify({...payload,actionId:pending.current.id})});pending.current=null;await refresh();}
  catch(e){setError(e instanceof Error?e.message:'Adjustment failed. Retry uses the same action ID.');}finally{setBusy(false);}
 }
 const inputClass='rounded border border-white/20 bg-black p-2';
 return <section className="space-y-4 rounded-xl border border-white/15 p-5"><h2 className="text-xl">Account controls</h2>
  {error&&<p role="alert" className="text-red-300">{error}</p>}
  {data&&<>
   <p>Available text: {data.account.textBalance} + {data.account.textGrant} granted · Images: {data.account.imageBalance} + {data.account.imageGrant} granted · Image exemption: {data.imageExempt?'Yes':'No'}</p>
   <label className="block">Adjustment reason <input className={`${inputClass} w-full`} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label>
   <fieldset disabled={busy} className="space-y-4">
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void command({kind:'grant',category:f.get('category'),amount:Number(f.get('amount'))});}}>
     <select className={inputClass} name="category" aria-label="Grant category"><option value="text">Text</option><option value="image">Images</option></select><input className={inputClass} name="amount" aria-label="Grant amount" type="number" min={1} max={1000000} defaultValue={25}/><button>Add allowance</button>
    </form>
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();void command({kind:'assign',planId:new FormData(e.currentTarget).get('plan')});}}>
     <select className={inputClass} name="plan" aria-label="Account plan" defaultValue={data.account.planId}>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button>Assign plan and refresh allowance</button>
    </form>
    <button className="rounded border border-white/20 px-4 py-2" onClick={()=>void command({kind:'pause',paused:!data.account.paused})}>{data.account.paused?'Resume generation':'Pause generation'}</button>
    <details><summary>Account overrides</summary><PolicyForm key={JSON.stringify(data.policy)} policy={data.policy} onSave={overrides=>void command({kind:'overrides',overrides})}/><button onClick={()=>void command({kind:'overrides',overrides:{}})}>Clear all overrides</button></details>
    {sysop&&<div className="flex gap-4"><button onClick={()=>void command({kind:'exemption',exempt:!data.imageExempt})}>Toggle image exemption</button><button onClick={()=>void command({kind:'exemption',exempt:null})}>Use role default exemption</button></div>}
    <details><summary>Edit plan policies (all assigned accounts)</summary>{plans.map(plan=><section key={`${plan.id}:${plan.version}`} className="my-4"><h3>{plan.name}</h3><PolicyForm policy={plan.policy} onSave={policy=>void command({kind:'plan_policy',planId:plan.id,version:plan.version,policy})}/></section>)}</details>
    <details><summary>Pending generations ({data.pending.length})</summary><p>Reconcile only after confirming the provider outcome. Failure refunds the reservation; success consumes it.</p>{data.pending.map(r=><div key={r.id} className="my-3 break-all">{r.id} · {r.category} · {r.state}<div className="flex gap-4"><button onClick={()=>void command({kind:'reconcile',reservationId:r.id,outcome:'failed'})}>Confirm failed / refund</button><button onClick={()=>void command({kind:'reconcile',reservationId:r.id,outcome:'succeeded'})}>Confirm success</button></div></div>)}</details>
   </fieldset>
   <details><summary>Adjustment history</summary>{data.history.map((entry,index)=><pre className="my-2 overflow-auto text-xs" key={index}>{JSON.stringify(entry,null,2)}</pre>)}</details>
  </>}
 </section>;
}
function PolicyForm({policy,onSave}:{policy:Policy;onSave:(p:Policy)=>void}) {
 return <form className="my-3 grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const p={...policy};for(const key of ['text','image','textBurst','imageDaily','textConcurrency','imageConcurrency'] as const)p[key]=Number(f.get(key));p.renewal=f.get('renewal') as Policy['renewal'];onSave(p);}}>
  {(['text','image','textBurst','imageDaily','textConcurrency','imageConcurrency'] as const).map(k=><label key={k}>{k}<input className="block w-full rounded border border-white/20 bg-black p-2" name={k} type="number" min={0} max={1000000} defaultValue={policy[k]}/></label>)}
  <label>Renewal<select className="block bg-black p-2" name="renewal" defaultValue={policy.renewal}><option value="none">None</option><option value="monthly">Monthly</option></select></label><button>Save policy</button>
 </form>;
}
