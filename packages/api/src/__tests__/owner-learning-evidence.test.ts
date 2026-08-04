import { describe, expect, test } from "bun:test";
import {
  OWNER_LEARNING_INPUT_TOKEN_LIMIT,
  buildBudgetedOwnerLearningProviderInput,
  buildBudgetedOwnerLearningInput,
  estimateOwnerLearningInputTokens,
  mintOwnerLearningMomentId,
  resolveOwnerLearningMoment,
} from "../services/owner-learning-evidence.js";

describe("owner learning evidence", () => {
  test("mints stable opaque moment IDs from durable coordinates", () => {
    const coordinate = {
      gameId: "game-1",
      reviewedAgentProfileId: "profile-1",
      evidenceVersion: "owner-learning-evidence-v1",
      anchorKind: "decision" as const,
      sourceCoordinate: "decision:3c6a",
      windowVersion: "owner-learning-window-v1",
    };
    const first = mintOwnerLearningMomentId(coordinate);
    expect(mintOwnerLearningMomentId({ ...coordinate })).toBe(first);
    expect(mintOwnerLearningMomentId({
      ...coordinate,
      sourceCoordinate: "decision:other",
    })).not.toBe(first);
    expect(first).toMatch(/^olm_[A-Za-z0-9_-]{43}$/);
  });

  test("resolves only server-issued candidates", () => {
    const candidate = {
      id: "olm_candidate",
      gameId: "game-1",
      anchorKind: "canonical_event" as const,
      sourceCoordinate: "event:12",
      sourceHash: "sha256:source",
      round: 2,
      phase: "VOTE",
    };
    expect(resolveOwnerLearningMoment([candidate], candidate.id)).toEqual(candidate);
    expect(() => resolveOwnerLearningMoment([candidate], "olm_invented")).toThrow(
      "not part of this review",
    );
  });

  test("uses one estimator and retains every game when narratives need truncation", () => {
    const input = buildBudgetedOwnerLearningInput({
      instructions: "Analyze only the supplied evidence.",
      currentStrategyStyle: "Build trust before committing.",
      games: ["game-1", "game-2", "game-3"].map((gameId) => ({
        gameId,
        canonicalFacts: { placement: 4, eliminatedRound: 2 },
        candidateMomentIds: [`${gameId}:moment`],
        narrativeGroups: Array.from({ length: 120 }, (_, index) => ({
          corr: "exact" as const,
          decisionId: `${gameId}:decision:${index}`,
          text: "x".repeat(600),
          thinking: "y".repeat(600),
        })),
      })),
    });

    expect(estimateOwnerLearningInputTokens(input)).toBeLessThanOrEqual(
      OWNER_LEARNING_INPUT_TOKEN_LIMIT,
    );
    expect(input.games.map((game) => game.gameId)).toEqual(["game-1", "game-2", "game-3"]);
    expect(input.games.every((game) => game.omittedNarrativeGroupCount > 0)).toBe(true);
    expect(input.games.every((game) => game.candidateMomentIds.length === 1)).toBe(true);

    const providerInput = buildBudgetedOwnerLearningProviderInput("scanning_narratives", {
      analysisTrack: "strategy_health_check",
      evidence: input,
      issuedEvidenceRefs: Array.from({ length: 60 }, (_, index) => ({
        kind: "canonical_event",
        gameId: `game-${index % 3 + 1}`,
        coordinate: `olm_${"z".repeat(43)}_${index}`,
        sourceHash: `sha256:${"a".repeat(64)}`,
        sourceVersion: "owner-learning-evidence-v1",
      })),
    });
    expect(estimateOwnerLearningInputTokens(providerInput)).toBeLessThanOrEqual(
      OWNER_LEARNING_INPUT_TOKEN_LIMIT,
    );
    const providerTurn = providerInput.turn as { evidence: typeof input };
    expect(providerTurn.evidence.games.map((game) => game.gameId)).toEqual([
      "game-1",
      "game-2",
      "game-3",
    ]);
    expect(providerTurn.evidence.games.every((game) => game.omittedNarrativeGroupCount > 0)).toBe(true);
  });
});
