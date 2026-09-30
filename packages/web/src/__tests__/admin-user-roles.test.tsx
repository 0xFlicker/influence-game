import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { UserRolesPanel } from "../app/admin/user-roles-panel";
import { setApiBase } from "../lib/api";

const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, localStorage: globalThis.localStorage };
let dom: HappyDOMWindow | null = null;
afterEach(async () => {
  await act(async () => { cleanup(); });
  globalThis.fetch = originals.fetch; setApiBase("");
  for (const name of ["window", "document", "navigator", "localStorage"] as const) Object.defineProperty(globalThis, name, { configurable: true, value: originals[name] });
  dom?.close(); dom = null;
});

test("assigns and revokes an existing role for a walletless account by account ID", async () => {
  dom = new HappyDOMWindow({ url: "http://localhost/admin" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
  let assigned = false;
  const mutations: Array<{ method: string; body: unknown }> = [];
  globalThis.fetch = (async (request, init) => {
    const path = String(request), method = init?.method ?? "GET";
    if (method !== "GET") { mutations.push({ method, body: JSON.parse(String(init?.body)) }); assigned = method === "POST"; }
    const body = path.endsWith("/roles") ? [{ id: "gamer-id", name: "gamer", permissions: ["create_game", "fill_game", "start_game"] }]
      : path.endsWith("/users") ? [
        { id: "walletless-id", walletAddress: null, email: "email@example.test", displayName: "Email account", roles: assigned ? ["gamer"] : [], createdAt: "2026-09-30" },
        { id: "scheduler-id", walletAddress: "0x0000000000000000000000000000000000000000", email: null, displayName: "Scheduler", roles: [], createdAt: "2026-09-30" },
      ] : method === "GET" ? (assigned ? [{ userId: "walletless-id", roleId: "gamer-id", roleName: "gamer", grantedBy: "sysop-id", grantedAt: "2026-09-30" }] : []) : {};
    return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const mounted = render(<UserRolesPanel />);
  await waitFor(() => expect(mounted.queryAllByText("+ Assign role")).toHaveLength(1));
  fireEvent.click(mounted.getByText("+ Assign role"));
  await waitFor(() => expect((mounted.getByLabelText("Account") as HTMLSelectElement).value).toBe("walletless-id"));
  expect(mounted.getByLabelText("Account").textContent).not.toContain("Scheduler");
  fireEvent.change(mounted.getByLabelText("Role"), { target: { value: "gamer-id" } });
  fireEvent.click(mounted.getByRole("button", { name: "Assign Role" }));
  await waitFor(() => expect(mutations).toEqual([{ method: "POST", body: { userId: "walletless-id", roleId: "gamer-id" } }]));
  await waitFor(() => expect(mounted.queryByText("Revoke gamer")).not.toBeNull());
  fireEvent.click(mounted.getByText("Revoke gamer"));
  await waitFor(() => expect(mutations[1]).toEqual({ method: "DELETE", body: { userId: "walletless-id", roleId: "gamer-id" } }));
});
