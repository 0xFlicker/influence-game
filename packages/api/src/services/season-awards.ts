import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { grantAward, type AwardRecipient } from "./awards.js";
import { readSeasonFinalizationSnapshot } from "./season-finalization-snapshot.js";
import { SeasonStateError } from "./seasons.js";

type Reader = Pick<DrizzleDB, "select">;
type SeasonAward = { definitionCode: string; recipient: AwardRecipient; sourceKey: string; evidence: Record<string, unknown> };

/** Season 0 policy is independent of championship configuration and live profile edits. */
export async function planSeasonAwards(db: Reader, seasonId: string): Promise<SeasonAward[]> {
  const [season] = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId));
  if (!season) throw new SeasonStateError("Season not found", "season_not_found");
  if (season.name.trim().toLowerCase() !== "season 0") return [];
  if (season.status !== "final") throw new SeasonStateError("Finalize Season 0 before delivering its badges", "invalid_state");
  const snapshot = await readSeasonFinalizationSnapshot(db, seasonId);
  const [honor] = await db.select().from(schema.seasonHonors).where(eq(schema.seasonHonors.seasonId, seasonId));
  if (!snapshot || !honor) throw new SeasonStateError("Finalized season lacks frozen award evidence; do not reconstruct it from live standings", "season_not_ready");
  const grants: SeasonAward[] = [];
  const add = (definitionCode: string, type: AwardRecipient["type"], id: string, evidence: Record<string, unknown>) => grants.push({ definitionCode, recipient: { type, id }, sourceKey: `season:${seasonId}`, evidence });
  add("season-0-agent-crown", "agent", honor.agentChampionAgentProfileId, { seasonId, points: honor.agentChampionPoints });
  add("season-0-architect-crown", "account", honor.architectChampionOwnerId, { seasonId, pointsHundredths: honor.architectChampionPointsHundredths });
  add("season-0-agent-champions-architect", "account", honor.agentChampionOwnerId, { seasonId, championAgentId: honor.agentChampionAgentProfileId });
  const completed = new Set(snapshot.completedGameIds), agents = new Map<string, Set<string>>(), accounts = new Map<string, Set<string>>();
  for (const receipt of snapshot.receipts) {
    if (!completed.has(receipt.gameId)) continue;
    for (const [map, id] of [[agents, receipt.agentProfileId], [accounts, receipt.ownerId]] as const) {
      const games = map.get(id) ?? new Set<string>(); games.add(receipt.gameId); map.set(id, games);
    }
  }
  for (const [id, games] of agents) add("season-0-agent-participant", "agent", id, { seasonId, completedGames: games.size, minimum: 1 });
  for (const [id, games] of accounts) add("season-0-account-participant", "account", id, { seasonId, completedGames: games.size, minimum: 1 });
  return grants;
}

export async function previewSeasonAwards(db: Reader, seasonId: string) {
  const plan = await planSeasonAwards(db, seasonId);
  const existing = await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.sourceSeasonId, seasonId));
  return Promise.all(plan.map(async grant => {
    const prior = existing.find(row => row.definitionCode === grant.definitionCode && row.sourceKey === grant.sourceKey && row.recipientKey === `${grant.recipient.type}:${grant.recipient.id}`);
    const [recipient] = grant.recipient.type === "agent"
      ? await db.select({ name: schema.agentProfiles.name }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, grant.recipient.id))
      : await db.select({ name: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, grant.recipient.id));
    return { ...grant, recipientName: recipient?.name ?? grant.recipient.id, action: prior ? "preserve" as const : "grant" as const,
      existingGrantId: prior?.id ?? null, revoked: Boolean(prior?.revokedAt), replacedById: prior?.replacedById ?? null };
  }));
}

/** One atomic, retryable batch. Existing grants (including revocations/replacements) are never rewritten. */
export async function reconcileSeasonAwards(db: DrizzleDB, seasonId: string, actorId: string) {
  return db.transaction(async tx => {
    await tx.select({ id: schema.seasons.id }).from(schema.seasons).where(eq(schema.seasons.id, seasonId)).for("update");
    const plan = await planSeasonAwards(tx, seasonId);
    let created = 0, preserved = 0;
    for (const grant of plan) {
      const [prior] = await tx.select({ id: schema.awardGrants.id }).from(schema.awardGrants).where(and(
        eq(schema.awardGrants.definitionCode, grant.definitionCode), eq(schema.awardGrants.sourceKey, grant.sourceKey),
        eq(schema.awardGrants.recipientKey, `${grant.recipient.type}:${grant.recipient.id}`)));
      if (prior) { preserved++; continue; }
      const result = await grantAward(tx, { ...grant, sourceSeasonId: seasonId, actorId, reason: "Season 0 finalization: frozen crowns and participation after one completed game",
        requestId: `season-award:${seasonId}:${grant.definitionCode}:${grant.recipient.type}:${grant.recipient.id}` });
      if (result.created) created++; else preserved++;
    }
    return { planned: plan.length, created, preserved };
  });
}
