import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWerewolfWatch } from "../components/games/werewolf/use-werewolf-watch";
import { setApiBase } from "../lib/api";

const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia"] as const;
const savedGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;

beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const name of ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] });
  }
  globalThis.requestAnimationFrame = callback => Number(setTimeout(() => callback(performance.now()), 16));
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
  setApiBase("");
});

afterEach(async () => {
  await act(async () => cleanup());
  dom.close();
  globalThis.fetch = originalFetch;
  for (const key of globals) {
    const descriptor = savedGlobals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function fixture(speeches: number[], latestCursor = 128, status = "cancelled") {
  const requests: number[] = [];
  const speechAt = new Set(speeches);
  const fetcher = async (url: string) => {
    const start = Number(new URL(url, "http://localhost").searchParams.get("fromCursor"));
    requests.push(start);
    const players = [{ id: "p", name: "Player", avatarUrl: null, personaKey: null, alive: true }];
    const moments = Array.from({ length: Math.min(32, latestCursor - start + 1) }, (_, i) => {
      const cursor = start + i;
      return {
        cursor,
        entry: speechAt.has(cursor)
          ? { kind: "speech", day: 1, actorId: "p", audience: "public", text: `Speech ${cursor}`, cue: null }
          : { kind: "phase", day: 1, phase: "day" },
        snapshot: { gameId: "g", rulesVersion: 7, preset: "one_wolf", audience: "mystery", day: 1, maxDays: 5, phase: "day", discussion: null, cursor, players, outcome: null },
        chapterId: "day:1", sceneId: `scene:${cursor}`, mediaKey: null,
      };
    });
    return Response.json({
      gameId: "g", slug: "g", status, audience: "mystery", rulesVersion: 7,
      publicationCutoff: "2026-10-06T00:00:00.000Z", latestCursor,
      fromCursor: start, throughCursor: moments.at(-1)?.cursor ?? latestCursor,
      players: players.map(p => ({ ...p, personality: "", backstory: "" })),
      moments, navigation: [], playback: [...speechAt].map(cursor => ({ cursor, steps: 1 })), media: {},
    });
  };
  globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect }) as typeof fetch;
  return requests;
}

const useFixtureWatch = () => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", 1);

test("cached distant windows wait for missing history after rewind and Previous", async () => {
  const requests = fixture([1, 40, 65, 97]);
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  await act(async () => { await view.result.current.seek(97, false); });
  await act(async () => { await view.result.current.seek(1, false); });
  expect(view.result.current.snapshot.cueKeys.filter(key => !key.includes(":opening:"))).toEqual(["g:mystery:1"]);
  expect(requests).not.toContain(33);
  expect(requests).not.toContain(65);
  await act(async () => { view.result.current.director.setSpeed(4); view.result.current.toggle(); });
  await waitFor(() => expect(view.result.current.active?.cursor).toBe(40), { timeout: 5000 });
  expect(requests).toContain(33);
  await act(async () => { await view.result.current.seek(97, false); });
  await act(async () => { view.result.current.previous(); });
  await waitFor(() => expect(view.result.current.active?.cursor).toBe(65));
  expect(requests).toContain(65);
});

test("timed playback crosses silent history longer than the three-window cache", async () => {
  const requests = fixture([1, 129], 160);
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  await act(async () => view.result.current.director.setSpeed(4));
  await waitFor(() => expect(view.result.current.active?.cursor).toBe(129), { timeout: 5000 });
  expect(requests).toEqual(expect.arrayContaining([1, 33, 65, 97, 129]));
});

test("live playback reaches the frontier after seeking backward through cached silent windows", async () => {
  fixture([1, 33, 96, 97], 97, "in_progress");
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  await act(async () => { await view.result.current.seek(96, false); });
  await act(async () => { await view.result.current.seek(33, false); });
  await act(async () => { await view.result.current.seek(1, true); view.result.current.director.setSpeed(4); });
  await waitFor(() => expect(view.result.current.active?.cursor).toBe(97), { timeout: 7000 });
});

test("ordinary entry plays the opening; its stops seek, pause, restart and hand off to recorded introductions", async () => {
  fixture([1, 2], 2);
  const view = renderHook(() => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", undefined, "Actual episode"));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.openingCue?.opening.shot).toBe("house");
  expect(view.result.current.scrubCount).toBe(6);
  await act(async () => view.result.current.toggle());
  await act(async () => {await view.result.current.seekStop(2);});
  expect(view.result.current.openingCue?.opening.title).toBe("Actual episode");
  expect(view.result.current.scrubPosition).toBe(1);
  expect(view.result.current.snapshot.isPlaying).toBe(false);
  await act(async () => {await view.result.current.seekStop(4);view.result.current.director.manualAdvance();});
  expect(view.result.current.openingCue).toBeNull();
  expect(view.result.current.active?.cursor).toBe(1);
  await act(async () => view.result.current.previous());
  expect(view.result.current.openingCue?.opening.shot).toBe("door");
  await act(async () => {await view.result.current.seekOpening(0);});
  expect(view.result.current.openingCue?.opening.shot).toBe("house");
});

test("explicit moment links bypass the opening, including moment one", async () => {
  fixture([1,2],2);
  const view=renderHook(()=>useWerewolfWatch("g","mystery","2026-10-06T00:00:00.000Z",1));
  await waitFor(()=>expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.openingCue).toBeNull();expect(view.result.current.active?.cursor).toBe(1);
});

test("restarting from a distant moment restores opening navigation before the first recorded cue", async () => {
  fixture([1, 65, 97]);
  const view = renderHook(() => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", 97));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.active?.cursor).toBe(97);
  await act(async () => { await view.result.current.seekOpening(0); });
  expect(view.result.current.openingCue?.opening.shot).toBe("house");
  await act(async () => { await view.result.current.seek(1, false); view.result.current.previous(); });
  expect(view.result.current.openingCue?.opening.shot).toBe("door");
});
