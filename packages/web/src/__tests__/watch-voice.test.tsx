import {afterEach, beforeEach, expect, test} from "bun:test";
import {act, cleanup, renderHook} from "@testing-library/react";
import {Window} from "happy-dom";
import type {AudioWatchCoordinate} from "@influence/engine/audio-watch";
import {useWatchVoice} from "../components/watch/use-watch-voice";
import {PresentationDirector, type WatchCue, type WatchPolicy} from "../components/watch/watch-director";
import {setApiBase} from "../lib/api";

const keys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "Audio", "requestAnimationFrame", "cancelAnimationFrame", "fetch"] as const;
const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let now: number;
let frameTime: number;
let director: PresentationDirector<WatchCue>;
const policy: WatchPolicy<WatchCue> = {
  position: () => 1, speech: () => ({showAtMs:500, readAtMs:800, hideAtMs:3500, hiddenAtMs:3800}),
  isCatchUp: () => false, acceptAtWatermark: () => false, reconcile: cues => cues,
};
const coordinate = (cursor: number): AudioWatchCoordinate => ({kind:"werewolf", cursor, actorId:"p", part:"speech"});

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = true; readyState = 4; src = ""; preload = ""; seeking = false; duration = 4;
  time = 0; seeks: number[] = []; seekOnWrite = false;
  get currentTime() {return this.time;}
  set currentTime(value: number) {this.time=value;this.seeks.push(value);if(this.seekOnWrite)this.seeking=true;}
  muted = false; volume = 1; playbackRate = 1; error = null;
  onwaiting: (() => void) | null = null;
  oncanplay: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onemptied: (() => void) | null = null;
  onvolumechange: (() => void) | null = null;
  plays = 0;
  nextPlay: (() => Promise<void>) | null = null;
  constructor() {FakeAudio.instances.push(this);}
  play() {
    this.plays++;
    this.paused = false;
    return this.nextPlay?.() ?? Promise.resolve();
  }
  pause() {this.paused = true;}
  load() {queueMicrotask(() => this.oncanplay?.());}
  removeAttribute() {this.src = "";}
  getAttribute() {return this.src || null;}
}

beforeEach(() => {
  dom = new Window({url:"http://localhost"});
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"] as const) {
    Object.defineProperty(globalThis, key, {configurable:true, value:key === "window" ? dom : dom[key]});
  }
  frames = new Map(); nextFrame = 0; now = 0; frameTime = 0; FakeAudio.instances = [];
  Object.defineProperty(globalThis, "Audio", {configurable:true, value:FakeAudio});
  globalThis.requestAnimationFrame = callback => {frames.set(++nextFrame, callback);return nextFrame;};
  globalThis.cancelAnimationFrame = id => {frames.delete(id);};
  Object.defineProperty(globalThis, "fetch", {configurable:true, value:async () => Response.json({id:"track", clips:[1,2].map(cursor => ({
    momentId:`moment-${cursor}`, watch:coordinate(cursor), speakerId:"p", textHash:"text", versionId:`clip-${cursor}`, sha256:"hash", durationMs:4000, url:`/clip-${cursor}.mp3`,
  }))})});
  setApiBase("");
  director = new PresentationDirector({policy, clock:{now:() => now, setTimeout:() => 1, clearTimeout:() => {}}});
  director.load([{key:"one", baseDurationMs:4000}, {key:"two", baseDurationMs:4000}]);
});
afterEach(() => {
  cleanup(); director.dispose(); dom.close();
  for (const key of keys) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function frame() {
  await act(async () => {
    const pending = [...frames.values()]; frames.clear();
    frameTime += 34;
    for (const callback of pending) callback(frameTime);
  });
}
async function mount(onSpeech?: (speaking:boolean,id:string|null)=>void) {
  let pauses = 0;
  const hook = renderHook(({cursor}) => useWatchVoice({director, gameId:"g", audience:"public", thinking:false,
    coordinate:coordinate(cursor), onSpeech, onPause:() => {pauses++;},
  }), {initialProps:{cursor:1}});
  await act(async () => {});
  act(() => director.seekTimeline(0, 1200));
  await frame();
  return {...hook, audio:FakeAudio.instances[0]!, pauses:() => pauses};
}

for (const name of ["NotAllowedError", "AbortError"]) test(`${name} pauses silently and ordinary Play retries synchronously at the same position`, async () => {
  const view = await mount();
  view.audio.nextPlay = () => Promise.reject(new DOMException("blocked", name));
  act(() => director.play());
  await frame();
  expect(director.getSnapshot().isPlaying).toBe(false);
  expect(view.pauses()).toBe(1);
  expect(view.result.current.error).toBeNull();
  const position = director.getTimelineElapsedBaseMs();
  const plays = view.audio.plays;
  await frame();
  expect(view.audio.plays).toBe(plays);
  view.audio.nextPlay = null;
  await act(async () => {
    view.result.current.resume();
    expect(view.audio.plays).toBe(plays + 1);
    director.play();
  });
  expect(director.getSnapshot().isPlaying).toBe(true);
  expect(director.getTimelineElapsedBaseMs()).toBe(position);
  expect(view.audio.paused).toBe(false);
});

test("cue changes retain the unlocked element and ignore a stale play rejection", async () => {
  const view = await mount();
  let rejectPlay: (cause: Error) => void = () => {throw new Error("play not started");};
  view.audio.nextPlay = () => new Promise((_, reject) => {rejectPlay = reject;});
  act(() => director.play()); await frame();
  view.audio.nextPlay = null;
  act(() => {director.seekTimeline(1, 1200);view.rerender({cursor:2});});
  await frame();
  await act(async () => rejectPlay(new DOMException("old clip", "AbortError")));
  expect(FakeAudio.instances).toHaveLength(1);
  expect(director.getSnapshot().isPlaying).toBe(true);
  expect(view.pauses()).toBe(0);
  expect(view.result.current.error).toBeNull();
});

test("late success cannot restart a replay the user paused", async () => {
  const view = await mount();
  let finish: () => void = () => {throw new Error("play not started");};
  view.audio.nextPlay = () => new Promise(resolve => {finish = resolve;});
  act(() => {view.result.current.resume();director.play();});
  act(() => director.pause()); await frame();
  await act(async () => finish());
  expect(director.getSnapshot().isPlaying).toBe(false);
  expect(view.audio.paused).toBe(true);
});

test("genuine media failure stays visible and retries through Play", async () => {
  const view = await mount();
  view.audio.nextPlay = () => Promise.reject(new DOMException("format", "NotSupportedError"));
  act(() => director.play()); await frame();
  expect(view.result.current.error).toBe("Voice audio could not play. Press Play to retry.");
  view.audio.nextPlay = null;
  await act(async () => {view.result.current.resume();director.play();});
  expect(view.result.current.error).toBeNull();
  expect(director.getSnapshot().isPlaying).toBe(true);
});

test("resuming while buffering does not cancel the user-initiated play attempt", async () => {
  const view = await mount();
  let finish: () => void = () => {throw new Error("play not started");};
  view.audio.nextPlay = () => new Promise(resolve => {finish = resolve;});
  view.audio.readyState = 1;
  act(() => {view.result.current.resume();director.play();view.audio.onwaiting?.();});
  await frame();
  expect(view.audio.paused).toBe(false);
  expect(view.audio.plays).toBe(1);
  await act(async () => {view.audio.readyState = 3;view.audio.oncanplay?.();finish();});
  expect(director.getSnapshot().isPlaying).toBe(true);
  expect(view.result.current.error).toBeNull();
});

test("a delayed decoder start freezes presentation time until play actually succeeds", async () => {
  const view = await mount();
  let finish: () => void = () => {throw new Error("play not started");};
  view.audio.nextPlay = () => new Promise(resolve => {finish=resolve;});
  act(() => {view.result.current.resume();director.play();});
  const position = director.getTimelineElapsedBaseMs();
  now += 1500; await frame();
  expect(director.getTimelineElapsedBaseMs()).toBe(position);
  expect(director.getSnapshot().isPlaying).toBe(true);
  await act(async () => finish());
  now += 100;
  expect(director.getTimelineElapsedBaseMs()).toBe(position+100);
});

test("voice playback does not chase a lagging native clock with repeated seeks", async () => {
  const view = await mount();
  await act(async () => {view.result.current.resume();director.play();});
  await frame();
  const seeks = view.audio.seeks.length;
  // Deliberately leave currentTime behind as the presentation clock advances.
  for (let index=0;index<40;index++) {now+=34;await frame();}
  expect(view.audio.seeks).toHaveLength(seeks);
  act(() => director.seekTimeline(0,2200)); await frame();
  expect(view.audio.seeks).toHaveLength(seeks+1);
  expect(view.audio.currentTime).toBeCloseTo(director.getAudioPosition()!.offsetMs/1000);
});

test("buffering freezes the director without pausing or restarting native audio", async () => {
  const view = await mount();
  await act(async () => {view.result.current.resume();director.play();}); await frame();
  const plays = view.audio.plays, position = director.getTimelineElapsedBaseMs();
  act(() => {view.audio.readyState=2;view.audio.onwaiting?.();});
  now+=1000; await frame();
  expect(view.audio.paused).toBe(false);
  expect(view.audio.plays).toBe(plays);
  expect(director.getTimelineElapsedBaseMs()).toBe(position);
  await act(async () => {view.audio.readyState=3;view.audio.oncanplay?.();});
  now+=100;
  expect(director.getTimelineElapsedBaseMs()).toBe(position+100);
  expect(view.audio.plays).toBe(plays);
});

test("an in-clip seek holds presentation time until seeked without restarting audio", async () => {
  const view = await mount();
  await act(async () => {view.result.current.resume();director.play();}); await frame();
  const plays=view.audio.plays;
  view.audio.seekOnWrite=true;
  act(() => director.seekTimeline(0,2200)); await frame();
  expect(view.audio.seeking).toBe(true);
  const seeks=view.audio.seeks.length;
  act(() => view.audio.onwaiting?.());
  now+=1000; await frame();
  expect(director.getTimelineElapsedBaseMs()).toBe(2200);
  // A seek may initially report a rounded/lagging clock. Its own waiting event
  // must not schedule an endless correction loop after seeked.
  await act(async () => {view.audio.time-=.05;view.audio.seeking=false;view.audio.onseeked?.();});
  expect(view.audio.seeks).toHaveLength(seeks);
  now+=100;
  expect(director.getTimelineElapsedBaseMs()).toBe(2300);
  expect(view.audio.plays).toBe(plays);
});

test("a paused seek is not retried when the decoder reports a rounded destination", async () => {
  const view = await mount();
  view.audio.seekOnWrite=true;
  act(() => director.seekTimeline(0,2200)); await frame();
  const seeks=view.audio.seeks.length;
  await act(async () => {view.audio.time-=.05;view.audio.seeking=false;view.audio.onseeked?.();});
  expect(view.audio.seeks).toHaveLength(seeks);
  expect(view.audio.paused).toBe(true);
});

test("playable voice still waits for the scene's independent readiness hold", async () => {
  const view = await mount();
  act(() => {director.setReady("one",false);director.play();}); await frame();
  expect(view.audio.paused).toBe(true);
  expect(view.audio.plays).toBe(0);
  act(() => director.setReady("one",true)); await frame();
  expect(view.audio.plays).toBe(1);
});

test("an opening gesture primes the same voice element used by the first speech", async () => {
  const view=renderHook(({cursor}:{cursor:number|null}) => useWatchVoice({director,gameId:"g",audience:"mystery",thinking:false,
    coordinate:cursor === null ? null : coordinate(cursor),onPause:() => {throw new Error("unexpected pause");},
  }), {initialProps:{cursor:null} as {cursor:number|null}});
  await act(async () => {});
  await act(async () => view.result.current.resume());
  const audio=FakeAudio.instances[0]!;
  expect(audio.src).toBe("/music/unlock.wav");
  expect(audio.paused).toBe(true);
  expect(audio.plays).toBe(1);
  act(() => {view.rerender({cursor:1});director.seekTimeline(0,1200);director.play();});
  await frame();
  expect(FakeAudio.instances).toHaveLength(1);
  expect(audio.src).toBe("/clip-1.mp3");
  expect(audio.plays).toBe(2);
  expect(audio.paused).toBe(false);
});

test("Play during a silent pose does not cancel pending voice activation", async () => {
  const view=renderHook(() => useWatchVoice({director,gameId:"g",audience:"mystery",thinking:false,
    coordinate:coordinate(1),onPause:() => {throw new Error("unexpected pause");},
  }));
  await act(async () => {});
  const audio=FakeAudio.instances[0]!;
  let finish: () => void = () => {throw new Error("prime not started");};
  audio.nextPlay=()=>new Promise(resolve=>{finish=resolve;});
  act(() => {view.result.current.resume();director.play();});
  await frame();
  expect(audio.src).toBe("/music/unlock.wav");
  expect(audio.paused).toBe(false);
  await act(async () => finish());
  expect(audio.paused).toBe(true);
  audio.nextPlay=null;now=1200;await frame();
  expect(audio.src).toBe("/clip-1.mp3");
  expect(audio.paused).toBe(false);
});


test("follow speech starts at actual playing, excludes preloads, and ends on mute/pause/end", async () => {
  const events: [boolean,string|null][]=[];
  const view=await mount((speaking,id)=>events.push([speaking,id]));
  expect(events).toEqual([]);
  act(()=>director.play());await frame();
  expect(view.audio.plays).toBeGreaterThan(0);
  expect(events).toEqual([]);
  act(()=>view.audio.onplaying?.());
  expect(events).toEqual([[true,"p"]]);
  act(()=>{view.audio.muted=true;view.audio.onvolumechange?.();});
  expect(events.at(-1)).toEqual([false,null]);
  act(()=>{view.audio.muted=false;view.audio.onvolumechange?.();});
  expect(events.at(-1)).toEqual([true,"p"]);
  act(()=>{view.audio.pause();view.audio.onpause?.();});
  expect(events.at(-1)).toEqual([false,null]);
  act(()=>{view.audio.play();view.audio.onplaying?.();});
  expect(events.at(-1)).toEqual([true,"p"]);
  act(()=>view.audio.onended?.());
  expect(events.at(-1)).toEqual([false,null]);
  view.unmount();
});

test("master mute immediately silences voice while preserving its channel settings", async () => {
  const hook=renderHook(({masterMuted}) => useWatchVoice({director,gameId:"g",audience:"public",thinking:false,
    coordinate:coordinate(1),onPause:()=>{},masterMuted}),{initialProps:{masterMuted:false}});
  await act(async () => {});
  const audio=FakeAudio.instances[0]!;
  act(() => hook.result.current.setVolume(.4));
  hook.rerender({masterMuted:true});
  expect(audio.muted).toBe(true);
  expect(hook.result.current.muted).toBe(false);
  expect(audio.volume).toBe(.4);
  hook.rerender({masterMuted:false});
  expect(audio.muted).toBe(false);
  act(() => hook.result.current.setMuted(true));
  hook.rerender({masterMuted:true});
  hook.rerender({masterMuted:false});
  expect(audio.muted).toBe(true);
  expect(audio.volume).toBe(.4);
});

test('House hold pauses media in place, blocks resume, and preserves manual pause',async()=>{
 let pauses=0;
 const hook=renderHook(({suspended})=>useWatchVoice({director,gameId:'g',audience:'public',thinking:false,coordinate:coordinate(1),onPause:()=>{pauses++;},suspended}),{initialProps:{suspended:false}});
 await act(async()=>{});act(()=>{director.seekTimeline(0,1200);director.play();});await frame();
 const audio=FakeAudio.instances[0]!;expect(audio.paused).toBe(false);
 act(()=>{director.setCommentaryHeld(true);hook.rerender({suspended:true});});await frame();
 const time=audio.currentTime,plays=audio.plays;
 act(()=>hook.result.current.resume());await frame();expect(audio.paused).toBe(true);expect(audio.plays).toBe(plays);expect(audio.currentTime).toBe(time);expect(pauses).toBe(0);expect(director.getSnapshot().isPlaying).toBe(true);
 act(()=>{director.setCommentaryHeld(false);hook.rerender({suspended:false});});await frame();expect(audio.paused).toBe(false);
 act(()=>{director.setCommentaryHeld(true);hook.rerender({suspended:true});director.pause();director.setCommentaryHeld(false);hook.rerender({suspended:false});});await frame();expect(audio.paused).toBe(true);expect(director.getSnapshot().isPlaying).toBe(false);
});

test('an in-flight play aborted by House hold does not clear the operator play intent',async()=>{
 let pauses=0,rejectPlay:(error:Error)=>void=()=>{};
 const hook=renderHook(({suspended})=>useWatchVoice({director,gameId:'g',audience:'public',thinking:false,coordinate:coordinate(1),onPause:()=>{pauses++;},suspended}),{initialProps:{suspended:false}});
 await act(async()=>{});act(()=>director.seekTimeline(0,1200));await frame();
 const audio=FakeAudio.instances[0]!;audio.nextPlay=()=>new Promise((_,reject)=>{rejectPlay=reject;});act(()=>director.play());await frame();
 act(()=>{director.setCommentaryHeld(true);hook.rerender({suspended:true});});
 await act(async()=>rejectPlay(new DOMException('interrupted','AbortError')));
 expect(pauses).toBe(0);expect(director.getSnapshot().isPlaying).toBe(true);expect(audio.paused).toBe(true);
});
