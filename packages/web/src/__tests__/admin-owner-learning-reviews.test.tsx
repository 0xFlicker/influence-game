import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { renderToString } from "react-dom/server";
import {
  AdminOwnerLearningReviews,
  AdminOwnerLearningReviewsContent,
  loadCompleteFailureEvidenceBytes,
} from "../app/admin/admin-owner-learning-reviews";
import {
  getAdminOwnerLearningReview,
  getAdminOwnerLearningFailureContent,
  listAdminOwnerLearningReviews,
  setApiBase,
  type AdminOwnerLearningFailureDiagnostic,
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

  test("previews complete failure evidence as inert escaped text", async () => {
    const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=reviews" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: domWindow.localStorage });
    const detail = detailFixture();
    const diagnostic = {
      id: "diagnostic-admin-1",
      phase: "output_validation" as const,
      safeFailureCode: "invalid_structured_output",
      errorClass: "OwnerLearningOutputValidationError",
      errorCode: "proposal_contract",
      message: "The proposal did not contain a real change.",
      firstApplicationStackFrame: "at validateProposal (owner-learning-provider-context.ts:1:1)",
      fingerprint: "sha256:diagnostic",
      callId: "call-admin-1",
      callOrdinal: 4,
      attemptOrdinal: 1,
      providerRequestId: "req-admin-1",
      providerResponseId: "resp-admin-1",
      occurredAt: "2026-08-04T03:02:00.000Z",
      evidence: {
        manifestId: "manifest-admin-1",
        state: "stored" as const,
        byteLength: 68,
        sha256: "sha256:evidence",
        lastStorageError: null,
      },
    };
    detail.diagnostics = [diagnostic];
    const unsafeText = '<script>alert("diagnostic")</script> [bad](https://evil.example)';
    const requests: string[] = [];
    globalThis.fetch = (async (request) => {
      requests.push(String(request));
      return jsonResponse({
        schemaVersion: 1,
        state: "complete",
        diagnostic: Object.fromEntries(Object.entries(diagnostic).filter(([key]) => key !== "evidence")),
        manifest: {
          id: diagnostic.evidence.manifestId,
          state: "stored",
          contentType: "application/json",
          byteLength: Buffer.byteLength(unsafeText),
          sha256: "sha256:evidence",
          metadata: {},
        },
        content: unsafeText,
        contentBase64: Buffer.from(unsafeText).toString("base64"),
        offsetBytes: 0,
        returnedByteLength: Buffer.byteLength(unsafeText),
        totalByteLength: Buffer.byteLength(unsafeText),
        truncated: false,
        sha256: "sha256:evidence",
        hashScope: "complete_object",
      });
    }) as typeof fetch;

    const mounted = render(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(mounted.getByRole("button", { name: "Preview evidence" }));
    await waitFor(() => expect(mounted.container.textContent).toContain(unsafeText));

    expect(requests).toEqual([
      `/api/admin/owner-learning-reviews/${detail.id}/diagnostics/${diagnostic.id}/content?maxBytes=65536`,
    ]);
    expect(mounted.container.querySelector("script")).toBeNull();
    expect(mounted.container.querySelector('a[href="https://evil.example"]')).toBeNull();
    expect(mounted.getByRole("button", { name: "Copy complete evidence" })).not.toBeNull();
    expect(mounted.getByRole("button", { name: "Download complete evidence" })).not.toBeNull();
    domWindow.close();
  });

  test("reassembles split UTF-8 evidence bytes for complete copy and download", async () => {
    const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=reviews" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: domWindow.localStorage });
    const copied: string[] = [];
    Object.defineProperty(domWindow.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied.push(value); } },
    });
    const detail = detailFixture();
    const diagnostic: AdminOwnerLearningFailureDiagnostic = {
      id: "diagnostic-chunked",
      phase: "output_validation",
      safeFailureCode: "invalid_structured_output",
      errorClass: "OwnerLearningOutputValidationError",
      errorCode: "proposal_contract",
      message: "The provider output was malformed.",
      firstApplicationStackFrame: null,
      fingerprint: "sha256:diagnostic-chunked",
      callId: "call-chunked",
      callOrdinal: 4,
      attemptOrdinal: 1,
      providerRequestId: "req-chunked",
      providerResponseId: "resp-chunked",
      occurredAt: "2026-08-04T03:02:00.000Z",
      evidence: {
        manifestId: "manifest-chunked",
        state: "stored",
        byteLength: null,
        sha256: null,
        lastStorageError: null,
      },
    };
    detail.diagnostics = [diagnostic];
    const completeText = '{"marker":"🧪","tail":"complete"}';
    const completeBytes = Buffer.from(completeText, "utf8");
    const completeSha256 = `sha256:${createHash("sha256").update(completeBytes).digest("hex")}`;
    const emojiOffset = Buffer.byteLength('{"marker":"', "utf8");
    const splitAt = emojiOffset + 2;
    globalThis.fetch = (async (request) => {
      const url = new URL(String(request), "http://localhost");
      const offset = Number(url.searchParams.get("offsetBytes") ?? 0);
      const end = offset === 0 ? splitAt : completeBytes.byteLength;
      const bytes = completeBytes.subarray(offset, end);
      const truncated = end < completeBytes.byteLength;
      return jsonResponse({
        schemaVersion: 1,
        state: truncated ? "partial" : offset === 0 ? "complete" : "final_chunk",
        diagnostic: {},
        manifest: {
          id: diagnostic.evidence.manifestId,
          state: "stored",
          contentType: "application/json",
          byteLength: completeBytes.byteLength,
          sha256: completeSha256,
          metadata: {},
        },
        content: bytes.toString("utf8"),
        contentBase64: bytes.toString("base64"),
        offsetBytes: offset,
        returnedByteLength: bytes.byteLength,
        totalByteLength: completeBytes.byteLength,
        ...(truncated && { nextOffsetBytes: end }),
        truncated,
        sha256: truncated ? "sha256:chunk" : "sha256:final-chunk",
        hashScope: truncated || offset > 0 ? "chunk" : "complete_object",
      });
    }) as typeof fetch;

    expect(Buffer.from(await loadCompleteFailureEvidenceBytes(detail.id, diagnostic.id)))
      .toEqual(completeBytes);

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let downloadedBlob: Blob | null = null;
    URL.createObjectURL = (blob) => {
      if (!(blob instanceof Blob)) throw new Error("Expected a diagnostic evidence Blob");
      downloadedBlob = blob;
      return "blob:owner-review-evidence";
    };
    URL.revokeObjectURL = () => {};
    try {
      const mounted = render(
        <AdminOwnerLearningReviewsContent
          data={listFixture(detail)}
          expandedId={detail.id}
          details={{ [detail.id]: detail }}
          loadingDetailId={null}
          onToggle={() => {}}
        />,
      );
      fireEvent.click(mounted.getByRole("button", { name: "Copy complete evidence" }));
      await waitFor(() => expect(copied).toEqual([completeText]));

      fireEvent.click(mounted.getByRole("button", { name: "Download complete evidence" }));
      await waitFor(() => expect(downloadedBlob).not.toBeNull());
      expect(await downloadedBlob!.text()).toBe(completeText);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      domWindow.close();
    }
  });

  test("rejects an empty evidence chunk instead of retrying the same range forever", async () => {
    setApiBase("https://api.example.test");
    globalThis.fetch = (async () => jsonResponse({
      schemaVersion: 1,
      state: "partial",
      diagnostic: {},
      manifest: {
        id: "manifest-empty-range",
        state: "stored",
        contentType: "application/json",
        byteLength: 10,
        sha256: `sha256:${"0".repeat(64)}`,
        metadata: {},
      },
      content: "",
      contentBase64: "",
      offsetBytes: 0,
      returnedByteLength: 0,
      totalByteLength: 10,
      nextOffsetBytes: 0,
      truncated: true,
      sha256: `sha256:${"0".repeat(64)}`,
      hashScope: "chunk",
    })) as unknown as typeof fetch;

    await expect(loadCompleteFailureEvidenceBytes("review-empty", "diagnostic-empty"))
      .rejects.toThrow("empty chunk");
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

  test("labels a receipt-free local recovery as unbilled instead of missing accounting", () => {
    const detail = detailFixture();
    detail.calls = [{
      ...detail.calls[0]!,
      id: "call-admin-local-recovery",
      attemptOrdinal: 2,
      retryOfAttemptId: "call-admin-1",
      executionKind: "local_recovery",
      tokens: {
        input: null,
        cachedInput: null,
        totalOutput: null,
        reasoning: null,
        visibleOutput: null,
      },
      cost: {
        source: "unavailable",
        microusd: null,
        pricingSourceId: null,
        rateCardVersion: null,
        pricedAt: null,
      },
      dispatchedAt: null,
    }];
    detail.tokens = {
      input: 0,
      cachedInput: 0,
      totalOutput: 0,
      reasoning: 0,
      visibleOutput: 0,
      unavailableCallCount: 0,
    };
    detail.cost = { actualMicrousd: 0, estimatedMicrousd: 0, unavailableCallCount: 0 };
    const html = renderToString(
      <AdminOwnerLearningReviewsContent
        data={listFixture(detail)}
        expandedId={detail.id}
        details={{ [detail.id]: detail }}
        loadingDetailId={null}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain("local recovery · no provider charge");
    expect(html).toContain("$0.00");
    expect(html).not.toContain("no usage receipt");
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

  test("returns typed integrity and storage failures from diagnostic content reads", async () => {
    for (const state of ["integrity_mismatch", "storage_error"] as const) {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        schemaVersion: 1,
        state,
        error: `${state} sentinel`,
        retryable: state === "storage_error",
      }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

      expect(await getAdminOwnerLearningFailureContent("review/one", "diagnostic/one"))
        .toEqual({
          schemaVersion: 1,
          state,
          error: `${state} sentinel`,
          retryable: state === "storage_error",
        });
    }
  });

  test("keeps the newest ledger when filter responses resolve out of order", async () => {
    const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=reviews" });
    Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: domWindow.localStorage,
    });
    const initialDetail = detailFixture("review-initial", "Agent Initial");
    const olderDetail = detailFixture("review-older", "Agent Older");
    const newerDetail = detailFixture("review-newer", "Agent Newer");
    let resolveOlder!: (response: Response) => void;
    let resolveNewer!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => { resolveOlder = resolve; });
    const newerResponse = new Promise<Response>((resolve) => { resolveNewer = resolve; });
    let listRequests = 0;
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (url.endsWith("/api/admin/owner-learning-reviews")) {
        listRequests += 1;
        if (listRequests === 1) return jsonResponse(listFixture(initialDetail));
        return listRequests === 2 ? olderResponse : newerResponse;
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const mounted = render(<AdminOwnerLearningReviews />);
    await waitFor(() => expect(mounted.getByText("Agent Initial")).not.toBeNull());
    const filterForm = mounted.getByPlaceholderText("exact model").closest("form")!;

    fireEvent.submit(filterForm);
    await settlePromises();
    fireEvent.submit(filterForm);
    await settlePromises();
    expect(listRequests).toBe(3);

    await act(async () => {
      resolveNewer(jsonResponse(listFixture(newerDetail)));
      await settlePromises();
    });
    expect(mounted.getByText("Agent Newer")).not.toBeNull();

    await act(async () => {
      resolveOlder(jsonResponse(listFixture(olderDetail)));
      await settlePromises();
    });
    expect(mounted.getByText("Agent Newer")).not.toBeNull();
    expect(mounted.queryByText("Agent Older")).toBeNull();
    domWindow.close();
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
      failure: detail.diagnostics.at(-1) ?? null,
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
      executionPhase: "finalization",
      capacitySubstatus: null,
      resolution: "applied",
      safeFailureCode: null,
      retryable: false,
      ownerRetryCount: 0,
      ownerRetriesRemaining: 1,
      retryTargetAttemptId: null,
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
      id: "call-admin-1",
      ordinal: 1,
      attemptOrdinal: 1,
      retryOfAttemptId: null,
      executionKind: "provider_invocation",
      providerTurnProtocol: "owner-learning-harness-v3",
      executionFingerprint: "sha256:execution",
      retryOfExecutionFingerprint: null,
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
      providerResponseId: "resp-admin-success",
      providerResponseObservedAt: "2026-08-04T03:02:00.000Z",
      providerResponseSha256: "sha256:response",
      requestEvidence: { sha256: "sha256:request", byteLength: 512 },
      responseEvidence: { sha256: "sha256:response-body", byteLength: 1024 },
      evidenceState: "not_required",
      failureDiagnosticId: null,
      safeFailureCode: null,
      tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200 },
      cost: { source: "estimated", microusd: 725, pricingSourceId: "catalog", rateCardVersion: "2026-08-04", pricedAt: "2026-08-04T03:02:00.000Z" },
      dispatchedAt: "2026-08-04T03:01:58.000Z",
      completedAt: "2026-08-04T03:02:00.000Z",
    }],
    diagnostics: [],
    tokens: { input: 1_000, cachedInput: 600, totalOutput: 350, reasoning: 150, visibleOutput: 200, unavailableCallCount: 0 },
    cost: { actualMicrousd: 0, estimatedMicrousd: 725, unavailableCallCount: 0 },
    application: { appliedAt: "2026-08-04T04:00:00.000Z" },
  };
}
