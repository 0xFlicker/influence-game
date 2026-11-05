import type { GameStatus } from "@/lib/api";
export type SeasonGame = { id:string; slug:string; gameKind:"influence"|"werewolf"; status:GameStatus; createdAt:string; startedAt:string|null; endedAt:string|null };
export function playableSeasonGame(game:SeasonGame) { return game.status === "in_progress" || game.status === "completed"; }
export function featuredSeasonGame(games:SeasonGame[]) {
  const newest = [...games].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
  return newest.find(game=>game.status === "in_progress") ?? newest.find(game=>game.status === "completed") ?? newest.find(game=>game.status === "waiting") ?? newest[0];
}
export const seasonGameLabel = (game:SeasonGame) => game.status === "in_progress" ? "Watch live" : game.status === "completed" ? "Watch replay" : game.status === "waiting" ? "Awaiting start" : game.status === "suspended" ? "Paused" : "Cancelled";
