import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { GamesBrowser } from "../app/games/games-browser";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";

const saved = new Map(["window", "document", "navigator", "localStorage", "IntersectionObserver", "ResizeObserver"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
let dom: HappyDOMWindow;

afterEach(async () => {
  await act(async () => { cleanup(); });
  dom?.close();
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("overview limits finished cards, keeps live games and exposes complete filtered results and collection links", async () => {
  dom = new HappyDOMWindow({ url: "http://localhost/games" });
  for (const key of ["window", "document", "navigator", "localStorage"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  }
  class Observer { observe() {} disconnect() {} unobserve() {} }
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: Observer });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: Observer });
  const games = Array.from({ length: 12 }, (_, i) => ({
    id: `game-${i}`, slug: `game-${i}`, status: "completed", visibility: "public", trackType: "custom",
    playerCount: 8, alivePlayers: 0, currentPhase: "done", currentRound: 1, maxRounds: 10, modelLabel: "test",
    createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    episode: { title: `Episode ${i}`, description: "A game", cast: [], coverUrl: null },
  }));
  const live = { ...games[0], id: "live", slug: "live", status: "in_progress", episode: { ...games[0]!.episode, title: "Live game" } };
  const waiting = { ...games[0], id: "waiting", slug: "waiting", status: "waiting", episode: { ...games[0]!.episode, title: "Open game" } };
  const season = { id: "season-1", slug: "season-one", name: "Season One", status: "active" };
  const seasonGames = games.map((game, i) => ({ ...game, id: `season-${i}`, slug: `season-${i}`, season, episode: { ...game.episode, title: `Season episode ${i}` } }));
  const wolves = games.map((game, i) => ({ ...game, id: `wolf-${i}`, slug: `wolf-${i}`, gameKind: "werewolf", joinedPlayers: 8, episode: { ...game.episode, title: `Wolf episode ${i}` } }));
  globalThis.fetch = (async input => Response.json(String(input).endsWith("/api/games") ? [waiting, live, ...games, ...seasonGames]
    : String(input).endsWith("/api/werewolf") ? wolves : { schemaVersion: 1, seasons: [season] })) as typeof fetch;
  const auth = { ready: true, authenticated: false, account: null, hydrationError: false } as InfluenceAuthState;
  const view = render(<InfluenceAuthContext.Provider value={auth}><GamesBrowser includeWerewolf /></InfluenceAuthContext.Provider>);
  const influence = await view.findByRole("region", { name: "Influence" });
  expect(within(influence).getAllByTestId("episode-card")).toHaveLength(9);
  expect(within(influence).getByText("Live game")).toBeTruthy();
  expect(view.getByRole("region", { name: "Open" })).toBeTruthy();
  expect(within(influence).getByRole("link", { name: "View all" }).getAttribute("href")).toBe("/games/type/influence");
  expect(within(influence).queryByText("Episode 0")).toBeNull();
  const seasonShelf = view.getByRole("region", { name: "Active season" });
  expect(within(seasonShelf).getAllByTestId("episode-card")).toHaveLength(8);
  expect(within(seasonShelf).getByRole("link", { name: "View all" }).getAttribute("href")).toBe("/games/season/season-one");
  const wolfShelf = view.getByRole("region", { name: "Werewolf" });
  expect(within(wolfShelf).getAllByTestId("episode-card")).toHaveLength(8);
  expect(within(wolfShelf).getByRole("link", { name: "View all" }).getAttribute("href")).toBe("/games/type/werewolf");
  fireEvent.change(view.getByLabelText("Game status"), { target: { value: "completed" } });
  await waitFor(() => expect(view.getByText("Episode 0")).toBeTruthy());
  expect(view.getAllByTestId("episode-card")).toHaveLength(36);
});
