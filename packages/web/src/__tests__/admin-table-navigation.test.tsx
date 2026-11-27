import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { AgentsAdminPanel } from "../app/admin/agents-admin-panel";
import { setApiBase, type AdminAgent } from "../lib/api";

const originals = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
  localStorage: globalThis.localStorage,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
};
let dom: HappyDOMWindow | null = null;

function setupDom() {
  dom = new HappyDOMWindow({ url: "http://localhost/admin/users" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: dom.Element });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.HTMLElement });
}

afterEach(async () => {
  await act(async () => { cleanup(); });
  globalThis.fetch = originals.fetch;
  setApiBase("");
  for (const name of ["window", "document", "navigator", "localStorage", "Element", "HTMLElement"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: originals[name] });
  }
  dom?.close();
  dom = null;
});

test("admin agents link profiles and toggle numeric sort", async () => {
  setupDom();
  const agents: AdminAgent[] = [
    { id: "older", userId: "u1", name: "Zed", publicProfileAvailable: true, backstory: null, personality: "", strategyStyle: null, personaKey: null, avatarUrl: null, gamesPlayed: 2, gamesWon: 1, ownerWallet: null, ownerDisplayName: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "newer", userId: "u2", name: "Amy", publicProfileAvailable: true, backstory: null, personality: "", strategyStyle: null, personaKey: null, avatarUrl: null, gamesPlayed: 5, gamesWon: 2, ownerWallet: null, ownerDisplayName: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
  ];
  globalThis.fetch = (async () => new Response(JSON.stringify(agents), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const mounted = render(<AgentsAdminPanel />);
  await waitFor(() => expect(mounted.getByRole("table")).not.toBeNull());
  const table = mounted.getByRole("table");
  expect(Array.from(table.querySelectorAll("tbody tr td:first-child a")).map((link) => link.getAttribute("href")))
    .toEqual(["/agents/newer", "/agents/older"]);
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Games ascending" }));
  expect(Array.from(table.querySelectorAll("tbody tr td:first-child a")).map((link) => link.textContent?.trim())).toEqual(["Zed", "Amy"]);
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Games descending" }));
  expect(Array.from(table.querySelectorAll("tbody tr td:first-child a")).map((link) => link.textContent?.trim())).toEqual(["Amy", "Zed"]);
});
