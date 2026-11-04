import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { ChampionshipAdminPanel } from "../app/admin/championship-admin-panel";
import { adminTestWrapper } from "./admin-test-wrapper";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { setApiBase } from "../lib/api";
import { SEASON_ZERO_CHAMPIONSHIP_POLICIES } from "@influence/engine/championship";
const originalFetch = globalThis.fetch;
const names = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "CustomEvent"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let dom: Window;
beforeEach(() => { dom = new Window({ url: "http://localhost" }); for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] }); setApiBase(""); });
afterEach(async () => { await act(async () => cleanup()); dom.close(); globalThis.fetch = originalFetch; for (const name of names) { const value = saved.get(name); if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const event = { id: "event", name: "Season 0 Championship", slug: "season-0", status: "draft", published: false, unresolvedPolicies: [], season: { id: "s0", name: "Season 0", status: "final" }, policies: SEASON_ZERO_CHAMPIONSHIP_POLICIES, startDate: null, matches: [], audit: [] };
function panel() { return render(<InfluenceAuthContext.Provider value={{ ready: true, authenticated: false, account: null } as InfluenceAuthState}><ChampionshipAdminPanel /></InfluenceAuthContext.Provider>, { wrapper: adminTestWrapper() }); }

test("refresh and successful actions keep the existing form, focus and unsaved date mounted", async () => {
  let delay = false, finish: (() => void) | undefined, reads = 0;
  globalThis.fetch = (async (url, init) => {
    if (String(url) === "/api/seasons") return Response.json({ seasons: [] });
    if (String(url) === "/api/admin/championships") return Response.json({ events: [event] });
    if (init?.method === "POST") return Response.json({});
    reads++; if (delay) await new Promise<void>(resolve => { finish = resolve; });
    return Response.json(event);
  }) as typeof fetch;
  const view = panel();
  await waitFor(() => expect(view.getByRole("option", { name: /Season 0 Championship/ })).toBeTruthy());
  fireEvent.change(view.getByLabelText("Event"), { target: { value: "event" } });
  const input = await view.findByLabelText("First Werewolf day (UTC)") as HTMLInputElement;
  input.focus(); fireEvent.input(input, { target: { value: "2026-12-01" } }); fireEvent.keyUp(input, { key: "1" });
  delay = true; fireEvent.click(view.getByText("Refresh event"));
  await waitFor(() => expect(reads).toBe(2));
  expect(view.getByLabelText("First Werewolf day (UTC)")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(view.queryByText("Loading event…")).toBeNull();
  await act(async () => { finish!(); });
  expect(input.value).toBe("2026-12-01");
  delay = false; fireEvent.click(view.getByText("Publish event"));
  await waitFor(() => expect(reads).toBe(3));
  expect(view.getByLabelText("First Werewolf day (UTC)")).toBe(input);
  expect(input.value).toBe("2026-12-01");
});

test("artwork polling updates rows in place without collapsing open controls", async () => {
  const realTimeout = globalThis.setTimeout;
  let poll: (() => void) | undefined, ready = false;
  globalThis.setTimeout = ((fn: () => void, delay?: number, ...args: unknown[]) => {
    if (delay === 5000) { poll = fn; return 0; }
    return realTimeout(fn, delay, ...args);
  }) as typeof setTimeout;
  globalThis.fetch = (async url => Response.json(String(url) === "/api/seasons" ? { seasons: [] } : String(url) === "/api/admin/championships" ? { events: [event] } : { ...event, status: "preparing", artwork: [{ id: "art", agentId: "agent", rank: 3, selected: true, status: ready ? "ready" : "retry", error: null }] })) as typeof fetch;
  try {
    const view = panel();
    await waitFor(() => expect(view.getByRole("option", { name: /Season 0 Championship/ })).toBeTruthy());
    fireEvent.change(view.getByLabelText("Event"), { target: { value: "event" } });
    await view.findByText("Championship artwork");
    const details = view.getByText("Event audit history").closest("details")!; details.open = true;
    const row = view.getByText("Season rank 3").closest("li")!;
    ready = true; await act(async () => { poll!(); });
    await waitFor(() => expect(row.textContent).toContain("ready"));
    expect(view.getByText("Season rank 3").closest("li")).toBe(row);
    expect(view.getByText("Event audit history").closest("details")).toBe(details);
    expect(details.open).toBe(true);
  } finally { globalThis.setTimeout = realTimeout; }
});
