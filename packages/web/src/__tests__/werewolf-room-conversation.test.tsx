import {afterEach, beforeEach, expect, mock, test} from "bun:test";
import {Window} from "happy-dom";
import {act, cleanup, fireEvent, render as renderRoot} from "@testing-library/react";
import type {WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {WerewolfContentFrame} from "../components/games/werewolf/werewolf-watch-stage";
import {werewolfMomentCues} from "../components/games/werewolf/werewolf-watch-model";
import {SCENE_READ_START_MS} from "../app/games/[slug]/components/scene-speech-timing";
import {SOLO_READ_START_MS} from "../app/games/[slug]/components/solo-presentation-timing";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "ResizeObserver", "getComputedStyle"] as const;
const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({url: "http://localhost"});
  Object.defineProperty(dom.document, "fonts", {value: {ready: Promise.resolve()}});
  for (const key of globals) Object.defineProperty(globalThis, key, {configurable: true, value: key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : dom[key]});
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
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
