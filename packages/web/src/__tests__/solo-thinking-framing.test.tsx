import {createFormatKernelViewerScenario} from "@influence/engine/fixtures/format-kernel-viewer";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {chainSpeechBox, chainCharacterHead, SafetyChain} from "../app/games/[slug]/components/safety-chain";
import {afterEach, beforeEach, expect, test, spyOn} from "bun:test";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {Window} from "happy-dom";
import {SoloPresentation} from "../app/games/[slug]/components/solo-presentation";
import type {VisualPresentationBeat} from "../app/games/[slug]/components/visual-presentation";
import {WatchThinking} from "../components/watch/watch-thinking";
import {SceneThinkingProvider} from "../components/watch/watch-thinking";
import {NomineeSelection} from "../app/games/[slug]/components/nominee-selection";
import {PresentationDirector, type WatchCue} from "../components/watch/watch-director";
import {WerewolfContentFrame} from "../components/games/werewolf/werewolf-watch-stage";
import {werewolfMomentCues} from "../components/games/werewolf/werewolf-watch-model";
import {startWerewolf, werewolfConfig} from "../../../engine/src/werewolf/rules";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";

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
test("thinking shows its supplied role while a disabled Mystery thought renders no private content", async () => {
  const director = new PresentationDirector<WatchCue>({policy:{position:()=>1,speech:()=>null,isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues}});
  const thinking = spyOn(director,"getThinkingFrame").mockReturnValue({text:"A private plan.",elapsedMs:100,durationMs:2000,opacity:1,focus:1});
  const content = (enabled:boolean) => <WatchThinking director={director} cueKey={null} enabled={enabled} speaker="Player" roleLabel="werewolf" load={load}>
    <SoloPresentation beat={beat} elapsedMs={1000}/>
  </WatchThinking>;
  const view=render(content(true));
  expect(view.container.querySelector("[data-thinking-role]")?.textContent).toBe("werewolf");
  view.rerender(content(false));
  expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
  expect(view.container.textContent).not.toContain("A private plan.");
  await act(async()=>{});thinking.mockRestore();
});
test("the tie-break scene shows the empowered thought before returning to the unselected nominee pool", async () => {
  Object.defineProperties(dom.HTMLElement.prototype, {clientWidth:{configurable:true,get:()=>1440},clientHeight:{configurable:true,get:()=>900}});
  const chooser = {id:"p",name:"Player",persona:"",avatarUrl:"/portrait.png",status:"alive" as const,shielded:false};
  const nominee = { ...chooser, id:"target",name:"Target" };
  const thought = {speaker:chooser.name,text:"My deciding choice",elapsedMs:100,durationMs:2000,opacity:1,focus:1};
  const content = (thinking: boolean) => <SceneThinkingProvider thought={thinking ? thought : null}>
    <NomineeSelection beat={{kind:"nominee-selection",chooser,nominees:[nominee],selectedId:null}} elapsedMs={0} reducedMotion />
  </SceneThinkingProvider>;
  const view = render(content(true));
  expect(view.container.querySelector("[data-in-scene-thinking]")?.textContent).toContain(thought.text);
  expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
  expect(view.container.querySelector("[data-selected=true]")).toBeNull();
  view.rerender(content(false));
  expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
  expect(view.container.querySelector("[data-nominee=target]")).not.toBeNull();
  expect(view.container.querySelector("[data-selected=true]")).toBeNull();
  await act(async () => {});
});
for (const audience of ["mystery", "omniscient"] as const) test(`${audience}: role has its own label only in omniscient speech`, async () => {
  Object.defineProperties(dom.HTMLElement.prototype, {clientWidth:{configurable:true,get:()=>390},clientHeight:{configurable:true,get:()=>700}});
  const players = Array.from({length:6}, (_,i)=>({id:`p${i}`,name:`Player ${i}`,personality:"Careful",backstory:"",strategy:"",avatarUrl:null}));
  const template = projectWerewolfWatch([startWerewolf("role-label",players,werewolfConfig("one_wolf",1),"seed")],"omniscient").moments[0]!;
  const wolf = template.snapshot.players.find(p=>p.role === "werewolf")!;
  const [cue] = werewolfMomentCues({...template, chapterId:"introduction", snapshot:{...template.snapshot,audience},
    entry:{kind:"speech",day:0,audience:"public",actorId:wolf.id,text:"Hello, everyone.",cue:null}});
  const view = render(<WerewolfContentFrame cue={cue!} scene={null} elapsed={1000} reduced />);
  const bubble = view.container.querySelector("[data-speech-bubble]")!;
  expect(bubble.textContent).toContain(wolf.name);
  expect(bubble.textContent).toContain("Introduction");
  const role = bubble.querySelector("[data-speaker-role]");
  if (audience === "omniscient") expect(role?.textContent).toBe("werewolf");
  else {expect(role).toBeNull();expect(bubble.textContent).not.toContain("werewolf");}
  await act(async () => {});
});
for (const speechPresentation of ["solo","scene"] as const) for (const [width,height] of [[1440,900],[390,700],[640,250]]) {
  test(`${speechPresentation}: ${width}x${height} thinking camera returns to normal framing before speech`, async () => {
    Object.defineProperties(dom.HTMLElement.prototype, {clientWidth:{configurable:true,get:()=>width},clientHeight:{configurable:true,get:()=>height}});
    const director = new PresentationDirector<WatchCue>({policy:{position:()=>1,speech:()=>null,isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues}});
    const thinking = spyOn(director,"getThinkingFrame").mockReturnValue(null);
    const content = (elapsedMs:number, enabled=true) => <WatchThinking director={director} cueKey={null} enabled={enabled} speaker="Player" load={load}>
      <SoloPresentation beat={beat} elapsedMs={elapsedMs} speechPresentation={speechPresentation}/>
    </WatchThinking>;
    const view=render(content(0));
    const image=view.container.querySelector<HTMLImageElement>("[data-solo-portrait]")!;
    Object.defineProperties(image,{naturalWidth:{value:800},naturalHeight:{value:1200}});
    fireEvent.load(image);
    const rectangle=()=>[image.style.left,image.style.top,image.style.width,image.style.height];
    const reserved=rectangle();
    const camera=()=>view.container.querySelector<HTMLElement>("[data-thinking-camera]")!.style.transform;
    const normal=camera();
    expect(parseFloat(image.style.height)).toBeGreaterThan(0);
    expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
    thinking.mockReturnValue({text:"One precise question.",elapsedMs:100,durationMs:2000,opacity:1,focus:1});
    view.rerender(content(1000));
    expect(view.container.querySelector("[data-in-scene-thinking]")).not.toBeNull();
    expect(rectangle()).toEqual(reserved);
    expect(camera()).not.toBe(normal);
    const backdrop = view.container.querySelector("[data-room-backdrop]")!;
    expect(backdrop.closest("[data-thinking-camera]")).toBeNull();
    expect(backdrop.parentElement).toBe(view.container.querySelector("[data-solo-image]"));
    expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
    thinking.mockReturnValue(null);
    view.rerender(content(100000));
    expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
    expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
    expect(rectangle()).toEqual(reserved);
    view.rerender(content(0,false));
    expect(rectangle()).toEqual(reserved);
    expect(camera()).toBe(normal);
    await act(async () => {});
    thinking.mockRestore();
  });
}


for (const [width,height] of [[1440,900],[390,844]]) test(`Safety Bounce ${width}x${height} uses standard camera and thought bubbles before returning to the board`, async () => {
  Object.defineProperties(dom.HTMLElement.prototype,{clientWidth:{configurable:true,get:()=>width},clientHeight:{configurable:true,get:()=>height}});
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const cue = compileFormatPresentationPrefix({gameId:"g",gameKernel:"format",roster:fixture.roster,decisions:fixture.decisions}).cues.find(cue=>cue.kind === "safety_bounce_pointer")!;
  if (cue.kind !== "safety_bounce_pointer") throw new Error("Missing pointer fixture");
  const roster = fixture.roster.map(player=>({...player,persona:"",status:"alive" as const,shielded:false,fullBodyReferenceUrl:"/body.png"}));
  const thought = {speaker:"Atlas",text:"My private chain reasoning.",elapsedMs:1000,durationMs:3000,opacity:1,focus:1};
  const content = (thinking:boolean) => <SceneThinkingProvider thought={thinking ? thought : null}>
    <SafetyChain beat={{kind:"safety-chain",cue,roster}} elapsedMs={0}/>
  </SceneThinkingProvider>;
  const view = render(content(true));
  expect(view.container.querySelectorAll("[data-thought-tail]").length).toBeGreaterThan(0);
  expect(view.container.querySelector("[data-in-scene-thinking]")?.textContent).toContain(thought.text);
  expect(view.container.querySelector<HTMLElement>("[data-thinking-camera]")?.style.transform).not.toBe("translate(0px, 0px) scale(1)");
  expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
  view.rerender(content(false));
  expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
  expect(view.container.querySelector("[data-safety-chain]")).not.toBeNull();
  expect(view.container.querySelector(`[data-chain-player="${cue.actorId}"]`)?.getAttribute("data-chooser")).toBe("true");
  await act(async()=>{});
});


test("Safety Bounce camera targets the contained body pixels at the actor's existing board position", () => {
  const face = chainCharacterHead({left:80,top:190,width:320,height:550},{width:200,height:600},true,{x:.4,y:.04,width:.2,height:.16});
  expect(face.left + face.width / 2).toBeCloseTo(240);
  expect(face.top).toBeCloseTo(212);
  expect(face.height).toBeCloseTo(88);
  const shifted = chainCharacterHead({left:130,top:220,width:320,height:550},{width:200,height:600},true,{x:.4,y:.04,width:.2,height:.16});
  expect(shifted.left - face.left).toBeCloseTo(50);
  expect(shifted.top - face.top).toBeCloseTo(30);
});


test("Safety Bounce speech sits below the desktop head and above the mobile head", () => {
  const face = {left:220,top:200,width:40,height:80};
  const desktop = chainSpeechBox(1000,900,face);
  expect(desktop.top).toBe(face.top + face.height + 16);
  expect(desktop.left + desktop.width).toBeLessThanOrEqual(500);
  const mobileFace = {left:80,top:340,width:40,height:60};
  const mobile = chainSpeechBox(390,844,mobileFace);
  expect(mobile.top + mobile.height).toBe(mobileFace.top - 16);
  expect(mobile.left).toBe(16);
  expect(mobile.width).toBe(358);
});
