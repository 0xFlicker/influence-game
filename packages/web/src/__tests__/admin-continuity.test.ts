import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { QueryClient } from "@tanstack/react-query";
import { AdminSession, adminReadOptions, type Operation } from "../app/admin/admin-session";
import { ADMIN_ENTRIES, adminLanding, adminRoute, permitsAdminEntry } from "../app/admin/admin-sections";
import { apiFetch, setApiBase, storeAuthToken } from "../lib/api";
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let dom: Window;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.CustomEvent });
  setApiBase("");
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  dom.close();
  if (originalCustomEvent) Object.defineProperty(globalThis, "CustomEvent", originalCustomEvent); else Reflect.deleteProperty(globalThis, "CustomEvent");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage");
});
function respond(handler: (url: string, init?: RequestInit) => Promise<Response>) { globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
test("producer landing and route membership match endpoint grants, not admin role shortcuts", () => {
  const producer = { roles: ["producer"], permissions: [] };
  expect(adminLanding(producer)).toBe("/admin/werewolf");
  expect(ADMIN_ENTRIES.filter(entry => permitsAdminEntry(entry, producer)).map(entry => entry.href)).toEqual(["/admin/werewolf", "/admin/production"]);
  expect(adminLanding({ roles: ["admin"], permissions: [] })).toBe("/admin/inference");
  expect(permitsAdminEntry({access:"werewolf"}, {roles:["admin"],permissions:[]})).toBe(false);
  expect(adminRoute("/admin/games/g/visual")?.area).toBe("Production");
  expect(adminRoute("/admin/werewolf/g/production")?.area).toBe("Games");
  expect(permitsAdminEntry({ access: "roles" }, { roles: ["sysop"], permissions: [] })).toBe(false);
});
test("operation owner survives consumers, deduplicates pending dispatch, and retries exact unknown body", async () => {
  const session = new AdminSession("account-a:1"), pending = deferred<Response>(), sent: string[] = [];
  respond(async (_url, init) => { sent.push(String(init?.body)); return pending.promise; });
  const first = session.execute("operation:game:a", "/write", { requestId: "original", expectedVersion: 3 });
  expect(await session.execute("operation:game:a", "/write", { requestId: "other" })).toBeUndefined();
  pending.resolve(new Response("lost", { status: 503 })); await expect(first).rejects.toThrow();
  expect(session.get<Operation>("operation:game:a")?.phase).toBe("unknown");
  respond(async (_url, init) => { sent.push(String(init?.body)); return Response.json({ accepted: true }); });
  await session.execute("operation:game:a", "/different", { requestId: "new", expectedVersion: 10 });
  expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]);
  expect(session.get<Operation>("operation:game:a")?.phase).toBe("accepted");
});
test("finishing one operation cannot clear another; access loss and session disposal fence late writes", async () => {
  const session = new AdminSession("a"), one = deferred<Response>(), two = deferred<Response>();
  respond(async url => url === "/one" ? one.promise : two.promise);
  const a = session.execute("operation:game:one", "/one", {}), b = session.execute("operation:game:two", "/two", {});
  one.resolve(Response.json({ accepted: true })); await a;
  expect(session.pending("operation:game:")).toBe(true);
  session.clearMatching(key => key.startsWith("operation:"));
  two.resolve(Response.json({ accepted: true })); await b;
  expect(session.get("operation:game:two")).toBeUndefined();
  session.dispose(); session.set("private", "ignored"); expect(session.get("private")).toBeUndefined();
});
test("unknown reconciliation cannot be replayed as though it were idempotent", async () => {
  const session = new AdminSession("a"); let calls = 0;
  respond(async () => { calls++; return new Response("unknown", { status: 503 }); });
  await expect(session.execute("reconcile:a", "/reconcile", { note: "receipt", costMicrousd: 0 }, false)).rejects.toThrow();
  await expect(session.execute("reconcile:a", "/reconcile", {}, false)).rejects.toThrow("Check the saved receipt");
  expect(calls).toBe(1);
});
test("a denied production family does not deny Werewolf and fences a previously successful stale response", async () => {
  const session = new AdminSession("a"), client = new QueryClient(), delayed = deferred<Response>();
  respond(async url => url.endsWith("/slow") ? delayed.promise : new Response("denied", { status: 403 }));
  const slow = client.fetchQuery(adminReadOptions(session, "/api/admin/production/games/g/slow"));
  await expect(client.fetchQuery(adminReadOptions(session, "/api/admin/production/games/g/visual"))).rejects.toThrow();
  delayed.resolve(Response.json({ secret: true })); await expect(slow).rejects.toThrow("access changed");
  expect(session.get<boolean>("access-denied:/api/admin/production/games/g")).toBe(true);
  expect(session.get("access-denied:/api/admin/werewolf/g")).toBeUndefined(); client.clear();
});
test("an old session's 401 cannot expire a newer login; current session 401 still expires", async () => {
  const response = deferred<Response>(); let expired = 0;
  dom.addEventListener("auth:expired", () => expired++);
  storeAuthToken("old"); dom.localStorage.setItem("influence_auth_generation", "old-generation");
  respond(async () => response.promise);
  const old = apiFetch("/private");
  storeAuthToken("new"); dom.localStorage.setItem("influence_auth_generation", "new-generation");
  response.resolve(new Response("expired", { status: 401 })); await expect(old).rejects.toThrow(); expect(expired).toBe(0);
  respond(async () => new Response("expired", { status: 401 })); await expect(apiFetch("/private")).rejects.toThrow(); expect(expired).toBe(1);
});
