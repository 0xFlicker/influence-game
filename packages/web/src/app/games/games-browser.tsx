"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getAppConfig, listGames, type GameSummary, type GameStatus, type ModelTier } from "@/lib/api";
import { formatPrice } from "@/lib/pricing";

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

function FreeBadge() {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-900/60 font-medium">
      Free
    </span>
  );
}

function PriceBadge({ cents }: { cents: number }) {
  if (cents === 0) return <FreeBadge />;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-900/50 font-medium">
      {formatPrice(cents)}
    </span>
  );
}

/** Determine whether a game is free based on backend data. */
function isGameFree(game: GameSummary): boolean {
  // Prefer explicit freeEntry flag from backend
  if (game.freeEntry !== undefined) return game.freeEntry;
  // Fallback: check buyInCents
  if (game.buyInCents !== undefined) return game.buyInCents === 0;
  // Legacy games without buy-in fields default to free for budget tier
  return game.modelTier === "budget";
}

/** Get display price for a game. */
function getGameBuyInDisplay(game: GameSummary): string {
  if (isGameFree(game)) return "Free";
  if (game.buyInCents !== undefined) return formatPrice(game.buyInCents);
  return "Paid";
}

interface GameCardProps {
  game: GameSummary;
  onJoin?: (game: GameSummary) => void;
  showPaymentInfo?: boolean;
}

function GameCard({ game, onJoin, showPaymentInfo = true }: GameCardProps) {
  const isJoinable = game.status === "waiting";
  const isLive = game.status === "in_progress";
  const isFree = isGameFree(game);
  const slotsInfo = isJoinable
    ? `${game.alivePlayers}/${game.playerCount} joined`
    : undefined;

  return (
    <div className="border border-white/10 rounded-xl p-5 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-white font-semibold">Game #{game.gameNumber}</span>
            <StatusBadge status={game.status} />
            {showPaymentInfo && (game.buyInCents !== undefined ? (
              <PriceBadge cents={isFree ? 0 : game.buyInCents} />
            ) : isFree ? (
              <FreeBadge />
            ) : null)}
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 font-mono">
              {phaseLabel(game.currentPhase)}
            </span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-white/40 mb-3 flex-wrap">
            <span>{game.playerCount} players</span>
            <span>{capitalize(game.modelTier)} tier</span>
            {showPaymentInfo && !isFree && game.buyInCents !== undefined && game.buyInCents > 0 && (
              <span className="text-amber-400/60">Buy-in: {formatPrice(game.buyInCents)}</span>
            )}
            {showPaymentInfo && game.prizePoolCents !== undefined && game.prizePoolCents > 0 && (
              <span className="text-emerald-400/60">Pool: {formatPrice(game.prizePoolCents)}</span>
            )}
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
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/games/${game.slug ?? game.id}`}
            className="text-xs border border-white/15 hover:border-white/30 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {isLive ? "Watch" : "View"}
          </Link>
          {isJoinable && onJoin && (
            <button
              onClick={() => onJoin(game)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                !showPaymentInfo || isFree
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {!showPaymentInfo || isFree ? "Join" : `Join · ${getGameBuyInDisplay(game)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type StatusFilter = "all" | GameStatus;
type TierFilter = "all" | ModelTier;
type PriceFilter = "all" | "free" | "paid";

interface FiltersState {
  status: StatusFilter;
  tier: TierFilter;
  price: PriceFilter;
}

// ---------------------------------------------------------------------------
// Main browser component
// ---------------------------------------------------------------------------

interface GamesBrowserProps {
  onJoin?: (game: GameSummary) => void;
  compact?: boolean;
}

export function GamesBrowser({ onJoin, compact = false }: GamesBrowserProps) {
  const [filters, setFilters] = useState<FiltersState>({ status: "all", tier: "all", price: "all" });
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);

  useEffect(() => {
    getAppConfig()
      .then((cfg) => setPaymentsEnabled(cfg.paymentsEnabled))
      .catch(() => setPaymentsEnabled(false));
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
      if (filters.price !== "all") {
        const isFree = isGameFree(g);
        if (filters.price === "free" && !isFree) return false;
        if (filters.price === "paid" && isFree) return false;
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

  const priceOptions: { value: PriceFilter; label: string }[] = [
    { value: "all", label: "Any price" },
    { value: "free", label: "Free" },
    { value: "paid", label: "Paid" },
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

          {/* Price filter — hidden when payments are disabled */}
          {paymentsEnabled && (
            <select
              value={filters.price}
              onChange={(e) => setFilters((f) => ({ ...f, price: e.target.value as PriceFilter }))}
              className="text-xs bg-transparent border border-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:border-white/20 transition-colors outline-none"
            >
              {priceOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#0a0a0a]">
                  {opt.label}
                </option>
              ))}
            </select>
          )}

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
            <GameCard key={g.id} game={g} onJoin={onJoin} showPaymentInfo={paymentsEnabled} />
          ))}
        </div>
      )}
    </div>
  );
}
