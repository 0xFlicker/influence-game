import type { GameSummary } from "./api";

export type GameCollection = { kind: "public" | "private" } | { kind: "season"; slug: string };

export function matchesGameCollection(game: GameSummary, collection: GameCollection) {
  if (collection.kind === "season") return game.season?.slug === collection.slug && game.visibility !== "private";
  if (collection.kind === "private") return game.visibility === "private";
  return game.visibility !== "private" && !game.season;
}

export function gameCollectionHref(game: GameSummary) {
  if (game.visibility === "private") return "/games/private";
  return game.season ? `/games/season/${encodeURIComponent(game.season.slug)}` : "/games/public";
}

export function collectionLabel(collection: GameCollection, games: GameSummary[]) {
  if (collection.kind === "season") return games.find(g => g.season?.slug === collection.slug)?.season?.name ?? "Season games";
  return collection.kind === "private" ? "Your private games" : "Public games";
}
