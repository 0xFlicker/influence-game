import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { GamesBrowser } from "../app/games/games-browser";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";

const saved = new Map(["window", "document", "navigator", "localStorage", "IntersectionObserver", "ResizeObserver"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch, originalInterval = globalThis.setInterval, originalTimeout = globalThis.setTimeout;
let dom: HappyDOMWindow;

afterEach(async () => {
  await act(async () => { cleanup(); });
  dom?.close(); globalThis.fetch = originalFetch; globalThis.setInterval = originalInterval; globalThis.setTimeout = originalTimeout;
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

function setup() {
  dom = new HappyDOMWindow({ url: "http://localhost/games" });
  for (const key of ["window", "document", "navigator", "localStorage"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  class Observer { observe() {} disconnect() {} unobserve() {} }
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: Observer });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: Observer });
  const auth = { ready: true, authenticated: false, account: null, hydrationError: false } as InfluenceAuthState;
  return () => render(<InfluenceAuthContext.Provider value={auth}><GamesBrowser /></InfluenceAuthContext.Provider>);
}

test("a fast sibling failure aborts the hanging request and keeps poll ownership until it settles", async () => {
  const renderBrowser = setup(); let tick: (() => void) | undefined, releaseAbort: (() => void) | undefined;
  let gamesRequests = 0, aborts = 0, seasonsRequests = 0;
  globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 10_000) tick = () => callback(...args);
    return originalInterval(callback, delay, ...args);
  }) as typeof setInterval;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/games")) {
      gamesRequests++;
      if (gamesRequests > 1) return Promise.resolve(Response.json([]));
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected an abort signal");
        signal.addEventListener("abort", () => { aborts++; releaseAbort = () => reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    }
    if (url.endsWith("/api/seasons")) {
      seasonsRequests++;
      return Promise.resolve(seasonsRequests === 1 ? Response.json({ error: "Season service unavailable" }, { status: 503 }) : Response.json({ schemaVersion: 1, seasons: [] }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const view = renderBrowser();
  await waitFor(() => expect(aborts).toBe(1));
  expect(tick).toBeDefined(); expect(releaseAbort).toBeDefined();
  await act(async () => { tick!(); await Promise.resolve(); });
  expect(gamesRequests).toBe(1);
  await act(async () => { releaseAbort!(); });
  await view.findByText("Season service unavailable");
  expect(view.queryByText("Loading games took too long.")).toBeNull();
  await act(async () => { tick!(); });
  await waitFor(() => expect(gamesRequests).toBe(2));
  await waitFor(() => expect(view.queryByText("Season service unavailable")).toBeNull());
});

test("unmount aborts both active sibling requests", async () => {
  const renderBrowser = setup(); let started = 0, aborted = 0;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    started++;
    return new Promise<Response>((_resolve, reject) => {
      if (!init?.signal) throw new Error("Expected an abort signal");
      init.signal.addEventListener("abort", () => { aborted++; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }) as typeof fetch;
  const view = renderBrowser();
  await waitFor(() => expect(started).toBe(2));
  await act(async () => { view.unmount(); });
  expect(aborted).toBe(2);
});

test("a real timeout still reports the timeout rather than a sibling failure", async () => {
  const renderBrowser = setup(); let timeout: (() => void) | undefined, started = 0;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 20_000) timeout = () => callback(...args);
    return originalTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    started++;
    return new Promise<Response>((_resolve, reject) => {
      if (!init?.signal) throw new Error("Expected an abort signal");
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  }) as typeof fetch;
  const view = renderBrowser();
  await waitFor(() => expect(started).toBe(2));
  expect(timeout).toBeDefined();
  await act(async () => { timeout!(); });
  expect(await view.findByText("Loading games took too long.")).toBeTruthy();
});

test("a failed sibling cancels the uncapped Werewolf search request", async () => {
  setup(); let aborted = 0; const paths: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); paths.push(url);
    if (url.endsWith("/api/games")) return Promise.resolve(Response.json({error:"Search unavailable"},{status:503}));
    if (url.endsWith("/api/seasons")) return Promise.resolve(Response.json({schemaVersion:1,seasons:[]}));
    if (url.endsWith("/api/werewolf-search")) return new Promise<Response>((_resolve, reject) => {
      if (!init?.signal) throw new Error("Expected an abort signal");
      init.signal.addEventListener("abort", () => { aborted++; reject(new DOMException("Aborted", "AbortError")); }, {once:true});
    });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const auth = { ready: true, authenticated: false, account: null, hydrationError: false } as InfluenceAuthState;
  const view = render(<InfluenceAuthContext.Provider value={auth}><GamesBrowser includeWerewolf uncappedWerewolfSearch hideToolbar externalFilters={{status:"all",category:"all",search:"moon"}} /></InfluenceAuthContext.Provider>);
  await view.findByText("Search unavailable");
  expect(aborted).toBe(1);
  expect(paths.some(path=>path.endsWith("/api/werewolf-search"))).toBe(true);
  expect(paths.some(path=>path.endsWith("/api/werewolf"))).toBe(false);
});
