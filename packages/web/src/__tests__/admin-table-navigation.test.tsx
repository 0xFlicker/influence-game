import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { AgentsAdminPanel } from "../app/admin/agents-admin-panel";
import { UserRolesPanel, UsersTable } from "../app/admin/user-roles-panel";
import { setApiBase, type AdminAgent, type AdminUser } from "../lib/api";

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

function rowNames(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll("tbody tr")).map((row) => row.querySelector("td")?.textContent?.trim() ?? "");
}

test("admin users start newest first, toggle column sort, and link public profiles", () => {
  setupDom();
  const users: AdminUser[] = [
    { id: "older", publicProfileId: "public-older", walletAddress: "0x111", email: "z@example.test", displayName: "Zed", roles: [], permissions: [], createdAt: "2026-01-01T00:00:00Z" },
    { id: "newer", publicProfileId: "public-newer", walletAddress: null, email: "a@example.test", displayName: "Amy", roles: ["admin"], permissions: [], createdAt: "2026-11-01T00:00:00Z" },
  ];
  const mounted = render(<UsersTable users={users} onQuickAssign={() => undefined} />);
  const table = mounted.getByRole("table");
  expect(Array.from(table.querySelectorAll("tbody tr a")).map((link) => link.getAttribute("href")))
    .toEqual(["/profile/public-newer", "/profile/public-older"]);
  expect(rowNames(table)).toEqual(["—", "0x111"]);
  expect(within(table).getByRole("columnheader", { name: /Joined/ }).getAttribute("aria-sort")).toBe("descending");

  fireEvent.click(within(table).getByRole("button", { name: "Sort by Joined ascending" }));
  expect(rowNames(table)).toEqual(["0x111", "—"]);
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Display Name ascending" }));
  expect(Array.from(table.querySelectorAll("tbody tr a")).map((link) => link.textContent?.trim())).toEqual(["Amy", "Zed"]);
  fireEvent.click(within(table).getByRole("button", { name: "Sort by Display Name descending" }));
  expect(Array.from(table.querySelectorAll("tbody tr a")).map((link) => link.textContent?.trim())).toEqual(["Zed", "Amy"]);
});

test("admin agents link profiles and toggle numeric sort", async () => {
  setupDom();
  const agents: AdminAgent[] = [
    { id: "older", userId: "u1", name: "Zed", publicProfileAvailable: true, backstory: null, personality: "", strategyStyle: null, personaKey: null, avatarUrl: null, gamesPlayed: 2, gamesWon: 1, ownerWallet: null, ownerDisplayName: null, ownerEmail: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "newer", userId: "u2", name: "Amy", publicProfileAvailable: true, backstory: null, personality: "", strategyStyle: null, personaKey: null, avatarUrl: null, gamesPlayed: 5, gamesWon: 2, ownerWallet: null, ownerDisplayName: null, ownerEmail: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
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

test("role assignments link accounts and sort by role", async () => {
  setupDom();
  globalThis.fetch = (async (request: RequestInfo | URL) => {
    const path = String(request);
    const body = path.endsWith("/roles") ? []
      : path.endsWith("/user-roles") ? [
        { userId: "u1", roleId: "admin", roleName: "admin", grantedBy: "operator", grantedAt: "2026-01-01" },
        { userId: "u2", roleId: "gamer", roleName: "gamer", grantedBy: "operator", grantedAt: "2026-01-01" },
      ] : [
        { id: "u1", publicProfileId: "public-1", walletAddress: null, email: null, displayName: "Zed", roles: ["admin"], permissions: [], createdAt: "2026-01-01" },
        { id: "u2", publicProfileId: "public-2", walletAddress: null, email: null, displayName: "Amy", roles: ["gamer"], permissions: [], createdAt: "2026-11-01" },
      ];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const mounted = render(<UserRolesPanel />);
  await waitFor(() => expect(mounted.getAllByRole("table")).toHaveLength(2));
  const assignments = mounted.getAllByRole("table")[0]!;
  expect(Array.from(assignments.querySelectorAll("tbody tr td:first-child a")).map((link) => link.getAttribute("href")))
    .toEqual(["/profile/public-2", "/profile/public-1"]);
  fireEvent.click(within(assignments).getByRole("button", { name: "Sort by Roles ascending" }));
  expect(Array.from(assignments.querySelectorAll("tbody tr td:first-child a")).map((link) => link.textContent?.trim()))
    .toEqual(["Zed", "Amy"]);
});
