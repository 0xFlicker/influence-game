import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { setApiBase } from "../lib/api";

let allowed = true;

mock.module("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (permission: string) => allowed && permission === "manage_deployment_admission",
  }),
}));

const { AdminDeploymentAdmission } = await import("../app/admin/admin-deployment-admission");

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
let activeWindow: HappyDOMWindow | null = null;

afterEach(() => {
  cleanup();
  allowed = true;
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  activeWindow?.close();
  activeWindow = null;
});

describe("admin deployment admission", () => {
  test("does not render or request status without the dedicated permission", async () => {
    installDom();
    allowed = false;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return jsonResponse(inactiveStatus());
    }) as unknown as typeof fetch;

    const mounted = render(<AdminDeploymentAdmission />);
    await settlePromises();

    expect(mounted.container.textContent).toBe("");
    expect(requests).toBe(0);
  });

  test("confirms and refetches after revoking the observed lease", async () => {
    installDom();
    setApiBase("https://api.example.test");
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    let statusReads = 0;
    globalThis.fetch = (async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (method === "POST") return jsonResponse({ schemaVersion: 1, outcome: "revoked" });
      statusReads += 1;
      return jsonResponse(statusReads === 1 ? activeStatus() : inactiveStatus());
    }) as typeof fetch;

    const mounted = render(<AdminDeploymentAdmission />);
    await waitFor(() => expect(mounted.getByText("Release admission paused")).not.toBeNull());
    expect(mounted.getByText("Run 444 · attempt 2")).not.toBeNull();
    expect(mounted.container.textContent).toContain("0 active games");

    fireEvent.click(mounted.getByRole("button", { name: "Resume new game starts" }));
    const reason = mounted.getByLabelText("Reason for Resume");
    fireEvent.input(reason, { target: { value: "release runner was canceled" } });
    const confirm = mounted.getByRole("button", { name: "Confirm Resume" }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBeFalse());
    fireEvent.click(confirm);

    await waitFor(() => expect(mounted.getByText("New game starts resumed.")).not.toBeNull());
    expect(requests).toContainEqual({
      url: `https://api.example.test/api/admin/deployment-admission/${LEASE_ID}/resume`,
      method: "POST",
      body: { revision: 2, reason: "release runner was canceled" },
    });
    expect(statusReads).toBe(2);
  });

  test("reports an idempotent second Resume as already recovered", async () => {
    installDom();
    let statusReads = 0;
    globalThis.fetch = (async (_request, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ schemaVersion: 1, outcome: "already_resumed" });
      }
      statusReads += 1;
      return jsonResponse(statusReads === 1 ? activeStatus() : inactiveStatus());
    }) as typeof fetch;

    const mounted = render(<AdminDeploymentAdmission />);
    await waitFor(() => expect(mounted.getByText("Release admission paused")).not.toBeNull());
    fireEvent.click(mounted.getByRole("button", { name: "Resume new game starts" }));
    fireEvent.input(mounted.getByLabelText("Reason for Resume"), {
      target: { value: "duplicate operator recovery" },
    });
    const confirm = mounted.getByRole("button", { name: "Confirm Resume" }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBeFalse());
    fireEvent.click(confirm);

    await waitFor(() => expect(mounted.getByText("Admission was already resumed.")).not.toBeNull());
  });

  test("shows switching as too late and offers no unsafe Resume action", async () => {
    installDom();
    globalThis.fetch = (async () => jsonResponse({
      ...activeStatus(),
      lease: { ...activeStatus().lease, phase: "switching", revision: 3, canResume: false },
    })) as unknown as typeof fetch;

    const mounted = render(<AdminDeploymentAdmission />);
    await waitFor(() => expect(mounted.getByText("Release switch in progress")).not.toBeNull());

    expect(mounted.getByText("Resume is unavailable after switching begins.")).not.toBeNull();
    expect(mounted.queryByRole("button", { name: "Resume new game starts" })).toBeNull();
  });
});

const LEASE_ID = "11111111-1111-4111-8111-111111111111";

function activeStatus() {
  return {
    schemaVersion: 1 as const,
    admissionBlocked: true,
    activeGameCount: 0,
    lease: {
      id: LEASE_ID,
      revision: 2,
      candidateSha: "4".repeat(40),
      sourceRepository: "0xFlicker/linode-iac",
      workflowRunId: 444,
      workflowRunAttempt: 2,
      actor: "release-operator",
      phase: "validating" as const,
      status: "active" as const,
      acquiredAt: "2026-08-15T01:00:00.000Z",
      heartbeatAt: "2026-08-15T01:01:00.000Z",
      expiresAt: "2026-08-15T01:03:00.000Z",
      absoluteDeadlineAt: "2026-08-15T05:00:00.000Z",
      canResume: true,
    },
  };
}

function inactiveStatus() {
  return {
    schemaVersion: 1 as const,
    admissionBlocked: false,
    activeGameCount: 0,
    lease: null,
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

async function settlePromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
