import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { ChampionshipError } from "./championships.js";
import { readJson } from "./payload-storage.js";

/** Keep canonical history and prior scoring revisions; only the current derived revision changes. */
export async function correctChampionshipResult(db: DrizzleDB, input: {
  eventId: string; ordinal: number; expectedGameId: string; expectedRevision: number;
  mode: "resettle" | "replay"; reason: string; actorId: string; requestId: string;
}) {
  if (!input.reason.trim() || !input.requestId.trim() || !input.expectedGameId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !["resettle", "replay"].includes(input.mode)) throw new ChampionshipError("Correction requires an exact game/revision, mode, reason and request ID");
  const action = `result_corrected:${input.ordinal}:${input.expectedGameId}:${input.expectedRevision}:${input.mode}`;
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, input.eventId)).for("update");
    if (!event) throw new ChampionshipError("Event not found", 404);
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, input.actorId), eq(schema.competitionAudit.requestId, input.requestId)));
    if (prior) {
      if (prior.eventId !== event.id || prior.action !== action || prior.reason !== input.reason.trim()) throw new ChampionshipError("Idempotency key belongs to another correction", 409);
      return { accepted: true, revision: input.expectedRevision + 1, replayedRequest: true };
    }
    if (!["running", "paused", "final"].includes(event.status)) throw new ChampionshipError("Only an activated championship can have result corrections", 409);
    const [match] = await tx.select().from(schema.championshipMatches).where(and(eq(schema.championshipMatches.eventId, event.id), eq(schema.championshipMatches.ordinal, input.ordinal))).for("update");
    if (!match || match.gameId !== input.expectedGameId || match.resultRevision !== input.expectedRevision) throw new ChampionshipError("Match attempt or scoring revision changed; refresh before correcting", 409);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, input.expectedGameId)).for("update");
    if (game?.status !== "completed") throw new ChampionshipError("This correction is for completed games; recover interrupted games or replay cancelled attempts separately", 409);
    // Link the historical attempt before moving the active match binding, including legacy games.
    await tx.insert(schema.championshipMatchAttempts).values({ gameId: game.id, matchId: match.id, seatPrefix: match.id }).onConflictDoNothing();
    const allocations = await tx.select().from(schema.championshipAwardAllocations).where(and(eq(schema.championshipAwardAllocations.eventId, event.id), eq(schema.championshipAwardAllocations.phase, match.gameKind), isNull(schema.championshipAwardAllocations.supersededAt)));
    const now = new Date().toISOString();
    for (const allocation of allocations) {
      // Associate legacy matching grants as well as new deliveries, retaining recipient-correction descendants.
      for (const planned of await readJson(allocation.grants)) await tx.update(schema.awardGrants).set({ allocationId: allocation.id })
        .where(and(eq(schema.awardGrants.definitionCode, planned.definitionCode), eq(schema.awardGrants.sourceKey, planned.sourceKey), eq(schema.awardGrants.recipientKey, `${planned.recipient.type}:${planned.recipient.id}`), isNull(schema.awardGrants.allocationId)));
      // A legacy manually delivered grant may have been corrected before it gained an allocation link.
      await tx.execute(sql`WITH RECURSIVE lineage(id) AS (
        SELECT id FROM award_grants WHERE allocation_id = ${allocation.id}
        UNION SELECT child.id FROM award_grants parent JOIN lineage ON lineage.id = parent.id
          JOIN award_grants child ON child.id = parent.replaced_by_id
      ) UPDATE award_grants SET allocation_id = ${allocation.id}
        WHERE id IN (SELECT id FROM lineage) AND allocation_id IS NULL`);
      const grants = await tx.select().from(schema.awardGrants).where(eq(schema.awardGrants.allocationId, allocation.id)).for("update");
      for (const grant of grants) {
        if (!grant.revokedAt) await tx.update(schema.awardGrants).set({ revokedAt: now }).where(eq(schema.awardGrants.id, grant.id));
        await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: event.id, grantId: grant.id, actorId: input.actorId,
          requestId: `result-correction:${allocation.id}:${grant.id}`, action: "award_allocation_superseded", reason: input.reason.trim() });
      }
      await tx.update(schema.championshipAwardAllocations).set({ supersededAt: now }).where(eq(schema.championshipAwardAllocations.id, allocation.id));
    }
    await tx.update(schema.championshipMatches).set({ resultRevision: match.resultRevision + 1, status: input.mode === "replay" ? "scheduled" : "settling",
      ...(input.mode === "replay" ? { gameId: null } : {}) }).where(eq(schema.championshipMatches.id, match.id));
    // Reopen a final event for the explicitly requested correction only. Preserve an existing producer pause.
    if (event.status === "final") await tx.update(schema.championshipEvents).set({ status: "running" }).where(eq(schema.championshipEvents.id, event.id));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: event.id, actorId: input.actorId, requestId: input.requestId, action, reason: input.reason.trim() });
    return { accepted: true, revision: match.resultRevision + 1, replayedRequest: false };
  });
}
