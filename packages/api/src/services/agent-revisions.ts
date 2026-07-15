import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  resolveModelSelection,
  type GameModelSelection,
  type LlmToolChoiceMode,
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

export interface EnsureActiveAgentRevisionInput {
  profile: AgentProfileRevisionSource;
  effectiveRuntimeSnapshot: EffectiveAgentRuntimeSnapshot;
  trigger: Exclude<
    typeof schema.agentRevisions.$inferInsert.trigger,
    "runtime_policy_change"
  >;
}

export interface ResolveGameEffectiveAgentRevisionInput {
  profile: AgentProfileRevisionSource;
  effectiveRuntimeSnapshot: EffectiveAgentRuntimeSnapshot;
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
    toolChoiceMode?: LlmToolChoiceMode;
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
      ?? options.toolChoiceMode
      ?? resolved.providerProfile.defaultToolChoiceMode,
    temperature: options.temperature ?? 0.9,
  };
}

export async function ensureActiveAgentRevision(
  db: DrizzleDB,
  input: EnsureActiveAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  return db.transaction((tx) => ensureActiveAgentRevisionInTransaction(tx, input));
}

export async function ensureActiveAgentRevisionInTransaction(
  tx: DrizzleTransaction,
  input: EnsureActiveAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  const { profileState, pointedCurrent, latest } = await lockAndLoadRevisionState(
    tx,
    input.profile.id,
  );
  // Active-revision maintenance may repair a legacy null pointer by reusing the
  // latest chronological revision. Game-effective resolution must never do so.
  const current = pointedCurrent ?? latest;
  const nextFingerprint = fingerprintEffectiveRuntimeSnapshot(input.effectiveRuntimeSnapshot);
  if (current?.fingerprint === nextFingerprint) {
    if (profileState.currentRevisionId !== current.id) {
      await tx.update(schema.agentProfiles).set({ currentRevisionId: current.id })
        .where(eq(schema.agentProfiles.id, input.profile.id));
    }
    return { revision: current, created: false, ratingRecalibrated: false };
  }

  const { revision, classification } = await insertRevision(tx, {
    profileId: input.profile.id,
    effectiveRuntimeSnapshot: input.effectiveRuntimeSnapshot,
    trigger: input.trigger,
    ordinal: (latest?.ordinal ?? 0) + 1,
    priorRevision: current ?? null,
  });
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
    revision.magnitude,
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
        magnitude: revision.magnitude,
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

export async function resolveGameEffectiveAgentRevision(
  db: DrizzleDB,
  input: ResolveGameEffectiveAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  return db.transaction((tx) => resolveGameEffectiveAgentRevisionInTransaction(tx, input));
}

export async function resolveGameEffectiveAgentRevisionInTransaction(
  tx: DrizzleTransaction,
  input: ResolveGameEffectiveAgentRevisionInput,
): Promise<EnsuredAgentRevision> {
  const { pointedCurrent: current, latest } = await lockAndLoadRevisionState(
    tx,
    input.profile.id,
  );
  if (!current) {
    throw new Error(`Agent profile ${input.profile.id} has no active revision`);
  }

  const nextFingerprint = fingerprintEffectiveRuntimeSnapshot(input.effectiveRuntimeSnapshot);
  if (current.fingerprint === nextFingerprint) {
    return { revision: current, created: false, ratingRecalibrated: false };
  }

  const matching = (await tx.select().from(schema.agentRevisions)
    .where(and(
      eq(schema.agentRevisions.agentProfileId, input.profile.id),
      eq(schema.agentRevisions.fingerprint, nextFingerprint),
    ))
    .orderBy(desc(schema.agentRevisions.ordinal))
    .limit(1))[0];
  if (matching) {
    return { revision: matching, created: false, ratingRecalibrated: false };
  }

  const { revision } = await insertRevision(tx, {
    profileId: input.profile.id,
    effectiveRuntimeSnapshot: input.effectiveRuntimeSnapshot,
    trigger: "runtime_policy_change",
    ordinal: (latest?.ordinal ?? 0) + 1,
    priorRevision: current,
  });
  return { revision, created: true, ratingRecalibrated: false };
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

async function lockAndLoadRevisionState(
  tx: DrizzleTransaction,
  agentProfileId: string,
): Promise<{
  profileState: Pick<typeof schema.agentProfiles.$inferSelect, "currentRevisionId">;
  pointedCurrent: typeof schema.agentRevisions.$inferSelect | undefined;
  latest: typeof schema.agentRevisions.$inferSelect | undefined;
}> {
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${agentProfileId}
    FOR UPDATE
  `);

  const profileState = (await tx.select({ currentRevisionId: schema.agentProfiles.currentRevisionId })
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.id, agentProfileId))
    .limit(1))[0];
  if (!profileState) throw new Error(`Agent profile ${agentProfileId} not found`);
  const latest = (await tx.select().from(schema.agentRevisions)
    .where(eq(schema.agentRevisions.agentProfileId, agentProfileId))
    .orderBy(desc(schema.agentRevisions.ordinal))
    .limit(1))[0];
  const pointedCurrent = profileState.currentRevisionId
    ? (await tx.select().from(schema.agentRevisions)
      .where(and(
        eq(schema.agentRevisions.id, profileState.currentRevisionId),
        eq(schema.agentRevisions.agentProfileId, agentProfileId),
      ))
      .limit(1))[0]
    : undefined;
  if (profileState.currentRevisionId && !pointedCurrent) {
    throw new Error(`Agent profile ${agentProfileId} has an invalid active revision`);
  }
  return { profileState, pointedCurrent, latest };
}

async function insertRevision(
  tx: DrizzleTransaction,
  input: {
    profileId: string;
    effectiveRuntimeSnapshot: EffectiveAgentRuntimeSnapshot;
    trigger: typeof schema.agentRevisions.$inferInsert.trigger;
    ordinal: number;
    priorRevision: typeof schema.agentRevisions.$inferSelect | null;
  },
): Promise<{
  revision: typeof schema.agentRevisions.$inferSelect;
  classification: ReturnType<typeof classifyRevision>;
}> {
  const previousSnapshot = input.priorRevision
    ? parseEffectiveRuntimeSnapshot(input.priorRevision.effectiveRuntimeSnapshot)
    : null;
  const classification = classifyRevision(previousSnapshot, input.effectiveRuntimeSnapshot);
  const magnitude = classification.magnitude === "none" ? "small" : classification.magnitude;
  const revision = (await tx.insert(schema.agentRevisions).values({
    id: randomUUID(),
    agentProfileId: input.profileId,
    ordinal: input.ordinal,
    priorRevisionId: input.priorRevision?.id ?? null,
    trigger: input.trigger,
    magnitude,
    fingerprint: classification.nextFingerprint,
    behaviorSnapshot: {
      name: input.effectiveRuntimeSnapshot.name,
      personality: input.effectiveRuntimeSnapshot.personality,
      backstory: input.effectiveRuntimeSnapshot.backstory,
      strategyInstructions: input.effectiveRuntimeSnapshot.strategyInstructions,
      personaKey: input.effectiveRuntimeSnapshot.personaKey,
    },
    effectiveRuntimeSnapshot: Object.fromEntries(Object.entries(input.effectiveRuntimeSnapshot)),
    revisionPolicyVersion: REVISION_POLICY_VERSION,
  }).returning())[0];
  if (!revision) throw new Error(`Failed to create revision for agent ${input.profileId}`);
  return { revision, classification };
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
