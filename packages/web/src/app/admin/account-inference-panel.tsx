"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AccountInferenceControls } from "./account-inference-controls";
import { apiFetch } from "@/lib/api";
type Summary = { id?: string; label?: string; operation_id?: string; kind?: string; model?: string; text_requests: number; images: number; attempts: number; failures: number; actual_microusd: number; estimated_microusd: number; unpriced: number; last_activity: string | null };
type Account = Summary & { id: string; label: string };
type Operation = Summary & { operation_id: string; kind: string; model: string };
type Usage = { accounts?: Account[]; summary?: Summary; operations?: Operation[]; attempts?: Record<string, unknown>[]; nextOffset: number | null; coverage: string; asOf: string };
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(value / 1_000_000);
export function AccountInferencePanel() {
  const query = useSearchParams(); const router = useRouter();
  const [data,setData] = useState<Usage | null>(null); const [error,setError] = useState('');
  const key = query.toString();
  useEffect(() => {
    let active = true;
    apiFetch<Usage>(`/api/admin/inference/usage?${key}`).then(value => { if(active) { setData(value); setError(''); } }).catch(e => { if(active) setError(e.message); });
    return () => { active = false; };
  },[key]);
  function navigate(changes: Record<string,string>) {
    const next = new URLSearchParams(key); next.delete('offset');
    for (const [name,value] of Object.entries(changes)) { if(value) next.set(name,value); else next.delete(name); }
    router.push(`/admin/inference?${next}`);
  }
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-semibold">Account inference</h1><p className="text-sm text-white/60">Account-triggered spend. <Link className="underline" href="/admin/games">Game spending is reported separately.</Link></p></div>
    <div className="flex flex-wrap gap-3">
      <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); navigate({search: String(form.get('search') ?? '')}); }}><input name="search" aria-label="Search accounts" placeholder="Search accounts" defaultValue={query.get('search') ?? ''} className="rounded border border-white/20 bg-black p-2"/><button className="p-2">Search</button></form>
      <select aria-label="Usage window" value={query.get('window') ?? '30d'} onChange={e => navigate({window:e.target.value})} className="rounded bg-black p-2">{['24h','7d','30d','all'].map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label="Sort accounts" value={query.get('sort') ?? 'spend'} onChange={e => navigate({sort:e.target.value})} className="rounded bg-black p-2">{['spend','text','images','attempts','failures','activity'].map(v => <option key={v}>{v}</option>)}</select>
      {query.get('userId') && <button onClick={() => navigate({userId:'',operationId:''})}>All accounts</button>}
    </div>
    {query.get("userId") && <AccountInferenceControls key={query.get("userId")!} userId={query.get("userId")!} />}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!data && !error && <p>Loading usage…</p>}
    {data && <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Account / operation','Total priced USD','Actual USD','Estimated USD','Unpriced attempts','Text','Images','Attempts','Failures','Last activity'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>
        {(data.accounts ?? data.operations ?? (data.summary ? [data.summary] : [])).map((row,index) => <tr key={row.id ?? row.operation_id ?? index} className="border-t border-white/10">
          <td className="p-3">{row.id ? <button className="text-indigo-300" onClick={() => navigate({userId:row.id!,operationId:''})}>{row.label}</button> : row.operation_id ? <button className="text-indigo-300" onClick={() => navigate({operationId:row.operation_id!})}>{row.kind} · {row.model}</button> : 'Total'}</td>
          <td className="p-3">{row.actual_microusd===0 && row.estimated_microusd===0 && row.unpriced>0 ? 'Unknown' : dollars(row.actual_microusd + row.estimated_microusd)}</td>
          <td className="p-3">{row.actual_microusd===0 && row.estimated_microusd===0 && row.unpriced>0 ? 'Unknown' : dollars(row.actual_microusd)}</td><td className="p-3">{row.actual_microusd===0 && row.estimated_microusd===0 && row.unpriced>0 ? 'Unknown' : dollars(row.estimated_microusd)}</td><td className="p-3">{row.unpriced}</td><td className="p-3">{row.text_requests}</td><td className="p-3">{row.images}</td><td className="p-3">{row.attempts}</td><td className="p-3">{row.failures}</td><td className="p-3">{row.last_activity ? new Date(row.last_activity).toLocaleString() : 'No recorded activity'}</td>
        </tr>)}
      </tbody></table></div>
      {!!data.attempts?.length && <div className="overflow-auto rounded border border-white/10 p-4"><h2>Provider attempt evidence</h2><pre className="text-xs">{JSON.stringify(data.attempts,null,2)}</pre></div>}
      <div className="flex gap-4"><button disabled={!query.get('offset') || query.get('offset') === '0'} onClick={() => navigate({offset:String(Math.max(0,Number(query.get('offset') ?? 0)-25))})}>Previous</button><button disabled={data.nextOffset === null} onClick={() => navigate({offset:String(data.nextOffset)})}>Next</button></div>
    </>}
  </section>;
}
