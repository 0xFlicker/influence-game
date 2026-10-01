import {isWerewolfPlayable, type WerewolfWatchMoment, type WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import type {WatchPolicy} from "@/components/watch/watch-director";
import {replayMoment} from "./replay-moment";
import {SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS} from "../games/[slug]/components/scene-speech-timing";
import {VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import {soloPresentationDurationMs} from "../games/[slug]/components/solo-presentation-timing";
import {SILENT_BALLOT_DURATION_MS} from "../games/[slug]/components/vote-presentation-timing";
import type {RevealedVote, VoteLedgerState} from "../games/[slug]/components/vote-ledger-model";
export interface WerewolfWatchCue { key: string; baseDurationMs: number; moment: WerewolfWatchMoment; ballot?: VoteLedgerState }
export const werewolfWatchPolicy: WatchPolicy<WerewolfWatchCue> = {
  position: cue => cue.moment.cursor,
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
  return [...reveals, result];

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
