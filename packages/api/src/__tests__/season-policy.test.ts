import { describe, expect, test } from "bun:test";
import {
  INITIAL_COMPETITION_SIGMA,
  MAX_STRONG_FIELD_BONUS_RATE,
  calculateArchitectScore,
  calculateBasePlacementPoints,
  calculateChampionshipPointAward,
  calculateStrongFieldBonus,
  compareAgentStandings,
  compareArchitectStandings,
  earliestFinalTotalReachedAt,
  initialCompetitionRating,
  rateCompetitionField,
  type CompetitionRating,
} from "../services/season-policy.js";

describe("season scoring policy v1", () => {
  test("keeps a win at least twice as valuable as any non-winning base award", () => {
    for (const totalPlayers of [4, 8, 12]) {
      const points = Array.from({ length: totalPlayers }, (_, index) =>
        calculateBasePlacementPoints(index + 1, totalPlayers)
      );
      expect(points[0]).toBe(100);
      expect(Math.max(...points.slice(1))).toBeLessThanOrEqual(50);
      expect(points.at(-1)).toBe(0);
      for (let index = 1; index < points.length; index += 1) {
        expect(points[index]).toBeLessThanOrEqual(points[index - 1]!);
        expect(points[index]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("normalizes the same relative finish across lobby sizes", () => {
    expect(calculateBasePlacementPoints(2, 4)).toBe(22);
    expect(calculateBasePlacementPoints(3, 8)).toBe(26);
    expect(calculateBasePlacementPoints(4, 12)).toBe(26);
  });

  test("rejects impossible placement inputs", () => {
    expect(() => calculateBasePlacementPoints(0, 4)).toThrow();
    expect(() => calculateBasePlacementPoints(5, 4)).toThrow();
    expect(() => calculateBasePlacementPoints(1, 1)).toThrow();
  });

  test("never penalizes a weak field or awards quality points to a zero base", () => {
    const weakRating = { mu: 10, sigma: 8 };
    expect(calculateStrongFieldBonus(100, [weakRating]).fieldBonus).toBe(0);
    expect(calculateStrongFieldBonus(0, [{ mu: 100, sigma: 1 }]).fieldBonus).toBe(0);
  });

  test("caps the strong-field bonus at twenty percent", () => {
    const veryStrong = { mu: 100, sigma: 1 };
    const result = calculateStrongFieldBonus(100, [veryStrong, veryStrong]);
    expect(result.fieldBonus).toBe(20);
    expect(result.evidence.bonusRate).toBe(MAX_STRONG_FIELD_BONUS_RATE);
  });

  test("returns a public award and serializable private evidence", () => {
    const result = calculateChampionshipPointAward({
      placement: 1,
      totalPlayers: 4,
      opponentRatings: [{ mu: 35, sigma: 5 }],
    });
    expect(result).toMatchObject({ basePoints: 100, fieldBonus: 20, totalPoints: 120 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test("weights only the top three architect agents with stable ties", () => {
    const result = calculateArchitectScore([
      { agentId: "zeta", totalPoints: 45 },
      { agentId: "alpha", totalPoints: 45 },
      { agentId: "beta", totalPoints: 45 },
      { agentId: "unused", totalPoints: 10 },
    ]);
    expect(result.contributions.map((entry) => entry.agentId)).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
    expect(result.totalPointsHundredths).toBe(7_875);
  });

  test("matches the confirmed 100 versus 78.75 architect example", () => {
    expect(calculateArchitectScore([{ agentId: "solo", totalPoints: 100 }]).totalPointsHundredths)
      .toBe(10_000);
    expect(calculateArchitectScore([
      { agentId: "one", totalPoints: 45 },
      { agentId: "two", totalPoints: 45 },
      { agentId: "three", totalPoints: 45 },
    ]).totalPointsHundredths).toBe(7_875);
  });
});

describe("competition rating policy v1", () => {
  test("uses the confirmed initial distribution", () => {
    expect(initialCompetitionRating()).toEqual({ mu: 25, sigma: INITIAL_COMPETITION_SIGMA });
  });

  test("updates a ranked multiplayer field deterministically", () => {
    const seats = [
      { id: "winner", placement: 1, rating: initialCompetitionRating() },
      { id: "second", placement: 2, rating: initialCompetitionRating() },
      { id: "third", placement: 3, rating: initialCompetitionRating() },
      { id: "last", placement: 4, rating: initialCompetitionRating() },
    ];
    const first = rateCompetitionField(seats);
    const second = rateCompetitionField(seats);
    expect(first).toEqual(second);
    expect(first[0]!.after.mu).toBeGreaterThan(first[1]!.after.mu);
    expect(first[1]!.after.mu).toBeGreaterThan(first[2]!.after.mu);
    expect(first[2]!.after.mu).toBeGreaterThan(first[3]!.after.mu);
  });

  test("accepts ties but rejects duplicate seat identities", () => {
    const tied = rateCompetitionField([
      { id: "a", placement: 1, rating: initialCompetitionRating() },
      { id: "b", placement: 1, rating: initialCompetitionRating() },
      { id: "c", placement: 3, rating: initialCompetitionRating() },
    ]);
    expect(tied[0]!.after).toEqual(tied[1]!.after);
    expect(() => rateCompetitionField([
      { id: "same", placement: 1, rating: initialCompetitionRating() },
      { id: "same", placement: 2, rating: initialCompetitionRating() },
    ])).toThrow("unique");
  });

  test("rejects malformed ratings", () => {
    const invalid = { mu: 25, sigma: 0 } satisfies CompetitionRating;
    expect(() => rateCompetitionField([
      { id: "a", placement: 1, rating: invalid },
      { id: "b", placement: 2, rating: initialCompetitionRating() },
    ])).toThrow("positive sigma");
  });
});

describe("standing tie-break policy", () => {
  test("uses the first time the final total was reached despite later zero-point receipts", () => {
    expect(earliestFinalTotalReachedAt([
      { id: "one", totalPoints: 100, earnedAt: "2026-07-10T00:00:00.000Z" },
      { id: "two", totalPoints: 0, earnedAt: "2026-07-12T00:00:00.000Z" },
    ])).toBe("2026-07-10T00:00:00.000Z");
  });

  test("orders agent standings by the published competitive tie-breaks", () => {
    const base = {
      totalPoints: 100,
      wins: 1,
      runnerUpFinishes: 0,
      averageNormalizedPlacement: 0.5,
      tiedTotalReachedAt: "2026-07-10T00:00:00.000Z",
    };
    const standings = [
      { ...base, agentId: "later-win", wins: 2, tiedTotalReachedAt: "2026-07-11T00:00:00.000Z" },
      { ...base, agentId: "first" },
    ].sort(compareAgentStandings);
    expect(standings[0]!.agentId).toBe("later-win");
  });

  test("orders architect standings by contribution quality before stable ID", () => {
    const base = {
      totalPointsHundredths: 10_000,
      contributingWins: 2,
      firstAgentPoints: 75,
      tiedTotalReachedAt: "2026-07-10T00:00:00.000Z",
    };
    const standings = [
      { ...base, ownerId: "alpha" },
      { ...base, ownerId: "higher-top-agent", firstAgentPoints: 100 },
    ].sort(compareArchitectStandings);
    expect(standings[0]!.ownerId).toBe("higher-top-agent");
  });
});
