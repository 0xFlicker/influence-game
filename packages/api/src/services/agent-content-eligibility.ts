import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { schema } from "../db/index.js";

/** Legacy profiles without an intake baseline retain their existing eligibility. */
export function eligibleAgentContent() {
  return and(isNull(schema.agentProfiles.archivedAt), or(
    and(eq(schema.agentProfiles.moderationRequired, false), isNull(schema.agentProfiles.latestContentRevisionId)), isNotNull(schema.agentProfiles.contentRevisionId),
  ));
}

export function hasEligibleAgentContent(profile: Pick<typeof schema.agentProfiles.$inferSelect,
  "archivedAt" | "moderationRequired" | "contentRevisionId" | "latestContentRevisionId">) {
  return !profile.archivedAt && (profile.contentRevisionId !== null || (!profile.moderationRequired && !profile.latestContentRevisionId));
}

/** New enrollments need published full-body art. Existing seats and queue entries remain valid. */
export function hasFullBodyAgentArt(profile: Pick<typeof schema.agentProfiles.$inferSelect, "fullBodyReferenceUrl">) {
  return Boolean(profile.fullBodyReferenceUrl?.trim());
}

/** Discovery/profile visibility is separate from eligibility of already accepted entries. */
export function publiclyVisibleAgentContent() {
  return and(eligibleAgentContent(), sql`EXISTS (SELECT 1 FROM users WHERE users.id = ${schema.agentProfiles.userId} AND users.deleted_at IS NULL)`);
}
