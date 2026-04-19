"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { getAuthToken, getPlayerGames, listAgents, type GameSummary, type PlayerGameResult, type SavedAgent } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { GamesBrowser } from "@/app/games/games-browser";
import { JoinGameModal } from "./join-game-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function PlacementBadge({ result }: { result: PlayerGameResult }) {
  if (result.winner) {
    return (
      <span className="influence-chip influence-chip-accent text-xs px-2 py-0.5 font-medium">
        🏆<span className="hidden lg:inline"> Winner</span>
      </span>
    );
  }
  const suffix = result.placement === 2 ? "nd" : result.placement === 3 ? "rd" : "th";
  return (
    <span className="influence-chip text-xs px-2 py-0.5">
      {result.placement}{suffix} / {result.totalPlayers}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function HistorySection({ history }: { history: PlayerGameResult[] }) {
  if (history.length === 0) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
        No games played yet. Join a game below to get started.
      </div>
    );
  }

  return (
    <div className="influence-panel rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-active/60">
            <th className="hidden sm:table-cell influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium">#</th>
            <th className="influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium">Agent</th>
            <th className="hidden md:table-cell influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium">Persona</th>
            <th className="influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium">Placement</th>
            <th className="hidden md:table-cell influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium">Rounds</th>
            <th className="hidden lg:table-cell influence-table-header text-left py-3 px-4 text-xs font-medium">Tier</th>
            <th className="hidden lg:table-cell influence-table-header text-left py-3 px-4 text-xs font-medium">Date</th>
            <th className="influence-table-header text-left py-3 px-2 sm:px-4 text-xs font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.gameId} className="influence-table-row">
              <td className="hidden sm:table-cell py-3 px-2 sm:px-4 influence-copy text-sm">#{r.gameNumber}</td>
              <td className="py-3 px-2 sm:px-4 text-text-primary text-sm font-medium">{r.agentName}</td>
              <td className="hidden md:table-cell py-3 px-2 sm:px-4 influence-copy text-sm">{capitalize(r.persona)}</td>
              <td className="py-3 px-2 sm:px-4">
                <PlacementBadge result={r} />
              </td>
              <td className="hidden md:table-cell py-3 px-2 sm:px-4 influence-copy-muted text-sm">{r.rounds}</td>
              <td className="hidden lg:table-cell py-3 px-4 influence-copy-muted text-sm">{capitalize(r.modelTier)}</td>
              <td className="hidden lg:table-cell py-3 px-4 influence-copy-muted text-xs">{shortDate(r.completedAt)}</td>
              <td className="py-3 px-2 sm:px-4">
                <Link
                  href={`/games/${r.gameSlug ?? r.gameId}`}
                  className="influence-link text-xs"
                >
                  Replay →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved agents section
// ---------------------------------------------------------------------------

function SavedAgentsSection() {
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function fetchAgents() {
      if (!getAuthToken()) return;
      setLoading(true);
      setFetchError(null);
      listAgents()
        .then(setAgents)
        .catch((err) => {
          console.warn("[SavedAgentsSection] Failed to load agents:", err);
          setFetchError("Failed to load agents.");
        })
        .finally(() => setLoading(false));
    }

    // Fetch immediately if we already have a session token
    if (getAuthToken()) {
      fetchAgents();
    } else {
      setLoading(false);
    }

    // Also listen for when AuthSync finishes exchanging the Privy token
    window.addEventListener("auth:session-ready", fetchAgents);
    return () => window.removeEventListener("auth:session-ready", fetchAgents);
  }, []);

  if (loading) {
    return (
      <div className="influence-empty-state rounded-xl p-6 text-center text-sm">
        Loading...
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="border border-red-900/40 bg-red-900/10 rounded-xl p-6 text-center">
        <p className="text-red-400 text-sm">{fetchError}</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="influence-panel-dashed rounded-xl p-6 text-center">
        <p className="influence-copy text-sm mb-2">No saved agents yet</p>
        <p className="influence-copy-muted text-xs mb-3">
          Create agents with rich backstories and personalities to quickly join games.
        </p>
        <Link
          href="/dashboard/agents"
          className="influence-button-primary inline-block text-sm px-4 py-2 rounded-lg font-medium"
        >
          Create your first agent
        </Link>
      </div>
    );
  }

  const query = search.toLowerCase();
  const filtered = query
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.personaKey && a.personaKey.toLowerCase().includes(query)) ||
          (a.backstory && a.backstory.toLowerCase().includes(query))
      )
    : agents;

  return (
    <div className="space-y-3">
      {agents.length > 3 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="influence-field w-full text-xs px-3 py-2 rounded-lg"
        />
      )}
      <div className="grid gap-2">
        {filtered.slice(0, search ? filtered.length : 3).map((agent) => (
          <div
            key={agent.id}
            className="influence-panel-muted rounded-lg px-4 py-3 flex items-center gap-3 overflow-hidden"
          >
            <AgentAvatar
              avatarUrl={agent.avatarUrl}
              persona={agent.personaKey ?? "strategic"}
              name={agent.name}
              size="8"
            />
            <div className="min-w-0 flex-1">
              <p className="text-text-primary text-sm font-medium truncate">{agent.name}</p>
              <p className="influence-copy-muted text-xs truncate">{agent.backstory}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {agent.gamesPlayed > 0 && (
                <span className="influence-copy-muted text-xs">
                  {agent.gamesWon}W / {agent.gamesPlayed - agent.gamesWon}L
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {!search && filtered.length > 3 && (
        <p className="influence-copy-muted text-xs">+{filtered.length - 3} more</p>
      )}
      {search && filtered.length === 0 && (
        <p className="influence-copy-muted text-xs">No agents match &ldquo;{search}&rdquo;</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function DashboardContent() {
  const { user, authenticated, login } = usePrivy();
  const [joinTarget, setJoinTarget] = useState<{ game: GameSummary } | null>(null);
  const [, setJoinedGameIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<PlayerGameResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    function fetchHistory() {
      if (!getAuthToken()) return;
      setHistoryLoading(true);
      setHistoryError(null);
      getPlayerGames()
        .then(setHistory)
        .catch((err) => {
          console.warn("[DashboardContent] Failed to load game history:", err);
          setHistoryError("Failed to load game history.");
        })
        .finally(() => setHistoryLoading(false));
    }

    if (!authenticated) {
      setHistoryLoading(false);
      return;
    }

    // Fetch immediately if we already have a session token
    fetchHistory();

    // Also listen for when AuthSync finishes exchanging the Privy token
    window.addEventListener("auth:session-ready", fetchHistory);
    return () => window.removeEventListener("auth:session-ready", fetchHistory);
  }, [authenticated]);

  const wins = history.filter((h) => h.winner).length;
  const played = history.length;

  function handleJoinClick(game: GameSummary) {
    if (!authenticated) {
      login();
      return;
    }
    setJoinTarget({ game });
  }

  function handleJoinSuccess(gameId: string) {
    setJoinedGameIds((prev) => new Set([...prev, gameId]));
    setJoinTarget(null);
  }

  return (
    <>
      {joinTarget && (
        <JoinGameModal
          game={joinTarget.game}
          onClose={() => setJoinTarget(null)}
          onSuccess={handleJoinSuccess}
        />
      )}

      <div>
        {/* Page header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="influence-phase-title text-3xl font-bold mb-1">Dashboard</h1>
            <p className="influence-copy text-sm">
              {user?.email?.address ?? user?.wallet?.address?.slice(0, 10) ?? "Player"}
            </p>
          </div>
          {played > 0 && (
            <div className="influence-panel flex gap-4 rounded-xl px-4 py-3 text-center">
              <div>
                <p className="text-2xl font-bold text-text-primary">{played}</p>
                <p className="influence-copy-muted text-xs">Games</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-400">{wins}</p>
                <p className="influence-copy-muted text-xs">Wins</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">
                  {played > 0 ? Math.round((wins / played) * 100) : 0}%
                </p>
                <p className="influence-copy-muted text-xs">Win rate</p>
              </div>
            </div>
          )}
        </div>

        {/* Open games to join */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="influence-section-title">
              Open Games
            </h2>
            <Link href="/games" className="influence-link text-xs">
              View all →
            </Link>
          </div>
          <GamesBrowser
            onJoin={handleJoinClick}
            compact={false}
          />
        </section>

        {/* Game history */}
        <section className="mb-10">
          <h2 className="influence-section-title mb-3">
            Your History
          </h2>
          {historyLoading ? (
            <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
              Loading…
            </div>
          ) : historyError ? (
            <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
              <p className="text-red-400 text-sm">{historyError}</p>
            </div>
          ) : (
            <HistorySection history={history} />
          )}
        </section>

        {/* Saved agents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="influence-section-title">
              Your Agents
            </h2>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/agents?view=create"
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium"
              >
                + Create Agent
              </Link>
              <Link href="/dashboard/agents" className="influence-link text-xs">
                Manage →
              </Link>
            </div>
          </div>
          <SavedAgentsSection />
        </section>
      </div>
    </>
  );
}
