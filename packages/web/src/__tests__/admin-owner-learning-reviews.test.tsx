import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { renderToString } from "react-dom/server";
import {
  AdminOwnerLearningReviews,
  AdminOwnerLearningReviewsContent,
} from "../app/admin/admin-owner-learning-reviews";
import {
  getAdminOwnerLearningReview,
  listAdminOwnerLearningReviews,
  setApiBase,
  type AdminOwnerLearningReviewDetail,
  type AdminOwnerLearningReviewList,
} from "../lib/api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
});

describe("admin owner learning reviews", () => {
  test("renders operational review telemetry without exposing review prose", () => {
    const detail = detailFixture();
    const html = renderToString(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain("Review Owner");
    expect(html).toContain("User applied the reviewed change");
    expect(html).toContain("Immutable accounting");
    expect(html).toContain("Applied");
    expect(html).not.toContain("Make commitments testable");
    expect(html).not.toContain("Later Daily Free games");
    expect(html).not.toContain("correlation");
    expect(html).not.toContain("Validated diagnosis");
    expect(html).not.toContain("Exact proposal");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  test("shows persisted HTTP rejection diagnostics for failed calls", () => {
    const detail = detailFixture();
    detail.calls = [{
      ...detail.calls[0]!,
      state: "failed",
      effectiveTier: null,
      capacityPath: null,
      latencyMs: 359,
      terminalHttpStatus: 400,
      providerRequestId: "req-admin-diagnostic",
      cost: {
        source: "unavailable",
        microusd: null,
        pricingSourceId: null,
        rateCardVersion: null,
        pricedAt: null,
      },
    }];
    detail.cost = { actualMicrousd: 0, estimatedMicrousd: 0, unavailableCallCount: 1 };
    const html = renderToString(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain("HTTP 400");
    expect(html).toContain("req-admin-diagnostic");
    expect(html).toContain("359 ms");
    expect(html).toContain("N/A");
    expect(html).toContain("no usage receipt");
  });

  test("shows the content-free structured-output reason retained on a failed call", () => {
    const detail = detailFixture();
    detail.calls[0] = {
      ...detail.calls[0]!,
      state: "failed",
      safeFailureCode: "unknown_moment_handle",
    };
    const html = renderToString(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain("unknown moment handle");
    expect(html).not.toContain("PRIVATE_GENERATED_OUTPUT_SENTINEL");
  });

  test("reports a manual user edit as a neutral action metric", () => {
    const detail = detailFixture();
    detail.application = null;
    detail.lifecycle.resolution = "manual_update";
    detail.acceptance = "not_accepted";
    const html = renderToString(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain("User manually edited");
    expect(html).not.toContain("No exact-proposal application receipt");
  });

  test("uses list/detail admin endpoints and encodes filters and review IDs", async () => {
    setApiBase("https://api.example.test");
    const requests: string[] = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      requests.push(String(url));
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await listAdminOwnerLearningReviews({
      track: "strategy_health_check",
      application: "not_accepted",
    });
    await getAdminOwnerLearningReview("review/one");

    expect(requests).toEqual([
      "https://api.example.test/api/admin/owner-learning-reviews?track=strategy_health_check&application=not_accepted",
      "https://api.example.test/api/admin/owner-learning-reviews/review%2Fone",
    ]);
  });

  test("does not let an older detail failure collapse a newer expanded row", async () => {
    const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=reviews" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: domWindow.localStorage,
    });
    const detailA = detailFixture("review-a", "Agent A");
    const detailB = detailFixture("review-b", "Agent B");
    let rejectDetailA!: (reason: unknown) => void;
    const pendingDetailA = new Promise<Response>((_resolve, reject) => { rejectDetailA = reject; });
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (url.endsWith("/api/admin/owner-learning-reviews")) {
        return jsonResponse({
          ...listFixture(detailA),
          reviews: [listFixture(detailA).reviews[0]!, listFixture(detailB).reviews[0]!],
        });
      }
      if (url.endsWith("/api/admin/owner-learning-reviews/review-a")) return pendingDetailA;
      if (url.endsWith("/api/admin/owner-learning-reviews/review-b")) return jsonResponse(detailB);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const mounted = render(<AdminOwnerLearningReviews />);
    await waitFor(() => {
      expect(mounted.container.querySelector('[data-review-id="review-a"]')).not.toBeNull();
    });
    const rowA = mounted.container.querySelector<HTMLButtonElement>('[data-review-id="review-a"]')!;
    const rowB = mounted.container.querySelector<HTMLButtonElement>('[data-review-id="review-b"]')!;

    fireEvent.click(rowA);
    fireEvent.click(rowB);
    await waitFor(() => expect(mounted.getByText("review-b")).not.toBeNull());
    expect(rowB.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.getByText("review-b")).not.toBeNull();

    await act(async () => {
      rejectDetailA(new Error("review A failed late"));
      await settlePromises();
    });
    expect(rowB.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.queryByText("review A failed late")).toBeNull();
    expect(mounted.getByText("review-b")).not.toBeNull();
    domWindow.close();
  });

  test("does not let an older successful response overwrite a newer detail generation", async () => {
    const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=reviews" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: domWindow.localStorage,
    });
    const listDetail = detailFixture("review-a", "Agent A");
    const olderDetail = detailFixture("review-a", "Agent A");
    const newerDetail = detailFixture("review-a", "Agent A");
    olderDetail.policy.reviewer = "older-reviewer";
    newerDetail.policy.reviewer = "newer-reviewer";
    let resolveOlder!: (response: Response) => void;
    let resolveNewer!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => { resolveOlder = resolve; });
    const newerResponse = new Promise<Response>((resolve) => { resolveNewer = resolve; });
    let detailRequests = 0;
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (url.endsWith("/api/admin/owner-learning-reviews")) return jsonResponse(listFixture(listDetail));
      if (url.endsWith("/api/admin/owner-learning-reviews/review-a")) {
        detailRequests += 1;
        return detailRequests === 1 ? olderResponse : newerResponse;
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const mounted = render(<AdminOwnerLearningReviews />);
    await waitFor(() => {
      expect(mounted.container.querySelector('[data-review-id="review-a"]')).not.toBeNull();
    });
    const rowA = mounted.container.querySelector<HTMLButtonElement>('[data-review-id="review-a"]')!;

    fireEvent.click(rowA);
    fireEvent.click(rowA);
    fireEvent.click(rowA);
    expect(detailRequests).toBe(2);
    await act(async () => {
      resolveNewer(jsonResponse(newerDetail));
      await settlePromises();
    });
    expect(mounted.getByText("newer-reviewer")).not.toBeNull();

    await act(async () => {
      resolveOlder(jsonResponse(olderDetail));
      await settlePromises();
    });
    expect(rowA.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.getByText("newer-reviewer")).not.toBeNull();
    expect(mounted.queryByText("older-reviewer")).toBeNull();
    domWindow.close();
  });
});

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

function listFixture(detail: AdminOwnerLearningReviewDetail): AdminOwnerLearningReviewList {
  return {
    reviews: [{
      id: detail.id,
      owner: detail.owner,
      agent: detail.agent,
      reviewedRevision: detail.reviewedRevision,
      track: detail.lifecycle.track,
      status: detail.lifecycle.status,
      stage: detail.lifecycle.stage,
      resolution: detail.lifecycle.resolution,
      model: detail.policy.model,
      disposition: detail.disposition,
      acceptance: detail.acceptance,
      logicalCallCount: detail.lifecycle.logicalCallCount,
      diveCount: detail.lifecycle.diveCount,
      tokens: detail.tokens,
      cost: detail.cost,
      createdAt: detail.lifecycle.createdAt,
      completedAt: detail.lifecycle.completedAt,
      resolvedAt: detail.lifecycle.resolvedAt,
    }],
    analytics: {
      reviewCount: 1,
      eventCounts: { review_started: 1, proposal_applied: 1 },
      tokens: detail.tokens,
      cost: detail.cost,
      averageCompletionLatencyMs: 120_000,
    },
    truncated: false,
  };
}

function detailFixture(
  id = "review-admin-1",
  agentName = "Marlowe",
): AdminOwnerLearningReviewDetail {
  return {
    id,
    owner: { userId: "owner-1", displayName: "Review Owner", handle: "review-owner" },
    agent: { profileId: `agent-${id}`, name: agentName },
    reviewedRevision: { id: "revision-1", ordinal: 2 },
    policy: {
      eligibility: "owner-learning-eligibility-v1",
      evidence: "owner-learning-evidence-v1",
      reviewer: "owner-learning-reviewer-v1",
      prompt: "owner-learning-prompt-v1",
      schema: "owner-learning-result-v1",
      provider: "owner-learning-luna-flex-v1",
      model: "openai:gpt-5.6-luna",
    },
    lifecycle: {
      track: "evidence_rich",
      status: "ready",
      stage: "complete",
      capacitySubstatus: null,
      resolution: "applied",
      safeFailureCode: null,
      retryable: false,
      logicalCallCount: 1,
      diveCount: 0,
      createdAt: "2026-08-04T03:00:00.000Z",
      startedAt: "2026-08-04T03:00:01.000Z",
      completedAt: "2026-08-04T03:02:00.000Z",
      resolvedAt: "2026-08-04T04:00:00.000Z",
      updatedAt: "2026-08-04T04:00:00.000Z",
    },
    disposition: "applied",
    acceptance: "accepted",
    calls: [{
      ordinal: 1,
      state: "succeeded",
      stage: "drafting_recommendations",
      requestedTier: "flex",
      effectiveTier: "flex",
      requestedReasoningEffort: "low",
      capacityPath: "flex",
      flex429Count: 0,
      latencyMs: 1_250,
      terminalHttpStatus: 200,
      providerRequestId: "req-admin-success",
      safeFailureCode: null,
      tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200 },
      cost: { source: "estimated", microusd: 725, pricingSourceId: "catalog", rateCardVersion: "2026-08-04", pricedAt: "2026-08-04T03:02:00.000Z" },
      dispatchedAt: "2026-08-04T03:01:58.000Z",
      completedAt: "2026-08-04T03:02:00.000Z",
    }],
    tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200, unavailableCallCount: 0 },
    cost: { actualMicrousd: 0, estimatedMicrousd: 725, unavailableCallCount: 0 },
    application: { appliedAt: "2026-08-04T04:00:00.000Z" },
  };
}
