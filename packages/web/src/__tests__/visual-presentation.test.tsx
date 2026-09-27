import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render as renderReact, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { soloPresentationDurationMs, SOLO_READ_START_MS, SOLO_EXIT_MS, SOLO_SPEECH_FADE_MS } from "../app/games/[slug]/components/solo-presentation-timing";
import { sceneSpeechDurationMs, sceneSpeechOpacity, SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS } from "../app/games/[slug]/components/scene-speech-timing";
import { VisualPresentationFrame, type VisualPresentationBeat } from "../app/games/[slug]/components/visual-presentation";
import { StageBackdrop, sceneBackdropSources } from "../app/games/[slug]/components/stage-backdrop";
import { portraitRoomSeats } from "../app/games/[slug]/components/portrait-room";
import { panelTransition } from "../app/games/[slug]/components/scene-image";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "ResizeObserver"] as const;
const original = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost:3000" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
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
function render(element: Parameters<typeof renderReact>[0]) {
  const view = renderReact(element);
  loadScene(view.container);
  const rerender = view.rerender;
  view.rerender = element => { rerender(element); loadScene(view.container); };
  return view;
}
const rooms: AcceptedVisualScene[] = [1, 2].map((number) => ({
  id: `scene-${number}`, roomId: number === 1 ? "mingle-1" : "mingle-2", version: 1,
  imageUrl: `/scene-${number}.png`, annotatedImageUrl: `/scene-${number}-labels.png`, participantIds: ["p1"],
  anchors: [{ playerId: "p1", label: 1, head: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, confidence: "clear" }],
}));
const speech = { id: "speech-1", playerId: "p1", speaker: "Arden", text: "I want to hear your plan." };
const beat: VisualPresentationBeat = { kind: "scene", sceneId: "scene-1", roomId: "mingle-1", speech };

test("group shots borrow only accepted adjacent panels and crop the active image at either end", () => {
  const group = (imageUrl: string) => ({ imageUrl, annotatedImageUrl: "", participantIds: ["p1"], visibleParticipantIds: ["p1"], anchors: [], pointers: [] });
  const shots = { mode: "groups" as const, overview: null, groups: [group("/left.png"), group("/center.png"), group("/right.png")] };
  expect(sceneBackdropSources("/center.png", shots)).toEqual({ left: "/left.png", right: "/right.png" });
  expect(sceneBackdropSources("/left.png", shots)).toEqual({ left: "/left.png", right: "/center.png" });
  expect(sceneBackdropSources("/right.png", shots)).toEqual({ left: "/center.png", right: "/right.png" });
  expect(sceneBackdropSources("/other.png", shots)).toEqual({ left: "/other.png", right: "/other.png" });
  expect(sceneBackdropSources("/only.png")).toEqual({ left: "/only.png", right: "/only.png" });
});

test("a broken decorative neighbor falls back to the active image without adding accessible characters", () => {
  const view = render(<StageBackdrop source="/current.png" left="/neighbor.png" />);
  expect(view.queryAllByRole("img")).toHaveLength(0);
  const left = view.container.querySelector('[data-backdrop-side="left"] img')!;
  fireEvent.error(left);
  expect(left.getAttribute("src")).toBe("/current.png");
  expect(view.queryAllByRole("img")).toHaveLength(0);
});

test("panel direction follows saved group order while unrelated images dissolve", () => {
  const group = (imageUrl: string) => ({ imageUrl, annotatedImageUrl: "", participantIds: [], visibleParticipantIds: [], anchors: [], pointers: [] });
  const shots = { mode: "groups" as const, overview: null, groups: [group("/a"), group("/b"), group("/c")] };
  expect(panelTransition("/a", "/b", shots)).toBe(1);
  expect(panelTransition("/c", "/b", shots)).toBe(-1);
  expect(panelTransition("/room", "/b", shots)).toBe(0);
});

test("semicircle rotates the active speaker forward and keeps the frozen cast", () => {
  const cast = ["p1", "p2", "p3"].map((id, index) => ({ id, name: `Person ${index}`, persona: "social", status: "alive" as const, shielded: false }));
  const room: VisualPresentationBeat = { kind: "portrait-room", roomNumber: 2, participants: cast, speech };
  const view = render(<VisualPresentationFrame beat={room} rooms={[]} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  expect(view.getAllByRole("img")).toHaveLength(3);
  expect(view.container.querySelector('[data-active-speaker="true"]')?.getAttribute("data-room-player")).toBe("p1");
  expect(view.getByText(speech.text)).not.toBeNull();
  const forward = portraitRoomSeats(390, 3, 2);
  expect(forward[2]).toMatchObject({ x: 0, z: 60, scale: 1 });
  expect(forward[0]!.x).toBeGreaterThan(0);
  expect(forward[1]!.x).toBeLessThan(0);
  for (const seat of forward) expect(Math.abs(seat.x) + seat.diameter / 2).toBeLessThan(195);
  view.rerender(<VisualPresentationFrame beat={{ ...room, speech: { ...speech, id: "next", playerId: "p3", speaker: "Person 2" } }} rooms={[]} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  expect(view.container.querySelector('[data-active-speaker="true"]')?.getAttribute("data-room-player")).toBe("p3");
  expect(view.getAllByRole("img")).toHaveLength(3);
});

test("a missing scene stays readable with a portrait bubble instead of blocking speech", () => {
  const view = renderReact(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  fireEvent.error(view.container.querySelector("[data-scene-preload]")!);
  expect(view.getByText(speech.text)).not.toBeNull();
  expect(view.container.querySelector("[data-headshot-fallback]")).not.toBeNull();
});

test("a replay without a winner tableau holds a readable last frame only at the tail", () => {
  const portrait: VisualPresentationBeat = { kind: "portrait", purpose: "Farewell", player: { id: "p1", name: "Arden", persona: "diplomat" }, speech };
  const view = render(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={60_000} holdAtTail reducedMotion />);
  expect(view.getByText(speech.text)).not.toBeNull();
  expect(view.getByRole("img").style.opacity).toBe("1");
  view.rerender(<VisualPresentationFrame beat={{ kind: "house", text: "The House closes." }} rooms={[]} elapsedMs={60_000} holdAtTail reducedMotion />);
  expect(view.getByText("The House closes.")).not.toBeNull();
  expect(view.getByRole("region", { name: "House summary" }).style.opacity).toBe("1");
});

test("winner tableau survives elapsed playback and failed full-body art without losing headshots or ranks", () => {
  const body = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGz4AAAAASUVORK5CYII=";
  const winner: VisualPresentationBeat = { kind: "winner", winner: { id: "w", name: "Winner", persona: "social", status: "alive", shielded: false, fullBodyReferenceUrl: body, avatarUrl: "/winner-head.png" },
    standings: [{ id: "r", name: "Runner-up", persona: "social", status: "alive", shielded: false, avatarUrl: "/runner-head.png", placement: 2, juryMember: false }] };
  const view = render(<VisualPresentationFrame beat={winner} rooms={[]} elapsedMs={0} />);
  expect(view.getByRole("img", { name: "Winner" }).getAttribute("src")).toBe(body);
  view.rerender(<VisualPresentationFrame beat={winner} rooms={[]} elapsedMs={60_000} paused fullscreen reducedMotion />);
  expect(view.getByRole("region", { name: "Final standings" }).style.opacity).not.toBe("0");
  fireEvent.error(view.getByRole("img", { name: "Winner" }));
  expect(view.getByRole("img", { name: "Winner" }).getAttribute("src")).toBe("/winner-head.png");
  expect(view.getByRole("img", { name: "Runner-up" }).getAttribute("src")).toBe("/runner-head.png");
  expect(view.getByText("Place 2")).not.toBeNull();
});

test.each([false, true])("room bubbles leave a clear camera interval and hold the scene after hiding (reduced motion: %s)", reducedMotion => {
  const hiddenAt = sceneSpeechDurationMs(speech.text) - SCENE_EXIT_HOLD_MS;
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={SCENE_SPEECH_START_MS} reducedMotion={reducedMotion} paused />);
  expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
  expect(view.getByRole("img")).not.toBeNull();
  expect(sceneSpeechOpacity(speech.text, SCENE_SPEECH_START_MS + VISUAL_SPEECH_FADE_MS / 2, reducedMotion)).toBe(reducedMotion ? 1 : .5);
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={SCENE_READ_START_MS} reducedMotion={reducedMotion} paused />);
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={hiddenAt} reducedMotion={reducedMotion} paused />);
  expect(view.container.querySelector("[data-speech-bubble]")).toBeNull();
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
});

test("missing room images and later published scenes retain the cue's speech timing", () => {
  const portrait: VisualPresentationBeat = { kind: "portrait", purpose: "Conversation", player: { id: "p1", name: "Arden", persona: "diplomat" }, speech };
  const view = render(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={SCENE_READ_START_MS} speechPresentation="scene" paused />);
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={sceneSpeechDurationMs(speech.text) - SCENE_EXIT_HOLD_MS} speechPresentation="scene" paused />);
  expect(view.queryByText(speech.text)).toBeNull();
  expect(view.getByRole("img").style.opacity).toBe("1");
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={SOLO_READ_START_MS} speechPresentation="solo" paused />);
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={soloPresentationDurationMs(speech.text) - SOLO_EXIT_MS + SOLO_SPEECH_FADE_MS} speechPresentation="solo" paused />);
  expect(view.queryByText(speech.text)).toBeNull();
});

test("pinning changes the room but does not restart expired speech", () => {
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} reducedMotion />);
  expect(view.getAllByText(speech.text).length).toBeGreaterThan(0);
  const firstRoom = view.getByRole("region", { name: "Current room" });
  fireEvent.click(view.getByRole("button", { name: "Kitchen corner" }));
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  loadScene(view.container);
  const secondRoom = view.getByRole("region", { name: "Current room" });
  expect(secondRoom === firstRoom).toBe(true);
  expect(within(secondRoom).queryByText(speech.text) === null).toBe(true);
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-2.png");
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={sceneSpeechDurationMs(speech.text)} reducedMotion />);
  fireEvent.click(view.getByRole("button", { name: "Follow speaker" }));
  loadScene(view.container);
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  expect(within(view.getByRole("region", { name: "Current room" })).queryByText(speech.text) === null).toBe(true);
});

test("new-scene dialogue never appears on a retained image during preparation", () => {
  const view = render(<VisualPresentationFrame beat={{ ...beat, sceneId: "scene-3" }} rooms={[]} retainedScene={rooms[0]} elapsedMs={1000} status="preparing" />);
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  expect(view.queryByText(speech.text)).toBeNull();
  expect(view.getByRole("status").textContent).toContain("Preparing");
});

test("anonymous speech stays unidentified and unanchored", () => {
  const view = render(<VisualPresentationFrame beat={{ ...beat, speech: { ...speech, playerId: null } }} rooms={rooms} elapsedMs={1000} />);
  expect(view.queryByText("Arden")).toBeNull();
  expect(view.getAllByText("Anonymous").length).toBeGreaterThan(0);
});

test("portrait ballot wording is unchanged and expires even with reduced motion", () => {
  const portrait: VisualPresentationBeat = { kind: "portrait", purpose: "Ballot", player: { id: "p1", name: "Arden", persona: "diplomat" }, speech: { ...speech, text: "Eliminate: Mara" } };
  const view = render(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={SOLO_READ_START_MS} reducedMotion paused />);
  expect(view.getByText("Eliminate: Mara")).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={soloPresentationDurationMs(portrait.speech.text)} reducedMotion />);
  expect(view.queryByText("Eliminate: Mara")).toBeNull();
  expect(view.getByRole("img", { name: "Arden" })).not.toBeNull();
});

test("paused seeking leaves the image clear until a click reveals speech", () => {
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={0} paused />);
  expect(view.queryByText(speech.text)).toBeNull();
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  const portrait: VisualPresentationBeat = { kind: "portrait", purpose: "Conversation", player: { id: "p1", name: "Arden", persona: "diplomat" }, speech };
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={0} paused />);
  expect(view.queryByText(speech.text)).toBeNull();
  expect(view.getByRole("img").style.opacity).toBe("1");
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={SOLO_READ_START_MS} paused />);
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={soloPresentationDurationMs(speech.text) - SOLO_EXIT_MS + SOLO_SPEECH_FADE_MS} paused />);
  expect(view.queryByText(speech.text)).toBeNull();
  expect(view.getByRole("img").style.opacity).toBe("1");
});

test("solo image and bubble render their separate director-driven fades", () => {
  const portrait: VisualPresentationBeat = { kind: "portrait", purpose: "Ballot", player: { id: "p1", name: "Arden", persona: "diplomat" }, speech };
  const view = render(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={175} paused />);
  expect((view.getByRole("img") as HTMLImageElement).style.opacity).toBe("0.5");
  expect(view.queryByText(speech.text)).toBeNull();
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={1125} paused />);
  expect((view.getByRole("img") as HTMLImageElement).style.opacity).toBe("1");
  expect(view.container.querySelector("blockquote")?.parentElement?.style.opacity).toBe("0.5");
  view.rerender(<VisualPresentationFrame beat={portrait} rooms={[]} elapsedMs={soloPresentationDurationMs(speech.text) - 175} paused />);
  expect((view.getByRole("img") as HTMLImageElement).style.opacity).toBe("0.5");
  expect(view.queryByText(speech.text)).toBeNull();
});

test("House uses its logo and preserves full narration on paused seeks and reduced motion", () => {
  const text = "The room waits.\n\n" + "Everyone has something to lose. ".repeat(40);
  const view = render(<VisualPresentationFrame beat={{ kind: "house", text }} rooms={[]} elapsedMs={0} paused />);
  const segment = view.getByRole("region", { name: "House summary" });
  expect(segment.style.opacity).toBe("1");
  expect(segment.querySelector("[data-house-copy]")?.textContent).toBe(text);
  expect(view.getByRole("img", { name: "The House" }).getAttribute("src")).toBe("/logo.png");
  view.rerender(<VisualPresentationFrame beat={{ kind: "house", text: null, title: "Mingle" }} rooms={[]} elapsedMs={0} reducedMotion />);
  expect(view.getByRole("heading", { name: "Mingle" })).not.toBeNull();
  expect(view.getByRole("region", { name: "House transition: Mingle" }).style.transform).toBe("none");
});

test("fullscreen forces follow speaker and restores the pinned room on exit", () => {
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} reducedMotion />);
  fireEvent.click(view.getByRole("button", { name: "Kitchen corner" }));
  view.rerender(<VisualPresentationFrame fullscreen beat={beat} rooms={rooms} elapsedMs={1000} reducedMotion />);
  expect(view.queryByRole("navigation", { name: "Mingle rooms" })).toBeNull();
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} reducedMotion />);
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-2.png");
  expect(within(view.getByRole("region", { name: "Current room" })).queryByText(speech.text) === null).toBe(true);
});


test.each(["Introduction", "Ballot", "Farewell", "Diary", "Conversation"] as const)("%s prefers uncropped full-body art with a speech bubble", (purpose) => {
    const solo: VisualPresentationBeat = { kind: "portrait", purpose, player: { id: "p1", name: "Arden", persona: "diplomat", avatarUrl: "/head.png", fullBodyReferenceUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGz4AAAAASUVORK5CYII=" }, speech };
    const view = render(<VisualPresentationFrame beat={solo} rooms={[]} elapsedMs={SOLO_READ_START_MS} paused fullscreen />);
    expect(view.getByRole("img").getAttribute("src")).toBe(solo.player.fullBodyReferenceUrl!);
    expect(view.getByRole("img").className).toContain("object-contain");
    expect(view.container.querySelector("blockquote")?.textContent).toBe(speech.text);
    expect(view.container.querySelector("video")).toBeNull();
    fireEvent.error(view.getByRole("img"));
    expect(view.getByRole("img").getAttribute("src")).toBe("/head.png");
});

test("group shots follow the speaker and a missing character keeps portrait speech over the image", () => {
  const group = { imageUrl: "/group.png", annotatedImageUrl: "", participantIds: ["p1", "p2"], visibleParticipantIds: ["p2"],
    anchors: [{ ...rooms[0]!.anchors[0]!, playerId: "p2" }], pointers: [] };
  const scene: AcceptedVisualScene = { ...rooms[0]!, shots: { mode: "groups", overview: null, groups: [group] } };
  const view = render(<VisualPresentationFrame beat={beat} rooms={[scene]} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe("/group.png");
  expect(view.container.querySelector("[data-headshot-fallback]")).not.toBeNull();
  const pointerScene = { ...scene, shots: { ...scene.shots!, groups: [{ ...group, pointers: [{ playerId: "p1", x: .2, y: .5 }] }] } };
  view.rerender(<VisualPresentationFrame beat={beat} rooms={[pointerScene]} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  expect(view.container.querySelector("[data-headshot-fallback]")).toBeNull();
  const overview = { ...group, imageUrl: "/overview.png" };
  const establishing = { ...scene, shots: { mode: "establishing" as const, overview, groups: [group] } };
  view.rerender(<VisualPresentationFrame beat={beat} rooms={[establishing]} elapsedMs={0} reducedMotion />);
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe("/overview.png");
  view.rerender(<VisualPresentationFrame beat={beat} rooms={[establishing]} elapsedMs={SCENE_READ_START_MS} reducedMotion />);
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe("/group.png");
  const nextBeat: VisualPresentationBeat = { kind: "scene", sceneId: scene.id, roomId: scene.roomId, speech: { ...speech, id: "next-speaker" } };
  view.rerender(<VisualPresentationFrame beat={nextBeat} rooms={[establishing]} elapsedMs={0} reducedMotion />);
  expect(view.getByAltText("Current conversation scene").getAttribute("src")).toBe("/group.png");
});
