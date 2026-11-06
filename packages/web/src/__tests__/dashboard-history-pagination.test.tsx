import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Window } from "happy-dom";
import type { HouseParticipation } from "@influence/engine/house-participation";
import { DashboardHistory } from "../app/dashboard/dashboard-history";
import { useDashboardHistory } from "../app/dashboard/use-dashboard-history";

const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
let tab: Window;

beforeEach(() => {
  tab = new Window({ url: "http://localhost/dashboard" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: tab[key] });
  tab.localStorage.setItem("influence_session", "token");
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  tab.close();
  for (const key of globals) {
    const descriptor = original.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function entry(index: number): HouseParticipation {
  const base = {
    gameId: `game-${index}`, gameSlug: `game-${index}`, gameTitle: `Game ${index}`,
    playerId: `player-${index}`, agentProfileId: "agent", agentName: "Agent",
    totalPlayers: 6, completedAt: "2026-10-05T12:00:00.000Z",
  };
  return index % 2 === 0
    ? { ...base, gameKind: "influence", result: { outcome: "loss", placement: 2, eliminated: true, rounds: 3, totalPoints: 10 } }
    : { ...base, gameKind: "werewolf", result: { outcome: "win", faction: "village", alive: true, eliminationDay: null, days: 3 } };
}

function History({ owner = "owner" }: { owner?: string }) {
  const history = useDashboardHistory(owner, true);
  return <DashboardHistory entries={history.entries} loading={history.loading} error={history.error} kind={history.kind} page={history.page} hasNext={history.nextCursor !== null} onKindChange={history.setKind} onPrevious={history.previous} onNext={history.next} onRetry={history.retry} />;
}

test("requests three owner-history entries per page, and filters before paging", async () => {
  const requests: URL[] = [];
  const entries = Array.from({ length: 8 }, (_, index) => entry(index));
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost"); requests.push(url);
    const kind = url.searchParams.get("game");
    const filtered = entries.filter(item => kind === "all" || item.gameKind === kind);
    const start = Number(url.searchParams.get("cursor") ?? 0);
    return Response.json({ items: filtered.slice(start, start + 3), nextCursor: start + 3 < filtered.length ? String(start + 3) : null });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<History />);
  await waitFor(() => expect(view.getAllByRole("listitem")).toHaveLength(3));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.pathname).toBe("/api/player/games-page");
  expect(requests[0]!.searchParams.get("limit")).toBe("3");
  expect(requests[0]!.searchParams.get("game")).toBe("all");
  const pages = () => within(view.getByRole("navigation", { name: "Game history pages" }));
  expect(pages().getByText("Page 1")).toBeTruthy();
  fireEvent.click(pages().getByRole("button", { name: "Next" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Game 3" })).toBeTruthy());
  expect(requests[1]!.searchParams.get("cursor")).toBe("3");
  expect(pages().getByText("Page 2")).toBeTruthy();
  fireEvent.click(pages().getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Game 0" })).toBeTruthy());
  expect(requests[2]!.searchParams.has("cursor")).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Influence" }));
  await waitFor(() => expect(view.queryByRole("link", { name: "Game 1" })).toBeNull());
  await waitFor(() => expect(view.getByRole("link", { name: "Game 4" })).toBeTruthy());
  expect(requests[3]!.searchParams.get("game")).toBe("influence");
  expect(requests[3]!.searchParams.has("cursor")).toBe(false);
  expect(view.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(pages().getByRole("button", { name: "Next" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Game 6" })).toBeTruthy());
  expect(view.getAllByRole("listitem")).toHaveLength(1);
  expect((pages().getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
});

test("failed pages can be retried and stale responses cannot cross accounts", async () => {
  let resolveOld: (response: Response) => void = () => {};
  let calls = 0;
  globalThis.fetch = Object.assign(async () => {
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
    if (calls === 2) return new Response("unavailable", { status: 503 });
    return Response.json({ items: [entry(1)], nextCursor: null });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<History owner="first" />);
  await waitFor(() => expect(calls).toBe(1));
  view.rerender(<History owner="second" />);
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not load"));
  resolveOld(Response.json({ items: [entry(0)], nextCursor: null }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.queryByRole("link", { name: "Game 0" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Game 1" })).toBeTruthy());
  expect(view.queryByRole("link", { name: "Game 0" })).toBeNull();
});

test("a late response cannot replace a newer game filter", async () => {
  let resolveAll: (response: Response) => void = () => {};
  let calls = 0;
  globalThis.fetch = Object.assign(async () => {
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { resolveAll = resolve; });
    return Response.json({ items: [entry(1)], nextCursor: null });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<History />);
  await waitFor(() => expect(calls).toBe(1));
  fireEvent.click(view.getByRole("button", { name: "Werewolf" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Game 1" })).toBeTruthy());
  resolveAll(Response.json({ items: [entry(0)], nextCursor: null }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.queryByRole("link", { name: "Game 0" })).toBeNull();
  expect(view.getByRole("button", { name: "Werewolf" }).getAttribute("aria-pressed")).toBe("true");
});
