import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { useState } from "react";
import { setApiBase, type AdminGameSummary } from "@/lib/api";
import {
  AdminProviderFailuresPanel,
  AdminProviderFailuresPill,
} from "../app/admin/admin-provider-failures-view";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
let activeWindow: HappyDOMWindow | null = null;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  activeWindow?.close();
  activeWindow = null;
});

describe("admin provider failure evidence", () => {
  test("distinguishes empty and unavailable summaries from inspectable recovered evidence", () => {
    installDom();
    const empty = render(
      <AdminProviderFailuresPill
        summary={emptySummary()}
        onClick={() => {}}
        ariaLabel="Open empty failures"
      />,
    );
    expect(empty.container.textContent).toBe("—");
    empty.unmount();

    const unavailable = render(
      <AdminProviderFailuresPill
        summary={{ schemaVersion: 1, state: "unavailable", error: "offline", retryable: true }}
        onClick={() => {}}
        ariaLabel="Retry unavailable failures"
      />,
    );
    expect(unavailable.getByRole("button", { name: "Retry unavailable failures" })).not.toBeNull();
    expect(unavailable.container.textContent).toContain("Unavailable");
    unavailable.unmount();

    const recovered = render(
      <AdminProviderFailuresPill
        summary={{ ...emptySummary(), state: "recovered", failureCount: 4, exactFailureCount: 1, rateLimitCount: 3, recoveredCount: 2 }}
        onClick={() => {}}
        ariaLabel="Open recovered failures"
      />,
    );
    expect(recovered.container.textContent).toContain("4 failures");
    expect(recovered.container.textContent).toContain("recovered");
  });

  test("renders chronological exact and aggregate evidence, keeps hostile raw text inert, and restores focus", async () => {
    installDom();
    setApiBase("https://api.example.test");
    let contentReads = 0;
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (url.endsWith("/provider-failures")) return jsonResponse(detailFixture());
      contentReads += 1;
      if (contentReads === 1) {
        return jsonResponse({
          schemaVersion: 1,
          state: "partial",
          content: "<img src=x onerror=alert(1)>",
          byteLength: 48,
          returnedByteLength: 32,
          totalByteLength: 48,
          offsetBytes: 0,
          nextOffsetBytes: 32,
          truncated: true,
          sha256: "sha256:first",
        });
      }
      return jsonResponse({
        schemaVersion: 1,
        state: "unavailable",
        status: "storage_error",
        error: "continuation unavailable",
        retryable: true,
      }, 503);
    }) as typeof fetch;

    const mounted = render(<PanelHarness />);
    const trigger = mounted.getByRole("button", { name: "Inspect game evidence" });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(mounted.getByRole("dialog", { name: "Provider failures" })).not.toBeNull());
    expect(mounted.getByRole("button", { name: "Close" }) === document.activeElement).toBeTrue();
    await waitFor(() => expect(mounted.container.textContent).toContain("invalid_prompt"));
    expect(mounted.container.textContent).toContain("openai.responses");
    expect(mounted.container.textContent).toContain("2 rate-limit responses");
    expect(mounted.container.textContent).toContain("recovered");
    expect(mounted.container.textContent).toContain("terminal");
    expect(mounted.container.textContent).toContain("4 used · unbounded");
    expect(mounted.container.textContent).toContain("2/3 used");
    expect(mounted.container.textContent).toContain("1 fallback call remaining");
    expect(mounted.container.textContent).toContain("Cost unavailable for 2 calls");

    fireEvent.click(mounted.getByRole("button", { name: "Load private evidence" }));
    await waitFor(() => expect(mounted.container.textContent).toContain("<img src=x onerror=alert(1)>") );
    expect(mounted.container.querySelector("img") === null).toBeTrue();
    fireEvent.click(mounted.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(mounted.container.textContent).toContain("Continuation failed"));
    expect(mounted.container.textContent).toContain("the bytes above remain partial");
    expect(mounted.getByRole("button", { name: "Retry" })).not.toBeNull();

    fireEvent.click(mounted.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(mounted.queryByRole("dialog") === null).toBeTrue());
    expect(trigger === document.activeElement).toBeTrue();
  });

  test("distinguishes permanently unavailable raw evidence from retryable storage errors", async () => {
    installDom();
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (url.endsWith("/provider-failures")) return jsonResponse(detailFixture());
      return jsonResponse({
        schemaVersion: 1,
        state: "unavailable",
        status: "redacted",
        error: "Evidence was redacted",
        retryable: false,
      }, 410);
    }) as typeof fetch;

    const mounted = render(<AdminProviderFailuresPanel game={gameFixture()} onClose={() => {}} />);
    await waitFor(() => expect(mounted.getByRole("button", { name: "Load private evidence" })).not.toBeNull());
    fireEvent.click(mounted.getByRole("button", { name: "Load private evidence" }));
    await waitFor(() => expect(mounted.container.textContent).toContain("permanently unavailable"));
    expect(mounted.container.textContent).toContain("redacted");
    expect(mounted.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("keeps loading, unavailable, and empty panel states distinct and retryable", async () => {
    installDom();
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })) as unknown as typeof fetch;
    const mounted = render(<AdminProviderFailuresPanel game={gameFixture()} onClose={() => {}} />);
    expect(mounted.getByText("Loading evidence…")).not.toBeNull();

    resolveFetch(jsonResponse({ error: "storage offline" }, 503));
    await waitFor(() => expect(mounted.getByText("Evidence unavailable")).not.toBeNull());
    expect(mounted.getByRole("button", { name: "Retry" })).not.toBeNull();
    mounted.unmount();

    globalThis.fetch = (async () => jsonResponse({
      schemaVersion: 1,
      gameId: "game-1",
      summary: emptySummary(),
      budgets: [],
      failures: [],
    })) as unknown as typeof fetch;
    const empty = render(<AdminProviderFailuresPanel game={gameFixture()} onClose={() => {}} />);
    await waitFor(() => expect(empty.getAllByText("No provider failures").length).toBe(2));
  });
});

function PanelHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Inspect game evidence</button>
      {open && <AdminProviderFailuresPanel game={gameFixture()} onClose={() => setOpen(false)} />}
    </>
  );
}

function detailFixture() {
  return {
    schemaVersion: 1,
    gameId: "game-1",
    summary: {
      ...emptySummary(),
      state: "terminal",
      failureCount: 3,
      exactFailureCount: 1,
      rateLimitCount: 2,
      recoveredCount: 1,
      terminalCount: 1,
    },
    budgets: [
      {
        catalogId: "openai:gpt-5.6-luna",
        providerProfileId: "openai",
        modelName: "gpt-5.6-luna",
        role: "primary",
        usedCalls: 4,
        maxCallsPerGame: null,
        remainingCalls: null,
        state: "unbounded",
        cost: {
          state: "actual",
          callCount: 4,
          actualCostMicrousd: 1250,
          estimatedCostMicrousd: 0,
          unpricedCallCount: 0,
        },
      },
      {
        catalogId: "katana:glm-5-2",
        providerProfileId: "katana",
        modelName: "glm-5-2",
        role: "fallback",
        usedCalls: 2,
        maxCallsPerGame: 3,
        remainingCalls: 1,
        state: "available",
        cost: {
          state: "unavailable",
          callCount: 2,
          actualCostMicrousd: 0,
          estimatedCostMicrousd: 0,
          unpricedCallCount: 2,
        },
      },
    ],
    failures: [
      {
        kind: "attempt",
        id: "attempt-1",
        logicalCallId: "call-1",
        occurredAt: "2026-08-23T12:00:00.000Z",
        state: "recovered",
        actorName: "Atlas",
        actorRole: "player",
        action: "vote",
        phase: "VOTE",
        round: 2,
        providerProfileId: "openai",
        transport: "openai.responses",
        modelName: "gpt-5.6-luna",
        attemptOrdinal: 1,
        outcomeKind: "refusal",
        outcomeMessage: "invalid_prompt",
        retryable: false,
        disposition: "retry_scheduled",
        providerRequestId: "req-1",
        evidence: { state: "available", manifestId: "manifest-1", error: null },
      },
      {
        kind: "rate_limit",
        id: "rate-limit:call-2",
        logicalCallId: "call-2",
        occurredAt: "2026-08-23T12:01:00.000Z",
        state: "terminal",
        actorName: "House",
        actorRole: "house",
        action: "narrate",
        phase: "MINGLE",
        round: 2,
        count: 2,
        outcome: "exhausted",
        terminalReason: "retry budget exhausted",
      },
    ],
  };
}

function emptySummary() {
  return {
    schemaVersion: 1 as const,
    state: "empty" as const,
    failureCount: 0,
    exactFailureCount: 0,
    rateLimitCount: 0,
    recoveredCount: 0,
    terminalCount: 0,
    degradedCount: 0,
    transitionedCount: 0,
    lastFailureAt: null,
  };
}

function gameFixture(): AdminGameSummary {
  return {
    id: "game-1",
    slug: "provider-failure-bay",
    status: "completed",
    playerCount: 8,
    currentRound: 6,
    maxRounds: 8,
    currentPhase: "END",
    phaseTimeRemaining: null,
    alivePlayers: 2,
    eliminatedPlayers: 6,
    modelLabel: "OpenAI gpt-5.6-luna · Adaptive",
    visibility: "public",
    viewerMode: "replay",
    trackType: "custom",
    createdAt: "2026-08-23T11:00:00.000Z",
    completedAt: "2026-08-23T12:05:00.000Z",
    hidden: false,
    completionSettlement: {
      schemaVersion: 1,
      state: "completed",
      retryEligible: false,
      attemptCount: 1,
      resultHash: "sha256:result",
      boundary: null,
      failureCode: null,
      capturedAt: "2026-08-23T12:05:00.000Z",
      retryReadyAt: null,
      lastAttemptedAt: "2026-08-23T12:05:00.000Z",
      completedAt: "2026-08-23T12:05:00.000Z",
    },
    providerFailures: { ...emptySummary(), state: "terminal", failureCount: 3, exactFailureCount: 1, rateLimitCount: 2, terminalCount: 1 },
  };
}

function installDom(): void {
  activeWindow = new HappyDOMWindow({ url: "http://localhost/admin/games" });
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
