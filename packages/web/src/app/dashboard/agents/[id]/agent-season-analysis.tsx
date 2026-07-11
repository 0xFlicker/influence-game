"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  agentSeasonExportUrl,
  getAgent,
  getAgentSeasonAnalysis,
  getAuthToken,
  listSeasons,
  type AgentSeasonAnalysis,
  type SavedAgent,
  type SeasonIdentity,
} from "@/lib/api";

export function AgentSeasonAnalysisView({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [selectedSeason, setSelectedSeason] = useState("");
  const [analysis, setAnalysis] = useState<AgentSeasonAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalysis = useCallback(async (seasonSlug: string) => {
    setLoading(true);
    try {
      setAnalysis(await getAgentSeasonAnalysis(seasonSlug, agentId));
      setError(null);
    } catch (err) {
      setAnalysis(null);
      setError(err instanceof Error ? err.message : "Failed to load agent season analysis.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!getAuthToken()) return;
    Promise.all([getAgent(agentId), listSeasons()])
      .then(([nextAgent, nextSeasons]) => {
        setAgent(nextAgent);
        setSeasons(nextSeasons);
        const requestedSeason = new URLSearchParams(window.location.search).get("season");
        const selected = nextSeasons.find((season) => season.slug === requestedSeason)
          ?? nextSeasons.find((season) => season.status === "active")
          ?? nextSeasons.find((season) => season.status === "closing")
          ?? nextSeasons.find((season) => season.status === "final")
          ?? nextSeasons[0];
        if (selected) {
          setSelectedSeason(selected.slug);
          replaceSeasonUrl(selected.slug);
          void loadAnalysis(selected.slug);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load agent analysis.");
        setLoading(false);
      });
  }, [agentId, loadAnalysis]);

  function selectSeason(slug: string) {
    setSelectedSeason(slug);
    replaceSeasonUrl(slug);
    void loadAnalysis(slug);
  }

  async function download(format: "json" | "csv") {
    const token = getAuthToken();
    if (!token || !selectedSeason) return;
    try {
      const response = await fetch(agentSeasonExportUrl(selectedSeason, format, agentId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export request failed");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `influence-agent-season.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch {
      setError("Could not prepare the season export.");
    }
  }

  return (
    <div>
      <header className="flex flex-col gap-5 border-b border-border-active/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/dashboard/agents" className="influence-copy-muted transition-colors hover:text-text-primary">Agents</Link>
            <span className="text-white/20">/</span>
            <span className="text-text-secondary">Analysis</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-text-primary">{agent?.name ?? "Agent"}</h1>
          <p className="influence-copy mt-2 text-sm">Season results, point receipts, and revision-separated performance.</p>
        </div>
        {seasons.length > 0 && (
          <label className="text-xs influence-copy-muted">
            Season
            <select
              value={selectedSeason}
              onChange={(event) => selectSeason(event.target.value)}
              className="ml-2 rounded-lg border border-border-active bg-surface-raised px-3 py-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-phase/70"
            >
              {seasons.map((season) => <option key={season.id} value={season.slug}>{season.name} · {season.status}</option>)}
            </select>
          </label>
        )}
      </header>

      {error && <p className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading ? (
        <div className="influence-empty-state mt-6 rounded-xl p-10 text-center text-sm">Loading season analysis...</div>
      ) : !analysis ? (
        <div className="influence-empty-state mt-6 rounded-xl p-10 text-center">
          <p className="text-sm text-text-primary">No season data for this agent yet.</p>
          <p className="influence-copy-muted mt-1 text-xs">Eligible daily games will appear here after completion.</p>
        </div>
      ) : (
        <div className="mt-7 space-y-8">
          <section aria-labelledby="season-summary-title">
            <h2 id="season-summary-title" className="influence-section-title mb-3">Season summary</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border-active bg-border-active sm:grid-cols-4">
              <Metric label="Points" value={analysis.summary.totalPoints.toString()} />
              <Metric label="Wins" value={analysis.summary.wins.toString()} />
              <Metric label="Games" value={analysis.summary.gamesPlayed.toString()} />
              <Metric label="Avg. finish" value={analysis.summary.averagePlacement?.toFixed(2) ?? "—"} />
            </div>
          </section>

          <section aria-labelledby="season-receipts-title">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 id="season-receipts-title" className="influence-section-title">Game receipts</h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => download("json")} className="influence-button-secondary rounded-lg px-3 py-1.5 text-xs">Export JSON</button>
                <button type="button" onClick={() => download("csv")} className="influence-button-secondary rounded-lg px-3 py-1.5 text-xs">Export CSV</button>
              </div>
            </div>
            {analysis.receipts.length === 0 ? (
              <div className="influence-empty-state rounded-xl p-8 text-center text-sm">No receipts in this season.</div>
            ) : (
              <div className="influence-panel overflow-x-auto rounded-xl">
                <table className="w-full min-w-[700px]">
                  <thead><tr className="border-b border-border-active/60">
                    {['Game', 'Place', 'Base', 'Field', 'Total', 'Account ELO'].map((label) => (
                      <th key={label} className="influence-table-header px-4 py-3 text-left text-xs font-medium">{label}</th>
                    ))}
                  </tr></thead>
                  <tbody>{analysis.receipts.map((receipt) => (
                    <tr key={`${receipt.gameId}:${receipt.agentId}`} className="influence-table-row">
                      <td className="px-4 py-3"><Link href={`/games/${receipt.gameSlug ?? receipt.gameId}`} className="text-sm font-medium text-text-primary hover:text-phase">{receipt.gameSlug ?? receipt.gameId.slice(0, 8)}</Link><div className="influence-copy-muted text-xs">{new Date(receipt.earnedAt).toLocaleDateString()}</div></td>
                      <td className="px-4 py-3 font-mono text-sm text-text-primary">{receipt.placement ?? "—"} / {receipt.lobbySize}</td>
                      <td className="px-4 py-3 font-mono text-sm influence-copy">{receipt.basePoints}</td>
                      <td className="px-4 py-3 font-mono text-sm influence-copy">+{receipt.fieldBonus}</td>
                      <td className="px-4 py-3 font-mono text-base font-semibold text-text-primary">{receipt.totalPoints}</td>
                      <td className="px-4 py-3 font-mono text-sm influence-copy-muted">{receipt.accountRatingDelta === null ? "—" : `${receipt.accountRatingDelta >= 0 ? "+" : ""}${receipt.accountRatingDelta}`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          {analysis.revisions.length > 1 && (
            <details className="influence-panel rounded-xl p-5 group">
              <summary className="cursor-pointer list-none text-sm font-medium text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-phase/70">
                Compare revisions <span className="influence-copy-muted ml-1">({analysis.revisions.length})</span>
              </summary>
              <p className="influence-copy-muted mt-2 text-xs">Results are grouped when effective strategy or runtime inputs changed.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {analysis.revisions.map((revision) => (
                  <div key={revision.revisionId} className="rounded-lg border border-border-active/70 bg-black/15 p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">Revision {revision.ordinal}</div>
                    <div className="mt-2 font-mono text-xl font-semibold text-text-primary">{revision.totalPoints} pts</div>
                    <div className="influence-copy-muted mt-1 text-xs">{revision.wins} wins · {revision.gamesPlayed} games · avg {revision.averagePlacement?.toFixed(2) ?? "—"}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function replaceSeasonUrl(slug: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("season", slug);
  window.history.replaceState({}, "", url);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-5">
      <div className="influence-copy-muted text-[11px] uppercase tracking-[0.15em]">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}
