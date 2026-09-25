import { randomUUID } from "node:crypto";
import { and, asc, eq, exists, gt, lte, not, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";
import { contentSnapshot, decodeContentSnapshot, ContentSubmissionConflict } from "./agent-content-submissions.js";
import { ensureActiveAgentRevisionInTransaction, resolveFreeTrackEffectiveRuntimeSnapshot } from "./agent-revisions.js";
import { findWaitingFollowerGames } from "./agent-profile-management.js";
import { lockRosterGamesInTransaction, reconcileOwnedProfileSeatsInLockedGame } from "./owned-seat-projection.js";
import { planModerationSelection } from "./moderation-selection.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type Reader = Pick<DrizzleDB, "select">;
type Review = typeof schema.agentModerationReviews.$inferSelect;
export type ModerationRoute = Review["route"];
const reviews = schema.agentModerationReviews;
const revisions = schema.agentContentRevisions;
const claims = schema.moderationClaims;
const actions = schema.moderationActions;
const LEASE_MS = 10 * 60 * 1000;
const MAX_LEASE_MS = 30 * 60 * 1000;

export class ModerationError extends Error {
  constructor(public code: string, message: string, public status: 400 | 403 | 404 | 409 = 409) {
    super(message);
  }
}

/** Resolve database authority on every request; token role claims are never moderation authority. */
export async function moderationAuthority(db: Reader, userId: string) {
  const rows = await db.select({ role: schema.roles.name, permission: schema.permissions.name })
    .from(schema.users)
    .innerJoin(schema.addressRoles, sql`lower(${schema.users.walletAddress}) = ${schema.addressRoles.walletAddress}`)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.addressRoles.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(eq(schema.users.id, userId));
  if (!rows.some(r => r.permission === "review_agent_content")) {
    throw new ModerationError("moderation_forbidden", "Moderator access is required.", 403);
  }
  const admin = rows.some(r => r.role === "admin" || r.role === "sysop");
  return {
    canEscalateReview: admin && rows.some(r => r.permission === "review_moderation_escalations"),
    canUndo: admin && rows.some(r => r.permission === "undo_moderation"),
  };
}

function checkRoute(route: ModerationRoute, authority: Awaited<ReturnType<typeof moderationAuthority>>) {
  if (route === "escalated" && !authority.canEscalateReview) {
    throw new ModerationError("review_not_found", "Review not found.", 404);
  }
}

async function databaseTime(db: Reader): Promise<string> {
  const [row] = await db.select({ now: sql<string>`clock_timestamp()::text` }).from(sql`(SELECT 1) AS clock_source`);
  return new Date(row!.now).toISOString();
}

function validActionId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ModerationError("invalid_action", "A UUID action ID is required.", 400);
  }
}

/** Small-queue writes serialize briefly; no provider, image, or storage I/O occurs under this lock. */
async function write<T>(db: DrizzleDB, userId: string, run: (tx: Tx, now: string, authority: Awaited<ReturnType<typeof moderationAuthority>>) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('moderation-intake'))`);
    const authority = await moderationAuthority(tx, userId);
    return run(tx, await databaseTime(tx), authority);
  });
}

export interface ModerationClaim {
  token: string;
  acquiredAt: string;
  expiresAt: string;
}
export interface ModerationReceipt {
  reviewId: string;
  version: number;
  cycle: number;
  route: ModerationRoute;
  flagged: boolean;
  claim: ModerationClaim | null;
}

/** Read-only impact calculation. Decision writes must recheck this fingerprint
 * under the profile/roster locks; an inbox version alone cannot fence owner edits. */
export async function previewModerationDecision(db: DrizzleDB, userId: string, input: {
  reviewId: string; action: "accept" | "reject";
}) {
  if (!["accept", "reject"].includes(input.action)) throw new ModerationError("invalid_action", "Invalid decision.", 400);
  return db.transaction(tx => readDecisionPreview(tx, userId, input), { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function resolveModerationEffect(tx: Reader, profile: Profile, states: Parameters<typeof planModerationSelection>[0]["states"], selection: ReturnType<typeof planModerationSelection>) {
    let recovery: string | null = selection.unknownAncestry ? "Unknown historical ancestry; dependent snapshots require individual review." : null;
    let effectiveId = selection.effectiveId;
    let content: ReturnType<typeof contentSnapshot> | null = null;
    if (effectiveId && effectiveId !== profile.contentRevisionId) {
      const selected = states.find(s => s.revision.id === effectiveId)!;
      try { content = decodeContentSnapshot(selected.revision.snapshot, profile); }
      catch (error) { if (!(error instanceof ContentSubmissionConflict)) throw error; recovery = error.message; effectiveId = null; }
      if (content) {
        await requireRetainedEvidence(tx, selected.revision.snapshot);
        const [conflict] = await tx.select({ id: schema.agentProfiles.id }).from(schema.agentProfiles)
          .where(and(sql`lower(btrim(${schema.agentProfiles.name})) = lower(btrim(${content.name}))`, not(eq(schema.agentProfiles.id, profile.id))));
        if (conflict) { recovery = "The selected snapshot's name is in use. Admin recovery is required."; effectiveId = null; content = null; }
      }
    }
    return { recovery, effectiveId, content };
}

async function readDecisionPreview(tx: Reader, userId: string, input: { reviewId: string; action: "accept" | "reject" }) {
    const authority = await moderationAuthority(tx, userId);
    const [target] = await tx.select({ review: reviews, revision: revisions }).from(reviews)
      .innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId)).where(eq(reviews.id, input.reviewId));
    if (!target) throw new ModerationError("review_not_found", "Review not found.", 404);
    checkRoute(target.review.route, authority);
    const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, target.revision.agentProfileId));
    if (!profile) throw new ModerationError("profile_unavailable", "The character is unavailable. Pass this review to an admin.");
    const states = await tx.select({ revision: revisions, review: reviews }).from(revisions)
      .innerJoin(reviews, eq(reviews.contentRevisionId, revisions.id)).where(eq(revisions.agentProfileId, profile.id));
    // Siblings in escalation must never be disclosed through an ordinary item.
    const disposition = input.action === "accept" ? target.review.disposition
      : target.review.disposition === "allowed" ? "rejected" : "allowed";
    const selection = planModerationSelection({ states, targetId: target.revision.id, disposition,
      latestId: profile.latestContentRevisionId, effectiveId: profile.contentRevisionId });
    const effect = await resolveModerationEffect(tx, profile, states, selection);
    const afterId = profile.archivedAt ? null : effect.effectiveId;
    return {
      reviewId: target.review.id, action: input.action, reviewVersion: target.review.version,
      profileVersion: profile.moderationVersion, beforeDisposition: target.review.disposition, afterDisposition: disposition,
      beforeRevisionId: profile.contentRevisionId, afterRevisionId: afterId,
      recovery: effect.recovery,
      unavailable: afterId === null, archived: profile.archivedAt !== null,
      heldRevisionCount: selection.heldIds.length,
      unknownAncestry: selection.unknownAncestry,
      fingerprint: sha256StableJson({ recovery: effect.recovery, selectedId: effect.effectiveId, profileVersion: profile.moderationVersion, effectiveId: profile.contentRevisionId,
        latestId: profile.latestContentRevisionId, archivedAt: profile.archivedAt, action: input.action,
        states: states.map(s => ({ id: s.revision.id, version: s.review.version, disposition: s.review.disposition,
          held: s.review.held, route: s.review.route })).sort((a, b) => a.id.localeCompare(b.id)) }),
      scope: "Current profile and future games only. Historical artwork, trailers, and public image URLs remain unchanged.",
    };
}

async function replay(tx: Tx, userId: string, actionId: string, requestHash: string): Promise<ModerationReceipt | null> {
  const [prior] = await tx.select().from(actions).where(eq(actions.id, actionId));
  if (!prior) return null;
  if (prior.actorId !== userId || prior.requestHash !== requestHash) {
    throw new ModerationError("action_conflict", "This action ID was already used for another request.");
  }
  // The immutable receipt is our own encoded result, never client-supplied JSON.
  return prior.result as unknown as ModerationReceipt;
}

async function receipt(tx: Tx, userId: string, actionId: string, requestHash: string, kind: string, review: Review, claim: ModerationClaim | null, reason: string | null = null) {
  const result: ModerationReceipt = { reviewId: review.id, version: review.version, cycle: review.cycle, route: review.route, flagged: review.flagged, claim };
  await tx.insert(actions).values({ id: actionId, actorId: userId, reviewId: review.id, kind, cycle: review.cycle, requestHash, reason, result: { ...result } });
  return result;
}

export async function listModerationQueue(db: DrizzleDB, userId: string, options: {
  route?: ModerationRoute; filter?: "all" | "available" | "mine" | "flagged"; offset?: number;
} = {}) {
  const authority = await moderationAuthority(db, userId);
  const route = options.route ?? "ordinary";
  const filter = options.filter ?? "all";
  const offset = options.offset ?? 0;
  if (!["ordinary", "escalated"].includes(route) || !["all", "available", "mine", "flagged"].includes(filter)
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new ModerationError("invalid_filter", "Invalid queue filter or offset.", 400);
  }
  checkRoute(route, authority);
  const now = await databaseTime(db);
  const live = db.select({ id: claims.reviewId }).from(claims).where(and(eq(claims.reviewId, reviews.id), gt(claims.expiresAt, now)));
  const where = and(eq(reviews.route, route), eq(reviews.status, "pending"),
    filter === "flagged" ? eq(reviews.flagged, true) : undefined,
    filter === "available" ? not(exists(live)) : undefined,
    filter === "mine" ? exists(db.select({ id: claims.reviewId }).from(claims).where(and(eq(claims.reviewId, reviews.id), eq(claims.reviewerId, userId), gt(claims.expiresAt, now)))) : undefined);
  const rows = await db.select({ id: reviews.id, version: reviews.version, cycle: reviews.cycle, flagged: reviews.flagged,
    disposition: reviews.disposition, route: reviews.route, createdAt: reviews.createdAt,
    agentProfileId: revisions.agentProfileId, name: sql<string>`coalesce(${revisions.snapshot}->>'name', 'Agent')`,
    ownSubmission: sql<boolean>`${revisions.userId} = ${userId}`,
    claimedBy: claims.reviewerId, expiresAt: claims.expiresAt,
  }).from(reviews).innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId))
    .leftJoin(claims, and(eq(claims.reviewId, reviews.id), gt(claims.expiresAt, now)))
    .where(where).orderBy(asc(reviews.createdAt), asc(reviews.id)).limit(26).offset(offset);
  const [activeClaim] = await db.select({ reviewId: claims.reviewId, expiresAt: claims.expiresAt, route: reviews.route }).from(claims)
    .innerJoin(reviews, eq(reviews.id, claims.reviewId)).where(and(eq(claims.reviewerId, userId), gt(claims.expiresAt, now), authority.canEscalateReview ? undefined : eq(reviews.route, "ordinary")));
  return { activeClaim: activeClaim ?? null, items: rows.slice(0, 25), nextOffset: rows.length > 25 ? offset + 25 : null, serverTime: now, ...authority };
}

export async function readModerationReview(db: DrizzleDB, userId: string, reviewId: string) {
  const authority = await moderationAuthority(db, userId);
  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
  if (!review) throw new ModerationError("review_not_found", "Review not found.", 404);
  checkRoute(review.route, authority);
  const [revision] = await db.select().from(revisions).where(eq(revisions.id, review.contentRevisionId));
  const [parentRow] = revision?.parentRevisionId ? await db.select({ revision: revisions, review: reviews }).from(revisions)
    .innerJoin(reviews, eq(reviews.contentRevisionId, revisions.id)).where(eq(revisions.id, revision.parentRevisionId)) : [];
  const parent = parentRow && (parentRow.review.route === "ordinary" || authority.canEscalateReview) ? parentRow.revision : null;
  const now = await databaseTime(db);
  const [claim] = await db.select().from(claims).where(and(eq(claims.reviewId, review.id), gt(claims.expiresAt, now)));
  const historyRows = await db.select({ result: actions.result, id: actions.id, kind: actions.kind, actorId: actions.actorId, cycle: actions.cycle, reason: actions.reason, createdAt: actions.createdAt })
    .from(actions).where(eq(actions.reviewId, review.id)).orderBy(asc(actions.createdAt), asc(actions.id));
  const history = historyRows.map(({ result, ...event }) => ({ ...event,
    ...(["accept", "reject", "undo"].includes(event.kind) ? { decisionVersion: result.version, beforeDisposition: result.beforeDisposition, disposition: result.disposition, unavailable: result.afterRevisionId === null } : {}),
  }));
  const [profile] = await db.select({ archivedAt: schema.agentProfiles.archivedAt }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, revision!.agentProfileId));
  return { review, revision, parent: parent ?? null, archived: Boolean(profile?.archivedAt), history, serverTime: now,
    claim: claim ? { reviewerId: claim.reviewerId, acquiredAt: claim.acquiredAt, expiresAt: claim.expiresAt,
      ...(claim.reviewerId === userId ? { token: claim.token } : {}) } : null, ...authority };
}

/** Only return retained bytes referenced by this authorized review, never arbitrary asset hashes. */
export async function readModerationEvidence(db: DrizzleDB, userId: string, reviewId: string, hash: string) {
  const { revision, parent } = await readModerationReview(db, userId, reviewId);
  const referenced = [revision, parent].some(r => {
    const assets = r?.snapshot.assets;
    return assets && typeof assets === "object" && !Array.isArray(assets) && Object.values(assets).includes(hash);
  });
  if (!referenced) throw new ModerationError("evidence_not_found", "Evidence not found.", 404);
  const [asset] = await db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash));
  if (!asset) throw new ModerationError("evidence_unavailable", "Retained evidence is unavailable.");
  return asset.bytes;
}

export async function claimModerationReview(db: DrizzleDB, userId: string, input: { actionId: string; reviewId?: string; route?: ModerationRoute }) {
  validActionId(input.actionId);
  const route = input.route ?? "ordinary";
  if (!["ordinary", "escalated"].includes(route)) throw new ModerationError("invalid_route", "Invalid queue route.", 400);
  const hash = sha256StableJson({ kind: "claim", route, reviewId: input.reviewId ?? null });
  return write(db, userId, async (tx, now, authority) => {
    checkRoute(route, authority);
    const prior = await replay(tx, userId, input.actionId, hash);
    if (prior) return prior;
    const [own] = await tx.select().from(claims).where(and(eq(claims.reviewerId, userId), gt(claims.expiresAt, now)));
    if (own) throw new ModerationError("already_claimed", "Finish or release your current review before taking another.");
    await tx.delete(claims).where(lte(claims.expiresAt, now));
    const eligible = and(eq(reviews.status, "pending"), eq(reviews.route, route),
      input.reviewId ? eq(reviews.id, input.reviewId) : undefined,
      not(exists(tx.select({ id: claims.reviewId }).from(claims).where(eq(claims.reviewId, reviews.id)))),
      sql`${revisions.userId} <> ${userId}`,
      input.reviewId ? undefined : not(exists(tx.select({ id: actions.id }).from(actions).where(and(
        eq(actions.reviewId, reviews.id), eq(actions.actorId, userId), eq(actions.kind, "flag"), eq(actions.cycle, reviews.cycle))))));
    const [selected] = await tx.select({ review: reviews }).from(reviews).innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId))
      .where(eligible).orderBy(asc(reviews.createdAt), asc(reviews.id)).limit(1);
    if (!selected) throw new ModerationError("claim_unavailable", "No eligible review is available to claim.");
    const claim = { token: randomUUID(), acquiredAt: now, expiresAt: new Date(new Date(now).getTime() + LEASE_MS).toISOString() };
    await tx.insert(claims).values({ reviewerId: userId, reviewId: selected.review.id, ...claim });
    return receipt(tx, userId, input.actionId, hash, "claim", selected.review, claim);
  });
}

export type ModerationTriageAction = "extend" | "release" | "flag" | "pass" | "return";
export async function triageModerationReview(db: DrizzleDB, userId: string, input: {
  actionId: string; reviewId: string; action: ModerationTriageAction; token: string; version: number; reason?: string;
}) {
  validActionId(input.actionId);
  if (!["extend", "release", "flag", "pass", "return"].includes(input.action) || !Number.isSafeInteger(input.version) || input.version < 0 || typeof input.token !== "string") {
    throw new ModerationError("invalid_action", "Invalid moderation action.", 400);
  }
  if (input.reason !== undefined && typeof input.reason !== "string") throw new ModerationError("invalid_reason", "Reason must be text.", 400);
  const reason = input.reason?.trim() || null;
  if ((["flag", "pass", "return"].includes(input.action) && !reason) || (reason?.length ?? 0) > 2000) {
    throw new ModerationError("invalid_reason", "Provide a reason of at most 2000 characters.", 400);
  }
  const hash = sha256StableJson({ ...input, reason });
  return write(db, userId, async (tx, now, authority) => {
    const prior = await replay(tx, userId, input.actionId, hash);
    if (prior) return prior;
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, input.reviewId));
    if (!review) throw new ModerationError("review_not_found", "Review not found.", 404);
    checkRoute(review.route, authority);
    if (review.status !== "pending" || review.version !== input.version) throw new ModerationError("review_conflict", "The review changed. Refresh before acting.");
    const [claim] = await tx.select().from(claims).where(and(eq(claims.reviewId, review.id), eq(claims.reviewerId, userId), eq(claims.token, input.token), gt(claims.expiresAt, now)));
    if (!claim) throw new ModerationError("lease_expired", "Your claim expired or was reassigned. Refresh before acting.");
    if (input.action === "extend") {
      const expiresAt = new Date(Math.min(new Date(now).getTime() + LEASE_MS, new Date(claim.acquiredAt).getTime() + MAX_LEASE_MS)).toISOString();
      if (new Date(expiresAt).getTime() <= new Date(claim.expiresAt).getTime()) throw new ModerationError("lease_limit", "The claim cannot be extended further. Release it when ready.");
      await tx.update(claims).set({ expiresAt }).where(eq(claims.reviewerId, userId));
      return receipt(tx, userId, input.actionId, hash, input.action, review, { token: claim.token, acquiredAt: claim.acquiredAt, expiresAt });
    }
    if ((input.action === "pass" && review.route !== "ordinary") || (input.action === "return" && review.route !== "escalated")) {
      throw new ModerationError("invalid_route", "This action is not available in this queue.");
    }
    const route = input.action === "pass" ? "escalated" : input.action === "return" ? "ordinary" : review.route;
    const [updated] = await tx.update(reviews).set({ route, flagged: review.flagged || input.action === "flag", version: review.version + 1 })
      .where(eq(reviews.id, review.id)).returning();
    await tx.delete(claims).where(eq(claims.reviewId, review.id));
    return receipt(tx, userId, input.actionId, hash, input.action, updated!, null, reason);
  });
}

type Profile = typeof schema.agentProfiles.$inferSelect;


async function requireRetainedEvidence(tx: Reader, snapshot: Record<string, unknown>) {
  const assets = snapshot.assets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) throw new ModerationError("evidence_unavailable", "Evidence is unavailable. Flag or pass this review.");
  const refs = assets as Record<string, unknown>;
  const crop = snapshot.portraitCrop as Profile["portraitCrop"];
  const urls = [snapshot.avatarUrl, snapshot.fullBodyReferenceUrl, crop?.sourceUrl].filter((url): url is string => typeof url === "string" && url.length > 0);
  for (const url of urls) {
    const hash = refs[url];
    if (typeof hash !== "string") throw new ModerationError("evidence_unavailable", "Evidence is unavailable. Flag or pass this review.");
    const [asset] = await tx.select({ hash: schema.agentContentAssets.hash }).from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, hash));
    if (!asset) throw new ModerationError("evidence_unavailable", "Evidence is unavailable. Flag or pass this review.");
  }
}

export async function decideModerationReview(db: DrizzleDB, userId: string, input: {
  actionId: string; reviewId: string; action: "accept" | "reject"; token: string;
  version: number; previewFingerprint: string; expectedDisposition: "allowed" | "rejected";
  disposition: "allowed" | "rejected"; reason?: string;
  undoActionId?: string;
}) {
  validActionId(input.actionId);
  if (input.reason !== undefined && typeof input.reason !== "string") throw new ModerationError("invalid_reason", "Reason must be text.", 400);
  const reason = input.reason?.trim() || null;
  if (!["accept", "reject"].includes(input.action) || !Number.isSafeInteger(input.version)
    || !["allowed", "rejected"].includes(input.expectedDisposition) || !["allowed", "rejected"].includes(input.disposition)
    || (input.action === "reject" && !reason) || (reason?.length ?? 0) > 2000) {
    throw new ModerationError("invalid_action", "Provide a valid decision and a reason for rejecting a disposition.", 400);
  }
  const hash = sha256StableJson({ ...input, reason });
  return write(db, userId, async (tx, _now, authority) => {
    const prior = await replay(tx, userId, input.actionId, hash);
    if (prior) return prior;
    const [target] = await tx.select({ review: reviews, revision: revisions }).from(reviews)
      .innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId)).where(eq(reviews.id, input.reviewId));
    if (!target) throw new ModerationError("review_not_found", "Review not found.", 404);
    checkRoute(target.review.route, authority);
    if (target.revision.userId === userId) throw new ModerationError("self_review", "You cannot review your own submission.", 403);
    if (input.undoActionId) {
      if (!authority.canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
      const [original] = await tx.select().from(actions).where(eq(actions.id, input.undoActionId));
      if (!original || original.reviewId !== input.reviewId || original.kind !== "reject" || original.result.version !== target.review.version
        || original.result.disposition !== input.expectedDisposition || original.result.beforeDisposition !== input.disposition
        || input.action !== "reject" || !reason) throw new ModerationError("undo_conflict", "This decision cannot be undone in its current state.");
    }
    // Match owner mutations: games, then profile. Never lock a profile before a game.
    const candidates = await findWaitingFollowerGames(tx, target.revision.agentProfileId);
    const games = await lockRosterGamesInTransaction(tx, candidates.map(g => g.id));
    await tx.execute(sql`SELECT id FROM agent_profiles WHERE id = ${target.revision.agentProfileId} FOR UPDATE`);
    const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, target.revision.agentProfileId));
    if (!profile) throw new ModerationError("profile_unavailable", "The character is unavailable.");
    const currentGames = await findWaitingFollowerGames(tx, profile.id);
    if (currentGames.some(g => !candidates.some(c => c.id === g.id))) throw new ModerationError("roster_conflict", "Game enrollment changed. Refresh the preview.");
    const now = await databaseTime(tx); // Lock waits must not extend an expired lease.
    const currentAuthority = await moderationAuthority(tx, userId);
    checkRoute(target.review.route, currentAuthority);
    if (input.undoActionId && !currentAuthority.canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
    const [claim] = await tx.select().from(claims).where(and(eq(claims.reviewId, input.reviewId), eq(claims.reviewerId, userId), eq(claims.token, input.token), gt(claims.expiresAt, now)));
    if (!claim && !input.undoActionId) throw new ModerationError("lease_expired", "Your claim expired or was reassigned. Refresh before acting.");
    const preview = await readDecisionPreview(tx, userId, input);
    if ((!input.undoActionId && target.review.status !== "pending") || preview.reviewVersion !== input.version || preview.fingerprint !== input.previewFingerprint
      || preview.beforeDisposition !== input.expectedDisposition || preview.afterDisposition !== input.disposition) {
      throw new ModerationError("review_conflict", "The review or character changed. Refresh the preview before deciding.");
    }
    await requireRetainedEvidence(tx, target.revision.snapshot);
    const states = await tx.select({ revision: revisions, review: reviews }).from(revisions)
      .innerJoin(reviews, eq(reviews.contentRevisionId, revisions.id)).where(eq(revisions.agentProfileId, profile.id));
    const selection = planModerationSelection({ states, targetId: target.revision.id, disposition: input.disposition,
      latestId: profile.latestContentRevisionId, effectiveId: profile.contentRevisionId });
    const { recovery, effectiveId, content } = await resolveModerationEffect(tx, profile, states, selection);
    for (const state of selection.states) {
      if (!selection.heldIds.includes(state.revision.id)) continue;
      const reopened = state.review.status !== "pending";
      const [held] = await tx.update(reviews).set({ held: true, status: "pending", version: state.review.version + 1,
        cycle: state.review.cycle + (reopened ? 1 : 0) }).where(eq(reviews.id, state.review.id)).returning();
      await tx.delete(claims).where(eq(claims.reviewId, state.review.id));
      await receipt(tx, userId, randomUUID(), hash, reopened ? "dependent_reopen" : "dependent_hold", held!, null, `Dependent on decision ${input.actionId}`);
    }
    const [updated] = await tx.update(reviews).set({ disposition: input.disposition, held: false,
      status: recovery ? "pending" : "resolved", route: recovery ? "escalated" : target.review.route,
      version: target.review.version + 1 }).where(eq(reviews.id, input.reviewId)).returning();
    const [effective] = await tx.update(schema.agentProfiles).set({ ...(effectiveId && content ? content : {}),
      contentRevisionId: effectiveId, moderationVersion: profile.moderationVersion + 1,
      moderationRequired: profile.moderationRequired || input.disposition === "rejected", updatedAt: now,
    }).where(eq(schema.agentProfiles.id, profile.id)).returning();
    if (effectiveId && effectiveId !== profile.contentRevisionId) {
      // Archive controls availability, not which competitive revision describes the profile.
      await ensureActiveAgentRevisionInTransaction(tx, { profile: effective!, effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(effective!), trigger: "moderation" });
      for (const game of games) {
        if (!profile.archivedAt && game.status === "waiting" && !game.startedAt) await reconcileOwnedProfileSeatsInLockedGame(tx, { game, userId: profile.userId, agentProfileId: profile.id });
      }
    }
    await tx.delete(claims).where(eq(claims.reviewId, input.reviewId));
    const result = { reviewId: updated!.id, version: updated!.version, cycle: updated!.cycle, route: updated!.route,
      flagged: updated!.flagged, claim: null, beforeDisposition: target.review.disposition, disposition: input.disposition,
      beforeRevisionId: profile.contentRevisionId, afterRevisionId: profile.archivedAt ? null : effectiveId, profileVersion: profile.moderationVersion + 1,
      heldRevisionIds: selection.heldIds, recovery, historicalMediaUnchanged: true, undoActionId: input.undoActionId ?? null };
    await tx.insert(actions).values({ id: input.actionId, actorId: userId, reviewId: input.reviewId, kind: input.undoActionId ? "undo" : input.action,
      cycle: updated!.cycle, requestHash: hash, reason, result });
    return result;
  });
}

/** Explicit recovery starts another review cycle; ordinary readers cannot reopen history. */
export async function reopenModerationReview(db: DrizzleDB, userId: string, input: {
  actionId: string; reviewId: string; version: number; reason: string;
}) {
  validActionId(input.actionId);
  if (typeof input.reason !== "string") throw new ModerationError("invalid_reason", "Reason must be text.", 400);
  const reason = input.reason.trim();
  if (!reason || reason.length > 2000 || !Number.isSafeInteger(input.version)) throw new ModerationError("invalid_action", "Provide a reason and current review version.", 400);
  const hash = sha256StableJson({ ...input, reason, kind: "reopen" });
  return write(db, userId, async (tx, now, authority) => {
    if (!authority.canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
    const prior = await replay(tx, userId, input.actionId, hash);
    if (prior) return prior;
    const [target] = await tx.select({ review: reviews, revision: revisions }).from(reviews)
      .innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId)).where(eq(reviews.id, input.reviewId));
    if (!target) throw new ModerationError("review_not_found", "Review not found.", 404);
    if (target.review.version !== input.version || target.review.status !== "resolved") throw new ModerationError("review_conflict", "Only unchanged resolved work can be reopened.");
    await tx.execute(sql`SELECT id FROM agent_profiles WHERE id = ${target.revision.agentProfileId} FOR UPDATE`);
    if (!(await moderationAuthority(tx, userId)).canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
    const [review] = await tx.update(reviews).set({ status: "pending", cycle: target.review.cycle + 1, version: target.review.version + 1 })
      .where(eq(reviews.id, input.reviewId)).returning();
    await tx.update(schema.agentProfiles).set({ moderationVersion: sql`${schema.agentProfiles.moderationVersion} + 1`, updatedAt: now })
      .where(eq(schema.agentProfiles.id, target.revision.agentProfileId));
    await tx.delete(claims).where(eq(claims.reviewId, input.reviewId));
    return receipt(tx, userId, input.actionId, hash, "reopen", review!, null, reason);
  });
}

/** An actor may recover their own committed response after network loss, never another actor's lease. */
export async function readModerationReceipt(db: DrizzleDB, userId: string, actionId: string) {
  const authority = await moderationAuthority(db, userId);
  const [action] = await db.select().from(actions).where(and(eq(actions.id, actionId), eq(actions.actorId, userId)));
  if (!action) throw new ModerationError("receipt_not_found", "Receipt not found.", 404);
  const [review] = await db.select().from(reviews).where(eq(reviews.id, action.reviewId));
  if (!review) throw new ModerationError("review_not_found", "Review not found.", 404);
  if (action.kind === "pass" && review.route === "escalated" && !authority.canEscalateReview) return { reviewId: review.id, kind: "pass", recorded: true };
  checkRoute(review.route, authority);
  return { reviewId: review.id, kind: action.kind, recorded: true, result: action.result };
}

/** Minimal admin recovery inventory; no claim tokens or arbitrary audit JSON. */
export async function listModerationRecovery(db: DrizzleDB, userId: string, offset = 0) {
  if (!(await moderationAuthority(db, userId)).canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new ModerationError("invalid_input", "Invalid offset.", 400);
  const resolved = await db.select({ id: reviews.id, version: reviews.version, disposition: reviews.disposition,
    name: sql<string>`coalesce(${revisions.snapshot}->>'name', 'Agent')`, profileId: revisions.agentProfileId })
    .from(reviews).innerJoin(revisions, eq(revisions.id, reviews.contentRevisionId)).where(eq(reviews.status, "resolved"))
    .orderBy(asc(reviews.createdAt), asc(reviews.id)).limit(26).offset(offset);
  const archived = await db.select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name, version: schema.agentProfiles.moderationVersion,
    archivedAt: schema.agentProfiles.archivedAt }).from(schema.agentProfiles).where(sql`${schema.agentProfiles.archivedAt} IS NOT NULL`)
    .orderBy(asc(schema.agentProfiles.archivedAt), asc(schema.agentProfiles.id)).limit(26).offset(offset);
  return { resolved: resolved.slice(0, 25), archived: archived.slice(0, 25), nextOffset: resolved.length > 25 || archived.length > 25 ? offset + 25 : null };
}

export async function hasModerationAccess(db: Reader, userId: string): Promise<boolean> {
  try { await moderationAuthority(db, userId); return true; }
  catch (error) { if (error instanceof ModerationError && error.status === 403) return false; throw error; }
}
