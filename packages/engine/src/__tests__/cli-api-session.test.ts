import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliApiSession, type CliApiSessionOptions } from "../cli-api-session";
import { parseCliSessionRequest, type CliSessionRequest } from "../cli-session-contract";

const originalFetch = globalThis.fetch;
const webOrigin = "http://localhost:3001";
let directory: string;
let savedOverride: string | undefined;
const servers: ReturnType<typeof Bun.serve>[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "house-cli-session-"));
  savedOverride = process.env.INFLUENCE_API_SESSION_TOKEN;
  delete process.env.INFLUENCE_API_SESSION_TOKEN;
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (savedOverride === undefined) delete process.env.INFLUENCE_API_SESSION_TOKEN;
  else process.env.INFLUENCE_API_SESSION_TOKEN = savedOverride;
  for (const server of servers.splice(0)) server.stop(true);
  await rm(directory, { recursive: true, force: true });
});

function token(seconds = 3_600): string {
  return `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + seconds })).toString("base64url")}.signature`;
}

function api(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return server;
}

function options(apiOrigin: string, overrides: Partial<CliApiSessionOptions> = {}): CliApiSessionOptions {
  return { apiOrigin, webOrigin, cacheDirectory: directory, requiredRoles: ["producer", "sysop"], log: () => {},
    openBrowser: async () => { throw new Error("Unexpected browser login"); }, ...overrides };
}

function sessionResponse(roles = ["producer"], permissions = ["create_game", "start_game"]) {
  return Response.json({ roles, permissions });
}

function cachePath(apiOrigin: string): string {
  return join(directory, `${createHash("sha256").update(apiOrigin).digest("hex")}.json`);
}

async function cache(apiOrigin: string, credential: string, changes: Record<string, unknown> = {}) {
  const payload = JSON.parse(Buffer.from(credential.split(".")[1]!, "base64url").toString()) as { exp: number };
  await writeFile(cachePath(apiOrigin), JSON.stringify({ schema: "house.cli-api-session", version: 1,
    apiOrigin, webOrigin, token: credential, expiresAt: new Date(payload.exp * 1_000).toISOString(), ...changes }), { mode: 0o600 });
}

function handoffRequest(url: string): CliSessionRequest {
  const parsed = new URL(url);
  expect(parsed.origin).toBe(webOrigin);
  expect(parsed.pathname).toBe("/auth/cli");
  expect(parsed.searchParams.has("token")).toBe(false);
  return parseCliSessionRequest(Object.fromEntries(parsed.searchParams));
}

async function post(request: CliSessionRequest, credential: string, changes: Record<string, unknown> = {}) {
  return fetch(request.callbackUrl, { method: "POST", headers: { Origin: webOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ state: request.state, apiOrigin: request.apiOrigin, token: credential, ...changes }) });
}

function assertPortReleased(callbackUrl: string) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(new URL(callbackUrl).port), fetch: () => new Response("freed") });
  server.stop(true);
}

describe("ordinary API session CLI login", () => {
  test("headless overrides never fetch, persist or open a browser", async () => {
    const server = api(() => { throw new Error("Unexpected request"); });
    process.env.INFLUENCE_API_SESSION_TOKEN = "env-override";
    expect(await resolveCliApiSession(options(server.url.origin))).toBe("env-override");
    expect(await resolveCliApiSession(options(server.url.origin, { token: "explicit-override" }))).toBe("explicit-override");
    await expect(resolveCliApiSession(options(server.url.origin, { token: "" }))).rejects.toThrow("must not be empty");
    expect(await readdir(directory)).toEqual([]);
  });

  test("cached sessions revalidate current OR roles and every required permission", async () => {
    const credential = token();
    let requests = 0;
    const server = api(request => {
      requests++;
      expect(new URL(request.url).pathname).toBe("/api/auth/me");
      expect(request.headers.get("authorization")).toBe(`Bearer ${credential}`);
      return sessionResponse(["sysop"]);
    });
    await cache(server.url.origin, credential);
    const config = options(server.url.origin, { requiredPermissions: ["create_game", "start_game"] });
    expect(await resolveCliApiSession(config)).toBe(credential);
    expect(await resolveCliApiSession(config)).toBe(credential);
    expect(requests).toBe(2);
  });

  test("missing and expired caches receive, validate and atomically cache browser sessions", async () => {
    for (const expired of [false, true]) {
      const credential = token();
      let requests = 0, callback = "";
      const server = api(request => { requests++; expect(request.headers.get("authorization")).toBe(`Bearer ${credential}`); return sessionResponse(["sysop"]); });
      if (expired) await cache(server.url.origin, token(-1));
      const logs: string[] = [];
      const result = await resolveCliApiSession(options(server.url.origin, { log: message => logs.push(message), openBrowser: async url => {
        const request = handoffRequest(url); callback = request.callbackUrl;
        const response = await post(request, credential);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
      } }));
      expect(result).toBe(credential);
      expect(requests).toBe(1);
      const saved = JSON.parse(await readFile(cachePath(server.url.origin), "utf8"));
      expect(saved).toMatchObject({ apiOrigin: server.url.origin, webOrigin, token: credential });
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(cachePath(server.url.origin))).mode & 0o777).toBe(0o600);
      expect((await readdir(directory)).every(file => file.endsWith(".json"))).toBe(true);
      expect(logs.join("\n")).not.toContain(credential);
      assertPortReleased(callback);
    }
  });

  test("only a rejected cached credential starts one new browser handoff", async () => {
    const old = token(), fresh = token(7_200);
    let launches = 0, calls = 0;
    const server = api(request => { calls++; return request.headers.get("authorization") === `Bearer ${old}`
      ? new Response(null, { status: 401 }) : sessionResponse(); });
    await cache(server.url.origin, old);
    expect(await resolveCliApiSession(options(server.url.origin, { openBrowser: async url => { launches++; await post(handoffRequest(url), fresh); } }))).toBe(fresh);
    expect(calls).toBe(2); expect(launches).toBe(1);
  });

  test("forbidden, removed roles/permissions and server failures do not launch login", async () => {
    for (const [response, message] of [
      [new Response(null, { status: 403 }), "validation failed (403)"],
      [new Response(null, { status: 503 }), "validation failed (503)"],
      [sessionResponse(["gamer"]), "requires one of these roles"],
      [sessionResponse(["producer"], []), "missing permissions"],
      [Response.json({ roles: "producer", permissions: [] }), "invalid session roles"],
    ] as const) {
      const server = api(() => response);
      await cache(server.url.origin, token());
      await expect(resolveCliApiSession(options(server.url.origin, { requiredPermissions: ["start_game"] }))).rejects.toThrow(message);
    }
  });

  test("network and redirect failures fail without sending the token elsewhere", async () => {
    let leaked = false;
    const destination = api(() => { leaked = true; return sessionResponse(); });
    const server = api(() => Response.redirect(destination.url.toString(), 302));
    await cache(server.url.origin, token());
    await expect(resolveCliApiSession(options(server.url.origin))).rejects.toThrow("Could not validate CLI session");
    expect(leaked).toBe(false);
    server.stop(true);
    await expect(resolveCliApiSession(options(server.url.origin))).rejects.toThrow("Could not validate CLI session");
  });

  test("cache bindings, expiry and private modes are enforced before network use", async () => {
    const server = api(() => { throw new Error("Unexpected request"); });
    for (const changes of [{ apiOrigin: "https://other.example" }, { webOrigin: "http://other.example" }, { expiresAt: new Date(0).toISOString() }, { extra: true }]) {
      await cache(server.url.origin, token(), changes);
      await expect(resolveCliApiSession(options(server.url.origin))).rejects.toThrow("cache");
    }
    await cache(server.url.origin, token());
    await chmod(cachePath(server.url.origin), 0o644);
    await expect(resolveCliApiSession(options(server.url.origin))).rejects.toThrow("private directory");
    await chmod(cachePath(server.url.origin), 0o600);
    await chmod(directory, 0o755);
    await expect(resolveCliApiSession(options(server.url.origin))).rejects.toThrow("private directory");
  });

  test("a legitimate web-origin change reuses the API-bound session after fresh validation", async () => {
    const credential = token(), server = api(() => sessionResponse());
    await cache(server.url.origin, credential, { webOrigin: "https://previous-web.house.example" });
    expect(await resolveCliApiSession(options(server.url.origin))).toBe(credential);
  });

  test("callback rejects wrong origins, hosts, target, state, body and content type", async () => {
    const credential = token();
    let validations = 0;
    const server = api(() => { validations++; return sessionResponse(); });
    expect(await resolveCliApiSession(options(server.url.origin, { openBrowser: async url => {
      const request = handoffRequest(url);
      const preflight = await fetch(request.callbackUrl, { method: "OPTIONS", headers: { Origin: webOrigin,
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type", "Access-Control-Request-Private-Network": "true" } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(webOrigin);
      expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
      expect((await fetch(request.callbackUrl, { method: "POST", headers: { Origin: "https://other.example" } })).status).toBe(403);
      expect((await fetch(`${request.callbackUrl}?token=bad`, { headers: { Origin: webOrigin } })).status).toBe(400);
      expect((await fetch(request.callbackUrl, { headers: { Origin: webOrigin, Host: "localhost:1234" } })).status).toBe(400);
      expect((await fetch(request.callbackUrl, { method: "POST", headers: { Origin: webOrigin, "Content-Type": "text/plain" }, body: "secret" })).status).toBe(400);
      for (const change of [{ state: "W".repeat(43) }, { apiOrigin: "https://other.example" }, { extra: true }, { token: "x".repeat(16_385) }]) {
        expect((await post(request, credential, change)).status).toBe(400);
      }
      expect([400, 413]).toContain((await post(request, credential, { token: "x".repeat(40_000) })).status);
      expect(validations).toBe(0);
      expect((await post(request, credential)).status).toBe(200);
    } }))).toBe(credential);
    expect(validations).toBe(1);
  });

  test("browser credentials must be unexpired and accepted by the exact API", async () => {
    for (const [credential, status, error] of [[token(-1), 200, "has expired"], [token(), 401, "not accepted"], [token(), 403, "validation failed (403)"]] as const) {
      const server = api(() => new Response(null, { status }));
      let callback = "";
      await expect(resolveCliApiSession(options(server.url.origin, { openBrowser: async url => {
        const request = handoffRequest(url); callback = request.callbackUrl;
        expect((await post(request, credential)).status).toBe(403);
      } }))).rejects.toThrow(error);
      expect(await readdir(directory)).not.toContain(cachePath(server.url.origin).split("/").at(-1)!);
      assertPortReleased(callback);
    }
  });

  test("abort, browser-launch failure and bounded timeout always release the callback port", async () => {
    const server = api(() => sessionResponse());
    const controller = new AbortController();
    let callback = "";
    await expect(resolveCliApiSession(options(server.url.origin, { signal: controller.signal, openBrowser: async url => {
      callback = handoffRequest(url).callbackUrl; controller.abort(new Error("operator cancelled"));
    } }))).rejects.toThrow("operator cancelled");
    assertPortReleased(callback);
    await expect(resolveCliApiSession(options(server.url.origin, { openBrowser: async url => {
      callback = handoffRequest(url).callbackUrl; throw new Error("test launch failed");
    } }))).rejects.toThrow("test launch failed");
    assertPortReleased(callback);

    const originalTimeout = globalThis.setTimeout;
    const fastTimeout = Object.assign((...[handler, delay, ...args]: Parameters<typeof setTimeout>) =>
      originalTimeout(handler, delay === 300_000 ? 5 : delay, ...args), { __promisify__: originalTimeout.__promisify__ });
    const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(fastTimeout);
    try {
      await expect(resolveCliApiSession(options(server.url.origin, { openBrowser: async url => { callback = handoffRequest(url).callbackUrl; } }))).rejects.toThrow("Timed out");
      assertPortReleased(callback);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test("cancelling a handoff aborts an in-flight API validation and leaves no cache", async () => {
    const server = api(() => { throw new Error("Validation uses the abortable stub"); });
    const controller = new AbortController();
    let validationAborted = false, callback = "";
    globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => {
      if (new URL(input instanceof Request ? input.url : input.toString()).pathname !== "/api/auth/me") return originalFetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { validationAborted = true; reject(init.signal?.reason); }, { once: true });
        controller.abort(new Error("cancel during validation"));
      });
    }, { preconnect: originalFetch.preconnect });
    let posted!: Promise<number | null>;
    await expect(resolveCliApiSession(options(server.url.origin, { signal: controller.signal, openBrowser: async url => {
      const request = handoffRequest(url); callback = request.callbackUrl;
      posted = post(request, token()).then(response => response.status, () => null);
      await posted;
    } }))).rejects.toThrow("cancel during validation");
    expect([403, null]).toContain(await posted);
    expect(validationAborted).toBe(true);
    expect(await readdir(directory)).toEqual([]);
    assertPortReleased(callback);
  });

  test("partial callback bodies are closed by owned abort and timeout without client cancellation", async () => {
    for (const mode of ["abort", "timeout"] as const) {
      const server = api(() => { throw new Error("Partial body must not reach API validation"); });
      const controller = new AbortController(), clientCleanup = new AbortController();
      let callback = "", restoreTimer: (() => void) | undefined;
      let posted!: Promise<"closed" | "response">;
      if (mode === "timeout") {
        const originalTimeout = globalThis.setTimeout;
        const fastTimeout = Object.assign((...[handler, delay, ...args]: Parameters<typeof setTimeout>) =>
          originalTimeout(handler, delay === 300_000 ? 100 : delay, ...args), { __promisify__: originalTimeout.__promisify__ });
        const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(fastTimeout);
        restoreTimer = () => timeoutSpy.mockRestore();
      }
      try {
        await expect(resolveCliApiSession(options(server.url.origin, { signal: controller.signal, openBrowser: async url => {
          callback = handoffRequest(url).callbackUrl;
          const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode("{")); } });
          posted = fetch(callback, { method: "POST", headers: { Origin: webOrigin, "Content-Type": "application/json" },
            body, signal: clientCleanup.signal }).then(() => "response" as const, () => "closed" as const);
          if (mode === "abort") {
            await Bun.sleep(20);
            controller.abort(new Error("cancel partial body"));
          }
        } }))).rejects.toThrow(mode === "abort" ? "cancel partial body" : "Timed out");
        expect(await Promise.race([posted, Bun.sleep(200).then(() => "still pending")])).not.toBe("still pending");
        expect(clientCleanup.signal.aborted).toBe(false);
        expect(await readdir(directory)).toEqual([]);
        assertPortReleased(callback);
      } finally {
        restoreTimer?.();
        clientCleanup.abort();
      }
    }
  });
});
