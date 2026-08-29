"use client";

import type { AdminGameSummary, GameStatus } from "@/lib/api";

export type StatusFilter = GameStatus | "all";
export type PlayerFilter = "all" | "4" | "6" | "8" | "10" | "12";
export type VisibilityFilter = "all" | "visible" | "hidden";
export type SettlementFilter = "all" | "pending" | "repair_required";

export interface AdminGameFilters {
  status: StatusFilter;
  players: PlayerFilter;
  visibility: VisibilityFilter;
  settlement: SettlementFilter;
  search: string;
}

export const DEFAULT_ADMIN_GAME_FILTERS: AdminGameFilters = {
  status: "all",
  players: "all",
  visibility: "visible",
  settlement: "all",
  search: "",
};

export function filterAdminGames(
  games: AdminGameSummary[],
  filters: AdminGameFilters,
): AdminGameSummary[] {
  const query = filters.search.trim().toLowerCase();
  return games.filter((game) => {
    if (filters.status !== "all" && game.status !== filters.status) return false;
    if (filters.players !== "all" && game.playerCount !== Number(filters.players)) return false;
    if (filters.visibility === "visible" && game.hidden) return false;
    if (filters.visibility === "hidden" && !game.hidden) return false;
    if (filters.settlement !== "all" && game.completionSettlement.state !== filters.settlement) return false;
    if (!query) return true;
    return game.slug.toLowerCase().includes(query)
      || game.winner?.toLowerCase().includes(query) === true
      || game.modelLabel.toLowerCase().includes(query)
      || game.season?.name.toLowerCase().includes(query) === true;
  });
}

export function hasNarrowedAdminGameFilters(filters: AdminGameFilters): boolean {
  return filters.status !== "all"
    || filters.players !== "all"
    || filters.visibility !== "visible"
    || filters.settlement !== "all"
    || filters.search.trim().length > 0;
}

export function AdminGameFilterBar({
  filters,
  hiddenCount,
  onChange,
}: {
  filters: AdminGameFilters;
  hiddenCount: number;
  onChange: (filters: AdminGameFilters) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3" aria-label="Filter games">
      <FilterSelect
        label="Status"
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status })}
        options={[
          { value: "all", label: "All statuses" },
          { value: "completed", label: "Done" },
          { value: "in_progress", label: "Live" },
          { value: "waiting", label: "Waiting" },
          { value: "suspended", label: "Suspended" },
          { value: "cancelled", label: "Void" },
        ]}
      />
      <FilterSelect
        label="Player count"
        value={filters.players}
        onChange={(players) => onChange({ ...filters, players })}
        options={[
          { value: "all", label: "All player counts" },
          { value: "4", label: "4 players" },
          { value: "6", label: "6 players" },
          { value: "8", label: "8 players" },
          { value: "10", label: "10 players" },
          { value: "12", label: "12 players" },
        ]}
      />
      <FilterSelect
        label="Visibility"
        value={filters.visibility}
        onChange={(visibility) => onChange({ ...filters, visibility })}
        options={[
          { value: "visible", label: "Visible only" },
          { value: "all", label: `All (${hiddenCount} hidden)` },
          { value: "hidden", label: `Hidden only (${hiddenCount})` },
        ]}
      />
      <FilterSelect
        label="Completion settlement"
        value={filters.settlement}
        onChange={(settlement) => onChange({ ...filters, settlement })}
        options={[
          { value: "all", label: "All settlements" },
          { value: "pending", label: "Finalizing results" },
          { value: "repair_required", label: "Results under review" },
        ]}
      />
      <label className="sr-only" htmlFor="admin-game-search">Search games</label>
      <input
        id="admin-game-search"
        type="search"
        placeholder="Search games…"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        className="min-w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 focus:border-indigo-500 focus:outline-none"
      />
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 focus:border-indigo-500 focus:outline-none"
      aria-label={label}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-neutral-900">
          {option.label}
        </option>
      ))}
    </select>
  );
}
