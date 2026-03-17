"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import type { GameSummary, GameStatus, ModelTier } from "@/lib/api";

// ---------------------------------------------------------------------------
// Mock data — replaced with real API once INF-42 lands
// ---------------------------------------------------------------------------

const MOCK_GAMES: GameSummary[] = [
  {
    id: "mock-1",
    gameNumber: 1,
    status: "waiting",
    playerCount: 6,
    currentRound: 0,
    maxRounds: 10,
    currentPhase: "lobby",
    phaseTimeRemaining: null,
    alivePlayers: 6,
    eliminatedPlayers: 0,
    modelTier: "budget",
    visibility: "public",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: "mock-2",
    gameNumber: 2,
    status: "in_progress",
    playerCount: 6,
    currentRound: 4,
    maxRounds: 10,
    currentPhase: "whisper",
    phaseTimeRemaining: 18000,
    alivePlayers: 4,
    eliminatedPlayers: 2,
    modelTier: "standard",
    visibility: "public",
    finalists: ["Atlas", "Vera"],
    createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    startedAt: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
  },
  {
    id: "mock-3",
    gameNumber: 3,
    status: "complete",
    playerCount: 8,
    currentRound: 9,
    maxRounds: 12,
    currentPhase: "done",
    phaseTimeRemaining: null,
    alivePlayers: 0,
    eliminatedPlayers: 8,
    modelTier: "budget",
    visibility: "public",
    winner: "Finn",
    winnerPersona: "honest",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    completedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "mock-4",
    gameNumber: 4,
    status: "waiting",
    playerCount: 4,
    currentRound: 0,
    maxRounds: 8,
    currentPhase: "lobby",
    phaseTimeRemaining: null,
    alivePlayers: 4,
    eliminatedPlayers: 0,
    modelTier: "premium",
    visibility: "public",
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
  },
];

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
    complete: "bg-green-900/40 text-green-400 border border-green-900/60",
    stopped: "bg-red-900/40 text-red-400 border border-red-900/60",
  };
  const labels: Record<GameStatus, string> = {
    waiting: "Open",
    in_progress: "Live",
    complete: "Done",
    stopped: "Void",
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
}

function GameCard({ game, onJoin }: GameCardProps) {
  const isJoinable = game.status === "waiting";
  const isLive = game.status === "in_progress";

  return (
    <div className="border border-white/10 rounded-xl p-5 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-white font-semibold">Game #{game.gameNumber}</span>
            <StatusBadge status={game.status} />
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 font-mono">
              {phaseLabel(game.currentPhase)}
            </span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-white/40 mb-3 flex-wrap">
            <span>👥 {game.playerCount} players</span>
            <span>⚙️ {capitalize(game.modelTier)}</span>
            {isLive && (
              <>
                <span>Round {game.currentRound}/{game.maxRounds}</span>
                <span>🟢 {game.alivePlayers} alive</span>
                {game.phaseTimeRemaining != null && (
                  <span>⏱ {Math.round(game.phaseTimeRemaining / 1000)}s</span>
                )}
              </>
            )}
            {game.status === "complete" && game.winner && (
              <span>
                🏆 {game.winner}{" "}
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
            href={`/games/${game.id}`}
            className="text-xs border border-white/15 hover:border-white/30 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {isLive ? "Watch" : "View"}
          </Link>
          {isJoinable && onJoin && (
            <button
              onClick={() => onJoin(game)}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Join
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

interface FiltersState {
  status: StatusFilter;
  tier: TierFilter;
}

// ---------------------------------------------------------------------------
// Main browser component
// ---------------------------------------------------------------------------

interface GamesBrowserProps {
  onJoin?: (game: GameSummary) => void;
  compact?: boolean;
}

export function GamesBrowser({ onJoin, compact = false }: GamesBrowserProps) {
  const [filters, setFilters] = useState<FiltersState>({ status: "all", tier: "all" });

  // In real implementation: replace with useQuery(() => listGames(), { refetchInterval: 5000 })
  const games = MOCK_GAMES;

  const filtered = games.filter((g) => {
    if (filters.status !== "all" && g.status !== filters.status) return false;
    if (filters.tier !== "all" && g.modelTier !== filters.tier) return false;
    return true;
  });

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "waiting", label: "Open" },
    { value: "in_progress", label: "Live" },
    { value: "complete", label: "Done" },
  ];

  const tierOptions: { value: TierFilter; label: string }[] = [
    { value: "all", label: "Any tier" },
    { value: "budget", label: "Budget" },
    { value: "standard", label: "Standard" },
    { value: "premium", label: "Premium" },
  ];

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

          <span className="text-xs text-white/25 ml-auto">
            {filtered.length} game{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center text-white/30 text-sm">
          No games match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((g) => (
            <GameCard key={g.id} game={g} onJoin={onJoin} />
          ))}
        </div>
      )}
    </div>
  );
}
