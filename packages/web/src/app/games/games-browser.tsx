"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fillGame,
  hideGame,
  isFillAccepted,
  listGames,
  startGame,
  stopGame,
  type FillGameResponse,
  type GameStatus,
  type GameSummary,
  type ModelTier,
  type TrackType,
  type WsGameEvent,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { useGameWebSocket } from "@/app/games/[slug]/components/use-game-websocket";

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function progressPct(game: GameSummary): number {
  if (game.maxRounds === 0) return 0;
  return Math.round((game.currentRound / game.maxRounds) * 100);
}

type StatusFilter = "all" | GameStatus;
type TierFilter = "all" | ModelTier;
type TrackFilter = "all" | TrackType;

interface FiltersState {
  status: StatusFilter;
  tier: TierFilter;
  track: TrackFilter;
  search: string;
}

interface GameCardProps {
  game: GameSummary;
  onJoin?: (game: GameSummary) => void;
  isAdmin?: boolean;
  canFill: boolean;
  canStart: boolean;
  canStop: boolean;
  canHide: boolean;
  onRefresh: () => Promise<void>;
  onGameUpdate: (gameId: string, updater: (game: GameSummary) => GameSummary) => void;
}

function GameCard({
  game,
  onJoin,
  isAdmin,
  canFill,
  canStart,
  canStop,
  canHide,
  onRefresh,
  onGameUpdate,
}: GameCardProps) {
  const router = useRouter();
  const isJoinable = game.status === "waiting";
  const isLive = game.status === "in_progress";
  const joinedPlayers = Math.min(game.alivePlayers, game.playerCount);
  const isReadyToStart = joinedPlayers >= game.playerCount;
  const slotsInfo = isJoinable ? `${joinedPlayers}/${game.playerCount} joined` : undefined;
  const pct = progressPct(game);

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [filling, setFilling] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyFilledState = useCallback(
    (result: Pick<FillGameResponse, "players" | "totalPlayers">) => {
      onGameUpdate(game.id, (current) => ({
        ...current,
        alivePlayers: Math.max(current.alivePlayers, result.totalPlayers),
      }));
    },
    [game.id, onGameUpdate],
  );

  const handleWsEvent = useCallback(
    (event: WsGameEvent) => {
      if (event.type === "players_filled") {
        applyFilledState(event);
        setFilling(false);
        void onRefresh();
      }

      if (event.type === "players_updated") {
        onGameUpdate(game.id, (current) => ({
          ...current,
          alivePlayers: Math.max(current.alivePlayers, event.players.length),
        }));
      }
    },
    [applyFilledState, game.id, onGameUpdate, onRefresh],
  );

  useGameWebSocket(game.id, filling, handleWsEvent);

  async function handleFill() {
    setActionError(null);
    setFilling(true);
    try {
      const result = await fillGame(game.id);
      if (isFillAccepted(result)) {
        applyFilledState(result);
        return;
      }

      applyFilledState(result);
      setFilling(false);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to fill game.");
      setFilling(false);
    }
  }

  async function handleStart() {
    setActionError(null);
    setStarting(true);
    try {
      await startGame(game.id);
      await onRefresh();
      setStarting(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start game.");
      setStarting(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await stopGame(game.id);
      await onRefresh();
      setStopping(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop game.");
      setStopping(false);
    }
  }

  async function handleHide() {
    setConfirmHide(false);
    setActionError(null);
    setHiding(true);
    try {
      await hideGame(game.id);
      await onRefresh();
      setHiding(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to hide game.");
      setHiding(false);
    }
  }

  return (
    <>
      <div
        onClick={() => router.push(`/games/${game.slug ?? game.id}`)}
        className="influence-panel rounded-xl p-5 transition-colors cursor-pointer"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-text-primary font-semibold">Game #{game.gameNumber}</span>
              <StatusBadge status={game.status} />
              {game.trackType === "free" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-900/60 font-medium">
                  Free
                </span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-raised/80 text-text-secondary font-mono border border-border-active/50">
                {phaseLabel(game.currentPhase)}
              </span>
              {filling && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-800/60 animate-pulse">
                  Filling seats…
                </span>
              )}
              {isJoinable && isReadyToStart && !filling && (canStart || canFill) && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-800/60">
                  Ready to start
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs influence-copy mb-3 flex-wrap">
              <span>{game.playerCount} players</span>
              <span>{capitalize(game.modelTier)} tier</span>
              {slotsInfo && (
                <span className={isReadyToStart ? "text-green-300/80" : "text-indigo-400/70"}>
                  {slotsInfo}
                </span>
              )}
              {isLive && (
                <>
                  <span>Round {game.currentRound}/{game.maxRounds}</span>
                  <span className="text-green-400/70">{game.alivePlayers} alive</span>
                  {game.phaseTimeRemaining != null && (
                    <span>{Math.round(game.phaseTimeRemaining / 1000)}s</span>
                  )}
                </>
              )}
              {game.status === "completed" && (
                <span className="text-emerald-400/70">Finished</span>
              )}
              {game.finalists && isLive && (
                <span>Finalists: {game.finalists.join(", ")}</span>
              )}
              <span className="influence-copy-muted">{timeAgo(game.createdAt)}</span>
            </div>

            {isLive && (
              <div className="h-1 bg-surface-raised rounded-full overflow-hidden max-w-xs">
                <div
                  className="h-full bg-phase/80 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            {isJoinable && filling && (
              <p className="influence-copy-muted text-xs mt-2">
                AI personas are being generated. Start will unlock here as soon as the game is full.
              </p>
            )}
            {isLive && !isAdmin && (
              <p className="influence-copy-muted text-xs mt-2">Replay available when game finishes</p>
            )}
            {actionError && (
              <p className="text-red-400/80 text-xs mt-2">{actionError}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {isJoinable && onJoin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onJoin(game);
                }}
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium"
              >
                Join
              </button>
            )}
            {isJoinable && canFill && !isReadyToStart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleFill();
                }}
                disabled={filling}
                className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {filling ? "Filling…" : "Fill AI"}
              </button>
            )}
            {isJoinable && canStart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleStart();
                }}
                disabled={starting || filling || !isReadyToStart}
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {starting ? "Starting…" : "Start"}
              </button>
            )}
            {canStop && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleStop();
                }}
                disabled={stopping}
                className="influence-button-danger text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {stopping ? "Stopping…" : isLive ? "End" : "Stop"}
              </button>
            )}
            {canHide && !isLive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmHide(true);
                }}
                disabled={hiding}
                className="influence-button-quiet text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {hiding ? "Hiding…" : "Hide"}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmHide && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-white text-sm mb-4">
              Hide game <strong>#{game.gameNumber}</strong> from public lists? It can be restored from Game History.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmHide(false)}
                className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleHide()}
                className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: GameStatus }) {
  const styles: Record<GameStatus, string> = {
    waiting: "bg-yellow-900/40 text-yellow-400 border border-yellow-900/60",
    in_progress: "bg-blue-900/40 text-blue-400 border border-blue-900/60",
    completed: "bg-green-900/40 text-green-400 border border-green-900/60",
    cancelled: "bg-red-900/40 text-red-400 border border-red-900/60",
  };
  const labels: Record<GameStatus, string> = {
    waiting: "Open",
    in_progress: "Live",
    completed: "Done",
    cancelled: "Void",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

interface GamesBrowserProps {
  onJoin?: (game: GameSummary) => void;
  compact?: boolean;
}

export function GamesBrowser({ onJoin, compact = false }: GamesBrowserProps) {
  const { isAdmin, hasPermission } = usePermissions();
  const [filters, setFilters] = useState<FiltersState>({ status: "all", tier: "all", track: "all", search: "" });
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshGames = useCallback(async () => {
    try {
      const data = await listGames();
      setGames(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchGames() {
      try {
        const data = await listGames();
        if (!cancelled) {
          setGames(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load games.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchGames();
    const interval = setInterval(() => {
      void fetchGames();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const updateGame = useCallback((gameId: string, updater: (game: GameSummary) => GameSummary) => {
    setGames((current) => current.map((game) => (game.id === gameId ? updater(game) : game)));
  }, []);

  const canCreate = hasPermission("create_game");
  const canFill = hasPermission("fill_game");
  const canStart = hasPermission("start_game");
  const canStop = hasPermission("stop_game");
  const canHide = hasPermission("hide_game");

  const STATUS_ORDER: Record<GameStatus, number> = {
    waiting: 0,
    in_progress: 1,
    completed: 2,
    cancelled: 3,
  };

  const searchQuery = filters.search.toLowerCase();
  const filtered = games
    .filter((g) => {
      if (filters.status !== "all" && g.status !== filters.status) return false;
      if (filters.tier !== "all" && g.modelTier !== filters.tier) return false;
      if (filters.track !== "all" && (g.trackType ?? "custom") !== filters.track) return false;
      if (searchQuery) {
        const haystack = `Game #${g.gameNumber} ${g.winner ?? ""} ${g.winnerPersona ?? ""} ${g.modelTier} ${g.trackType ?? ""}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "waiting", label: "Open" },
    { value: "in_progress", label: "Live" },
    { value: "completed", label: "Done" },
  ];

  const tierOptions: { value: TierFilter; label: string }[] = [
    { value: "all", label: "Any tier" },
    { value: "budget", label: "Budget" },
    { value: "standard", label: "Standard" },
    { value: "premium", label: "Premium" },
  ];

  if (loading) {
    return (
      <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
        Loading games…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-8 text-center text-red-400/70 text-sm border border-red-400/30 bg-red-400/10">
        {error}
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search games..."
            className="influence-field text-xs px-3 py-1.5 rounded-lg w-36"
          />

          <div className="flex rounded-lg overflow-hidden border border-border-active/60 bg-surface-raised/50">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilters((f) => ({ ...f, status: opt.value }))}
                className={`text-xs px-3 py-1.5 transition-colors border-r border-border-active/50 last:border-0 ${
                  filters.status === opt.value
                    ? "bg-phase/80 text-text-primary"
                    : "influence-copy hover:text-text-primary hover:bg-surface-raised/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={filters.tier}
            onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value as TierFilter }))}
            className="influence-field text-xs px-3 py-1.5 rounded-lg"
          >
            {tierOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#111118]">
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={filters.track}
            onChange={(e) => setFilters((f) => ({ ...f, track: e.target.value as TrackFilter }))}
            className="influence-field text-xs px-3 py-1.5 rounded-lg"
          >
            <option value="all" className="bg-[#111118]">Any track</option>
            <option value="custom" className="bg-[#111118]">Custom</option>
            <option value="free" className="bg-[#111118]">Free</option>
          </select>

          <div className="ml-auto flex items-center gap-3">
            {canCreate && (
              <Link
                href="/games/new"
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium"
              >
                + New Game
              </Link>
            )}
            <span className="influence-copy-muted text-xs">
              {filtered.length} game{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
          {games.length === 0 ? "No games yet." : "No games match the current filters."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onJoin={onJoin}
              isAdmin={isAdmin}
              canFill={canFill}
              canStart={canStart}
              canStop={canStop}
              canHide={canHide}
              onRefresh={refreshGames}
              onGameUpdate={updateGame}
            />
          ))}
        </div>
      )}
    </div>
  );
}
