import {afterEach, beforeEach, expect, mock, test} from "bun:test";
import {Window} from "happy-dom";
import {act, cleanup, fireEvent, render as renderRoot, renderHook} from "@testing-library/react";
import type {WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {WerewolfContentFrame, WerewolfWatchStage} from "../components/games/werewolf/werewolf-watch-stage";
import {werewolfMomentCues, werewolfWatchPolicy} from "../components/games/werewolf/werewolf-watch-model";
import {WerewolfOpeningFrame} from "../components/games/werewolf/werewolf-opening-frame";
import type {WerewolfOpeningCue} from "../components/games/werewolf/werewolf-opening";
import {PresentationDirector} from "../components/watch/watch-director";
import {useWatchMusic} from "../components/watch/use-watch-music";
import {SCENE_READ_START_MS} from "../app/games/[slug]/components/scene-speech-timing";
import {SOLO_IMAGE_FADE_MS, SOLO_READ_START_MS} from "../app/games/[slug]/components/solo-presentation-timing";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "ResizeObserver", "getComputedStyle"] as const;
const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let dimensions: Map<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  dom = new Window({url: "http://localhost"});
  dimensions = new Map(["clientWidth", "clientHeight"].map(key => [key, Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, key)]));
  Object.defineProperty(dom.document, "fonts", {value: {ready: Promise.resolve()}});
  for (const key of globals) Object.defineProperty(globalThis, key, {configurable: true, value: key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : dom[key]});
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
  for (const [key, descriptor] of dimensions) {
    if (descriptor) Object.defineProperty(dom.HTMLElement.prototype, key, descriptor);
    else Reflect.deleteProperty(dom.HTMLElement.prototype, key);
  }
  dom.close();
  for (const key of globals) {
    const descriptor = original.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function render(element: Parameters<typeof renderRoot>[0]) {
  const container = document.createElement("div");
  document.body.append(container);
  // Exclude the hidden typography probes from visible speech assertions.
  return renderRoot(element, {container, baseElement: container});
}

function discussion(): WerewolfWatchMoment {
  return {
    cursor: 20, chapterId: "day:2", sceneId: "day:2:thread:1", mediaKey: null,
    snapshot: {
      gameId: "room", rulesVersion: 8, preset: "two_wolves", audience: "mystery", day: 2,
      maxDays: 5, phase: "day", cursor: 20, discussion: null, outcome: null,
      players: [
        {id: "a", name: "Arden", avatarUrl: "/arden.png", personaKey: "observer", alive: true},
        {id: "b", name: "Marlow", avatarUrl: "/marlow.png", personaKey: "diplomat", alive: true},
        {id: "c", name: "Vesper", avatarUrl: "/vesper.png", personaKey: "social", alive: false},
        {id: "d", name: "Larry", avatarUrl: "/larry.png", personaKey: "honest", alive: true},
      ],
    },
    entry: {kind: "discussion", day: 2, contribution: {
      actorId: "b", openerId: "b", thread: 1, stage: "opening", recipientIds: ["a"],
      replyToTurn: null, nextSpeakerId: "a", turn: 1, publicHistoryPosition: 20,
      text: "Arden, who do you suspect?", cue: null, unavailable: false,
    }},
  };
}
function frame(moment: WerewolfWatchMoment, scene: AcceptedVisualScene | null = null, onReady?: (ready: boolean) => void) {
  return <WerewolfContentFrame cue={werewolfMomentCues(moment)[0]!} scene={scene} elapsed={SCENE_READ_START_MS} reduced onReady={onReady} />;
}
function roomIds(container: HTMLElement) {
  return [...container.querySelectorAll("[data-room-player]")].map(element => element.getAttribute("data-room-player"));
}
test("a retained solo portrait releases readiness for each cue without another image load", () => {
  const moment = discussion();
  moment.chapterId = "introduction";
  moment.entry = {kind:"speech", day:0, audience:"public", actorId:"b", text:"Hello", cue:null};
  const first = werewolfMomentCues(moment)[0]!;
  const second = werewolfMomentCues({...moment, cursor:21, entry:{...moment.entry, text:"Again"}})[0]!;
  const third = werewolfMomentCues({...moment, cursor:22, entry:{...moment.entry, actorId:"a", text:"My turn"}})[0]!;
  const director = new PresentationDirector({policy:werewolfWatchPolicy, followTail:true});
  director.load([first, second, third]); director.play();
  const calls: Array<[string, boolean]> = [];
  const original = director.setReady.bind(director);
  director.setReady = (key, ready) => {calls.push([key, ready]); original(key, ready);};
  const draw = (cue: typeof first) => <WerewolfWatchStage cue={cue} scene={null} elapsed={0} reduced director={director} holding={false} status="in_progress" />;
  const view = render(draw(first));
  const image = view.getByRole("img", {name:"Marlow"});
  Object.defineProperties(image, {naturalWidth:{configurable:true,value:400}, naturalHeight:{configurable:true,value:400}});
  fireEvent.load(image);
  expect(calls).toContainEqual([first.key,true]);
  act(() => director.seek(1, 0));
  view.rerender(draw(second));
  expect(view.getByRole("img", {name:"Marlow"})).toBe(image);
  expect(calls).toContainEqual([second.key,false]);
  expect(calls).toContainEqual([second.key,true]);
  act(() => director.seek(2, 0));
  view.rerender(draw(third));
  expect(calls).toContainEqual([third.key,false]);
  expect(calls).not.toContainEqual([third.key,true]);
  fireEvent.load(view.getByRole("img", {name:"Arden"}));
  expect(calls).toContainEqual([third.key,true]);
  director.dispose();
});
test("live tail retains the scene and shows buffering only while playing", () => {
  const cue = werewolfMomentCues(discussion())[0]!;
  const director = new PresentationDirector({policy: werewolfWatchPolicy, followTail: true});
  director.load([cue]); director.seekTimeline(0, cue.baseDurationMs); director.play();
  const draw = (holding: boolean) => <WerewolfWatchStage cue={cue} scene={null} elapsed={cue.baseDurationMs} reduced director={director} holding={holding} status="in_progress" />;
  const view = render(draw(true));
  expect(view.getByText("Arden, who do you suspect?")).not.toBeNull();
  expect(view.getByRole("status", {name: "Buffering"})).not.toBeNull();
  expect(view.queryByText("Waiting for the next scene…")).toBeNull();
  director.pause(); view.rerender(draw(true));
  expect(view.queryByRole("status", {name: "Buffering"})).toBeNull();
  director.play(); view.rerender(draw(false));
  expect(view.queryByRole("status", {name: "Buffering"})).toBeNull();
  director.dispose();
});
test("opening cast switches to a hidden new image until it loads", () => {
  const cue: WerewolfOpeningCue = {key: "a", baseDurationMs: 2500, opening: {shot: "cast", startMs: 8000, totalMs: 18000, title: "Werewolf", backgroundUrl: "/bg", logoUrl: "/logo", musicUrl: "/music", player: {id: "a", name: "Arden", imageUrl: "/a"}}};
  const draw = (value: WerewolfOpeningCue) => <WerewolfOpeningFrame cue={value} elapsedMs={1000} browserLoading />;
  const view = render(draw(cue));
  const first = view.getByRole("img", {name: "Arden"}) as HTMLImageElement;
  expect(first.style.opacity).toBe("0"); fireEvent.load(first); expect(first.style.opacity).toBe("1");
  view.rerender(draw({...cue, key: "b", opening: {...cue.opening, player: {id: "b", name: "Marlow", imageUrl: "/b"}}}));
  const second = view.getByRole("img", {name: "Marlow"}) as HTMLImageElement;
  expect(second).not.toBe(first); expect(second.style.opacity).toBe("0");
  fireEvent.load(second); expect(second.style.opacity).toBe("1");
});
test("music continues at the live tail and pauses with playback", async () => {
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const contextDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const levels: number[] = [];
  class AudioStub {
    preload = ""; src = ""; currentTime = 0; duration = 100; readyState = 4; ended = false; error = null;
    load() {} play() {return Promise.resolve();} pause() {} removeAttribute() {}
  }
  class ContextStub {
    currentTime = 0; state = "running"; destination = {}; gains = 0;
    createGain() {const master = this.gains++ === 0; return {gain: {value: 0, setTargetAtTime: (value: number) => {if (master) levels.push(value);}}, connect() {}, disconnect() {}};}
    createMediaElementSource() {return {connect() {}, disconnect() {}};}
    resume() {return Promise.resolve();} close() {return Promise.resolve();}
  }
  Object.defineProperty(globalThis, "Audio", {configurable: true, value: AudioStub});
  Object.defineProperty(globalThis, "AudioContext", {configurable: true, value: ContextStub});
  try {
    const input = {section: {key: "day", src: "/day.mp3", title: "Day", repeat: true}, playing: true, muted: false, volume: 0.3, preparing: false, holding: false, live: true, navigationRevision: 0};
    const view = renderHook((props: typeof input) => useWatchMusic(props), {initialProps: input});
    await act(async () => {});
    view.rerender({...input, holding: true});
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 1800));});
    expect(levels.at(-1)).toBe(0.3);
    view.rerender({...input, holding: true, playing: false});
    expect(levels.at(-1)).toBe(0);
    view.unmount();
  } finally {
    if (audioDescriptor) Object.defineProperty(globalThis, "Audio", audioDescriptor); else Reflect.deleteProperty(globalThis, "Audio");
    if (contextDescriptor) Object.defineProperty(globalThis, "AudioContext", contextDescriptor); else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
test("live Werewolf room derives its orbit predecessor after a waiting-screen remount", () => {
  const before=discussion();
  if(before.entry.kind!=="discussion") throw new Error("fixture");
  const after: WerewolfWatchMoment={...before,cursor:21,entry:{...before.entry,contribution:{...before.entry.contribution,actorId:"a",text:"I suspect Larry."}}};
  const previousCue=werewolfMomentCues(before)[0]!,cue=werewolfMomentCues(after)[0]!;
  const draw=(elapsed:number,previous=previousCue)=><WerewolfContentFrame cue={cue} previousCue={previous} scene={null} elapsed={elapsed} reduced={false}/>;
  const outgoing=render(frame(before));outgoing.unmount();
  const view=render(draw(0));
  const position=()=>view.container.querySelector<HTMLElement>('[data-room-player="a"]')!.style.transform;
  const start=position();view.rerender(draw(325));const middle=position();view.rerender(draw(650));const end=position();
  expect(start).not.toBe(middle);expect(middle).not.toBe(end);
  view.rerender(draw(325));expect(position()).toBe(middle);
  view.rerender(draw(0,{...previousCue,moment:{...before,entry:{...before.entry,day:1}}}));expect(position()).toBe(end);
});
test("village conversation uses the living prefix cast and follows speaker changes without remounting", () => {
  const moment = discussion();
  const ready = mock();
  const view = render(frame(moment, null, ready));
  const room = view.getByRole("region", {name: "Day 2 · Village conversation"});
  expect(roomIds(view.container)).toEqual(["a", "b", "d"]);
  expect(view.queryByRole("img", {name: "Vesper"})).toBeNull();
  expect(view.getByText("Arden, who do you suspect?")).not.toBeNull();
  expect(view.container.querySelector('[data-active-speaker="true"]')?.getAttribute("data-room-player")).toBe("b");
  fireEvent.load(view.getByRole("img", {name: "Arden"}));
  expect(ready).not.toHaveBeenCalled();
  fireEvent.load(view.getByRole("img", {name: "Marlow"}));
  expect(ready).toHaveBeenCalledWith(true);
  Object.defineProperties(view.getByRole("img", {name: "Arden"}), {
    complete: {configurable: true, value: true}, naturalWidth: {configurable: true, value: 400},
  });
  ready.mockClear();
  if (moment.entry.kind !== "discussion") throw new Error("Expected discussion fixture");
  view.rerender(frame({...moment, cursor: 21, entry: {...moment.entry, contribution: {
    ...moment.entry.contribution, actorId: "a", stage: "reply", text: "I suspect Larry.",
  }}}, null, ready));
  expect(view.getByRole("region", {name: "Day 2 · Village conversation"})).toBe(room);
  expect(view.container.querySelector('[data-active-speaker="true"]')?.getAttribute("data-room-player")).toBe("a");
  expect(view.getByText("I suspect Larry.")).not.toBeNull();
  expect(ready).toHaveBeenCalledWith(true);
});

test("private pack room contains only living wolves and uses portraits instead of cropped full-body forms", () => {
  const moment = discussion();
  moment.snapshot.audience = "omniscient";
  moment.snapshot.players = moment.snapshot.players.map(player => ({
    ...player, role: player.id === "d" ? "villager" : "werewolf",
    fullBodyReferenceUrl: "/body.png",
  }));
  moment.wolfForms = {a: "/wolf-form.png", b: "/wolf-form-2.png"};
  moment.entry = {kind: "speech", day: 2, audience: "pack", actorId: "a", text: "We should agree on a target.", cue: null};
  const view = render(frame(moment));
  expect(view.getByRole("region", {name: "Night 2 · Pack conversation"})).not.toBeNull();
  expect(roomIds(view.container)).toEqual(["a", "b"]);
  expect(view.getByRole("img", {name: "Arden"}).getAttribute("src")).toBe("/arden.png");
  expect(view.getByText("Arden · werewolf")).not.toBeNull();
});

test("an accepted visual discussion still uses its scene, while an uncovered speaker uses the room", () => {
  const moment = discussion();
  const scene: AcceptedVisualScene = {
    id: "village", roomId: "mingle-1", version: 1, imageUrl: "/village.png", annotatedImageUrl: "",
    participantIds: ["a", "b", "d"],
    anchors: [{playerId: "b", label: 1, head: {x: .5, y: .5, width: .1, height: .1}, confidence: "clear"}],
  };
  const view = render(frame(moment, scene));
  expect(view.container.querySelector("[data-portrait-room]")).toBeNull();
  view.rerender(frame(moment, {...scene, anchors: []}));
  expect(roomIds(view.container)).toEqual(["a", "b", "d"]);
});

test("introductions stay solo and a broken room portrait settles its named fallback", () => {
  const moment = discussion();
  const ready = mock();
  moment.chapterId = "introduction";
  moment.entry = {kind: "speech", day: 0, audience: "public", actorId: "b", text: "I'm Marlow.", cue: null};
  const view = render(frame(moment));
  expect(view.container.querySelector("[data-portrait-room]")).toBeNull();
  expect(view.getByRole("img", {name: "Marlow"})).not.toBeNull();
  view.rerender(frame(discussion(), null, ready));
  const image = view.getByRole("img", {name: "Marlow"});
  fireEvent.error(image);
  expect(image.getAttribute("src")).toBe("/avatars/personas/diplomat.png");
  fireEvent.load(image);
  expect(ready).toHaveBeenCalledWith(true);
  expect(view.getByText("Arden, who do you suspect?")).not.toBeNull();
});

test("a dead contestant's retrospective stays solo after the result, including with a published scene", () => {
  const moment = discussion();
  moment.chapterId = "retrospective";
  moment.snapshot.phase = "retrospective";
  moment.snapshot.outcome = {faction: "village", winnerIds: ["a", "b", "d"], reason: "wolves_eliminated"};
  moment.snapshot.players = moment.snapshot.players.map(player => ({...player,
    role: player.id === "c" ? "werewolf" : "villager",
    elimination: player.id === "c" ? {day: 2, kind: "vote"} : null,
  }));
  moment.entry = {kind: "speech", day: 2, audience: "public", actorId: "c",
    purpose: "retrospective", ordinal: 0, text: "You caught me. I should have defended my vote.", cue: null};
  const scene: AcceptedVisualScene = {
    id: "village", roomId: "mingle-1", version: 1, imageUrl: "/village.png", annotatedImageUrl: "",
    participantIds: ["a", "b", "c", "d"],
    anchors: [{playerId: "c", label: 1, head: {x: .5, y: .5, width: .1, height: .1}, confidence: "clear"}],
  };
  const view = render(<WerewolfContentFrame cue={werewolfMomentCues(moment)[0]!} scene={scene}
    elapsed={SOLO_READ_START_MS} reduced />);
  expect(view.container.querySelector("[data-portrait-room]")).toBeNull();
  expect(view.getByRole("img", {name: "Vesper"})).not.toBeNull();
  expect(view.getByText("You caught me. I should have defended my vote.")).not.toBeNull();
  expect(view.getByText("werewolf")).not.toBeNull();
  expect(view.getByText("Retrospective · Defeated faction · Voted out · Day 2")).not.toBeNull();
});


test("public ballot speeches use the vote bloc view, including spoken abstentions, without a facts overlay", () => {
  const moment = discussion();
  moment.snapshot = {...moment.snapshot, rulesVersion: 9};
  moment.entry = {kind: "ballot", day: 2, actorId: "b", targetId: null, text: "I need a stronger case before voting.", cue: null, unavailable: false, totals: {b: 1}, requiredVotes: 2, remainingVoterIds: ["d"]};
  moment.dayBallots = [{voterId: "a", targetId: "b", unavailable: false}, {voterId: "b", targetId: null, unavailable: false}];
  const cue = werewolfMomentCues(moment)[0]!;
  const view = render(<WerewolfContentFrame cue={cue} scene={null} elapsed={SOLO_READ_START_MS} reduced />);
  expect(view.container.querySelector("[data-vote-presentation]")).not.toBeNull();
  expect(view.getByText("I need a stronger case before voting.")).not.toBeNull();
  expect(view.getByRole("region", {name: "Vote record"})).not.toBeNull();
  expect(view.getByText("Abstain")).not.toBeNull();
  expect(view.container.querySelector('[data-ledger-voter="a"]')).not.toBeNull();
  expect(view.container.querySelector('[data-ledger-voter="b"]')).not.toBeNull();
  expect(view.container.querySelector('[data-ledger-voter="d"]')).toBeNull();
  expect(view.container.querySelector("[data-werewolf-canonical-details]")).toBeNull();
  view.rerender(<WerewolfContentFrame cue={{...cue, moment: {...moment, entry: {...moment.entry, text: null}}}} scene={null} elapsed={SOLO_READ_START_MS} reduced />);
  expect(view.queryByText("I need a stronger case before voting.")).toBeNull();
  expect(view.container.querySelector("[data-vote-presentation]")).not.toBeNull();
});

test("pack proposal speech has no target banner", () => {
  const moment = discussion();
  moment.snapshot = {...moment.snapshot, rulesVersion: 9, audience: "omniscient", players: moment.snapshot.players.map(player => ({...player, role: "werewolf"}))};
  moment.entry = {kind: "proposal", day: 2, beat: 1, actorId: "b", targetId: "a", text: "Let's choose Arden.", cue: null, unavailable: false};
  const view = render(frame(moment));
  expect(view.getByText("Let's choose Arden.")).not.toBeNull();
  expect(view.queryByText("Proposed target: Arden")).toBeNull();
  expect(view.container.querySelector("[data-werewolf-canonical-details]")).toBeNull();
});

test("solo role clips use frozen full-body art and their room before revealing the result", () => {
  const base = discussion();
  const before = {...base.snapshot, rulesVersion: 10 as const, audience: "omniscient" as const, phase: "night" as const,
    players: base.snapshot.players.map(p => ({...p, role: p.id === "a" ? "doctor" as const : "seer" as const, fullBodyReferenceUrl: `/${p.id}-full.png`}))};
  const moment: WerewolfWatchMoment = {...base, snapshot: before,
    entry: {kind: "night", day: 2, killedId: null, protectedId: "a", attackTargetId: null, investigation: {seerId:"b", targetId:"d", isWolf:true}},
    night: {before, actions: [
      {kind:"protect", actorId:"a", targetId:"a", speech:{text:"I need to survive to protect the village tomorrow.", cue:null}},
      {kind:"investigate", actorId:"b", targetId:"d", isWolf:true, speech:{text:"Larry's claim needs checking tonight.", cue:null}},
    ]}};
  const cues = werewolfMomentCues(moment);
  expect(cues).toHaveLength(5);
  for (const [index, actor, room] of [[0,"a","doctor-room"], [2,"b","seer-room"]] as const) {
    const {container, rerender, unmount} = render(<WerewolfContentFrame cue={cues[index]!} scene={null} elapsed={SOLO_READ_START_MS} reduced />);
    expect(container.querySelector('[data-solo-image]')?.getAttribute('data-solo-image')).toBe("full-body");
    expect(container.querySelector('[data-solo-portrait]')?.getAttribute('src')).toBe(`/${actor}-full.png`);
    expect(container.querySelector('[data-room-backdrop]')?.getAttribute('data-room-backdrop')).toContain(room);
    expect(container.querySelector('[data-thinking-camera] [data-room-backdrop]')).not.toBeNull();
    expect(container.querySelector('[data-investigation-result]')).toBeNull();
    rerender(<WerewolfContentFrame cue={cues[index+1]!} scene={null} elapsed={0} reduced />);
    expect(container.querySelector('[data-night-role]')).not.toBeNull();
    expect(container.querySelector('[data-speech-bubble]')).toBeNull();
    if (actor === "b") expect(container.querySelector('[data-investigation-result]')?.textContent).toBe("Werewolf");
    unmount();
  }
});


test.each([1440, 800])("full-body solo shots stay anchored through the dissolve at %i px", width => {
  Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", {configurable: true, get: () => width});
  Object.defineProperty(dom.HTMLElement.prototype, "clientHeight", {configurable: true, get: () => width === 1440 ? 900 : 1100});
  const source = discussion();
  source.chapterId = "introduction";
  source.snapshot.players = source.snapshot.players.map(player => ({...player,fullBodyReferenceUrl:`/${player.id}-full.png`}));
  const make = (id: string, cursor: number) => werewolfMomentCues({...source,cursor,
    entry:{kind:"speech",day:0,actorId:id,audience:"public",text:`Hello from ${id}.`,cue:null}})[0]!;
  const a = make("a",1), b = make("b",2);
  const shot = (cue: typeof a, elapsed: number, previousCue?: typeof a, nextCue?: typeof a, reduced = false, paused = false) =>
    <WerewolfContentFrame cue={cue} previousCue={previousCue} nextCue={nextCue} scene={null} elapsed={elapsed} reduced={reduced} paused={paused} />;
  const view = render(shot(a,0,undefined,b));
  const first = view.container.querySelector<HTMLImageElement>('[data-solo-portrait]')!;
  expect(first.style.opacity).toBe("0");
  Object.defineProperties(first, {naturalWidth:{value:800}, naturalHeight:{value:1200}});
  fireEvent.load(first);
  const geometry = () => [first.style.left, first.style.top, first.style.width, first.style.height];
  const anchoredGeometry = geometry();
  view.rerender(shot(a,SOLO_IMAGE_FADE_MS / 2,undefined,b));
  expect(first.style.opacity).toBe("0.5");
  view.rerender(shot(a,a.baseDurationMs - 1,undefined,b));
  expect(first.style.opacity).toBe("1");
  view.rerender(shot(b,0,a));
  expect(view.container.querySelector('[data-solo-layer="outgoing"] [data-solo-portrait]')).toBe(first);
  expect(geometry()).toEqual(anchoredGeometry);
  expect(view.container.querySelector<HTMLElement>('[data-solo-layer="outgoing"]')?.style.opacity).toBe("1");
  expect(view.container.querySelector<HTMLElement>('[data-solo-layer="current"]')?.style.opacity).toBe("0");
  view.rerender(shot(b,SOLO_IMAGE_FADE_MS / 2,a,undefined,false,true));
  expect(view.container.querySelector<HTMLElement>('[data-solo-layer="current"]')?.style.opacity).toBe("0.5");
  expect(view.container.querySelector('[data-solo-layer="outgoing"] [data-speech-bubble]')).toBeNull();
  view.rerender(shot(b,SOLO_IMAGE_FADE_MS,a));
  expect(view.container.querySelector('[data-solo-layer="outgoing"]')).toBeNull();
  view.rerender(shot(b,b.baseDurationMs - SOLO_IMAGE_FADE_MS / 2,a));
  expect(view.container.querySelector<HTMLImageElement>('[data-solo-portrait]')?.style.opacity).toBe("0.5");
  view.rerender(shot(b,0,a,undefined,true));
  expect(view.container.querySelector('[data-solo-layer="outgoing"]')).toBeNull();
  expect(view.container.querySelector<HTMLImageElement>('[data-solo-portrait]')?.style.opacity).toBe("1");
});
