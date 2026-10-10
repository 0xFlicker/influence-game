import {expect, test} from "bun:test";
import {projectWerewolfWatch} from "@influence/engine/werewolf/watch";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import {werewolfOpening, sampleOpening, werewolfPlaybackPolicy} from "../components/games/werewolf/werewolf-opening";
import {werewolfCues} from "../components/games/werewolf/werewolf-watch-model";
import {PresentationDirector} from "../components/watch/watch-director";
import {buildExportCues} from "../lib/replay-export/cues";
import {compileTiming, parseTimingProfile} from "../lib/replay-export/timing";
import {compileAudio, audioGain} from "../lib/replay-export/audio";
import {assertNoPrivateFields} from "../lib/replay-export/source";

async function windows() {
  const events = await werewolfResultsFixture("village", "opening-test");
  return (["mystery", "omniscient"] as const).map(audience => {
    const view = projectWerewolfWatch(events, audience, 1, 64);
    return {...view, slug:"opening-test", audience, status:"completed", publicationCutoff:"2026-10-07T00:00:00Z", media:{}} satisfies WerewolfWatchWindow;
  });
}
test("opening reveals only permitted roles and keeps both audiences on the same neutral shot sequence", async () => {
  const [mystery, omni] = await windows();
  const m = werewolfOpening(mystery!, "Silence Beneath the Lanterns"), o = werewolfOpening(omni!, "Silence Beneath the Lanterns");
  expect(() => assertNoPrivateFields(m)).not.toThrow();
  expect(o.some(c => c.opening.player?.role)).toBe(true);
  const withoutRoles = o.map(c => {const copy=structuredClone(c); if(copy.opening.player) delete copy.opening.player.role;return copy;});
  expect(m).toEqual(withoutRoles);
  expect(m[1]!.opening.title).toBe("Silence Beneath the Lanterns");
  expect(m[1]!.opening.backgroundUrl).not.toBe(m[0]!.opening.backgroundUrl);
  expect(werewolfOpening(mystery!)[1]!.opening.title).toBe("Werewolf");
  expect(werewolfOpening({...mystery!,fromCursor:33})).toEqual([]);
  expect(m.reduce((sum,c)=>sum+c.baseDurationMs,0)).toBe(13300 + mystery!.players.length * 2500);
});
test("opening pause, speed, seek and automatic handoff use the shared director", async () => {
  const [window] = await windows(); const intro = werewolfOpening(window!);
  let now = 0, callback: (()=>void) | null = null;
  const director = new PresentationDirector({policy:werewolfPlaybackPolicy,clock:{now:()=>now,setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{callback=null;}}});
  const recorded = werewolfCues([window!]);
  director.load([...intro,...recorded]);director.play();now=1200;
  expect(director.getElapsedBaseMs()).toBe(1200);expect(director.getSnapshot().position).toBeNull();
  director.pause();now+=5000;expect(director.getElapsedBaseMs()).toBe(1200);
  director.setSpeed(2);director.play();now+=100;expect(director.getElapsedBaseMs()).toBe(1400);
  director.seek(intro.length-1);now+=2650;
  const fire = callback as (()=>void)|null; fire?.();
  expect(director.getActiveCue()?.key).toBe(recorded[0]!.key);
  director.seek(1);expect(director.getActiveCue()?.key).toBe(intro[1]!.key);expect(director.getElapsedBaseMs()).toBe(400);
  director.dispose();
});
test("door fades while moving, ending in black before dialogue; reduced motion retains timing", async () => {
  const [window] = await windows();const door=werewolfOpening(window!).at(-1)!;
  expect(sampleOpening(door,3000).opacity).toBe(1);
  expect(sampleOpening(door,4000).opacity).toBe(.5);
  expect(sampleOpening(door,5000).opacity).toBe(0);
  expect(sampleOpening(door,5300).musicGain).toBe(0);
  expect(sampleOpening(door,4000,true).scale).toBe(1);
});
test("full export prepends the same opening and audio envelopes without replacing gameplay music", async () => {
  const [window] = await windows();
  const cues = await buildExportCues({kind:"werewolf",title:"Silence Beneath the Lanterns",windows:[window!],thoughts:[]},false);
  const intro=werewolfOpening(window!,"Silence Beneath the Lanterns");
  expect(cues.slice(0,intro.length).map(c=>c.picture.cue)).toEqual(intro);
  expect(cues[intro.length]!.music?.src).toContain("lantern-to-fang");
  const profile=parseTimingProfile({motionScale:2});
  const timeline=compileTiming(cues.map(c=>c.timing),profile,30);
  expect(timeline[intro.length]!.startMs).toBe(intro[0]!.opening.totalMs);
  const assets = Object.fromEntries(cues.flatMap(c=>c.picture.kind==="werewolf-opening" ? [c.picture.cue.opening.musicUrl,c.picture.cue.opening.effectUrl].filter((s):s is string=>!!s) : c.music ? [c.music.src] : []).map(path=>[path,{path,sha256:"test",mediaType:"audio" as const,durationMs:200000}]));
  const audio=compileAudio(cues,timeline,assets,profile,true);
  const score=audio.clips.find(c=>c.asset===intro[0]!.opening.musicUrl)!;
  expect(audio.clips.filter(c=>c.purpose==="effects")).toHaveLength(2);
  expect(score.endMs).toBe(intro[0]!.opening.totalMs-300);
  const door=intro.at(-1)!;
  expect(audioGain(score,door.opening.startMs+4000,audio.clips)).toBeCloseTo(.3*sampleOpening(door,4000).musicGain);
  expect(compileAudio(cues,timeline,assets,profile,false).clips).toHaveLength(0);
});
