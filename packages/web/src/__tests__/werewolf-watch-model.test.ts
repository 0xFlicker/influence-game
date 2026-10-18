import {expect, test} from "bun:test";
import {startWerewolf, werewolfConfig} from "../../../engine/src/werewolf/rules";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";
import type {WerewolfWatchMoment} from "../../../engine/src/werewolf/watch-contract";
import {werewolfDoctorSave, werewolfCues, werewolfMomentCues, werewolfScrubStops, consumedSilentTail, werewolfWatchPolicy} from "../components/games/werewolf/werewolf-watch-model";
import {werewolfMusic} from "../components/games/werewolf/werewolf-music";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import {replayMoment} from "../components/games/werewolf/replay-moment";
import {soloPresentationDurationMs, SOLO_READ_START_MS} from "../app/games/[slug]/components/solo-presentation-timing";

const players = Array.from({length: 6}, (_, index) => ({id: `p${index}`, name: `Player ${index}`, personality: "Careful", backstory: "", strategy: "", avatarUrl: null}));
const projection = projectWerewolfWatch([startWerewolf("silent-tail", players, werewolfConfig("one_wolf", 1), "seed")], "mystery");
const template = projection.moments[0]!;
test("both Werewolf audiences reveal canonical parts only at the outcome and play each retrospective after the result", async () => {
  const {completedWerewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
  const events = await completedWerewolfResultsFixture("village", "rt10-watch");
  for (const audience of ["mystery", "omniscient"] as const) {
    const window = projectWerewolfWatch(events, audience);
    const outcomeIndex = window.moments.findIndex(moment => moment.entry.kind === "result");
    const speeches = window.moments.filter(moment => moment.entry.kind === "speech" && moment.entry.purpose === "retrospective");
    expect(speeches).toHaveLength(6);
    expect(speeches.every(moment => window.moments.indexOf(moment) > outcomeIndex && moment.chapterId === "retrospective" && moment.snapshot.outcome !== null)).toBeTrue();
    for (const moment of speeches) {
      const rendered = replayMoment({...moment.snapshot, entries: [moment.entry]});
      expect(rendered).toMatchObject({title: "Retrospective", retrospective: true, spoken: true});
      expect(rendered.actor?.role).toBeDefined(); expect(rendered.part).toBeString();
      const cue = werewolfMomentCues(moment)[0]!;
      expect(cue.baseDurationMs).toBe(soloPresentationDurationMs(rendered.text));
      expect(werewolfWatchPolicy.speech(cue)?.readAtMs).toBe(SOLO_READ_START_MS);
    }
    if (audience === "mystery") for (const moment of window.moments.slice(0, outcomeIndex)) expect(moment.snapshot.players.every(player => player.role === undefined && player.elimination === undefined)).toBeTrue();
  }
});
test("a completed retrospective ends by showing the result again instead of its last speaker", async () => {
  const {completedWerewolfResultsFixture, werewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
  const projected = projectWerewolfWatch(await completedWerewolfResultsFixture("village", "reprise"), "mystery");
  const window: WerewolfWatchWindow = {...projected, slug: "reprise", status: "completed", audience: "mystery",
    publicationCutoff: "2026-10-09T00:00:00.000Z", media: {}};
  const cues = werewolfCues([window]);
  const reprise = cues.at(-1)!;
  expect(reprise.reprise).toBe(true);
  expect(reprise.moment.entry.kind).toBe("result");
  if (reprise.moment.entry.kind === "result") expect(reprise.moment.entry.outcome.faction).toBe("village");
  const before = cues.at(-2)!;
  expect(before.moment.entry.kind === "speech" && before.moment.entry.purpose).toBe("retrospective");
  expect(cues.filter(cue => cue.reprise)).toHaveLength(1);
  expect(new Set(cues.map(cue => cue.key)).size).toBe(cues.length);
  const original = cues.find(cue => cue.moment.entry.kind === "result")!;
  expect(cues.indexOf(original)).toBeLessThan(cues.length - 1);
  expect(werewolfMusic(reprise.moment)).toEqual(werewolfMusic(original.moment));
  // A game still collecting retrospectives, and one with none, keep their existing endings.
  expect(werewolfCues([{...window, status: "in_progress"}]).at(-1)?.reprise).toBeUndefined();
  const unfinished = projectWerewolfWatch(await werewolfResultsFixture("village", "no-retrospective"), "mystery");
  expect(werewolfCues([{...window, ...unfinished}]).at(-1)?.reprise).toBeUndefined();
});
function silent(cursor: number): WerewolfWatchMoment {
  return {...template, cursor, entry: {kind: "phase", day: 1, phase: "day"}};
}
test("silent consumption crosses loaded boundaries but never skips a missing window or speech", () => {
  const first = {moments: Array.from({length: 32}, (_, index) => silent(index + 1))};
  const third = {moments: [silent(65)]};
  expect(consumedSilentTail([first, third], 1)?.cursor).toBe(32);
  const second = {moments: Array.from({length: 32}, (_, index) => silent(index + 33))};
  expect(consumedSilentTail([first, second, third], 1)?.cursor).toBe(65);
  const speech: WerewolfWatchMoment = {...silent(66), entry: {kind: "speech", day: 1, audience: "public", actorId: "p0", text: "A new lead.", cue: null}};
  expect(consumedSilentTail([first, second, {moments: [...third.moments, speech, silent(67)]}], 32)?.cursor).toBe(65);
  expect(consumedSilentTail([{moments: [speech, silent(67)]}], 65)).toBeNull();
});

test("Werewolf checkpoints reveal each accepted ballot, collect abstentions last, then announce the result", () => {
  const moment: WerewolfWatchMoment = {...template, cursor:20, entry:{kind:"vote", day:1, result:{
    thread:1, voteMode:"majority", requiredVotes:4, dayEnded:false, eliminatedId:null, totals:{p2:2},
    ballots:[{voterId:"p0",targetId:null,unavailable:false},{voterId:"p1",targetId:"p2",unavailable:false},
      {voterId:"p2",targetId:null,unavailable:true},{voterId:"p3",targetId:"p2",unavailable:false}],
  }}};
  const cues = werewolfMomentCues(moment);
  expect(cues).toHaveLength(6);
  expect(new Set(cues.map(c=>c.key)).size).toBe(6);
  expect(cues.map(c=>c.moment.cursor)).toEqual([20,20,20,20,20,20]);
  expect(cues.slice(0,-2).map(c=>c.ballot!.current.voterId)).toEqual(["p1","p3","p2","p0"]);
  expect(cues.slice(0,-2).map(c=>c.ballot!.votes.length)).toEqual([1,2,3,4]);
  expect(cues[2]!.ballot!.current.choice).toBe("unavailable");
  expect(cues[3]!.ballot!.current.choice).toBe("abstain");
  expect(cues[4]!.ballot!.complete).toBe(true);
  expect(cues[4]!.ballot!.votes).toHaveLength(4);
  expect(cues[4]!.ballot!.eligibility?.ids).toEqual([]);
  expect(cues[5]!.ballot).toBeUndefined();
  expect(werewolfMomentCues(moment)).toEqual(cues);
});


test("global scrub stops match cue expansion across bounded audience windows", async () => {
  const {werewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
  const events = await werewolfResultsFixture("village", "scrub-projection");
  for (const audience of ["mystery", "omniscient"] as const) {
    const first = projectWerewolfWatch(events, audience, 1, 1);
    const stops = werewolfScrubStops(first.playback);
    const expected: Array<{cursor: number; step: number}> = [];
    for (let cursor = 1; cursor <= first.latestCursor; cursor++) {
      const window = projectWerewolfWatch(events, audience, cursor, 1);
      expect(window.playback).toEqual(first.playback);
      const moment = window.moments[0]!;
      if (first.playback.some(entry => entry.cursor === cursor)) {
        expected.push(...werewolfMomentCues(moment).map((_, step) => ({cursor, step})));
      } else expect(["phase", "speech", "discussion"]).toContain(moment.entry.kind);
    }
    expect(stops).toEqual(expected);
  }
  expect(projectWerewolfWatch(events,"mystery").playback.length).toBeLessThan(projectWerewolfWatch(events,"omniscient").playback.length);
});

test("completed Werewolf tallies use the recorded threshold or plurality result", () => {
  for (const [voteMode, requiredVotes, eliminatedId, expected] of [
    ["majority", 3, "p2", ["p2"]], ["majority", 4, null, []],
    ["plurality", null, "p2", ["p2"]], ["plurality", null, null, []],
  ] as const) {
    const moment: WerewolfWatchMoment = {...template, cursor:20, entry:{kind:"vote",day:1,result:{
      thread:1,voteMode,requiredVotes,dayEnded:eliminatedId!==null,eliminatedId,totals:{p2:3,p3:1},
      ballots:[{voterId:"p0",targetId:"p2",unavailable:false}],
    }}};
    expect(werewolfMomentCues(moment).at(-2)?.ballot?.eligibility?.ids).toEqual([...expected]);
  }
});

for (const scenario of ["saved", "disagreement", "wolves"] as const) test(`${scenario}: night cues retain pre-dawn players and match every scrub stop`, async () => {
  const {werewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
  const first = projectWerewolfWatch(await werewolfResultsFixture(scenario), "omniscient", 1, 64);
  for (const moment of first.moments.filter(moment=>moment.night)) {
    const cues = werewolfMomentCues(moment);
    expect(cues.map(cue=>cue.nightAction?.kind)).toEqual([...moment.night!.actions.map(action=>action.kind),undefined]);
    expect(new Set(cues.map(cue=>cue.key)).size).toBe(cues.length);
    expect(first.playback.find(stop=>stop.cursor===moment.cursor)?.steps).toBe(cues.length);
    expect(cues.slice(0,-1).every(cue=>cue.moment.snapshot === moment.night!.before)).toBe(true);
    expect(cues.at(-1)!.moment.snapshot).toBe(moment.snapshot);
    expect(werewolfMomentCues(moment)).toEqual(cues);
  }
});

for (const scenario of ["saved", "disagreement", "wolves", "village"] as const) test(`${scenario}: a doctor-save callout requires a prevented attack`, async () => {
  const {werewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
  const events = await werewolfResultsFixture(scenario);
  for(const audience of ["mystery", "omniscient"] as const) {
    const first = projectWerewolfWatch(events, audience);
    const nights = Array.from({length:first.latestCursor},(_,index)=>projectWerewolfWatch(events,audience,index+1,1).moments[0]!).filter(moment=>moment.entry.kind === "night");
    for(const moment of nights) {
      const save = werewolfDoctorSave(moment);
      if(scenario === "saved" && audience === "omniscient") {
        expect(save).not.toBeNull();
        expect(save!.doctor.role).toBe("doctor");
        expect(save!.target.id).toBe(moment.entry.kind === "night" ? moment.entry.attackTargetId! : "");
      } else expect(save).toBeNull();
    }
  }
});

test("complete timing index matches windowed speech, every ballot, tally and private night cue", async () => {
 const {completedWerewolfResultsFixture} = await import("../../../engine/src/fixtures/werewolf-results");
 const events = await completedWerewolfResultsFixture("saved", "frame-index");
 for (const audience of ["mystery", "omniscient"] as const) {
   const index = projectWerewolfWatch(events, audience, 1, 32, () => true).playback;
   for (const row of index) {
     const moment = projectWerewolfWatch(events, audience, row.cursor, 1).moments[0]!;
     moment.wolfForms = Object.fromEntries((moment.transformWolfIds ?? []).map(id => [id, "verified-form"]));
     const cues = werewolfMomentCues(moment);
     expect(row.keys).toEqual(cues.map(cue => cue.key));
     expect(row.durationsMs).toEqual(cues.map(cue => cue.baseDurationMs));
     expect(row.steps).toBe(cues.length);
   }
   expect(JSON.stringify(index)).not.toContain("thinking");
   if (audience === "mystery") expect(index.flatMap(row => row.keys).some(key => /:(hunt|protect|investigate)$/.test(key))).toBe(false);
 }
});
