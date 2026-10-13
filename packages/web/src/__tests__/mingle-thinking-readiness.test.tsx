import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render as renderReact } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { sceneSpeechDurationMs, SCENE_SPEECH_START_MS } from "../app/games/[slug]/components/scene-speech-timing";
import { VisualPresentation } from "../app/games/[slug]/components/visual-presentation";
import { createPresentationDirector } from "../app/games/[slug]/components/influence-presentation-director";
import { SceneThinkingProvider } from "../components/watch/watch-thinking";
import { VisualSceneView } from "../app/games/[slug]/components/visual-scene-view";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"] as const;
const original = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost:3000" });
  Object.defineProperty(dom.document, "fonts", { value: { ready: Promise.resolve() } });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : key === "requestAnimationFrame" ? () => 0 : key === "cancelAnimationFrame" ? () => {} : dom[key] });
});
afterEach(() => {
  cleanup();
  dom.close();
  for (const key of globals) {
    const descriptor = original.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function loadScene(container: HTMLElement) {
  for (const image of container.querySelectorAll<HTMLImageElement>("[data-scene-preload]")) {
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 800 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1200 });
    fireEvent.load(image);
  }
}
const rooms: AcceptedVisualScene[] = [1, 2].map((number) => ({
  id: `scene-${number}`, roomId: number === 1 ? "mingle-1" : "mingle-2", version: 1,
  imageUrl: `/scene-${number}.png`, annotatedImageUrl: `/scene-${number}-labels.png`, participantIds: ["p1"],
  anchors: [{ playerId: "p1", label: 1, head: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, confidence: "clear" }],
}));
const speech = { id: "speech-1", playerId: "p1", speaker: "Arden", text: "I want to hear your plan." };

test("a cold room transition never zooms the retained image using the incoming head", async () => {
  Object.defineProperties(dom.HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 1000 },
    clientHeight: { configurable: true, get: () => 700 },
  });
  const thought = { speaker: "Arden", text: "Consider the next room.", focus: 1, opacity: 1, elapsedMs: 100, durationMs: 2800 };
  const content = (room: AcceptedVisualScene, elapsedMs: number) => <SceneThinkingProvider thought={thought}>
    <VisualSceneView scene={room} speech={{ ...speech, id: room.id }} elapsedMs={elapsedMs} />
  </SceneThinkingProvider>;
  const view = renderReact(content(rooms[0]!, 0));
  loadScene(view.container);
  view.rerender(content(rooms[0]!, 1000));
  expect(view.container.querySelector("[data-in-scene-thinking]")).not.toBeNull();
  const nextRoom = { ...rooms[1]!, anchors: [{ ...rooms[1]!.anchors[0]!, head: { x: .1, y: .2, width: .1, height: .1 } }] };
  view.rerender(content(nextRoom, 0));
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe(rooms[0]!.imageUrl);
  expect(view.container.querySelector<HTMLElement>("[data-thinking-camera]")!.style.transform).toBe("translate(0px, 0px) scale(1)");
  expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
  loadScene(view.container);
  expect(view.container.querySelector("[data-in-scene-thinking]")).toBeNull();
  view.rerender(content(nextRoom, SCENE_SPEECH_START_MS));
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe(nextRoom.imageUrl);
  expect(view.container.querySelector("[data-in-scene-thinking]")).not.toBeNull();
  await act(async () => {});
});

test.each(["load", "error"] as const)("room image %s releases the shared clock without consuming thinking while loading", (outcome) => {
  let now = 0;
  const director = createPresentationDirector({ clock: { now: () => now, setTimeout: () => 1, clearTimeout: () => {} } });
  director.load([0, 1].map(index => ({ source: "classic", kind: "classic_transcript", stage: "done", key: `room-${index}`,
    canonicalSequence: index, round: 1, phase: "MINGLE", baseDurationMs: sceneSpeechDurationMs(speech.text),
    sceneIndex: index, messageIndex: 0, speechPresentation: "scene" })));
  const content = (index: number) => <VisualPresentation director={director} beat={{ kind: "scene", sceneId: rooms[index]!.id,
    roomId: rooms[index]!.roomId, speech: { ...speech, id: `speech-${index}` } }} rooms={rooms} />;
  const view = renderReact(content(0));
  loadScene(view.container);
  act(() => { director.seek(1, 0); director.setThinking("room-1", "Consider the next room."); director.play(); });
  view.rerender(content(1));
  now += 5000;
  expect(director.getSnapshot().isPlaying).toBe(true);
  expect(director.getElapsedBaseMs()).toBe(0);
  expect(director.getThinkingFrame()).toBeNull();
  if (outcome === "load") loadScene(view.container);
  else fireEvent.error(view.container.querySelector("[data-scene-preload]")!);
  now += SCENE_SPEECH_START_MS + 1500;
  expect(director.getThinkingFrame()?.opacity).toBe(1);
  const thought = director.getThinkingFrame();
  act(() => { director.pause(); });
  now += 5000;
  expect(director.getThinkingFrame()).toEqual(thought);
  view.unmount();
  director.dispose();
});

