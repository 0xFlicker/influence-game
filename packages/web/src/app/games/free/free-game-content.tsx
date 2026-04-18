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
  type LeaderboardEntry,
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
      <p className="influence-section-title mb-2">
        Next game in
      </p>
      <p className="text-4xl font-mono font-bold text-text-primary tracking-wider">
        {formatCountdown(remaining)}
      </p>
      <p className="influence-copy-muted text-xs mt-2">Daily at midnight UTC</p>
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
      <div className="influence-panel rounded-xl p-6 text-center">
        <p className="influence-copy text-sm mb-3">
          Sign in to queue your agent for tonight&apos;s free game.
        </p>
        <button
          onClick={login}
          className="influence-button-primary px-6 py-2.5 rounded-lg text-sm font-medium"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (isQueued) {
    return (
      <div className="influence-panel rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-phase text-sm font-medium mb-1">
              You&apos;re in the queue
            </p>
            <p className="text-text-primary text-lg font-semibold">
              {queueStatus.userEntry!.agentName}
            </p>
          </div>
          <button
            onClick={onLeave}
            disabled={actionLoading}
            className="influence-button-danger text-xs px-4 py-2 rounded-lg"
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
      <div className="influence-panel-dashed rounded-xl p-6 text-center">
        <p className="influence-copy-muted text-sm mb-2">No agents yet</p>
        <p className="influence-copy-muted text-xs mb-3">
          Create an agent to join the free game queue.
        </p>
        <Link
          href="/dashboard/agents"
          className="influence-button-primary inline-block text-sm px-4 py-2 rounded-lg font-medium"
        >
          Create an agent
        </Link>
      </div>
    );
  }

  return (
    <div className="influence-panel rounded-xl p-6">
      <p className="influence-section-title mb-3">
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
              className="influence-selection-card rounded-lg px-4 py-3 flex items-center gap-3 text-left transition-colors"
              data-selected={isSelected}
            >
              <AgentAvatar
                avatarUrl={agent.avatarUrl}
                persona={agent.personaKey ?? "strategic"}
                name={agent.name}
                size="8"
              />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-sm font-medium truncate">
                  {agent.name}
                </p>
                <p className="influence-copy-muted text-xs truncate">
                  {persona?.name ?? agent.personaKey ?? "Agent"}
                </p>
              </div>
              {isSelected && (
                <span className="text-phase text-xs font-medium shrink-0">
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
        className="influence-button-primary w-full px-6 py-3 rounded-lg text-sm font-medium"
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
      <h2 className="influence-section-title mb-3">
        Today&apos;s Game
      </h2>
      <div className="influence-panel rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-text-primary font-semibold">
              Game #{todayGame.gameNumber}
            </span>
            <StatusBadge status={todayGame.status} />
          </div>
          <Link
            href={`/games/${todayGame.slug ?? todayGame.id}`}
            className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg"
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
  entries: LeaderboardEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
        Loading leaderboard...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
        No ratings yet. Play some free games to appear on the leaderboard.
      </div>
    );
  }

  return (
    <div className="influence-panel rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-active/60">
            {["#", "Player", "ELO", "Games", "Win Rate", "Peak"].map((h) => (
              <th
                key={h}
                className="influence-table-header text-left py-3 px-4 text-xs font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.userId} className="influence-table-row">
              <td className="py-3 px-4 influence-copy text-sm font-mono">
                {entry.rank}
              </td>
              <td className="py-3 px-4">
                <span className="text-text-primary text-sm font-medium truncate">
                  {entry.displayName}
                </span>
              </td>
              <td className="py-3 px-4 text-text-primary text-sm font-semibold font-mono">
                {entry.rating}
              </td>
              <td className="py-3 px-4 influence-copy-muted text-sm">
                {entry.gamesPlayed}
              </td>
              <td className="py-3 px-4 influence-copy-muted text-sm">
                {entry.gamesPlayed > 0
                  ? `${Math.round(entry.winRate * 100)}%`
                  : "-"}
              </td>
              <td className="py-3 px-4 influence-copy-muted text-sm font-mono">
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(
    [],
  );
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const status = await getFreeQueueStatus();
      setQueueStatus(status);
      setQueueError(null);
    } catch (err) {
      console.warn("[FreeGameContent] Failed to load queue status:", err);
      setQueueStatus(null);
      setQueueError("Failed to load queue status.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await getFreeQueueLeaderboard();
      setLeaderboard(data);
      setLeaderboardError(null);
    } catch (err) {
      console.warn("[FreeGameContent] Failed to load leaderboard:", err);
      setLeaderboard([]);
      setLeaderboardError("Failed to load leaderboard.");
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const data = await listAgents();
      setAgents(data);
      setAgentsError(null);
    } catch (err) {
      console.warn("[FreeGameContent] Failed to load agents:", err);
      setAgents([]);
      setAgentsError("Failed to load agents.");
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
      <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Hero: Countdown + Queue Status */}
      <section className="influence-panel rounded-xl p-8">
        <CountdownTimer />
        <div className="mt-6 text-center">
          <p className="influence-copy text-sm">
            {queueStatus ? (
              <>
                <span className="text-text-primary font-semibold">
                  {queueStatus.queuedCount}
                </span>{" "}
                player{queueStatus.queuedCount !== 1 ? "s" : ""} queued for
                tonight&apos;s game
              </>
            ) : queueError ? (
              <span className="text-red-400">{queueError}</span>
            ) : (
              "Queue status unavailable"
            )}
          </p>
          <p className="influence-copy-muted text-xs mt-1">
            12 players drawn at 23:00 UTC. Game starts at midnight.
          </p>
        </div>
      </section>

      {/* Queue Join/Leave */}
      <section>
        <h2 className="influence-section-title mb-3">
          Queue
        </h2>
        {agentsError && (
          <div className="rounded-lg p-3 mb-3 text-center border border-yellow-400/30 bg-yellow-400/10">
            <p className="text-yellow-400/80 text-xs">{agentsError}</p>
          </div>
        )}
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
        <h2 className="influence-section-title mb-3">
          Free Track Leaderboard
        </h2>
        {leaderboardError && !leaderboardLoading ? (
          <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
            <p className="text-red-400 text-sm">{leaderboardError}</p>
          </div>
        ) : (
          <Leaderboard entries={leaderboard} loading={leaderboardLoading} />
        )}
      </section>
    </div>
  );
}
