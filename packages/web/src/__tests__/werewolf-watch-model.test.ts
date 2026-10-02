import {expect, test} from "bun:test";
import {startWerewolf, werewolfConfig} from "../../../engine/src/werewolf/rules";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";
import type {WerewolfWatchMoment} from "../../../engine/src/werewolf/watch-contract";
import {werewolfMomentCues, consumedSilentTail} from "../components/games/werewolf/werewolf-watch-model";

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
  expect(cues).toHaveLength(5);
  expect(new Set(cues.map(c=>c.key)).size).toBe(5);
  expect(cues.map(c=>c.moment.cursor)).toEqual([20,20,20,20,20]);
  expect(cues.slice(0,-1).map(c=>c.ballot!.current.voterId)).toEqual(["p1","p3","p2","p0"]);
  expect(cues.slice(0,-1).map(c=>c.ballot!.votes.length)).toEqual([1,2,3,4]);
  expect(cues[2]!.ballot!.current.choice).toBe("unavailable");
  expect(cues[3]!.ballot!.current.choice).toBe("abstain");
  expect(cues[4]!.ballot).toBeUndefined();
  expect(werewolfMomentCues(moment)).toEqual(cues);
});
