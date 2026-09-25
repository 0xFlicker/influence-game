import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import type { FreeQueueStatus, SavedAgent } from "../lib/api";
import { DashboardQueueEntry } from "../app/dashboard/dashboard-queue-entry";

const keys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"] as const;
const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
});
afterEach(() => {
  cleanup(); dom.close();
  for (const key of keys) { const descriptor = original.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
const status: FreeQueueStatus = { queuedCount: 2, nextGameAt: "2026-09-25T00:00:00Z", userEntry: null, todayGame: null };
const agent: SavedAgent = { id: "agent-1", name: "Arden", backstory: null, personality: "Patient", strategyStyle: null, personaKey: "strategic", avatarUrl: null, gamesPlayed: 0, gamesWon: 0, createdAt: "2026-09-24", updatedAt: "2026-09-24" };
const props = { status, agents: [agent], loading: false, error: null, onJoin: async () => {}, onRetry: () => {} };

test("entered state shows the saved agent without a picker or queue navigation", () => {
  const view = render(<DashboardQueueEntry {...props} status={{ ...status, userEntry: { agentProfileId: agent.id, agentName: agent.name, joinedAt: "2026-09-24" } }} />);
  expect(view.getByRole("status").textContent).toContain("Arden is entered.");
  expect(view.queryByRole("combobox")).toBeNull();
  expect(view.queryByRole("link")).toBeNull();
});

test("unknown state offers retry instead of enrollment", () => {
  let retries = 0;
  const view = render(<DashboardQueueEntry {...props} status={null} error="Queue unavailable" onRetry={() => retries++} />);
  expect(view.queryByRole("combobox")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Retry queue status" }));
  expect(retries).toBe(1);
});

test("requires a choice among agents and prevents duplicate submissions", async () => {
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const view = render(<DashboardQueueEntry {...props} agents={[agent, { ...agent, id: "agent-2", name: "Mira" }]} onJoin={async id => { calls.push(id); await release.promise; }} />);
  const button = view.getByRole("button", { name: "Enter queue" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(view.getByRole("combobox"), { target: { value: "agent-2" } });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(calls).toEqual(["agent-2"]);
  expect(button.disabled).toBe(true);
  await act(async () => release.resolve());
});

test("failed enrollment preserves selection and surfaces the error", async () => {
  const view = render(<DashboardQueueEntry {...props} onJoin={async () => { throw new Error("Agent is unavailable"); }} />);
  fireEvent.click(view.getByRole("button", { name: "Enter queue" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Agent is unavailable"));
  expect((view.getByRole("combobox") as HTMLSelectElement).value).toBe(agent.id);
});

test("zero agents routes into creation with enrollment continuation", () => {
  const view = render(<DashboardQueueEntry {...props} agents={[]} />);
  expect(view.getByRole("link").getAttribute("href")).toBe("/dashboard/agents/create?flow=daily_free");
});
