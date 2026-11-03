import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { SEASON_ZERO_AWARDS } from "@influence/engine/championship";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { ChampionshipError } from "./championships.js";

type AwardDatabase = Pick<DrizzleDB, "transaction">;
type AwardTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export type AwardRecipient = { type: "agent" | "account"; id: string };
export async function grantAward(db: AwardDatabase, input: {
  definitionCode: string; recipient: AwardRecipient; sourceKey: string;
  sourceSeasonId?: string; sourceEventId?: string; allocationId?: string; evidence: Record<string, unknown>;
  actorId: string; reason: string; requestId: string;
}) {
  const builtin = SEASON_ZERO_AWARDS.find(item => item.code === input.definitionCode);
  if (![input.reason, input.requestId, input.sourceKey, input.recipient.id].every(value => value.trim())) throw new ChampionshipError("Award requires recipient, reason, source and request ID");
  const evidence = await storeJson(input.evidence);
  await readJson(evidence);
  return db.transaction(async tx => {
    if (input.allocationId) await requireCurrentAllocation(tx, input.allocationId);
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
      if (input.allocationId && !existing.allocationId) await tx.update(schema.awardGrants).set({ allocationId: input.allocationId }).where(eq(schema.awardGrants.id, existing.id));
      return { id: existing.id, revoked: existing.revokedAt !== null, created: false };
    }
    const [visibility] = input.allocationId && input.sourceEventId ? await tx.select({ action: schema.competitionAudit.action })
      .from(schema.competitionAudit).innerJoin(schema.awardGrants, eq(schema.awardGrants.id, schema.competitionAudit.grantId))
      .where(and(eq(schema.awardGrants.sourceEventId, input.sourceEventId), eq(schema.awardGrants.definitionCode, definition.code),
        eq(schema.awardGrants.recipientKey, recipientKey), inArray(schema.competitionAudit.action, ["award_revoked", "award_reinstated"])))
      .orderBy(desc(schema.competitionAudit.createdAt), desc(schema.competitionAudit.id)).limit(1) : [];
    const withheld = visibility?.action === "award_revoked";
    const id = randomUUID();
    await tx.insert(schema.awardGrants).values({ id, definitionCode: definition.code, recipientKey, sourceKey: input.sourceKey,
      agentId: input.recipient.type === "agent" ? input.recipient.id : null,
      accountId: input.recipient.type === "account" ? input.recipient.id : null,
      sourceSeasonId: input.sourceSeasonId, sourceEventId: input.sourceEventId, allocationId: input.allocationId, evidence,
      grantedById: input.actorId, reason: input.reason, revokedAt: withheld ? new Date().toISOString() : null });
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), grantId: id, actorId: input.actorId,
      action: "award_granted", reason: input.reason, requestId: input.requestId });
    if (withheld) await tx.insert(schema.competitionAudit).values({ id: randomUUID(), grantId: id, actorId: input.actorId,
      action: "award_delivery_withheld", reason: "Preserve the producer's explicit revocation across corrected result allocations", requestId: `${id}:withheld` });
    return { id, revoked: withheld, created: true };
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
    await lockGrantEvent(tx, input.grantId);
    const [grant] = await tx.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, input.grantId)).for("update");
    if (!grant) throw new ChampionshipError("Award not found", 404);
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, input.actorId), eq(schema.competitionAudit.requestId, input.requestId)));
    if (prior) {
      if (prior.grantId !== grant.id || prior.action !== action || prior.reason !== input.reason.trim()) throw new ChampionshipError("Idempotency key already belongs to another correction", 409);
      return { id: grant.id, revoked: grant.revokedAt !== null };
    }
    if (grant.replacedById) throw new ChampionshipError("This grant was replaced; review its linked replacement", 409);
    if (grant.allocationId) await requireCurrentAllocation(tx, grant.allocationId);
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
/** Batch public roster awards without exposing private evidence or internal recipient IDs. */
export async function publicAgentAwardsByIds(db: DrizzleDB, agentIds: string[]) {
  const byAgent = new Map<string, Awaited<ReturnType<typeof publicAgentAwards>>>();
  if (!agentIds.length) return byAgent;
  const rows = await db.select({ agentId: schema.awardGrants.agentId, id: schema.awardGrants.id,
    code: schema.awardDefinitions.code, title: schema.awardDefinitions.title, theme: schema.awardDefinitions.theme,
    awardedAt: schema.awardGrants.grantedAt, sourceSeasonId: schema.awardGrants.sourceSeasonId, sourceEventId: schema.awardGrants.sourceEventId })
    .from(schema.awardGrants).innerJoin(schema.awardDefinitions, eq(schema.awardDefinitions.code, schema.awardGrants.definitionCode))
    .where(and(inArray(schema.awardGrants.agentId, agentIds), isNull(schema.awardGrants.revokedAt)))
    .orderBy(asc(schema.awardGrants.grantedAt));
  for (const { agentId, ...award } of rows) {
    if (!agentId) continue;
    const awards = byAgent.get(agentId) ?? [];
    if (awards.length < 100) awards.push(award);
    byAgent.set(agentId, awards);
  }
  return byAgent;
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

/** Serialize all delivery/correction work for a source event before locking individual grants. */
async function lockGrantEvent(tx: AwardTransaction, grantId: string) {
  const [grant] = await tx.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, grantId));
  const [allocation] = grant?.allocationId ? await tx.select().from(schema.championshipAwardAllocations).where(eq(schema.championshipAwardAllocations.id, grant.allocationId)) : [];
  const eventId = allocation?.eventId ?? grant?.sourceEventId;
  if (eventId) await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
}
async function requireCurrentAllocation(tx: AwardTransaction, allocationId: string) {
  const [identity] = await tx.select().from(schema.championshipAwardAllocations).where(eq(schema.championshipAwardAllocations.id, allocationId));
  if (!identity) throw new ChampionshipError("Award allocation not found", 404);
  await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, identity.eventId)).for("update");
  const [allocation] = await tx.select().from(schema.championshipAwardAllocations).where(eq(schema.championshipAwardAllocations.id, allocationId));
  if (allocation?.supersededAt) throw new ChampionshipError("Award allocation was superseded by a result correction", 409);
  return allocation!;
}

/** Replace attribution without rewriting the original recipient, achievement or evidence. */
export async function correctAwardRecipient(db: DrizzleDB, input: {
  grantId: string; recipient: AwardRecipient; evidence: Record<string, unknown>; actorId: string; reason: string; requestId: string;
}) {
  if (!input.reason.trim() || !input.requestId.trim() || !input.recipient.id.trim()) throw new ChampionshipError("Recipient correction requires a recipient, reason and request ID");
  const evidence = await storeJson(input.evidence); await readJson(evidence);
  const action = `award_recipient_corrected:${input.recipient.type}:${input.recipient.id}:${evidence.sha256}`;
  return db.transaction(async tx => {
    await lockGrantEvent(tx, input.grantId);
    const [original] = await tx.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, input.grantId)).for("update");
    if (!original) throw new ChampionshipError("Award not found", 404);
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, input.actorId), eq(schema.competitionAudit.requestId, input.requestId)));
    if (prior) {
      if (prior.grantId !== original.id || prior.action !== action || prior.reason !== input.reason.trim()) throw new ChampionshipError("Idempotency key already belongs to another correction", 409);
      return { originalId: original.id, replacementId: original.replacedById! };
    }
    if (original.revokedAt || original.replacedById) throw new ChampionshipError("Correct the current active grant; this grant is revoked or replaced", 409);
    if (original.allocationId) await requireCurrentAllocation(tx, original.allocationId);
    const replacement = await grantAward(tx, { definitionCode: original.definitionCode, recipient: input.recipient,
      sourceKey: `${original.sourceKey}:correction:${randomUUID()}`, ...(original.sourceSeasonId ? { sourceSeasonId: original.sourceSeasonId } : {}),
      ...(original.sourceEventId ? { sourceEventId: original.sourceEventId } : {}), ...(original.allocationId ? { allocationId: original.allocationId } : {}),
      evidence: input.evidence, actorId: input.actorId, reason: input.reason.trim(), requestId: `replacement:${input.requestId}` });
    await tx.update(schema.awardGrants).set({ revokedAt: new Date().toISOString(), replacedById: replacement.id }).where(eq(schema.awardGrants.id, original.id));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), grantId: original.id, eventId: original.sourceEventId, actorId: input.actorId,
      action, reason: input.reason.trim(), requestId: input.requestId });
    return { originalId: original.id, replacementId: replacement.id };
  });
}
