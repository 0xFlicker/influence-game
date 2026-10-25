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
let director: PresentationDirector<WatchCue>;
const policy: WatchPolicy<WatchCue> = {
  position: () => 1, speech: () => ({showAtMs:500, readAtMs:800, hideAtMs:3500, hiddenAtMs:3800}),
  isCatchUp: () => false, acceptAtWatermark: () => false, reconcile: cues => cues,
};
const coordinate = (cursor: number): AudioWatchCoordinate => ({kind:"werewolf", cursor, actorId:"p", part:"speech"});

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = true; readyState = 2; currentTime = 0; src = ""; preload = "";
  muted = false; volume = 1; playbackRate = 1; error = null;
  onwaiting: (() => void) | null = null;
  oncanplay: (() => void) | null = null;
  onerror: (() => void) | null = null;
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
}

beforeEach(() => {
  dom = new Window({url:"http://localhost"});
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"] as const) {
    Object.defineProperty(globalThis, key, {configurable:true, value:key === "window" ? dom : dom[key]});
  }
  frames = new Map(); nextFrame = 0; FakeAudio.instances = [];
  Object.defineProperty(globalThis, "Audio", {configurable:true, value:FakeAudio});
  globalThis.requestAnimationFrame = callback => {frames.set(++nextFrame, callback);return nextFrame;};
  globalThis.cancelAnimationFrame = id => {frames.delete(id);};
  Object.defineProperty(globalThis, "fetch", {configurable:true, value:async () => Response.json({id:"track", clips:[1,2].map(cursor => ({
    momentId:`moment-${cursor}`, watch:coordinate(cursor), speakerId:"p", textHash:"text", versionId:`clip-${cursor}`, sha256:"hash", durationMs:4000, url:`/clip-${cursor}.mp3`,
  }))})});
  setApiBase("");
  director = new PresentationDirector({policy, clock:{now:() => 0, setTimeout:() => 1, clearTimeout:() => {}}});
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
    for (const callback of pending) callback(0);
  });
}
async function mount() {
  let pauses = 0;
  const hook = renderHook(({cursor}) => useWatchVoice({director, gameId:"g", audience:"public", thinking:false,
    coordinate:coordinate(cursor), onPause:() => {pauses++;},
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
  await act(async () => {view.audio.readyState = 2;view.audio.oncanplay?.();finish();});
  expect(director.getSnapshot().isPlaying).toBe(true);
  expect(view.result.current.error).toBeNull();
});
