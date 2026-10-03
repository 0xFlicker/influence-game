import type { GameSummary } from "./api";

export type GameCollection = { kind: "public" } | { kind: "season"; slug: string };

export function matchesGameCollection(game: GameSummary, collection: GameCollection) {
  if (collection.kind === "season") return game.season?.slug === collection.slug && game.visibility === "public";
  return game.visibility === "public" && !game.season;
}

export function gameCollectionHref(game: GameSummary) {
  return game.season ? `/games/season/${encodeURIComponent(game.season.slug)}` : "/games/public";
}

export function collectionLabel(collection: GameCollection, games: GameSummary[]) {
  if (collection.kind === "season") return games.find(g => g.season?.slug === collection.slug)?.season?.name ?? "Season games";
  return "Public games";
}
