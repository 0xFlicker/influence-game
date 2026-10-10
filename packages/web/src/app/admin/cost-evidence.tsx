import type { AdminGameCostDetail } from "@/lib/api";
import { Metric, TokenBreakdownTable } from "./cost-primitives";
const money = (value: number) => `$${(value / 1_000_000).toFixed(4)}`;
const label = (value: string) => value.replaceAll("_", " ");
export function CostEvidence({ detail: d }: { detail: AdminGameCostDetail }) {
  const reported = ["provider_actual", "router_actual", "org_reconciled"].some(source => (d.costSourceCounts[source] ?? 0) > 0);
  const estimated = ["catalog_estimate", "static_estimate"].some(source => (d.costSourceCounts[source] ?? 0) > 0);
  return <div className="space-y-6 text-sm">
    <p className="text-white/55">{d.callCount === 0 ? "No provider calls recorded." : `${d.callCount} recorded calls · ${d.unpricedCallCount} without a price. Reported and estimated amounts cover their respective recorded calls; they are not two complete game prices.`}</p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Reported charges" value={reported ? money(d.actualCostMicrousd) : "Not reported"} sub="Sum of recorded actual amounts" />
      <Metric label="Estimated charges" value={estimated ? money(d.estimatedCostMicrousd) : "Not estimated"} sub="Stored rate-card estimates" />
      <Metric label="Failed calls" value={String(d.failedCallCount)} />
      <Metric label="Retry calls" value={String(d.retryFailureSpend.retryCallCount)} sub="Already included in spending" />
    </div>
    {d.unpricedCallCount > 0 && <p className="rounded border border-amber-300/20 p-3 text-amber-200">Spending is incomplete: {d.unpricedCallCount} calls have no reported or estimated price.</p>}
    <TokenBreakdownTable detail={d} />
    <p className="text-xs text-white/50">Breakdown amounts are recorded sums. A zero sum alone does not establish price coverage; see pricing sources below.</p>
    <Usage title="Model usage" rows={d.breakdowns.model} />
    <Usage title="Usage by action" rows={d.breakdowns.action} />
    <section><h3 className="mb-2 font-semibold">Most expensive recorded calls</h3><p className="mb-3 text-xs text-white/50">A cost-ranked subset, not a complete call ledger.</p>
      {d.expensiveCalls.length === 0 ? <p className="text-white/50">No call evidence recorded.</p> : d.expensiveCalls.map((call, index) => <details key={index} className="border-t border-white/10 py-3">
        <summary className="cursor-pointer leading-6"><span className="font-medium">{call.actorName ?? call.actorRole ?? "House"}</span> · {label(call.action ?? call.phase ?? "Model call")} <span className="text-white/50">· {call.modelName ?? call.provider ?? "Model not recorded"}</span></summary>
        <dl className="mt-3 grid grid-cols-2 gap-3 break-words rounded bg-white/[.025] p-3 sm:grid-cols-3">
          {Object.entries({ Status: label(call.callStatus), "Actor role": call.actorRole ? label(call.actorRole) : "Not recorded", Action: call.action ? label(call.action) : "Not recorded", Provider: call.provider ?? "Not recorded", Model: call.modelName ?? "Not recorded", Phase: call.phase ? label(call.phase) : "Not recorded", Round: call.round ?? "Not recorded", Tokens: call.totalTokens.toLocaleString(), Reported: call.actualCostMicrousd == null ? "Not reported" : money(call.actualCostMicrousd), Estimated: call.estimatedCostMicrousd == null ? "Not estimated" : money(call.estimatedCostMicrousd), "Pricing basis": label(call.costSource) }).map(([key, value]) => <div key={key}><dt className="text-xs text-white/45">{key}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>)}
        </dl>
      </details>)}
    </section>
    <details className="border-t border-white/10 pt-3"><summary className="cursor-pointer text-white/55">Technical pricing evidence</summary><dl className="my-3 space-y-2 text-xs"><div><dt>Rate cards</dt><dd>{d.pricing.rateCardVersions.join(", ") || "None recorded"}</dd></div><div><dt>Sources</dt><dd>{Object.entries(d.costSourceCounts).map(([source, count]) => `${label(source)}: ${count}`).join(" · ") || "None recorded"}</dd></div></dl><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-white/50">{JSON.stringify({ pricing: d.pricing, retryFailureSpend: d.retryFailureSpend }, null, 2)}</pre></details>
  </div>;
}
function Usage({ title, rows }: { title: string; rows?: AdminGameCostDetail["breakdowns"][string] }) {
  return <section><h3 className="mb-3 font-semibold">{title}</h3>{!rows || !Object.keys(rows).length ? <p className="text-white/50">No usage recorded.</p> : <div className="divide-y divide-white/10">{Object.entries(rows).map(([name, row]) => <div key={name} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr]">
    <div className="break-words font-medium">{label(name)}<span className="mt-1 block text-xs font-normal text-white/50">{row.callCount} calls · {row.totalTokens.toLocaleString()} tokens</span></div>
    <div className="tabular-nums"><span className="mr-2 text-xs text-white/45">Reported</span>{money(row.actualCostMicrousd)}</div><div className="tabular-nums"><span className="mr-2 text-xs text-white/45">Estimated</span>{money(row.estimatedCostMicrousd)}</div>
  </div>)}</div>}</section>;
}
