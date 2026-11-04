import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "@influence/engine";
import { runWerewolf, replayWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { SEASON_ZERO_CHAMPIONSHIP_POLICIES } from "@influence/engine/championship";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster } from "../services/championships.js";
import { activateChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { championshipGameRoster } from "../services/championship-game-roster.js";
import { settleChampionshipMatch, championshipStandings } from "../services/championship-results.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "../services/championship-awards.js";
import { createChampionshipRoutes } from "../routes/championships.js";
import { createSessionToken } from "../middleware/auth.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { claimWerewolfGame, createWerewolfStore, readWerewolfEvents } from "../services/werewolf-games.js";
import { readJson, storeJson } from "../services/payload-storage.js";
import { abortAllGames } from "../services/game-lifecycle.js";

import { abortAllGames } from "../services/game-lifecycle.js";

// Replay routes launch background execution; drain it before the next fixture truncates.
afterEach(async () => { await abortAllGames(); });

beforeAll(() => { process.env.JWT_SECRET = "championship-scoring-test"; });
const originalMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
afterEach(async () => {
  // Replay routes launch real background runtimes. Drain them before the next
  // fixture truncates tables, including when an assertion fails.
  await abortAllGames();
  if (originalMockRunner === undefined) delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
  else process.env.INFLUENCE_API_TEST_MOCK_RUNNER = originalMockRunner;
});
async function fixture() {
  const f = await championshipFixture();
  expect(f.event.policies).toEqual(SEASON_ZERO_CHAMPIONSHIP_POLICIES);
  await configureChampionshipDraft(f.db, f.event.id, { policies: { ...policies, points: { win: 1, loss: 0, draw: 0.5 }, equalScoreFallback: "shared_place" }, startDate: "2020-01-01" });
  const locked = await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  await activateChampionship(f.db, f.event.id, f.actorId, randomUUID());
  return { ...f, locked };
}

test("a canonical day-limit draw persists exact half points once; interrupted games earn no draw", async () => {
  const { db, event, locked } = await fixture();
  // Short fixture-only day cap; all other match machinery is canonical.
  const execution = await readJson(locked.execution!);
  execution.werewolf.maxDays = 1;
  await db.update(schema.championshipEvents).set({ execution: await storeJson(execution) }).where(eq(schema.championshipEvents.id, event.id));
  const first = await dispatchChampionshipMatch(db, event.id, 1);
  const [match] = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, first.gameId!));
  expect(await settleChampionshipMatch(db, match!.id)).toBe(false);
  expect(await db.select().from(schema.championshipResults)).toHaveLength(0);
  const agent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective, async decide({ request }) {
    if (request.action === "public_vote") return { kind: "spoken_target", targetId: null, text: "I abstain.", cue: null, thinking: "Fixture abstention" };
    if ("solo" in request && request.solo) return { kind: "solo_target", targetId: request.legalTargetIds[0]!, text: "Fixture", cue: null };
    if (request.action === "speaking_priority") return { kind: "speaking_priority", priority: 50 };
    if (request.action === "conversation") return { kind: "conversation", text: null, cue: null, recipientId: null, replyToContributionId: null };
    if (request.action === "pack_propose") return { kind: "spoken_target", targetId: request.legalTargetIds[0]!, text: "Fixture", cue: null, thinking: "Fixture" };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: "Fixture", cue: null };
  } };
  const claim = await claimWerewolfGame(db, first.gameId!); if (!claim.ok) throw new Error(claim.error);
  await runWerewolf(createWerewolfStore(db, first.gameId!, claim.claim.ownerEpoch), agent);
  expect(replayWerewolf(await readWerewolfEvents(db, first.gameId!)).outcome).toMatchObject({ faction: null, reason: "day_limit" });
  await Promise.all([settleChampionshipMatch(db, match!.id), settleChampionshipMatch(db, match!.id)]);
  const results = await db.select().from(schema.championshipResults);
  expect(results).toHaveLength(8);
  expect(results.every(row => row.points === 0.5 && row.outcome === "draw" && row.policyVersion === "season-0-v2")).toBe(true);
  expect((await championshipStandings(db, event.id))!.series.every(row => row.points === 0.5 && row.played === 1)).toBe(true);
}, 60000);

test("equal series and frozen season scores award all shared champions idempotently", async () => {
  const { db, event } = await fixture();
  const entries = await db.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, event.id));
  // Explicit result fixture tests ranking/allocation, not gameplay execution.
  await db.update(schema.championshipEntries).set({ seasonPoints: 100 }).where(eq(schema.championshipEntries.eventId, event.id));
  const matches = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, event.id));
  for (const match of matches.filter(row => row.gameKind === "werewolf")) {
    const gameId = randomUUID();
    await db.insert(schema.games).values({ id: gameId, slug: `score-${gameId}`, gameKind: "werewolf", status: "completed", config: "{}" });
    await db.update(schema.championshipMatches).set({ status: "completed", gameId }).where(eq(schema.championshipMatches.id, match.id));
    await db.insert(schema.championshipResults).values(entries.map(entry => ({ matchId: match.id, gameId, entryId: entry.id, outcome: "draw" as const, points: 0.5, policyVersion: "season-0-v2" })));
  }
  const standings = (await championshipStandings(db, event.id))!;
  expect(standings.werewolfWinners.sort()).toEqual(entries.map(row => row.agentId).sort());
  expect(standings.series.every(row => row.points === 8)).toBe(true);
  expect(standings.resolutionPending).toBe(false);
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  const grants = await db.select().from(schema.awardGrants);
  expect(grants.filter(row => row.definitionCode === "season-0-werewolf-champion")).toHaveLength(8);
  expect(grants.filter(row => row.definitionCode === "season-0-werewolf-champions-architect")).toHaveLength(8);
});

test("producer replay preserves cancelled evidence and frozen roles; delayed retry cannot replace another attempt", async () => {
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  const { db, event, actorId } = await fixture();
  await grantTestAuthority(db, actorId, ["manage_championships"]);
  const app = new Hono().route("/", createChampionshipRoutes(db));
  const token = await createSessionToken(actorId), key = randomUUID();
  const first = await dispatchChampionshipMatch(db, event.id, 1);
  const original = await readWerewolfEvents(db, first.gameId!);
  const path = `/api/admin/championships/${event.id}/matches/1/replay`;
  const body = { expectedGameId: first.gameId, reason: "Recover the aborted fixture" };
  const call = (requestBody = body, requestKey = key) => app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": requestKey }, body: JSON.stringify(requestBody) });
  expect((await app.request(path, { method: "POST" })).status).toBe(401);
  expect((await call()).status).toBe(409); // Active games use normal cursor recovery.
  await db.update(schema.games).set({ status: "cancelled" }).where(eq(schema.games.id, first.gameId!));
  const [match] = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, first.gameId!));
  expect(await settleChampionshipMatch(db, match!.id)).toBe(false);
  const responses = await Promise.all([call(), call()]);
  expect(responses.map(row => row.status)).toEqual([200, 200]);
  const replay = await responses[0]!.json() as { gameId: string };
  expect(await responses[1]!.json()).toMatchObject(replay);
  expect(replay.gameId).not.toBe(first.gameId);
  expect(await readWerewolfEvents(db, first.gameId!)).toEqual(original);
  expect((await championshipGameRoster(db, first.gameId!))!.cast.map(row => row.entry.agentId)).toEqual((await championshipGameRoster(db, replay.gameId))!.cast.map(row => row.entry.agentId));
  const initial = replayWerewolf(original), replacement = replayWerewolf(await readWerewolfEvents(db, replay.gameId));
  for (const player of initial.players) {
    const other = replacement.players.find(row => row.agentProfileId === player.agentProfileId)!;
    expect(replacement.roles[other.id]).toBe(initial.roles[player.id]);
  }
  expect(await db.select().from(schema.championshipResults)).toHaveLength(0);
  expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(2);
  expect((await call({ ...body, reason: "Different reason" })).status).toBe(409);
  await db.update(schema.games).set({ status: "cancelled" }).where(eq(schema.games.id, replay.gameId));
  await abortAllGames();
  expect((await call()).status).toBe(409);
  expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(2);
  expect((await call({ ...body, expectedGameId: replay.gameId }, randomUUID())).status).toBe(200);
  expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(3);
});

test("half-point migration preserves historical integers and policy versions", async () => {
  const { db } = await championshipFixture();
  await db.transaction(async tx => {
    await tx.execute(sql.raw("CREATE TEMP TABLE half_point_migration_fixture(points integer NOT NULL, policy_version text NOT NULL) ON COMMIT DROP"));
    await tx.execute(sql.raw("INSERT INTO half_point_migration_fixture VALUES (0,'season-0-v1'),(1,'season-0-v1'),(2147483647,'season-0-v1')"));
    const migration = readFileSync(new URL("../../drizzle/0147_championship_half_points.sql", import.meta.url), "utf8").replaceAll("championship_results", "half_point_migration_fixture");
    for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
    const rows = await tx.execute(sql.raw("SELECT points, policy_version FROM half_point_migration_fixture ORDER BY points"));
    expect(rows.map(row => row.points)).toEqual([0, 1, 2147483647]);
    expect(rows.every(row => row.policy_version === "season-0-v1")).toBe(true);
    await tx.execute(sql.raw("INSERT INTO half_point_migration_fixture VALUES (0.5,'season-0-v2')"));
  });
});
