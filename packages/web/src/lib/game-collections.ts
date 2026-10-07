import type { GameSummary } from "./api";
import type { HouseGameKind } from "@influence/engine/game-availability";

export type GameCollection = { kind: "public" } | { kind: "season"; slug: string } | { kind: "game"; game: HouseGameKind };

export function matchesGameCollection(game: GameSummary, collection: GameCollection) {
  // This adapter receives Influence summaries from listGames.
  if (collection.kind === "game") return collection.game === "influence" && game.visibility === "public";
  if (collection.kind === "season") return game.season?.slug === collection.slug && game.visibility === "public";
  return game.visibility === "public" && !game.season;
}

export function gameCollectionHref(game: GameSummary) {
  return game.season ? `/games/season/${encodeURIComponent(game.season.slug)}` : "/games/public";
}

export function collectionLabel(collection: GameCollection, games: GameSummary[]) {
  if (collection.kind === "game") return collection.game === "werewolf" ? "Werewolf" : "Influence";
  if (collection.kind === "season") return games.find(g => g.season?.slug === collection.slug)?.season?.name ?? "Season games";
  return "Public games";
}
