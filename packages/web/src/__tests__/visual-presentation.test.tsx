import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { soloPresentationDurationMs, SOLO_READ_START_MS, SOLO_EXIT_MS, SOLO_SPEECH_FADE_MS } from "../app/games/[slug]/components/solo-presentation-timing";
import { sceneSpeechDurationMs, sceneSpeechOpacity, SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS } from "../app/games/[slug]/components/scene-speech-timing";
import { VisualPresentationFrame, type VisualPresentationBeat } from "../app/games/[slug]/components/visual-presentation";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "ResizeObserver"] as const;
const original = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow();
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
const rooms: AcceptedVisualScene[] = [1, 2].map((number) => ({
  id: `scene-${number}`, roomId: number === 1 ? "mingle-1" : "mingle-2", version: 1,
  imageUrl: `/scene-${number}.png`, annotatedImageUrl: `/scene-${number}-labels.png`, participantIds: ["p1"],
  anchors: [{ playerId: "p1", label: 1, head: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, confidence: "clear" }],
}));
const speech = { id: "speech-1", playerId: "p1", speaker: "Arden", text: "I want to hear your plan." };
const beat: VisualPresentationBeat = { kind: "scene", sceneId: "scene-1", roomId: "mingle-1", speech };

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
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} />);
  expect(view.getAllByText(speech.text).length).toBeGreaterThan(0);
  const firstRoom = view.getByRole("region", { name: "Current room" });
  fireEvent.click(view.getByRole("button", { name: "Kitchen corner" }));
  const secondRoom = view.getByRole("region", { name: "Current room" });
  expect(secondRoom === firstRoom).toBe(false);
  expect(firstRoom.parentElement?.getAttribute("aria-hidden")).toBe("true");
  expect(within(secondRoom).queryByText(speech.text) === null).toBe(true);
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-2.png");
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={sceneSpeechDurationMs(speech.text)} />);
  fireEvent.click(view.getByRole("button", { name: "Follow speaker" }));
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
  const view = render(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} />);
  fireEvent.click(view.getByRole("button", { name: "Kitchen corner" }));
  view.rerender(<VisualPresentationFrame fullscreen beat={beat} rooms={rooms} elapsedMs={1000} />);
  expect(view.queryByRole("navigation", { name: "Mingle rooms" })).toBeNull();
  expect(view.getByRole("img").getAttribute("src")).toBe("/scene-1.png");
  expect(view.getByText(speech.text)).not.toBeNull();
  view.rerender(<VisualPresentationFrame beat={beat} rooms={rooms} elapsedMs={1000} />);
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
