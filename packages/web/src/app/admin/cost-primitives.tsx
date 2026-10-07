import type { AdminGameCostDetail } from "@/lib/api";
export function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

/** Uncached input = prompt − cached so the three buckets partition total tokens. */
export function TokenBreakdownTable({
  detail,
}: {
  detail: Pick<
    AdminGameCostDetail,
    "promptTokens" | "cachedTokens" | "completionTokens" | "reasoningTokens" | "totalTokens"
  >;
}) {
  const cached = Math.max(0, detail.cachedTokens);
  const input = Math.max(0, detail.promptTokens - cached);
  const output = Math.max(0, detail.completionTokens);
  const reasoning = Math.max(0, detail.reasoningTokens);
  const total = Math.max(0, detail.totalTokens);
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—");

  const rows: Array<{ name: string; tokens: number; note?: string }> = [
    { name: "Input", tokens: input },
    { name: "Input cached", tokens: cached },
    {
      name: "Output",
      tokens: output,
      note: reasoning > 0 ? `includes ${reasoning.toLocaleString()} reasoning` : undefined,
    },
    { name: "Total", tokens: total },
  ];

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Tokens</h3>
      <div className="overflow-x-auto rounded-md border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-white/35">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Bucket</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isTotal = row.name === "Total";
              return (
                <tr
                  key={row.name}
                  className={isTotal ? "border-t border-white/15 bg-white/[0.02]" : "border-t border-white/5"}
                >
                  <td className={`px-3 py-2 ${isTotal ? "font-medium text-white/80" : "text-white/70"}`}>
                    {row.name}
                    {row.note && (
                      <span className="mt-0.5 block text-[11px] font-normal text-white/35">{row.note}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${isTotal ? "font-medium text-white/80" : "text-white/50"}`}>
                    {row.tokens.toLocaleString()}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${isTotal ? "font-medium text-white/80" : "text-white/40"}`}>
                    {isTotal && total > 0 ? "100%" : pct(row.tokens)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

