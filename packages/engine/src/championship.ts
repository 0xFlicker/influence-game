/** Reusable competition policy. No game execution, providers or monetary admission rules. */
import { createHash } from "node:crypto";
import { seededRandom } from "./seeded-random";
import type { WerewolfRole } from "./werewolf/types";

export const CHAMPIONSHIP_POLICY_VERSION = "season-0-v1";
export const ROLE_SCHEDULE_VERSION = "balanced-roles-v1";
export const FINALIST_COUNT = 8;
export const WEREWOLF_MATCH_COUNT = 16;
export type RoleComposition = Record<WerewolfRole, number>;
export type ChampionshipPolicies = {
  roleComposition: RoleComposition | null;
  points: { win: number; loss: number; draw: number } | null;
  equalScoreFallback: "season_rank" | "shared_place" | null;
  participationMinimumCompletedGames: number | null;
  ownerAttribution: "qualification" | "award" | null;
};
export const EMPTY_CHAMPIONSHIP_POLICIES: ChampionshipPolicies = {
  roleComposition: null, points: null, equalScoreFallback: null,
  participationMinimumCompletedGames: null, ownerAttribution: null,
};
export type Qualification = { agentId: string; ownerId: string; name: string; rank: number; seasonPoints: number };
export type RoleLineup = { id: string; roles: Record<string, WerewolfRole> };
/** Server-private: never serialize this type to spectators or contestants. */
export type PrivateRoleSchedule = {
  version: typeof ROLE_SCHEDULE_VERSION; seed: string; agentIds: string[];
  composition: RoleComposition; matches: RoleLineup[];
  metrics: { repeatedWolfPairs: number; repeatedLineups: number; consecutiveRoles: number };
};
export type PublicRoleLineup = RoleLineup;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function validateRoleComposition(composition: RoleComposition): void {
  const keys = Object.keys(composition).sort().join(",");
  if (keys !== "doctor,seer,villager,werewolf" || Object.values(composition).some(n => !Number.isInteger(n) || n < 0)
    || ![1, 2].includes(composition.werewolf) || composition.seer > 1 || composition.doctor > 1
    || Object.values(composition).reduce((a, b) => a + b, 0) !== FINALIST_COUNT) {
    throw new Error("Choose an eight-agent role composition with one or two wolves and at most one seer and doctor");
  }
}

/** Two complete cyclic blocks guarantee exact per-role counts, regardless of variety optimization. */
export function createBalancedRoleSchedule(agentIds: readonly string[], composition: RoleComposition, seed: string): PrivateRoleSchedule {
  validateRoleComposition(composition);
  if (agentIds.length !== FINALIST_COUNT || new Set(agentIds).size !== FINALIST_COUNT || agentIds.some(id => !id.trim()) || !seed.trim()) {
    throw new Error("Balanced role selection requires eight distinct agents and a seed");
  }
  const ids = [...agentIds].sort();
  const roles = (Object.keys(composition).sort() as WerewolfRole[]).flatMap(role => Array<WerewolfRole>(composition[role]).fill(role));
  const random = seededRandom(digest([ROLE_SCHEDULE_VERSION, "selection", seed, ids, roles]));
  let best: PrivateRoleSchedule | undefined;
  let bestScore = Infinity;
  // Fixed search budget is algorithmic determinism, not a gameplay/spending limit.
  for (let candidate = 0; candidate < 256; candidate++) {
    const lineups: RoleLineup[] = [];
    for (let block = 0; block < 2; block++) {
      const ring = shuffle(ids, random);
      const slots = shuffle(roles, random);
      for (let offset = 0; offset < FINALIST_COUNT; offset++) {
        const assigned = Object.fromEntries(ids.map(id => [id, slots[(ring.indexOf(id) + offset) % FINALIST_COUNT]!])) as Record<string, WerewolfRole>;
        lineups.push({ id: digest([ROLE_SCHEDULE_VERSION, "public-lineup", seed, candidate, block, offset]).slice(0, 32), roles: assigned });
      }
    }
    const orderRandom = seededRandom(digest([ROLE_SCHEDULE_VERSION, "private-order", seed, candidate]));
    const matches = shuffle(lineups, orderRandom);
    const metrics = roleScheduleMetrics(matches, ids);
    const score = metrics.repeatedLineups * 100000 + metrics.repeatedWolfPairs * 1000 + metrics.consecutiveRoles;
    if (score < bestScore) {
      bestScore = score;
      best = { version: ROLE_SCHEDULE_VERSION, seed, agentIds: ids, composition: { ...composition }, matches, metrics };
    }
  }
  return best!;
}
function roleScheduleMetrics(matches: RoleLineup[], agentIds: string[]): PrivateRoleSchedule["metrics"] {
  const pairs = new Set<string>(), lineups = new Set<string>();
  let repeatedWolfPairs = 0, repeatedLineups = 0, consecutiveRoles = 0;
  for (const [index, match] of matches.entries()) {
    const wolves = agentIds.filter(id => match.roles[id] === "werewolf");
    if (wolves.length === 2) {
      const key = JSON.stringify(wolves);
      if (pairs.has(key)) repeatedWolfPairs++;
      pairs.add(key);
    }
    const key = JSON.stringify(agentIds.map(id => match.roles[id]));
    if (lineups.has(key)) repeatedLineups++;
    lineups.add(key);
    if (index > 0) consecutiveRoles += agentIds.filter(id => matches[index - 1]!.roles[id] === match.roles[id]).length;
  }
  return { repeatedWolfPairs, repeatedLineups, consecutiveRoles };
}
/** Explicit allowlist; public ordering is independent of the scheduled match order. */
export function publicRoleLineups(schedule: PrivateRoleSchedule): PublicRoleLineup[] {
  return schedule.matches.map(({ id, roles }) => ({ id, roles: { ...roles } })).sort((a, b) => a.id.localeCompare(b.id));
}
export function championshipSchedule(startDate: string): Array<{ ordinal: number; kind: "werewolf" | "influence"; scheduledAt: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Choose a UTC calendar date (YYYY-MM-DD)");
  const first = Date.parse(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(first) || new Date(first).toISOString().slice(0, 10) !== startDate) throw new Error("Invalid calendar date");
  return Array.from({ length: 17 }, (_, index) => ({
    ordinal: index + 1, kind: index === 16 ? "influence" : "werewolf",
    scheduledAt: new Date(first + index * 86_400_000).toISOString(),
  }));
}
export function qualifyAgents(standings: readonly Qualification[]): Qualification[] {
  const ordered = [...standings].sort((a, b) => a.rank - b.rank);
  if (new Set(ordered.map(row => row.agentId)).size !== ordered.length || new Set(ordered.map(row => row.rank)).size !== ordered.length
    || ordered.some(row => !row.agentId || !row.ownerId || !Number.isSafeInteger(row.rank) || row.rank < 1 || !Number.isSafeInteger(row.seasonPoints))) {
    throw new Error("Invalid qualification evidence");
  }
  if (ordered.length < FINALIST_COUNT) throw new Error("Eight ranked agents are needed; no automatic filler agents");
  return ordered.slice(0, FINALIST_COUNT).map(row => ({ ...row }));
}
/** Parse without defaults: unanswered decisions are null, malformed or extra fields are errors. */
export function parseChampionshipPolicies(value: unknown): ChampionshipPolicies {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "equalScoreFallback,ownerAttribution,participationMinimumCompletedGames,points,roleComposition") throw new Error("Explicit policy fields are required; unanswered decisions must be null");
  const input = value as Record<string, unknown>;
  for (const key of ["points", "roleComposition"]) {
    if (input[key] !== null && (!input[key] || typeof input[key] !== "object" || Array.isArray(input[key]))) throw new Error(`${key} must be an object or null`);
  }
  if (input.equalScoreFallback !== null && !["season_rank", "shared_place"].includes(String(input.equalScoreFallback))) throw new Error("Unknown equal-score policy");
  if (input.ownerAttribution !== null && !["qualification", "award"].includes(String(input.ownerAttribution))) throw new Error("Unknown owner-attribution policy");
  const policies = input as ChampionshipPolicies;
  unresolvedChampionshipPolicies(policies);
  return structuredClone(policies);
}
export function unresolvedChampionshipPolicies(policies: ChampionshipPolicies): string[] {
  const unresolved: string[] = [];
  if (!policies.roleComposition) unresolved.push("roleComposition"); else validateRoleComposition(policies.roleComposition);
  if (!policies.points) unresolved.push("points");
  else if (Object.keys(policies.points).sort().join(",") !== "draw,loss,win" || Object.values(policies.points).some(n => !Number.isSafeInteger(n) || n < 0 || n > 2_147_483_647)) throw new Error("Points must be explicit nonnegative 32-bit integers");
  if (!policies.equalScoreFallback) unresolved.push("equalScoreFallback");
  else if (!["season_rank", "shared_place"].includes(policies.equalScoreFallback)) throw new Error("Unknown equal-score policy");
  if (policies.participationMinimumCompletedGames === null) unresolved.push("participationMinimumCompletedGames");
  else if (!Number.isSafeInteger(policies.participationMinimumCompletedGames) || policies.participationMinimumCompletedGames < 1) throw new Error("Choose an explicit positive participation threshold");
  if (!policies.ownerAttribution) unresolved.push("ownerAttribution");
  else if (!["qualification", "award"].includes(policies.ownerAttribution)) throw new Error("Unknown owner-attribution policy");
  return unresolved;
}
export function compareChampionshipScores(a: Qualification & { points: number }, b: Qualification & { points: number }, fallback: ChampionshipPolicies["equalScoreFallback"]): number {
  const difference = b.points - a.points || b.seasonPoints - a.seasonPoints;
  if (difference) return difference;
  if (fallback === null) throw new Error("Equal series and Season 0 scores require an explicit tie policy");
  return fallback === "season_rank" ? a.rank - b.rank : 0;
}
export const SEASON_ZERO_AWARDS = [
  { code: "season-0-agent-crown", title: "Season 0 Agent Crown", recipient: "agent" },
  { code: "season-0-architect-crown", title: "Season 0 Architect Crown", recipient: "account" },
  { code: "season-0-agent-champions-architect", title: "Season 0 Champion’s Architect", recipient: "account" },
  { code: "season-0-top-eight", title: "Season 0 Top 8", recipient: "agent" },
  { code: "season-0-werewolf-champion", title: "Season 0 Werewolf Champion", recipient: "agent" },
  { code: "season-0-influence-champion", title: "Season 0 Influence Champion", recipient: "agent" },
  { code: "season-0-werewolf-champions-architect", title: "Season 0 Werewolf Champion’s Architect", recipient: "account" },
  { code: "season-0-influence-champions-architect", title: "Season 0 Influence Champion’s Architect", recipient: "account" },
  { code: "season-0-agent-participant", title: "Season 0 Participant", recipient: "agent" },
  { code: "season-0-account-participant", title: "Season 0 Participant", recipient: "account" },
] as const;
