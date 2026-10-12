import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { fileURLToPath } from "node:url";
import { setApiBase } from "../lib/api";
import { adminTestWrapper } from "./admin-test-wrapper";

const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase("");
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

test("shared library naming preserves drafts, queues exact reviewed IDs and reconciles unknown outcomes before retry", async () => {
  // Isolate Next navigation mocks from other web suites using the real provider.
  if (process.env.HOUSE_EPISODE_UI_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, HOUSE_EPISODE_UI_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" }); return;
  }
  mock.module("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {} }) }));
  const { ProductionLibrary } = await import("../app/admin/production/production-library");
  const writes: Array<{ gameIds: string[]; regenerate: boolean; preview: boolean }> = [];
  let outcome: "success" | "unknown" | "denied" = "success", failEpisodeRead = false;
  const game = (id: string, gameKind: "influence" | "werewolf", episodeEdit: boolean) => ({
    id, slug: `${id}-slug`, gameKind, status: "completed", hidden: false, playerCount: 6, title: null, needsAttention: false,
    capabilities: { episodeEdit },
  });
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (!body.preview && outcome === "unknown") return new Response("Naming response lost", { status: 503 });
      if (!body.preview && outcome === "denied") return new Response("Naming permission removed", { status: 403 });
      return Response.json({ gameIds: ["wolf"], calls: 1, skipped: body.preview ? 1 : 0, queued: !body.preview });
    }
    if (String(input).endsWith("/episode")) return failEpisodeRead ? new Response("Episode read unavailable", { status: 503 })
      : Response.json({ episode: { revision: 1, status: "ready" } });
    return Response.json({ items: [game("influence", "influence", true), game("wolf", "werewolf", true), game("readonly", "werewolf", false)], nextCursor: null, skippedInvalidPauses: 0 });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<ProductionLibrary />, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByRole("checkbox", { name: "Select wolf-slug" })).toBeTruthy());
  expect(view.queryByRole("checkbox", { name: "Select readonly-slug" })).toBeNull(); expect(writes).toHaveLength(0);
  fireEvent.click(view.getByRole("checkbox", { name: "Select influence-slug" }));
  fireEvent.click(view.getByRole("checkbox", { name: "Select wolf-slug" }));
  fireEvent.click(view.getByRole("button", { name: "Review naming batch" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Queue 1 naming requests" })).toBeTruthy());
  expect(writes).toEqual([{ gameIds: ["influence", "wolf"], regenerate: false, preview: true }]);
  fireEvent.click(view.getByRole("button", { name: "Queue 1 naming requests" }));
  await waitFor(() => expect(view.getByText("1 naming requests queued; 0 skipped because their state changed.")).toBeTruthy());
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual({ gameIds: ["wolf"], regenerate: false, preview: false });
  fireEvent.click(view.getByRole("checkbox", { name: "Select wolf-slug" }));
  fireEvent.click(view.getByRole("button", { name: "Review naming batch" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Queue 1 naming requests" })).toBeTruthy());
  outcome = "unknown"; fireEvent.click(view.getByRole("button", { name: "Queue 1 naming requests" }));
  await waitFor(() => expect(view.getByText("Check saved naming batch")).toBeTruthy());
  view.rerender(<p>Other page</p>); view.rerender(<ProductionLibrary />);
  expect((view.getByRole("checkbox", { name: "Select wolf-slug" }) as HTMLInputElement).checked).toBe(true);
  expect((view.getByRole("button", { name: "Queue 1 naming requests" }) as HTMLButtonElement).disabled).toBe(true);
  failEpisodeRead = true; fireEvent.click(view.getByText("Check saved naming batch"));
  await waitFor(() => expect(view.getByText("Episode read unavailable")).toBeTruthy());
  expect(view.getByText("Check saved naming batch")).toBeTruthy(); expect(writes).toHaveLength(4);
  failEpisodeRead = false; fireEvent.click(view.getByText("Check saved naming batch"));
  await waitFor(() => expect(view.getByText(/No naming state change is visible/)).toBeTruthy());
  expect(writes).toHaveLength(4); expect((view.getByRole("button", { name: "Queue 1 naming requests" }) as HTMLButtonElement).disabled).toBe(false);
  outcome = "success"; fireEvent.click(view.getByRole("button", { name: "Queue 1 naming requests" }));
  await waitFor(() => expect(writes).toHaveLength(5)); expect(writes[4]).toEqual({ gameIds: ["wolf"], regenerate: false, preview: false });
  await waitFor(() => expect(view.queryByRole("button", { name: "Queue 1 naming requests" })).toBeNull());
  fireEvent.click(view.getByRole("checkbox", { name: "Select wolf-slug" }));
  fireEvent.click(view.getByRole("button", { name: "Review naming batch" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Queue 1 naming requests" })).toBeTruthy());
  outcome = "denied"; fireEvent.click(view.getByRole("button", { name: "Queue 1 naming requests" }));
  await waitFor(() => expect(view.queryByRole("checkbox", { name: "Select wolf-slug" })).toBeNull());
  view.rerender(<p>Other page</p>); view.rerender(<ProductionLibrary />);
  expect(view.queryByRole("checkbox", { name: "Select wolf-slug" })).toBeNull();
  expect(view.queryByRole("button", { name: "Queue 1 naming requests" })).toBeNull();
}, 15_000);
