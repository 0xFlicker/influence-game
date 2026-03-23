"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { listAdminGames, hideGame, unhideGame, type AdminGameSummary, type GameStatus, type ModelTier } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type StatusFilter = GameStatus | "all";
type ModelFilter = ModelTier | "all";
type PlayerFilter = "all" | "4" | "6" | "8" | "10" | "12";
type VisibilityFilter = "all" | "visible" | "hidden";

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function StatusBadge({ status }: { status: AdminGameSummary["status"] }) {
  const styles: Record<AdminGameSummary["status"], string> = {
    waiting: "bg-yellow-900/40 text-yellow-400",
    in_progress: "bg-blue-900/40 text-blue-400",
    completed: "bg-green-900/40 text-green-400",
    cancelled: "bg-red-900/40 text-red-400",
  };
  const labels: Record<AdminGameSummary["status"], string> = {
    waiting: "waiting",
    in_progress: "live",
    completed: "✓ done",
    cancelled: "✗ void",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function GameRow({ game, canHide, onToggleVisibility }: { game: AdminGameSummary; canHide: boolean; onToggleVisibility: () => void }) {
  const [toggling, setToggling] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleToggle() {
    setConfirmHide(false);
    setToggling(true);
    try {
      if (game.hidden) {
        await unhideGame(game.id);
      } else {
        await hideGame(game.id);
      }
      onToggleVisibility();
    } catch {
      setToggling(false);
    }
  }

  return (
    <tr className={`border-t border-white/5 hover:bg-white/[0.02] transition-colors group ${game.hidden ? "opacity-40" : ""}`}>
      <td className="py-3 px-4 text-white/50 text-sm">
        #{game.gameNumber}
        {game.hidden && (
          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400">
            hidden
          </span>
        )}
      </td>
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
        <div className="flex items-center gap-2">
          <Link
            href={`/games/${game.slug ?? game.id}`}
            className="text-indigo-400 hover:text-indigo-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            View →
          </Link>
          {canHide && (
            <button
              onClick={game.hidden ? handleToggle : () => setConfirmHide(true)}
              disabled={toggling}
              title={game.hidden ? "Restore to public lists" : "Hide from public lists"}
              className={`text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 ${
                game.hidden
                  ? "text-white/20 hover:text-green-400"
                  : "text-white/20 hover:text-orange-400"
              }`}
            >
              {toggling ? "…" : game.hidden ? "Unhide" : "Hide"}
            </button>
          )}
        </div>
        {confirmHide && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
              <p className="text-white text-sm mb-4">
                Hide game <strong>#{game.gameNumber}</strong> from public lists?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmHide(false)}
                  className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggle}
                  className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-lg transition-colors"
                >
                  Hide
                </button>
              </div>
            </div>
          </div>
        )}
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
  const { hasPermission } = usePermissions();
  const canHideGame = hasPermission("hide_game");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [search, setSearch] = useState("");

  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(() => {
    listAdminGames()
      .then((data) => {
        setGames(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load games.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const filtered = games.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (modelFilter !== "all" && g.modelTier !== modelFilter) return false;
    if (playerFilter !== "all" && g.playerCount !== parseInt(playerFilter)) return false;
    if (visibilityFilter === "visible" && g.hidden) return false;
    if (visibilityFilter === "hidden" && !g.hidden) return false;
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

  const hiddenCount = games.filter((g) => g.hidden).length;

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
            { value: "completed", label: "Done" },
            { value: "in_progress", label: "Live" },
            { value: "waiting", label: "Waiting" },
            { value: "cancelled", label: "Void" },
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
        {hiddenCount > 0 && (
          <FilterSelect
            label="Visibility"
            value={visibilityFilter}
            onChange={setVisibilityFilter}
            options={[
              { value: "all", label: `All (${hiddenCount} hidden)` },
              { value: "visible", label: "Visible only" },
              { value: "hidden", label: "Hidden only" },
            ]}
          />
        )}
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-indigo-500 min-w-40"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="border border-white/10 rounded-xl p-16 text-center text-white/20 text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="border border-red-900/30 rounded-xl p-8 text-center text-red-400/70 text-sm">
          {error}
        </div>
      ) : games.length === 0 ? (
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
                <GameRow key={g.id} game={g} canHide={canHideGame} onToggleVisibility={fetchGames} />
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
