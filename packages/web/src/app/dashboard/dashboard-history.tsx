"use client";
import { useState } from "react";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { ParticipationRows, participationFilters } from "@/components/participation-history";
export function DashboardHistory({ entries, loading, error }: { entries: HouseParticipation[]; loading: boolean; error: string | null }) {
  const [kind, setKind] = useState<ParticipationFilter>("all");
  return <section className="influence-panel min-w-0 rounded-xl p-5">
    <h2 className="influence-section-title">Game history</h2>
    <p className="text-xs influence-copy-muted">Results · Spoilers</p>
    <div className="mt-3 flex flex-wrap gap-2" aria-label="History game type">{participationFilters.map(f => <button type="button" key={f.kind} aria-pressed={kind === f.kind} className={`${kind === f.kind ? "influence-button-primary" : "influence-button-secondary"} rounded px-3 py-2 text-sm`} onClick={() => setKind(f.kind)}>{f.label}</button>)}</div>
    {loading ? <p role="status">Loading history…</p> : error ? <p role="alert">{error}</p> : <ParticipationRows entries={entries.filter(e => kind === "all" || e.gameKind === kind)}/>}
  </section>;
}
