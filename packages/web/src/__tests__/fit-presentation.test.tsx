import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { FitPresentation } from "../app/games/[slug]/components/fit-presentation";
import { VoteLedger } from "../app/games/[slug]/components/vote-presentation";

const globals = ["window", "document", "navigator", "HTMLElement", "Node", "ResizeObserver"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  constructor(readonly callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  TestResizeObserver.instances = [];
  for (const key of globals) Object.defineProperty(globalThis, key, {
    configurable: true, value: key === "ResizeObserver" ? TestResizeObserver : dom[key],
  });
});

afterEach(() => {
  cleanup();
  dom.close();
  for (const key of globals) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("a dense twelve-player ledger keeps every receipt in its frame and reports scaling for portrait collection", () => {
  const names = ["Wren", "Ivy Caldwell", "Mara Bellwether", "Kael", "Mira", "Rex", "Jax", "Zara", "Luna", "Orion", "Cyrus", "AReallyLongUnbrokenPlayerName"];
  const roster = names.map((name, index) => ({ id: `player-${index}`, name, persona: "social" }));
  const votes = roster.map((player, index) => ({ voterId: player.id,
    targetId: roster[index === 11 ? 2 : [1, 2, 3].includes(index) ? 0 : 1]!.id, choice: "empower" as const }));
  const layouts: { scale: number; top: number }[] = [];
  const mounted = render(<FitPresentation enabled onLayoutChange={layout => layouts.push(layout)}>
    <VoteLedger title="Empower vote" votes={votes} total={12} roster={roster} />
  </FitPresentation>);
  const outer = mounted.container.firstElementChild as HTMLElement;
  const inner = outer.firstElementChild as HTMLElement;
  let available = 120, natural = 240;
  Object.defineProperty(outer, "clientHeight", { get: () => available });
  Object.defineProperty(inner, "scrollHeight", { get: () => natural });
  const resize = () => act(() => TestResizeObserver.instances[0]!.callback([], TestResizeObserver.instances[0]!));

  resize();
  expect(inner.style.transform).toBe("scale(0.5)");
  expect(layouts.at(-1)).toEqual({ scale: .5, top: 0 });
  expect(mounted.container.querySelectorAll("[data-ledger-voter]")).toHaveLength(12);
  expect(mounted.container.querySelector('[data-running-total="player-1"]')?.textContent).toBe("8");
  expect(mounted.getByRole("listitem", { name: "AReallyLongUnbrokenPlayerName → Mara Bellwether" })).not.toBeNull();

  natural = 360;
  resize();
  expect(natural * layouts.at(-1)!.scale).toBeLessThanOrEqual(available);
  expect(mounted.container.querySelectorAll("[data-ledger-voter]")).toHaveLength(12);
  available = 720;
  resize();
  expect(inner.style.transform).toBe("scale(1)");
  expect(layouts.at(-1)).toEqual({ scale: 1, top: 180 });
  available = 800;
  resize();
  expect(layouts.at(-1)).toEqual({ scale: 1, top: 220 });
});
