import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { setApiBase } from "../lib/api";

let canManage = true;

mock.module("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (permission: string) => canManage && permission === "manage_provider_health",
  }),
}));

const { AdminProviderHealth } = await import("../app/admin/admin-provider-health-view");

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
let activeWindow: HappyDOMWindow | null = null;

afterEach(() => {
  cleanup();
  canManage = true;
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  activeWindow?.close();
  activeWindow = null;
});

describe("admin provider health", () => {
  test("distinguishes loading, empty, and unavailable states", async () => {
    installDom();
    let resolveFetch: ((response: Response) => void) | undefined;
    globalThis.fetch = (() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })) as unknown as typeof fetch;

    const mounted = render(<AdminProviderHealth />);
    expect(mounted.getByText("Loading provider health…")).not.toBeNull();

    resolveFetch?.(jsonResponse({ schemaVersion: 1, dailyAdmissionPaused: false, providers: [] }));
    await waitFor(() => expect(
      mounted.getByText("No provider circuits have recorded health state yet."),
    ).not.toBeNull());

    cleanup();
    globalThis.fetch = (async () => jsonResponse({
      error: "Provider health is temporarily unavailable",
    }, 503)) as unknown as typeof fetch;
    const failed = render(<AdminProviderHealth />);
    await waitFor(() => expect(failed.getByRole("alert")).not.toBeNull());
    expect(failed.getByRole("button", { name: "Retry" })).not.toBeNull();
  });

  test("reads state without exposing the probe action to read-only operators", async () => {
    installDom();
    canManage = false;
    globalThis.fetch = (async () => jsonResponse(openResponse())) as unknown as typeof fetch;

    const mounted = render(<AdminProviderHealth />);
    await waitFor(() => expect(mounted.getByText("Daily starts paused")).not.toBeNull());
    expect(mounted.getByText("authentication", { exact: false })).not.toBeNull();
    expect(mounted.queryByRole("button", { name: "Test provider and resume" })).toBeNull();
  });

  test("runs one probe, disables repeat activation, announces recovery, and refreshes", async () => {
    installDom();
    setApiBase("https://api.example.test");
    let statusReads = 0;
    let resolveProbe: ((response: Response) => void) | undefined;
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (request, init) => {
      requests.push({ url: String(request), method: init?.method ?? "GET" });
      if (init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveProbe = resolve; });
      }
      statusReads += 1;
      return jsonResponse(statusReads === 1 ? openResponse() : closedResponse());
    }) as typeof fetch;

    const mounted = render(<AdminProviderHealth />);
    const button = await mounted.findByRole("button", { name: "Test provider and resume" });
    fireEvent.click(button);
    await waitFor(() => expect(
      (mounted.getByRole("button", { name: "Testing provider…" }) as HTMLButtonElement).disabled,
    ).toBeTrue());

    resolveProbe?.(jsonResponse({
      schemaVersion: 1,
      target: {
        scopeKey: "provider:openai",
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
        modelId: "gpt-5.6-luna",
      },
      outcome: { kind: "usable" },
      status: closedStatus(),
    }));

    await waitFor(() => expect(mounted.getByText("openai restored. Eligible Daily admission may resume.")).not.toBeNull());
    expect(mounted.getByText("closed")).not.toBeNull();
    expect(document.activeElement).toBe(mounted.container.querySelector("section"));
    expect(requests).toContainEqual({
      url: "https://api.example.test/api/admin/provider-health/provider%3Aopenai/probe",
      method: "POST",
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  test("keeps the circuit open and retryable when a probe fails", async () => {
    installDom();
    globalThis.fetch = (async (_request, init) => init?.method === "POST"
      ? jsonResponse({ error: "Provider health probe could not be completed" }, 503)
      : jsonResponse(openResponse())) as typeof fetch;

    const mounted = render(<AdminProviderHealth />);
    fireEvent.click(await mounted.findByRole("button", { name: "Test provider and resume" }));

    await waitFor(() => expect(mounted.getByRole("alert")).not.toBeNull());
    expect(mounted.getByText("openai test failed. The circuit remains unchanged.")).not.toBeNull();
    expect(mounted.getByText("open")).not.toBeNull();
    expect(mounted.queryByRole("button", { name: /force.close/i })).toBeNull();
  });
});

function openResponse() {
  return {
    schemaVersion: 1 as const,
    dailyAdmissionPaused: true,
    providers: [openStatus()],
  };
}

function closedResponse() {
  return {
    schemaVersion: 1 as const,
    dailyAdmissionPaused: false,
    providers: [closedStatus()],
  };
}

function openStatus() {
  return providerStatus({
    state: "open" as const,
    reason: "authentication" as const,
    revision: 2,
    consecutiveFailureCount: 1,
    openedAt: "2026-08-23T12:00:00.000Z",
    lastFailureAt: "2026-08-23T12:00:00.000Z",
    lastAttemptId: "attempt-1",
  });
}

function closedStatus() {
  return providerStatus({
    state: "closed" as const,
    reason: null,
    revision: 4,
    consecutiveFailureCount: 0,
    lastSuccessAt: "2026-08-23T12:01:00.000Z",
  });
}

function providerStatus(overrides: Record<string, unknown>) {
  return {
    scopeKey: "provider:openai",
    scopeKind: "provider" as const,
    providerProfileId: "openai",
    catalogId: null,
    state: "closed" as const,
    reason: null,
    revision: 1,
    consecutiveFailureCount: 0,
    windowStartedAt: null,
    openedAt: null,
    cooldownUntil: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastAttemptId: null,
    probeLeaseOwner: null,
    probeLeaseExpiresAt: null,
    lastProbeAt: null,
    updatedAt: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

function installDom(): void {
  activeWindow = new HappyDOMWindow({ url: "http://localhost/admin" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: activeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: activeWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: activeWindow.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: activeWindow.localStorage });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
