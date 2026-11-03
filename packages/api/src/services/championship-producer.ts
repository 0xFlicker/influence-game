import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { prepareChampionshipAwards } from "./championship-awards.js";
import { ChampionshipError } from "./championships.js";
import { readJson } from "./payload-storage.js";

export async function listProducerChampionships(db: DrizzleDB) {
  return db.select({ id: schema.championshipEvents.id, slug: schema.championshipEvents.slug, name: schema.championshipEvents.name,
    status: schema.championshipEvents.status, published: schema.championshipEvents.published, sourceSeasonId: schema.championshipEvents.sourceSeasonId })
    .from(schema.championshipEvents).orderBy(desc(schema.championshipEvents.createdAt), asc(schema.championshipEvents.id)).limit(100);
}
export async function previewChampionshipAwards(db: DrizzleDB, eventId: string) {
  const [event] = await db.select({ id: schema.championshipEvents.id }).from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId));
  if (!event) throw new ChampionshipError("Event not found", 404);
  const phases = await prepareChampionshipAwards(db, eventId, { preview: true });
  const grants = phases.flatMap(phase => phase.grants);
  const agentIds = [...new Set(grants.filter(grant => grant.recipient.type === "agent").map(grant => grant.recipient.id))];
  const accountIds = [...new Set(grants.filter(grant => grant.recipient.type === "account").map(grant => grant.recipient.id))];
  const [agents, accounts] = await Promise.all([
    agentIds.length ? db.select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name }).from(schema.agentProfiles).where(inArray(schema.agentProfiles.id, agentIds)) : [],
    accountIds.length ? db.select({ id: schema.users.id, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, accountIds)) : [],
  ]);
  return phases.map(phase => ({ ...phase, grants: phase.grants.map(grant => ({ ...grant,
    recipientName: (grant.recipient.type === "agent" ? agents : accounts).find(row => row.id === grant.recipient.id)?.name ?? grant.recipient.id,
  })) }));
}
export async function listEventAwards(db: DrizzleDB, eventId: string, after?: string) {
  const [event] = await db.select({ sourceSeasonId: schema.championshipEvents.sourceSeasonId }).from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId));
  if (!event) throw new ChampionshipError("Event not found", 404);
  const rows = await db.select({ id: schema.awardGrants.id, title: schema.awardDefinitions.title, recipientType: schema.awardDefinitions.recipientType,
    sourceEventId: schema.awardGrants.sourceEventId, recipientName: sql<string>`coalesce(${schema.agentProfiles.name}, ${schema.users.displayName}, ${schema.awardGrants.recipientKey})`,
    replacedById: schema.awardGrants.replacedById, revokedAt: schema.awardGrants.revokedAt, grantedAt: schema.awardGrants.grantedAt })
    .from(schema.awardGrants).innerJoin(schema.awardDefinitions, eq(schema.awardDefinitions.code, schema.awardGrants.definitionCode))
    .leftJoin(schema.agentProfiles, eq(schema.agentProfiles.id, schema.awardGrants.agentId)).leftJoin(schema.users, eq(schema.users.id, schema.awardGrants.accountId))
    .where(and(or(eq(schema.awardGrants.sourceEventId, eventId), and(isNull(schema.awardGrants.sourceEventId), eq(schema.awardGrants.sourceSeasonId, event.sourceSeasonId))), after ? gt(schema.awardGrants.id, after) : undefined)).orderBy(asc(schema.awardGrants.id)).limit(51);
  return { grants: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
}
export async function readAwardHistory(db: DrizzleDB, grantId: string) {
  const [grant] = await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, grantId));
  if (!grant) throw new ChampionshipError("Award not found", 404);
  return { grant: { ...grant, evidence: await readJson(grant.evidence) },
    replaces: await db.select({ id: schema.awardGrants.id, recipientKey: schema.awardGrants.recipientKey }).from(schema.awardGrants).where(eq(schema.awardGrants.replacedById, grant.id)),
    audit: await db.select().from(schema.competitionAudit).where(eq(schema.competitionAudit.grantId, grantId)).orderBy(asc(schema.competitionAudit.createdAt)) };
}
