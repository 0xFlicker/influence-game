"use client";
import { GameViewer } from "@/app/games/[slug]/game-viewer";
import { EmbeddedReplay } from "@/components/watch/embedded-replay";
import type { SeasonGame } from "./season-games";
/** Imported only by an explicit Play action; no player requests before this mount. */
export function SeasonGamePlayer({game,audience}:{game:SeasonGame;audience:"mystery"|"omniscient"}) {
  return game.gameKind === "influence" ? <GameViewer gameId={game.slug} completedMode="replay" contained /> : <EmbeddedReplay contained audience={audience} game={{id:game.id,slug:game.slug,gameKind:"werewolf",status:game.status,title:game.slug}}/>;
}
