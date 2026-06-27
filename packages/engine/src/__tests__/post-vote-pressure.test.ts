import { describe, expect, it } from "bun:test";
import { buildPostVotePressureProjection, formatPostVotePressureSummary } from "../post-vote-pressure";
import { createUUID } from "../game-state";

function player(name: string, shielded = false) {
  return { id: createUUID(), name, shielded };
}

describe("post-vote pressure projection", () => {
  it("marks empowered, current at-risk, replacement risk, and safe players", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta],
      empoweredId: alpha.id,
      exposeScores: {
        [alpha.id]: 3,
        [beta.id]: 4,
        [gamma.id]: 2,
        [delta.id]: 1,
      },
    });

    expect(projection).not.toBeNull();
    expect(projection!.empowered.name).toBe("Alpha");
    expect(projection!.currentAtRisk.map((p) => p.name)).toEqual(["Beta", "Gamma"]);
    expect(projection!.replacementRisk.map((p) => p.name)).toEqual(["Delta"]);
    expect(projection!.players.map((p) => [p.name, p.status])).toEqual([
      ["Alpha", "empowered"],
      ["Beta", "locked_at_risk"],
      ["Gamma", "locked_at_risk"],
      ["Delta", "replacement_risk"],
    ]);
  });

  it("excludes shielded and empowered players from current council pressure", () => {
    const alpha = player("Alpha");
    const beta = player("Beta", true);
    const gamma = player("Gamma");
    const delta = player("Delta");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta],
      empoweredId: alpha.id,
      exposeScores: {
        [alpha.id]: 10,
        [beta.id]: 9,
        [gamma.id]: 2,
        [delta.id]: 1,
      },
    });

    expect(projection!.exposePressure.map((p) => p.name)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(projection!.currentAtRisk.map((p) => p.name)).toEqual(["Gamma", "Delta"]);
  });

  it("marks exactly two eligible exposed receivers as locked vote-derived pressure", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const echo = player("Echo");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta, echo],
      empoweredId: alpha.id,
      exposeScores: {
        [beta.id]: 3,
        [gamma.id]: 1,
      },
    });

    expect(projection!.currentAtRisk.map((p) => p.name)).toEqual(["Beta", "Gamma"]);
    expect(projection!.replacementRisk).toEqual([]);
    expect(projection!.fallbackRisk.map((p) => p.name)).toEqual(["Delta", "Echo"]);
    expect(projection!.players.map((p) => [p.name, p.status])).toEqual([
      ["Alpha", "empowered"],
      ["Beta", "locked_at_risk"],
      ["Gamma", "locked_at_risk"],
      ["Delta", "fallback_risk"],
      ["Echo", "fallback_risk"],
    ]);
  });

  it("treats shield pull-up from an exhausted two-player exposure bench as fallback risk", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const echo = player("Echo");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta, echo],
      empoweredId: alpha.id,
      exposeScores: {
        [beta.id]: 3,
        [gamma.id]: 1,
      },
    });

    expect(projection!.shieldScenarios).toEqual([
      {
        shieldedPlayer: { id: beta.id, name: "Beta" },
        resultingAtRisk: [
          { id: gamma.id, name: "Gamma", exposeScore: 1 },
          { id: delta.id, name: "Delta", exposeScore: 0 },
        ],
      },
      {
        shieldedPlayer: { id: gamma.id, name: "Gamma" },
        resultingAtRisk: [
          { id: beta.id, name: "Beta", exposeScore: 3 },
          { id: delta.id, name: "Delta", exposeScore: 0 },
        ],
      },
    ]);
    expect(projection!.fallbackRisk.map((p) => p.name)).toEqual(["Delta", "Echo"]);
    expect(projection!.players.find((p) => p.name === "Delta")?.status).toBe("fallback_risk");
    expect(projection!.players.find((p) => p.name === "Echo")?.status).toBe("fallback_risk");
  });

  it("keeps exposed bench replacement distinct from all-player fallback", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta],
      empoweredId: alpha.id,
      exposeScores: {
        [beta.id]: 4,
        [gamma.id]: 2,
        [delta.id]: 1,
      },
    });

    expect(projection!.players.map((p) => [p.name, p.status])).toEqual([
      ["Alpha", "empowered"],
      ["Beta", "locked_at_risk"],
      ["Gamma", "locked_at_risk"],
      ["Delta", "replacement_risk"],
    ]);
  });

  it("returns null until an empowered player is known", () => {
    const alpha = player("Alpha");

    expect(
      buildPostVotePressureProjection({
        alivePlayers: [alpha],
        empoweredId: null,
        exposeScores: { [alpha.id]: 1 },
      }),
    ).toBeNull();
  });

  it("formats a compact viewer pressure summary", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const echo = player("Echo");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta, echo],
      empoweredId: alpha.id,
      exposeScores: {
        [alpha.id]: 2,
        [beta.id]: 3,
        [gamma.id]: 1,
      },
    });

    expect(formatPostVotePressureSummary(projection!)).toBe(
      "Post-vote pressure: Alpha is empowered. Council candidates: Beta (3), Gamma (1). At-risk if a shield is granted: Delta (0), Echo (0).",
    );
  });

  it("distinguishes locked, empowered-selected, selectable exposed, and fallback risk", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const echo = player("Echo");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta, echo],
      empoweredId: alpha.id,
      exposeScores: {
        [alpha.id]: 3,
        [beta.id]: 4,
        [gamma.id]: 2,
        [delta.id]: 2,
        [echo.id]: 0,
      },
      initialResolution: {
        alivePlayers: [alpha, beta, gamma, delta, echo],
        empoweredId: alpha.id,
        exposeScores: {
          [alpha.id]: 3,
          [beta.id]: 4,
          [gamma.id]: 2,
          [delta.id]: 2,
          [echo.id]: 0,
        },
        exposureBench: [
          { id: beta.id, name: beta.name, exposeScore: 4 },
          { id: delta.id, name: delta.name, exposeScore: 2 },
          { id: gamma.id, name: gamma.name, exposeScore: 2 },
        ],
        rawExposePressure: [],
        lockedCandidates: [beta.id],
        choice: { requiredCount: 1, eligibleCandidateIds: [delta.id, gamma.id], reason: "tied_exposure_tier" },
        selectedCandidateIds: [gamma.id],
        candidates: [beta.id, gamma.id],
        fallbackApplied: false,
        fallbackReason: null,
        mode: "higher_votes_choice",
      },
    });

    expect(projection!.players.map((p) => [p.name, p.status])).toEqual([
      ["Alpha", "empowered"],
      ["Beta", "locked_at_risk"],
      ["Gamma", "empowered_selected"],
      ["Delta", "replacement_risk"],
      ["Echo", "safe"],
    ]);
  });

  it("marks zero-vote players as fallback risk only when all-player fallback can reach them", () => {
    const alpha = player("Alpha");
    const beta = player("Beta");
    const gamma = player("Gamma");
    const delta = player("Delta");
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma, delta],
      empoweredId: alpha.id,
      exposeScores: {
        [beta.id]: 3,
      },
      initialResolution: {
        alivePlayers: [alpha, beta, gamma, delta],
        empoweredId: alpha.id,
        exposeScores: {
          [beta.id]: 3,
        },
        exposureBench: [{ id: beta.id, name: beta.name, exposeScore: 3 }],
        rawExposePressure: [],
        lockedCandidates: [beta.id],
        choice: { requiredCount: 1, eligibleCandidateIds: [delta.id, gamma.id], reason: "one_bench" },
        selectedCandidateIds: [gamma.id],
        candidates: [beta.id, gamma.id],
        fallbackApplied: false,
        fallbackReason: null,
        mode: "one_locked_one_choice",
      },
    });

    expect(projection!.players.map((p) => [p.name, p.status])).toEqual([
      ["Alpha", "empowered"],
      ["Beta", "locked_at_risk"],
      ["Gamma", "empowered_selected"],
      ["Delta", "fallback_risk"],
    ]);
  });
});
