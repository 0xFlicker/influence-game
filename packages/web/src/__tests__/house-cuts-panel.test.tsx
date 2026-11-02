import { expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";

test("Studio Cuts backfills, retries exact unknown requests, and refreshes status", async () => {
  if (process.env.HOUSE_CUTS_PANEL_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], { env: { ...process.env, HOUSE_CUTS_PANEL_TEST: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" }); return;
  }
  const dom = new Window({ url: "http://localhost" });
  const keys = ["window", "document", "navigator", "localStorage", "Element", "HTMLElement", "Node", "Event"] as const;
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  const { setApiBase } = await import("../lib/api"); setApiBase("");
  const originalFetch = globalThis.fetch;
  let status = "missing", action: string | null = "backfill", failRecovery = true;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      requests.push({ url: String(input), body: JSON.parse(String(init.body)) });
      if (String(input).endsWith("/recover") && failRecovery) { failRecovery = false; throw new Error("Response lost"); }
      status = "queued"; action = null;
      return Response.json({ id: "job", status });
    }
    return Response.json([{ audience: "public", status, action, budgetUsd: 1, spentUsd: .1, expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }]);
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const { AdminSessionProvider } = await import("../app/admin/admin-session");
  const { HouseCutsPanel } = await import("../app/admin/production/house-cuts-panel");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const view = render(<QueryClientProvider client={client}><AdminSessionProvider scope="test"><HouseCutsPanel gameId="game" slug="slug" /></AdminSessionProvider></QueryClientProvider>);
    fireEvent.click(await view.findByRole("button", { name: "Generate missing Cuts" }));
    await view.findByText("Queued");
    expect(requests[0]).toEqual({ url: "/api/games/game/cuts/backfill", body: { audience: "public" } });
    status = "failed"; action = "recover";
    await client.invalidateQueries();
    fireEvent.click(await view.findByRole("button", { name: "Retry failed Cuts" }));
    fireEvent.click(await view.findByRole("button", { name: "Retry pending request" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[1]).toEqual(requests[2]);
    expect(requests[1]!.body.expectedUpdatedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(typeof requests[1]!.body.idempotencyKey).toBe("string");
    await view.findByText("Queued");
    status = "ready"; action = null;
    await client.invalidateQueries();
    expect((await view.findByRole("link", { name: "View Cuts" })).getAttribute("href")).toBe("/games/slug/highlights?audience=public");
    expect(view.queryByRole("button", { name: "Generate missing Cuts" })).toBeNull();
  } finally {
    cleanup(); client.clear(); globalThis.fetch = originalFetch;
    for (const key of keys) { const value = saved.get(key); if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
    await dom.happyDOM.close();
  }
});
