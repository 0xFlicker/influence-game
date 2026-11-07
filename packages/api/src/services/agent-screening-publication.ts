import { recordAvatarChange } from "./avatar-generation.js";
import type { AgentMutationWaitingSeatReference } from "./agent-mutation-receipt.js";
import { abortActiveOwnerLearningReview } from "./owner-learning-worker.js";
import { finalizePublishedLearning } from "./owner-learning-publication.js";
import { publishSubmittedVoice } from "./agent-submission-preferences.js";
import { publishContentImages } from "./agent-draft-images.js";
import { and, eq, isNull, not, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { loadPayloads } from "./payload-storage.js";
import { decodeContentSnapshot } from "./agent-content-submissions.js";
import {
  ExpandedWaitingGameSetError,
  describeAgentMutationReceipt,
  findWaitingFollowerGames,
} from "./agent-profile-management.js";
import {
  ensureActiveAgentRevisionInTransaction,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "./agent-revisions.js";
import {
  OwnedSeatProjectionError,
  lockRosterGamesInTransaction,
  reconcileOwnedProfileSeatsInLockedGame,
} from "./owned-seat-projection.js";
import { SCREENING_POLICY_VERSION } from "./agent-screening-policy.js";
import { normalizeModelPreference } from "@influence/engine/game-model-routing";

/** A completed assessment may publish only its current untouched submission. */
export async function publishScreenedAgent(db: DrizzleDB, revisionId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await publishScreenedAgentOnce(db, revisionId);
    } catch (error) {
      if (error instanceof ExpandedWaitingGameSetError && attempt < 2) continue;
      if (error instanceof OwnedSeatProjectionError)
        await db
          .update(schema.agentScreenings)
          .set({ failureCode: "publication_roster_conflict" })
          .where(
            and(
              eq(schema.agentScreenings.contentRevisionId, revisionId),
              eq(
                schema.agentScreenings.policyVersion,
                SCREENING_POLICY_VERSION,
              ),
            ),
          );
      throw error;
    }
  }
}
async function publishScreenedAgentOnce(db: DrizzleDB, revisionId: string) {
  const [revision] = await loadPayloads(
    db
      .select()
      .from(schema.agentContentRevisions)
      .where(eq(schema.agentContentRevisions.id, revisionId)),
  );
  if (!revision) throw new Error("Screened revision is missing");
  let resolvedReviewId: string | null = null;
  const result = await db.transaction(async (tx) => {
    const candidates = await findWaitingFollowerGames(
      tx,
      revision.agentProfileId,
    );
    const games = await lockRosterGamesInTransaction(
      tx,
      candidates.map((game) => game.id),
    );
    await tx.execute(
      sql`SELECT id FROM agent_profiles WHERE id = ${revision.agentProfileId} FOR UPDATE`,
    );
    const [profile] = await tx
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, revision.agentProfileId));
    const [review] = await tx
      .select()
      .from(schema.agentModerationReviews)
      .where(eq(schema.agentModerationReviews.contentRevisionId, revisionId))
      .for("update");
    const [screening] = await tx
      .select()
      .from(schema.agentScreenings)
      .where(
        and(
          eq(schema.agentScreenings.contentRevisionId, revisionId),
          eq(schema.agentScreenings.policyVersion, SCREENING_POLICY_VERSION),
        ),
      );
    if (
      !profile ||
      !review ||
      !screening ||
      profile.latestContentRevisionId !== revisionId ||
      profile.archivedAt ||
      profile.moderationRequired ||
      review.status !== "pending" ||
      review.version !== 0 ||
      review.flagged ||
      review.route !== "ordinary" ||
      screening.status !== "completed" ||
      screening.recommendation !== "no_concern"
    )
      return;
    const [claim] = await tx
      .select({ id: schema.moderationClaims.reviewId })
      .from(schema.moderationClaims)
      .where(
        and(
          eq(schema.moderationClaims.reviewId, review.id),
          sql`${schema.moderationClaims.expiresAt}::timestamptz > now()`,
        ),
      );
    if (claim) return;
    const currentGames = await findWaitingFollowerGames(tx, profile.id);
    if (
      currentGames.some(
        (game) => !candidates.some((candidate) => candidate.id === game.id),
      )
    )
      throw new ExpandedWaitingGameSetError();
    const visited = new Set<string>();
    let ancestor = revision.parentRevisionId;
    while (ancestor && ancestor !== profile.contentRevisionId) {
      if (visited.has(ancestor))
        throw new Error("Content ancestry contains a cycle");
      visited.add(ancestor);
      const [parent] = await tx
        .select({
          parent: schema.agentContentRevisions.parentRevisionId,
          review: schema.agentModerationReviews,
        })
        .from(schema.agentContentRevisions)
        .innerJoin(
          schema.agentModerationReviews,
          eq(
            schema.agentModerationReviews.contentRevisionId,
            schema.agentContentRevisions.id,
          ),
        )
        .where(
          and(
            eq(schema.agentContentRevisions.id, ancestor),
            eq(schema.agentContentRevisions.agentProfileId, profile.id),
          ),
        )
        .for("update");
      if (!parent) throw new Error("Content ancestry is unavailable");
      const [ancestorClaim] = await tx
        .select({ id: schema.moderationClaims.reviewId })
        .from(schema.moderationClaims)
        .where(
          and(
            eq(schema.moderationClaims.reviewId, parent.review.id),
            sql`${schema.moderationClaims.expiresAt}::timestamptz > now()`,
          ),
        );
      if (
        ancestorClaim ||
        parent.review.disposition === "rejected" ||
        (parent.review.status === "pending" &&
          (parent.review.flagged ||
            parent.review.route === "escalated" ||
            parent.review.version > 0))
      ) {
        await tx
          .update(schema.agentScreenings)
          .set({ failureCode: "publication_ancestor_review" })
          .where(eq(schema.agentScreenings.id, screening.id));
        return;
      }
      ancestor = parent.parent;
    }
    const content = decodeContentSnapshot(revision.snapshot, profile);
    const [conflict] = await tx
      .select({ id: schema.agentProfiles.id })
      .from(schema.agentProfiles)
      .where(
        and(
          sql`lower(btrim(${schema.agentProfiles.name})) = lower(btrim(${content.name}))`,
          not(eq(schema.agentProfiles.id, profile.id)),
        ),
      );
    if (conflict) {
      await tx
        .update(schema.agentModerationReviews)
        .set({ flagged: true, version: review.version + 1 })
        .where(eq(schema.agentModerationReviews.id, review.id));
      return;
    }
    await tx
      .update(schema.agentScreenings)
      .set({ failureCode: null })
      .where(eq(schema.agentScreenings.id, screening.id));
    await publishContentImages(tx, revision.snapshot);
    const [accepted] = await tx
      .update(schema.agentProfiles)
      .set({
        ...content,
        modelPreference: normalizeModelPreference(
          revision.snapshot.modelPreference ?? profile.modelPreference,
        ),
        contentRevisionId: revisionId,
        moderationVersion: profile.moderationVersion + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.agentProfiles.id, profile.id))
      .returning();
    await publishSubmittedVoice(tx, accepted!, revision.snapshot);
    const activeRevision = await ensureActiveAgentRevisionInTransaction(tx, {
      profile: accepted!,
      effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(
        accepted!,
      ),
      trigger: "moderation",
    });
    const references: AgentMutationWaitingSeatReference[] = [];
    for (const game of games) {
      const [competition] = await tx
        .select({ id: schema.championshipMatchAttempts.gameId })
        .from(schema.championshipMatchAttempts)
        .where(eq(schema.championshipMatchAttempts.gameId, game.id));
      if (game.status === "waiting" && !game.startedAt && !competition) {
        const reconciliations = await reconcileOwnedProfileSeatsInLockedGame(
          tx,
          { game, userId: profile.userId, agentProfileId: profile.id },
        );
        references.push(
          ...reconciliations.map((row) => ({
            gameId: game.id,
            slug: game.slug,
            disposition: row.disposition,
            effectiveRevisionId: row.seat.agentRevisionId,
          })),
        );
      } else {
        const seats = await tx
          .select()
          .from(schema.gamePlayers)
          .where(
            and(
              eq(schema.gamePlayers.gameId, game.id),
              eq(schema.gamePlayers.agentProfileId, profile.id),
            ),
          );
        references.push(
          ...seats.map((seat) => ({
            gameId: game.id,
            slug: game.slug,
            disposition: "crossed_freeze" as const,
            effectiveRevisionId: seat.agentRevisionId,
          })),
        );
      }
    }
    if (profile.avatarUrl !== accepted!.avatarUrl)
      await recordAvatarChange(tx, {
        userId: profile.userId,
        agentProfileId: profile.id,
        source: revision.avatarChangeSource ?? "mcp_update",
        status: "completed",
        previousAvatarUrl: profile.avatarUrl,
        newAvatarUrl: accepted!.avatarUrl,
      });
    await tx
      .update(schema.agentModerationReviews)
      .set({ held: false, status: "resolved", version: review.version + 1 })
      .where(eq(schema.agentModerationReviews.id, review.id));
    await tx
      .delete(schema.moderationClaims)
      .where(eq(schema.moderationClaims.reviewId, review.id));
    const [published] = await tx
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id));
    const receipt = {
      ...(await describeAgentMutationReceipt(
        tx,
        published!,
        activeRevision,
        references,
      )),
      publication: "published" as const,
      contentRevisionId: revisionId,
      moderationRecordId: review.id,
    };
    resolvedReviewId = await finalizePublishedLearning(
      tx,
      profile,
      published!,
      revisionId,
      revision.snapshot,
      receipt,
    );
    return {
      profile: published!,
      receipt,
      profileRevision: {
        revisionId: activeRevision.revision.id,
        ordinal: activeRevision.revision.ordinal,
        outcome: activeRevision.created
          ? ("created" as const)
          : ("preserved" as const),
        active: true as const,
        ratingRecalibrated: activeRevision.ratingRecalibrated,
      },
    };
  });
  if (resolvedReviewId) abortActiveOwnerLearningReview(resolvedReviewId);
  return result;
}

/** Recover a crash between assessment persistence and publication, without provider dispatch. */
export async function reconcileScreenedAgents(db: DrizzleDB) {
  const rows = await db
    .select({ id: schema.agentScreenings.contentRevisionId })
    .from(schema.agentScreenings)
    .innerJoin(
      schema.agentModerationReviews,
      eq(
        schema.agentModerationReviews.contentRevisionId,
        schema.agentScreenings.contentRevisionId,
      ),
    )
    .innerJoin(
      schema.agentProfiles,
      eq(
        schema.agentProfiles.latestContentRevisionId,
        schema.agentScreenings.contentRevisionId,
      ),
    )
    .where(
      and(
        eq(schema.agentScreenings.policyVersion, SCREENING_POLICY_VERSION),
        eq(schema.agentScreenings.status, "completed"),
        eq(schema.agentScreenings.recommendation, "no_concern"),
        eq(schema.agentModerationReviews.status, "pending"),
        eq(schema.agentModerationReviews.version, 0),
        eq(schema.agentModerationReviews.flagged, false),
        eq(schema.agentProfiles.moderationRequired, false),
        isNull(schema.agentProfiles.archivedAt),
        eq(schema.agentModerationReviews.route, "ordinary"),
      ),
    )
    .orderBy(
      sql`${schema.agentScreenings.failureCode} IS NOT NULL`,
      schema.agentScreenings.createdAt,
    )
    .limit(16);
  for (const row of rows) {
    try {
      await publishScreenedAgent(db, row.id);
    } catch (error) {
      await db
        .update(schema.agentScreenings)
        .set({
          failureCode: sql`coalesce(${schema.agentScreenings.failureCode}, 'publication_failed')`,
        })
        .where(
          and(
            eq(schema.agentScreenings.contentRevisionId, row.id),
            eq(schema.agentScreenings.policyVersion, SCREENING_POLICY_VERSION),
          ),
        );
      console.error("[agent-screening] Publication pending", {
        revisionId: row.id,
        error,
      });
    }
  }
}
