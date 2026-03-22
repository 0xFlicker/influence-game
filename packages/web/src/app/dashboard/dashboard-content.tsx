"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { getAuthToken, getPlayerGames, listAgents, type GameSummary, type PlayerGameResult, type SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
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
      <span className="text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-900/60 px-2 py-0.5 rounded-full font-medium">
        🏆 Winner
      </span>
    );
  }
  const suffix = result.placement === 2 ? "nd" : result.placement === 3 ? "rd" : "th";
  return (
    <span className="text-xs bg-white/5 text-white/50 border border-white/10 px-2 py-0.5 rounded-full">
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
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/30 text-sm">
        No games played yet. Join a game below to get started.
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            {["#", "Agent", "Persona", "Placement", "Rounds", "Tier", "Date", ""].map((h) => (
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
          {history.map((r) => (
            <tr
              key={r.gameId}
              className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
            >
              <td className="py-3 px-4 text-white/50 text-sm">#{r.gameNumber}</td>
              <td className="py-3 px-4 text-white text-sm font-medium">{r.agentName}</td>
              <td className="py-3 px-4 text-white/50 text-sm">{capitalize(r.persona)}</td>
              <td className="py-3 px-4">
                <PlacementBadge result={r} />
              </td>
              <td className="py-3 px-4 text-white/40 text-sm">{r.rounds}</td>
              <td className="py-3 px-4 text-white/40 text-sm">{capitalize(r.modelTier)}</td>
              <td className="py-3 px-4 text-white/30 text-xs">{shortDate(r.completedAt)}</td>
              <td className="py-3 px-4">
                <Link
                  href={`/games/${r.gameSlug ?? r.gameId}`}
                  className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
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

  useEffect(() => {
    if (!getAuthToken()) {
      setLoading(false);
      return;
    }
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="border border-white/10 rounded-xl p-6 text-center text-white/20 text-sm">
        Loading...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="border border-dashed border-white/10 rounded-xl p-6 text-center">
        <p className="text-white/30 text-sm mb-2">No saved agents yet</p>
        <p className="text-white/20 text-xs mb-3">
          Create agents with rich backstories and personalities to quickly join games.
        </p>
        <Link
          href="/dashboard/agents"
          className="inline-block text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Create your first agent
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {agents.slice(0, 3).map((agent) => {
          const persona = PERSONAS.find((p) => p.key === agent.personaKey);
          return (
            <div
              key={agent.id}
              className="border border-white/10 rounded-lg px-4 py-3 flex items-center gap-3 overflow-hidden"
            >
              <span className="text-lg">{persona?.icon ?? "?"}</span>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{agent.name}</p>
                <p className="text-white/30 text-xs truncate">{agent.backstory}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {agent.gamesPlayed > 0 && (
                  <span className="text-white/30 text-xs">
                    {agent.gamesWon}W / {agent.gamesPlayed - agent.gamesWon}L
                  </span>
                )}
                {agent.freeTrackRating && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-900/40">
                    ELO {agent.freeTrackRating.rating}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {agents.length > 3 && (
        <p className="text-white/25 text-xs">+{agents.length - 3} more</p>
      )}
      <Link
        href="/dashboard/agents"
        className="inline-block text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
      >
        Manage agents →
      </Link>
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

  useEffect(() => {
    function fetchHistory() {
      if (!getAuthToken()) return;
      setHistoryLoading(true);
      getPlayerGames()
        .then(setHistory)
        .catch(() => {
          // Not fatal — user may not have played any games yet
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
            <h1 className="text-3xl font-bold text-white mb-1">Dashboard</h1>
            <p className="text-white/40 text-sm">
              {user?.email?.address ?? user?.wallet?.address?.slice(0, 10) ?? "Player"}
            </p>
          </div>
          {played > 0 && (
            <div className="flex gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-white">{played}</p>
                <p className="text-xs text-white/30">Games</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-400">{wins}</p>
                <p className="text-xs text-white/30">Wins</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">
                  {played > 0 ? Math.round((wins / played) * 100) : 0}%
                </p>
                <p className="text-xs text-white/30">Win rate</p>
              </div>
            </div>
          )}
        </div>

        {/* Open games to join */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Open Games
            </h2>
            <Link
              href="/games"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
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
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
            Your History
          </h2>
          {historyLoading ? (
            <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
              Loading…
            </div>
          ) : (
            <HistorySection history={history} />
          )}
        </section>

        {/* Saved agents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Your Agents
            </h2>
            <Link
              href="/dashboard/agents"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Manage →
            </Link>
          </div>
          <SavedAgentsSection />
        </section>
      </div>
    </>
  );
}
