import {sceneSpeechDurationMs, soloPresentationDurationMs, SILENT_BALLOT_DURATION_MS} from "../visual-speech";
import type {WerewolfPublicEntry} from "./observation";
import {werewolfNightSteps, type WerewolfNightAction} from "./watch-contract";
import {werewolfHouseSpeech, werewolfNightHouseSpeech, werewolfHouseDuration} from "./house-speech";

/** Compact presentation metadata only. No private text, choices or scene bodies. */
export function werewolfStepDurations(entry: WerewolfPublicEntry, players: readonly {id: string; name: string}[], actions: readonly WerewolfNightAction[], rulesVersion: 7 | 8 | 9 | 10 | 11 = 8): number[] {
  if (entry.kind === "speech") return [entry.purpose === "retrospective" ? soloPresentationDurationMs(entry.text ?? "Pass") : sceneSpeechDurationMs(entry.text ?? "Pass")];
  if (entry.kind === "discussion") return [sceneSpeechDurationMs(entry.contribution.text ?? "Pass")];
  if (entry.kind === "ballot") return [entry.text === null ? SILENT_BALLOT_DURATION_MS : soloPresentationDurationMs(entry.text)];
  if (entry.kind === "conversation" || entry.kind === "proposal") return [entry.text === null ? SILENT_BALLOT_DURATION_MS : sceneSpeechDurationMs(entry.text)];
  const houseDuration = werewolfHouseDuration(werewolfHouseSpeech(entry, players, rulesVersion) ?? "");
  if (entry.kind === "vote") {
    if (rulesVersion >= 9) return [...(entry.result.ballots.length ? [3200] : []), houseDuration];
    const rank = (ballot: {targetId: string | null; unavailable: boolean}) => ballot.targetId ? 0 : ballot.unavailable ? 1 : 2;
    const ballots = [...entry.result.ballots].sort((a, b) => rank(a) - rank(b));
    return [...ballots.map(ballot => ballot.targetId ? soloPresentationDurationMs(players.find(player => player.id === ballot.targetId)?.name ?? "Unknown player") : SILENT_BALLOT_DURATION_MS), ...(ballots.length ? [3200] : []), houseDuration];
  }
  return [...werewolfNightSteps(actions).map(({action, decision}) => decision && action.kind !== "hunt" && action.speech ? soloPresentationDurationMs(action.speech.text) : werewolfHouseDuration(werewolfNightHouseSpeech(action, players))), houseDuration];
}
