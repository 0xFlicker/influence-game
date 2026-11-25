import { enabledGameKinds } from "@influence/engine/game-availability";
import type { GameStatus, SeasonIdentity } from "@/lib/api";
import type { PagedGamesPage } from "@/lib/paged-games";

export type OverviewFilters = { kind: "all" | "influence" | "werewolf"; status: "all" | GameStatus; category: string };
export const initialOverviewFilters = { kind: "all", status: "all", category: "all" } satisfies OverviewFilters;
export type OverviewPages = Record<string, Promise<PagedGamesPage | undefined>>;

export function overviewShelves(seasons: SeasonIdentity[], filters: OverviewFilters) {
  const active = seasons.find(season => season.status === "active");
  const enabled = enabledGameKinds();
  const influence = enabled.includes("influence") && filters.kind !== "werewolf";
  const werewolf = enabled.includes("werewolf") && filters.kind !== "influence";
  const common = { status: filters.status === "all" ? "nonwaiting" : filters.status, category: filters.category, limit: "8" };
  const shelves: Array<{ name: string; query: string; href?: string }> = [];
  const add = (name: string, filters: Record<string, string>, href?: string) => {
    shelves.push({ name, query: new URLSearchParams({ ...common, ...filters }).toString(), href });
  };
  if (filters.status === "all" || filters.status === "waiting") add("Open", { kind: filters.kind, status: "waiting", collection: "all" });
  if (filters.status !== "waiting") {
    if (influence && active) add("Active season", { kind: "influence", collection: "season", season: active.id }, `/games/season/${encodeURIComponent(active.slug)}`);
    if (werewolf) add("Werewolf", { kind: "werewolf", collection: "all" }, "/games/type/werewolf");
    if (influence) add("Influence", { kind: "influence", collection: "all", ...(active ? { excludeSeason: active.id } : {}) }, "/games/type/influence");
  }
  return shelves;
}
