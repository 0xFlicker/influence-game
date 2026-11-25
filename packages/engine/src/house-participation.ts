/** Completed participation is activity, never a cross-game score. */
export interface ParticipationIdentity {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  playerId: string;
  agentProfileId: string | null;
  agentName: string;
  totalPlayers: number;
  completedAt: string;
}
export type HouseParticipation = ParticipationIdentity & (
  | { gameKind: "influence"; result: null | { outcome: "win" | "loss" | "unknown"; placement: number | null; eliminated: boolean | null; rounds: number; totalPoints: number | null } }
  | { gameKind: "werewolf"; result: null | { outcome: "win" | "loss" | "draw"; faction: "village" | "wolves"; alive: boolean; eliminationDay: number | null; days: number } }
);
export type ParticipationFilter = "all" | HouseParticipation["gameKind"];

export interface WerewolfParticipationRecord {
  wins: number;
  losses: number;
  draws: number;
}

export function summarizeWerewolfParticipation(entries: readonly HouseParticipation[]): WerewolfParticipationRecord {
  const record = { wins: 0, losses: 0, draws: 0 };
  for (const entry of entries) {
    if (entry.gameKind !== "werewolf" || !entry.result) continue;
    switch (entry.result.outcome) {
      case "win": record.wins++; break;
      case "loss": record.losses++; break;
      case "draw": record.draws++; break;
    }
  }
  return record;
}
