import { describe, expect, test } from "bun:test";
import {
  championshipSchedule, compareChampionshipScores, createBalancedRoleSchedule,
  EMPTY_CHAMPIONSHIP_POLICIES, SEASON_ZERO_CHAMPIONSHIP_POLICIES, publicRoleLineups, qualifyAgents, SEASON_ZERO_AWARDS,
  unresolvedChampionshipPolicies, type RoleComposition,
} from "../championship";

const ids = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
const composition: RoleComposition = { werewolf: 2, seer: 1, doctor: 1, villager: 4 };
const standings = ids.map((agentId, index) => ({ agentId, ownerId: "same-owner", name: agentId, rank: index + 1, seasonPoints: 1000 - index }));

describe("championship contract", () => {
  test("17 midnight UTC starts cross month/year boundaries without changing cadence", () => {
    const schedule = championshipSchedule("2026-12-25");
    expect(schedule).toHaveLength(17);
    expect(schedule[15]).toEqual({ ordinal: 16, kind: "werewolf", scheduledAt: "2027-01-09T00:00:00.000Z" });
    expect(schedule[16]).toEqual({ ordinal: 17, kind: "influence", scheduledAt: "2027-01-10T00:00:00.000Z" });
    expect(schedule.every(row => row.scheduledAt.endsWith("T00:00:00.000Z"))).toBe(true);
    expect(() => championshipSchedule("2026-02-30")).toThrow();
    expect(() => championshipSchedule("2026-12-25T18:00:00Z")).toThrow();
  });
  test("qualification follows agent rank without an owner cap and rejects filler fields", () => {
    expect(qualifyAgents([...standings].reverse())).toEqual(standings);
    expect(() => qualifyAgents(standings.slice(0, 6))).toThrow("Eight ranked");
    expect(() => qualifyAgents([...standings, standings[0]!])).toThrow();
  });
  test("every agent receives every enabled role with exact balance across 16 matches", () => {
    for (const seed of ["one", "two", "three"]) {
      const schedule = createBalancedRoleSchedule(ids, composition, seed);
      expect(schedule.matches).toHaveLength(16);
      for (const id of ids) {
        const counts: Record<string, number> = { werewolf: 0, seer: 0, doctor: 0, villager: 0 };
        for (const match of schedule.matches) counts[match.roles[id]!] = (counts[match.roles[id]!] ?? 0) + 1;
        expect(counts).toEqual({ werewolf: 4, seer: 2, doctor: 2, villager: 8 });
      }
      for (const match of schedule.matches) {
        expect(Object.keys(match.roles).sort()).toEqual(ids);
        for (const [role, count] of Object.entries(composition)) expect(Object.values(match.roles).filter(value => value === role)).toHaveLength(count);
      }
      expect(createBalancedRoleSchedule([...ids].reverse(), composition, seed)).toEqual(schedule);
      expect(schedule.metrics.repeatedLineups).toBe(0);
    }
  });
  test("public lineups have no seed, ordinals, schedule or private metadata", () => {
    const schedule = createBalancedRoleSchedule(ids, composition, "private-seed");
    const publicRows = publicRoleLineups(schedule);
    expect(publicRows).toHaveLength(16);
    expect(publicRows.every(row => Object.keys(row).sort().join(",") === "id,roles")).toBe(true);
    expect(publicRows.map(row => row.id)).not.toEqual(schedule.matches.map(row => row.id));
    expect(JSON.stringify(publicRows)).not.toContain("private-seed");
    publicRows[0]!.roles[ids[0]!] = "werewolf";
    expect(publicRoleLineups(schedule)).not.toBe(publicRows);
  });
  test("unanswered policy stays explicit, including equal-score fallback", () => {
    expect(unresolvedChampionshipPolicies(EMPTY_CHAMPIONSHIP_POLICIES)).toHaveLength(5);
    const first = { ...standings[0]!, points: 5 };
    const next = { ...standings[1]!, points: 5 };
    expect(compareChampionshipScores(first, next, null)).toBeLessThan(0);
    expect(compareChampionshipScores({ ...first, points: 4 }, next, null)).toBeGreaterThan(0);
    expect(() => compareChampionshipScores(first, { ...next, seasonPoints: first.seasonPoints }, null)).toThrow("explicit tie policy");
    expect(compareChampionshipScores(first, { ...next, seasonPoints: first.seasonPoints }, "season_rank")).toBeLessThan(0);
  });
  test("point policies reject values that cannot be stored by result settlement", () => {
    expect(() => unresolvedChampionshipPolicies({ ...EMPTY_CHAMPIONSHIP_POLICIES, points: { win: 2_147_483_648, loss: 0, draw: 0 } })).toThrow("32-bit");
    expect(unresolvedChampionshipPolicies({ ...EMPTY_CHAMPIONSHIP_POLICIES, points: { win: 2_147_483_647, loss: 0, draw: 0 } })).not.toContain("points");
  });
  test("confirmed scoring supports exact half points and shared champions after the season tie-break", () => {
    expect(SEASON_ZERO_CHAMPIONSHIP_POLICIES.roleComposition).toEqual(composition);
    expect(SEASON_ZERO_CHAMPIONSHIP_POLICIES.participationMinimumCompletedGames).toBe(1);
    expect(SEASON_ZERO_CHAMPIONSHIP_POLICIES.points).toEqual({ win: 1, loss: 0, draw: 0.5 });
    expect(unresolvedChampionshipPolicies(SEASON_ZERO_CHAMPIONSHIP_POLICIES)).toEqual([]);
    expect(SEASON_ZERO_CHAMPIONSHIP_POLICIES.ownerAttribution).toBe("qualification");
    const first = { ...standings[0]!, points: 8.5 };
    const second = { ...standings[1]!, points: 8.5, seasonPoints: first.seasonPoints };
    expect(compareChampionshipScores(first, second, "shared_place")).toBe(0);
    expect(compareChampionshipScores(first, { ...second, seasonPoints: 1 }, "shared_place")).toBeLessThan(0);
    for (const draw of [0.1, 0.25, -0.5, NaN, Infinity]) expect(() => unresolvedChampionshipPolicies({ ...SEASON_ZERO_CHAMPIONSHIP_POLICIES, points: { win: 1, loss: 0, draw } })).toThrow("half-point");
  });
  test("all approved award contexts have distinct keys and Season 0 names", () => {
    expect(new Set(SEASON_ZERO_AWARDS.map(row => row.code)).size).toBe(10);
    expect(SEASON_ZERO_AWARDS.every(row => row.title.startsWith("Season 0"))).toBe(true);
    expect(SEASON_ZERO_AWARDS.filter(row => row.code.includes("champions-architect"))).toHaveLength(3);
    expect(SEASON_ZERO_AWARDS.filter(row => row.code.includes("participant"))).toHaveLength(2);
  });
});
