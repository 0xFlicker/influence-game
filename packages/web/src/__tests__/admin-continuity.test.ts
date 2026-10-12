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
  expect(adminRoute("/admin/production/games/g")?.area).toBe("Production");
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
test("PATCH operations retain their exact method, body, URL and denial resource after an unknown response", async () => {
  const session = new AdminSession("a"), sent: { method?: string; url: string; body: string }[] = [];
  const resource = "/api/admin/games/g/episode", key = `operation:${resource}:save`;
  respond(async (url, init) => { sent.push({ method: init?.method, url, body: String(init?.body) }); return new Response("lost", { status: 503 }); });
  await expect(session.execute(key, resource, { title: "Frozen", revision: 2 }, false, { method: "PATCH", accessResource: resource })).rejects.toThrow();
  expect(session.get<Operation>(key)).toMatchObject({ phase: "unknown", method: "PATCH", accessResource: resource });
  await expect(session.execute(key, resource, { title: "Changed" }, false)).rejects.toThrow("Check the saved receipt");
  expect(sent).toHaveLength(1);
  respond(async (url, init) => { sent.push({ method: init?.method, url, body: String(init?.body) }); return Response.json({ saved: true }); });
  await session.execute(key, "/different", { title: "Other" }, true, { method: "POST", accessResource: "/other" });
  expect(sent[1]).toEqual(sent[0]);
  expect(session.get<Operation>(key)).toMatchObject({ phase: "accepted", method: "PATCH", accessResource: resource });
});
test("a denied global naming POST clears its owning episode draft and fences late reads", async () => {
  const session = new AdminSession("a"), delayed = deferred<Response>(), resource = "/api/admin/games/g/episode";
  session.set(`draft:${resource}`, { title: "Private draft" });
  session.set(`ui:${resource}:notice`, "Pending");
  respond(async url => url === resource ? delayed.promise : new Response("denied", { status: 403 }));
  const read = session.read(resource);
  await expect(session.execute(`operation:${resource}:naming`, "/api/admin/episodes/backfill", { gameIds: ["g"] }, false,
    { accessResource: resource })).rejects.toThrow();
  expect(session.get(`draft:${resource}`)).toBeUndefined();
  expect(session.get(`operation:${resource}:naming`)).toBeUndefined();
  expect(session.get(`ui:${resource}:notice`)).toBeUndefined();
  expect(session.get<boolean>(`access-denied:${resource}`)).toBe(true);
  delayed.resolve(Response.json({ secret: true })); await expect(read).rejects.toThrow("access changed");
});
test("library filters share one denial fence for a session-owned naming batch", async () => {
  const session = new AdminSession("a"), resource = "/api/admin/production/library", delayed = deferred<Response>();
  session.set(`draft:${resource}:selected`, ["g"]);
  respond(async url => url.endsWith("?kind=werewolf") ? delayed.promise : new Response("denied", { status: 403 }));
  const read = session.read(`${resource}?kind=werewolf`);
  await expect(session.execute(`operation:${resource}:naming`, "/api/admin/episodes/backfill", { gameIds: ["g"] }, false,
    { accessResource: resource })).rejects.toThrow();
  expect(session.get(`draft:${resource}:selected`)).toBeUndefined();
  expect(session.get(`operation:${resource}:naming`)).toBeUndefined();
  delayed.resolve(Response.json({ items: ["secret"] })); await expect(read).rejects.toThrow("access changed");
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
test("role revocation invalidates private source, evidence and media reads while retaining discovery and legacy reads", async () => {
  const session = new AdminSession("a"), pending = deferred<boolean>();
  const root = "/api/admin/production/games/g";
  respond(async () => {await pending.promise; return Response.json({ metadata: true });});
  const privateReads = [session.read(`${root}/source?audience=omniscient`), session.read(`${root}/visual/evidence/attempt/a`),
    session.readMedia(`${root}/source/media/a`)];
  const retained = [session.read(root), session.read("/api/admin/production/library?kind=werewolf"),
    session.read("/api/admin/games/g/visual"), session.read("/api/admin/games/g/episode")];
  session.invalidateReadsMatching(url => url.startsWith("/api/admin/production/")
    && url.split("?")[0] !== root && url.split("?")[0] !== "/api/admin/production/library");
  const rejected = privateReads.map(read => read.then(() => null, error => error));
  pending.resolve(true);
  for (const error of await Promise.all(rejected)) expect(error).toMatchObject({message:"Administration access changed; refresh to retry"});
  for (const read of retained) expect(await read).toEqual({ metadata: true });
  expect(session.get<boolean>(`access-denied:${root}`)).toBe(false);
  const denied = deferred<Response>(); respond(async () => denied.promise);
  const staleDenial = session.read(`${root}/visual/evidence/attempt/old`);
  session.invalidateReadsMatching(url => url.includes("/evidence/"));
  denied.resolve(new Response("Producer removed", { status: 403 }));
  await expect(staleDenial).rejects.toThrow("access changed");
  expect(session.get<boolean>(`access-denied:${root}`)).toBe(false);
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
test("reactivating a disposed session cannot restore an older private read", async () => {
  const session = new AdminSession("a"), response = deferred<Response>();
  respond(async () => response.promise);
  const read = session.read("/api/admin/production/games/g/source");
  session.dispose(); session.activate();
  response.resolve(Response.json({ secret: true }));
  await expect(read).rejects.toThrow("access changed");
});
