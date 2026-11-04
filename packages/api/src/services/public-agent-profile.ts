import { and, eq } from "drizzle-orm";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { eligibleAgentContent } from "./agent-content-eligibility.js";
import { getPublicReplayAgentPreviewsByProfileIds } from "./public-agent-preview.js";
import { publicAgentAwards } from "./awards.js";
import { readHouseParticipation } from "./house-participation.js";

/** Explicit public projection. Never serialize profile/revision rows or owner account details. */
export async function getPublicAgentProfile(db: DrizzleDB, id: string, gameKind: ParticipationFilter = "all") {
  const missing = { schemaVersion: 1 as const, status: "not_found" as const };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return missing;
  const [identity] = await db.select({ ownerId: schema.agentProfiles.userId }).from(schema.agentProfiles)
    .where(and(eq(schema.agentProfiles.id, id), eligibleAgentContent()));
  if (!identity) return missing;
  const preview = (await getPublicReplayAgentPreviewsByProfileIds(db, [id])).get(id);
  if (!preview) return missing;
  const [awards, recentResults] = await Promise.all([
    publicAgentAwards(db, id),
    readHouseParticipation(db, identity.ownerId, { agentProfileId: id, publicOnly: true, gameKind, limit: 20 }),
  ]);
  return { schemaVersion: 1 as const, status: "found" as const, profile: {
    name: preview.name, avatarUrl: preview.avatarUrl, role: preview.role, profileHref: preview.profileHref!,
    owner: preview.owner ?? null, competition: preview.competition, awards, recentResults,
  } };
}
