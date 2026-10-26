import {werewolfNightSteps, isWerewolfPlayable, type WerewolfNightAction, type WerewolfWatchMoment, type WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import {werewolfNightHouseSpeech, werewolfHouseDuration} from "@influence/engine/werewolf/house-speech";
import type {WatchPolicy} from "@/components/watch/watch-director";
import {replayMoment} from "./replay-moment";
import {SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS} from "@/app/games/[slug]/components/scene-speech-timing";
import {VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import {SOLO_READ_START_MS, SOLO_SPEECH_START_MS, SOLO_EXIT_MS, soloPresentationDurationMs} from "@/app/games/[slug]/components/solo-presentation-timing";
import {SILENT_BALLOT_DURATION_MS} from "@/app/games/[slug]/components/vote-presentation-timing";
import type {RevealedVote, VoteLedgerState} from "@/app/games/[slug]/components/vote-ledger-model";
import {WOLF_TRANSFORM_MS, WOLF_STAGGER_MS, NIGHT_CLAW_MS} from "./werewolf-night-motion";
export interface WerewolfWatchCue { key: string; baseDurationMs: number; moment: WerewolfWatchMoment; transformation?: {wolfIds: string[]; durationMs: number}; nightAction?: WerewolfNightAction; nightDecision?: boolean; ballot?: VoteLedgerState;
  /** Frozen pre-audio production projection. Public/current playback leaves this absent. */
  houseNarration?: false;
  /** Playback-only reprise of the result after the final retrospective. */
  reprise?: boolean }
export const werewolfWatchPolicy: WatchPolicy<WerewolfWatchCue> = {
  position: cue => cue.moment.cursor,
  scrubAtMs: cue => cue.transformation ? 0 : cue.moment.entry.kind === "night" && !cue.nightAction && cue.moment.entry.killedId ? NIGHT_CLAW_MS : cue.ballot ? cue.ballot.complete ? 0 : SOLO_READ_START_MS : werewolfWatchPolicy.speech(cue)?.readAtMs ?? 0,
  isCatchUp: () => false,
  acceptAtWatermark: () => false,
  reconcile: cues => cues,
  speech: cue => {
    if (cue?.nightDecision) return {showAtMs: SOLO_SPEECH_START_MS, readAtMs: SOLO_READ_START_MS,
      hideAtMs: cue.baseDurationMs - SOLO_EXIT_MS, hiddenAtMs: cue.baseDurationMs};
    if (cue?.ballot && (cue.moment.entry.kind !== "ballot" || cue.moment.entry.text === null)) return null;
    if (cue && !cue.ballot && werewolfCueMoment(cue).house) {
      const lead = cue.transformation?.durationMs ?? 0;
      return {showAtMs:lead,readAtMs:lead,hideAtMs:cue.baseDurationMs,hiddenAtMs:cue.baseDurationMs};
    }
    if (!cue || !["speech", "discussion", "conversation", "ballot", "proposal"].includes(cue.moment.entry.kind)) return null;
    if (cue.moment.entry.kind === "ballot" || cue.moment.entry.kind === "speech" && cue.moment.entry.purpose === "retrospective") return {
      showAtMs: SOLO_SPEECH_START_MS, readAtMs: SOLO_READ_START_MS,
      hideAtMs: cue.baseDurationMs - SOLO_EXIT_MS, hiddenAtMs: cue.baseDurationMs,
    };
    const hideAtMs = cue.baseDurationMs - SCENE_EXIT_HOLD_MS - VISUAL_SPEECH_FADE_MS;
    const lead = cue.transformation?.durationMs ?? 0;
    return {showAtMs: lead + SCENE_SPEECH_START_MS, readAtMs: lead + SCENE_READ_START_MS, hideAtMs, hiddenAtMs: hideAtMs + VISUAL_SPEECH_FADE_MS};
  },
};
/** Keep cached seek destinations out of sequential playback until every source row between them is loaded. */
export function contiguousWerewolfWindows(windows: readonly WerewolfWatchWindow[], cursor: number): WerewolfWatchWindow[] {
  const sorted = [...windows].sort((a, b) => a.fromCursor - b.fromCursor);
  let group: WerewolfWatchWindow[] = [], end = 0;
  for (const window of sorted) {
    if (group.length && window.fromCursor > end + 1) {
      if (group[0]!.fromCursor <= cursor && cursor <= end) return group;
      group = [];
    }
    group.push(window); end = Math.max(end, window.throughCursor);
  }
  return group.length && group[0]!.fromCursor <= cursor && cursor <= end ? group : [];
}
export function werewolfCues(windows: readonly WerewolfWatchWindow[], houseNarration = true): WerewolfWatchCue[] {
  const moments = new Map<number, WerewolfWatchMoment>();
  for (const window of windows) for (const moment of window.moments) {
    const existing = moments.get(moment.cursor);
    if (existing && JSON.stringify(existing) !== JSON.stringify(moment)) throw new Error("Committed Werewolf playback changed at an existing position");
    moments.set(moment.cursor, moment);
  }
  const cues = [...moments.values()].sort((a,b) => a.cursor - b.cursor).filter(m => isWerewolfPlayable(m.entry)).flatMap(moment => werewolfMomentCues(moment,houseNarration));
  const last = cues.at(-1);
  const outcome = last?.moment.snapshot.outcome;
  const latest = windows.reduce<WerewolfWatchWindow | undefined>((chosen, window) =>
    !chosen || window.throughCursor > chosen.throughCursor ? window : chosen, undefined);
  // A finished retrospective closes on the result it followed, not on whoever
  // happened to speak last. The reprise is presentation only: it reuses the
  // final speaker's snapshot, whose outcome is already public, and carries no
  // scrub stop or canonical cursor of its own.
  if (last && outcome && latest?.status === "completed"
    && last.moment.entry.kind === "speech" && last.moment.entry.purpose === "retrospective") {
    const moment: WerewolfWatchMoment = {...last.moment, chapterId: "ending", sceneId: "ending",
      transformWolfIds: undefined, wolfForms: undefined, night: undefined,
      entry: {kind: "result", day: last.moment.entry.day, outcome}};
    const [result] = werewolfMomentCues(moment,houseNarration);
    if (result) cues.push({...result, key: `${result.key}:reprise`, reprise: true});
  }
  return cues;
}

/** Public ballots use their committed prefix; legacy sealed receipts reveal only after resolution. */
export function werewolfMomentCues(moment: WerewolfWatchMoment, houseNarration = true): WerewolfWatchCue[] {
  const key = `${moment.snapshot.gameId}:${moment.snapshot.audience}:${moment.cursor}`;
  if (!isWerewolfPlayable(moment.entry)) return [];
  const result: WerewolfWatchCue = {key, baseDurationMs: replayMoment({...moment.snapshot, entries: [moment.entry]},houseNarration).duration, moment,...(!houseNarration && {houseNarration:false})};
  const wolfIds = moment.transformWolfIds ?? [];
  const transform = (cue: WerewolfWatchCue): WerewolfWatchCue => {
    if (!wolfIds.some(id => moment.wolfForms?.[id])) return cue;
    const durationMs = WOLF_TRANSFORM_MS + (wolfIds.length - 1) * WOLF_STAGGER_MS;
    return {...cue, baseDurationMs: cue.baseDurationMs + durationMs, transformation: {wolfIds, durationMs}};
  };
  if (moment.night) return [...werewolfNightSteps(moment.night.actions).map(({action: nightAction, decision}): WerewolfWatchCue => ({ ...result,
    key: `${key}:${nightAction.kind}${decision ? ":decision" : ""}`,
    baseDurationMs: decision && nightAction.kind !== "hunt" && nightAction.speech ? soloPresentationDurationMs(nightAction.speech.text) : houseNarration ? werewolfHouseDuration(werewolfNightHouseSpeech(nightAction, moment.snapshot.players)) : 5000,
    nightAction, nightDecision: decision,
    moment: { ...moment, snapshot: moment.night!.before },
  })).map(cue => cue.nightAction?.kind === "hunt" ? transform(cue) : cue), result];
  if (moment.entry.kind === "ballot") {
    const ballots = moment.dayBallots;
    if (!ballots?.length || ballots.at(-1)?.voterId !== moment.entry.actorId) throw new Error("Public ballot is missing its committed vote prefix");
    const votes: RevealedVote[] = ballots.map(b => ({voterId: b.voterId, targetId: b.targetId, choice: b.targetId ? "exit" : b.unavailable ? "unavailable" : "abstain"}));
    return [{...result, ballot: {title: "Day vote", votes, current: votes.at(-1)!, total: votes.length + moment.entry.remainingVoterIds.length, polarity: false, abstainLabel: "Abstain"}}];
  }
  if (moment.entry.kind !== "vote") return [transform(result)];
  const rank = (ballot: {targetId: string | null; unavailable: boolean}) => ballot.targetId ? 0 : ballot.unavailable ? 1 : 2;
  const ballots = moment.snapshot.rulesVersion >= 9 ? moment.entry.result.ballots : [...moment.entry.result.ballots].sort((a,b) => rank(a) - rank(b));
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
  return [...(moment.snapshot.rulesVersion >= 9 ? [] : reveals), ...(summary ? [{...summary, ballot: {...summary.ballot, ...(moment.snapshot.rulesVersion >= 9 ? {abstainLabel: "Abstain"} : {})}}] : []), result];

}
export function adjacentWerewolfPosition(index: WerewolfWatchWindow["navigation"], cursor: number, direction: -1 | 1, kind: "scene" | "chapter", step = 0) {
  const entries = kind === "scene" ? index : index.filter((entry, i) => !i || entry.chapterId !== index[i-1]?.chapterId);
  const current = entries.findLastIndex(entry => entry.cursor < cursor || entry.cursor === cursor && entry.step <= step);
  const target = entries[current + direction];
  return target ? {cursor: target.cursor, step: target.step} : {cursor, step};
}

/** Advance only over a contiguous, loaded silent prefix; never skip an unloaded window. */
export function consumedSilentTail(windows: readonly Pick<WerewolfWatchWindow, "moments">[], after: number) {
  const moments = new Map(windows.flatMap(window => window.moments.map(moment => [moment.cursor, moment] as const)));
  let cursor = after;
  while (moments.has(cursor + 1)) {
    const next = moments.get(cursor + 1)!;
    if (isWerewolfPlayable(next.entry)) break;
    cursor++;
  }
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

/** The role's accepted explanation precedes its result; never derive speech from the outcome. */
export function werewolfCueMoment(cue: WerewolfWatchCue) {
  const moment = replayMoment({...cue.moment.snapshot, entries: [cue.moment.entry]},cue.houseNarration !== false);
  if (cue.nightAction && !cue.nightDecision && cue.houseNarration !== false) return {...moment, house: true, actor: undefined, speaker: "The House", text: werewolfNightHouseSpeech(cue.nightAction, cue.moment.snapshot.players), spoken: true, details: []};
  if (!cue.nightDecision) return moment;
  const action = cue.nightAction;
  if (!action || action.kind === "hunt" || !action.speech) throw new Error("Night decision clip requires accepted speech");
  const actor = cue.moment.snapshot.players.find(player => player.id === action.actorId);
  if (!actor) throw new Error("Night decision actor is absent");
  return {...moment, house:false, actor, actorId: actor.id, speaker: actor.name, text: action.speech.text, spoken: true,
    title: `Night ${cue.moment.snapshot.day} · ${action.kind === "protect" ? "Doctor" : "Seer"}`, details: []};
}

/** Backdrop-only beats give the House the stage; character/action shots keep captions. */
export function werewolfHouseCentered(cue: WerewolfWatchCue) {
  return !cue.nightAction && !cue.ballot && !werewolfCueMoment(cue).actor;
}
