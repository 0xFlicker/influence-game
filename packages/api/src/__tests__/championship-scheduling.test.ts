import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster } from "../services/championships.js";
import { activateChampionship, pauseChampionship } from "../services/championship-dispatch.js";
import { championshipScheduleManifest, dispatchScheduledChampionshipMatch, requestChampionshipScheduleSync, stopLocalChampionshipTimers } from "../services/championship-scheduling.js";
import { schema } from "../db/index.js";
import { createChampionshipRoutes } from "../routes/championships.js";
const originalFetch = globalThis.fetch;
const keys = ["CHAMPIONSHIP_SCHEDULER_URL", "CHAMPIONSHIP_SCHEDULER_TOKEN", "JWT_SECRET", "NODE_ENV", "INFLUENCE_API_ROLE"] as const;
const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => { stopLocalChampionshipTimers(); globalThis.fetch = originalFetch; for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
async function fixture() {
  const f = await championshipFixture();
  await configureChampionshipDraft(f.db, f.event.id, { policies, startDate: "2030-01-01" });
  await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  await activateChampionship(f.db, f.event.id, f.actorId, randomUUID());
  return f;
}
test("delayed and duplicate triggers create one exact game and retry the same launch after outage", async () => {
  const { db, event } = await fixture();
  const manifest = await championshipScheduleManifest(db, event.id);
  expect(manifest.matches).toHaveLength(17);
  const match = manifest.matches[0]!;
  const launched: string[] = [];
  let fail = true;
  const options = { now: "2030-02-01T00:00:00.000Z", launch: async (_db: typeof db, id: string) => { launched.push(id); if (fail) throw new Error("launcher offline"); } };
  await expect(dispatchScheduledChampionshipMatch(db, match, options)).rejects.toThrow("launcher offline");
  fail = false;
  const [a, b] = await Promise.all([dispatchScheduledChampionshipMatch(db, match, options), dispatchScheduledChampionshipMatch(db, match, options)]);
  expect(a).toEqual(b); expect(new Set(launched).size).toBe(1);
  expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(1);
  expect((await championshipScheduleManifest(db, event.id)).matches).toHaveLength(17);
  const game = (await db.select().from(schema.games).where(eq(schema.games.id, launched[0]!)))[0]!;
  expect(game.seasonId).toBeNull(); expect(game.gameKind).toBe("werewolf");
});
test("early, paused, wrong match and stale correction deliveries cannot launch", async () => {
  const { db, event, actorId } = await fixture();
  const match = (await championshipScheduleManifest(db, event.id)).matches[0]!;
  let launches = 0; const launch = async () => { launches++; };
  await expect(dispatchScheduledChampionshipMatch(db, match, { now: "2029-01-01T00:00:00.000Z", launch })).rejects.toThrow("not due");
  expect(await dispatchScheduledChampionshipMatch(db, { ...match, matchId: randomUUID() }, { launch })).toMatchObject({ ignored: "obsolete" });
  await pauseChampionship(db, event.id, actorId, randomUUID());
  expect(await dispatchScheduledChampionshipMatch(db, match, { launch })).toMatchObject({ ignored: "obsolete" });
  expect((await championshipScheduleManifest(db, event.id)).matches).toHaveLength(0);
  await activateChampionship(db, event.id, actorId, randomUUID());
  await db.update(schema.championshipMatches).set({ resultRevision: 2 }).where(eq(schema.championshipMatches.id, match.matchId));
  expect(await dispatchScheduledChampionshipMatch(db, match, { launch })).toMatchObject({ ignored: "obsolete" });
  expect(launches).toBe(0); expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(0);
});
test("scheduler acknowledgement must be durable and exact; internal routes reject anonymous access", async () => {
  const { db, event } = await fixture();
  const app = createChampionshipRoutes(db);
  for (const path of [`/api/internal/championships/${event.id}/schedules`, `/api/internal/championships/${event.id}/matches/1/dispatch`, '/api/internal/championships/games/launch', '/api/internal/championships/games/test/complete']) {
    expect((await app.request(path, { method: path.endsWith('schedules') ? 'GET' : 'POST' })).status).toBe(401);
  }
  process.env.CHAMPIONSHIP_SCHEDULER_URL = "https://scheduler.example.test"; process.env.CHAMPIONSHIP_SCHEDULER_TOKEN = "fixture";
  globalThis.fetch = (async () => Response.json({ accepted: true, eventId: "wrong" })) as unknown as typeof fetch;
  await expect(requestChampionshipScheduleSync(event.id)).rejects.toThrow("acknowledge");
  globalThis.fetch = (async () => Response.json({ accepted: true, eventId: event.id })) as unknown as typeof fetch;
  expect(await requestChampionshipScheduleSync(event.id)).toEqual({ accepted: true });
});

test("local one-shot registration is durable, deduplicated and restores only explicit events", async () => {
  const { db, event, actorId } = await fixture();
  delete process.env.CHAMPIONSHIP_SCHEDULER_URL; delete process.env.CHAMPIONSHIP_SCHEDULER_TOKEN;
  const { restoreLocalChampionshipSchedules, synchronizeLocalChampionshipSchedules } = await import("../services/championship-scheduling.js");
  await restoreLocalChampionshipSchedules(db);
  expect((await db.select().from(schema.competitionAudit)).filter(row => row.action === "local_scheduler_enabled")).toHaveLength(0);
  expect(await synchronizeLocalChampionshipSchedules(db, event.id)).toMatchObject({ accepted: true, registered: 17 });
  stopLocalChampionshipTimers(); await restoreLocalChampionshipSchedules(db);
  expect((await db.select().from(schema.competitionAudit)).filter(row => row.action === "local_scheduler_enabled")).toHaveLength(1);
  await pauseChampionship(db, event.id, actorId, randomUUID());
  expect(await synchronizeLocalChampionshipSchedules(db, event.id)).toMatchObject({ registered: 0 });
});

test("pause prevents new admissions but permits redelivery of an already accepted launch", async () => {
  const { db, event, actorId } = await fixture();
  const manifest = await championshipScheduleManifest(db, event.id), first = manifest.matches[0]!;
  await expect(dispatchScheduledChampionshipMatch(db, first, { now: "2030-01-02T00:00:00.000Z", launch: async () => { throw new Error("delivery offline"); } })).rejects.toThrow("delivery offline");
  const attempts = await db.select().from(schema.championshipMatchAttempts);
  await pauseChampionship(db, event.id, actorId, randomUUID());
  const launches: string[] = [];
  expect(await dispatchScheduledChampionshipMatch(db, first, { now: "2030-01-02T00:00:00.000Z", launch: async (_db, id) => { launches.push(id); } })).toMatchObject({ accepted: true, gameId: attempts[0]!.gameId });
  expect(launches).toEqual([attempts[0]!.gameId]);
  expect(await dispatchScheduledChampionshipMatch(db, manifest.matches[1]!, { now: "2030-01-02T00:00:00.000Z", launch: async () => { throw new Error("must not launch"); } })).toMatchObject({ ignored: "obsolete" });
  expect(await db.select().from(schema.championshipMatchAttempts)).toHaveLength(1);
});

test("dedicated service credentials outlast the event without user-session expiry or free-queue scope", async () => {
  const { db, actorId, event } = await fixture();
  const { createChampionshipServiceToken } = await import("../services/championship-service-token.js");
  const { decodeJwt } = await import("jose");
  process.env.JWT_SECRET ??= "championship-service-fixture";
  await db.insert(schema.servicePrincipals).values({ userId: actorId, purpose: "championship" });
  const expiry = new Date(Date.now() + 90 * 86400_000);
  const token = await createChampionshipServiceToken(db, actorId, expiry);
  const claims = decodeJwt(token);
  expect(claims.perms).toEqual(["dispatch_championship"]);
  expect(claims.exp! - claims.iat!).toBeGreaterThan(17 * 86400);
  const app = createChampionshipRoutes(db);
  expect((await app.request(`/api/internal/championships/${event.id}/schedules`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  await db.update(schema.servicePrincipals).set({ enabled: false }).where(eq(schema.servicePrincipals.userId, actorId));
  expect((await app.request(`/api/internal/championships/${event.id}/schedules`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
  await expect(createChampionshipServiceToken(db, actorId, expiry)).rejects.toThrow("Enabled championship");
});

test("staging refuses local timers and startup restoration without external authority", async () => {
  const { db } = await championshipFixture();
  process.env.NODE_ENV = "staging";
  delete process.env.CHAMPIONSHIP_SCHEDULER_URL; delete process.env.CHAMPIONSHIP_SCHEDULER_TOKEN;
  const { assertChampionshipSchedulerConfigured, synchronizeLocalChampionshipSchedules, restoreLocalChampionshipSchedules } = await import("../services/championship-scheduling.js");
  expect(assertChampionshipSchedulerConfigured).toThrow("scheduler URL and token");
  await expect(synchronizeLocalChampionshipSchedules(db, "never-read")).rejects.toThrow("development-only");
  await restoreLocalChampionshipSchedules(db);
  expect(await db.select().from(schema.competitionAudit)).toHaveLength(0);
});

test("staging gateway rejects exact execution even with an authorized service", async () => {
  const { db, actorId } = await championshipFixture();
  process.env.NODE_ENV = "staging"; process.env.INFLUENCE_API_ROLE = "gateway";
  process.env.JWT_SECRET ??= "championship-service-fixture";
  await db.insert(schema.servicePrincipals).values({ userId: actorId, purpose: "championship" });
  const { createChampionshipServiceToken } = await import("../services/championship-service-token.js");
  const token = await createChampionshipServiceToken(db, actorId, new Date(Date.now() + 60_000));
  const response = await createChampionshipRoutes(db).request("/api/internal/championships/games/launch", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ gameId: randomUUID() }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Use the game-worker launch endpoint" });
});
