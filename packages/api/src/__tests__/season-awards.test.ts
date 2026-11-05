import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { championshipFixture } from "./championship-fixtures.js";
import { finalizeSeason } from "../services/seasons.js";
import { planSeasonAwards, previewSeasonAwards, reconcileSeasonAwards } from "../services/season-awards.js";
import { grantAward, revokeAward } from "../services/awards.js";
import { createSeasonRoutes } from "../routes/seasons.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { createSessionToken } from "../middleware/auth.js";
import { deliverChampionshipAwards } from "../services/championship-awards.js";
import { storeJson } from "../services/payload-storage.js";

async function fixture() {
  const f = await championshipFixture();
  await f.db.delete(schema.championshipEvents).where(eq(schema.championshipEvents.id, f.event.id));
  await f.db.update(schema.seasons).set({ status: "closing" }).where(eq(schema.seasons.id, f.seasonId));
  return f;
}

test("finalize route delivers crowns and one-game participation without a championship; retries preserve grants", async () => {
  const { db, seasonId, actorId } = await fixture();
  process.env.JWT_SECRET = "season-awards-test-secret";
  await grantTestAuthority(db, actorId, ["manage_seasons"]);
  const token = await createSessionToken(actorId, { roles: ["test"], permissions: ["manage_seasons"] });
  const app = createSeasonRoutes(db), headers = { Authorization: `Bearer ${token}` };
  expect((await app.request(`/api/admin/seasons/${seasonId}/awards/reconcile`, { method: "POST" })).status).toBe(401);
  const response = await app.request(`/api/admin/seasons/${seasonId}/finalize`, { method: "POST", headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ awards: { planned: 12, created: 12, preserved: 0 } });
  expect(await db.select().from(schema.championshipEvents)).toHaveLength(0);
  const grants = await db.select().from(schema.awardGrants);
  expect(grants.filter(g => g.definitionCode === "season-0-agent-participant")).toHaveLength(8);
  expect(grants.filter(g => g.definitionCode === "season-0-account-participant")).toHaveLength(1);
  expect(grants.every(g => g.sourceEventId === null && g.sourceSeasonId === seasonId)).toBe(true);
  const again = await app.request(`/api/admin/seasons/${seasonId}/finalize`, { method: "POST", headers });
  expect(await again.json()).toMatchObject({ awards: { created: 0, preserved: 12 } });
  expect(await db.select().from(schema.awardGrants)).toEqual(grants);
});

test("already-finalized preview is read-only; concurrent reconciliation uses frozen evidence and preserves revocations", async () => {
  const { db, seasonId, actorId } = await fixture();
  await finalizeSeason(db, seasonId);
  const plan = await planSeasonAwards(db, seasonId);
  const existing = await grantAward(db, { ...plan[0]!, evidence: { legacy: true }, sourceSeasonId: seasonId, actorId, reason: "Existing historical grant", requestId: randomUUID() });
  await revokeAward(db, { grantId: existing.id, actorId, reason: "Explicit producer correction", requestId: randomUUID() });
  await db.delete(schema.competitionReceipts).where(eq(schema.competitionReceipts.seasonId, seasonId));
  const before = await db.select().from(schema.awardGrants);
  const audits = await db.select().from(schema.competitionAudit);
  expect(await previewSeasonAwards(db, seasonId)).toHaveLength(12);
  expect(await db.select().from(schema.awardGrants)).toEqual(before);
  expect(await db.select().from(schema.competitionAudit)).toEqual(audits);
  const results = await Promise.all([reconcileSeasonAwards(db, seasonId, actorId), reconcileSeasonAwards(db, seasonId, actorId)]);
  expect(results.map(r => r.created).sort((a,b) => a-b)).toEqual([0,11]);
  expect(await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, existing.id))).toEqual(before);
  expect(await db.select().from(schema.awardGrants)).toHaveLength(12);
});

test("delivery failure rolls back whole batch and missing snapshots never infer live winners", async () => {
  const { db, seasonId, actorId } = await fixture();
  await expect(reconcileSeasonAwards(db, seasonId, actorId)).rejects.toThrow("Finalize Season 0");
  await finalizeSeason(db, seasonId);
  await expect(reconcileSeasonAwards(db, seasonId, randomUUID())).rejects.toThrow();
  expect(await db.select().from(schema.awardGrants)).toHaveLength(0);
  expect((await reconcileSeasonAwards(db, seasonId, actorId)).created).toBe(12);
  await db.delete(schema.seasonFinalizations).where(eq(schema.seasonFinalizations.seasonId, seasonId));
  await expect(reconcileSeasonAwards(db, seasonId, actorId)).rejects.toThrow("frozen award evidence");
  await db.update(schema.seasons).set({ name: "Season 1" }).where(eq(schema.seasons.id, seasonId));
  expect(await reconcileSeasonAwards(db, seasonId, actorId)).toEqual({ planned: 0, created: 0, preserved: 0 });
});

test("legacy championship season outbox preserves independent grants despite different historical evidence", async () => {
  const { db, seasonId, actorId, event } = await championshipFixture();
  await db.update(schema.seasons).set({ status: "closing" }).where(eq(schema.seasons.id, seasonId));
  await finalizeSeason(db, seasonId);
  await reconcileSeasonAwards(db, seasonId, actorId);
  const grants = await db.select().from(schema.awardGrants);
  const plan = await planSeasonAwards(db, seasonId);
  await db.insert(schema.championshipAwardAllocations).values({ id: randomUUID(), eventId: event.id, phase: "season", grants: await storeJson(plan.map(g => ({ ...g, evidence: { old: true } }))) });
  await deliverChampionshipAwards(db, event.id);
  expect(await db.select().from(schema.awardGrants)).toEqual(grants);
  expect((await db.select().from(schema.championshipAwardAllocations))[0]!.deliveredAt).not.toBeNull();
});
