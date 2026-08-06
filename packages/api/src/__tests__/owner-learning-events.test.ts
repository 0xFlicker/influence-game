import { describe, expect, test } from "bun:test";
import {
  ownerLearningCreditConsumedEvent,
  ownerLearningReviewResolvedEvent,
  ownerLearningStageReachedEvent,
} from "../services/owner-learning-events.js";

describe("owner learning events", () => {
  test("constructs closed content-free payloads", () => {
    expect(ownerLearningCreditConsumedEvent({
      ownerUserId: "owner-1",
      reviewId: "review-1",
      agentProfileId: "agent-1",
      occurredAt: "2026-08-04T00:00:00.000Z",
    })).toEqual({
      kind: "credit_consumed",
      ownerUserId: "owner-1",
      reviewId: "review-1",
      agentProfileId: "agent-1",
      occurredAt: "2026-08-04T00:00:00.000Z",
      payload: {},
    });

    expect(ownerLearningStageReachedEvent({
      ownerUserId: "owner-1",
      reviewId: "review-1",
      agentProfileId: "agent-1",
      stage: "scanning_narratives",
      logicalCallCount: 1,
      diveCount: 0,
      occurredAt: "2026-08-04T00:01:00.000Z",
    }).payload).toEqual({
      stage: "scanning_narratives",
      logicalCallCount: 1,
      diveCount: 0,
    });

    expect(ownerLearningReviewResolvedEvent({
      ownerUserId: "owner-1",
      reviewId: "review-1",
      agentProfileId: "agent-1",
      resolution: "failed",
      occurredAt: "2026-08-04T00:02:00.000Z",
    }).payload).toEqual({ resolution: "failed" });
  });
});
