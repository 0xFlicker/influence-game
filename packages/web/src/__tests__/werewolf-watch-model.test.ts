import {expect, test} from "bun:test";
import {startWerewolf, werewolfConfig} from "../../../engine/src/werewolf/rules";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";
import type {WerewolfWatchMoment} from "../../../engine/src/werewolf/watch-contract";
import {werewolfMomentCues, werewolfScrubStops, consumedSilentTail} from "../components/games/werewolf/werewolf-watch-model";

const players = Array.from({length: 6}, (_, index) => ({id: `p${index}`, name: `Player ${index}`, personality: "Careful", backstory: "", strategy: "", avatarUrl: null}));
const projection = projectWerewolfWatch([startWerewolf("silent-tail", players, werewolfConfig("one_wolf", 1), "seed")], "mystery");
const template = projection.moments[0]!;
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
