"use client";
import { GameViewer } from "@/app/games/[slug]/game-viewer";
import { EmbeddedReplay } from "@/components/watch/embedded-replay";
import type { SeasonGame } from "./season-games";
/** Imported only by an explicit Play action; no player requests before this mount. */
export function SeasonGamePlayer({game,audience,onAudienceChange}:{game:SeasonGame;audience:"mystery"|"omniscient"|null;onAudienceChange:(audience:"mystery"|"omniscient")=>void}) {
  if (game.gameKind === "influence") return <GameViewer gameId={game.slug} completedMode="replay" contained />;
  if (!audience) throw new Error("Choose a Werewolf viewing mode before starting playback.");
  return <EmbeddedReplay contained audience={audience} onAudienceChange={onAudienceChange} game={{id:game.id,slug:game.slug,gameKind:"werewolf",status:game.status,title:game.slug}}/>;
}
