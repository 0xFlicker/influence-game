import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { acquireDailyFreeLocks } from "./queue-enrollment.js";
import { lockProfileAfterLiveRosterGames } from "./owned-seat-projection.js";
import { recordAvatarChange } from "./avatar-generation.js";
import { moderationAuthority, ModerationError } from "./moderation-intake.js";

/** Retain identity, competitive history, immutable submissions and all seat references. */
export async function archiveOwnedAgentProfile(db: DrizzleDB, userId: string, profileId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM avatar_generation_requests
        WHERE user_id = ${userId}
          AND agent_profile_id = ${profileId}
          AND status IN ('queued', 'processing')
        ORDER BY id
        FOR UPDATE
      `);
      const activeAvatarRequests = await tx.select().from(schema.avatarGenerationRequests).where(and(
        eq(schema.avatarGenerationRequests.userId, userId),
        eq(schema.avatarGenerationRequests.agentProfileId, profileId),
        inArray(schema.avatarGenerationRequests.status, ["queued", "processing"]),
      ));
      await acquireDailyFreeLocks(tx);
      const locked = await lockProfileAfterLiveRosterGames(tx, {
        profileId,
        userId: userId,
      });
      if (!locked.profile) return "not-found" as const;
      if (locked.profile.archivedAt) return "archived" as const;
      if (locked.liveGameIds.length > 0) return "active-game" as const;

      const standingEntry = await tx.select({ id: schema.freeGameQueue.id })
        .from(schema.freeGameQueue)
        .where(eq(schema.freeGameQueue.agentProfileId, profileId))
        .limit(1);
      if (standingEntry.length > 0) return "standing" as const;

      const [competitionReceipt, competitionRating, competitionSnapshot] = await Promise.all([
        tx.select({ id: schema.competitionReceipts.id })
          .from(schema.competitionReceipts)
          .where(eq(schema.competitionReceipts.agentProfileId, profileId))
          .limit(1),
        tx.select({ agentProfileId: schema.agentCompetitionRatings.agentProfileId })
          .from(schema.agentCompetitionRatings)
          .where(eq(schema.agentCompetitionRatings.agentProfileId, profileId))
          .limit(1),
        tx.select({ id: schema.competitionRatingSnapshots.id })
          .from(schema.competitionRatingSnapshots)
          .where(eq(schema.competitionRatingSnapshots.agentProfileId, profileId))
          .limit(1),
      ]);
      if (competitionReceipt.length > 0
        || competitionRating.length > 0
        || competitionSnapshot.length > 0) return "rated" as const;

      if (activeAvatarRequests.length > 0) {
        const now = new Date().toISOString();
        await tx.update(schema.avatarGenerationRequests).set({
          status: "skipped",
          failureCode: "profile_archived",
          failureMessage: "The Agent was archived before portrait generation completed.",
          completedAt: now,
          updatedAt: now,
        }).where(inArray(
          schema.avatarGenerationRequests.id,
          activeAvatarRequests.map((request) => request.id),
        ));
        for (const request of activeAvatarRequests) {
          await recordAvatarChange(tx, {
            userId: userId,
            agentProfileId: profileId,
            source: "generation_skipped",
            status: "skipped",
            generationRequestId: request.id,
            previousAvatarUrl: locked.profile.avatarUrl,
            newAvatarUrl: locked.profile.avatarUrl,
            safeMetadata: { reason: "profile_archived" },
          });
        }
      }

      const now = new Date().toISOString();
      const version = locked.profile.moderationVersion + 1;
      await tx.update(schema.agentProfiles).set({ archivedAt: now, moderationVersion: version, updatedAt: now })
        .where(eq(schema.agentProfiles.id, profileId));
      await tx.insert(schema.agentProfileLifecycleActions).values({ id: randomUUID(), agentProfileId: profileId,
        actorId: userId, kind: "archive", reason: "Owner archived character", profileVersion: version });
      return "archived" as const;
    });
}

export async function restoreArchivedAgentProfile(db: DrizzleDB, userId: string, input: { profileId: string; version: number; reason: string }) {
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000 || !Number.isSafeInteger(input.version)) throw new ModerationError("invalid_input", "A version and reason are required.", 400);
  return db.transaction(async tx => {
    if (!(await moderationAuthority(tx, userId)).canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
    const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, input.profileId)).for("update");
    if (!(await moderationAuthority(tx, userId)).canUndo) throw new ModerationError("moderation_forbidden", "Admin recovery access is required.", 403);
    if (!profile) throw new ModerationError("profile_unavailable", "Character not found.", 404);
    const [prior] = await tx.select().from(schema.agentProfileLifecycleActions).where(and(eq(schema.agentProfileLifecycleActions.agentProfileId, profile.id), eq(schema.agentProfileLifecycleActions.kind, "restore"), eq(schema.agentProfileLifecycleActions.profileVersion, input.version + 1)));
    if (prior && prior.actorId === userId && prior.reason === input.reason.trim()) return { profileId: profile.id, version: prior.profileVersion, archived: false };
    if (profile.moderationVersion !== input.version || !profile.archivedAt) throw new ModerationError("profile_conflict", "Character changed. Refresh before restoring.");
    const version = profile.moderationVersion + 1;
    await tx.update(schema.agentProfiles).set({ archivedAt: null, moderationVersion: version, updatedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, profile.id)).returning();
    await tx.insert(schema.agentProfileLifecycleActions).values({ id: randomUUID(), agentProfileId: profile.id, actorId: userId, kind: "restore", reason: input.reason.trim(), profileVersion: version });
    return { profileId: profile.id, version, archived: false };
  });
}
