import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { schema } from "../db/index.js";

/** Legacy profiles without an intake baseline retain their existing eligibility. */
export function eligibleAgentContent() {
  return and(isNull(schema.agentProfiles.archivedAt), or(
    eq(schema.agentProfiles.moderationRequired, false), isNotNull(schema.agentProfiles.contentRevisionId),
  ));
}

export function hasEligibleAgentContent(profile: Pick<typeof schema.agentProfiles.$inferSelect,
  "archivedAt" | "moderationRequired" | "contentRevisionId">) {
  return !profile.archivedAt && (!profile.moderationRequired || profile.contentRevisionId !== null);
}

/** New enrollments need published full-body art. Existing seats and queue entries remain valid. */
export function hasFullBodyAgentArt(profile: Pick<typeof schema.agentProfiles.$inferSelect, "fullBodyReferenceUrl">) {
  return Boolean(profile.fullBodyReferenceUrl?.trim());
}
