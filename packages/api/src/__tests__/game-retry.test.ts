import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster } from "../services/championships.js";
import { activateChampionship, dispatchChampionshipMatch, replayCancelledChampionshipMatch } from "../services/championship-dispatch.js";
import { retryFailedGame } from "../services/game-retry.js";
import { championshipGameRoster } from "../services/championship-game-roster.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";
import { schema } from "../db/index.js";
import { createGameRetryRoutes } from "../routes/game-retry.js";
import { createSessionToken } from "../middleware/auth.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { launchExactGameLocally } from "../services/game-launch.js";
import { abortAllGames, isGameRunning } from "../services/game-lifecycle.js";
import { reconcileChampionshipResults, championshipStandings } from "../services/championship-results.js";

beforeAll(() => { process.env.JWT_SECRET = "game-retry-fixture-only"; });
afterEach(async () => { await abortAllGames(); delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER; });
async function fixture(ordinal = 1) {
  const f = await championshipFixture();
  await configureChampionshipDraft(f.db, f.event.id, { policies, startDate: "2020-01-01" });
  await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  await activateChampionship(f.db, f.event.id, f.actorId, randomUUID());
  const { gameId } = await dispatchChampionshipMatch(f.db, f.event.id, ordinal);
  await f.db.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, gameId!));
  return { ...f, gameId: gameId! };
}

test("concurrent retry fences/hides one attempt and preserves frozen roles, artwork and history", async () => {
  const { db, event, actorId, gameId } = await fixture();
  const before = await readWerewolfEvents(db, gameId);
  const roster = (await championshipGameRoster(db, gameId))!;
  const ownerEpoch = randomUUID();
  await db.insert(schema.gameRunOwners).values({ id: randomUUID(), gameId, ownerEpoch, expiresAt: "2099-01-01" });
  await db.update(schema.agentProfiles).set({ personality: "Edited after freeze" }).where(eq(schema.agentProfiles.userId, actorId));
  const replies = await Promise.all([retryFailedGame(db, gameId, actorId), retryFailedGame(db, gameId, actorId)]);
  expect(replies[0]).toEqual(replies[1]);
  const next = replies[0]!.gameId;
  expect(next).not.toBe(gameId);
  expect(await db.select().from(schema.gameRetries)).toHaveLength(1);
  const [old] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  expect(old!.status).toBe("cancelled"); expect(old!.hiddenAt).not.toBeNull();
  expect((await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!.status).toBe("revoked");
  expect(await readWerewolfEvents(db, gameId)).toEqual(before);
  const nextRoster = (await championshipGameRoster(db, next))!;
  expect(nextRoster.cast.map(row => row.build)).toEqual(roster.cast.map(row => row.build));
  const opening = (await readWerewolfEvents(db, next))[0]!;
  const original = before[0]!;
  if (original.type !== "werewolf.started" || opening.type !== "werewolf.started") throw new Error("Missing opening");
  expect(nextRoster.cast.map(row => opening.payload.roles[row.seatId])).toEqual(roster.cast.map(row => original.payload.roles[row.seatId]));
  expect((await championshipStandings(db, event.id))!.series.every(row => row.played === 0)).toBe(true);
  expect(await retryFailedGame(db, gameId, actorId)).toEqual(replies[0]);
});

test("recorded result rejects replay without hiding or cancelling suspended game", async () => {
  const { db, actorId, gameId } = await fixture(17);
  const roster = (await championshipGameRoster(db, gameId))!;
  await db.insert(schema.gameResults).values({ id: randomUUID(), gameId, winnerId: roster.cast[0]!.seatId, roundsPlayed: 1, tokenUsage: "{}" });
  await expect(retryFailedGame(db, gameId, actorId)).rejects.toThrow("Retry settlement");
  const [old] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  expect(old!.status).toBe("suspended"); expect(old!.hiddenAt).toBeNull();
  expect(await db.select().from(schema.gameRetries)).toHaveLength(0);
});

test("HTTP retry recovers launch failure and runs only its replacement without polling", async () => {
  const { db, actorId, gameId, event } = await fixture(17);
  const unrelated = await dispatchChampionshipMatch(db, event.id, 1);
  const token = await createSessionToken(actorId);
  let calls = 0;
  const app = createGameRetryRoutes(db, async (db, id) => {
    calls++;
    if (calls === 1) throw new Error("Transport unavailable");
    if (calls === 2) return launchExactGameLocally(db, id, { start: async () => ({ error: "Fixture startup failure" }) });
    await launchExactGameLocally(db, id);
  });
  const request = () => app.request(`/api/admin/games/${gameId}/retry`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  expect((await request()).status).toBe(403);
  expect(await db.select().from(schema.gameRetries)).toHaveLength(0);
  await grantTestAuthority(db, actorId, ["start_game", "stop_game", "hide_game"]);
  const failed = await request(); expect(failed.status).toBe(503);
  const receipt = await failed.json() as { gameId: string };
  const [beforeLaunch] = await db.select().from(schema.games).where(eq(schema.games.id, receipt.gameId));
  const frozenSeats = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, receipt.gameId));
  expect((await request()).status).toBe(503);
  const [afterLaunch] = await db.select().from(schema.games).where(eq(schema.games.id, receipt.gameId));
  expect(afterLaunch!.status).toBe("in_progress");
  expect(afterLaunch!.config).toBe(beforeLaunch!.config);
  expect(await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, receipt.gameId))).toEqual(frozenSeats);
  expect(await db.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, receipt.gameId), eq(schema.gameRunOwners.status, "active")))).toHaveLength(0);
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  const accepted = await request(); expect(accepted.status).toBe(200);
  expect((await accepted.json() as { gameId: string }).gameId).toBe(receipt.gameId);
  const deadline = Date.now() + 100000;
  while (isGameRunning(receipt.gameId) && Date.now() < deadline) await Bun.sleep(20);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, receipt.gameId)))[0]!.status).toBe("completed");
  await reconcileChampionshipResults(db, event.id);
  const results = await db.select().from(schema.championshipResults);
  expect(results).toHaveLength(8);
  expect(results.every(row => row.gameId === receipt.gameId)).toBe(true);
  expect(await db.select().from(schema.gameRetries)).toHaveLength(1);
  expect(await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId, unrelated.gameId!))).toHaveLength(0);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, unrelated.gameId!)))[0]!.status).toBe("in_progress");
}, 120000);

test("ordinary Werewolf retry preserves admitted identities and role assignment", async () => {
  const { db, actorId, agents } = await championshipFixture();
  const { createWerewolfGame } = await import("../services/werewolf-games.js");
  const { id: gameId } = await createWerewolfGame(db, actorId, { preset: "two_wolves", agentProfileIds: agents });
  const before = (await readWerewolfEvents(db, gameId))[0]!;
  await db.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, gameId));
  await db.update(schema.agentProfiles).set({ personality: "Changed since admission" }).where(eq(schema.agentProfiles.userId, actorId));
  const next = await retryFailedGame(db, gameId, actorId);
  const after = (await readWerewolfEvents(db, next.gameId))[0]!;
  if (before.type !== "werewolf.started" || after.type !== "werewolf.started") throw new Error("Missing opening");
  expect(after.payload.players.map(({ id: _id, ...p }) => p)).toEqual(before.payload.players.map(({ id: _id, ...p }) => p));
  expect(after.payload.players.map(p => after.payload.roles[p.id])).toEqual(before.payload.players.map(p => before.payload.roles[p.id]));
  expect(after.payload.config).toEqual(before.payload.config);
});


test("ordinary Influence replacement preserves admitted seats and config after live profile edits", async () => {
  const { db, actorId, gameId } = await fixture(17);
  const [source] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const seats = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  // Ordinary game fixture reuses the admitted build, with no championship binding.
  const ordinary = randomUUID();
  await db.insert(schema.games).values({ ...source!, id: ordinary, slug: `ordinary-${ordinary}` });
  await db.insert(schema.gamePlayers).values(seats.map(seat => ({ ...seat, gameId: ordinary, id: `${ordinary}:${seat.id}` })));
  const config = JSON.parse(source!.config);
  const contestants = config.modelRouting.frozenRoutes.contestants;
  config.modelRouting.frozenRoutes.contestants = Object.fromEntries(Object.entries(contestants).map(([key, value]) => [`${ordinary}:${key}`, value]));
  config.modelRouting.contestants = Object.fromEntries(Object.entries(config.modelRouting.contestants).map(([key, value]) => [`${ordinary}:${key}`, value]));
  await db.update(schema.games).set({ config: JSON.stringify(config) }).where(eq(schema.games.id, ordinary));
  await db.update(schema.agentProfiles).set({ personality: "Owner edited live build" }).where(eq(schema.agentProfiles.userId, actorId));
  const result = await retryFailedGame(db, ordinary, actorId);
  const after = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, result.gameId));
  expect(after.map(row => row.persona)).toEqual(seats.map(row => row.persona));
  expect(after.map(row => row.agentRevisionId)).toEqual(seats.map(row => row.agentRevisionId));
  const [replacement] = await db.select().from(schema.games).where(eq(schema.games.id, result.gameId));
  const routing = JSON.parse(replacement!.config).modelRouting.frozenRoutes.contestants;
  expect(Object.keys(routing).sort()).toEqual(after.map(row => row.id).sort());
  expect(Object.values(routing)).toEqual(Object.values(contestants));
  expect((await db.select().from(schema.games).where(eq(schema.games.id, ordinary)))[0]!.hiddenAt).not.toBeNull();
});


test("retry racing legacy replay cannot overwrite an already accepted replacement", async () => {
  const { db, actorId, gameId, event } = await fixture();
  await db.update(schema.games).set({ status: "cancelled" }).where(eq(schema.games.id, gameId));
  const results = await Promise.allSettled([
    replayCancelledChampionshipMatch(db, { eventId: event.id, ordinal: 1, expectedGameId: gameId, actorId, requestId: randomUUID(), reason: "Fixture replay" }),
    retryFailedGame(db, gameId, actorId),
  ]);
  expect(results.some(result => result.status === "fulfilled")).toBe(true);
  const attempts = await db.select().from(schema.championshipMatchAttempts);
  expect(attempts).toHaveLength(2);
  const [match] = await db.select().from(schema.championshipMatches).where(and(eq(schema.championshipMatches.eventId, event.id), eq(schema.championshipMatches.ordinal, 1)));
  expect(attempts.some(attempt => attempt.gameId === match!.gameId)).toBe(true);
});


test("exact launch acknowledges a healthy foreign owner without starting a second runner", async () => {
  const { db, actorId, gameId } = await fixture(17);
  const replacement = await retryFailedGame(db, gameId, actorId);
  await db.insert(schema.gameRunOwners).values({ id: randomUUID(), gameId: replacement.gameId, ownerEpoch: randomUUID(), processId: "fixture-other-worker", expiresAt: "2099-01-01" });
  let starts = 0;
  await launchExactGameLocally(db, replacement.gameId, { start: async () => { starts++; return { error: "Must not run" }; } });
  expect(starts).toBe(0);
  expect(await db.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId, replacement.gameId))).toHaveLength(1);
});
