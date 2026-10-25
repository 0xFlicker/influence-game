import type { WerewolfPublicEntry } from "./observation";
import { werewolfOutcomeTitle } from "./results-contract";
/** Factual House copy from audience-permitted canonical fields only. */
export function werewolfHouseSpeech(entry: WerewolfPublicEntry, players: readonly {id:string;name:string}[], rulesVersion:number): string | null {
  const name = (id:string) => players.find(player => player.id === id)?.name ?? "A player";
  switch (entry.kind) {
    case "phase": return entry.phase === "introduction" ? "Welcome to the village. Introduce yourselves."
      : entry.phase === "night" ? `Night ${entry.day}. The village sleeps.`
      : entry.phase === "day" ? `Day ${entry.day}. The village may speak.`
      : rulesVersion >= 9 ? "Voting begins. A majority of the living village is required to eliminate a player." : "Voting begins. Cast your ballots.";
    case "night": return entry.killedId ? `${name(entry.killedId)} did not survive the night.` : "Everyone survived the night.";
    case "vote": return entry.result.eliminatedId ? `${name(entry.result.eliminatedId)} is eliminated.`
      : entry.result.dayEnded ? rulesVersion >= 9 ? "No majority. Nobody is eliminated." : "Nobody is eliminated." : "Nobody is eliminated. Discussion continues.";
    case "result": return werewolfOutcomeTitle(entry.outcome);
    default: return null;
  }
}
