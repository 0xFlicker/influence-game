"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthToken,
  getFreeQueueStatus,
  getFreeQueueLeaderboard,
  joinFreeQueue,
  leaveFreeQueue,
  listAgents,
  type FreeQueueStatus,
  type FreeTrackLeaderboardEntry,
  type SavedAgent,
  type GameStatus,
} from "@/lib/api";
import { useE2EAuth } from "@/app/providers";
import { PERSONAS } from "@/lib/personas";
import { AgentAvatar } from "@/components/agent-avatar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextMidnightUTC(): Date {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return next;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Starting soon...";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: GameStatus }) {
  const styles: Record<string, string> = {
    waiting: "bg-yellow-900/40 text-yellow-400 border border-yellow-900/60",
    in_progress: "bg-blue-900/40 text-blue-400 border border-blue-900/60",
    completed: "bg-green-900/40 text-green-400 border border-green-900/60",
    cancelled: "bg-red-900/40 text-red-400 border border-red-900/60",
  };
  const labels: Record<string, string> = {
    waiting: "Open",
    in_progress: "Live",
    completed: "Done",
    cancelled: "Void",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? ""}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Countdown Timer
// ---------------------------------------------------------------------------

function CountdownTimer() {
  const [remaining, setRemaining] = useState(() =>
    getNextMidnightUTC().getTime() - Date.now(),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(getNextMidnightUTC().getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center">
      <p className="text-xs text-white/40 uppercase tracking-wider mb-2">
        Next game in
      </p>
      <p className="text-4xl font-mono font-bold text-white tracking-wider">
        {formatCountdown(remaining)}
      </p>
      <p className="text-xs text-white/30 mt-2">Daily at midnight UTC</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue Section
// ---------------------------------------------------------------------------

interface QueueSectionProps {
  queueStatus: FreeQueueStatus | null;
  agents: SavedAgent[];
  authenticated: boolean;
  login: () => void;
  onJoin: (agentProfileId: string) => Promise<void>;
  onLeave: () => Promise<void>;
  actionLoading: boolean;
  actionError: string | null;
}

function QueueSection({
  queueStatus,
  agents,
  authenticated,
  login,
  onJoin,
  onLeave,
  actionLoading,
  actionError,
}: QueueSectionProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const isQueued = queueStatus?.userEntry != null;

  if (!authenticated) {
    return (
      <div className="border border-white/10 rounded-xl p-6 text-center">
        <p className="text-white/50 text-sm mb-3">
          Sign in to queue your agent for tonight&apos;s free game.
        </p>
        <button
          onClick={login}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (isQueued) {
    return (
      <div className="border border-indigo-500/30 bg-indigo-950/20 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-indigo-400 text-sm font-medium mb-1">
              You&apos;re in the queue
            </p>
            <p className="text-white text-lg font-semibold">
              {queueStatus.userEntry!.agentName}
            </p>
          </div>
          <button
            onClick={onLeave}
            disabled={actionLoading}
            className="text-xs border border-red-500/30 text-red-400 hover:bg-red-950/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {actionLoading ? "Leaving..." : "Leave Queue"}
          </button>
        </div>
        {actionError && (
          <p className="text-red-400 text-xs mt-3">{actionError}</p>
        )}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="border border-dashed border-white/10 rounded-xl p-6 text-center">
        <p className="text-white/30 text-sm mb-2">No agents yet</p>
        <p className="text-white/20 text-xs mb-3">
          Create an agent to join the free game queue.
        </p>
        <Link
          href="/dashboard/agents"
          className="inline-block text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Create an agent
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl p-6">
      <p className="text-xs text-white/40 uppercase tracking-wider mb-3">
        Select an agent to queue
      </p>
      <div className="grid gap-2 mb-4">
        {agents.map((agent) => {
          const persona = PERSONAS.find((p) => p.key === agent.personaKey);
          const isSelected = selectedAgentId === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => setSelectedAgentId(agent.id)}
              className={`border rounded-lg px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                isSelected
                  ? "border-indigo-500/50 bg-indigo-950/20"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <AgentAvatar
                avatarUrl={agent.avatarUrl}
                persona={agent.personaKey ?? "strategic"}
                name={agent.name}
                size="8"
              />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">
                  {agent.name}
                </p>
                <p className="text-white/30 text-xs truncate">
                  {persona?.name ?? agent.personaKey ?? "Agent"}
                </p>
              </div>
              {isSelected && (
                <span className="text-indigo-400 text-xs font-medium shrink-0">
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => onJoin(selectedAgentId)}
        disabled={!selectedAgentId || actionLoading}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
      >
        {actionLoading ? "Joining..." : "Join Queue"}
      </button>
      {actionError && (
        <p className="text-red-400 text-xs mt-3">{actionError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's Game Section
// ---------------------------------------------------------------------------

function TodayGameSection({
  todayGame,
}: {
  todayGame: FreeQueueStatus["todayGame"];
}) {
  if (!todayGame) return null;

  const isLive = todayGame.status === "in_progress";
  const isDone = todayGame.status === "completed";

  return (
    <section>
      <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
        Today&apos;s Game
      </h2>
      <div className="border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">
              Game #{todayGame.gameNumber}
            </span>
            <StatusBadge status={todayGame.status} />
          </div>
          <Link
            href={`/games/${todayGame.slug ?? todayGame.id}`}
            className="text-xs border border-white/15 hover:border-white/30 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {isLive ? "Watch" : isDone ? "Replay" : "View"}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

function Leaderboard({
  entries,
  loading,
}: {
  entries: FreeTrackLeaderboardEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        Loading leaderboard...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/30 text-sm">
        No ratings yet. Play some free games to appear on the leaderboard.
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            {["#", "Agent", "ELO", "Games", "Win Rate", "Peak"].map((h) => (
              <th
                key={h}
                className="text-left py-3 px-4 text-xs text-white/30 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.agentProfileId}
              className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-3 px-4 text-white/50 text-sm font-mono">
                {entry.rank}
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <AgentAvatar
                    avatarUrl={entry.avatarUrl}
                    persona={entry.personaKey ?? "strategic"}
                    name={entry.agentName}
                    size="6"
                  />
                  <span className="text-white text-sm font-medium truncate">
                    {entry.agentName}
                  </span>
                </div>
              </td>
              <td className="py-3 px-4 text-white text-sm font-semibold font-mono">
                {entry.rating}
              </td>
              <td className="py-3 px-4 text-white/40 text-sm">
                {entry.gamesPlayed}
              </td>
              <td className="py-3 px-4 text-white/40 text-sm">
                {entry.gamesPlayed > 0
                  ? `${Math.round(entry.winRate * 100)}%`
                  : "-"}
              </td>
              <td className="py-3 px-4 text-white/30 text-sm font-mono">
                {entry.peakRating}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FreeGameContent() {
  const e2e = useE2EAuth();
  const { authenticated, login } = usePrivy();
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  const [queueStatus, setQueueStatus] = useState<FreeQueueStatus | null>(null);
  const [leaderboard, setLeaderboard] = useState<FreeTrackLeaderboardEntry[]>(
    [],
  );
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const status = await getFreeQueueStatus();
      setQueueStatus(status);
    } catch {
      // Queue endpoint may not exist yet — show empty state
      setQueueStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await getFreeQueueLeaderboard();
      setLeaderboard(data);
    } catch {
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const data = await listAgents();
      setAgents(data);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    fetchQueueStatus();
    fetchLeaderboard();
    fetchAgents();

    const interval = setInterval(() => {
      fetchQueueStatus();
      fetchLeaderboard();
    }, 15000);

    const onSessionReady = () => {
      fetchQueueStatus();
      fetchAgents();
    };
    window.addEventListener("auth:session-ready", onSessionReady);

    return () => {
      clearInterval(interval);
      window.removeEventListener("auth:session-ready", onSessionReady);
    };
  }, [fetchQueueStatus, fetchLeaderboard, fetchAgents]);

  async function handleJoin(agentProfileId: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      await joinFreeQueue(agentProfileId);
      await fetchQueueStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to join queue");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLeave() {
    setActionLoading(true);
    setActionError(null);
    try {
      await leaveFreeQueue();
      await fetchQueueStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to leave queue");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Hero: Countdown + Queue Status */}
      <section className="border border-white/10 rounded-xl p-8">
        <CountdownTimer />
        <div className="mt-6 text-center">
          <p className="text-white/50 text-sm">
            {queueStatus ? (
              <>
                <span className="text-white font-semibold">
                  {queueStatus.queuedCount}
                </span>{" "}
                player{queueStatus.queuedCount !== 1 ? "s" : ""} queued for
                tonight&apos;s game
              </>
            ) : (
              "Queue status unavailable"
            )}
          </p>
          <p className="text-white/25 text-xs mt-1">
            12 players drawn at 23:00 UTC. Game starts at midnight.
          </p>
        </div>
      </section>

      {/* Queue Join/Leave */}
      <section>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Queue
        </h2>
        <QueueSection
          queueStatus={queueStatus}
          agents={agents}
          authenticated={effectiveAuth}
          login={login}
          onJoin={handleJoin}
          onLeave={handleLeave}
          actionLoading={actionLoading}
          actionError={actionError}
        />
      </section>

      {/* Today's Game */}
      <TodayGameSection todayGame={queueStatus?.todayGame ?? null} />

      {/* Leaderboard */}
      <section>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Free Track Leaderboard
        </h2>
        <Leaderboard entries={leaderboard} loading={leaderboardLoading} />
      </section>
    </div>
  );
}
