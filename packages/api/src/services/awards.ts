import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { SEASON_ZERO_AWARDS } from "@influence/engine/championship";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { ChampionshipError } from "./championships.js";

export type AwardRecipient = { type: "agent" | "account"; id: string };
export async function grantAward(db: DrizzleDB, input: {
  definitionCode: string; recipient: AwardRecipient; sourceKey: string;
  sourceSeasonId?: string; sourceEventId?: string; evidence: Record<string, unknown>;
  actorId: string; reason: string; requestId: string;
}) {
  const builtin = SEASON_ZERO_AWARDS.find(item => item.code === input.definitionCode);
  if (![input.reason, input.requestId, input.sourceKey, input.recipient.id].every(value => value.trim())) throw new ChampionshipError("Award requires recipient, reason, source and request ID");
  const evidence = await storeJson(input.evidence);
  await readJson(evidence);
  return db.transaction(async tx => {
    // The recipient row lock serializes retries, even before the first grant exists.
    if (input.recipient.type === "agent") {
      const [agent] = await tx.select({ id: schema.agentProfiles.id }).from(schema.agentProfiles).where(eq(schema.agentProfiles.id, input.recipient.id)).for("update");
      if (!agent) throw new ChampionshipError("Agent not found", 404);
    } else {
      const [account] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.recipient.id)).for("update");
      if (!account) throw new ChampionshipError("Account not found", 404);
    }
    if (builtin) await tx.insert(schema.awardDefinitions).values({ code: builtin.code, title: builtin.title, recipientType: builtin.recipient }).onConflictDoNothing();
    const [definition] = await tx.select().from(schema.awardDefinitions).where(eq(schema.awardDefinitions.code, input.definitionCode));
    if (!definition || definition.recipientType !== input.recipient.type) throw new ChampionshipError("Award recipient does not match its definition");
    const recipientKey = `${input.recipient.type}:${input.recipient.id}`;
    const [existing] = await tx.select().from(schema.awardGrants).where(and(eq(schema.awardGrants.definitionCode, definition.code),
      eq(schema.awardGrants.recipientKey, recipientKey), eq(schema.awardGrants.sourceKey, input.sourceKey)));
    if (existing) {
      if (existing.evidence.sha256 !== evidence.sha256 || existing.sourceSeasonId !== (input.sourceSeasonId ?? null) || existing.sourceEventId !== (input.sourceEventId ?? null)) throw new ChampionshipError("This achievement already has different evidence; use an audited correction", 409);
      return { id: existing.id, revoked: existing.revokedAt !== null, created: false };
    }
    const id = randomUUID();
    await tx.insert(schema.awardGrants).values({ id, definitionCode: definition.code, recipientKey, sourceKey: input.sourceKey,
      agentId: input.recipient.type === "agent" ? input.recipient.id : null,
      accountId: input.recipient.type === "account" ? input.recipient.id : null,
      sourceSeasonId: input.sourceSeasonId, sourceEventId: input.sourceEventId, evidence,
      grantedById: input.actorId, reason: input.reason });
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), grantId: id, actorId: input.actorId,
      action: "award_granted", reason: input.reason, requestId: input.requestId });
    return { id, revoked: false, created: true };
  });
}
export async function revokeAward(db: DrizzleDB, input: { grantId: string; actorId: string; reason: string; requestId: string }) {
  return changeAwardVisibility(db, input, true);
}
export async function reinstateAward(db: DrizzleDB, input: { grantId: string; actorId: string; reason: string; requestId: string }) {
  return changeAwardVisibility(db, input, false);
}
async function changeAwardVisibility(db: DrizzleDB, input: { grantId: string; actorId: string; reason: string; requestId: string }, revoked: boolean) {
  if (!input.reason.trim() || !input.requestId.trim()) throw new ChampionshipError("Award correction requires a reason and request ID");
  const action = revoked ? "award_revoked" : "award_reinstated";
  return db.transaction(async tx => {
    const [grant] = await tx.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, input.grantId)).for("update");
    if (!grant) throw new ChampionshipError("Award not found", 404);
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, input.actorId), eq(schema.competitionAudit.requestId, input.requestId)));
    if (prior) {
      if (prior.grantId !== grant.id || prior.action !== action || prior.reason !== input.reason.trim()) throw new ChampionshipError("Idempotency key already belongs to another correction", 409);
      return { id: grant.id, revoked: grant.revokedAt !== null };
    }
    if ((grant.revokedAt !== null) !== revoked) await tx.update(schema.awardGrants).set({ revokedAt: revoked ? new Date().toISOString() : null }).where(eq(schema.awardGrants.id, grant.id));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), grantId: grant.id, actorId: input.actorId, action, reason: input.reason.trim(), requestId: input.requestId });
    return { id: grant.id, revoked };
  });
}
/** Public projection deliberately excludes private evidence, actor and operational reason. */
export async function publicAgentAwards(db: DrizzleDB, agentId: string) {
  return publicAwards(db, { type: "agent", id: agentId });
}
export async function publicAccountAwards(db: DrizzleDB, accountId: string) {
  return publicAwards(db, { type: "account", id: accountId });
}
async function publicAwards(db: DrizzleDB, recipient: AwardRecipient) {
  return db.select({ id: schema.awardGrants.id, code: schema.awardDefinitions.code, title: schema.awardDefinitions.title,
    theme: schema.awardDefinitions.theme, awardedAt: schema.awardGrants.grantedAt,
    sourceSeasonId: schema.awardGrants.sourceSeasonId, sourceEventId: schema.awardGrants.sourceEventId })
    .from(schema.awardGrants).innerJoin(schema.awardDefinitions, eq(schema.awardDefinitions.code, schema.awardGrants.definitionCode))
    .where(and(recipient.type === "agent" ? eq(schema.awardGrants.agentId, recipient.id) : eq(schema.awardGrants.accountId, recipient.id), isNull(schema.awardGrants.revokedAt)))
    .orderBy(asc(schema.awardGrants.grantedAt)).limit(100);
}

export async function createAwardDefinition(db: DrizzleDB, input: { code: string; title: string; recipientType: "agent" | "account"; theme: string }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.code) || !input.title.trim() || !input.theme.trim()
    || !["agent", "account"].includes(input.recipientType)) throw new ChampionshipError("Invalid award definition");
  if (SEASON_ZERO_AWARDS.some(definition => definition.code === input.code)) throw new ChampionshipError("Built-in Season 0 award definitions are reserved", 409);
  const [definition] = await db.insert(schema.awardDefinitions).values(input).onConflictDoNothing().returning();
  if (definition) return definition;
  const [existing] = await db.select().from(schema.awardDefinitions).where(eq(schema.awardDefinitions.code, input.code));
  if (existing?.title !== input.title || existing.recipientType !== input.recipientType || existing.theme !== input.theme) throw new ChampionshipError("This award code has a different definition", 409);
  return existing;
}

export async function publicAwardDefinitions(db: DrizzleDB) {
  const definitions = new Map<string, { code: string; title: string; recipient: "agent" | "account"; theme: string }>(SEASON_ZERO_AWARDS.map(definition => [definition.code, {
    code: definition.code, title: definition.title, recipient: definition.recipient, theme: "season-0",
  }]));
  for (const definition of await db.select().from(schema.awardDefinitions).orderBy(asc(schema.awardDefinitions.code))) {
    if (!definitions.has(definition.code)) definitions.set(definition.code, {
      code: definition.code, title: definition.title, recipient: definition.recipientType, theme: definition.theme,
    });
  }
  return [...definitions.values()];
}
