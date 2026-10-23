import { beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import { testUserIdForWallet } from "./rbac-fixtures.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { claimModerationReview, listModerationQueue, listModerationRecovery, readModerationReview, reopenModerationReview, triageModerationReview } from "../services/moderation-intake.js";

let db: DrizzleDB, owner: string, moderator: string, admin: string;
async function user(role?: string) {
  const id = randomUUID(), walletAddress = `0x${id.replaceAll("-", "")}`;
  await db.insert(schema.users).values({ id, walletAddress });
  if (role) {
    const [row] = await db.select().from(schema.roles).where(eq(schema.roles.name, role));
    await db.insert(schema.userRoles).values({ userId: testUserIdForWallet(walletAddress), roleId: row!.id, grantedBy: "test" });
  }
  return id;
}
beforeEach(async () => {
  db = await setupTestDB(); await seedRBAC(db);
  owner = await user(); moderator = await user("moderator"); admin = await user("admin");
});
const create = () => createOwnedAgentProfile(db, { userId: owner }, { name: `Agent ${randomUUID().slice(0, 8)}`, personality: "Original" });
const edit = (id: string) => updateOwnedAgentProfile(db, { userId: owner }, id, { personality: randomUUID(), submissionId: randomUUID() });
const unqueue = (id: string) => db.delete(schema.agentScreenings).where(eq(schema.agentScreenings.contentRevisionId, id));
const review = async (id: string) => (await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id, id)))[0]!;
const migrate = () => db.transaction(async tx => {
  const statements = readFileSync(new URL("../../drizzle/0127_close_unscreened_superseded_reviews.sql", import.meta.url), "utf8").split("--> statement-breakpoint");
  for (const statement of statements) await tx.execute(sql.raw(statement));
});

test("migration closes and releases obsolete unscreened reviews without rewriting profiles or evidence", async () => {
  const old = await create(); const current = await edit(old.profile.id);
  await unqueue(old.receipt.contentRevisionId!);
  const claimed = await claimModerationReview(db, moderator, { reviewId: old.receipt.moderationRecordId!, actionId: randomUUID() });
  const profiles = await db.select().from(schema.agentProfiles);
  const revisions = await db.select().from(schema.agentContentRevisions);
  const actions = await db.select().from(schema.moderationActions);
  await migrate(); await migrate();
  expect(await review(old.receipt.moderationRecordId!)).toMatchObject({ status: "superseded", version: claimed.version + 1, disposition: "allowed", held: false });
  expect(await db.select().from(schema.moderationClaims)).toHaveLength(0);
  expect((await listModerationQueue(db, moderator)).items.map(row => row.id)).toEqual([current.receipt.moderationRecordId!]);
  await expect(claimModerationReview(db, moderator, { reviewId: old.receipt.moderationRecordId!, actionId: randomUUID() })).rejects.toMatchObject({ code: "claim_unavailable" });
  await expect(triageModerationReview(db, moderator, { reviewId: old.receipt.moderationRecordId!, actionId: randomUUID(), action: "flag", reason: "Late flag", token: claimed.claim!.token, version: claimed.version })).rejects.toMatchObject({ code: "review_conflict" });
  expect(await db.select().from(schema.agentProfiles)).toEqual(profiles);
  expect(await db.select().from(schema.agentContentRevisions)).toEqual(revisions);
  expect(await db.select().from(schema.moderationActions)).toEqual(actions);
  expect((await readModerationReview(db, moderator, old.receipt.moderationRecordId!)).revision!.id).toBe(old.receipt.contentRevisionId!);
  expect((await listModerationRecovery(db, admin)).resolved).toEqual([expect.objectContaining({ id: old.receipt.moderationRecordId!, status: "superseded" })]);
});

test("migration preserves current, published, screened and explicitly triaged work", async () => {
  const protectedReviews: string[] = [];
  const patches = [{ flagged: true }, { held: true }, { route: "escalated" as const }, { disposition: "rejected" as const }, { cycle: 2 }, { status: "resolved" }];
  for (const patch of patches) {
    const old = await create(); await edit(old.profile.id); await unqueue(old.receipt.contentRevisionId!);
    await db.update(schema.agentModerationReviews).set(patch).where(eq(schema.agentModerationReviews.id, old.receipt.moderationRecordId!));
    protectedReviews.push(old.receipt.moderationRecordId!);
  }
  const screened = await create(); await edit(screened.profile.id); protectedReviews.push(screened.receipt.moderationRecordId!);
  const published = await create(); const latest = await edit(published.profile.id);
  await unqueue(published.receipt.contentRevisionId!); await unqueue(latest.receipt.contentRevisionId!);
  await db.update(schema.agentProfiles).set({ contentRevisionId: published.receipt.contentRevisionId }).where(eq(schema.agentProfiles.id, published.profile.id));
  protectedReviews.push(published.receipt.moderationRecordId!, latest.receipt.moderationRecordId!);
  const before = await Promise.all(protectedReviews.map(review));
  await migrate();
  expect(await Promise.all(protectedReviews.map(review))).toEqual(before);
});

test("a new submission closes legacy unscreened work, frees its claim, and supports explicit admin recovery", async () => {
  const old = await create(); await unqueue(old.receipt.contentRevisionId!);
  await claimModerationReview(db, moderator, { reviewId: old.receipt.moderationRecordId!, actionId: randomUUID() });
  const current = await edit(old.profile.id);
  const closed = await review(old.receipt.moderationRecordId!);
  expect(closed.status).toBe("superseded");
  expect((await claimModerationReview(db, moderator, { actionId: randomUUID() })).reviewId).toBe(current.receipt.moderationRecordId!);
  await expect(reopenModerationReview(db, moderator, { reviewId: closed.id, actionId: randomUUID(), version: closed.version, reason: "Inspect history" })).rejects.toMatchObject({ status: 403 });
  await reopenModerationReview(db, admin, { reviewId: closed.id, actionId: randomUUID(), version: closed.version, reason: "Inspect history" });
  await edit(old.profile.id);
  expect(await review(closed.id)).toMatchObject({ status: "pending", cycle: 2 });
});


test("claiming while a legacy revision is superseded cannot leave a dangling claim", async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = await create(); await unqueue(old.receipt.contentRevisionId!);
    const results = await Promise.allSettled([
      claimModerationReview(db, moderator, { reviewId: old.receipt.moderationRecordId!, actionId: randomUUID() }),
      edit(old.profile.id),
    ]);
    expect(results[1]!.status).toBe("fulfilled");
    if (results[0]!.status === "rejected") expect(results[0]!.reason).toMatchObject({ code: "claim_unavailable" });
    expect(await review(old.receipt.moderationRecordId!)).toMatchObject({ status: "superseded" });
    expect(await db.select().from(schema.moderationClaims)).toHaveLength(0);
  }
});


test("cleanup releases a claim committed while waiting on the review lock", async () => {
  const old = await create(); await unqueue(old.receipt.contentRevisionId!);
  let editing: ReturnType<typeof edit> | undefined;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM agent_moderation_reviews WHERE id = ${old.receipt.moderationRecordId!} FOR UPDATE`);
    const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    editing = edit(old.profile.id);
    // Wait for the real cleanup statement to take its snapshot and block.
    let blocked = false;
    for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
      const rows = await db.execute(sql`SELECT pid FROM pg_stat_activity
        WHERE ${backend!.pid} = ANY(pg_blocking_pids(pid))
          AND query LIKE '%UPDATE agent_moderation_reviews AS review%'`);
      blocked = rows.length > 0;
      if (!blocked) await Bun.sleep(10);
    }
    expect(blocked).toBe(true);
    const acquiredAt = new Date().toISOString();
    await tx.insert(schema.moderationClaims).values({ reviewerId: moderator, reviewId: old.receipt.moderationRecordId!, token: randomUUID(), acquiredAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  await editing;
  expect((await review(old.receipt.moderationRecordId!)).status).toBe("superseded");
  expect(await db.select().from(schema.moderationClaims)).toHaveLength(0);
});
