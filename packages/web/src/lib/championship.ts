import type { ChampionshipPolicies, PublicRoleLineup } from "@influence/engine/championship";

export interface ChampionshipView {
  id: string; slug: string; name: string; status: string;
  season: { id: string; slug: string; name: string };
  entries: Array<{ agentId: string; name: string; rank: number; seasonPoints: number }>;
  matches: Array<{ ordinal: number; gameKind: "werewolf" | "influence"; scheduledAt: string; status: string; gameSlug: string | null }>;
  lineups: PublicRoleLineup[];
  policies: ChampionshipPolicies; startDate: string | null;
}
export interface PublicAward {
  id: string; code: string; title: string; theme: string; awardedAt: string;
  sourceSeasonId: string | null; sourceEventId: string | null;
}
