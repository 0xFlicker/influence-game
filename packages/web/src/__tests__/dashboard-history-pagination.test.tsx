import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { Window } from "happy-dom";
import type { HouseParticipation } from "@influence/engine/house-participation";
import { DashboardHistory } from "../app/dashboard/dashboard-history";

const globals = ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const;
const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let tab: Window;

beforeEach(() => {
  tab = new Window({ url: "http://localhost/dashboard" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: tab[key] });
});
afterEach(() => {
  cleanup();
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

test("history shows at most three entries and navigates all pages", () => {
  const view = render(<DashboardHistory entries={Array.from({ length: 8 }, (_, index) => entry(index))} loading={false} error={null} />);
  expect(view.getAllByRole("listitem")).toHaveLength(3);
  expect(view.getByRole("link", { name: "Game 0" })).toBeTruthy();
  expect(view.queryByRole("link", { name: "Game 3" })).toBeNull();
  const pages = within(view.getByRole("navigation", { name: "Game history pages" }));
  expect(pages.getByText("Page 1 of 3")).toBeTruthy();
  expect((pages.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(pages.getByRole("button", { name: "Next" }));
  expect(view.getByRole("link", { name: "Game 3" })).toBeTruthy();
  expect(view.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(pages.getByRole("button", { name: "Next" }));
  expect(pages.getByText("Page 3 of 3")).toBeTruthy();
  expect(view.getAllByRole("listitem")).toHaveLength(2);
  expect((pages.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(pages.getByRole("button", { name: "Previous" }));
  expect(pages.getByText("Page 2 of 3")).toBeTruthy();
});

test("filter changes restart at page one and shrinking history stays in bounds", () => {
  const entries = Array.from({ length: 12 }, (_, index) => entry(index));
  const view = render(<DashboardHistory entries={entries} loading={false} error={null} />);
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.click(view.getByRole("button", { name: "Influence" }));
  expect(view.getByRole("link", { name: "Game 0" })).toBeTruthy();
  expect(view.queryByRole("link", { name: "Game 1" })).toBeNull();
  expect(view.getByText("Page 1 of 2")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  expect(view.getByRole("link", { name: "Game 6" })).toBeTruthy();
  view.rerender(<DashboardHistory entries={entries.slice(0, 3)} loading={false} error={null} />);
  expect(view.getAllByRole("listitem")).toHaveLength(2);
  expect(view.getByRole("link", { name: "Game 0" })).toBeTruthy();
  expect(view.queryByRole("navigation", { name: "Game history pages" })).toBeNull();
});
