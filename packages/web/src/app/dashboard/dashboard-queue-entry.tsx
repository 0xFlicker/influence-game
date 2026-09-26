"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { FreeQueueStatus, SavedAgent } from "@/lib/api";

export function DashboardQueueEntry({ status, agents, loading, error, onJoin, onRetry }: {
  status: FreeQueueStatus | null;
  agents: SavedAgent[];
  loading: boolean;
  error: string | null;
  onJoin: (agentId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const pending = useRef(false);
  const agentId = agents.some(agent => agent.id === selectedId) ? selectedId : agents.length === 1 ? agents[0].id : "";

  async function join() {
    if (!agentId || pending.current) return;
    pending.current = true;
    setJoining(true);
    setJoinError(null);
    try { await onJoin(agentId); }
    catch (cause) { setJoinError(cause instanceof Error ? cause.message : "Could not enter the queue. Try again."); }
    finally { pending.current = false; setJoining(false); }
  }

  return <div className="mt-5 rounded-lg border border-border-active/60 p-4">
    <p className="influence-section-title mb-2">Daily Free</p>
    {loading ? <p className="influence-copy text-sm" role="status">Checking your queue entry…</p>
      : error || !status ? <div role="alert" className="influence-copy text-sm">
        <p>{error ?? "Queue status unavailable."}</p>
        <button type="button" onClick={onRetry} className="influence-link mt-2 min-h-11">Retry queue status</button>
      </div>
      : status.userEntry ? <p className="influence-copy text-sm" role="status">
        <span className="font-semibold text-text-primary">{status.userEntry.agentName}</span> is entered.
        {status.eligibility === "temporarily-ineligible" && (status.ineligibilityReason === "moderation" ? " Participation is paused pending moderation of this character." : status.ineligibilityReason === "active-game" ? " Participation resumes when your current game finishes." : " Participation is temporarily paused.")}
      </p>
      : agents.length === 0 ? <p className="influence-copy text-sm">
        <Link href="/agents/create?flow=daily_free" className="influence-link">Create an agent to enter</Link> the daily game.
      </p>
      : <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={event => { event.preventDefault(); void join(); }}>
        <label className="min-w-0 flex-1 text-sm influence-copy">
          Choose an agent
          <select value={agentId} disabled={joining} onChange={event => { setSelectedId(event.target.value); setJoinError(null); }} className="mt-2 block min-h-11 w-full rounded-lg border border-border-active bg-surface-raised px-3 text-text-primary">
            <option value="" disabled>Select an agent</option>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!agentId || joining} className="influence-button-primary min-h-11 rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50">
          {joining ? "Entering…" : "Enter queue"}
        </button>
      </form>}
    {joinError && <p role="alert" className="mt-2 text-sm text-red-400">{joinError}</p>}
  </div>;
}
