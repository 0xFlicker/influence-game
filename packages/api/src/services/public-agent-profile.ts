import { and, eq } from "drizzle-orm";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { publiclyVisibleAgentContent } from "./agent-content-eligibility.js";
import { getPublicReplayAgentPreviewsByProfileIds } from "./public-agent-preview.js";
import { publicAgentAwards } from "./awards.js";
import { readHouseParticipation } from "./house-participation.js";

/** Explicit public projection. Never serialize profile/revision rows or owner account details. */
export async function getPublicAgentProfile(db: DrizzleDB, id: string, gameKind: ParticipationFilter = "all") {
  const missing = { schemaVersion: 1 as const, status: "not_found" as const };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return missing;
  const [identity] = await db.select({
    ownerId: schema.agentProfiles.userId,
    fullBodyReferenceUrl: schema.agentProfiles.fullBodyReferenceUrl,
  }).from(schema.agentProfiles)
    .where(and(eq(schema.agentProfiles.id, id), publiclyVisibleAgentContent()));
  if (!identity) return missing;
  const preview = (await getPublicReplayAgentPreviewsByProfileIds(db, [id])).get(id);
  if (!preview) return missing;
  const history = { agentProfileId: id, publicOnly: true, limit: 20 };
  const recentResultsRead = readHouseParticipation(db, identity.ownerId, { ...history, gameKind });
  const [awards, recentResults, werewolfHistory] = await Promise.all([
    publicAgentAwards(db, id),
    recentResultsRead,
    gameKind === "werewolf" ? recentResultsRead : readHouseParticipation(db, identity.ownerId, { ...history, gameKind: "werewolf" }),
  ]);
  const werewolfRecord = { wins: 0, losses: 0, draws: 0 };
  for (const entry of werewolfHistory) {
    if (entry.gameKind !== "werewolf" || !entry.result) continue;
    switch (entry.result.outcome) {
      case "win": werewolfRecord.wins++; break;
      case "loss": werewolfRecord.losses++; break;
      case "draw": werewolfRecord.draws++; break;
    }
  }
  return { schemaVersion: 1 as const, status: "found" as const, profile: {
    name: preview.name, avatarUrl: preview.avatarUrl, role: preview.role, profileHref: preview.profileHref!,
    fullBodyImageUrl: identity.fullBodyReferenceUrl?.trim() ? `/api/public/agents/${encodeURIComponent(id)}/art?kind=full-body` : null,
    owner: preview.owner ?? null, competition: preview.competition, werewolfRecord, awards, recentResults,
  } };
}
