"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { getAuthToken, getPlayerGames, type GameSummary, type PlayerGameResult, type PersonaKey } from "@/lib/api";
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
// Agent defaults section
// ---------------------------------------------------------------------------

function AgentDefaultsSection() {
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // TODO: persist to API once /api/player/agent-config is available
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={handleSave} className="border border-white/10 rounded-xl p-6 space-y-4">
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Default Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Phantom-9"
          maxLength={32}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Default Personality
        </label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="How should your agent behave by default?"
          rows={3}
          maxLength={500}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {saved ? "✓ Saved" : "Save defaults"}
        </button>
        <p className="text-white/25 text-xs">
          These pre-fill the agent config when you join a game.
        </p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function DashboardContent() {
  const { user, authenticated, login } = usePrivy();
  const [joinTarget, setJoinTarget] = useState<GameSummary | null>(null);
  const [joinedGameIds, setJoinedGameIds] = useState<Set<string>>(new Set());
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
    setJoinTarget(game);
  }

  function handleJoinSuccess(gameId: string) {
    setJoinedGameIds((prev) => new Set([...prev, gameId]));
    setJoinTarget(null);
  }

  return (
    <>
      {/* Join modal */}
      {joinTarget && (
        <JoinGameModal
          game={joinTarget}
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

        {/* Agent defaults */}
        <section>
          <div className="mb-3">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Agent Defaults
            </h2>
          </div>
          <AgentDefaultsSection />
        </section>
      </div>
    </>
  );
}
