import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, type RenderResult } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { OwnerLearningReviewWorkspace } from "../app/dashboard/agents/[id]/review/owner-learning-workspace";
import {
  AUTH_TOKEN_KEY,
  setApiBase,
  type OwnerLearningReview,
  type OwnerLearningReviewStatus,
} from "../lib/api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;

let domWindow: HappyDOMWindow;
let timers: FakeTimers;
let fullReviewCalls: number;
let statusCalls: number;
let statusMode: "transient_then_terminal" | "terminal_404";

beforeEach(() => {
  domWindow = new HappyDOMWindow({
    url: "http://localhost/dashboard/agents/agent-1/review/review-1",
  });
  timers = new FakeTimers();
  domWindow.setTimeout = timers.setTimeout as unknown as typeof domWindow.setTimeout;
  domWindow.clearTimeout = timers.clearTimeout as unknown as typeof domWindow.clearTimeout;
  fullReviewCalls = 0;
  statusCalls = 0;
  statusMode = "transient_then_terminal";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: domWindow,
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: domWindow.localStorage,
  });
  domWindow.localStorage.setItem(AUTH_TOKEN_KEY, "session-token");
  setApiBase("");
  globalThis.fetch = (async (request) => {
    const url = String(request);
    if (url.includes("/status?")) {
      statusCalls += 1;
      if (statusMode === "terminal_404") {
        return new Response(JSON.stringify({ error: "Review not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (statusCalls === 1) throw new Error("transient network failure");
      return jsonResponse(terminalStatus());
    }
    if (url.includes("/api/agent-learning/reviews/review-1?")) {
      fullReviewCalls += 1;
      return jsonResponse(fullReviewCalls === 1 ? runningReview() : failedReview());
    }
    if (url.includes("/api/agent-profiles/agent-1")) {
      return jsonResponse({
        id: "agent-1",
        name: "Atlas",
        personality: "Observant",
        backstory: null,
        strategyStyle: "Build trust.",
        personaKey: "strategic",
        gender: "nonbinary",
        avatarUrl: null,
      });
    }
    if (url.endsWith("/api/agent-learning/eligible-inputs")) {
      return jsonResponse({
        mcp: { connectionState: "not_connected", requiredScopesVersion: "owner-learning-v1" },
      });
    }
    if (url.includes("/mcp-offer-viewed") || url.includes("/viewed")) {
      return jsonResponse({ recorded: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  domWindow.close();
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe("owner learning workspace lifecycle", () => {
  test("recovers from one failed status poll and loads the terminal review", async () => {
    let mounted!: RenderResult;
    await act(async () => {
      mounted = render(<OwnerLearningReviewWorkspace agentId="agent-1" reviewId="review-1" />);
      await settlePromises();
    });
    expect(mounted.container.querySelector('[data-review-status="running"]')).not.toBeNull();
    expect(timers.pendingTimerCount).toBe(1);

    await act(async () => {
      await timers.runNextTimer();
      await settlePromises();
    });
    expect(statusCalls).toBe(1);
    expect(timers.pendingTimerCount).toBe(1);
    expect(mounted.container.querySelector('[data-review-status="running"]')).not.toBeNull();

    await act(async () => {
      await timers.runNextTimer();
      await settlePromises();
    });
    expect(statusCalls).toBe(2);
    expect(fullReviewCalls).toBe(2);
    expect(mounted.container.querySelector('[data-review-status="failed"]')).not.toBeNull();
    expect(timers.pendingTimerCount).toBe(0);

    await act(async () => mounted.unmount());
  });

  test("clears the pending poll when the workspace unmounts", async () => {
    let mounted!: RenderResult;
    await act(async () => {
      mounted = render(<OwnerLearningReviewWorkspace agentId="agent-1" reviewId="review-1" />);
      await settlePromises();
    });
    expect(timers.pendingTimerCount).toBe(1);

    await act(async () => mounted.unmount());
    expect(timers.pendingTimerCount).toBe(0);
    expect(statusCalls).toBe(0);
  });

  test("stops polling after an ownership or missing-review response", async () => {
    statusMode = "terminal_404";
    let mounted!: RenderResult;
    await act(async () => {
      mounted = render(<OwnerLearningReviewWorkspace agentId="agent-1" reviewId="review-1" />);
      await settlePromises();
    });

    await act(async () => {
      await timers.runNextTimer();
      await settlePromises();
    });
    expect(statusCalls).toBe(1);
    expect(timers.pendingTimerCount).toBe(0);
    expect(mounted.getByText("Review unavailable.")).not.toBeNull();

    await act(async () => mounted.unmount());
  });
});

class FakeTimers {
  private nextTimerId = 1;
  private readonly timers = new Map<number, () => void>();

  get pendingTimerCount(): number {
    return this.timers.size;
  }

  setTimeout = (callback: TimerHandler): number => {
    const id = this.nextTimerId++;
    this.timers.set(id, () => {
      if (typeof callback === "function") callback();
    });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  async runNextTimer(): Promise<void> {
    const next = this.timers.entries().next().value as [number, () => void] | undefined;
    if (!next) throw new Error("Expected a pending timer");
    this.timers.delete(next[0]);
    next[1]();
    await settlePromises();
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function runningReview(): OwnerLearningReview {
  return {
    id: "review-1",
    agentProfileId: "agent-1",
    reviewedRevisionId: "revision-1",
    selectedGameIds: ["game-1"],
    analysisTrack: "evidence_rich",
    analysisStatus: "running",
    stage: "scanning_narratives",
    capacitySubstatus: null,
    resolution: null,
    result: null,
    proposalFingerprint: null,
    safeFailureCode: null,
    retryable: true,
    ownerRetriesRemaining: 1,
    logicalCallCount: 1,
    diveCount: 0,
    applyDisposition: "not_ready",
    evidence: { games: [] },
    application: null,
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:01:00.000Z",
    resolvedAt: null,
  };
}

function failedReview(): OwnerLearningReview {
  return {
    ...runningReview(),
    analysisStatus: "failed",
    safeFailureCode: "provider_timeout",
    retryable: true,
    updatedAt: "2026-08-04T12:02:00.000Z",
  };
}

function terminalStatus(): OwnerLearningReviewStatus {
  const review = failedReview();
  return {
    analysisStatus: review.analysisStatus,
    stage: review.stage,
    capacitySubstatus: review.capacitySubstatus,
    resolution: review.resolution,
    proposalFingerprint: review.proposalFingerprint,
    safeFailureCode: review.safeFailureCode,
    retryable: review.retryable,
    ownerRetriesRemaining: review.ownerRetriesRemaining,
    logicalCallCount: review.logicalCallCount,
    diveCount: review.diveCount,
    applyDisposition: review.applyDisposition,
    updatedAt: review.updatedAt,
    resolvedAt: review.resolvedAt,
  };
}
