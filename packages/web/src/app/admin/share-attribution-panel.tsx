"use client";

import { useState } from "react";
import { useAdminRead } from "./admin-session";

type Account = { publicId: string; sharingAccountId: string; displayName: string | null; handle: string | null };
type Counts = { opens: number; signups: number; agentReady: number; seasonEntries: number };
type Report = { hasNext: boolean } & (
  | { level: "account"; rows: (Account & Counts & { links: number })[] }
  | { level: "link"; account: Account; rows: (Counts & { code: string; path: string; shareLinkId: string })[] }
);

const metrics = [
  ["opens", "Opens"],
  ["signups", "Signups"],
  ["agentReady", "Agent ready"],
  ["seasonEntries", "Season entry"],
] as const;

const control = "min-h-10 rounded-md border border-white/15 px-3 text-sm text-white/85 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:opacity-40";
const posthogInsights = { account: "ozCR40wm", link: "GDdmCrN7" } as const;

function accountName(account: Account) {
  return account.displayName || (account.handle ? `@${account.handle}` : account.publicId);
}

export function ShareAttributionPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accountPage, setAccountPage] = useState(1);
  const [linkPage, setLinkPage] = useState(1);
  const page = account ? linkPage : accountPage;
  const setPage = account ? setLinkPage : setAccountPage;
  const query = new URLSearchParams({ page: String(page) });
  if (account) query.set("account", account.publicId);
  const { data, error, refresh } = useAdminRead<Report>(`/api/admin/share-attribution?${query}`);

  return (
    <section aria-labelledby="share-attribution-title" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="share-attribution-title" className="text-2xl font-semibold">Share attribution</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/65">
            Measured opens and first-touch signups from account-owned short links. Agent readiness and season entry count accounts from those signups.
          </p>
        </div>
        <a className={`inline-flex items-center ${control}`} href={`https://us.posthog.com/project/671431/insights/${posthogInsights[account ? "link" : "account"]}`}>
          View PostHog funnel
        </a>
      </header>
      {account && <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={control} onClick={() => setAccount(null)}>All accounts</button>
        <div>
          <h2 className="break-all text-lg font-medium">{accountName(data?.level === "link" ? data.account : account)}</h2>
          <p className="text-xs text-white/60">PostHog account ID <code className="inline-block break-all">{account.sharingAccountId}</code></p>
        </div>
      </div>}
      {error ? <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm">
        <p>{error}</p><button type="button" className={control} onClick={() => void refresh()}>Retry</button>
      </div> : !data ? <p role="status" className="text-sm text-white/65">Loading share attribution…</p> : data.rows.length === 0
        ? <p className="text-sm text-white/65">{page === 1 ? "No account-owned share links yet." : "No results on this page."}</p>
        : <div className="overflow-x-auto rounded-lg border border-white/10">
          <table aria-label={account ? "Share links" : "Sharing accounts"} className="w-full table-fixed text-left text-sm sm:min-w-[36rem] sm:table-auto">
            <thead className="hidden bg-white/5 text-white/70 sm:table-header-group">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">{account ? "Short link" : "Sharing account"}</th>
                {data.level === "account" && <th scope="col" className="px-3 py-3 text-right font-medium">Links</th>}
                {metrics.map(([key, label]) => <th scope="col" className="px-3 py-3 text-right font-medium" key={key}>{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {data.rows.map(row => (
                <tr key={"code" in row ? row.code : row.publicId}>
                  <th scope="row" className="px-4 py-3 font-medium">
                    {"code" in row
                      ? <><a className="underline decoration-white/40 underline-offset-4" href={`/s/${row.code}`}>/s/{row.code}</a>
                        <p className="mt-1 max-w-lg break-all text-xs font-normal text-white/60">{row.path}</p>
                        <p className="mt-1 text-xs font-normal text-white/60">PostHog link ID <code className="inline-block break-all">{row.shareLinkId}</code></p></>
                      : <><button type="button" className="break-all text-left underline decoration-white/40 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400" onClick={() => { setLinkPage(1); setAccount(row); }}>{accountName(row)}</button>
                        {row.handle && row.displayName && <p className="mt-1 break-all text-xs font-normal text-white/60">@{row.handle}</p>}</>}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-3 text-xs sm:hidden">
                      {"links" in row && <div><dt className="text-white/65">Links</dt><dd className="mt-0.5 text-sm tabular-nums">{row.links.toLocaleString()}</dd></div>}
                      {metrics.map(([key, label]) => (
                        <div key={key}>
                          <dt className="text-white/65">{label}</dt>
                          <dd className="mt-0.5 text-sm tabular-nums">{row[key].toLocaleString()}</dd>
                        </div>
                      ))}
                    </dl>
                  </th>
                  {"links" in row && <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{row.links.toLocaleString()}</td>}
                  {metrics.map(([key]) => <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell" key={key}>{row[key].toLocaleString()}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      {(page > 1 || data?.hasNext) && <nav aria-label="Report pages" className="flex items-center gap-3">
        <button type="button" className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="text-sm text-white/65">Page {page}</span>
        <button type="button" className={control} disabled={!data?.hasNext} onClick={() => setPage(page + 1)}>Next</button>
      </nav>}
    </section>
  );
}
