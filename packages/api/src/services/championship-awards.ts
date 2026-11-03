import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { grantAward, type AwardRecipient } from "./awards.js";
import { readSeasonFinalizationSnapshot } from "./season-finalization-snapshot.js";
import { championshipStandings } from "./championship-results.js";
export interface PlannedAward { definitionCode: string; recipient: AwardRecipient; sourceKey: string; evidence: Record<string, unknown> }

/** Freeze attribution once in an outbox; delivery retries never recalculate recipients. */
export async function prepareChampionshipAwards(db: DrizzleDB, eventId: string, options: { preview?: boolean } = {}) {
  return db.transaction(async tx => {
    const query = tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId));
    const [event] = options.preview ? await query : await query.for("update");
    const planned: Array<{ phase: string; grants: PlannedAward[]; frozen: boolean; deliveredAt: string | null }> = [];
    if (!event || !["running", "paused", "final", ...(options.preview ? ["locked"] : [])].includes(event.status)) return planned;
    const existing = await tx.select().from(schema.championshipAwardAllocations).where(and(eq(schema.championshipAwardAllocations.eventId, eventId), isNull(schema.championshipAwardAllocations.supersededAt)));
    if (options.preview) for (const row of existing) planned.push({ phase: row.phase, grants: await readJson(row.grants), frozen: true, deliveredAt: row.deliveredAt });
    const entries = await tx.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, eventId));
    const owner = async (agentId: string, qualificationOwner: string) => {
      if (event.policies.ownerAttribution === "qualification") return qualificationOwner;
      if (event.policies.ownerAttribution !== "award") return null;
      const [profile] = await tx.select({ userId: schema.agentProfiles.userId }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agentId));
      return profile?.userId ?? null;
    };
    const save = async (phase: string, grants: PlannedAward[], generation = 0) => {
      planned.push({ phase, grants, frozen: false, deliveredAt: null });
      if (options.preview) return;
      const payload = await storeJson(grants); await readJson(payload);
      await tx.insert(schema.championshipAwardAllocations).values({ id: randomUUID(), eventId, phase, generation, grants: payload });
    };
    if (!existing.some(row => row.phase === "field")) await save("field", entries.map(entry => ({ definitionCode: "season-0-top-eight",
      recipient: { type: "agent", id: entry.agentId }, sourceKey: `event:${eventId}:field`, evidence: { eventId, qualificationRank: entry.qualificationRank, seasonPoints: entry.seasonPoints } })));
    if (!existing.some(row => row.phase === "season") && event.policies.participationMinimumCompletedGames !== null && event.policies.ownerAttribution !== null) {
      const snapshot = await readSeasonFinalizationSnapshot(tx, event.sourceSeasonId);
      const [honor] = await tx.select().from(schema.seasonHonors).where(eq(schema.seasonHonors.seasonId, event.sourceSeasonId));
      if (snapshot && honor) {
        const grants: PlannedAward[] = [];
        const add = (definitionCode: string, type: AwardRecipient["type"], id: string, evidence: Record<string, unknown>) => grants.push({ definitionCode, recipient: { type, id }, sourceKey: `season:${event.sourceSeasonId}`, evidence });
        const crownOwner = await owner(honor.agentChampionAgentProfileId, honor.agentChampionOwnerId);
        add("season-0-agent-crown", "agent", honor.agentChampionAgentProfileId, { seasonId: event.sourceSeasonId, points: honor.agentChampionPoints });
        add("season-0-architect-crown", "account", honor.architectChampionOwnerId, { seasonId: event.sourceSeasonId, pointsHundredths: honor.architectChampionPointsHundredths });
        if (crownOwner) add("season-0-agent-champions-architect", "account", crownOwner, { seasonId: event.sourceSeasonId, championAgentId: honor.agentChampionAgentProfileId });
        const agentGames = new Map<string, Set<string>>(), accountGames = new Map<string, Set<string>>();
        for (const receipt of snapshot.receipts) {
          if (!snapshot.completedGameIds.includes(receipt.gameId)) continue;
          const games = agentGames.get(receipt.agentProfileId) ?? new Set<string>(); games.add(receipt.gameId); agentGames.set(receipt.agentProfileId, games);
          const attributed = await owner(receipt.agentProfileId, receipt.ownerId);
          if (attributed) { const games = accountGames.get(attributed) ?? new Set<string>(); games.add(receipt.gameId); accountGames.set(attributed, games); }
        }
        for (const [id, games] of agentGames) if (games.size >= event.policies.participationMinimumCompletedGames) add("season-0-agent-participant", "agent", id, { seasonId: event.sourceSeasonId, completedGames: games.size, minimum: event.policies.participationMinimumCompletedGames });
        for (const [id, games] of accountGames) if (games.size >= event.policies.participationMinimumCompletedGames) add("season-0-account-participant", "account", id, { seasonId: event.sourceSeasonId, completedGames: games.size, minimum: event.policies.participationMinimumCompletedGames });
        await save("season", grants);
      }
    }
    const standings = await championshipStandings(tx, eventId);
    for (const kind of ["werewolf", "influence"] as const) {
      if (!standings || existing.some(row => row.phase === kind) || event.policies.ownerAttribution === null) continue;
      const winners = kind === "werewolf" ? standings.werewolfWinners : standings.influenceWinners;
      if (!winners.length || (kind === "werewolf" && winners.length > 1 && event.policies.equalScoreFallback === null)) continue;
      const revisions = await tx.select({ revision: schema.championshipMatches.resultRevision }).from(schema.championshipMatches)
        .where(and(eq(schema.championshipMatches.eventId, eventId), eq(schema.championshipMatches.gameKind, kind)));
      const generation = revisions.reduce((sum, row) => sum + row.revision, 0);
      const source = `event:${eventId}:${kind}${generation ? `:revision:${generation}` : ""}`;
      const grants: PlannedAward[] = [];
      for (const agentId of winners) {
        const entry = entries.find(entry => entry.agentId === agentId)!;
        const evidence = { eventId, championAgentId: agentId, kind, seasonPoints: entry.seasonPoints };
        grants.push({ definitionCode: `season-0-${kind}-champion`, recipient: { type: "agent", id: agentId }, sourceKey: source, evidence });
        const attributed = await owner(agentId, entry.ownerId);
        if (attributed) grants.push({ definitionCode: `season-0-${kind}-champions-architect`, recipient: { type: "account", id: attributed }, sourceKey: `${source}:${agentId}`, evidence });
      }
      await save(kind, grants, generation);
    }
    return planned;
  });
}

export async function deliverChampionshipAwards(db: DrizzleDB, eventId: string) {
  const allocations = await db.select({ id: schema.championshipAwardAllocations.id }).from(schema.championshipAwardAllocations)
    .where(and(eq(schema.championshipAwardAllocations.eventId, eventId), isNull(schema.championshipAwardAllocations.deliveredAt), isNull(schema.championshipAwardAllocations.supersededAt)));
  for (const identity of allocations) await db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    const [allocation] = await tx.select().from(schema.championshipAwardAllocations).where(eq(schema.championshipAwardAllocations.id, identity.id));
    if (!event || !allocation || allocation.deliveredAt || allocation.supersededAt) return;
    const grants = await readJson(allocation.grants);
    for (const [index, grant] of grants.entries()) await grantAward(tx, { ...grant, actorId: event.createdById, sourceSeasonId: event.sourceSeasonId,
      allocationId: allocation.id, ...(allocation.phase !== "season" ? { sourceEventId: eventId } : {}),
      reason: `Automatic ${allocation.phase} allocation`, requestId: `${allocation.id}:${index}` });
    await tx.update(schema.championshipAwardAllocations).set({ deliveredAt: new Date().toISOString() }).where(eq(schema.championshipAwardAllocations.id, allocation.id));
  });
}
