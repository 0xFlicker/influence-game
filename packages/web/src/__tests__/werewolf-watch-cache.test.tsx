import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {StrictMode, type ReactNode} from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWerewolfWatch } from "../components/games/werewolf/use-werewolf-watch";
import { setApiBase } from "../lib/api";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {mapWerewolfWatchCue, projectWerewolfProductionProvenance, projectWerewolfProductionWatch, projectWerewolfWatch} from "@influence/engine/werewolf/watch";

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
          : {kind: "conversation", day: 1, id: cursor, actorId: "p", text: null, cue: null, recipientId: null, replyToContributionId: null, unavailable: false, remainingBytes: 2000},
        snapshot: { gameId: "g", rulesVersion: 8, preset: "one_wolf", audience: "mystery", day: 1, maxDays: 5, phase: "day", discussion: null, cursor, players, outcome: null },
        chapterId: "day:1", sceneId: `scene:${cursor}`, mediaKey: null,
      };
    });
    return Response.json({
      gameId: "g", slug: "g", status, audience: "mystery", rulesVersion: 8,
      publicationCutoff: "2026-10-06T00:00:00.000Z", latestCursor,
      fromCursor: start, throughCursor: moments.at(-1)?.cursor ?? latestCursor,
      players: players.map(p => ({ ...p, personality: "", backstory: "" })),
      moments, navigation: [], playback: [...speechAt].map(cursor => ({ cursor, steps: 1, durationsMs: [4450], keys: [`g:mystery:${cursor}`] })), media: {},
    });
  };
  globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect }) as typeof fetch;
  return requests;
}

const useFixtureWatch = () => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", 1);

test("Strict Mode effect replay reloads the initial position after cleanup", async () => {
  fixture([1,2],2);
  const view = renderHook(useFixtureWatch, {wrapper:({children}:{children:ReactNode}) => <StrictMode>{children}</StrictMode>});
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.director.getActiveCue()?.key).toBe("g:mystery:1");
});

function canonicalFixture(events: Awaited<ReturnType<typeof completedCurrentWerewolfFixture>>, waitForMapping?:Promise<void>, status = "completed") {
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    if (url.pathname.endsWith("/watch-position")) {
      if (waitForMapping) await waitForMapping;
      return Response.json(mapWerewolfWatchCue(events, url.searchParams.get("from") as "mystery" | "omniscient", url.searchParams.get("to") as "mystery" | "omniscient", Number(url.searchParams.get("cursor")), url.searchParams.get("cue")!));
    }
    const audience = url.searchParams.get("audience") as "mystery" | "omniscient";
    const projection = projectWerewolfWatch(events, audience, Number(url.searchParams.get("fromCursor")), 32);
    return Response.json({...projection, slug:"g", status, audience, publicationCutoff:"2026-10-06T00:00:00.000Z", media:{}});
  }, {preconnect:originalFetch.preconnect}) as typeof fetch;
}
test.each([false,true])("switching a silent live boundary preserves its position and follow intent (following: %s)", async following => {
  const events = await completedCurrentWerewolfFixture("switch-tail", 10);
  const projection = projectWerewolfProductionWatch(events,"mystery");
  const silent = projection.moments.find(moment => moment.cursor > 1 && !projection.playback.some(row => row.cursor === moment.cursor))!;
  const sequence = projectWerewolfProductionProvenance(events,"mystery").find(row => row.cursor === silent.cursor)!.eventSequence;
  const prefix = events.filter(event => event.sequence <= sequence);
  const expected = mapWerewolfWatchCue(prefix,"mystery","omniscient",silent.cursor,`switch-tail:mystery:${silent.cursor}:boundary`);
  if (!("boundaryCursor" in expected)) throw new Error("Missing mapped boundary");
  canonicalFixture(prefix,undefined,"in_progress");
  const preceding = projection.playback.findLast(row => row.cursor < silent.cursor)!;
  const view = renderHook(() => useWerewolfWatch("g","mystery","2026-10-06T00:00:00.000Z",preceding.cursor));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  act(() => view.result.current.director.holdAtTail(view.result.current.director.getSnapshot().cursor,true));
  await waitFor(() => expect(view.result.current.active?.cursor).toBe(silent.cursor));
  if (!following) act(() => view.result.current.pause());
  await act(async () => {await view.result.current.switchAudience("omniscient",false);});
  expect(view.result.current.audience).toBe("omniscient");
  expect(view.result.current.active?.cursor).toBe(expected.boundaryCursor ?? undefined);
  expect(view.result.current.director.getActiveCue()?.key ?? null).toBe(expected.key);
  expect(view.result.current.holding).toBe(true);
  expect(view.result.current.follow).toBe(following);
  expect(view.result.current.director.getSnapshot().isPlaying).toBe(following);
});
test("switching audiences retains the public dawn cue, time and paused state", async () => {
  const events = await completedCurrentWerewolfFixture("switch-fixture", 10);
  const mystery = projectWerewolfProductionWatch(events, "mystery");
  const dawn = mystery.moments.find(moment => moment.entry.kind === "night")!;
  canonicalFixture(events);
  const view = renderHook(() => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", dawn.cursor, undefined, undefined, false, true));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  act(() => {view.result.current.director.setSpeed(2);view.result.current.director.seekTimeline(view.result.current.director.getSnapshot().cursor, 1200);});
  const director = view.result.current.director;
  let changed = false;
  await act(async () => {changed = await view.result.current.switchAudience("omniscient", false);});
  expect(changed).toBe(true);
  expect(view.result.current.audience).toBe("omniscient");
  expect(view.result.current.director).toBe(director);
  expect(director.getActiveCue()?.key).toContain(":omniscient:");
  expect(director.getElapsedBaseMs()).toBeCloseTo(1200,3);
  expect(director.getSnapshot().speed).toBe(2);
  expect(director.getSnapshot().isPlaying).toBe(false);
  await act(async () => {changed = await view.result.current.switchAudience("mystery", false);});
  expect(changed).toBe(true);
  expect(director.getActiveCue()?.key).toBe(`${mystery.gameId}:mystery:${dawn.cursor}`);
  expect(director.getElapsedBaseMs()).toBeCloseTo(1200,3);
});

test("switching from a private night action lands before the public dawn", async () => {
  const events = await completedCurrentWerewolfFixture("switch-private", 10);
  const omni = projectWerewolfProductionWatch(events, "omniscient");
  const dawn = omni.moments.find(moment => moment.entry.kind === "night")!;
  const privateKey = omni.playback.find(row => row.cursor === dawn.cursor)!.keys.find(key => /:(protect|investigate|hunt)(:decision)?$/.test(key))!;
  const expected = mapWerewolfWatchCue(events,"omniscient","mystery",dawn.cursor,privateKey);
  expect(expected.exact).toBe(false);
  canonicalFixture(events);
  const view = renderHook(() => useWerewolfWatch("g", "omniscient", "2026-10-06T00:00:00.000Z", dawn.cursor, undefined, undefined, false, true));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  await act(async () => {await view.result.current.seekTiming(privateKey,1000);});
  await act(async () => {await view.result.current.switchAudience("mystery", false);});
  expect(expected.key).not.toBeNull();
  expect(view.result.current.director.getActiveCue()?.key).toBe(expected.key!);
  expect(view.result.current.active?.snapshot.players.every(player => !player.role)).toBe(true);
  expect(view.result.current.audience).toBe("mystery");
});

test("returning to the current audience cancels a slow in-flight switch", async () => {
  const events = await completedCurrentWerewolfFixture("switch-cancel", 10);
  const mystery = projectWerewolfProductionWatch(events, "mystery");
  const dawn = mystery.moments.find(moment => moment.entry.kind === "night")!;
  let release = () => {};
  const pending = new Promise<void>(resolve => {release = resolve;});
  canonicalFixture(events, pending);
  const view = renderHook(() => useWerewolfWatch("g", "mystery", "2026-10-06T00:00:00.000Z", dawn.cursor, undefined, undefined, false, true));
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  const key = view.result.current.director.getActiveCue()?.key;
  let operation:Promise<boolean> | undefined;
  act(() => {operation = view.result.current.switchAudience("omniscient", false);});
  await act(async () => {await view.result.current.switchAudience("mystery", false);});
  await act(async () => {release(); await operation;});
  expect(view.result.current.audience).toBe("mystery");
  expect(view.result.current.director.getActiveCue()?.key).toBe(key);
  expect(view.result.current.preparing).toBe(false);
});

for(const status of ["in_progress","completed"])test(`operator ${status} player stays paused after hydration until Play`,async()=>{
  fixture([1,2],2,status);
  const view=renderHook(()=>useWerewolfWatch("g","mystery","2026-10-06T00:00:00.000Z",1,undefined,undefined,false,true));
  await waitFor(()=>expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.follow).toBe(false);
  expect(view.result.current.director.getSnapshot().isPlaying).toBe(false);
  const cue=view.result.current.director.getActiveCue()?.key;
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100));});
  expect(view.result.current.director.getActiveCue()?.key).toBe(cue);
  act(()=>view.result.current.toggle());
  expect(view.result.current.follow).toBe(true);
  expect(view.result.current.director.getSnapshot().isPlaying).toBe(true);
});

test("audio interruption clears play intent and one normal toggle resumes", async () => {
  fixture([1, 2], 2);
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  act(() => view.result.current.pause());
  expect(view.result.current.follow).toBe(false);
  expect(view.result.current.snapshot.isPlaying).toBe(false);
  act(() => view.result.current.toggle());
  expect(view.result.current.follow).toBe(true);
  expect(view.result.current.snapshot.isPlaying).toBe(true);
});

test("background visibility preserves playback intent and an explicit pause stays paused on return", async () => {
  fixture([1, 2], 2);
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  expect(view.result.current.snapshot.isPlaying).toBe(true);
  const visibility = async (hidden: boolean) => act(async () => {
    Object.defineProperty(document, "hidden", {configurable: true, value: hidden});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visibility(true);
  expect(view.result.current.follow).toBe(true);
  expect(view.result.current.snapshot.isPlaying).toBe(true);
  await act(async () => {await view.result.current.seek(2, true);});
  expect(view.result.current.snapshot.isPlaying).toBe(true);
  await act(async () => view.result.current.toggle());
  expect(view.result.current.follow).toBe(false);
  await visibility(false);
  expect(view.result.current.snapshot.isPlaying).toBe(false);
  expect(view.result.current.follow).toBe(false);
});

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
  await act(async () => {await view.result.current.seekOpening(1);});
  expect(view.result.current.openingCue?.opening.title).toBe("Actual episode");
  expect(view.result.current.scrubPosition).toBe(1);
  expect(view.result.current.snapshot.isPlaying).toBe(false);
  await act(async () => {await view.result.current.seekOpening(3);view.result.current.director.manualAdvance();});
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

test("frame seek loads a distant window at its exact local offset and keeps a paused viewer paused", async () => {
  const requests = fixture([1, 40, 65, 97]);
  const view = renderHook(useFixtureWatch);
  await waitFor(() => expect(view.result.current.preparing).toBe(false));
  await act(async () => { await view.result.current.seek(1, false); });
  await act(async () => { await view.result.current.seekTiming("g:mystery:97", 1233.333333); });
  expect(requests).toContain(97);
  expect(view.result.current.director.getActiveCue()?.key).toBe("g:mystery:97");
  expect(view.result.current.director.getTimelineElapsedBaseMs()).toBeCloseTo(1233.333333);
  expect(view.result.current.snapshot.isPlaying).toBe(false);
  await act(async () => { await view.result.current.seekTiming("g:mystery:97", 2000); });
  expect(view.result.current.director.getTimelineElapsedBaseMs()).toBe(2000);
});
