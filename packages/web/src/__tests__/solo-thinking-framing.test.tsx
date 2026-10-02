import {afterEach, beforeEach, expect, test, spyOn} from "bun:test";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {Window} from "happy-dom";
import {SoloPresentation} from "../app/games/[slug]/components/solo-presentation";
import type {VisualPresentationBeat} from "../app/games/[slug]/components/visual-presentation";
import {WatchThinking} from "../components/watch/watch-thinking";
import {PresentationDirector, type WatchCue} from "../components/watch/watch-director";

const keys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const;
const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let dimensions: Map<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  dom = new Window({url:"http://localhost"});
  dimensions = new Map(["clientWidth", "clientHeight"].map(key => [key, Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype,key)]));
  Object.defineProperty(dom.document, "fonts", {value:{ready:Promise.resolve()}});
  for (const key of keys) {
    const value = key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : key === "requestAnimationFrame" ? () => 0 : key === "cancelAnimationFrame" ? () => {} : dom[key];
    Object.defineProperty(globalThis, key, {configurable:true, value});
  }
});
afterEach(() => {
  cleanup();
  for (const [key, descriptor] of dimensions) {if(descriptor)Object.defineProperty(dom.HTMLElement.prototype,key,descriptor);else Reflect.deleteProperty(dom.HTMLElement.prototype,key);}
  dom.close();
  for (const key of keys) {const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});
const beat: Extract<VisualPresentationBeat,{kind:"portrait"}> = {
  kind:"portrait", purpose:"Introduction",
  player:{id:"p",name:"Player",persona:"",avatarUrl:"/portrait.png",fullBodyReferenceUrl:"/body.png"},
  speech:{id:"s",playerId:"p",speaker:"Player",text:"Hello, everyone."},
};
const load = async () => null;
for (const speechPresentation of ["solo","scene"] as const) for (const [width,height] of [[1440,900],[390,700],[640,250]]) {
  test(`${speechPresentation}: ${width}x${height} full-body framing stays fixed through empty, thought and speech intervals`, async () => {
    Object.defineProperties(dom.HTMLElement.prototype, {clientWidth:{configurable:true,get:()=>width},clientHeight:{configurable:true,get:()=>height}});
    const director = new PresentationDirector<WatchCue>({policy:{position:()=>1,speech:()=>null,isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues}});
    const thinking = spyOn(director,"getThinkingFrame").mockReturnValue(null);
    const content = (elapsedMs:number, enabled=true) => <WatchThinking director={director} cueKey={null} enabled={enabled} order="thinking-first" speaker="Player" load={load}>
      <SoloPresentation beat={beat} elapsedMs={elapsedMs} speechPresentation={speechPresentation}/>
    </WatchThinking>;
    const view=render(content(0));
    const image=view.container.querySelector<HTMLImageElement>("[data-solo-portrait]")!;
    Object.defineProperties(image,{naturalWidth:{value:800},naturalHeight:{value:1200}});
    fireEvent.load(image);
    const rectangle=()=>[image.style.left,image.style.top,image.style.width,image.style.height];
    const reserved=rectangle();
    expect(parseFloat(image.style.height)).toBeGreaterThan(0);
    expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
    thinking.mockReturnValue({text:"One precise question.",elapsedMs:100,durationMs:2000,opacity:1});
    view.rerender(content(1000));
    expect(view.container.querySelector("[data-in-scene-thinking]")).not.toBeNull();
    expect(rectangle()).toEqual(reserved);
    thinking.mockReturnValue(null);
    view.rerender(content(100000));
    expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
    expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
    expect(rectangle()).toEqual(reserved);
    view.rerender(content(0,false));
    expect(rectangle()).not.toEqual(reserved);
    await act(async () => {});
    thinking.mockRestore();
  });
}
