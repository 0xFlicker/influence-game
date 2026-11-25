import type { GameStatus, GameSummary, SeasonIdentity } from "./api";
import type { HouseGameKind } from "@influence/engine/game-availability";

export type GameCollection = { kind: "public" } | { kind: "open" } | { kind: "season"; slug: string } | { kind: "game"; game: HouseGameKind };

export function gameCollectionQuery(
  collection: GameCollection,
  season?: SeasonIdentity,
  status: "all" | GameStatus = "all",
  category = "all",
  kind: "all" | HouseGameKind = "all",
) {
  const params = new URLSearchParams({
    kind: collection.kind === "game" ? collection.game : collection.kind === "open" ? kind : "influence",
    collection: collection.kind === "season" ? "season" : collection.kind === "public" ? "public" : "all",
    status: collection.kind === "open" ? "waiting" : status,
    category,
  });
  if (season) params.set("season", season.id);
  return params;
}

export function matchesGameCollection(game: GameSummary, collection: GameCollection) {
  // This adapter receives Influence summaries from listGames.
  if (collection.kind === "game") return collection.game === "influence" && game.visibility === "public";
  if (collection.kind === "open") return game.status === "waiting" && game.visibility === "public";
  if (collection.kind === "season") return game.season?.slug === collection.slug && game.visibility === "public";
  return game.visibility === "public" && !game.season;
}

export function gameCollectionHref(game: GameSummary) {
  return game.season ? `/games/season/${encodeURIComponent(game.season.slug)}` : "/games/public";
}

export function collectionLabel(collection: GameCollection, seasonName?: string) {
  if (collection.kind === "open") return "Open games";
  if (collection.kind === "game") return collection.game === "werewolf" ? "Werewolf" : "Influence";
  if (collection.kind === "season") return seasonName ?? "Season games";
  return "Public games";
}
