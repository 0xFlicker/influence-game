import { resolveWerewolfStrategy } from "@influence/engine/werewolf";
import { ensureActiveAgentRevisionInTransaction, resolveFreeTrackEffectiveRuntimeSnapshot } from "./agent-revisions.js";
import { championshipStandings } from "./championship-results.js";
import { freezeChampionshipExecutionConfig } from "./championship-execution-config.js";
import { readSeasonFinalizationSnapshot } from "./season-finalization-snapshot.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import {
  championshipSchedule, createBalancedRoleSchedule, EMPTY_CHAMPIONSHIP_POLICIES,
  publicRoleLineups, qualifyAgents, unresolvedChampionshipPolicies, parseChampionshipPolicies,
  type ChampionshipPolicies,
} from "@influence/engine/championship";
import { sealGameModelRouting, type GameModelRouting, type GameProviderManifest } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { readChampionshipQualification } from "./season-read-model.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";
import { authorizedModelPreference, creationModelRouting } from "./game-model-routing.js";

type Profile = typeof schema.agentProfiles.$inferSelect;
export type FrozenCompetitionBuild = {
  version: 1; competitionRevisionId: string; agentId: string; ownerId: string;
  sourceRevisionId: string | null; frozenAt: string;
  character: Pick<Profile, "name" | "personality" | "backstory" | "strategyStyle" | "werewolfStrategyStyle" | "personaKey" | "gender" | "contentRevisionId" | "avatarUrl" | "fullBodyReferenceUrl" | "headPosition" | "portraitCrop" | "performanceInstructions" | "visualDesign">;
  modelRouting: GameModelRouting; contestantManifest: GameProviderManifest;
  crossGameMemory: "disabled";
};
export class ChampionshipError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) { super(message); }
}
function nonempty(value: string, label: string): string {
  if (!value.trim()) throw new ChampionshipError(`${label} is required`);
  return value.trim();
}
export async function createChampionshipDraft(db: DrizzleDB, input: { slug: string; name: string; sourceSeasonId: string; actorId: string }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new ChampionshipError("Use a lowercase event slug");
  return db.transaction(async tx => {
    const [season] = await tx.select().from(schema.seasons).where(eq(schema.seasons.id, input.sourceSeasonId));
    if (!season) throw new ChampionshipError("Season not found", 404);
    const [event] = await tx.insert(schema.championshipEvents).values({
      id: randomUUID(), slug: input.slug, name: nonempty(input.name, "Event name"), sourceSeasonId: season.id,
      policies: structuredClone(EMPTY_CHAMPIONSHIP_POLICIES), createdById: input.actorId,
    }).onConflictDoNothing({ target: schema.championshipEvents.slug }).returning();
    if (event) return event;
    const [existing] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.slug, input.slug));
    if (existing?.createdById !== input.actorId || existing.sourceSeasonId !== season.id || existing.name !== input.name.trim()) throw new ChampionshipError("This event slug belongs to another draft", 409);
    return existing;
  });
}
export async function configureChampionshipDraft(db: DrizzleDB, eventId: string, input: { policies: ChampionshipPolicies; startDate: string | null }) {
  parseChampionshipPolicies(input.policies);
  if (input.startDate !== null) championshipSchedule(input.startDate);
  const [event] = await db.update(schema.championshipEvents).set(input)
    .where(and(eq(schema.championshipEvents.id, eventId), eq(schema.championshipEvents.status, "draft"))).returning();
  if (!event) throw new ChampionshipError("Only a draft event may be configured", 409);
  return event;
}
/** Locks snapshots and creates schedule records only. It never creates/starts games or cloud schedules. */
export async function lockChampionshipRoster(db: DrizzleDB, eventId: string, actorId: string, requestId: string) {
  nonempty(requestId, "Request ID");
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (!event) throw new ChampionshipError("Event not found", 404);
    if (event.status !== "draft") {
      const [audit] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.eventId, event.id), eq(schema.competitionAudit.actorId, actorId), eq(schema.competitionAudit.requestId, requestId), eq(schema.competitionAudit.action, "roster_locked")));
      if (audit) return event;
      throw new ChampionshipError("This event roster is already locked", 409);
    }
    const [season] = await tx.select().from(schema.seasons).where(eq(schema.seasons.id, event.sourceSeasonId)).for("update");
    if (season?.status !== "final") throw new ChampionshipError("Finalize the source season before locking its qualifying field", 409);
    const pending = unresolvedChampionshipPolicies(event.policies);
    if (pending.length || !event.startDate) throw new ChampionshipError(`Decisions still needed: ${[...pending, ...(!event.startDate ? ["startDate"] : [])].join(", ")}`, 409);
    const finalization = await readSeasonFinalizationSnapshot(tx, season.id);
    const standings = finalization?.qualification ?? await readChampionshipQualification(tx, season.id);
    const qualified = qualifyAgents(standings);
    const frozenAt = new Date().toISOString();
    const modelRouting = await creationModelRouting(tx, actorId, {});
    // Lock in stable ID order, avoiding profile lock inversions across producer operations.
    for (const candidate of [...qualified].sort((a, b) => a.agentId.localeCompare(b.agentId))) {
      const [profile] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, candidate.agentId)).for("update");
      if (!profile || !hasEligibleAgentContent(profile)) throw new ChampionshipError(`Qualifier ${candidate.name} is unavailable; record an alternate decision rather than silently substituting`, 409);
      // Legacy profiles may predate revision pointers. Establish evidence now, not on day 17.
      const sourceRevisionId = profile.currentRevisionId ?? (await ensureActiveAgentRevisionInTransaction(tx, {
        profile, effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile), trigger: "profile_create",
      })).revision.id;
      const preference = await authorizedModelPreference(tx, profile.userId, profile.modelPreference);
      const id = randomUUID();
      const { name, personality, backstory, strategyStyle, werewolfStrategyStyle, personaKey, gender, contentRevisionId,
        avatarUrl, fullBodyReferenceUrl, headPosition, portraitCrop, performanceInstructions, visualDesign } = profile;
      const sealedRouting = sealGameModelRouting(modelRouting, [{ id, preference }], false);
      const build: FrozenCompetitionBuild = {
        version: 1, competitionRevisionId: id, agentId: profile.id, ownerId: profile.userId,
        sourceRevisionId, frozenAt,
        character: { name, personality, backstory, strategyStyle, werewolfStrategyStyle: resolveWerewolfStrategy(werewolfStrategyStyle, personaKey), personaKey, gender, contentRevisionId,
          avatarUrl, fullBodyReferenceUrl, headPosition, portraitCrop, performanceInstructions, visualDesign },
        modelRouting: sealedRouting, contestantManifest: sealedRouting.contestants![id]!, crossGameMemory: "disabled",
      };
      const stored = await storeJson(build);
      await readJson(stored); // Verify referenced bytes before committing the immutable manifest reference.
      await tx.insert(schema.championshipEntries).values({ id, eventId, agentId: profile.id, ownerId: profile.userId,
        name, qualificationRank: candidate.rank, seasonPoints: candidate.seasonPoints, sourceRevisionId, build: stored });
    }
    const execution = await storeJson(freezeChampionshipExecutionConfig(event.policies.roleComposition!));
    await readJson(execution);
    const qualification = await storeJson(standings);
    const roleSchedule = await storeJson(createBalancedRoleSchedule(qualified.map(row => row.agentId), event.policies.roleComposition!, randomUUID()));
    await Promise.all([readJson(qualification), readJson(roleSchedule)]);
    await tx.insert(schema.championshipMatches).values(championshipSchedule(event.startDate).map(match => ({
      id: randomUUID(), eventId, ordinal: match.ordinal, gameKind: match.kind, scheduledAt: match.scheduledAt,
    })));
    const [locked] = await tx.update(schema.championshipEvents).set({ status: "locked", lockedAt: frozenAt, qualification, roleSchedule, execution })
      .where(eq(schema.championshipEvents.id, eventId)).returning();
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, action: "roster_locked",
      reason: "Final season qualification and immutable competition builds", requestId });
    return locked!;
  });
}
/** A future execution adapter must use this manifest, never project the current agent profile. */
export async function readFrozenCompetitionBuild(db: DrizzleDB, eventId: string, agentId: string): Promise<FrozenCompetitionBuild> {
  const [entry] = await db.select().from(schema.championshipEntries).where(and(eq(schema.championshipEntries.eventId, eventId), eq(schema.championshipEntries.agentId, agentId)));
  if (!entry) throw new ChampionshipError("Frozen competition entry not found", 404);
  const build = await readJson(entry.build);
  if (build.version !== 1 || build.competitionRevisionId !== entry.id || build.agentId !== entry.agentId || build.ownerId !== entry.ownerId || build.crossGameMemory !== "disabled") {
    throw new ChampionshipError("Frozen competition manifest does not match its entry", 409);
  }
  return build;
}
export async function readChampionship(db: DrizzleDB, idOrSlug: string, producer = false) {
  const [event] = await db.select().from(schema.championshipEvents).where(and(
    or(eq(schema.championshipEvents.id, idOrSlug), eq(schema.championshipEvents.slug, idOrSlug)),
    producer ? undefined : eq(schema.championshipEvents.published, true),
  ));
  if (!event) return null;
  const [season] = await db.select({ id: schema.seasons.id, slug: schema.seasons.slug, name: schema.seasons.name, status: schema.seasons.status }).from(schema.seasons).where(eq(schema.seasons.id, event.sourceSeasonId));
  const entries = await db.select({ agentId: schema.championshipEntries.agentId, name: schema.championshipEntries.name,
    rank: schema.championshipEntries.qualificationRank, seasonPoints: schema.championshipEntries.seasonPoints })
    .from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, event.id)).orderBy(asc(schema.championshipEntries.qualificationRank));
  const matches = await db.select({ ordinal: schema.championshipMatches.ordinal, gameKind: schema.championshipMatches.gameKind,
    scheduledAt: schema.championshipMatches.scheduledAt, status: schema.championshipMatches.status, gameSlug: schema.games.slug, ...(producer ? { gameStatus: schema.games.status } : {}) })
    .from(schema.championshipMatches).leftJoin(schema.games, eq(schema.games.id, schema.championshipMatches.gameId))
    .where(eq(schema.championshipMatches.eventId, event.id)).orderBy(asc(schema.championshipMatches.ordinal));
  const standings = await championshipStandings(db, event.id);
  return {
    standings: standings ? { ...standings, series: standings.series.map(({ ownerId: _owner, ...row }) => row) } : null,
    id: event.id, slug: event.slug, name: event.name, status: event.status, season, entries, matches,
    lineups: event.roleSchedule ? publicRoleLineups(await readJson(event.roleSchedule)) : [],
    policies: event.policies, startDate: event.startDate,
    ...(producer ? { unresolvedPolicies: unresolvedChampionshipPolicies(event.policies), published: event.published,
      audit: await db.select().from(schema.competitionAudit).where(eq(schema.competitionAudit.eventId, event.id)).orderBy(asc(schema.competitionAudit.createdAt)),
      executionAvailable: Boolean(event.execution), executionNote: event.execution ? "Explicit activation required; exact-match durable execution" : "Lock the roster to freeze execution configuration" } : {}),
  };
}
export async function publishChampionship(db: DrizzleDB, eventId: string, published: boolean) {
  const [event] = await db.update(schema.championshipEvents).set({ published }).where(eq(schema.championshipEvents.id, eventId)).returning();
  if (!event) throw new ChampionshipError("Event not found", 404);
  return { published: event.published };
}
