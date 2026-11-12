import { desc, eq, inArray, and } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { SCREENING_POLICY_VERSION } from "./agent-screening-policy.js";
/** Batched owner-only metadata. No reads enqueue or resume generation. */
export async function agentCollectionActivity(
  db: DrizzleDB,
  profiles: (typeof schema.agentProfiles.$inferSelect)[],
) {
  const ids = profiles.map((profile) => profile.id),
    revisions = profiles.flatMap((profile) =>
      profile.latestContentRevisionId ? [profile.latestContentRevisionId] : [],
    );
  if (!ids.length) return new Map();
  const [reviews, screenings, jobs, voices, artwork, intents] =
    await Promise.all([
      revisions.length
        ? db
            .select()
            .from(schema.agentModerationReviews)
            .where(
              inArray(
                schema.agentModerationReviews.contentRevisionId,
                revisions,
              ),
            )
        : [],
      revisions.length
        ? db
            .select({
              revision: schema.agentScreenings.contentRevisionId,
              status: schema.agentScreenings.status,
              recommendation: schema.agentScreenings.recommendation,
              failureCode: schema.agentScreenings.failureCode,
            })
            .from(schema.agentScreenings)
            .where(
              and(
                inArray(schema.agentScreenings.contentRevisionId, revisions),
                eq(
                  schema.agentScreenings.policyVersion,
                  SCREENING_POLICY_VERSION,
                ),
              ),
            )
        : [],
      db
        .select()
        .from(schema.agentVisualUpdates)
        .where(inArray(schema.agentVisualUpdates.agentId, ids))
        .orderBy(desc(schema.agentVisualUpdates.createdAt)),
      db
        .select()
        .from(schema.agentVoices)
        .where(inArray(schema.agentVoices.agentProfileId, ids)),
      db
        .select({
          id: schema.characterReferenceJobs.id,
          agentId: schema.characterReferenceJobs.agentId,
          status: schema.characterReferenceJobs.status,
          stage: schema.characterReferenceJobs.stage,
        })
        .from(schema.characterReferenceJobs)
        .where(inArray(schema.characterReferenceJobs.agentId, ids))
        .orderBy(desc(schema.characterReferenceJobs.createdAt)),
      db
        .select()
        .from(schema.agentEntryIntents)
        .where(inArray(schema.agentEntryIntents.agentId, ids)),
    ]);
  return new Map(
    profiles.map((profile) => {
      const review = reviews.find(
          (row) => row.contentRevisionId === profile.latestContentRevisionId,
        ),
        screening = screenings.find(
          (row) => row.revision === profile.latestContentRevisionId,
        ),
        job = jobs.find((row) => row.agentId === profile.id),
        voice = voices.find(
          (row) => row.agentProfileId === profile.id,
        )?.assignment;
      const reviewState =
        profile.contentRevisionId === profile.latestContentRevisionId
          ? ("accepted" as const)
          : review?.status === "pending" &&
              review.version === 0 &&
              review.route === "ordinary" &&
              !review.flagged &&
              !profile.moderationRequired &&
              (["pending", "running"].includes(screening?.status ?? "") ||
                (screening?.status === "completed" &&
                  screening.recommendation === "no_concern" &&
                  !profile.moderationRequired &&
                  !screening.failureCode))
            ? ("reviewing" as const)
            : ("held" as const);
      const reference = artwork.find((row) => row.agentId === profile.id);
      return [
        profile.id,
        {
          reviewState,
          entryIntent:
            intents.find((row) => row.agentId === profile.id)?.intent ?? null,
          voiceId: voice?.origin === "selected" ? voice.voiceId : null,
          visualActivity:
            reference ??
            (job ? { status: job.status, stage: job.stage } : null),
        },
      ];
    }),
  );
}
