import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Window } from "happy-dom";
import { EpisodeArtwork } from "../app/games/episode-preview";
import type { EpisodeFrame } from "../lib/api";

const keys = ["window", "document", "navigator", "IntersectionObserver", "matchMedia"] as const;
const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let notifyVisibility: (visible: boolean) => void;

function setup(touch: boolean) {
  dom = new Window({ url: "http://localhost/games" });
  for (const key of ["window", "document", "navigator"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  Object.defineProperty(dom, "matchMedia", { configurable: true, value: (query: string) => ({ matches: query.includes("pointer: coarse") && touch, addEventListener() {}, removeEventListener() {} }) });
  class Observer {
    constructor(callback: IntersectionObserverCallback) { notifyVisibility = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    observe() {} disconnect() {} unobserve() {}
  }
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: Observer });
}

afterEach(() => {
  cleanup();
  dom?.close();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const frames: EpisodeFrame[] = [{ id: "one", kind: "scene", label: "One" }, { id: "two", kind: "scene", label: "Two" }];

test("mouse previews remain still until the artwork is hovered", async () => {
  setup(false);
  const view = render(<EpisodeArtwork frames={frames} title="Game" />);
  const artwork = view.getByLabelText("Game preview");
  act(() => notifyVisibility(true));
  expect(artwork.classList.contains("is-playing")).toBe(false);
  fireEvent.pointerEnter(artwork, { pointerType: "mouse" });
  expect(artwork.classList.contains("is-playing")).toBe(true);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 4300)); });
  expect(artwork.querySelector('[data-frame-id="two"]')).toBeTruthy();
  fireEvent.pointerLeave(artwork, { pointerType: "mouse" });
  expect(artwork.classList.contains("is-playing")).toBe(false);
});

test("touch previews pause during scrolling and outside the viewport", async () => {
  setup(true);
  const view = render(<EpisodeArtwork frames={frames} title="Game" />);
  const artwork = view.getByLabelText("Game preview");
  expect(artwork.classList.contains("is-playing")).toBe(false);
  act(() => notifyVisibility(true));
  expect(artwork.classList.contains("is-playing")).toBe(true);
  fireEvent.scroll(window);
  expect(artwork.classList.contains("is-playing")).toBe(false);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  expect(artwork.classList.contains("is-playing")).toBe(true);
  act(() => notifyVisibility(false));
  expect(artwork.classList.contains("is-playing")).toBe(false);
});
