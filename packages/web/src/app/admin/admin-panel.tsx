"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import type { GameSummary } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    lobby: "LOBBY",
    discussion: "DISCUSS",
    whisper: "WHISPER",
    vote: "VOTE",
    reveal: "REVEAL",
    power: "POWER",
    jury_vote: "JURY VOTE",
    jury_questions: "JURY Q&A",
    finals_speech: "FINALS",
    done: "DONE",
  };
  return labels[phase] ?? phase.toUpperCase();
}

function progressPct(game: GameSummary): number {
  if (game.maxRounds === 0) return 0;
  return Math.round((game.currentRound / game.maxRounds) * 100);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Game card (in_progress)
// ---------------------------------------------------------------------------

function GameCard({ game }: { game: GameSummary }) {
  const pct = progressPct(game);

  return (
    <div className="border border-white/10 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-white font-semibold">#{game.gameNumber}</span>
          <span className="text-white/50 text-sm">
            {game.playerCount}-player · Round {game.currentRound}/{game.maxRounds} ·{" "}
            {capitalize(game.modelTier)}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 font-mono">
            {phaseLabel(game.currentPhase)}
          </span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full mb-2 overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span>👥 {game.alivePlayers} alive</span>
          <span>💀 {game.eliminatedPlayers} elim</span>
          {game.phaseTimeRemaining != null && (
            <span>⏱ {Math.round(game.phaseTimeRemaining / 1000)}s remain</span>
          )}
          {game.finalists && <span>Finalists: {game.finalists.join(", ")}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href={`/games/${game.id}`}
          className="text-xs border border-white/15 hover:border-white/30 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          View
        </Link>
        <button
          onClick={() => alert(`Stop game ${game.id} — API not yet available`)}
          className="text-xs border border-red-900/50 hover:border-red-700 text-red-400/70 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          ⏹ Stop
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting game card
// ---------------------------------------------------------------------------

function WaitingGameCard({ game }: { game: GameSummary }) {
  return (
    <div className="border border-white/10 rounded-xl p-5 flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-white font-semibold">#{game.gameNumber}</span>
          <span className="text-white/50 text-sm">
            {game.playerCount}-player · Not started · {capitalize(game.modelTier)}
          </span>
        </div>
        <p className="text-xs text-white/30">Waiting to start</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href={`/games/${game.id}`}
          className="text-xs border border-white/15 hover:border-white/30 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          View
        </Link>
        <button
          onClick={() => alert(`Start game ${game.id} — API not yet available`)}
          className="text-xs border border-green-900/50 hover:border-green-700 text-green-400/70 hover:text-green-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          ▶ Start
        </button>
        <button
          onClick={() => alert(`Delete game ${game.id} — API not yet available`)}
          className="text-xs border border-white/10 hover:border-red-700 text-white/30 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent game row
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: GameSummary["status"] }) {
  const styles: Record<GameSummary["status"], string> = {
    waiting: "bg-yellow-900/40 text-yellow-400",
    in_progress: "bg-blue-900/40 text-blue-400",
    complete: "bg-green-900/40 text-green-400",
    stopped: "bg-red-900/40 text-red-400",
  };
  const labels: Record<GameSummary["status"], string> = {
    waiting: "waiting",
    in_progress: "live",
    complete: "done",
    stopped: "void",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function RecentGameRow({ game }: { game: GameSummary }) {
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="py-3 px-4 text-white/60 text-sm">#{game.gameNumber}</td>
      <td className="py-3 px-4 text-white text-sm">
        {game.winner ? (
          <span>
            {game.winner}{" "}
            <span className="text-white/40 text-xs">({game.winnerPersona})</span>
          </span>
        ) : (
          <span className="text-white/30 italic">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">{game.playerCount}p</td>
      <td className="py-3 px-4 text-white/50 text-sm">{game.currentRound}</td>
      <td className="py-3 px-4 text-white/50 text-sm">{capitalize(game.modelTier)}</td>
      <td className="py-3 px-4 text-white/40 text-xs">{date}</td>
      <td className="py-3 px-4">
        <StatusBadge status={game.status} />
      </td>
      <td className="py-3 px-4">
        <Link
          href={`/games/${game.id}`}
          className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
        >
          View →
        </Link>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function AdminPanel() {
  const { address } = useAccount();

  // No real data yet — API integration pending (INF-42, INF-44)
  const activeGames: GameSummary[] = [];
  const waitingGames: GameSummary[] = [];
  const recentGames: GameSummary[] = [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Influence Admin</h1>
          <p className="text-white/40 text-sm mt-1">Game operations dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          {address && (
            <span className="text-xs text-white/30 font-mono">👛 {shortAddr(address)}</span>
          )}
          <Link
            href="/admin/games/new"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            + New Game
          </Link>
        </div>
      </div>

      {/* Active games */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Active Games ({activeGames.length})
        </h2>
        {activeGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No active games.
          </div>
        ) : (
          <div className="space-y-3">
            {activeGames.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </section>

      {/* Waiting to start */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Waiting to Start ({waitingGames.length})
        </h2>
        {waitingGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No games waiting.{" "}
            <Link
              href="/admin/games/new"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Create one →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {waitingGames.map((g) => (
              <WaitingGameCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </section>

      {/* Recent games */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            Recent Games
          </h2>
          <Link
            href="/admin/games"
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View all →
          </Link>
        </div>
        {recentGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No completed games yet.
          </div>
        ) : (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  {["#", "Winner", "Players", "Rounds", "Model", "Date", "Status", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left py-3 px-4 text-xs text-white/30 font-medium"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recentGames.slice(0, 5).map((g) => (
                  <RecentGameRow key={g.id} game={g} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
