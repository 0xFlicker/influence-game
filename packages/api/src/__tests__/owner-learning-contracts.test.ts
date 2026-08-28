import { describe, expect, test } from "bun:test";
import {
  fingerprintOwnerLearningRequest,
  fingerprintOwnerLearningValue,
  parseOwnerLearningReviewResult,
  parseOwnerLearningStartIdempotencyKey,
} from "../services/owner-learning-contracts.js";

describe("owner learning contracts", () => {
  test("bounds and normalizes start idempotency keys", () => {
    expect(parseOwnerLearningStartIdempotencyKey(`  ${"x".repeat(200)}  `)).toBe("x".repeat(200));
    for (const invalid of ["", "   ", "x".repeat(201)]) {
      expect(() => parseOwnerLearningStartIdempotencyKey(invalid)).toThrow("idempotency key");
    }
  });

  test("validates a bounded strategy health result", () => {
    const result = parseOwnerLearningReviewResult({
      diagnosis: "The agent concedes voting initiative too early.",
      analysisTrack: "strategy_health_check",
      recommendations: [{
        title: "Own the first voting plan",
        disposition: "change",
        confidence: "medium",
        rationale: "The same gap appears across the selected games.",
        evidenceRefs: [
          { kind: "canonical_event", gameId: "game-1", coordinate: "round:1:vote.cast:1", sourceHash: "sha256:a", sourceVersion: "v1" },
          { kind: "canonical_event", gameId: "game-2", coordinate: "round:1:vote.cast:2", sourceHash: "sha256:b", sourceVersion: "v1" },
        ],
        proof: {
          kind: "combined",
          rubricCategory: "missing_vote_plan",
          observedEvidence: "The agent followed another player's target in both cited games.",
          strategicInterpretation: "Waiting ceded agenda control before trust was established.",
          proposedGuidance: "Name a preferred target and one fallback before asking allies to commit.",
          exactGuidanceTarget: "Voting priorities",
        },
      }],
      proposal: {
        field: "strategyStyle",
        before: "Build trust.",
        after: "Build trust, then name a preferred target and fallback before the first vote.",
      },
    });

    expect(result.analysisTrack).toBe("strategy_health_check");
    expect(result.recommendations).toHaveLength(1);
  });

  test("preserves exact server provenance while normalizing the replacement", () => {
    const result = parseOwnerLearningReviewResult({
      diagnosis: "The agent waits too long to convert trust into a voting plan.",
      analysisTrack: "evidence_rich",
      recommendations: [{
        title: "Make the voting plan explicit",
        disposition: "change",
        confidence: "high",
        rationale: "The selected game shows trust without a concrete commitment.",
        evidenceRefs: [{
          kind: "canonical_event",
          gameId: "game-1",
          coordinate: "round:1:vote.cast:1",
          sourceHash: "sha256:a",
          sourceVersion: "v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before: " \n Build trust before committing.\t",
        after: "\tBuild trust, then name a preferred target and fallback. \n",
      },
    });

    expect(result.proposal).toEqual({
      field: "strategyStyle",
      before: " \n Build trust before committing.\t",
      after: "Build trust, then name a preferred target and fallback.",
    });
    expect(fingerprintOwnerLearningValue({ reviewId: "review-1", proposal: result.proposal })).toBe(
      fingerprintOwnerLearningValue({
        reviewId: "review-1",
        proposal: {
          field: "strategyStyle",
          before: " \n Build trust before committing.\t",
          after: "Build trust, then name a preferred target and fallback.",
        },
      }),
    );
  });

  test("applies the replacement length limit after trimming transport whitespace", () => {
    const before = "b".repeat(2_000);
    const after = "a".repeat(2_000);
    const result = parseOwnerLearningReviewResult({
      diagnosis: "Diagnosis",
      analysisTrack: "evidence_rich",
      recommendations: [{
        title: "Recommendation",
        disposition: "change",
        confidence: "medium",
        rationale: "Rationale",
        evidenceRefs: [{
          kind: "canonical_event",
          gameId: "game-1",
          coordinate: "event:1",
          sourceHash: "sha256:a",
          sourceVersion: "v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before,
        after: `\t${after}\n `,
      },
    });

    expect(result.proposal).toEqual({ field: "strategyStyle", before, after });
  });

  test("rejects a proposal whose only change is whitespace", () => {
    expect(() => parseOwnerLearningReviewResult({
      diagnosis: "Diagnosis",
      analysisTrack: "evidence_rich",
      recommendations: [{
        title: "Recommendation",
        disposition: "change",
        confidence: "medium",
        rationale: "Rationale",
        evidenceRefs: [{
          kind: "canonical_event",
          gameId: "game-1",
          coordinate: "event:1",
          sourceHash: "sha256:a",
          sourceVersion: "v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before: "  Build trust before committing.\n",
        after: "\tBuild trust before committing.  ",
      },
    })).toThrow("must change strategyStyle");
  });

  test("rejects generated field overflow and arbitrary proposal fields", () => {
    const base = {
      diagnosis: "Diagnosis",
      analysisTrack: "strategy_health_check",
      recommendations: [{
        title: "Recommendation",
        disposition: "change",
        confidence: "medium",
        rationale: "Rationale",
        evidenceRefs: [
          { kind: "canonical_event", gameId: "game-1", coordinate: "event:1", sourceHash: "sha256:a", sourceVersion: "v1" },
          { kind: "canonical_event", gameId: "game-2", coordinate: "event:2", sourceHash: "sha256:b", sourceVersion: "v1" },
        ],
        proof: {
          kind: "observed_pattern",
          observedEvidence: "x".repeat(801),
          strategicInterpretation: "Interpretation",
          proposedGuidance: "Guidance",
          exactGuidanceTarget: "Target",
        },
      }],
      proposal: { field: "personality", before: "a", after: "b" },
    };

    expect(() => parseOwnerLearningReviewResult(base)).toThrow("observedEvidence");
    expect(() => parseOwnerLearningReviewResult({
      ...base,
      recommendations: [{
        ...base.recommendations[0],
        proof: { ...base.recommendations[0]!.proof, observedEvidence: "Evidence" },
      }],
    })).toThrow("strategyStyle");
  });

  test("fingerprints canonical values and excludes only transport policy fields", () => {
    expect(fingerprintOwnerLearningValue({ b: 2, a: 1 })).toBe(
      fingerprintOwnerLearningValue({ a: 1, b: 2 }),
    );

    const semantic = {
      model: "openai:gpt-5.6-luna",
      instructions: "review",
      input: { games: ["game-1"] },
      responseSchema: { type: "object" },
      maxOutputTokens: 8000,
      reasoning: { effort: "low" },
      store: false,
      serviceTier: "flex",
      transportHeaders: { "x-request-id": "one" },
    };
    expect(fingerprintOwnerLearningRequest(semantic)).toBe(
      fingerprintOwnerLearningRequest({
        ...semantic,
        serviceTier: "auto",
        transportHeaders: { "x-request-id": "two" },
      }),
    );
    expect(fingerprintOwnerLearningRequest(semantic)).not.toBe(
      fingerprintOwnerLearningRequest({ ...semantic, maxOutputTokens: 7999 }),
    );
  });
});
