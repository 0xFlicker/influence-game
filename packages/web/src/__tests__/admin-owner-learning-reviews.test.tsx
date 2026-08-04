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
  test("renders generated prose as inert text and links acceptance to the exact application", () => {
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
    expect(html).toContain("Make commitments testable");
    expect(html).toContain("&lt;script&gt;window.stolen=true&lt;/script&gt;");
    expect(html).toContain("[bad](https://evil.example)");
    expect(html).toContain("round:3:vote:learner");
    expect(html).toContain("Later Daily Free games on this executed revision");
    expect(html).toContain("correlation, not causal proof");
    expect(html).toContain("Yes");
    expect(html).toContain("accepted");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
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
      diagnosis: "vote plan",
      application: "not_accepted",
    });
    await getAdminOwnerLearningReview("review/one");

    expect(requests).toEqual([
      "https://api.example.test/api/admin/owner-learning-reviews?track=strategy_health_check&diagnosis=vote+plan&application=not_accepted",
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
    const listDetail = detailFixture("review-a", "Agent A", "List diagnosis");
    const olderDetail = detailFixture("review-a", "Agent A", "Older response");
    const newerDetail = detailFixture("review-a", "Agent A", "Newer response");
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
    expect(mounted.getByText("Newer response")).not.toBeNull();

    await act(async () => {
      resolveOlder(jsonResponse(olderDetail));
      await settlePromises();
    });
    expect(rowA.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.getByText("Newer response")).not.toBeNull();
    expect(mounted.queryByText("Older response")).toBeNull();
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
      selectedGameCount: 1,
      track: detail.lifecycle.track,
      status: detail.lifecycle.status,
      stage: detail.lifecycle.stage,
      resolution: detail.lifecycle.resolution,
      diagnosis: detail.result?.diagnosis ?? null,
      model: detail.policy.model,
      disposition: detail.disposition,
      acceptance: detail.acceptance,
      recommendationCount: detail.result?.recommendations.length ?? 0,
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
  diagnosis = "The agent makes promises without a reciprocal vote checkpoint.",
): AdminOwnerLearningReviewDetail {
  return {
    id,
    owner: { userId: "owner-1", displayName: "Review Owner", handle: "review-owner" },
    agent: { profileId: `agent-${id}`, name: agentName },
    reviewedRevision: { id: "revision-1", ordinal: 2 },
    selectedGames: [{ gameId: "game-1", slug: "quiet-violet", position: 1, previouslyAnalyzed: false }],
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
    result: {
      diagnosis,
      analysisTrack: "evidence_rich",
      recommendations: [{
        id: "olrec-1",
        title: "Make commitments testable",
        disposition: "change",
        confidence: "high",
        rationale: "<script>window.stolen=true</script> [bad](https://evil.example)",
        evidenceRefs: [{
          kind: "canonical_event",
          gameId: "game-1",
          coordinate: "round:3:vote:learner",
          sourceHash: "sha256:evidence",
          sourceVersion: "postgame-v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before: "Build trust.",
        after: "Require a reciprocal commitment before coordinating the vote.",
      },
    },
    recommendationAcceptance: [{ recommendationId: "olrec-1", state: "accepted" }],
    proposalFingerprint: "sha256:proposal",
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
      tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200 },
      cost: { source: "estimated", microusd: 725, pricingSourceId: "catalog", rateCardVersion: "2026-08-04", pricedAt: "2026-08-04T03:02:00.000Z" },
      dispatchedAt: "2026-08-04T03:01:58.000Z",
      completedAt: "2026-08-04T03:02:00.000Z",
    }],
    tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200, unavailableCallCount: 0 },
    cost: { actualMicrousd: 0, estimatedMicrousd: 725, unavailableCallCount: 0 },
    application: {
      proposalFingerprint: "sha256:proposal",
      sourceRecommendationIds: ["olrec-1"],
      priorRevisionId: "revision-1",
      resultingRevisionId: "revision-2",
      priorStrategyStyle: "Build trust.",
      resultingStrategyStyle: "Require a reciprocal commitment before coordinating the vote.",
      appliedAt: "2026-08-04T04:00:00.000Z",
      mutationReceipt: {
        schemaVersion: 1,
        operation: "updated",
        profileRevision: { revisionId: "revision-2", ordinal: 3, outcome: "created" },
        dailyFree: "preserved_follows_profile",
        waitingSeats: { total: 0, reconciled: 0, alreadyCurrent: 0, crossedFreeze: 0, truncatedCount: 0 },
        frozenSeats: { unchanged: 0 },
        warnings: [],
      },
    },
    subsequentDailyFree: {
      label: "Later Daily Free games on this executed revision — correlation, not causal proof",
      revisionId: "revision-2",
      games: [{ gameId: "game-2", slug: "later-game", placement: 2, lobbySize: 8, totalPoints: 5, earnedAt: "2026-08-05T01:00:00.000Z" }],
    },
  };
}
