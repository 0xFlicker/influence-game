import { and, eq } from "drizzle-orm";
import { summarizeWerewolfParticipation, type ParticipationFilter } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { publiclyVisibleAgentContent } from "./agent-content-eligibility.js";
import { getPublicReplayAgentPreviewsByProfileIds, publicAgentFullBodyHref } from "./public-agent-preview.js";
import { isImportedSyntheticPlayer } from "./public-player-identity.js";
import { publicAgentAwards } from "./awards.js";
import { readHouseParticipation } from "./house-participation.js";

/** One lightweight visibility check for the public page, cards and short links. */
export async function readPublicAgentIdentity(db: DrizzleDB, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const [row] = await db.select({
    ownerId: schema.agentProfiles.userId,
    name: schema.agentProfiles.name,
    avatarUrl: schema.agentProfiles.avatarUrl,
    fullBodyReferenceUrl: schema.agentProfiles.fullBodyReferenceUrl,
    wallet: schema.users.walletAddress,
  }).from(schema.agentProfiles)
    .innerJoin(schema.users, eq(schema.agentProfiles.userId, schema.users.id))
    .where(and(eq(schema.agentProfiles.id, id), publiclyVisibleAgentContent()));
  if (!row || isImportedSyntheticPlayer(row.wallet)) return null;
  return { ownerId: row.ownerId, name: row.name, avatarUrl: row.avatarUrl, fullBodyReferenceUrl: row.fullBodyReferenceUrl };
}

/** Explicit public projection. Never serialize profile/revision rows or owner account details. */
export async function getPublicAgentProfile(db: DrizzleDB, id: string, gameKind: ParticipationFilter = "all") {
  const missing = { schemaVersion: 1 as const, status: "not_found" as const };
  const identity = await readPublicAgentIdentity(db, id);
  if (!identity) return missing;
  const preview = (await getPublicReplayAgentPreviewsByProfileIds(db, [id])).get(id);
  if (!preview?.profileHref) return missing;
  const history = { agentProfileId: id, publicOnly: true, limit: 20 };
  const recentResultsRead = readHouseParticipation(db, identity.ownerId, { ...history, gameKind });
  const [awards, recentResults, werewolfHistory] = await Promise.all([
    publicAgentAwards(db, id),
    recentResultsRead,
    gameKind === "werewolf" ? recentResultsRead : readHouseParticipation(db, identity.ownerId, { ...history, gameKind: "werewolf" }),
  ]);
  return { schemaVersion: 1 as const, status: "found" as const, profile: {
    name: preview.name, avatarUrl: preview.avatarUrl, role: preview.role, profileHref: preview.profileHref,
    fullBodyImageUrl: publicAgentFullBodyHref(id, identity.fullBodyReferenceUrl),
    owner: preview.owner ?? null, competition: preview.competition, werewolfRecord: summarizeWerewolfParticipation(werewolfHistory), awards, recentResults,
  } };
}
