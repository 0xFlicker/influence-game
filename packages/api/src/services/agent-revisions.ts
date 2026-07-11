import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  resolveModelSelection,
  type GameModelSelection,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  REVISION_POLICY_VERSION,
  classifyRevision,
  fingerprintEffectiveRuntimeSnapshot,
  recalibrateRatingForRevision,
  type EffectiveAgentRuntimeSnapshot,
} from "./revision-policy.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export interface AgentProfileRevisionSource {
  id: string;
  name: string;
  personality: string;
  backstory: string | null;
  strategyStyle: string | null;
  personaKey: string | null;
}

export interface EnsureAgentRevisionInput {
  profile: AgentProfileRevisionSource;
  effectiveRuntimeSnapshot: EffectiveAgentRuntimeSnapshot;
  trigger: typeof schema.agentRevisions.$inferInsert.trigger;
}

export interface EnsuredAgentRevision {
  revision: typeof schema.agentRevisions.$inferSelect;
  created: boolean;
  ratingRecalibrated: boolean;
}

export function resolveFreeTrackEffectiveRuntimeSnapshot(
  profile: AgentProfileRevisionSource,
  options: {
    modelSelection?: GameModelSelection | null;
    modelTier?: string | null;
    temperature?: number;
  } = {},
): EffectiveAgentRuntimeSnapshot {
  const resolved = resolveModelSelection(
    options.modelSelection ?? null,
    options.modelTier ?? "budget",
  );
  return {
    name: profile.name,
    personality: profile.personality,
    backstory: profile.backstory,
    strategyInstructions: profile.strategyStyle,
    personaKey: profile.personaKey,
    model: resolved.modelId,
    providerProfileId: resolved.providerProfile.id,
    catalogId: resolved.catalogId,
    reasoningPolicy: resolved.reasoningPolicy,
    toolChoiceMode: resolved.model.preferredToolChoiceMode
      ?? resolved.providerProfile.defaultToolChoiceMode,
    temperature: options.temperature ?? 0.9,
  };
}

export async function ensureAgentRevision(
  db: DrizzleDB,
  input: EnsureAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  return db.transaction((tx) => ensureAgentRevisionInTransaction(tx, input));
}

export async function ensureAgentRevisionInTransaction(
  tx: DrizzleTransaction,
  input: EnsureAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${input.profile.id}
    FOR UPDATE
  `);

  const profileState = (await tx.select({ currentRevisionId: schema.agentProfiles.currentRevisionId })
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.id, input.profile.id))
    .limit(1))[0];
  if (!profileState) throw new Error(`Agent profile ${input.profile.id} not found`);
  const latest = (await tx
    .select()
    .from(schema.agentRevisions)
    .where(eq(schema.agentRevisions.agentProfileId, input.profile.id))
    .orderBy(desc(schema.agentRevisions.ordinal))
    .limit(1))[0];
  const current = profileState.currentRevisionId
    ? (await tx.select().from(schema.agentRevisions)
      .where(and(
        eq(schema.agentRevisions.id, profileState.currentRevisionId),
        eq(schema.agentRevisions.agentProfileId, input.profile.id),
      )).limit(1))[0]
    : latest;
  const nextFingerprint = fingerprintEffectiveRuntimeSnapshot(input.effectiveRuntimeSnapshot);
  if (current?.fingerprint === nextFingerprint) {
    if (profileState.currentRevisionId !== current.id) {
      await tx.update(schema.agentProfiles).set({ currentRevisionId: current.id })
        .where(eq(schema.agentProfiles.id, input.profile.id));
    }
    return { revision: current, created: false, ratingRecalibrated: false };
  }

  const previousSnapshot = current
    ? parseEffectiveRuntimeSnapshot(current.effectiveRuntimeSnapshot)
    : null;
  const classification = classifyRevision(previousSnapshot, input.effectiveRuntimeSnapshot);
  const magnitude = classification.magnitude === "none" ? "small" : classification.magnitude;
  const behaviorSnapshot = {
    name: input.effectiveRuntimeSnapshot.name,
    personality: input.effectiveRuntimeSnapshot.personality,
    backstory: input.effectiveRuntimeSnapshot.backstory,
    strategyInstructions: input.effectiveRuntimeSnapshot.strategyInstructions,
    personaKey: input.effectiveRuntimeSnapshot.personaKey,
  };
  const revision = (await tx.insert(schema.agentRevisions).values({
    id: randomUUID(),
    agentProfileId: input.profile.id,
    ordinal: (latest?.ordinal ?? 0) + 1,
    priorRevisionId: current?.id ?? null,
    trigger: input.trigger,
    magnitude,
    fingerprint: nextFingerprint,
    behaviorSnapshot,
    effectiveRuntimeSnapshot: Object.fromEntries(Object.entries(input.effectiveRuntimeSnapshot)),
    revisionPolicyVersion: REVISION_POLICY_VERSION,
  }).returning())[0];
  if (!revision) throw new Error(`Failed to create revision for agent ${input.profile.id}`);
  const created = true;
  await tx.update(schema.agentProfiles).set({ currentRevisionId: revision.id })
    .where(eq(schema.agentProfiles.id, input.profile.id));

  const currentRating = (await tx
    .select()
    .from(schema.agentCompetitionRatings)
    .where(eq(schema.agentCompetitionRatings.agentProfileId, input.profile.id)))[0];
  if (!currentRating) {
    return { revision, created, ratingRecalibrated: false };
  }

  const recalibration = recalibrateRatingForRevision(
    { mu: currentRating.mu, sigma: currentRating.sigma },
    magnitude,
  );
  await tx.update(schema.agentCompetitionRatings)
    .set({
      effectiveRevisionId: revision.id,
      mu: recalibration.after.mu,
      sigma: recalibration.after.sigma,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.agentCompetitionRatings.agentProfileId, input.profile.id));
  await tx.insert(schema.competitionRatingEvents).values({
    id: randomUUID(),
    idempotencyKey: created
      ? `revision:${input.profile.id}:${revision.id}`
      : `revision-activation:${input.profile.id}:${randomUUID()}`,
    agentProfileId: input.profile.id,
    agentRevisionId: revision.id,
    seasonId: null,
    gameId: null,
    eventType: "revision_recalibration",
    beforeMu: recalibration.before.mu,
    beforeSigma: recalibration.before.sigma,
    afterMu: recalibration.after.mu,
    afterSigma: recalibration.after.sigma,
    ratingPolicyVersion: currentRating.ratingPolicyVersion,
    revisionPolicyVersion: REVISION_POLICY_VERSION,
    evidence: {
      classification: {
        previousRevisionId: current?.id ?? null,
        nextRevisionId: revision.id,
        previousFingerprint: classification.previousFingerprint,
        nextFingerprint: classification.nextFingerprint,
        magnitude,
        ...classification.evidence,
      },
      recalibration: {
        varianceAddition: recalibration.varianceAddition,
        sigmaCap: recalibration.sigmaCap,
      },
    },
  });
  return { revision, created, ratingRecalibrated: true };
}

export async function getLatestAgentRevision(
  db: DrizzleDB,
  agentProfileId: string,
): Promise<typeof schema.agentRevisions.$inferSelect | null> {
  return (await db.select()
    .from(schema.agentRevisions)
    .where(eq(schema.agentRevisions.agentProfileId, agentProfileId))
    .orderBy(desc(schema.agentRevisions.ordinal))
    .limit(1))[0] ?? null;
}

function parseEffectiveRuntimeSnapshot(value: Record<string, unknown>): EffectiveAgentRuntimeSnapshot {
  const requiredStrings = ["name", "personality", "model", "providerProfileId", "catalogId"] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") {
      throw new Error(`Stored agent revision is missing ${key}`);
    }
  }
  if (typeof value.temperature !== "number") {
    throw new Error("Stored agent revision is missing temperature");
  }
  return {
    name: value.name as string,
    personality: value.personality as string,
    backstory: nullableString(value.backstory),
    strategyInstructions: nullableString(value.strategyInstructions),
    personaKey: nullableString(value.personaKey),
    model: value.model as string,
    providerProfileId: value.providerProfileId as string,
    catalogId: value.catalogId as string,
    reasoningPolicy: nullableString(value.reasoningPolicy),
    toolChoiceMode: nullableString(value.toolChoiceMode),
    temperature: value.temperature,
  };
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Stored agent revision contains invalid text");
  return value;
}
