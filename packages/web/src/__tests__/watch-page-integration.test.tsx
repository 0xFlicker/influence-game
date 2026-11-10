import {afterEach, beforeEach, expect, test} from "bun:test";
import {act, cleanup, render} from "@testing-library/react";
import {Window} from "happy-dom";
import {visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import {TimedSpeech} from "../app/games/[slug]/components/timed-speech";
import {PresentationDirector, type PresentationClock, type WatchPolicy} from "../components/watch/watch-director";
import {WatchPageContext} from "../components/watch/watch-page-context";

const globals = ["window", "document", "navigator", "HTMLElement", "Node"] as const;
const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({url:"http://localhost"});
  for (const name of globals) Object.defineProperty(globalThis, name, {configurable:true,value:dom[name]});
});
afterEach(() => {
  cleanup(); dom.close();
  for (const name of globals) {const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);}
});
class Clock implements PresentationClock {
  now() {return 0;}
  setTimeout() {return 1;}
  clearTimeout() {}
}

test("the director advances the actual rendered pages one at a time while paused", () => {
  const pages = ["First page. ", "Second page has more. ", "Third page. ", "Fourth page. ", "Fifth page. ", "Sixth page."];
  const text = pages.join("");
  const reading = visualSpeechDurationMs(text) - 2 * VISUAL_SPEECH_FADE_MS;
  const readAt = 500 + VISUAL_SPEECH_FADE_MS;
  const policy:WatchPolicy<{key:string;baseDurationMs:number}> = {position:()=>1,speech:()=>({showAtMs:500,readAtMs:readAt,hideAtMs:readAt + reading,hiddenAtMs:readAt + reading + 300}),isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues};
  const director = new PresentationDirector({clock:new Clock(),policy});
  director.load([{key:"first",baseDurationMs:readAt + reading + 500},{key:"second",baseDurationMs:1000}]);
  director.seekTimeline(0,readAt);
  const typography = {width:400,height:200,fontSize:24,lineHeight:1.4,pages,footerHeight:22,headerHeight:28};
  const picture = () => <WatchPageContext.Provider value={director}><TimedSpeech advancePart="speech" text={text} elapsedMs={director.getSpeechElapsedBaseMs()-500} typography={typography} /></WatchPageContext.Provider>;
  const view = render(picture());
  for (let index=0; index<pages.length; index++) {
    expect(view.container.querySelector("[data-speech-page]")?.getAttribute("data-speech-page")).toBe(String(index));
    expect(view.container.querySelector("[data-speech-page]")?.textContent).toBe(pages[index]!);
    if (index < pages.length-1) act(() => {director.manualAdvance(); view.rerender(picture());});
  }
  expect(director.getSnapshot().activeKey).toBe("first");
  expect(director.getSnapshot().isPlaying).toBe(false);
});

test.each([false,true])("measured thought pages advance before the same player's speech (recorded: %s)", recorded => {
  const pages = ["One thought. ", "Second thought. ", "Third thought. ", "Fourth thought. ", "Fifth thought. ", "Last thought."];
  const text = pages.join("");
  const policy:WatchPolicy<{key:string;baseDurationMs:number}> = {position:()=>1,speech:()=>({showAtMs:500,readAtMs:800,hideAtMs:3500,hiddenAtMs:3800}),isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues};
  const director = new PresentationDirector({clock:new Clock(),policy});
  director.load([{key:"first",baseDurationMs:4000},{key:"second",baseDurationMs:4000}]);
  if (recorded) director.setRecordings("first",{thinkingMs:12000});
  director.setThinking("first",text);
  director.seekTimeline(0,1800);
  const typography = {width:400,height:200,fontSize:24,lineHeight:1.4,pages,footerHeight:22,headerHeight:28};
  const reading = visualSpeechDurationMs(text) - 2 * VISUAL_SPEECH_FADE_MS;
  const picture = () => {
    const thought = director.getThinkingFrame()!;
    return <WatchPageContext.Provider value={director}><TimedSpeech advancePart="thinking" text={text} elapsedMs={VISUAL_SPEECH_FADE_MS + thought.elapsedMs / thought.durationMs * reading} typography={typography} /></WatchPageContext.Provider>;
  };
  const view = render(picture());
  let previousOffset = -1;
  for (let index=0; index<pages.length; index++) {
    expect(view.container.querySelector("[data-speech-page]")?.getAttribute("data-speech-page")).toBe(String(index));
    expect(view.container.querySelector("[data-speech-page]")?.textContent).toBe(pages[index]);
    if (recorded) {
      const audio = director.getAudioPosition();
      expect(audio?.part).toBe("thinking");expect(audio!.offsetMs).toBeGreaterThan(previousOffset);previousOffset = audio!.offsetMs;
    }
    if (index < pages.length-1) act(() => {director.manualAdvance(); view.rerender(picture());});
  }
  expect(director.getSnapshot().activeKey).toBe("first");
  expect(director.getSnapshot().isPlaying).toBe(false);
});

test("rendered pages and recorded audio seek to the same next page", () => {
  const pages = ["One line. ", "Another longer line. ", "Third line. ", "Fourth line. ", "Fifth line. ", "Final line."];
  const text = pages.join("");
  const reading = visualSpeechDurationMs(text) - 2 * VISUAL_SPEECH_FADE_MS;
  const readAt = 500 + VISUAL_SPEECH_FADE_MS;
  const policy:WatchPolicy<{key:string;baseDurationMs:number}> = {position:()=>1,speech:()=>({showAtMs:500,readAtMs:readAt,hideAtMs:readAt + reading,hiddenAtMs:readAt + reading + 300}),isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues};
  const director = new PresentationDirector({clock:new Clock(),policy});
  director.load([{key:"first",baseDurationMs:readAt + reading + 500}]);
  director.setRecordings("first",{speechMs:12000});
  director.seekTimeline(0,readAt);
  const typography = {width:400,height:200,fontSize:24,lineHeight:1.4,pages,footerHeight:22,headerHeight:28};
  const picture = () => <WatchPageContext.Provider value={director}><TimedSpeech advancePart="speech" text={text} elapsedMs={director.getSpeechElapsedBaseMs()-500} typography={typography} /></WatchPageContext.Provider>;
  const view = render(picture());
  let previousOffset = -1;
  for (let index=0; index<pages.length; index++) {
    expect(view.container.querySelector("[data-speech-page]")?.textContent).toBe(pages[index]);
    const audio = director.getAudioPosition();
    expect(audio?.part).toBe("speech");
    expect(audio!.offsetMs).toBeGreaterThan(previousOffset);
    previousOffset = audio!.offsetMs;
    if (index < pages.length-1) act(() => {director.manualAdvance(); view.rerender(picture());});
  }
  expect(director.getSnapshot().isPlaying).toBe(false);
});
