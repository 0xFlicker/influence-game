import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
import { AUTH_TOKEN_KEY, setApiBase } from "../lib/api";

if (process.env.HOUSE_CLI_SESSION_CLIENT_TEST !== "1") {
  test("CLI browser consent and session cancellation", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, HOUSE_CLI_SESSION_CLIENT_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
  });
} else {
  const originalFetch = globalThis.fetch;
  const names = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "CustomEvent", "StorageEvent"] as const;
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let dom: Window, authenticated: boolean, ready: boolean, accountId: string, signIns: number;
  mock.module("@/hooks/use-auth", () => ({ AUTH_GENERATION_KEY: "influence_auth_generation", useAuth: () => ({ ready, authenticated, account: authenticated ? { id: accountId, displayName: "Studio Operator" } : null, openSignIn: () => { signIns++; } }) }));
  const { CliSessionClient } = await import("../app/auth/cli/cli-session-client");
  const request = { apiOrigin: "https://api.house.example", callbackUrl: "http://127.0.0.1:42761/cli-session", state: "x".repeat(43) };
  const authGenerationKey = "influence_auth_generation";
  type Read = { url: string; options?: RequestInit };
  function respond(handler: (url: string, options?: RequestInit) => Promise<Response>) {
    globalThis.fetch = Object.assign((input: RequestInfo | URL, options?: RequestInit) => handler(String(input), options), { preconnect: originalFetch.preconnect }) as typeof fetch;
  }
  beforeEach(() => {
    dom = new Window({ url: "https://house.example/auth/cli" });
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] });
    authenticated = true; ready = true; accountId = "operator"; signIns = 0;
    localStorage.setItem(AUTH_TOKEN_KEY, "private-app-jwt"); localStorage.setItem(authGenerationKey, "generation-one");
    setApiBase("https://house.example");
  });
  afterEach(async () => {
    await act(async () => cleanup()); dom.close(); globalThis.fetch = originalFetch;
    for (const name of names) { const descriptor = saved.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  });

  test("browser sends nothing before consent, validates API identity, then sends only a POST body to the loopback terminal", async () => {
    const reads: Read[] = [];
    respond(async (url, options) => { reads.push({ url, options }); return Response.json(url.endsWith("/auth/me") ? { id: "operator", roles: ["producer", "sysop"] } : { ok: true }); });
    const view = render(<CliSessionClient request={request} />);
    expect(view.getByText(request.apiOrigin)).toBeTruthy(); expect(reads).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(view.getByText(/CLI authorized. Return to your terminal/)).toBeTruthy());
    expect(reads.map(read => read.url)).toEqual(["https://house.example/api/auth/me", request.callbackUrl]);
    expect(new Headers(reads[0]!.options?.headers).get("Authorization")).toBe("Bearer private-app-jwt");
    expect(reads[1]!.options).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    expect(new Headers(reads[1]!.options?.headers).get("Authorization")).toBeNull();
    expect(JSON.parse(String(reads[1]!.options?.body))).toEqual({ apiOrigin: request.apiOrigin, state: request.state, token: "private-app-jwt" });
    expect(reads.every(read => !read.url.includes("private-app-jwt"))).toBe(true);
    expect(document.body.textContent).not.toContain("private-app-jwt");
    expect(localStorage.length).toBe(2);
  });

  test("absent session uses the existing sign-in surface and still requires consent after login", async () => {
    authenticated = false; localStorage.removeItem(AUTH_TOKEN_KEY);
    const reads: Read[] = []; respond(async (url, options) => { reads.push({ url, options }); return Response.json({ id: "operator" }); });
    const view = render(<CliSessionClient request={request} />);
    await waitFor(() => expect(signIns).toBe(1));
    expect(view.getByRole("button", { name: "Open sign in" })).toBeTruthy(); expect(reads).toHaveLength(0);
    authenticated = true; localStorage.setItem(AUTH_TOKEN_KEY, "new-session"); view.rerender(<CliSessionClient request={request} />);
    expect(view.getByRole("button", { name: "Authorize local CLI" })).toBeTruthy(); expect(reads).toHaveLength(0);
  });

  test("API expiry returns to normal sign-in without releasing credentials to a terminal", async () => {
    let expired = 0; window.addEventListener("auth:expired", () => { expired++; });
    const reads: Read[] = []; respond(async (url, options) => { reads.push({ url, options }); return Response.json({ error: "Expired" }, { status: 401 }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(expired).toBe(1));
    authenticated = false; localStorage.removeItem(AUTH_TOKEN_KEY); view.rerender(<CliSessionClient request={request} />);
    expect(view.getByRole("button", { name: "Open sign in" })).toBeTruthy();
    expect(reads).toHaveLength(1); expect(reads[0]!.url).toBe("https://house.example/api/auth/me");
  });

  test("a mismatched API account cannot release credentials to a terminal", async () => {
    const reads: Read[] = []; respond(async (url, options) => { reads.push({ url, options }); return Response.json({ id: "someone-else" }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("different account"));
    expect(reads).toHaveLength(1); expect(reads[0]!.url).toBe("https://house.example/api/auth/me");
  });

  test("auth generation replacement fences a late API read even when its mocked response ignores cancellation", async () => {
    let resolveRead!: (response: Response) => void;
    const reads: Read[] = []; respond(async (url, options) => { reads.push({ url, options }); return new Promise<Response>(resolve => { resolveRead = resolve; }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(reads).toHaveLength(1));
    localStorage.setItem(authGenerationKey, "generation-two"); localStorage.setItem(AUTH_TOKEN_KEY, "replacement-session");
    await act(async () => { resolveRead(Response.json({ id: "operator" })); });
    expect(reads).toHaveLength(1); expect(view.queryByText(/CLI authorized/)).toBeNull();
    expect(view.getByRole("button", { name: "Authorize local CLI" })).toBeTruthy();
  });

  test("sign-out aborts a pending callback and its late acknowledgement cannot report success", async () => {
    let resolveCallback!: (response: Response) => void;
    const reads: Read[] = [];
    respond(async (url, options) => { reads.push({ url, options }); return url.endsWith("/auth/me") ? Response.json({ id: "operator" }) : new Promise<Response>(resolve => { resolveCallback = resolve; }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(reads).toHaveLength(2));
    authenticated = false; localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.setItem(authGenerationKey, "signed-out");
    await act(async () => { window.dispatchEvent(new CustomEvent("auth:session-cleared")); view.rerender(<CliSessionClient request={request} />); resolveCallback(Response.json({ ok: true })); });
    expect(reads[1]!.options?.signal?.aborted).toBe(true); expect(view.queryByText(/CLI authorized/)).toBeNull();
    expect(view.getByRole("button", { name: "Open sign in" })).toBeTruthy();
  });

  test("closed terminal failure remains recoverable with explicit retry", async () => {
    let callbacks = 0;
    respond(async url => { if (url.endsWith("/auth/me")) return Response.json({ id: "operator" }); callbacks++; if (callbacks === 1) throw new TypeError("Failed to fetch"); return Response.json({ ok: true }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not reach the waiting terminal"));
    expect(callbacks).toBe(1); fireEvent.click(view.getByRole("button", { name: "Retry authorization" }));
    await waitFor(() => expect(view.getByText(/CLI authorized/)).toBeTruthy()); expect(callbacks).toBe(2);
  });

  test("unmount aborts a pending API request and prevents callback delivery", async () => {
    let resolveRead!: (response: Response) => void;
    const reads: Read[] = []; respond(async (url, options) => { reads.push({ url, options }); return new Promise<Response>(resolve => { resolveRead = resolve; }); });
    const view = render(<CliSessionClient request={request} />);
    fireEvent.click(view.getByRole("button", { name: "Authorize local CLI" }));
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => { view.unmount(); resolveRead(Response.json({ id: "operator" })); });
    expect(reads[0]!.options?.signal?.aborted).toBe(true); expect(reads).toHaveLength(1);
  });
}
