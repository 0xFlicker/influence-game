export interface SluggedGame {
  slug: string;
}

export type GameCategoryValue = "free" | "custom" | `season:${string}`;

export interface CategorizedGame {
  trackType?: "free" | "custom";
  season?: { id: string; name: string };
}

export function gameDisplayName(game: SluggedGame): string {
  return game.slug;
}

export function gameHref(game: SluggedGame): string {
  return gameIdentifierHref(game.slug);
}

export function gameCategoryValue(game: CategorizedGame): GameCategoryValue {
  return game.season ? `season:${game.season.id}` : (game.trackType ?? "custom");
}

export function gameCategoryLabel(game: CategorizedGame): string | null {
  if (game.season) return game.season.name;
  return game.trackType === "free" ? "Free" : null;
}
import { gameHref as gameIdentifierHref } from "./game-links";
