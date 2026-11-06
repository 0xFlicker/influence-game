import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { HybridGamesBrowser } from "../app/games/hybrid-games-browser";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import type { SeasonIdentity } from "../lib/api";

const saved = new Map(["window", "document", "navigator", "localStorage", "IntersectionObserver", "ResizeObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
let dom: HappyDOMWindow;
afterEach(async () => {
  await act(async () => { cleanup(); }); dom?.close(); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

const wolf = (id: string, status: string) => ({ kind: "werewolf", game: { id, slug: id, gameKind: "werewolf", status, playerCount: 6, joinedPlayers: 6, modelLabel: "model", createdAt: "2026-01-01", episode: { title: id, cast: [] } } });
const house = (id: string, status: string, seasonId?: string) => ({ kind: "influence", game: { id, slug: id, status, seasonId, playerCount: 6, alivePlayers: 1, modelLabel: "model", visibility: "public", createdAt: "2026-01-01", episode: { title: id, cast: [] } } });

test("overview shelves page independently and do not silently skip excluded candidates", async () => {
  dom = new HappyDOMWindow({ url: "http://localhost/games" });
  for (const key of ["window", "document", "navigator", "localStorage"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  class Observer { observe() {} disconnect() {} unobserve() {} }
  for (const key of ["IntersectionObserver", "ResizeObserver"]) Object.defineProperty(globalThis, key, { configurable: true, value: Observer });
  const calls: URL[] = [];
  globalThis.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"); calls.push(url); expect(init?.credentials).toBe("omit");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.has("q")).toBe(false);
    const kind = url.searchParams.get("kind"), status = url.searchParams.get("status"), collection = url.searchParams.get("collection");
    if (status === "waiting") return Promise.resolve(Response.json({ items: [wolf("Open wolf", "waiting"), house("Open house", "waiting")], nextCursor: null }));
    expect(status).toBe("nonwaiting");
    if (collection === "season") return Promise.resolve(Response.json({ items: [house("Season finished", "completed", "s1")], nextCursor: null }));
    if (kind === "werewolf") return Promise.resolve(Response.json({ items: [wolf("Wolf finished", "completed")], nextCursor: null }));
    if (url.searchParams.has("cursor")) return Promise.resolve(Response.json({ items: [house("Other finished", "completed")], nextCursor: null }));
    expect(url.searchParams.get("excludeSeason")).toBe("s1"); return Promise.resolve(Response.json({ items: [], nextCursor: "next" }));
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const auth = { ready: true, authenticated: false, account: null, hydrationError: false } as InfluenceAuthState;
  const seasons = [{ id: "s1", slug: "season-one", name: "Season one", status: "active" }] as SeasonIdentity[];
  const view = render(<InfluenceAuthContext.Provider value={auth}><HybridGamesBrowser initialSeasons={seasons} /></InfluenceAuthContext.Provider>);
  await view.findByText("Season finished"); await view.findByText("Wolf finished");
  expect(view.getAllByText("Open wolf")).toHaveLength(1); expect(view.getAllByText("Open house")).toHaveLength(1);
  expect(view.queryByText("Season open")).toBeNull(); expect(view.queryByText("Other finished")).toBeNull();
  expect(calls).toHaveLength(4);
  fireEvent.click(view.getByRole("button", { name: "Load more Influence games" }));
  await view.findByText("Other finished"); expect(calls).toHaveLength(5); expect(calls.at(-1)?.searchParams.get("cursor")).toBe("next");
  fireEvent.change(view.getByLabelText("Game status"), { target: { value: "waiting" } });
  expect(calls).toHaveLength(5);
  expect(view.queryByText("Other finished")).toBeNull(); expect(view.queryByText("Wolf finished")).toBeNull();
});
