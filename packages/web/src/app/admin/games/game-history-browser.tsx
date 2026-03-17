"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameSummary, GameStatus, ModelTier } from "@/lib/api";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type StatusFilter = GameStatus | "all";
type ModelFilter = ModelTier | "all";
type PlayerFilter = "all" | "4" | "6" | "8" | "10" | "12";

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
    complete: "✓ done",
    stopped: "✗ void",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function GameRow({ game }: { game: GameSummary }) {
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors group">
      <td className="py-3 px-4 text-white/50 text-sm">#{game.gameNumber}</td>
      <td className="py-3 px-4 text-white text-sm">
        {game.winner ? (
          <span>
            {game.winner}{" "}
            <span className="text-white/40 text-xs">({game.winnerPersona})</span>
          </span>
        ) : (
          <span className="text-white/25 italic">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">{game.playerCount}p</td>
      <td className="py-3 px-4 text-white/50 text-sm">
        {game.currentRound > 0 ? game.currentRound : "—"}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">{capitalize(game.modelTier)}</td>
      <td className="py-3 px-4 text-white/40 text-xs">{date}</td>
      <td className="py-3 px-4">
        <StatusBadge status={game.status} />
      </td>
      <td className="py-3 px-4">
        <Link
          href={`/games/${game.id}`}
          className="text-indigo-400 hover:text-indigo-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        >
          View →
        </Link>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white/70 text-sm focus:outline-none focus:border-indigo-500"
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-neutral-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Main browser component
// ---------------------------------------------------------------------------

export function GameHistoryBrowser() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>("all");
  const [search, setSearch] = useState("");

  // No real data yet — API integration pending (INF-42)
  const games: GameSummary[] = [];

  const filtered = games.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (modelFilter !== "all" && g.modelTier !== modelFilter) return false;
    if (playerFilter !== "all" && g.playerCount !== parseInt(playerFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !g.winner?.toLowerCase().includes(q) &&
        !String(g.gameNumber).includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "complete", label: "Done" },
            { value: "in_progress", label: "Live" },
            { value: "waiting", label: "Waiting" },
            { value: "stopped", label: "Void" },
          ]}
        />
        <FilterSelect
          label="Model"
          value={modelFilter}
          onChange={setModelFilter}
          options={[
            { value: "all", label: "All models" },
            { value: "budget", label: "Budget" },
            { value: "standard", label: "Standard" },
            { value: "premium", label: "Premium" },
          ]}
        />
        <FilterSelect
          label="Player count"
          value={playerFilter}
          onChange={setPlayerFilter}
          options={[
            { value: "all", label: "All player counts" },
            { value: "4", label: "4 players" },
            { value: "6", label: "6 players" },
            { value: "8", label: "8 players" },
            { value: "10", label: "10 players" },
            { value: "12", label: "12 players" },
          ]}
        />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-indigo-500 min-w-40"
        />
      </div>

      {/* Table */}
      {games.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-16 text-center text-white/20 text-sm">
          No games yet. Create the first one →{" "}
          <a href="/admin/games/new" className="text-indigo-400 hover:text-indigo-300">
            New game
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
          No games match the current filters.
        </div>
      ) : (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["#", "Winner", "Players", "Rounds", "Model", "Date", "Status", ""].map((h) => (
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
              {filtered.map((g) => (
                <GameRow key={g.id} game={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {games.length > 0 && (
        <p className="text-xs text-white/20 mt-3 text-right">
          {filtered.length} of {games.length} game{games.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
