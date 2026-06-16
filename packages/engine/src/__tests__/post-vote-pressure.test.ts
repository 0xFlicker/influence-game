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
      ["Beta", "current_at_risk"],
      ["Gamma", "current_at_risk"],
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
    const projection = buildPostVotePressureProjection({
      alivePlayers: [alpha, beta, gamma],
      empoweredId: alpha.id,
      exposeScores: {
        [alpha.id]: 2,
        [beta.id]: 3,
        [gamma.id]: 1,
      },
    });

    expect(formatPostVotePressureSummary(projection!)).toBe(
      "Post-vote pressure: Alpha is empowered. Current at-risk: Beta (3), Gamma (1). Replacement risk if a shield is granted: none.",
    );
  });
});
