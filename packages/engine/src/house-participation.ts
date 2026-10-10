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
