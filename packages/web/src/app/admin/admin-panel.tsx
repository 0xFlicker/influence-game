"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { listGames, stopGame, startGame, fillGame, isFillAccepted, hideGame, type GameSummary, type WsGameEvent } from "@/lib/api";
import { useGameWebSocket } from "@/app/games/[slug]/components/use-game-websocket";
import { usePermissions } from "@/hooks/use-permissions";
import { TruncatedAddress } from "@/components/truncated-address";

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

function GameCard({ game, onRefresh, canStop }: { game: GameSummary; onRefresh: () => void; canStop: boolean }) {
  const pct = progressPct(game);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await stopGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStopping(false);
    }
  }

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
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/games/${game.slug ?? game.id}`}
            className="text-xs border border-white/15 hover:border-white/30 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            View
          </Link>
          {canStop && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="text-xs border border-red-900/50 hover:border-red-700 text-red-400/70 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {stopping ? "…" : "⏹ Stop"}
            </button>
          )}
        </div>
        {actionError && (
          <p className="text-xs text-red-400/80">{actionError}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting game card
// ---------------------------------------------------------------------------

function WaitingGameCard({ game, onRefresh, canStart, canFill, canStop, canHide }: { game: GameSummary; onRefresh: () => void; canStart: boolean; canFill: boolean; canStop: boolean; canHide: boolean }) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [filling, setFilling] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleWsEvent = useCallback(
    (ev: WsGameEvent) => {
      if (ev.type === "players_filled") {
        setFilling(false);
        onRefresh();
      }
    },
    [onRefresh],
  );

  // Connect to game WS only while filling to receive players_filled confirmation
  useGameWebSocket(game.id, filling, handleWsEvent);

  async function handleFill() {
    setActionError(null);
    setFilling(true);
    try {
      const result = await fillGame(game.id);
      if (isFillAccepted(result)) {
        // Async path: stay in filling state, WS will confirm
        return;
      }
      // Sync path (legacy): fill completed immediately
      setFilling(false);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setFilling(false);
    }
  }

  async function handleStart() {
    setActionError(null);
    setStarting(true);
    try {
      await startGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await stopGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStopping(false);
    }
  }

  async function handleHide() {
    setActionError(null);
    setHiding(true);
    try {
      await hideGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setHiding(false);
    }
  }

  return (
    <div className="border border-white/10 rounded-xl p-5 flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-white font-semibold">#{game.gameNumber}</span>
          <span className="text-white/50 text-sm">
            {game.playerCount}-player · {filling ? `${game.playerCount}/${game.playerCount} slots filled` : "Not started"} · {capitalize(game.modelTier)}
          </span>
          {filling && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-400 animate-pulse">
              Generating AI players…
            </span>
          )}
        </div>
        <p className="text-xs text-white/30">
          {filling ? "AI personas being generated — game will be ready shortly" : "Waiting to start"}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {actionError && (
          <p className="text-xs text-red-400/80">{actionError}</p>
        )}
        <div className="flex items-center gap-2">
          <Link
            href={`/games/${game.slug ?? game.id}`}
            className="text-xs border border-white/15 hover:border-white/30 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            View
          </Link>
          {canFill && !filling && (
            <button
              onClick={handleFill}
              className="text-xs border border-indigo-900/50 hover:border-indigo-700 text-indigo-400/70 hover:text-indigo-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Fill AI
            </button>
          )}
          {canStart && (
            <button
              onClick={handleStart}
              disabled={starting || filling}
              className="text-xs border border-green-900/50 hover:border-green-700 text-green-400/70 hover:text-green-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {starting ? "…" : "▶ Start"}
            </button>
          )}
          {canStop && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="text-xs border border-white/10 hover:border-red-700 text-white/30 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {stopping ? "…" : "🗑"}
            </button>
          )}
          {canHide && (
            <button
              onClick={handleHide}
              disabled={hiding}
              title="Hide from public lists"
              className="text-xs border border-white/10 hover:border-orange-700 text-white/30 hover:text-orange-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {hiding ? "…" : "Hide"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent game row
// ---------------------------------------------------------------------------

function StatusBadge({ status, errorInfo }: { status: GameSummary["status"]; errorInfo?: string }) {
  const styles: Record<GameSummary["status"], string> = {
    waiting: "bg-yellow-900/40 text-yellow-400",
    in_progress: "bg-blue-900/40 text-blue-400",
    completed: "bg-green-900/40 text-green-400",
    cancelled: "bg-red-900/40 text-red-400",
  };
  const labels: Record<GameSummary["status"], string> = {
    waiting: "waiting",
    in_progress: "live",
    completed: "done",
    cancelled: "void",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}
      title={status === "cancelled" && errorInfo ? `Error: ${errorInfo}` : undefined}
    >
      {labels[status]}
      {status === "cancelled" && errorInfo ? " ⚠" : ""}
    </span>
  );
}

function RecentGameRow({ game, canHide, onRefresh }: { game: GameSummary; canHide: boolean; onRefresh: () => void }) {
  const [hiding, setHiding] = useState(false);
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleHide() {
    setHiding(true);
    try {
      await hideGame(game.id);
      onRefresh();
    } catch {
      setHiding(false);
    }
  }

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
        <StatusBadge status={game.status} errorInfo={game.errorInfo} />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/games/${game.slug ?? game.id}`}
            className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
          >
            View →
          </Link>
          {canHide && (
            <button
              onClick={handleHide}
              disabled={hiding}
              title="Hide from public lists"
              className="text-white/20 hover:text-orange-400 text-xs transition-colors disabled:opacity-50"
            >
              {hiding ? "…" : "Hide"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function AdminPanel() {
  const { address } = useAccount();
  const { hasPermission } = usePermissions();

  const canCreateGame = hasPermission("create_game");
  const canStartGame = hasPermission("start_game");
  const canStopGame = hasPermission("stop_game");
  const canFillGame = hasPermission("fill_game");
  const canHideGame = hasPermission("hide_game");

  const [activeGames, setActiveGames] = useState<GameSummary[]>([]);
  const [waitingGames, setWaitingGames] = useState<GameSummary[]>([]);
  const [recentGames, setRecentGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    setError(null);
    try {
      const all = await listGames();
      setActiveGames(all.filter((g) => g.status === "in_progress"));
      setWaitingGames(all.filter((g) => g.status === "waiting"));
      setRecentGames(
        all
          .filter((g) => g.status === "completed" || g.status === "cancelled")
          .sort(
            (a, b) =>
              new Date(b.completedAt ?? b.createdAt).getTime() -
              new Date(a.completedAt ?? a.createdAt).getTime(),
          ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGames();
    // Poll every 10s while active games exist
    const interval = setInterval(fetchGames, 10000);
    return () => clearInterval(interval);
  }, [fetchGames]);

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
            <span className="text-xs text-white/30 font-mono">👛 <TruncatedAddress address={address} maxWidth="10ch" /></span>
          )}
          {canCreateGame && (
            <Link
              href="/admin/games/new"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              + New Game
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 border border-red-900/40 bg-red-900/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Active games */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Active Games ({activeGames.length})
        </h2>
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : activeGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No active games.
          </div>
        ) : (
          <div className="space-y-3">
            {activeGames.map((g) => (
              <GameCard key={g.id} game={g} onRefresh={fetchGames} canStop={canStopGame} />
            ))}
          </div>
        )}
      </section>

      {/* Waiting to start */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Waiting to Start ({waitingGames.length})
        </h2>
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : waitingGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No games waiting.{" "}
            {canCreateGame && (
              <Link
                href="/admin/games/new"
                className="text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Create one →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {waitingGames.map((g) => (
              <WaitingGameCard key={g.id} game={g} onRefresh={fetchGames} canStart={canStartGame} canFill={canFillGame} canStop={canStopGame} canHide={canHideGame} />
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
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : recentGames.length === 0 ? (
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
                  <RecentGameRow key={g.id} game={g} canHide={canHideGame} onRefresh={fetchGames} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
