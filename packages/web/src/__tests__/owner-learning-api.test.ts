import { afterEach, describe, expect, test } from "bun:test";
import {
  applyOwnerLearningReview,
  dismissOwnerLearningPrompt,
  getOwnerLearningEligibleInputs,
  getOwnerLearningReview,
  getOwnerLearningReviewStatus,
  listOpenOwnerLearningReviews,
  preflightOwnerLearningReview,
  recordOwnerLearningMcpOfferViewed,
  recordOwnerLearningManualEditorOpened,
  recordOwnerLearningPromptImpression,
  recordOwnerLearningRecommendationsViewed,
  resolveOwnerLearningReview,
  retryOwnerLearningReview,
  setApiBase,
  startOwnerLearningReview,
  updateAgent,
} from "../lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiBase("");
});

describe("owner learning web API", () => {
  test("mirrors the authenticated REST paths and exact mutation inputs", async () => {
    setApiBase("https://api.example.test");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse({});
    }) as typeof fetch;

    await preflightOwnerLearningReview({ agentProfileId: "agent/one", gameIds: ["game-1"] });
    await startOwnerLearningReview({
      agentProfileId: "agent/one",
      gameIds: ["game-1"],
      idempotencyKey: "browser-review-1",
    });
    await getOwnerLearningReview("review/one", "agent/one");
    await getOwnerLearningReviewStatus("review/one", "agent/one");
    await applyOwnerLearningReview("review/one", "sha256:proposal");
    await resolveOwnerLearningReview("review/one", "declined");
    await updateAgent("agent/one", {
      strategyStyle: "Adapt after the first vote.",
      sourceReviewId: "review/one",
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.example.test/api/agent-learning/reviews/preflight",
      "https://api.example.test/api/agent-learning/reviews",
      "https://api.example.test/api/agent-learning/reviews/review%2Fone?agentProfileId=agent%2Fone",
      "https://api.example.test/api/agent-learning/reviews/review%2Fone/status?agentProfileId=agent%2Fone",
      "https://api.example.test/api/agent-learning/reviews/review%2Fone/apply",
      "https://api.example.test/api/agent-learning/reviews/review%2Fone/resolve",
      "https://api.example.test/api/agent-profiles/agent/one",
    ]);
    expect(JSON.parse(String(requests[4]!.init?.body))).toEqual({
      proposalFingerprint: "sha256:proposal",
    });
    expect(JSON.parse(String(requests[5]!.init?.body))).toEqual({ resolution: "declined" });
    expect(JSON.parse(String(requests[6]!.init?.body))).toEqual({
      strategyStyle: "Adapt after the first vote.",
      sourceReviewId: "review/one",
    });
  });

  test("exposes every owner workflow read, analytics, and retry endpoint", async () => {
    setApiBase("https://api.example.test");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse(requests.length === 2 ? [] : {});
    }) as typeof fetch;

    await getOwnerLearningEligibleInputs();
    await listOpenOwnerLearningReviews();
    await recordOwnerLearningPromptImpression(3);
    await dismissOwnerLearningPrompt();
    await recordOwnerLearningRecommendationsViewed("review-1");
    await recordOwnerLearningManualEditorOpened("review-1");
    await recordOwnerLearningMcpOfferViewed("review-1");
    await retryOwnerLearningReview("review-1");

    expect(requests.map((request) => [request.init?.method ?? "GET", request.url])).toEqual([
      ["GET", "https://api.example.test/api/agent-learning/eligible-inputs"],
      ["GET", "https://api.example.test/api/agent-learning/reviews/open"],
      ["POST", "https://api.example.test/api/agent-learning/prompts/impression"],
      ["POST", "https://api.example.test/api/agent-learning/prompts/dismiss"],
      ["POST", "https://api.example.test/api/agent-learning/reviews/review-1/viewed"],
      ["POST", "https://api.example.test/api/agent-learning/reviews/review-1/manual-editor-opened"],
      ["POST", "https://api.example.test/api/agent-learning/reviews/review-1/mcp-offer-viewed"],
      ["POST", "https://api.example.test/api/agent-learning/reviews/review-1/retry"],
    ]);
    expect(JSON.parse(String(requests[2]!.init?.body))).toEqual({ threshold: 3 });
    expect(requests[3]!.init?.body).toBeUndefined();
    expect(requests[4]!.init?.body).toBeUndefined();
    expect(requests[5]!.init?.body).toBeUndefined();
    expect(requests[6]!.init?.body).toBeUndefined();
    expect(requests[7]!.init?.body).toBeUndefined();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
