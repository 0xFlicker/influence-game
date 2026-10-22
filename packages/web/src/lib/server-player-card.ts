import {cache} from "react";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {serverApiFetch} from "./server-api";
import {playerCardMetadata, type PlayerCardGame, type ReplaySearch} from "./player-card";
export const getPlayerCardGame = cache((slug:string) => serverApiFetch<PlayerCardGame>(`/api/game-entries/${encodeURIComponent(slug)}/card`,{cache:"no-store"}));
export async function getPlayerCardMetadata(slug:string,search:ReplaySearch = {},sequence?:string):Promise<Metadata> {
  try {
    const game = await getPlayerCardGame(slug);
    let origin = process.env.WEB_BASE_URL?.trim();
    if (!origin) {
      if (process.env.NODE_ENV === "production") origin = "https://thehouse.game";
      else { const request = await headers(); origin = `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host") ?? "localhost:3001"}`; }
    }
    return playerCardMetadata(game,origin,search,sequence);
  } catch (error) {
    console.error("[PlayerCard] Metadata unavailable", error);
    return {title:"Replay — The House",description:"Watch the game in the House player.",robots:{index:false,follow:false},twitter:{card:"summary",title:"The House"}};
  }
}
