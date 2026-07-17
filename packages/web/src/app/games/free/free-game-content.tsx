"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAuthToken,
  getFreeQueueStatus,
  getFreeQueueLeaderboard,
  joinFreeQueue,
  leaveFreeQueue,
  listAgents,
  listSeasons,
  getSeasonDashboard,
  type FreeQueueStatus,
  type LeaderboardEntry,
  type SeasonDashboard,
  type SeasonIdentity,
  type SavedAgent,
  type GameStatus,
} from "@/lib/api";
import { useE2EAuth } from "@/app/providers";
import { getPersonaLabel } from "@/lib/personas";
import { ACTIVE_GAME } from "@/lib/product-identity";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import { PlayerProfileLink } from "@/components/player-profile-link";

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
  const styles: Record<GameStatus, string> = {
    waiting: "bg-yellow-900/40 text-yellow-400 border border-yellow-900/60",
    in_progress: "bg-blue-900/40 text-blue-400 border border-blue-900/60",
    completed: "bg-green-900/40 text-green-400 border border-green-900/60",
    cancelled: "bg-red-900/40 text-red-400 border border-red-900/60",
    suspended: "bg-amber-900/40 text-amber-300 border border-amber-900/60",
  };
  const labels: Record<GameStatus, string> = {
    waiting: "Open",
    in_progress: "Live",
    completed: "Done",
    cancelled: "Void",
    suspended: "Failed",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}
    >
      {labels[status]}
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
        Next {ACTIVE_GAME.name} game in
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

export function QueueSection({
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
          Sign in to queue your agent for tonight&apos;s {ACTIVE_GAME.name} game.
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
    const otherAgents = agents.filter((agent) => agent.id !== queueStatus.userEntry!.agentProfileId);
    return (
      <div className="influence-panel rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-phase text-sm font-medium mb-1">
              You&apos;re in the {ACTIVE_GAME.queueLabel}
            </p>
            <p className="text-text-primary text-lg font-semibold">
              {queueStatus.userEntry!.agentName}
            </p>
            {queueStatus.relevantGame && (
              <Link
                href={`/games/${queueStatus.relevantGame.slug ?? queueStatus.relevantGame.id}`}
                className="mt-1 inline-block text-xs text-phase hover:underline"
              >
                View current game
              </Link>
            )}
          </div>
          <button
            onClick={onLeave}
            disabled={actionLoading}
            className="influence-button-danger text-xs px-4 py-2 rounded-lg"
          >
            {actionLoading ? "Leaving..." : "Leave queue"}
          </button>
        </div>
        {otherAgents.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="influence-field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
              aria-label="Switch Daily Free agent"
            >
              <option value="">Choose another agent</option>
              {otherAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => onJoin(selectedAgentId)}
              disabled={!selectedAgentId || actionLoading}
              className="influence-button-secondary rounded-lg px-4 py-2 text-xs font-semibold"
            >
              {actionLoading ? "Switching..." : "Switch agent"}
            </button>
          </div>
        )}
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
          Create an agent to join the {ACTIVE_GAME.queueLabel}.
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
        Select an agent for the {ACTIVE_GAME.queueLabel}
      </p>
      <div className="grid gap-2 mb-4">
        {agents.map((agent) => {
          const personaLabel = getPersonaLabel(agent.personaKey);
          const isSelected = selectedAgentId === agent.id;
          return (
            <div
              key={agent.id}
              className="influence-selection-card flex items-center gap-2 rounded-lg p-2 text-left transition-colors [&>button:first-child]:p-1.5"
              data-selected={isSelected}
            >
              <AgentAvatarPreview
                avatarUrl={agent.avatarUrl}
                personaKey={agent.personaKey}
                name={agent.name}
                gamesPlayed={agent.gamesPlayed}
                gamesWon={agent.gamesWon}
                size="8"
              />
              <button
                type="button"
                onClick={() => setSelectedAgentId(agent.id)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-phase/70"
                aria-pressed={isSelected}
                aria-label={`Select ${agent.name}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm font-medium truncate">
                    {agent.name}
                  </p>
                  <p className="influence-copy-muted text-xs truncate">
                    {personaLabel}
                  </p>
                </div>
                {isSelected && (
                  <span className="text-phase text-xs font-medium shrink-0">
                    Selected
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => onJoin(selectedAgentId)}
        disabled={!selectedAgentId || actionLoading}
        className="influence-button-primary w-full px-6 py-3 rounded-lg text-sm font-medium"
      >
        {actionLoading ? "Joining..." : `Join ${ACTIVE_GAME.name} Queue`}
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
  const isSuspended = todayGame.status === "suspended";

  return (
    <section>
      <h2 className="influence-section-title mb-3">
        Today&apos;s {ACTIVE_GAME.name} Game
      </h2>
      <div className="influence-panel rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-text-primary font-semibold">
              {todayGame.slug}
            </span>
            <StatusBadge status={todayGame.status} />
          </div>
          <Link
            href={`/games/${todayGame.slug}`}
            className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg"
          >
            {isLive ? "Watch" : isDone ? "Replay" : isSuspended ? "Inspect" : "View"}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export function Leaderboard({
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
        No ratings yet. Play some {ACTIVE_GAME.name} free games to appear on
        the leaderboard.
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
            <tr
              key={entry.player?.publicId ?? `${entry.rank}:${entry.displayName}`}
              className="influence-table-row"
            >
              <td className="py-3 px-4 influence-copy text-sm font-mono">
                {entry.rank}
              </td>
              <td className="py-3 px-4">
                <PlayerProfileLink
                  player={entry.player}
                  className="text-text-primary text-sm font-medium truncate hover:text-phase hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/70"
                >
                  {entry.displayName}
                </PlayerProfileLink>
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

export function SeasonStandings({
  dashboard,
  loading,
  seasons,
  onSelectSeason,
}: {
  dashboard: SeasonDashboard | null;
  loading: boolean;
  seasons: SeasonIdentity[];
  onSelectSeason: (slug: string) => void;
}) {
  const [tab, setTab] = useState<"agents" | "architects">("agents");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = ["agents", "architects"] as const;

  function moveTab(current: typeof tab, direction: -1 | 1) {
    const currentIndex = tabs.indexOf(current);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    setTab(next);
    tabRefs.current[nextIndex]?.focus();
  }

  if (loading) {
    return <div className="influence-empty-state rounded-xl p-8 text-center text-sm">Loading season standings...</div>;
  }
  if (!dashboard) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center">
        <p className="text-sm text-text-primary">No championship season is published yet.</p>
        <p className="influence-copy-muted mt-1 text-xs">Daily games still run; their account rating remains available below.</p>
      </div>
    );
  }

  const empty = tab === "agents"
    ? dashboard.agentStandings.length === 0
    : dashboard.architectStandings.length === 0;
  const agentChampionOwnerId = dashboard.honors?.agentChampion.owner?.publicId;
  const architectChampionOwnerId = dashboard.honors?.architectChampion.owner?.publicId;
  const isDualCrown = Boolean(
    agentChampionOwnerId
    && architectChampionOwnerId
    && agentChampionOwnerId === architectChampionOwnerId,
  );
  return (
    <div className="influence-panel overflow-hidden rounded-xl">
      <div className="flex flex-col gap-4 border-b border-border-active/60 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-phase">
            {dashboard.season.status === "active" ? "Season live" : dashboard.season.status}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-text-primary">{dashboard.season.name}</h2>
          <p className="influence-copy-muted mt-1 text-xs">Wins lead. Every eligible finish adds to the ledger.</p>
          {seasons.length > 1 && (
            <label className="mt-3 inline-flex items-center gap-2 text-xs influence-copy-muted">
              Season
              <select
                value={dashboard.season.slug}
                onChange={(event) => onSelectSeason(event.target.value)}
                className="rounded-md border border-border-active bg-surface-raised px-2 py-1.5 text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-phase/70"
              >
                {seasons.map((season) => <option key={season.id} value={season.slug}>{season.name} · {season.status}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-border-active bg-black/20 p-1" role="tablist" aria-label="Championship standings">
          {tabs.map((value, index) => (
            <button
              key={value}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls={`season-${value}-panel`}
              id={`season-${value}-tab`}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); moveTab(value, -1); }
                if (event.key === "ArrowRight") { event.preventDefault(); moveTab(value, 1); }
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/70 data-[active=true]:bg-white/10 data-[active=true]:text-text-primary text-text-secondary"
              data-active={tab === value}
            >
              {value === "agents" ? "Agent Crown" : "Architect Crown"}
            </button>
          ))}
        </div>
      </div>

      {dashboard.honors && (
        <div className="grid gap-px border-b border-border-active/60 bg-border-active sm:grid-cols-2">
          <CrownHonor
            label="Agent Champion"
            winner={dashboard.honors.agentChampion.agentName}
            detail={(
              <>
                {dashboard.honors.agentChampion.points} points ·{" "}
                <PlayerProfileLink
                  player={dashboard.honors.agentChampion.owner}
                  className="hover:text-phase hover:underline"
                >
                  {dashboard.honors.agentChampion.ownerName ?? "Anonymous architect"}
                </PlayerProfileLink>
              </>
            )}
          />
          <CrownHonor
            label="Architect Champion"
            winner={(
              <PlayerProfileLink
                player={dashboard.honors.architectChampion.owner}
                className="hover:text-phase hover:underline"
              >
                {dashboard.honors.architectChampion.ownerName ?? "Anonymous architect"}
              </PlayerProfileLink>
            )}
            detail={`${(dashboard.honors.architectChampion.pointsHundredths / 100).toFixed(2)} weighted points${isDualCrown ? " · Dual Crown sweep" : ""}`}
          />
        </div>
      )}

      {empty ? (
        <div className="p-8 text-center text-sm influence-copy-muted">No eligible results in this season yet.</div>
      ) : tab === "agents" ? (
        <div id="season-agents-panel" className="overflow-x-auto" role="tabpanel" aria-labelledby="season-agents-tab">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-border-active/60">
              {['Rank', 'Agent', 'Points', 'Wins', 'Games', 'Finish score'].map((label) => (
                <th key={label} className="influence-table-header px-4 py-3 text-left text-xs font-medium">{label}</th>
              ))}
            </tr></thead>
            <tbody>{dashboard.agentStandings.map((standing) => (
              <tr key={standing.agentId} className="influence-table-row group">
                <td className="px-4 py-3 font-mono text-lg text-white/45" aria-label={`Rank ${standing.rank}`}>{String(standing.rank).padStart(2, '0')}</td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium text-text-primary">{standing.agentName}</span>
                  <div className="influence-copy-muted text-xs">
                    <PlayerProfileLink
                      player={standing.owner}
                      className="hover:text-phase hover:underline"
                    >
                      {standing.ownerName ?? "Anonymous architect"}
                    </PlayerProfileLink>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-base font-semibold text-text-primary">{standing.totalPoints}</td>
                <td className="px-4 py-3 text-sm influence-copy">{standing.wins}</td>
                <td className="px-4 py-3 text-sm influence-copy-muted">{standing.gamesPlayed}</td>
                <td className="px-4 py-3 text-sm influence-copy-muted">{(standing.averageNormalizedPlacement * 100).toFixed(0)}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div id="season-architects-panel" className="divide-y divide-border-active/50" role="tabpanel" aria-labelledby="season-architects-tab">
          {dashboard.architectStandings.map((standing) => (
            <article
              key={standing.owner?.publicId ?? `${standing.rank}:${standing.ownerName ?? "anonymous"}`}
              className="group grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] sm:grid-cols-[3rem_1fr_auto] sm:items-center"
            >
              <div className="font-mono text-lg text-white/45" aria-label={`Rank ${standing.rank}`}>{String(standing.rank).padStart(2, '0')}</div>
              <div>
                <h3 className="text-sm font-medium text-text-primary">
                  <PlayerProfileLink
                    player={standing.owner}
                    className="hover:text-phase hover:underline"
                  >
                    {standing.ownerName ?? "Anonymous architect"}
                  </PlayerProfileLink>
                </h3>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {standing.contributions.map((item) => (
                    <span key={item.agentId} className="text-xs influence-copy-muted">
                      {item.agentName} <span className="font-mono text-white/55">{item.sourcePoints} × {item.weightPercent}%</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="font-mono text-lg font-semibold text-text-primary">{(standing.totalPointsHundredths / 100).toFixed(2)}</div>
                <div className="influence-copy-muted text-[11px] uppercase tracking-wider">weighted points</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function CrownHonor({
  label,
  winner,
  detail,
}: {
  label: string;
  winner: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-phase">{label}</div>
      <div className="mt-1 text-base font-semibold text-text-primary">{winner}</div>
      <div className="influence-copy-muted mt-1 text-xs">{detail}</div>
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
  const [seasonDashboard, setSeasonDashboard] = useState<SeasonDashboard | null>(null);
  const [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [seasonError, setSeasonError] = useState<string | null>(null);
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

  const fetchSeason = useCallback(async (requestedSlug?: string) => {
    try {
      const nextSeasons = await listSeasons();
      setSeasons(nextSeasons);
      const urlSelection = requestedSlug
        ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("season") ?? undefined : undefined);
      const selected = nextSeasons.find((season) => season.slug === urlSelection || season.id === urlSelection)
        ?? nextSeasons.find((season) => season.status === "active")
        ?? nextSeasons.find((season) => season.status === "closing")
        ?? nextSeasons.find((season) => season.status === "final")
        ?? nextSeasons[0];
      setSeasonDashboard(selected ? await getSeasonDashboard(selected.slug) : null);
      setSeasonError(null);
    } catch (err) {
      console.warn("[FreeGameContent] Failed to load season standings:", err);
      setSeasonDashboard(null);
      setSeasonError("Failed to load season standings.");
    } finally {
      setSeasonLoading(false);
    }
  }, []);

  function selectSeason(slug: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("season", slug);
    window.history.replaceState({}, "", url);
    setSeasonLoading(true);
    void fetchSeason(slug);
  }

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
    fetchSeason();
    fetchAgents();

    const interval = setInterval(() => {
      fetchQueueStatus();
      fetchLeaderboard();
      fetchSeason();
    }, 15000);

    const onSessionReady = () => {
      fetchQueueStatus();
      fetchAgents();
    };
    const onQueueChanged = () => { fetchQueueStatus(); };
    window.addEventListener("auth:session-ready", onSessionReady);
    window.addEventListener("free-queue:changed", onQueueChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener("auth:session-ready", onSessionReady);
      window.removeEventListener("free-queue:changed", onQueueChanged);
    };
  }, [fetchQueueStatus, fetchLeaderboard, fetchSeason, fetchAgents]);

  async function handleJoin(agentProfileId: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      await joinFreeQueue(agentProfileId);
      window.dispatchEvent(new Event("free-queue:changed"));
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
      window.dispatchEvent(new Event("free-queue:changed"));
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
                tonight&apos;s {ACTIVE_GAME.name} game
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
          {ACTIVE_GAME.name} Queue
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

      {/* Championship standings */}
      <section>
        <h2 className="influence-section-title mb-3">
          Dual Crown Championship
        </h2>
        {seasonError && !seasonLoading ? (
          <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
            <p className="text-red-400 text-sm">{seasonError}</p>
          </div>
        ) : (
          <SeasonStandings
            dashboard={seasonDashboard}
            loading={seasonLoading}
            seasons={seasons}
            onSelectSeason={selectSeason}
          />
        )}
      </section>

      <details className="group">
        <summary className="cursor-pointer list-none influence-copy-muted text-xs transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-phase/70">
          Account free-track ELO <span aria-hidden="true" className="ml-1 group-open:hidden">+</span><span aria-hidden="true" className="ml-1 hidden group-open:inline">−</span>
        </summary>
        <div className="mt-3">
          {leaderboardError && !leaderboardLoading ? (
            <div className="rounded-xl p-6 text-center border border-red-400/30 bg-red-400/10"><p className="text-red-400 text-sm">{leaderboardError}</p></div>
          ) : <Leaderboard entries={leaderboard} loading={leaderboardLoading} />}
        </div>
      </details>
    </div>
  );
}
