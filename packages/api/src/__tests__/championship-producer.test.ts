import { beforeAll, afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { createSessionToken } from "../middleware/auth.js";
import { createChampionshipRoutes } from "../routes/championships.js";
import { testPayloadStore } from "./payload-test-store.js";
import { readJson } from "../services/payload-storage.js";

const originalFetch = globalThis.fetch;
const schedulerUrl = process.env.CHAMPIONSHIP_SCHEDULER_URL, schedulerToken = process.env.CHAMPIONSHIP_SCHEDULER_TOKEN;
afterEach(() => { globalThis.fetch = originalFetch; if (schedulerUrl === undefined) delete process.env.CHAMPIONSHIP_SCHEDULER_URL; else process.env.CHAMPIONSHIP_SCHEDULER_URL = schedulerUrl; if (schedulerToken === undefined) delete process.env.CHAMPIONSHIP_SCHEDULER_TOKEN; else process.env.CHAMPIONSHIP_SCHEDULER_TOKEN = schedulerToken; });
beforeAll(() => { process.env.JWT_SECRET = "championship-producer-test"; });
async function producerFixture() {
  const fixture = await championshipFixture();
  await grantTestAuthority(fixture.db, fixture.actorId, ["manage_championships", "manage_awards"]);
  const app = new Hono().route("/", createChampionshipRoutes(fixture.db));
  const token = await createSessionToken(fixture.actorId);
  const call = (path: string, method = "GET", body?: unknown, key = randomUUID()) => app.request(path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...fixture, app, call };
}

test("producer HTTP launch path previews without writes and reconciles only the selected event", async () => {
  const { db, event, actorId, seasonId, call } = await producerFixture();
  const input = { sourceSeasonId: seasonId, slug: `second-${randomUUID()}`, name: "Another championship" };
  const created = await call("/api/admin/championships", "POST", input);
  expect(created.status).toBe(201);
  const other = await created.json() as { id: string };
  expect(await (await call("/api/admin/championships", "POST", input)).json()).toMatchObject({ id: other.id });
  expect((await call("/api/admin/championships", "POST", { ...input, name: "Conflicting draft" })).status).toBe(409);
  expect(((await (await call("/api/admin/championships")).json()) as { events: unknown[] }).events).toHaveLength(2);
  for (const id of [event.id, other.id]) {
    expect((await call(`/api/admin/championships/${id}`, "PUT", { policies, startDate: "2020-01-01" })).status).toBe(200);
    expect((await call(`/api/admin/championships/${id}/lock`, "POST", {})).status).toBe(200);
  }
  const before = testPayloadStore.objects.size;
  const preview = await call(`/api/admin/championships/${event.id}/award-preview`);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ phases: [{ phase: "field", frozen: false, grants: expect.arrayContaining([expect.objectContaining({ recipientName: "Finalist 0" })]) }] });
  expect(testPayloadStore.objects.size).toBe(before);
  expect(await db.select().from(schema.championshipAwardAllocations)).toHaveLength(0);
  expect(await db.select().from(schema.awardGrants)).toHaveLength(0);
  expect((await call(`/api/admin/championships/${event.id}/publication`, "POST", { published: true })).status).toBe(200);
  expect(await db.select().from(schema.games)).toHaveLength(1);
  process.env.CHAMPIONSHIP_SCHEDULER_URL = "https://scheduler.example.test";
  process.env.CHAMPIONSHIP_SCHEDULER_TOKEN = "fixture";
  globalThis.fetch = (async (_url, init) => Response.json({ accepted: true, eventId: JSON.parse(String(init?.body)).eventId })) as typeof fetch;
  for (const id of [event.id, other.id]) expect((await call(`/api/admin/championships/${id}/activate`, "POST", {})).status).toBe(200);
  const reconciliation = await call(`/api/admin/championships/${event.id}/reconcile`, "POST", {});
  expect(reconciliation.status).toBe(200);
  expect(((await reconciliation.json()) as { dispatched: unknown[] }).dispatched).toHaveLength(0);
  expect((await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, other.id))).every(match => match.gameId === null)).toBe(true);
  const games = await db.select().from(schema.games);
  expect(games).toHaveLength(1);
  expect(games.filter(game => game.seasonId === null).every(game => game.status === "in_progress")).toBe(true);
  expect((await call(`/api/admin/championships/${event.id}/reconcile`, "POST", {})).status).toBe(200);
  expect(await db.select().from(schema.games)).toHaveLength(1);
  const grants = await db.select().from(schema.awardGrants);
  expect(grants).toHaveLength(16);
  const publicView = await (await call(`/api/championships/${event.slug}`)).json();
  expect(JSON.stringify(publicView)).not.toContain(actorId);
  expect(JSON.stringify(publicView)).not.toContain('"audit"');
  expect(await (await call(`/api/admin/championships/${event.id}`)).json()).toMatchObject({ audit: expect.arrayContaining([expect.objectContaining({ action: "event_activated" })]) });
  expect(((await (await call(`/api/admin/awards?eventId=${event.id}`)).json()) as { grants: unknown[] }).grants).toHaveLength(8);
});

test("badge correction preserves evidence and delayed revoke/reinstate retries preserve later decisions", async () => {
  const { db, event, actorId, agents, call, app } = await producerFixture();
  const granted = await call("/api/admin/awards", "POST", { definitionCode: "season-0-top-eight", recipientType: "agent", recipientId: agents[0], sourceEventId: event.id,
    sourceKey: "producer-test", evidence: { qualificationRank: 1 }, reason: "Test achievement" });
  expect(granted.status).toBe(200);
  const { id } = await granted.json() as { id: string };
  const [original] = await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, id));
  const revoke = randomUUID(), restore = randomUUID();
  expect((await call(`/api/admin/awards/${id}/reinstate`, "POST", { reason: " " })).status).toBe(400);
  expect((await app.request(`/api/admin/awards/${id}/reinstate`, { method: "POST" })).status).toBe(401);
  await call(`/api/admin/awards/${id}/revoke`, "POST", { reason: "Review correction" }, revoke);
  await call(`/api/admin/awards/${id}/reinstate`, "POST", { reason: "Verified original award" }, restore);
  expect(await (await call(`/api/admin/awards/${id}/revoke`, "POST", { reason: "Review correction" }, revoke)).json()).toMatchObject({ revoked: false });
  await call(`/api/admin/awards/${id}/revoke`, "POST", { reason: "Later explicit revocation" });
  expect(await (await call(`/api/admin/awards/${id}/reinstate`, "POST", { reason: "Verified original award" }, restore)).json()).toMatchObject({ revoked: true });
  expect((await call(`/api/admin/awards/${id}/reinstate`, "POST", { reason: "Changed evidence" }, restore)).status).toBe(409);
  const [after] = await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, id));
  expect(after!.evidence).toEqual(original!.evidence);
  expect(await readJson(after!.evidence)).toEqual({ qualificationRank: 1 });
  const history = await (await call(`/api/admin/awards/${id}`)).json() as { audit: Array<{ action: string }> };
  expect(history.audit.map(row => row.action)).toEqual(["award_granted", "award_revoked", "award_reinstated", "award_revoked"]);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, actorId));
  await grantTestAuthority(db, actorId, ["manage_championships"]);
  expect((await call(`/api/admin/championships/${event.id}/award-preview`)).status).toBe(403);
});
