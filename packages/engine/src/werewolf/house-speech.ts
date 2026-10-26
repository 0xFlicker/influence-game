import type { WerewolfPublicEntry } from "./observation";
import { werewolfOutcomeTitle, werewolfOutcomeReason } from "./results-contract";
import type { WerewolfNightAction } from "./watch-contract";
import {sceneSpeechDurationMs} from "../visual-speech";
export function werewolfHouseDuration(text: string) { return Math.max(4200, sceneSpeechDurationMs(text)); }
type Player = {id: string; name: string};
/** Omniscient action scenes are projected before calling this presentation helper. */
export function werewolfNightHouseSpeech(action: WerewolfNightAction, players: readonly Player[]): string {
  const name = (id: string) => players.find(player => player.id === id)?.name ?? "A player";
  if (action.kind === "hunt") return `The pack hunts ${name(action.targetId)}. The village holds its breath.`;
  if (action.kind === "protect") return `${name(action.actorId)}, the Doctor, protects ${action.actorId === action.targetId ? "themself" : name(action.targetId)} tonight. One life under guard.`;
  return `${name(action.actorId)}, the Seer, investigates ${name(action.targetId)}. The result: ${action.isWolf ? "a werewolf" : "not a werewolf"}. Knowledge is powerful—if you live to use it.`;
}
/** Factual House copy from audience-permitted canonical fields only. */
export function werewolfHouseSpeech(entry: WerewolfPublicEntry, players: readonly Player[], rulesVersion:number): string | null {
  const name = (id:string) => players.find(player => player.id === id)?.name ?? "A player";
  switch (entry.kind) {
    case "phase": return entry.phase === "introduction" ? "Welcome to the village. Introduce yourselves."
      : entry.phase === "night" ? `Night ${entry.day}. The village sleeps.`
      : entry.phase === "day" ? `Day ${entry.day}. The village may speak.`
      : rulesVersion >= 9 ? "Voting begins. A majority of the living village is required to eliminate a player." : "Voting begins. Cast your ballots.";
    case "pack_vote": return entry.result.targetId ? `The pack agrees: ${name(entry.result.targetId)} is tonight’s target. The hunt is on.`
      : entry.result.endReason === "attempt_limit" ? "The pack fails to agree. No attack tonight. Even wolves can waste a night arguing." : "The pack has not agreed. Another chance to choose their prey.";
    case "night": return entry.killedId ? `${name(entry.killedId)} did not survive the pack’s hunt. Dawn comes with one fewer voice.`
      : entry.attackTargetId && entry.protectedId === entry.attackTargetId ? `The pack hunted ${name(entry.attackTargetId)}, but the Doctor’s protection saved them. Everyone survives the night.`
      : entry.attackTargetId === null ? "The pack made no attack. Everyone survives the night. A quiet dawn, for once."
      : "Everyone survived the night. The village gets another day—and another chance.";
    case "vote": return entry.result.eliminatedId ? `With ${entry.result.ballots.filter(ballot => ballot.targetId === entry.result.eliminatedId).length} of ${entry.result.ballots.length} votes, ${name(entry.result.eliminatedId)} is eliminated. The village has made its choice.`
      : entry.result.dayEnded ? rulesVersion >= 9 ? `No one reached the required ${entry.result.requiredVotes} votes. Nobody is eliminated. Another day of suspicion ends without a verdict.` : "No unique vote leader. Nobody is eliminated."
      : "No majority. Nobody is eliminated. Discussion continues.";
    case "result": return `${werewolfOutcomeTitle(entry.outcome)}. ${werewolfOutcomeReason(entry.outcome)}${entry.outcome.winnerIds.length ? ` The winning faction: ${entry.outcome.winnerIds.map(name).join(", ")}.` : ""} ${entry.outcome.faction === "wolves" ? "The village ran out of time to turn suspicion into survival." : entry.outcome.faction === "village" ? "The last wolf is gone. Tonight, the village can finally sleep." : "The village and the pack leave their unfinished business in the dark."}`;
    default: return null;
  }
}
