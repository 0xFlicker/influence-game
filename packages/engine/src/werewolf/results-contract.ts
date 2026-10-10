import type { WerewolfDayResult, WerewolfFaction, WerewolfNightResult, WerewolfOutcome, WerewolfRole } from "./types";

export interface WerewolfResultSource { sequence: number; cursor: number }
export type WerewolfResultRecap = { id: string; day: number; source: WerewolfResultSource } & (
  | { kind: "night"; result: WerewolfNightResult; noAttackReason: "no_agreement" | null }
  | { kind: "vote"; result: WerewolfDayResult }
);
export interface WerewolfResultPlayer {
  id: string; name: string; role: WerewolfRole; faction: WerewolfFaction;
  won: boolean; alive: boolean;
  elimination: { day: number; kind: "night" | "vote"; source: WerewolfResultSource } | null;
}
export interface WerewolfResults {
  rulesVersion: 7; day: number; maxDays: number; outcome: WerewolfOutcome;
  source: WerewolfResultSource; players: WerewolfResultPlayer[]; recap: WerewolfResultRecap[];
}
export function werewolfOutcomeTitle(outcome: WerewolfOutcome): string {
  return outcome.faction === "village" ? "The village wins" : outcome.faction === "wolves" ? "The wolves win" : "The game ends in a draw";
}
export function werewolfOutcomeReason(outcome: WerewolfOutcome): string {
  return outcome.reason === "wolves_eliminated" ? "Every wolf was eliminated. All village teammates share the victory."
    : outcome.reason === "wolf_parity" ? "The wolves reached parity with the village. All wolf teammates share the victory."
    : "Neither faction won before the day limit. Nobody wins this match.";
}

