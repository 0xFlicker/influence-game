import type { DrizzleDB } from "../db/index.js";
import { OWNER_LEARNING_MAX_LOGICAL_CALLS } from "./owner-learning-contracts.js";
import {
  OwnerLearningReadError,
  getOwnedOwnerLearningReview,
} from "./owner-learning-read.js";
import { retryOwnerLearningReview } from "./owner-learning-worker.js";

export type OwnerLearningRetryErrorCode =
  | "review_unavailable"
  | "invalid_review_state"
  | "logical_call_budget_exhausted"
  | "review_not_retryable"
  | "review_state_conflict";

export class OwnerLearningRetryError extends Error {
  constructor(readonly code: OwnerLearningRetryErrorCode) {
    super(code);
    this.name = "OwnerLearningRetryError";
  }
}

export async function retryOwnedOwnerLearningReview(
  db: DrizzleDB,
  input: { ownerUserId: string; reviewId: string; now?: Date },
) {
  let review;
  try {
    review = await getOwnedOwnerLearningReview(db, input);
  } catch (error) {
    if (!(error instanceof OwnerLearningReadError)) throw error;
    throw new OwnerLearningRetryError("review_unavailable");
  }
  if (
    review.resolution == null
    && (review.analysisStatus === "queued" || review.analysisStatus === "running")
  ) {
    return review;
  }
  if (review.analysisStatus !== "failed") {
    throw new OwnerLearningRetryError("invalid_review_state");
  }
  if (review.logicalCallCount >= OWNER_LEARNING_MAX_LOGICAL_CALLS) {
    throw new OwnerLearningRetryError("logical_call_budget_exhausted");
  }
  if (!review.retryable) {
    throw new OwnerLearningRetryError("review_not_retryable");
  }
  const retried = await retryOwnerLearningReview(db, input);
  if (!retried) throw new OwnerLearningRetryError("review_state_conflict");
  return getOwnedOwnerLearningReview(db, input);
}
