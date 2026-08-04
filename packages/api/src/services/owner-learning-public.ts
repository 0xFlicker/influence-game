import type {
  OwnerLearningReviewPreflight,
  OwnerLearningStartResult,
} from "./owner-learning-review.js";

export function ownerLearningGenerationEnabled(): boolean {
  return ownerLearningDeploymentEnabled() && Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function ownerLearningDeploymentEnabled(): boolean {
  return process.env.INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED?.trim().toLowerCase() !== "true";
}

export function publicOwnerLearningPreflight(
  preflight: OwnerLearningReviewPreflight,
  generationEnabled: boolean,
) {
  return {
    status: preflight.evidence.analysisTrack === "awaiting_evidence"
      ? "awaiting_evidence" as const
      : generationEnabled
        ? "ready" as const
        : "generation_unavailable" as const,
    selection: {
      agentProfileId: preflight.selection.agentProfileId,
      agentProfileName: preflight.selection.agentProfileName,
      reviewedRevisionId: preflight.selection.currentRevisionId,
      gameIds: preflight.selection.games.map((game) => game.gameId),
    },
    evidence: {
      analysisTrack: preflight.evidence.analysisTrack,
      games: preflight.evidence.games.map((game) => ({
        gameId: game.gameId,
        canonicalFacts: game.canonicalFacts,
        candidateMoments: game.candidateMoments,
        narrativeCoverage: game.narrativeCoverage,
        sourceHash: game.sourceHash,
        sourceCaptureVersion: game.sourceCaptureVersion,
      })),
    },
  };
}

export function publicOwnerLearningStart(result: OwnerLearningStartResult) {
  return {
    status: result.status,
    reviewId: result.reviewId,
    nextEligibleAt: result.nextEligibleAt,
    preflight: result.preflight
      ? publicOwnerLearningPreflight(
          result.preflight,
          result.status !== "generation_unavailable",
        )
      : null,
  };
}
