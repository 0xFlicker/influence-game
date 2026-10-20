import {expect, test} from "bun:test";
import {influenceOpening, sampleInfluenceOpening} from "../app/games/[slug]/components/influence-opening";
import {createPresentationDirector} from "../app/games/[slug]/components/influence-presentation-director";
import {findCueForAdjacentScene, formatSnapshotForPresentationCursor} from "../app/games/[slug]/components/influence-replay-cues";
import {findPresentationCueIndexForSequence} from "../app/games/[slug]/components/presentation-sequence";
import type {ClassicPresentationCue, PresentationCue} from "../app/games/[slug]/components/types";
import {compileWatchTimeline, watchFrameTarget} from "../components/watch/watch-timeline";

const players = [
  {id: "a", name: "Alex", avatarUrl: "/alex.png", status: "eliminated", shielded: true, persona: "Private strategy"},
  {id: "b", name: "Blair", status: "alive", shielded: false, persona: "Another private strategy"},
];
const speech: ClassicPresentationCue = {
  key: "first-speech", source: "classic", kind: "classic_transcript", stage: "done",
  canonicalSequence: 4, round: 0, phase: "INTRODUCTION", sceneIndex: 0, messageIndex: 0,
  baseDurationMs: 4000,
};

test("opening copies only public cast identity, in roster order, with no canonical position", () => {
  const cues = influenceOpening("game", players);
  expect(cues.map(cue => cue.opening.shot)).toEqual(["house", "title", "cast", "cast", "enter"]);
  expect(cues.filter(cue => cue.opening.player).map(cue => cue.opening.player)).toEqual([
    {id: "a", name: "Alex", avatarUrl: "/alex.png"}, {id: "b", name: "Blair"},
  ]);
  expect(cues.every(cue => cue.canonicalSequence === null)).toBe(true);
  expect(cues.reduce((sum, cue) => sum + cue.baseDurationMs, 0)).toBe(28600);
  expect(cues[2]!.opening.startMs).toBe(20_000);
  expect(influenceOpening("game", players.map(player => ({...player, status: "winner", shielded: false, persona: "changed"})))).toEqual(cues);
  expect(influenceOpening("game", [])).toEqual([]);
  expect(formatSnapshotForPresentationCursor(cues, 2, 0)).toBeNull();
});

test("entrance continues through title changes and leaves room before the cast reveal", () => {
  const cues = influenceOpening("game", players);
  const house = cues[0]!, title = cues[1]!, cast = cues[2]!;
  expect(sampleInfluenceOpening(house, 12_000).videoMs).toBe(sampleInfluenceOpening(title, 0).videoMs);
  expect(sampleInfluenceOpening(house, 3000).opacity).toBe(1);
  expect(sampleInfluenceOpening(house, 8000).opacity).toBe(0);
  expect(sampleInfluenceOpening(title, 2000).opacity).toBe(1);
  expect(sampleInfluenceOpening(title, 6000).opacity).toBe(0);
  expect(sampleInfluenceOpening(title, 8000).videoMs).toBe(20_000);
  expect(sampleInfluenceOpening(cast, 0).entrance).toBe(false);
  expect(sampleInfluenceOpening(cast, 0).scale).toBe(1);
});

test("pause, speed, append and automatic handoff retain the shared clock", () => {
  let now = 0, callback: (() => void) | null = null;
  const director = createPresentationDirector({clock: {
    now: () => now, setTimeout: fn => {callback = fn; return 1;}, clearTimeout: () => {callback = null;},
  }});
  const opening = influenceOpening("game", players);
  const cues: PresentationCue[] = [...opening, speech];
  director.load(cues); director.play(); now = 900;
  expect(director.getElapsedBaseMs()).toBe(900);
  expect(director.getSnapshot().canonicalSequence).toBeNull();
  director.pause(); now += 2000;
  expect(director.getElapsedBaseMs()).toBe(900);
  director.append([...cues, {...speech, key: "later", canonicalSequence: 5}]);
  expect(director.getElapsedBaseMs()).toBe(900);
  expect(director.getSnapshot().isPlaying).toBe(false);
  director.setSpeed(2); director.play(); now += 100;
  expect(director.getElapsedBaseMs()).toBe(1100);
  director.seek(opening.length - 1, 0); now += 1500;
  const fire = callback as (() => void) | null; fire?.();
  expect(director.getActiveCue()?.key).toBe(speech.key);
  expect(director.getSnapshot().canonicalSequence).toBe(4);
  director.pause(); director.seek(0);
  expect(director.getSnapshot().isPlaying).toBe(false);
  expect(director.getElapsedBaseMs()).toBe(350);
  director.dispose();
});

test("event links and live reconnect skip the opening; chapter navigation treats it as one chapter", () => {
  const opening = influenceOpening("game", players);
  const cues: PresentationCue[] = [...opening, speech, {...speech, key: "later", canonicalSequence: 8, liveCatchUp: true}];
  expect(findPresentationCueIndexForSequence(cues, 4)).toBe(opening.length);
  expect(findPresentationCueIndexForSequence(cues, 1)).toBe(opening.length);
  expect(findCueForAdjacentScene(cues, 2, 1)).toBe(opening.length);
  expect(findCueForAdjacentScene(cues, opening.length, -1)).toBe(0);
  const director = createPresentationDirector({followTail: true});
  director.reconnect(cues);
  expect(director.getActiveCue()?.source).not.toBe("opening");
  director.dispose();
});

test("scrubbing has readable landing frames and reduced motion preserves shot durations", () => {
  const cues = influenceOpening("game", players);
  const cast = cues[2]!;
  const timeline = compileWatchTimeline(cues, () => null);
  const target = watchFrameTarget(timeline, Math.round((cast.opening.startMs + 1000) * 30 / 1000))!;
  expect(target.key).toBe(cast.key);
  expect(target.elapsedMs).toBe(1000);
  expect(sampleInfluenceOpening(cast, target.elapsedMs).opacity).toBe(1);
  expect(sampleInfluenceOpening(cast, target.elapsedMs, true).scale).toBe(1);
  expect(sampleInfluenceOpening(cast, 0, true).portraitY).toBe(0);
  const final = cues.at(-1)!;
  expect(sampleInfluenceOpening(final, final.baseDurationMs).exitOpacity).toBe(0);
});
