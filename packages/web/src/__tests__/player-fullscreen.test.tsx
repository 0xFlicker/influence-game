import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { Window as HappyDOMWindow } from "happy-dom";
import { usePlayerFullscreen } from "../app/games/[slug]/components/use-player-fullscreen";
const keys = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event"] as const;
const original = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => { dom = new HappyDOMWindow(); for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] }); });
afterEach(() => { cleanup(); dom.close(); for (const key of keys) { const descriptor = original.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
function Player() {
  const frame = useRef<HTMLDivElement>(null);
  const { fullscreen, button, toggle } = usePlayerFullscreen(frame);
  const [count, setCount] = useState(0);
  return <div ref={frame} data-testid="player" data-fullscreen={fullscreen}><button ref={button} onClick={() => void toggle()}>Fullscreen</button><button onClick={() => setCount(count + 1)}>Step {count}</button></div>;
}
test("native fullscreen preserves the mounted player, exits and restores focus/scroll", async () => {
  const view = render(<Player />);
  const frame = view.getByTestId("player");
  let active: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => active });
  frame.requestFullscreen = async () => { active = frame; document.dispatchEvent(new Event('fullscreenchange')); };
  document.exitFullscreen = async () => { active = null; document.dispatchEvent(new Event('fullscreenchange')); };
  fireEvent.click(view.getByText("Step 0"));
  await act(async () => fireEvent.click(view.getByText("Fullscreen")));
  expect(frame.dataset.fullscreen).toBe("true");
  expect(view.getByText("Step 1")).not.toBeNull();
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
  expect(frame.dataset.fullscreen).toBe("false");
  expect(document.activeElement).toBe(view.getByText("Fullscreen"));
  expect(document.body.style.overflow).toBe("");
});
test("unavailable fullscreen uses the same element and restores scrolling on unmount", async () => {
  const view = render(<Player />);
  const frame = view.getByTestId("player");
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  let opened = false;
  frame.showPopover = () => { opened = true; };
  await act(async () => fireEvent.click(view.getByText("Fullscreen")));
  expect(opened).toBe(true);
  expect(view.getByTestId("player")).toBe(frame);
  expect(frame.dataset.fullscreen).toBe("true");
  view.unmount();
  expect(document.body.style.overflow).toBe("");
});
