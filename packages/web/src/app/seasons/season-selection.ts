import type { SavedAgent, SeasonDashboard, SeasonIdentity } from "@/lib/api";

export function defaultSeason(seasons: SeasonIdentity[], requested?: string | null) {
  return seasons.find(season => season.slug === requested)
    ?? seasons.find(season => season.status === "active")
    ?? seasons.find(season => season.status === "closing")
    ?? seasons.find(season => season.finalizedAt)
    ?? seasons[0];
}

export function recommendedSeasonAgent(agents: SavedAgent[], standings: SeasonDashboard["agentStandings"]) {
  const points = new Map(standings.map(row => [row.agentId, row.totalPoints]));
  return [...agents].sort((a, b) =>
    (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0)
    || Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.id.localeCompare(b.id))[0];
}
