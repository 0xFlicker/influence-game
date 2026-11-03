"use client";
import { useState } from "react";
import type { RunChampionshipAction } from "./championship-admin-panel";

export function ChampionshipResultCorrection({ eventId, ordinal, gameId, revision, disabled, run }: {
  eventId: string; ordinal: number; gameId: string; revision: number; disabled: boolean; run: RunChampionshipAction;
}) {
  const [mode, setMode] = useState<"resettle" | "replay">("resettle"), [reason, setReason] = useState("");
  const control = "block w-full rounded border border-white/20 bg-surface-raised p-2";
  return <details className="w-full rounded border border-white/10 p-3"><summary>Correct completed result · revision {revision}</summary>
    <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void run(`Correct day ${ordinal}`, `/api/admin/championships/${eventId}/matches/${ordinal}/correct`, { expectedGameId: gameId, expectedRevision: revision, mode, reason }); }}>
      <label className="block">Correction method<select className={control} disabled={disabled} value={mode} onChange={e => setMode(e.target.value as "resettle" | "replay")}><option value="resettle">Recalculate from the existing canonical result</option><option value="replay">Replay this match with the frozen field and roles</option></select></label>
      <p className="text-sm influence-copy-muted">Original games and scores remain in history. Affected champion badges are withdrawn until corrected results settle. {mode === "replay" ? "Replay creates another game. A paused event stays paused until resumed." : "Recalculation uses the existing outcome and frozen scoring rules; it does not run another game."}</p>
      <label className="block">Correction reason<textarea required className={control} disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="submit" className="influence-button-secondary rounded px-3 py-2 disabled:opacity-40" disabled={disabled || !reason.trim()}>Apply result correction</button>
    </form>
  </details>;
}
