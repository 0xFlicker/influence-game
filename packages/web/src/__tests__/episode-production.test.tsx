import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { fileURLToPath } from "node:url";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { setApiBase } from "../lib/api";

const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase("");
});
afterEach(() => {
  cleanup(); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

test("Werewolf is selectable for explicit naming preview and queue in shared Production", async () => {
  // Other web suites replace use-permissions globally. Run this real-context test
  // in its own process so their module mocks cannot change the authorization UI.
  if (process.env.HOUSE_EPISODE_UI_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, HOUSE_EPISODE_UI_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { ProductionPanel } = await import("../app/admin/production-panel");
  const writes: Array<{ gameIds: string[]; regenerate: boolean; preview: boolean }> = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ gameIds: body.gameIds, calls: 1, skipped: 0, queued: !body.preview });
    }
    if (url.endsWith("/api/admin/games")) return Response.json([]);
    return Response.json([{ id: "wolf", slug: "hazy-ruby-sand", gameKind: "werewolf", status: "completed", hidden: false, playerCount: 6, modelLabel: "gpt-6-luna", completionSettlement: { state: "settled" } }]);
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const auth = { ready: true, authenticated: true, account: { isAdmin: true, roles: ["sysop"], permissions: ["manage_postgame_media"] }, hydrationError: false } as InfluenceAuthState;
  const view = render(<InfluenceAuthContext.Provider value={auth}><ProductionPanel /></InfluenceAuthContext.Provider>);
  await waitFor(() => expect(view.getByRole("button", { name: "Edit episode" })).toBeTruthy());
  expect(writes).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Select all 1 matching" }));
  fireEvent.click(view.getByRole("button", { name: "Review 1 selected" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Queue 1 episodes" })).toBeTruthy());
  expect(writes).toEqual([{ gameIds: ["wolf"], regenerate: false, preview: true }]);
  fireEvent.click(view.getByRole("button", { name: "Queue 1 episodes" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual({ gameIds: ["wolf"], regenerate: false, preview: false });
});
