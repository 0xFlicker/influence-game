import type { DrizzleDB } from "../db/index.js";
import {
  applyOwnedOwnerLearningReview,
} from "../services/owner-learning-apply.js";
import {
  OWNER_LEARNING_MAX_DIVES,
  OWNER_LEARNING_MAX_LOGICAL_CALLS,
  parseOwnerLearningGameIds,
  parseOwnerLearningStartIdempotencyKey,
  type OwnerLearningEvidenceRef,
  type OwnerLearningReviewDTO,
  type OwnerLearningReviewResult,
} from "../services/owner-learning-contracts.js";
import {
  getOwnerLearningEligibleInputs,
} from "../services/owner-learning-eligibility.js";
import {
  publicOwnerLearningPreflight,
} from "../services/owner-learning-public.js";
import {
  getOwnedOwnerLearningReview,
  listOpenOwnedOwnerLearningReviews,
} from "../services/owner-learning-read.js";
import {
  retryOwnedOwnerLearningReview,
} from "../services/owner-learning-retry.js";
import {
  startOwnerLearningReview,
  type OwnerLearningEvidenceProjector,
} from "../services/owner-learning-review.js";
import {
  resolveOwnedOwnerLearningReview,
} from "../services/owner-learning-resolution.js";

export const OWNER_LEARNING_CONTENT_TRUST = "untrusted_model_generated" as const;

export interface OwnerLearningMcpDependencies {
  generationEnabled: boolean;
  projector?: OwnerLearningEvidenceProjector;
  now?: () => Date;
}

export class OwnerLearningMcpAdapter {
  private readonly now: () => Date;

  constructor(
    private readonly db: DrizzleDB,
    private readonly dependencies: OwnerLearningMcpDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async listInputs(ownerUserId: string, rawArgs: unknown) {
    strictArgs(rawArgs, []);
    return {
      schemaVersion: 2 as const,
      eligibility: await getOwnerLearningEligibleInputs(this.db, {
        ownerUserId,
        now: this.now(),
      }),
    };
  }

  async listOpen(ownerUserId: string, rawArgs: unknown) {
    strictArgs(rawArgs, []);
    const reviews = await listOpenOwnedOwnerLearningReviews(this.db, { ownerUserId });
    return {
      schemaVersion: 1 as const,
      reviews: reviews.map(toOwnerLearningMcpReview),
    };
  }

  async start(ownerUserId: string, rawArgs: unknown) {
    const args = strictArgs(rawArgs, ["agentProfileId", "gameIds", "idempotencyKey"]);
    const agentProfileId = requiredIdentifier(args.agentProfileId, "agentProfileId");
    const gameIds = parseOwnerLearningGameIds(args.gameIds);
    const idempotencyKey = parseOwnerLearningStartIdempotencyKey(args.idempotencyKey);
    const result = await startOwnerLearningReview(this.db, {
      ownerUserId,
      agentProfileId,
      gameIds,
      idempotencyKey,
    }, {
      generationEnabled: this.dependencies.generationEnabled,
      projector: this.dependencies.projector,
      now: this.now(),
    });
    const review = result.reviewId
      ? await getOwnedOwnerLearningReview(this.db, { ownerUserId, reviewId: result.reviewId })
      : null;
    return {
      schemaVersion: 2 as const,
      status: mcpStartStatus(result.status),
      unavailableReason: mcpUnavailableReason(result.status),
      paidWorkEnqueued: result.status === "started",
      review: review ? toOwnerLearningMcpReview(review) : null,
      preflight: result.preflight
        ? publicOwnerLearningPreflight(
            result.preflight,
            result.status !== "generation_unavailable",
          )
        : null,
      nextEligibleAt: result.nextEligibleAt,
      remainingLogicalCalls: review
        ? Math.max(0, OWNER_LEARNING_MAX_LOGICAL_CALLS - review.logicalCallCount)
        : OWNER_LEARNING_MAX_LOGICAL_CALLS,
      remainingDives: review
        ? Math.max(0, OWNER_LEARNING_MAX_DIVES - review.diveCount)
        : OWNER_LEARNING_MAX_DIVES,
    };
  }

  async read(ownerUserId: string, rawArgs: unknown) {
    const args = strictArgs(rawArgs, ["reviewId"]);
    const review = await getOwnedOwnerLearningReview(this.db, {
      ownerUserId,
      reviewId: requiredIdentifier(args.reviewId, "reviewId"),
    });
    return { schemaVersion: 1 as const, review: toOwnerLearningMcpReview(review) };
  }

  async retry(ownerUserId: string, rawArgs: unknown) {
    const args = strictArgs(rawArgs, ["reviewId"]);
    const review = await retryOwnedOwnerLearningReview(this.db, {
      ownerUserId,
      reviewId: requiredIdentifier(args.reviewId, "reviewId"),
      now: this.now(),
    });
    return { schemaVersion: 1 as const, review: toOwnerLearningMcpReview(review) };
  }

  async apply(ownerUserId: string, rawArgs: unknown) {
    const args = strictArgs(rawArgs, ["reviewId", "proposalFingerprint"]);
    const reviewId = requiredIdentifier(args.reviewId, "reviewId");
    const proposalFingerprint = requiredIdentifier(
      args.proposalFingerprint,
      "proposalFingerprint",
    );
    return {
      schemaVersion: 1 as const,
      application: await applyOwnedOwnerLearningReview(this.db, {
        ownerUserId,
        reviewId,
        proposalFingerprint,
        now: this.now(),
      }),
    };
  }

  async resolve(ownerUserId: string, rawArgs: unknown) {
    const args = strictArgs(rawArgs, ["reviewId", "resolution"]);
    const reviewId = requiredIdentifier(args.reviewId, "reviewId");
    if (args.resolution !== "declined" && args.resolution !== "failed") {
      throw new Error("resolution must be declined or failed");
    }
    await resolveOwnedOwnerLearningReview(this.db, {
      ownerUserId,
      reviewId,
      resolution: args.resolution,
      now: this.now(),
    });
    const review = await getOwnedOwnerLearningReview(this.db, { ownerUserId, reviewId });
    return { schemaVersion: 1 as const, review: toOwnerLearningMcpReview(review) };
  }
}

export function toOwnerLearningMcpReview(review: OwnerLearningReviewDTO) {
  return {
    ...review,
    result: review.result ? toUntrustedResult(review.result) : null,
    followUps: followUpsForReview(review),
  };
}

function toUntrustedResult(result: OwnerLearningReviewResult) {
  return {
    diagnosis: generatedText(result.diagnosis),
    analysisTrack: result.analysisTrack,
    strategyHealthClassification: result.strategyHealthClassification ?? null,
    recommendations: result.recommendations.map((recommendation) => ({
      id: recommendation.id ?? null,
      title: generatedText(recommendation.title),
      disposition: recommendation.disposition,
      confidence: recommendation.confidence,
      rationale: generatedText(recommendation.rationale),
      keepGuidance: recommendation.keepGuidance
        ? generatedText(recommendation.keepGuidance)
        : null,
      evidenceRefs: recommendation.evidenceRefs,
      proof: recommendation.proof
        ? {
            kind: recommendation.proof.kind,
            rubricCategory: recommendation.proof.rubricCategory ?? null,
            observedEvidence: generatedText(recommendation.proof.observedEvidence),
            strategicInterpretation: generatedText(recommendation.proof.strategicInterpretation),
            proposedGuidance: generatedText(recommendation.proof.proposedGuidance),
            exactGuidanceTarget: generatedText(recommendation.proof.exactGuidanceTarget),
          }
        : null,
    })),
    proposal: result.proposal
      ? {
          field: result.proposal.field,
          before: result.proposal.before,
          after: generatedText(result.proposal.after),
        }
      : null,
    noChange: result.noChange
      ? { rationale: generatedText(result.noChange.rationale) }
      : null,
  };
}

function generatedText(text: string) {
  return { text, contentTrust: OWNER_LEARNING_CONTENT_TRUST };
}

function followUpsForReview(review: OwnerLearningReviewDTO) {
  const refs = review.result?.recommendations.flatMap((recommendation) => recommendation.evidenceRefs) ?? [];
  const unique = new Map<string, ReturnType<typeof followUpForEvidenceRef>>();
  for (const ref of refs) {
    const followUp = followUpForEvidenceRef(ref);
    unique.set(JSON.stringify(followUp), followUp);
  }
  return [...unique.values()];
}

export function followUpForEvidenceRef(ref: OwnerLearningEvidenceRef) {
  if (ref.kind === "dialogue") {
    return {
      evidenceRef: ref,
      toolName: "read_match_transcript" as const,
      arguments: { gameIdOrSlug: ref.gameId },
    };
  }
  if (ref.kind === "decision" || ref.kind === "cognition") {
    return {
      evidenceRef: ref,
      toolName: "read_owned_match_narrative" as const,
      arguments: { gameIdOrSlug: ref.gameId, preset: "strategic", detail: "full" },
    };
  }
  if (ref.kind === "canonical_event") {
    return {
      evidenceRef: ref,
      toolName: "filter_events" as const,
      arguments: { gameIdOrSlug: ref.gameId },
    };
  }
  return {
    evidenceRef: ref,
    toolName: "read_game_brief" as const,
    arguments: { gameIdOrSlug: ref.gameId, detailLevel: "standard", includeEvidence: true },
  };
}

function strictArgs(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool arguments must be an object");
  }
  const args = value as Record<string, unknown>;
  const unsupported = Object.keys(args).find((key) => !allowedKeys.includes(key));
  if (unsupported) throw new Error(`Unsupported field: ${unsupported}`);
  return args;
}

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new Error(`${label} must contain 1-200 characters`);
  }
  return value.trim();
}

function mcpStartStatus(status: string):
  | "created"
  | "resumed"
  | "existing_open_review"
  | "awaiting_evidence"
  | "unavailable" {
  if (status === "started") return "created";
  if (status === "existing_review") return "resumed";
  if (status === "existing_open_review") return "existing_open_review";
  if (status === "awaiting_evidence") return "awaiting_evidence";
  return "unavailable";
}

function mcpUnavailableReason(status: string):
  | "generation_unavailable"
  | "no_credit"
  | null {
  if (status === "rolling_limited") return "no_credit";
  return status === "generation_unavailable" || status === "no_credit" ? status : null;
}
