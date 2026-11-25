import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { HybridGamesBrowser } from "../app/games/hybrid-games-browser";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import type { SeasonIdentity } from "../lib/api";

const saved = new Map(["window", "document", "navigator", "localStorage", "IntersectionObserver"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
const auth = { ready: true, authenticated: false, account: null, hydrationError: false } as InfluenceAuthState;
const seasons = [{ id: "season-id", slug: "season-slug", name: "First season", status: "active" }] as SeasonIdentity[];
let dom: HappyDOMWindow;
let reachEnd: (() => void) | undefined;

function setup() {
  dom = new HappyDOMWindow({ url: "http://localhost/games" });
  for (const key of ["window", "document", "navigator", "localStorage"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  class Observer {
    constructor(readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void, readonly options?: IntersectionObserverInit) {}
    observe() { if (this.options?.rootMargin) reachEnd = () => this.callback([{ isIntersecting: true }]); }
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: Observer });
}
afterEach(async () => {
  await act(async () => { cleanup(); });
  reachEnd = undefined;
  dom?.close(); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

const wolf = { id: "wolf-id", slug: "wolf-slug", gameKind: "werewolf", status: "completed", playerCount: 6, joinedPlayers: 6, modelLabel: "model", createdAt: "2026-10-05", episode: { title: "Moon game", cast: [] } };
const influence = { id: "house-id", slug: "house-slug", status: "waiting", playerCount: 6, alivePlayers: 1, createdAt: "2026-10-05", visibility: "public", episode: { title: "House game", cast: [] } };

test("season collection uses its resolved ID and filters without loading the full library", async () => {
  setup(); const calls: URL[] = [];
  globalThis.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost"); calls.push(url); expect(init?.credentials).toBe("omit");
    return Promise.resolve(Response.json({ items: [{ kind: "influence", game: influence }], nextCursor: null }));
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<InfluenceAuthContext.Provider value={auth}><HybridGamesBrowser collection={{ kind: "season", slug: "season-slug" }} initialSeasons={seasons} /></InfluenceAuthContext.Provider>);
  await view.findByText("House game");
  expect(calls[0]?.pathname).toBe("/api/public-games/page");
  expect(calls[0]?.searchParams.get("collection")).toBe("season"); expect(calls[0]?.searchParams.get("season")).toBe("season-id");
  expect(calls[0]?.searchParams.get("kind")).toBe("influence"); expect(calls[0]?.searchParams.get("limit")).toBeNull();
  fireEvent.change(view.getByLabelText("Game status"), { target: { value: "completed" } });
  await waitFor(() => expect(calls.at(-1)?.searchParams.get("status")).toBe("completed"));
  fireEvent.change(view.getByLabelText("Game category"), { target: { value: "season:season-id" } });
  await waitFor(() => expect(calls.at(-1)?.searchParams.get("category")).toBe("season:season-id"));
  await waitFor(() => expect(view.queryByRole("status")).toBeNull());
});

test("unknown seasons fail closed without a request", async () => {
  setup(); let calls = 0;
  globalThis.fetch = Object.assign(() => { calls++; return Promise.resolve(Response.json({ items: [], nextCursor: null })); }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<InfluenceAuthContext.Provider value={auth}><HybridGamesBrowser collection={{ kind: "season", slug: "missing" }} initialSeasons={seasons} /></InfluenceAuthContext.Provider>);
  expect(view.getByRole("alert").textContent).toContain("season is unavailable"); expect(calls).toBe(0);
});

test("werewolf collection requests the next page when its end comes into view", async () => {
  setup(); const calls: URL[] = [];
  globalThis.fetch = Object.assign((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost"); calls.push(url);
    return Promise.resolve(Response.json(url.searchParams.has("cursor")
      ? {items: [{kind:"werewolf", game:{...wolf,id:"second",episode:{title:"Moon sequel",cast:[]}}}],nextCursor:null}
      : {items:[{kind:"werewolf",game:wolf}],nextCursor:"next"}));
  }, {preconnect:originalFetch.preconnect}) as typeof fetch;
  const view = render(<InfluenceAuthContext.Provider value={auth}><HybridGamesBrowser collection={{kind:"game",game:"werewolf"}} initialSeasons={seasons} /></InfluenceAuthContext.Provider>);
  await view.findByText("Moon game"); expect(calls).toHaveLength(1);
  expect(view.queryByRole("button", { name: /load more|refresh games/i })).toBeNull();
  await act(async () => { reachEnd?.(); reachEnd?.(); });
  await view.findByText("Moon sequel"); expect(calls).toHaveLength(2); expect(calls[1]?.searchParams.get("cursor")).toBe("next");
});

test("the Open collection keeps both games and applies its game filter", async () => {
  setup();
  const calls: URL[] = [];
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input), "http://localhost"));
    return Response.json({ items: [{ kind: "influence", game: influence }, { kind: "werewolf", game: { ...wolf, status: "waiting" } }], nextCursor: null });
  }, { preconnect: originalFetch.preconnect });
  const view = render(<InfluenceAuthContext.Provider value={auth}><HybridGamesBrowser collection={{ kind: "open" }} initialSeasons={seasons} /></InfluenceAuthContext.Provider>);
  await view.findByText("House game");
  await view.findByText("Moon game");
  expect(view.queryByLabelText("Game status")).toBeNull();
  expect(calls[0]?.searchParams.get("kind")).toBe("all");
  expect(calls[0]?.searchParams.get("status")).toBe("waiting");
  fireEvent.change(view.getByLabelText("Game type"), { target: { value: "werewolf" } });
  await waitFor(() => expect(calls.at(-1)?.searchParams.get("kind")).toBe("werewolf"));
  expect(calls.at(-1)?.searchParams.get("status")).toBe("waiting");
});
