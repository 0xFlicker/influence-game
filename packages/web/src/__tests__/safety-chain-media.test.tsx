import {afterEach, beforeEach, expect, test} from "bun:test";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {Profiler} from "react";
import {Window} from "happy-dom";
import {SafetyChain, type SafetyChainThinkingBeat} from "../app/games/[slug]/components/safety-chain";

const keys = ["window", "document", "navigator", "HTMLElement", "HTMLImageElement", "Element", "Node", "Event", "ResizeObserver", "getComputedStyle"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
beforeEach(() => {
  for (const key of keys) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  dom = new Window({url: "http://localhost"});
  Object.defineProperty(dom.document, "fonts", {configurable: true, value: {ready: Promise.resolve()}});
  for (const key of keys) Object.defineProperty(globalThis, key, {configurable: true, value: key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : dom[key]});
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    dom.close();
    for (const key of keys) {
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
function beat(source: string): SafetyChainThinkingBeat {
  return {kind:"safety-chain-thinking",actorId:"a",round:1,
    board:{starterId:"a",currentActorId:"a",pointers:[],safePlayerIds:["a"],vulnerablePlayerIds:[],benchPlayerIds:["b"]},
    roster:[{id:"a",name:"A",persona:"observer",status:"alive",shielded:false,avatarUrl:source},
      {id:"b",name:"B",persona:"observer",status:"alive",shielded:false,avatarUrl:"/other.png"}]};
}
test("Safety Bounce ignores duplicate image loads but measures changed sources and dimensions", async () => {
  let commits=0;
  const picture=(source:string)=><Profiler id="chain" onRender={()=>{commits++;}}><SafetyChain beat={beat(source)} elapsedMs={500}/></Profiler>;
  const view=render(picture("/first.png"));
  const image=view.getByAltText("A") as HTMLImageElement;
  await act(async()=>{fireEvent.load(image);});
  const settled=commits;
  await act(async()=>{fireEvent.load(image);fireEvent.load(image);});
  expect(commits).toBe(settled);

  view.rerender(picture("/second.png"));
  const beforeSourceLoad=commits;
  await act(async()=>{fireEvent.load(image);});
  expect(commits).toBeGreaterThan(beforeSourceLoad);
  const afterSourceLoad=commits;
  await act(async()=>{fireEvent.load(image);});
  expect(commits).toBe(afterSourceLoad);

  Object.defineProperty(image,"naturalWidth",{configurable:true,value:240});
  const beforeResize=commits;
  await act(async()=>{fireEvent.load(image);});
  expect(commits).toBeGreaterThan(beforeResize);
});
