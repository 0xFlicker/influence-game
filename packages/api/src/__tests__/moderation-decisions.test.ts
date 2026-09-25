import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { claimModerationReview, decideModerationReview, previewModerationDecision, reopenModerationReview } from "../services/moderation-intake.js";
import { archiveOwnedAgentProfile, restoreArchivedAgentProfile } from "../services/agent-profile-lifecycle.js";
import { readOwnerContent } from "../services/agent-content-submissions.js";
import { planModerationSelection } from "../services/moderation-selection.js";
import { joinQueue, getQueueStatus } from "../services/queue-enrollment.js";
import { createSeason } from "../services/seasons.js";
import { getPublicAgentPreviewsByProfileIds } from "../services/public-agent-preview.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";
import { freezeWaitingRosterInTransaction } from "../services/roster-freeze.js";
import { resolveFreeTrackEffectiveRuntimeSnapshot, resolveGameEffectiveAgentRevisionInTransaction } from "../services/agent-revisions.js";

describe("whole-revision moderation decisions", () => {
  let db: DrizzleDB;
  let owner: string;
  let moderator: string;
  let admin: string;
  const context = () => ({ userId: owner, publicBaseUrl: "http://localhost" });
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
  beforeEach(async () => {
    db = await setupTestDB();
    await seedRBAC(db);
    owner = await user(); moderator = await user("moderator"); admin = await user("admin");
  });
  const create = () => createOwnedAgentProfile(db, context(), { name: "Arden Vale", personality: "Initial", gender: "non-binary" });
  const edit = (id: string, personality: string) => updateOwnedAgentProfile(db, context(), id, { personality, submissionId: randomUUID() });
  const profile = async (id: string) => (await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id)))[0]!;
  async function command(reviewId: string, action: "accept" | "reject", who = moderator) {
    const claim = await claimModerationReview(db, who, { reviewId, actionId: randomUUID() });
    const preview = await previewModerationDecision(db, who, { reviewId, action });
    return { actionId: randomUUID(), reviewId, action, token: claim.claim!.token, version: preview.reviewVersion,
      previewFingerprint: preview.fingerprint, expectedDisposition: preview.beforeDisposition,
      disposition: preview.afterDisposition, reason: "Whole snapshot reviewed" };
  }
  test("rejects R2, holds R3, restores R1, then publishes reviewed R4 without undo rolling it back", async () => {
    const r1 = await create();
    const r2 = await edit(r1.profile.id, "Second");
    const r3 = await edit(r1.profile.id, "Third");
    const reject = await command(r2.receipt.moderationRecordId!, "reject");
    const removed = await decideModerationReview(db, moderator, reject);
    expect(await decideModerationReview(db, moderator, reject)).toEqual(removed);
    expect(await profile(r1.profile.id)).toMatchObject({ contentRevisionId: r1.profile.contentRevisionId,
      latestContentRevisionId: r3.profile.contentRevisionId, personality: "Initial", moderationRequired: true });
    const [held] = await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id, r3.receipt.moderationRecordId!));
    expect(held).toMatchObject({ held: true, status: "pending" });
    const before = await profile(r1.profile.id);
    const r4 = await edit(r1.profile.id, "Corrected complete snapshot");
    expect(r4.receipt.publication).toBe("held");
    expect(await profile(r1.profile.id)).toMatchObject({ personality: "Initial", currentRevisionId: before.currentRevisionId });
    await decideModerationReview(db, moderator, await command(r4.receipt.moderationRecordId!, "accept"));
    expect(await profile(r1.profile.id)).toMatchObject({ personality: "Corrected complete snapshot", contentRevisionId: r4.receipt.contentRevisionId });
    const undoPreview = await previewModerationDecision(db, admin, { reviewId: reject.reviewId, action: "reject" });
    const undo = { ...reject, actionId: randomUUID(), undoActionId: reject.actionId, token: "", version: undoPreview.reviewVersion,
      previewFingerprint: undoPreview.fingerprint, expectedDisposition: undoPreview.beforeDisposition, disposition: undoPreview.afterDisposition };
    await expect(decideModerationReview(db, moderator, undo)).rejects.toMatchObject({ code: "moderation_forbidden" });
    const restored = await decideModerationReview(db, admin, undo);
    expect(await decideModerationReview(db, admin, undo)).toEqual(restored);
    expect(await profile(r1.profile.id)).toMatchObject({ personality: "Corrected complete snapshot", contentRevisionId: r4.receipt.contentRevisionId });
    expect((await db.select().from(schema.agentContentRevisions))).toHaveLength(4);
    expect((await db.select().from(schema.moderationActions)).filter(a => a.kind === "undo")).toHaveLength(1);
  });
  test("archived moderation keeps the competitive revision synchronized through restore", async () => {
    const first = await create();
    const second = await edit(first.profile.id, "Second personality");
    const rejected = await command(second.receipt.moderationRecordId!, "reject");
    await decideModerationReview(db, moderator, rejected);
    const before = await profile(first.profile.id);
    expect(await archiveOwnedAgentProfile(db, owner, first.profile.id)).toBe("archived");
    const preview = await previewModerationDecision(db, admin, { reviewId: rejected.reviewId, action: "reject" });
    await decideModerationReview(db, admin, { ...rejected, actionId: randomUUID(), undoActionId: rejected.actionId, token: "",
      version: preview.reviewVersion, previewFingerprint: preview.fingerprint, expectedDisposition: "rejected", disposition: "allowed" });
    const archived = await profile(first.profile.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.personality).toBe("Second personality");
    expect(archived.currentRevisionId).not.toBe(before.currentRevisionId);
    const [revision] = await db.select().from(schema.agentRevisions).where(eq(schema.agentRevisions.id, archived.currentRevisionId!));
    expect(revision!.trigger).toBe("moderation");
    expect(revision!.effectiveRuntimeSnapshot).toEqual({ ...resolveFreeTrackEffectiveRuntimeSnapshot(archived) });
    await restoreArchivedAgentProfile(db, admin, { profileId: archived.id, version: archived.moderationVersion, reason: "Restore reviewed character" });
    const restored = await profile(first.profile.id);
    const resolved = await db.transaction(tx => resolveGameEffectiveAgentRevisionInTransaction(tx, {
      profile: restored, effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(restored),
    }));
    expect(restored.archivedAt).toBeNull();
    expect(resolved.created).toBe(false);
    expect(resolved.revision.id).toBe(archived.currentRevisionId!);
  });
  test("archival is reversible, audited, and never deletes or approves content", async () => {
    const first = await create();
    await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
    expect(await archiveOwnedAgentProfile(db, owner, first.profile.id)).toBe("archived");
    expect(await archiveOwnedAgentProfile(db, owner, first.profile.id)).toBe("archived");
    const archived = await profile(first.profile.id);
    expect(archived.archivedAt).not.toBeNull();
    await expect(edit(first.profile.id, "Bypass")).rejects.toMatchObject({ code: "agent_not_found" });
    await expect(restoreArchivedAgentProfile(db, moderator, { profileId: archived.id, version: archived.moderationVersion, reason: "Restore" })).rejects.toMatchObject({ status: 403 });
    await restoreArchivedAgentProfile(db, admin, { profileId: archived.id, version: archived.moderationVersion, reason: "Owner requested recovery" });
    await expect(restoreArchivedAgentProfile(db, admin, { profileId: archived.id, version: archived.moderationVersion, reason: "Owner requested recovery" })).resolves.toMatchObject({ archived: false });
    expect(await profile(first.profile.id)).toMatchObject({ archivedAt: null, contentRevisionId: null, moderationRequired: true });
    expect(await db.select().from(schema.agentProfileLifecycleActions)).toHaveLength(2);
    expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(1);
    await expect(Promise.resolve(db.execute(sql`DELETE FROM agent_profile_lifecycle_actions`))).rejects.toThrow();
  });
  test("owner recovery and partial corrections retain the latest submitted fields without publishing them", async () => {
    const first = await create();
    await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
    const correction = await updateOwnedAgentProfile(db, context(), first.profile.id, { personality: "Corrected", backstory: "Retain this draft story", submissionId: randomUUID() });
    const next = await updateOwnedAgentProfile(db, context(), first.profile.id, { strategyStyle: "New strategy", expectedContentRevisionId: correction.receipt.contentRevisionId, submissionId: randomUUID() });
    const saved = await profile(first.profile.id);
    expect(saved.personality).toBe("Initial");
    const recovery = await readOwnerContent(db, saved);
    expect(recovery).toMatchObject({ published: null, availability: "withheld", submitted: { revisionId: next.receipt.contentRevisionId, held: true, content: { personality: "Corrected", backstory: "Retain this draft story", strategyStyle: "New strategy" } } });
    expect(JSON.stringify(recovery)).not.toContain('"assets"');
    await decideModerationReview(db, moderator, await command(next.receipt.moderationRecordId!, "accept"));
    expect(await profile(first.profile.id)).toMatchObject({ personality: "Corrected", backstory: "Retain this draft story", strategyStyle: "New strategy" });
  });
  test("rejecting the first revision withholds the character, retains identity and blocks identical resubmission publication", async () => {
    const first = await create();
    await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
    expect(await profile(first.profile.id)).toMatchObject({ contentRevisionId: null, moderationRequired: true });
    const same = await edit(first.profile.id, "Initial");
    expect(same.receipt).toMatchObject({ publication: "held", contentRevisionId: first.receipt.contentRevisionId });
    expect(await profile(first.profile.id)).toMatchObject({ contentRevisionId: null });
    expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(1);
  });
  test("owner changes invalidate a preview and a failed decision preserves the lease", async () => {
    const first = await create();
    const cmd = await command(first.receipt.moderationRecordId!, "reject");
    await edit(first.profile.id, "Newer snapshot");
    await expect(decideModerationReview(db, moderator, cmd)).rejects.toMatchObject({ code: "review_conflict" });
    expect(await profile(first.profile.id)).toMatchObject({ personality: "Newer snapshot", moderationRequired: false });
    expect(await db.select().from(schema.moderationClaims)).toHaveLength(1);
  });
  test("expired leases and changed expected dispositions cannot toggle a decision", async () => {
    const first = await create();
    const cmd = await command(first.receipt.moderationRecordId!, "reject");
    await expect(decideModerationReview(db, moderator, { ...cmd, expectedDisposition: "rejected" })).rejects.toMatchObject({ code: "review_conflict" });
    await db.update(schema.moderationClaims).set({ acquiredAt: new Date(Date.now() - 11 * 60_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(decideModerationReview(db, moderator, cmd)).rejects.toMatchObject({ code: "lease_expired" });
    expect((await profile(first.profile.id)).moderationRequired).toBe(false);
  });
  test("a name conflict withholds instead of altering the saved snapshot", async () => {
    const first = await create();
    const changed = await updateOwnedAgentProfile(db, context(), first.profile.id, { name: "Arden Renamed" });
    await createOwnedAgentProfile(db, context(), { name: "Arden Vale", personality: "Another character" });
    await decideModerationReview(db, moderator, await command(changed.receipt.moderationRecordId!, "reject"));
    expect(await profile(first.profile.id)).toMatchObject({ contentRevisionId: null, name: "Arden Renamed" });
    const [review] = await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id, changed.receipt.moderationRecordId!));
    expect(review).toMatchObject({ route: "escalated", status: "pending", disposition: "rejected" });
  });
  test("dependent resolved work explicitly reopens, invalidates claims and keeps flags", async () => {
    const first = await create();
    const child = await edit(first.profile.id, "Child");
    await decideModerationReview(db, moderator, await command(child.receipt.moderationRecordId!, "accept"));
    await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
    const [review] = await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id, child.receipt.moderationRecordId!));
    expect(review).toMatchObject({ held: true, status: "pending", cycle: 2 });
    expect((await db.select().from(schema.moderationActions)).some(a => a.kind === "dependent_reopen")).toBe(true);
  });
  test("unknown ancestry withholds rather than inferring a chronology", async () => {
    const first = await create();
    const [revision] = await db.select().from(schema.agentContentRevisions);
    const [review] = await db.select().from(schema.agentModerationReviews);
    const legacy = { ...revision!, id: "legacy", ancestryKnown: false, parentRevisionId: null };
    const result = planModerationSelection({ states: [{ revision: legacy, review: { ...review!, contentRevisionId: legacy.id } },
      { revision: revision!, review: review! }], targetId: first.profile.contentRevisionId!, disposition: "rejected", latestId: revision!.id, effectiveId: revision!.id });
    expect(result).toMatchObject({ effectiveId: null, unknownAncestry: true, heldIds: ["legacy"] });
  });
  test("withholding removes the current public profile and blocks new admission and freeze while retaining standing membership", async () => {
    await createSeason(db, { slug: "moderation-season", name: "Moderation season" });
    const first = await create();
    await joinQueue(db, context(), { queueType: "daily-free", agentId: first.profile.id });
    const gameId = randomUUID();
    await db.insert(schema.games).values({ id: gameId, slug: "moderation-waiting", status: "waiting", minPlayers: 1, maxPlayers: 4,
      config: JSON.stringify({ modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" }, maxRounds: 10, visibility: "public", viewerMode: "speedrun" }) });
    const admission = { playerId: randomUUID(), gameId, userId: owner, agentProfileId: first.profile.id };
    await db.transaction(tx => admitOwnedSeatInTransaction(tx, admission));
    const seatsBefore = await db.select().from(schema.gamePlayers);
    expect((await getPublicAgentPreviewsByProfileIds(db, [first.profile.id])).has(first.profile.id)).toBe(true);
    await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
    expect((await getPublicAgentPreviewsByProfileIds(db, [first.profile.id])).has(first.profile.id)).toBe(false);
    expect(await db.select().from(schema.freeGameQueue)).toHaveLength(1);
    expect((await getQueueStatus(db, context())).queue.eligibility).toBe("temporarily-ineligible");
    await expect(db.transaction(tx => admitOwnedSeatInTransaction(tx, { ...admission, playerId: randomUUID() }))).rejects.toMatchObject({ reason: "profile_unavailable" });
    await expect(db.transaction(tx => freezeWaitingRosterInTransaction(tx, { gameId, frozenAt: new Date().toISOString() }))).rejects.toMatchObject({ reason: "profile_unavailable" });
    expect(await db.select().from(schema.gamePlayers)).toEqual(seatsBefore);
  });
  test("admin undo respects an independent archive", async () => {
    const first = await create();
    const rejected = await command(first.receipt.moderationRecordId!, "reject");
    await decideModerationReview(db, moderator, rejected);
    const archivedAt = new Date().toISOString();
    await db.update(schema.agentProfiles).set({ archivedAt }).where(eq(schema.agentProfiles.id, first.profile.id));
    const preview = await previewModerationDecision(db, admin, { reviewId: rejected.reviewId, action: "reject" });
    expect(preview).toMatchObject({ archived: true, unavailable: true, afterRevisionId: null });
    await decideModerationReview(db, admin, { ...rejected, actionId: randomUUID(), undoActionId: rejected.actionId, token: "",
      version: preview.reviewVersion, previewFingerprint: preview.fingerprint, expectedDisposition: "rejected", disposition: "allowed" });
    expect((await profile(first.profile.id)).archivedAt).toBe(archivedAt);
    expect((await getPublicAgentPreviewsByProfileIds(db, [first.profile.id])).size).toBe(0);
  });
  for (const action of ["accept", "reject"] as const) {
    test(`${action} on rejected content has the explicit keep-rejected/restore semantics`, async () => {
      const first = await create();
      const rejected = await decideModerationReview(db, moderator, await command(first.receipt.moderationRecordId!, "reject"));
      const reopen = { reviewId: rejected.reviewId, version: rejected.version, actionId: randomUUID(), reason: "Review the disposition again" };
      await expect(reopenModerationReview(db, moderator, reopen)).rejects.toMatchObject({ code: "moderation_forbidden" });
      const reopened = await reopenModerationReview(db, admin, reopen);
      expect(reopened.cycle).toBe(2);
      expect(await reopenModerationReview(db, admin, reopen)).toEqual(reopened);
      const cmd = await command(reopened.reviewId, action);
      expect(cmd.expectedDisposition).toBe("rejected");
      expect(cmd.disposition).toBe(action === "accept" ? "rejected" : "allowed");
      await decideModerationReview(db, moderator, cmd);
      expect((await profile(first.profile.id)).contentRevisionId).toBe(action === "accept" ? null : first.profile.contentRevisionId);
      const [review] = await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id, reopened.reviewId));
      expect(review).toMatchObject({ status: "resolved", disposition: cmd.disposition });
    });
  }
  test("decision persistence failure rolls publication, ratings and audit back together", async () => {
    const first = await create();
    const second = await edit(first.profile.id, "Second");
    const cmd = await command(second.receipt.moderationRecordId!, "reject");
    await db.execute(sql`CREATE FUNCTION reject_test_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'reject' THEN RAISE EXCEPTION 'injected decision failure'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER reject_test_decision BEFORE INSERT ON moderation_actions FOR EACH ROW EXECUTE FUNCTION reject_test_decision()`);
    try {
      await expect(decideModerationReview(db, moderator, cmd)).rejects.toThrow();
      expect(await profile(first.profile.id)).toMatchObject({ contentRevisionId: second.profile.contentRevisionId, currentRevisionId: second.profile.currentRevisionId, moderationRequired: false });
      expect(await db.select().from(schema.agentRevisions)).toHaveLength(2);
      expect(await db.select().from(schema.moderationClaims)).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_test_decision ON moderation_actions`);
      await db.execute(sql`DROP FUNCTION reject_test_decision()`);
    }
  });
});
