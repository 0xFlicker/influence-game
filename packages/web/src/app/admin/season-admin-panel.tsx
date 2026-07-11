"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionGate } from "@/components/admin-gate";
import {
  closeAdminSeason,
  createAdminSeason,
  finalizeAdminSeason,
  getProducerSeasonDiagnostics,
  listSeasons,
  type ProducerSeasonDiagnostics,
  type SeasonIdentity,
} from "@/lib/api";

export function SeasonAdminPanel() {
  const [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [diagnostics, setDiagnostics] = useState<ProducerSeasonDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (preferredId?: string) => {
    try {
      const next = await listSeasons();
      setSeasons(next);
      const selected = next.find((season) => season.id === preferredId)
        ?? next[0];
      setSelectedId(selected?.id ?? "");
      setDiagnostics(selected ? await getProducerSeasonDiagnostics(selected.id) : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load seasons.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = seasons.find((season) => season.id === selectedId) ?? null;

  async function run(action: () => Promise<SeasonIdentity | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      await refresh(result?.id ?? selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Season operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createSeason() {
    const suffix = new Date().toISOString().slice(0, 10);
    const slug = `season-${suffix}-${crypto.randomUUID().slice(0, 8)}`;
    await run(() => createAdminSeason({ slug, name: `Season ${suffix}` }));
  }

  if (loading) return <div className="influence-empty-state rounded-xl p-8 text-center text-sm">Loading seasons...</div>;

  return (
    <section aria-labelledby="season-operations-title">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="season-operations-title" className="text-xl font-semibold text-text-primary">Season operations</h2>
          <p className="influence-copy mt-1 text-sm">Create and close seasons, crown champions, and inspect producer-only competition evidence.</p>
        </div>
        <PermissionGate permission="manage_seasons">
          <button type="button" disabled={busy} onClick={createSeason} className="influence-button-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">Create season</button>
        </PermissionGate>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {seasons.length === 0 ? (
        <div className="influence-empty-state rounded-xl p-10 text-center text-sm">No seasons configured.</div>
      ) : (
        <>
          <div className="influence-panel rounded-xl p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="text-xs influence-copy-muted">
                Season
                <select
                  className="mt-1 block min-w-64 rounded-lg border border-border-active bg-surface-raised px-3 py-2 text-sm text-text-primary"
                  value={selectedId}
                  onChange={(event) => { setSelectedId(event.target.value); void refresh(event.target.value); }}
                >
                  {seasons.map((season) => <option key={season.id} value={season.id}>{season.name} · {season.status}</option>)}
                </select>
              </label>
              {selected && (
                <PermissionGate permission="manage_seasons">
                  <div className="flex flex-wrap gap-2">
                    {selected.status === "active" && <button type="button" disabled={busy} onClick={() => run(() => closeAdminSeason(selected.id))} className="influence-button-secondary rounded-lg px-3 py-2 text-xs">Close admission</button>}
                    {selected.status === "closing" && <button type="button" disabled={busy} onClick={() => run(() => finalizeAdminSeason(selected.id))} className="influence-button-primary rounded-lg px-3 py-2 text-xs">Finalize crowns</button>}
                  </div>
                </PermissionGate>
              )}
            </div>
            {selected && (
              <dl className="mt-5 grid gap-3 border-t border-border-active/60 pt-5 text-xs sm:grid-cols-2">
                <Fact label="Status" value={selected.status} />
                <Fact label="Rated pool" value={selected.ratedPool} />
              </dl>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <EvidenceCount label="Hidden ratings" value={diagnostics?.ratings.length ?? 0} />
            <EvidenceCount label="Rating events" value={diagnostics?.ratingEvents.length ?? 0} />
            <EvidenceCount label="Receipt evidence" value={diagnostics?.receiptEvidence.length ?? 0} />
            <EvidenceCount label="Agent revisions" value={diagnostics?.revisions.length ?? 0} />
          </div>

          {diagnostics && (
            <SeasonEvidence diagnostics={diagnostics} />
          )}

          {diagnostics && diagnostics.ratings.length > 0 && (
            <details className="influence-panel mt-4 rounded-xl p-5">
              <summary className="cursor-pointer text-sm font-medium text-text-primary">Inspect hidden rating state</summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead><tr className="border-b border-border-active/60">{['Agent', 'μ', 'σ', 'Games', 'Policy'].map((label) => <th key={label} className="influence-table-header px-3 py-2 text-left">{label}</th>)}</tr></thead>
                  <tbody>{diagnostics.ratings.map((rating) => (
                    <tr key={rating.agentProfileId} className="influence-table-row">
                      <td className="px-3 py-2 font-mono text-text-primary">{rating.agentProfileId}</td>
                      <td className="px-3 py-2 font-mono influence-copy">{rating.mu.toFixed(3)}</td>
                      <td className="px-3 py-2 font-mono influence-copy">{rating.sigma.toFixed(3)}</td>
                      <td className="px-3 py-2 influence-copy-muted">{rating.gamesPlayed}</td>
                      <td className="px-3 py-2 influence-copy-muted">{rating.ratingPolicyVersion}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function SeasonEvidence({ diagnostics }: { diagnostics: ProducerSeasonDiagnostics }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="influence-panel rounded-xl p-5">
        <h3 className="text-sm font-medium text-text-primary">Readiness</h3>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
          <Fact label="Assigned games" value={String(diagnostics.readiness.assignedGames)} />
          <Fact label="Non-terminal" value={String(diagnostics.readiness.nonTerminalGames)} />
          <Fact label="Unsettled seats" value={String(diagnostics.readiness.unsettledOwnedSeats)} />
          <Fact label="Can finalize" value={diagnostics.readiness.canFinalize ? "yes" : "no"} />
        </dl>
      </div>

      <EvidenceJson
        label="Rating transitions"
        value={diagnostics.ratingEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          agentProfileId: event.agentProfileId,
          agentRevisionId: event.agentRevisionId,
          before: event.beforeMu === null ? null : { mu: event.beforeMu, sigma: event.beforeSigma },
          after: { mu: event.afterMu, sigma: event.afterSigma },
          ratingPolicyVersion: event.ratingPolicyVersion,
          revisionPolicyVersion: event.revisionPolicyVersion,
          evidence: event.evidence,
          createdAt: event.createdAt,
        }))}
      />
      <EvidenceJson label="Pregame rating snapshots" value={diagnostics.ratingSnapshots} />
      <EvidenceJson label="Receipt reproduction" value={diagnostics.receiptEvidence} />
      <EvidenceJson
        label="Revision classifier evidence"
        value={diagnostics.revisions.map((revision) => ({
          id: revision.id,
          agentProfileId: revision.agentProfileId,
          ordinal: revision.ordinal,
          magnitude: revision.magnitude,
          fingerprint: revision.fingerprint,
          behaviorSnapshot: revision.behaviorSnapshot,
          effectiveRuntimeSnapshot: revision.effectiveRuntimeSnapshot,
          createdAt: revision.createdAt,
        }))}
      />
    </div>
  );
}

function EvidenceJson({ label, value }: { label: string; value: unknown }) {
  const count = Array.isArray(value) ? value.length : null;
  return (
    <details className="influence-panel mt-4 rounded-xl p-5">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">
        {label}{count === null ? "" : ` · ${count}`}
      </summary>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-4 font-mono text-[11px] leading-5 text-text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="influence-copy-muted uppercase tracking-wider">{label}</dt><dd className="mt-1 text-text-primary">{value}</dd></div>;
}

function EvidenceCount({ label, value }: { label: string; value: number }) {
  return <div className="influence-panel rounded-xl p-4"><div className="font-mono text-2xl font-semibold text-text-primary">{value}</div><div className="influence-copy-muted mt-1 text-xs">{label}</div></div>;
}
