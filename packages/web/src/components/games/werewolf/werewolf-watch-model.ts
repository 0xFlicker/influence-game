import {isWerewolfPlayable, type WerewolfNightAction, type WerewolfWatchMoment, type WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import type {WatchPolicy} from "@/components/watch/watch-director";
import {replayMoment} from "./replay-moment";
import {SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS} from "@/app/games/[slug]/components/scene-speech-timing";
import {VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import {SOLO_READ_START_MS, soloPresentationDurationMs} from "@/app/games/[slug]/components/solo-presentation-timing";
import {SILENT_BALLOT_DURATION_MS} from "@/app/games/[slug]/components/vote-presentation-timing";
import type {RevealedVote, VoteLedgerState} from "@/app/games/[slug]/components/vote-ledger-model";
export interface WerewolfWatchCue { key: string; baseDurationMs: number; moment: WerewolfWatchMoment; nightAction?: WerewolfNightAction; ballot?: VoteLedgerState }
export const werewolfWatchPolicy: WatchPolicy<WerewolfWatchCue> = {
  position: cue => cue.moment.cursor,
  scrubAtMs: cue => cue.ballot ? cue.ballot.complete ? 0 : SOLO_READ_START_MS : werewolfWatchPolicy.speech(cue)?.showAtMs ?? 0,
  isCatchUp: () => false,
  acceptAtWatermark: () => false,
  reconcile: cues => cues,
  speech: cue => {
    if (cue?.ballot) return null;
    if (!cue || !["speech", "discussion"].includes(cue.moment.entry.kind)) return null;
    const hideAtMs = cue.baseDurationMs - SCENE_EXIT_HOLD_MS - VISUAL_SPEECH_FADE_MS;
    return {showAtMs: SCENE_SPEECH_START_MS, readAtMs: SCENE_READ_START_MS, hideAtMs, hiddenAtMs: hideAtMs + VISUAL_SPEECH_FADE_MS};
  },
};
export function werewolfCues(windows: readonly WerewolfWatchWindow[]): WerewolfWatchCue[] {
  const moments = new Map<number, WerewolfWatchMoment>();
  for (const window of windows) for (const moment of window.moments) {
    const existing = moments.get(moment.cursor);
    if (existing && JSON.stringify(existing) !== JSON.stringify(moment)) throw new Error("Committed Werewolf playback changed at an existing position");
    moments.set(moment.cursor, moment);
  }
  return [...moments.values()].sort((a,b) => a.cursor - b.cursor).filter(m => isWerewolfPlayable(m.entry)).flatMap(werewolfMomentCues);
}

/** Day receipts are canonically public together; reveal order is presentation only. */
export function werewolfMomentCues(moment: WerewolfWatchMoment): WerewolfWatchCue[] {
  const key = `${moment.snapshot.gameId}:${moment.snapshot.audience}:${moment.cursor}`;
  const result: WerewolfWatchCue = {key, baseDurationMs: replayMoment({...moment.snapshot, entries: [moment.entry]}).duration, moment};
  if (moment.night) return [...moment.night.actions.map((nightAction): WerewolfWatchCue => ({ ...result,
    key: `${key}:${nightAction.kind}`, baseDurationMs: 5000, nightAction,
    moment: { ...moment, snapshot: moment.night!.before },
  })), result];
  if (moment.entry.kind !== "vote") return [result];
  const rank = (ballot: {targetId: string | null; unavailable: boolean}) => ballot.targetId ? 0 : ballot.unavailable ? 1 : 2;
  const ballots = [...moment.entry.result.ballots].sort((a,b) => rank(a) - rank(b));
  const votes: RevealedVote[] = ballots.map(b => ({voterId:b.voterId, targetId:b.targetId,
    choice: b.targetId ? "exit" : b.unavailable ? "unavailable" : "abstain"}));
  const reveals = votes.map((current, index): WerewolfWatchCue => ({
    key: `${key}:ballot:${current.voterId}`,
    baseDurationMs: current.targetId ? soloPresentationDurationMs(moment.snapshot.players.find(p => p.id === current.targetId)?.name ?? "Unknown player") : SILENT_BALLOT_DURATION_MS,
    moment,
    ballot: {title: "Day vote", votes: votes.slice(0,index + 1), current, total: votes.length, polarity: false},
  }));
  const last = reveals.at(-1);
  const vote = moment.entry.result;
  const eligible = vote.voteMode === "majority"
    ? Object.keys(vote.totals).filter(id => vote.requiredVotes !== null && vote.totals[id]! >= vote.requiredVotes)
    : vote.eliminatedId ? [vote.eliminatedId] : [];
  const summary = last ? {...last, key: `${key}:tally`, baseDurationMs: 3200,
    ballot: {...last.ballot!, complete: true, eligibility: {ids: eligible,
      label: vote.voteMode === "majority" ? `Majority required: ${vote.requiredVotes} votes` : "Unique highest count required · ties spare everyone"}}} : null;
  return [...reveals, ...(summary ? [summary] : []), result];

}
export function adjacentWerewolfPosition(index: WerewolfWatchWindow["navigation"], cursor: number, direction: -1 | 1, kind: "scene" | "chapter") {
  const entries = kind === "scene" ? index : index.filter((entry, i) => !i || entry.chapterId !== index[i-1]?.chapterId);
  const current = entries.findLastIndex(entry => entry.cursor <= cursor);
  return entries[current + direction]?.cursor ?? cursor;
}

/** Advance only over a contiguous, loaded silent prefix; never skip an unloaded window. */
export function consumedSilentTail(windows: readonly Pick<WerewolfWatchWindow, "moments">[], after: number) {
  const moments = new Map(windows.flatMap(window => window.moments.map(moment => [moment.cursor, moment] as const)));
  let cursor = after;
  while (moments.has(cursor + 1) && !isWerewolfPlayable(moments.get(cursor + 1)!.entry)) cursor++;
  return cursor > after ? moments.get(cursor)! : null;
}

export function werewolfScrubStops(playback: WerewolfWatchWindow["playback"]) {
  return playback.flatMap(({cursor, steps}) => Array.from({length: steps}, (_, step) => ({cursor, step})));
}

/** A protected choice is a save only when it prevented the recorded attack. */
export function werewolfDoctorSave(moment: WerewolfWatchMoment) {
  const entry = moment.entry;
  if (moment.snapshot.audience !== "omniscient" || entry.kind !== "night" || !entry.attackTargetId || entry.attackTargetId !== entry.protectedId || entry.killedId !== null) return null;
  const protection = moment.night?.actions.find(action => action.kind === "protect" && action.targetId === entry.attackTargetId);
  const doctor = protection?.kind === "protect" ? moment.snapshot.players.find(player => player.id === protection.actorId) : null;
  const target = moment.snapshot.players.find(player => player.id === entry.attackTargetId);
  if (!doctor || !target) throw new Error("Recorded doctor save is missing its participants");
  return {doctor, target};
}
