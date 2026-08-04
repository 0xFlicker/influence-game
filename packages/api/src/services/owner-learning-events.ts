import type {
  OwnerLearningAnalysisTrack,
  OwnerLearningResolution,
  OwnerLearningSafeFailureCode,
  OwnerLearningStage,
} from "./owner-learning-contracts.js";

export interface OwnerLearningEventPayloads {
  prompt_impression: { threshold: 1 | 3; completionWatermark: string };
  prompt_dismissed: { completionWatermark: string };
  review_started: { analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">; policyVersion: string };
  analysis_track_selected: { analysisTrack: OwnerLearningAnalysisTrack };
  credit_consumed: Record<string, never>;
  stage_reached: { stage: OwnerLearningStage; logicalCallCount: number; diveCount: number };
  capacity_fallback_started: { callOrdinal: number; flex429Count: 3 };
  review_failed: { failureCode: OwnerLearningSafeFailureCode; retryable: boolean };
  review_retried: { logicalCallCount: number; diveCount: number };
  review_declined: Record<string, never>;
  review_superseded: { source: "unlinked_profile_update" };
  review_resolved: { resolution: OwnerLearningResolution };
  recommendations_viewed: Record<string, never>;
  manual_editor_opened: Record<string, never>;
  proposal_applied: { priorRevisionId: string; resultingRevisionId: string };
  mcp_offer_viewed: { connectionState: "connected" | "not_connected" };
  mcp_connected: { requiredScopesVersion: string };
}

export type OwnerLearningEventKind = keyof OwnerLearningEventPayloads;

export interface OwnerLearningEvent<K extends OwnerLearningEventKind = OwnerLearningEventKind> {
  kind: K;
  ownerUserId: string;
  reviewId: string | null;
  agentProfileId: string | null;
  occurredAt: string;
  payload: OwnerLearningEventPayloads[K];
}

type EventIdentity = {
  ownerUserId: string;
  reviewId?: string | null;
  agentProfileId?: string | null;
  occurredAt: string;
};

export function createOwnerLearningEvent<K extends OwnerLearningEventKind>(
  kind: K,
  identity: EventIdentity,
  payload: OwnerLearningEventPayloads[K],
): OwnerLearningEvent<K> {
  return {
    kind,
    ownerUserId: requiredIdentifier(identity.ownerUserId, "ownerUserId"),
    reviewId: optionalIdentifier(identity.reviewId, "reviewId"),
    agentProfileId: optionalIdentifier(identity.agentProfileId, "agentProfileId"),
    occurredAt: requiredTimestamp(identity.occurredAt),
    payload,
  };
}

export function ownerLearningCreditConsumedEvent(
  input: EventIdentity & { reviewId: string; agentProfileId: string },
): OwnerLearningEvent<"credit_consumed"> {
  return createOwnerLearningEvent("credit_consumed", input, {});
}

export function ownerLearningStageReachedEvent(
  input: EventIdentity & {
    reviewId: string;
    agentProfileId: string;
    stage: OwnerLearningStage;
    logicalCallCount: number;
    diveCount: number;
  },
): OwnerLearningEvent<"stage_reached"> {
  return createOwnerLearningEvent("stage_reached", input, {
    stage: input.stage,
    logicalCallCount: nonNegativeInteger(input.logicalCallCount, "logicalCallCount"),
    diveCount: nonNegativeInteger(input.diveCount, "diveCount"),
  });
}

export function ownerLearningReviewResolvedEvent(
  input: EventIdentity & {
    reviewId: string;
    agentProfileId: string;
    resolution: OwnerLearningResolution;
  },
): OwnerLearningEvent<"review_resolved"> {
  return createOwnerLearningEvent("review_resolved", input, {
    resolution: input.resolution,
  });
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error(`${label} must contain 1-200 characters`);
  }
  return normalized;
}

function optionalIdentifier(
  value: string | null | undefined,
  label: string,
): string | null {
  return value == null ? null : requiredIdentifier(value, label);
}

function requiredTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("occurredAt must be an ISO timestamp");
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
