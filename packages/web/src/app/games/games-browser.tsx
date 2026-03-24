"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { listGames, type GameSummary, type GameStatus, type ModelTier, type TrackType } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Game card
// ---------------------------------------------------------------------------

interface GameCardProps {
  game: GameSummary;
  onJoin?: (game: GameSummary) => void;
  isAdmin?: boolean;
}

function GameCard({ game, onJoin, isAdmin }: GameCardProps) {
  const router = useRouter();
  const isJoinable = game.status === "waiting";
  const isLive = game.status === "in_progress";
  const slotsInfo = isJoinable
    ? `${game.alivePlayers}/${game.playerCount} joined`
    : undefined;

  return (
    <div
      onClick={() => router.push(`/games/${game.slug ?? game.id}`)}
      className="border border-white/10 rounded-xl p-5 hover:border-white/20 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-white font-semibold">Game #{game.gameNumber}</span>
            <StatusBadge status={game.status} />
            {game.trackType === "free" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-900/60 font-medium">
                Free
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 font-mono">
              {phaseLabel(game.currentPhase)}
            </span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-white/40 mb-3 flex-wrap">
            <span>{game.playerCount} players</span>
            <span>{capitalize(game.modelTier)} tier</span>
            {slotsInfo && (
              <span className="text-indigo-400/70">{slotsInfo}</span>
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
            {game.status === "completed" && game.winner && (
              <span>
                {game.winner}{" "}
                <span className="text-white/25">({game.winnerPersona})</span>
              </span>
            )}
            {game.finalists && isLive && (
              <span>Finalists: {game.finalists.join(", ")}</span>
            )}
            <span className="text-white/25">{timeAgo(game.createdAt)}</span>
          </div>

          {/* Progress bar for live games */}
          {isLive && (
            <div className="h-1 bg-white/10 rounded-full overflow-hidden max-w-xs">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${Math.round((game.currentRound / game.maxRounds) * 100)}%` }}
              />
            </div>
          )}
          {isLive && !isAdmin && (
            <p className="text-xs text-white/30 mt-2">Replay available when game finishes</p>
          )}
        </div>

        {/* Actions */}
        {isJoinable && onJoin && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onJoin(game); }}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Join
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type StatusFilter = "all" | GameStatus;
type TierFilter = "all" | ModelTier;
type TrackFilter = "all" | TrackType;

interface FiltersState {
  status: StatusFilter;
  tier: TierFilter;
  track: TrackFilter;
}

// ---------------------------------------------------------------------------
// Main browser component
// ---------------------------------------------------------------------------

interface GamesBrowserProps {
  onJoin?: (game: GameSummary) => void;
  compact?: boolean;
}

export function GamesBrowser({ onJoin, compact = false }: GamesBrowserProps) {
  const { isAdmin } = usePermissions();
  const [filters, setFilters] = useState<FiltersState>({ status: "all", tier: "all", track: "all" });
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setLoading(false);
      }
    }

    fetchGames();
    const interval = setInterval(fetchGames, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const STATUS_ORDER: Record<GameStatus, number> = {
    waiting: 0,
    in_progress: 1,
    completed: 2,
    cancelled: 3,
  };

  const filtered = games
    .filter((g) => {
      if (filters.status !== "all" && g.status !== filters.status) return false;
      if (filters.tier !== "all" && g.modelTier !== filters.tier) return false;
      if (filters.track !== "all" && (g.trackType ?? "custom") !== filters.track) return false;
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
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        Loading games…
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-900/30 rounded-xl p-8 text-center text-red-400/70 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {/* Status filters */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilters((f) => ({ ...f, status: opt.value }))}
                className={`text-xs px-3 py-1.5 transition-colors border-r border-white/10 last:border-0 ${
                  filters.status === opt.value
                    ? "bg-indigo-600 text-white"
                    : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Tier filter */}
          <select
            value={filters.tier}
            onChange={(e) => setFilters((f) => ({ ...f, tier: e.target.value as TierFilter }))}
            className="text-xs bg-transparent border border-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:border-white/20 transition-colors outline-none"
          >
            {tierOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#0a0a0a]">
                {opt.label}
              </option>
            ))}
          </select>

          {/* Track filter */}
          <select
            value={filters.track}
            onChange={(e) => setFilters((f) => ({ ...f, track: e.target.value as TrackFilter }))}
            className="text-xs bg-transparent border border-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:border-white/20 transition-colors outline-none"
          >
            <option value="all" className="bg-[#0a0a0a]">Any track</option>
            <option value="custom" className="bg-[#0a0a0a]">Custom</option>
            <option value="free" className="bg-[#0a0a0a]">Free</option>
          </select>

          <span className="text-xs text-white/25 ml-auto">
            {filtered.length} game{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center text-white/30 text-sm">
          {games.length === 0 ? "No games yet." : "No games match the current filters."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((g) => (
            <GameCard key={g.id} game={g} onJoin={onJoin} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
