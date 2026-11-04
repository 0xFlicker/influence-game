import { savedCharacterArtHash } from "./character-art-save.js";
import { championshipStandings } from "./championship-results.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  championshipSchedule, SEASON_ZERO_CHAMPIONSHIP_POLICIES,
  publicRoleLineups, unresolvedChampionshipPolicies, parseChampionshipPolicies,
  type ChampionshipPolicies,
} from "@influence/engine/championship";
import { type GameModelRouting, type GameProviderManifest } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";

type Profile = typeof schema.agentProfiles.$inferSelect;
export type FrozenCompetitionBuild = {
  version: 1; competitionRevisionId: string; agentId: string; ownerId: string;
  sourceRevisionId: string | null; frozenAt: string;
  character: Pick<Profile, "name" | "personality" | "backstory" | "strategyStyle" | "werewolfStrategyStyle" | "personaKey" | "gender" | "contentRevisionId" | "avatarUrl" | "fullBodyReferenceUrl" | "headPosition" | "portraitCrop" | "performanceInstructions" | "visualDesign">;
  modelRouting: GameModelRouting; contestantManifest: GameProviderManifest;
  crossGameMemory: "disabled";
  artwork?: { revisionId: string; avatarHash: string; bodyHash: string };
};
export class ChampionshipError extends Error {
  constructor(message: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 503 = 400) { super(message); }
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
      policies: structuredClone(SEASON_ZERO_CHAMPIONSHIP_POLICIES), createdById: input.actorId,
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
  const { requestChampionshipRosterLock } = await import("./championship-artwork.js");
  return requestChampionshipRosterLock(db, eventId, actorId, requestId);
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
  const frozenEntries = await db.select({ build: schema.championshipEntries.build, agentId: schema.championshipEntries.agentId, name: schema.championshipEntries.name,
    rank: schema.championshipEntries.qualificationRank, seasonPoints: schema.championshipEntries.seasonPoints })
    .from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, event.id)).orderBy(asc(schema.championshipEntries.qualificationRank));
  // Resolve only public visual fields from the competition build, never the mutable profile.
  const builds = await Promise.all(frozenEntries.map(entry => readJson(entry.build)));
  const hashFor = (build: FrozenCompetitionBuild) => build.artwork?.bodyHash ?? savedCharacterArtHash(build.character.fullBodyReferenceUrl);
  const bodyHashes = builds.flatMap(build => { const hash = hashFor(build); return hash ? [hash] : []; });
  const assets = bodyHashes.length ? await db.select({ hash: schema.agentContentAssets.hash, transparentUrl: schema.agentContentAssets.transparentUrl })
    .from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash, bodyHashes)) : [];
  const entries = frozenEntries.map(({ build: _build, ...entry }, index) => ({ ...entry,
    avatarUrl: builds[index]!.character.avatarUrl,
    bodyUrl: builds[index]!.character.fullBodyReferenceUrl,
    transparentBodyUrl: assets.find(asset => asset.hash === hashFor(builds[index]!))?.transparentUrl ?? null,
  }));
  const matches = await db.select({ ordinal: schema.championshipMatches.ordinal, gameKind: schema.championshipMatches.gameKind,
    scheduledAt: schema.championshipMatches.scheduledAt, status: schema.championshipMatches.status, gameSlug: schema.games.slug, ...(producer ? { gameStatus: schema.games.status, gameId: schema.games.id, resultRevision: schema.championshipMatches.resultRevision } : {}) })
    .from(schema.championshipMatches).leftJoin(schema.games, eq(schema.games.id, schema.championshipMatches.gameId))
    .where(eq(schema.championshipMatches.eventId, event.id)).orderBy(asc(schema.championshipMatches.ordinal));
  const standings = await championshipStandings(db, event.id);
  return {
    standings: standings ? { ...standings, series: standings.series.map(({ ownerId: _owner, ...row }) => row) } : null,
    id: event.id, slug: event.slug, name: event.name, status: event.status, season, entries, matches,
    lineups: event.roleSchedule ? publicRoleLineups(await readJson(event.roleSchedule)) : [],
    policies: event.policies, startDate: event.startDate,
    ...(producer ? { resultHistory: await db.select({ ordinal: schema.championshipMatches.ordinal, revision: schema.championshipResults.revision,
      gameId: schema.championshipResults.gameId, entryId: schema.championshipResults.entryId, outcome: schema.championshipResults.outcome, points: schema.championshipResults.points,
      policyVersion: schema.championshipResults.policyVersion, canonicalSequence: schema.championshipResults.canonicalSequence })
      .from(schema.championshipResults).innerJoin(schema.championshipMatches, eq(schema.championshipResults.matchId, schema.championshipMatches.id))
      .where(eq(schema.championshipMatches.eventId, event.id)).orderBy(asc(schema.championshipMatches.ordinal), asc(schema.championshipResults.revision)),
      unresolvedPolicies: unresolvedChampionshipPolicies(event.policies), published: event.published,
      audit: await db.select().from(schema.competitionAudit).where(eq(schema.competitionAudit.eventId, event.id)).orderBy(asc(schema.competitionAudit.createdAt)),
      artwork: await db.select({ id: schema.championshipArtwork.id, agentId: schema.championshipArtwork.agentId, rank: schema.championshipArtwork.qualificationRank,
        selected: schema.championshipArtwork.selected, status: schema.championshipArtwork.status, error: schema.championshipArtwork.lastError,
        avatarUrl: schema.championshipArtwork.avatarUrl, bodyUrl: schema.championshipArtwork.bodyUrl }).from(schema.championshipArtwork).where(eq(schema.championshipArtwork.eventId, event.id)).orderBy(asc(schema.championshipArtwork.qualificationRank)),
      executionAvailable: Boolean(event.execution), executionNote: event.execution ? "Explicit activation required; exact-match durable execution" : "Lock the roster to freeze execution configuration" } : {}),
  };
}
export async function publishChampionship(db: DrizzleDB, eventId: string, published: boolean) {
  const [event] = await db.update(schema.championshipEvents).set({ published }).where(eq(schema.championshipEvents.id, eventId)).returning();
  if (!event) throw new ChampionshipError("Event not found", 404);
  return { published: event.published };
}
