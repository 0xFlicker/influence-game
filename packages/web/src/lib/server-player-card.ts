import {cache} from "react";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {serverApiFetch} from "./server-api";
import {playerCardMetadata, resultsCardMetadata, type PlayerCardGame, type ReplaySearch} from "./player-card";
export const getPlayerCardGame = cache((slug:string) => serverApiFetch<PlayerCardGame>(`/api/game-entries/${encodeURIComponent(slug)}/card`,{cache:"no-store"}));
async function cardOrigin(): Promise<string> {
  const origin = process.env.WEB_BASE_URL?.trim();
  if (origin) return origin;
  if (process.env.NODE_ENV === "production") return "https://thehouse.game";
  const request = await headers();
  return `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host") ?? "localhost:3001"}`;
}
export async function getPlayerCardMetadata(slug:string,search:ReplaySearch = {},sequence?:string):Promise<Metadata> {
  try {
    const game = await getPlayerCardGame(slug);
    return playerCardMetadata(game,await cardOrigin(),search,sequence);
  } catch (error) {
    console.error("[PlayerCard] Metadata unavailable", error);
    return {title:"Replay — The House",description:"Watch the game in the House player.",robots:{index:false,follow:false},twitter:{card:"summary",title:"The House"}};
  }
}
export async function getResultsCardMetadata(slug:string): Promise<Metadata> {
  try { return resultsCardMetadata(await getPlayerCardGame(slug), await cardOrigin()); }
  catch (error) {
    console.error("[ResultsCard] Metadata unavailable", error);
    return {title:"Results — The House",description:"View game results at The House.",robots:{index:false,follow:false}};
  }
}
