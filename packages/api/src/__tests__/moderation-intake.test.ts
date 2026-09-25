import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import { claimModerationReview, listModerationQueue, moderationAuthority, readModerationEvidence, readModerationReview, triageModerationReview } from "../services/moderation-intake.js";

describe("moderation intake", () => {
  let db: DrizzleDB;
  let moderator: string;
  let other: string;
  let admin: string;
  let owner: string;
  async function user(role?: string) {
    const id = randomUUID();
    const walletAddress = `0x${id.replaceAll("-", "")}`;
    await db.insert(schema.users).values({ id, walletAddress });
    if (role) {
      const [row] = await db.select().from(schema.roles).where(eq(schema.roles.name, role));
      await db.insert(schema.addressRoles).values({ walletAddress, roleId: row!.id, grantedBy: "test" });
    }
    return id;
  }
  async function submission(userId = owner, route: "ordinary" | "escalated" = "ordinary") {
    const contentRevisionId = randomUUID();
    const id = randomUUID();
    await db.insert(schema.agentContentRevisions).values({ id: contentRevisionId, userId, agentProfileId: randomUUID(), fingerprint: randomUUID(), snapshot: { name: "Original character", assets: {} } });
    await db.insert(schema.agentModerationReviews).values({ id, contentRevisionId, route });
    return id;
  }
  const claim = (who: string, reviewId?: string, route?: "ordinary" | "escalated") => claimModerationReview(db, who, { actionId: randomUUID(), reviewId, route });
  beforeEach(async () => {
    db = await setupTestDB();
    await seedRBAC(db);
    moderator = await user("moderator");
    other = await user("moderator");
    admin = await user("admin");
    owner = await user();
  });

  test("grants moderator review only and reads fresh role authority", async () => {
    expect(await moderationAuthority(db, moderator)).toEqual({ canEscalateReview: false, canUndo: false });
    expect(await moderationAuthority(db, admin)).toEqual({ canEscalateReview: true, canUndo: true });
    const sysop = await user("sysop");
    expect(await moderationAuthority(db, sysop)).toEqual({ canEscalateReview: true, canUndo: true });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "moderator"));
    const perms = await db.select({ name: schema.permissions.name }).from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId)).where(eq(schema.rolePermissions.roleId, role!.id));
    expect(perms.map(p => p.name)).toEqual(["review_agent_content"]);
    await expect(listModerationQueue(db, owner)).rejects.toMatchObject({ code: "moderation_forbidden" });
    const id = await submission();
    const held = await claim(moderator, id);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, moderator));
    await db.delete(schema.addressRoles).where(eq(schema.addressRoles.walletAddress, u!.walletAddress!));
    await expect(readModerationReview(db, moderator, id)).rejects.toMatchObject({ code: "moderation_forbidden" });
    await expect(triageModerationReview(db, moderator, { actionId: randomUUID(), reviewId: id, action: "flag", token: held.claim!.token, version: held.version, reason: "Check this" })).rejects.toMatchObject({ code: "moderation_forbidden" });
  });

  test("only one reviewer can claim an item and no one can claim their own work", async () => {
    const id = await submission();
    const results = await Promise.allSettled([claim(moderator, id), claim(other, id)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const ownId = await submission(admin);
    await expect(claim(admin, ownId)).rejects.toMatchObject({ code: "claim_unavailable" });
  });

  test("one live claim per reviewer spans both queues and concurrent tabs", async () => {
    const first = await submission();
    const second = await submission(owner, "escalated");
    const results = await Promise.allSettled([claim(admin, first), claim(admin, second, "escalated")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(schema.moderationClaims)).length).toBe(1);
  });

  test("claim receipts are idempotent; a reused ID cannot claim different work", async () => {
    const id = await submission();
    const actionId = randomUUID();
    const original = await claimModerationReview(db, moderator, { reviewId: id, actionId });
    expect(await claimModerationReview(db, moderator, { reviewId: id, actionId })).toEqual(original);
    await expect(claimModerationReview(db, moderator, { reviewId: await submission(), actionId })).rejects.toMatchObject({ code: "action_conflict" });
    expect(await db.select().from(schema.moderationActions)).toHaveLength(1);
  });

  test("expiry makes work available without a sweeper and fences the old token", async () => {
    const id = await submission();
    const held = await claim(moderator, id);
    await db.update(schema.moderationClaims).set({ acquiredAt: new Date(Date.now() - 11 * 60_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(schema.moderationClaims.reviewId, id));
    expect((await listModerationQueue(db, other, { filter: "available" })).items.map(r => r.id)).toContain(id);
    const newClaim = await claim(other, id);
    expect(newClaim.claim!.token).not.toBe(held.claim!.token);
    await expect(triageModerationReview(db, moderator, { actionId: randomUUID(), reviewId: id, action: "release", token: held.claim!.token, version: held.version })).rejects.toMatchObject({ code: "lease_expired" });
    expect((await readModerationReview(db, other, id)).claim?.token).toBe(newClaim.claim!.token);
  });

  test("claim extension is explicit and bounded to 30 minutes", async () => {
    const id = await submission();
    const held = await claim(moderator, id);
    const acquiredAt = new Date(Date.now() - 25 * 60_000).toISOString();
    await db.update(schema.moderationClaims).set({ acquiredAt, expiresAt: new Date(Date.now() + 60_000).toISOString() }).where(eq(schema.moderationClaims.reviewId, id));
    const extended = await triageModerationReview(db, moderator, { actionId: randomUUID(), reviewId: id, action: "extend", token: held.claim!.token, version: held.version });
    expect(Date.parse(extended.claim!.expiresAt) - Date.parse(acquiredAt)).toBe(30 * 60_000);
    await expect(triageModerationReview(db, moderator, { actionId: randomUUID(), reviewId: id, action: "extend", token: held.claim!.token, version: held.version })).rejects.toMatchObject({ code: "lease_limit" });
  });

  test("flag releases the claim, leaves work in queue, and take-next avoids the same flagger", async () => {
    const id = await submission();
    const held = await claim(moderator, id);
    const command = { actionId: randomUUID(), reviewId: id, action: "flag" as const, token: held.claim!.token, version: held.version, reason: "Needs another review" };
    const result = await triageModerationReview(db, moderator, command);
    expect(result).toMatchObject({ flagged: true, route: "ordinary", claim: null, version: held.version + 1 });
    expect(await triageModerationReview(db, moderator, command)).toEqual(result);
    expect((await listModerationQueue(db, moderator, { filter: "flagged" })).items.map(r => r.id)).toEqual([id]);
    await expect(claim(moderator)).rejects.toMatchObject({ code: "claim_unavailable" });
    expect((await claim(other)).reviewId).toBe(id);
    expect((await readModerationReview(db, moderator, id)).claim).not.toHaveProperty("token");
  });

  test("pass hides all review detail and evidence from moderators; only admins return it", async () => {
    const id = await submission();
    const held = await claim(moderator, id);
    await triageModerationReview(db, moderator, { actionId: randomUUID(), reviewId: id, action: "pass", token: held.claim!.token, version: held.version, reason: "Admin decision needed" });
    expect((await listModerationQueue(db, moderator)).items).toHaveLength(0);
    await expect(listModerationQueue(db, moderator, { route: "escalated" })).rejects.toMatchObject({ status: 404 });
    await expect(readModerationReview(db, moderator, id)).rejects.toMatchObject({ status: 404 });
    await expect(readModerationEvidence(db, moderator, id, "a".repeat(64))).rejects.toMatchObject({ status: 404 });
    await expect(claim(moderator, id, "escalated")).rejects.toMatchObject({ status: 404 });
    const taken = await claim(admin, id, "escalated");
    await expect(triageModerationReview(db, admin, { actionId: randomUUID(), reviewId: id, action: "pass", token: taken.claim!.token, version: taken.version, reason: "Again" })).rejects.toMatchObject({ code: "invalid_route" });
    await triageModerationReview(db, admin, { actionId: randomUUID(), reviewId: id, action: "return", token: taken.claim!.token, version: taken.version, reason: "Ready for ordinary review" });
    expect((await listModerationQueue(db, moderator)).items.map(r => r.id)).toEqual([id]);
  });

  test("stale review versions and missing reasons do not mutate claims or history", async () => {
    const id = await submission();
    const held = await claim(moderator, id);
    const command = { actionId: randomUUID(), reviewId: id, action: "flag" as const, token: held.claim!.token, version: held.version };
    await expect(triageModerationReview(db, moderator, command)).rejects.toMatchObject({ code: "invalid_reason" });
    await db.update(schema.agentModerationReviews).set({ version: 5 }).where(eq(schema.agentModerationReviews.id, id));
    await expect(triageModerationReview(db, moderator, { ...command, reason: "Check" })).rejects.toMatchObject({ code: "review_conflict" });
    expect(await db.select().from(schema.moderationActions)).toHaveLength(1);
    expect(await db.select().from(schema.moderationClaims)).toHaveLength(1);
  });

  test("evidence reads require an authorized review reference and actions are immutable", async () => {
    const hash = "a".repeat(64);
    await db.insert(schema.agentContentAssets).values({ hash, bytes: Buffer.from("retained image") });
    const revisionId = randomUUID();
    await db.insert(schema.agentContentRevisions).values({ id: revisionId, userId: owner, agentProfileId: randomUUID(), fingerprint: "test", snapshot: { name: "Image", assets: { "/image.png": hash } } });
    const id = randomUUID();
    await db.insert(schema.agentModerationReviews).values({ id, contentRevisionId: revisionId });
    expect((await readModerationEvidence(db, moderator, id, hash)).toString()).toBe("retained image");
    await expect(readModerationEvidence(db, moderator, await submission(), hash)).rejects.toMatchObject({ status: 404 });
    await claim(moderator, id);
    await expect(Promise.resolve(db.execute(sql`DELETE FROM moderation_actions`))).rejects.toThrow();
    await expect(Promise.resolve(db.execute(sql`UPDATE moderation_actions SET reason = 'rewritten'`))).rejects.toThrow();
  });

  test("ordinary child does not disclose escalated parent-only evidence", async () => {
    const parentId = randomUUID(), childId = randomUUID(), profileId = randomUUID();
    const parentHash = "b".repeat(64), childHash = "c".repeat(64);
    await db.insert(schema.agentContentAssets).values([{ hash: parentHash, bytes: Buffer.from("parent") }, { hash: childHash, bytes: Buffer.from("child") }]);
    await db.insert(schema.agentContentRevisions).values({ id: parentId, userId: owner, agentProfileId: profileId, fingerprint: parentId, snapshot: { assets: { parent: parentHash } } });
    await db.insert(schema.agentContentRevisions).values({ id: childId, parentRevisionId: parentId, userId: owner, agentProfileId: profileId, fingerprint: childId, snapshot: { assets: { child: childHash } } });
    const parentReview = randomUUID(), childReview = randomUUID();
    await db.insert(schema.agentModerationReviews).values([{ id: parentReview, contentRevisionId: parentId, route: "escalated" }, { id: childReview, contentRevisionId: childId }]);
    expect((await readModerationReview(db, moderator, childReview)).parent).toBeNull();
    await expect(readModerationEvidence(db, moderator, childReview, parentHash)).rejects.toMatchObject({ status: 404 });
    expect((await readModerationEvidence(db, moderator, childReview, childHash)).toString()).toBe("child");
    expect((await readModerationReview(db, admin, childReview)).parent?.id).toBe(parentId);
  });

  test("queue pagination never exposes lease tokens or escalated records", async () => {
    for (let i = 0; i < 27; i++) await submission();
    await submission(owner, "escalated");
    const held = await claim(other);
    const first = await listModerationQueue(db, moderator);
    const second = await listModerationQueue(db, moderator, { offset: first.nextOffset! });
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(r => r.id)).size).toBe(27);
    expect(JSON.stringify(first)).not.toContain(held.claim!.token);
  });
});
