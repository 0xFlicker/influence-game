import { describe, expect, it } from "bun:test";
import {
  resolveInitialExposureBench,
  resolveShieldReplacement,
  type ExposureBenchPlayer,
} from "../exposure-bench";

const players = (...names: string[]): ExposureBenchPlayer[] =>
  names.map((name) => ({ id: name.toLowerCase(), name, shielded: false }));

const scores = (entries: Array<[ExposureBenchPlayer, number]>): Record<string, number> =>
  Object.fromEntries(entries.map(([player, score]) => [player.id, score]));

describe("exposure bench resolver", () => {
  it("returns two all-player unresolved slots when no eligible exposed receivers exist", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[alpha!, 4]]),
    });

    expect(result.mode).toBe("all_player_fallback");
    expect(result.exposureBench).toEqual([]);
    expect(result.lockedCandidates).toEqual([]);
    expect(result.choice.requiredCount).toBe(2);
    expect(result.choice.eligibleCandidateIds).toEqual([beta!.id, delta!.id, gamma!.id]);
    expect(result.selectedCandidateIds).toEqual([beta!.id, delta!.id]);
    expect(result.candidates).toEqual([beta!.id, delta!.id]);
    expect(result.fallbackReason).toBe("bench_too_small");
  });

  it("locks one exposed receiver and leaves one all-player choice outside the lock", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 3]]),
      selectedCandidateIds: [gamma!.id],
    });

    expect(result.mode).toBe("one_locked_one_choice");
    expect(result.lockedCandidates).toEqual([beta!.id]);
    expect(result.choice.requiredCount).toBe(1);
    expect(result.choice.eligibleCandidateIds).toEqual([delta!.id, gamma!.id]);
    expect(result.selectedCandidateIds).toEqual([gamma!.id]);
    expect(result.candidates).toEqual([beta!.id, gamma!.id]);
  });

  it("locks exactly two eligible exposed receivers without choice", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 3], [gamma!, 1]]),
    });

    expect(result.mode).toBe("exposure_locked");
    expect(result.choice.requiredCount).toBe(0);
    expect(result.candidates).toEqual([beta!.id, gamma!.id]);
  });

  it("locks strictly higher tiers and exposes only the unresolved tied tier", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 4], [gamma!, 2], [delta!, 2]]),
      selectedCandidateIds: [delta!.id],
    });

    expect(result.mode).toBe("higher_votes_choice");
    expect(result.lockedCandidates).toEqual([beta!.id]);
    expect(result.choice.requiredCount).toBe(1);
    expect(result.choice.eligibleCandidateIds).toEqual([delta!.id, gamma!.id]);
    expect(result.candidates).toEqual([beta!.id, delta!.id]);
  });

  it("locks a larger bench when the top two tiers are fully ordered", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 4], [gamma!, 3], [delta!, 1]]),
    });

    expect(result.mode).toBe("exposure_locked");
    expect(result.lockedCandidates).toEqual([beta!.id, gamma!.id]);
    expect(result.choice.requiredCount).toBe(0);
    expect(result.candidates).toEqual([beta!.id, gamma!.id]);
  });

  it("asks for two choices from a tied top tier with more than two players", () => {
    const [alpha, beta, gamma, delta, echo] = players("Alpha", "Beta", "Gamma", "Delta", "Echo");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!, echo!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 2], [gamma!, 2], [delta!, 2], [echo!, 1]]),
      selectedCandidateIds: [gamma!.id, delta!.id],
    });

    expect(result.mode).toBe("higher_votes_choice");
    expect(result.lockedCandidates).toEqual([]);
    expect(result.choice.requiredCount).toBe(2);
    expect(result.choice.eligibleCandidateIds).toEqual([beta!.id, delta!.id, gamma!.id]);
    expect(result.candidates).toEqual([gamma!.id, delta!.id]);
  });

  it("preserves raw expose votes against empowered but excludes them from the bench", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[alpha!, 5], [beta!, 2], [gamma!, 1]]),
    });

    expect(result.rawExposePressure.map((entry) => [entry.id, entry.exposeScore])).toEqual([
      [alpha!.id, 5],
      [beta!.id, 2],
      [gamma!.id, 1],
      [delta!.id, 0],
    ]);
    expect(result.exposureBench.map((entry) => entry.id)).toEqual([beta!.id, gamma!.id]);
    expect(result.candidates).toEqual([beta!.id, gamma!.id]);
  });

  it("uses deterministic fallback for invalid selections while preserving constraints", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const result = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 4], [gamma!, 2], [delta!, 2]]),
      selectedCandidateIds: [alpha!.id],
    });

    expect(result.fallbackApplied).toBe(true);
    expect(result.fallbackReason).toBe("invalid_selection");
    expect(result.candidates).toEqual([beta!.id, delta!.id]);
  });

  it("replaces a protected candidate from the remaining exposure bench before fallback", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const initial = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 4], [gamma!, 2], [delta!, 2]]),
      selectedCandidateIds: [gamma!.id],
    });

    const replacement = resolveShieldReplacement({
      initialResolution: initial,
      protectedCandidateId: gamma!.id,
      selectedCandidateIds: [delta!.id],
    });

    expect(replacement.mode).toBe("bench_replacement_locked");
    expect(replacement.choice.eligibleCandidateIds).toEqual([delta!.id]);
    expect(replacement.candidates).toEqual([beta!.id, delta!.id]);
    expect(replacement.fallbackReason).toBeNull();
  });

  it("uses all-player fallback when shield replacement exhausts the bench", () => {
    const [alpha, beta, gamma, delta] = players("Alpha", "Beta", "Gamma", "Delta");
    const initial = resolveInitialExposureBench({
      alivePlayers: [alpha!, beta!, gamma!, delta!],
      empoweredId: alpha!.id,
      exposeScores: scores([[beta!, 4], [gamma!, 2]]),
    });

    const replacement = resolveShieldReplacement({
      initialResolution: initial,
      protectedCandidateId: gamma!.id,
      selectedCandidateIds: [delta!.id],
    });

    expect(replacement.mode).toBe("all_player_fallback_replacement");
    expect(replacement.choice.eligibleCandidateIds).toEqual([delta!.id]);
    expect(replacement.candidates).toEqual([beta!.id, delta!.id]);
    expect(replacement.fallbackReason).toBe("bench_exhausted");
  });
});
