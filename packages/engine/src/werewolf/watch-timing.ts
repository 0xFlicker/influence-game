import {sceneSpeechDurationMs, soloPresentationDurationMs, SILENT_BALLOT_DURATION_MS} from "../visual-speech";
import type {WerewolfPublicEntry} from "./observation";
import type {WerewolfNightAction} from "./watch-contract";

/** Compact presentation metadata only. No private text, choices or scene bodies. */
export function werewolfStepDurations(entry: WerewolfPublicEntry, players: readonly {id: string; name: string}[], actions: readonly WerewolfNightAction[]): number[] {
  if (entry.kind === "speech") return [entry.purpose === "retrospective" ? soloPresentationDurationMs(entry.text ?? "Pass") : sceneSpeechDurationMs(entry.text ?? "Pass")];
  if (entry.kind === "discussion") return [sceneSpeechDurationMs(entry.contribution.text ?? "Pass")];
  if (entry.kind === "vote") {
    const rank = (ballot: {targetId: string | null; unavailable: boolean}) => ballot.targetId ? 0 : ballot.unavailable ? 1 : 2;
    const ballots = [...entry.result.ballots].sort((a, b) => rank(a) - rank(b));
    return [...ballots.map(ballot => ballot.targetId ? soloPresentationDurationMs(players.find(player => player.id === ballot.targetId)?.name ?? "Unknown player") : SILENT_BALLOT_DURATION_MS), ...(ballots.length ? [3200] : []), 4200];
  }
  return [...actions.map(() => 5000), 4200];
}
