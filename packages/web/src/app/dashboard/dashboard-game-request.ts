import { listGames } from "@/lib/api";

/** A direct join link retains the existing lookup behavior for stale targets. */
export function listDashboardGames(requestedJoinGameId: string | null) {
  return listGames(requestedJoinGameId ? undefined : ["waiting", "in_progress"]);
}
