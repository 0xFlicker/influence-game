import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  AvatarChangeSource,
  AvatarGenerationStatus,
  AvatarGenerationTriggerSource,
} from "../db/schema.js";
import { AGENT_GENDER_LABELS, isAgentGender, type AgentGender } from "../lib/agent-gender.js";
import { storePublicAvatarImage } from "../lib/storage.js";

const AVATAR_GENERATION_PURPOSE = "agent_profile_completion";
const KATANA_BASE_URL = "https://kat.imgnai.com";
const KATANA_MODEL = "gen";
const KATANA_PROVIDER = "katana";
const ESTIMATED_GEN_COST_MICROUSD = 15_600;
const DEFAULT_FREE_QUOTA = 25;
const DEFAULT_DAILY_LIMIT = 5;
const DEFAULT_MAX_POLLS = 120;
const DEFAULT_POLL_DELAY_MS = 1_000;
const ACTIVE_GENERATION_STALE_MS = 10 * 60 * 1000;
const KATANA_REQUEST_TIMEOUT_MS = 30_000;
const MAX_AVATAR_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const AVATAR_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_PROVIDER_ASSET_HOSTS = ["imgnai.com"];

type AgentProfileRow = typeof schema.agentProfiles.$inferSelect;
type AvatarGenerationRequestRow = typeof schema.avatarGenerationRequests.$inferSelect;
export interface AvatarPromptProfile {
  name: string;
  gender: AgentGender | null;
  backstory: string | null;
  personality: string;
  strategyStyle: string | null;
  personaKey: string | null;
  avatarUrl?: string | null;
}
type AvatarGenerationReadDB = Pick<DrizzleDB, "select">;
type AvatarGenerationWriteDB = Pick<DrizzleDB, "insert" | "select" | "update">;
type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type DatabaseExecutor = DrizzleDB | DrizzleTransaction;

export type AvatarCompletionStatus =
  | "already_provided"
  | "accepted"
  | "queued"
  | "processing"
  | "completed"
  | "skipped"
  | "failed";

export type AvatarGenerationStage =
  | "provider_submit"
  | "provider_poll"
  | "asset_select"
  | "asset_download"
  | "avatar_store"
  | "profile_update";

export interface AvatarCompletionRead {
  status: AvatarCompletionStatus;
  generationRequestId?: string;
  avatarUrl?: string | null;
  reason?: string;
  failureCode?: string;
  failureStage?: AvatarGenerationStage;
  retryable?: boolean;
  profileFingerprint?: string;
}

export interface AvatarCompletionInput {
  userId: string;
  agentProfileId: string;
  triggerSource: AvatarGenerationTriggerSource;
  publicBaseUrl?: string;
  userRoles?: readonly string[];
}

export interface DraftAvatarCompletionInput {
  userId: string;
  profile: AvatarPromptProfile;
  publicBaseUrl?: string;
  userRoles?: readonly string[];
}

export interface AvatarGenerationOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxPolls?: number;
  pollDelayMs?: number;
  processImmediately?: boolean;
}

export type AvatarCompletionStartOptions = AvatarGenerationOptions & {
  publicBaseUrl?: string;
};

interface KatanaGenerationEnvelope {
  request_id?: string;
  status?: string;
  poll_after_seconds?: number;
  responses?: Array<{
    error?: {
      code?: string;
      message?: string;
      retryable?: boolean;
      details?: Record<string, unknown>;
    };
    output_assets?: Array<{
      original_data_url?: string;
      url?: string;
      width?: number;
      height?: number;
      metadata?: { tags?: unknown };
    }>;
  }>;
}

export async function requestAvatarCompletion(
  db: DrizzleDB,
  input: AvatarCompletionInput,
  options: AvatarGenerationOptions = {},
): Promise<AvatarCompletionRead> {
  const profile = await requireOwnedAgentProfile(db, input.userId, input.agentProfileId);
  if (profile.avatarUrl) {
    return {
      status: "already_provided",
      avatarUrl: profile.avatarUrl,
      reason: "Agent already has an avatar.",
    };
  }

  const existing = await findActiveOrCompletedGeneration(db, input.userId, input.agentProfileId);
  if (existing) {
    if (existing.status === "processing" && isStaleActiveGeneration(existing, options)) {
      return {
        ...generationRead(existing),
        status: "accepted",
        reason: "Restarting stale avatar generation request.",
      };
    }
    return generationRead(existing);
  }

  const providerConfig = getKatanaConfig();
  if (!providerConfig) {
    const row = await insertTerminalGeneration(db, input, "skipped", "provider_not_configured", "Katana avatar generation is not configured.", options);
    await recordAvatarChange(db, {
      userId: input.userId,
      agentProfileId: input.agentProfileId,
      source: "generation_skipped",
      status: "skipped",
      generationRequestId: row.id,
      previousAvatarUrl: null,
      newAvatarUrl: null,
      safeMetadata: { reason: "provider_not_configured" },
    }, options);
    return generationRead(row);
  }

  const quota = await checkAvatarGenerationQuota(db, input.userId, input.userRoles, options);
  if (!quota.ok) {
    const row = await insertTerminalGeneration(db, input, "skipped", quota.code, quota.message, options);
    await recordAvatarChange(db, {
      userId: input.userId,
      agentProfileId: input.agentProfileId,
      source: "generation_skipped",
      status: "skipped",
      generationRequestId: row.id,
      previousAvatarUrl: null,
      newAvatarUrl: null,
      safeMetadata: { reason: quota.code },
    }, options);
    return generationRead(row);
  }

  const now = isoNow(options);
  const prompt = buildAvatarPrompt(profile);
  const [row] = await db
    .insert(schema.avatarGenerationRequests)
    .values({
      id: randomUUID(),
      userId: input.userId,
      agentProfileId: input.agentProfileId,
      purpose: AVATAR_GENERATION_PURPOSE,
      status: "queued",
      triggerSource: input.triggerSource,
      provider: KATANA_PROVIDER,
      model: KATANA_MODEL,
      promptHash: hashPrompt(prompt),
      estimatedCostMicrousd: ESTIMATED_GEN_COST_MICROUSD,
      safeMetadata: {
        source: input.triggerSource,
        promptVersion: 1,
      },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const request = row
    ?? await findActiveOrCompletedGeneration(db, input.userId, input.agentProfileId);
  if (!request) {
    throw new Error("Failed to create or reuse avatar generation request.");
  }

  if (options.processImmediately) {
    return completeAvatarGenerationRequest(db, request.id, {
      ...options,
      publicBaseUrl: input.publicBaseUrl,
    });
  }

  return generationRead(request);
}

export async function requestAndStartAvatarCompletion(
  db: DrizzleDB,
  input: AvatarCompletionInput,
  options: AvatarCompletionStartOptions = {},
): Promise<AvatarCompletionRead> {
  const read = await requestAvatarCompletion(db, input, options);
  return startAcceptedAvatarCompletion(db, read, {
    ...options,
    publicBaseUrl: input.publicBaseUrl ?? options.publicBaseUrl,
  }, "Background avatar completion failed");
}

export async function requestDraftAvatarCompletion(
  db: DrizzleDB,
  input: DraftAvatarCompletionInput,
  options: AvatarCompletionStartOptions = {},
): Promise<AvatarCompletionRead> {
  const draftId = `draft-${randomUUID()}`;
  const requestInput: AvatarCompletionInput = {
    userId: input.userId,
    agentProfileId: draftId,
    triggerSource: "web_ai_help_draft",
    publicBaseUrl: input.publicBaseUrl,
    userRoles: input.userRoles,
  };
  const providerConfig = getKatanaConfig();
  if (!providerConfig) {
    return generationRead(await insertTerminalGeneration(
      db,
      requestInput,
      "skipped",
      "provider_not_configured",
      "Katana avatar generation is not configured.",
      options,
      draftRequestMetadata(input.profile),
    ));
  }

  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const quota = await checkAvatarGenerationQuota(tx, input.userId, input.userRoles, options);
    if (!quota.ok) {
      return insertTerminalGeneration(
        tx,
        requestInput,
        "skipped",
        quota.code,
        quota.message,
        options,
        draftRequestMetadata(input.profile),
      );
    }

    const now = isoNow(options);
    const prompt = buildAvatarPrompt(input.profile);
    const [request] = await tx.insert(schema.avatarGenerationRequests).values({
      id: randomUUID(),
      userId: input.userId,
      agentProfileId: draftId,
      purpose: AVATAR_GENERATION_PURPOSE,
      status: "queued",
      triggerSource: "web_ai_help_draft",
      provider: KATANA_PROVIDER,
      model: KATANA_MODEL,
      promptHash: hashPrompt(prompt),
      estimatedCostMicrousd: ESTIMATED_GEN_COST_MICROUSD,
      safeMetadata: draftRequestMetadata(input.profile),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return requireReturnedRow(request, "Failed to create draft avatar generation request");
  });

  if (options.processImmediately) {
    return completeAvatarGenerationRequest(db, row.id, {
      ...options,
      publicBaseUrl: input.publicBaseUrl,
    });
  }
  return generationRead(row);
}

export async function requestAndStartDraftAvatarCompletion(
  db: DrizzleDB,
  input: DraftAvatarCompletionInput,
  options: AvatarCompletionStartOptions = {},
): Promise<AvatarCompletionRead> {
  const read = await requestDraftAvatarCompletion(db, input, options);
  return startAcceptedAvatarCompletion(db, read, {
    ...options,
    publicBaseUrl: input.publicBaseUrl ?? options.publicBaseUrl,
  }, "Background draft avatar completion failed");
}

function startAcceptedAvatarCompletion(
  db: DrizzleDB,
  read: AvatarCompletionRead,
  options: AvatarCompletionStartOptions,
  warning: string,
): AvatarCompletionRead {
  if (read.status === "accepted" && !options.processImmediately && read.generationRequestId) {
    void completeAvatarGenerationRequest(db, read.generationRequestId, options).catch((error) => {
      console.warn(`[avatar-generation] ${warning}:`, error);
    });
  }
  return read;
}

export async function resumeOwnedDraftAvatarCompletion(
  db: DrizzleDB,
  userId: string,
  generationRequestId: string,
  options: AvatarCompletionStartOptions = {},
): Promise<AvatarCompletionRead | null> {
  const request = (await db.select().from(schema.avatarGenerationRequests).where(and(
    eq(schema.avatarGenerationRequests.id, generationRequestId),
    eq(schema.avatarGenerationRequests.userId, userId),
  )).limit(1))[0];
  if (!request || !readDraftProfile(request)) return null;

  if (request.status === "queued"
    || (request.status === "processing" && isStaleActiveGeneration(request, options))) {
    void completeAvatarGenerationRequest(db, request.id, options).catch((error) => {
      console.warn("[avatar-generation] Failed to resume draft avatar completion:", error);
    });
  }
  return generationRead(request);
}

export async function consumeOwnedDraftAvatarCompletion(
  db: DatabaseExecutor,
  input: { userId: string; generationRequestId: string; profile: AvatarPromptProfile },
): Promise<
  | { ok: true; completion: AvatarCompletionRead }
  | { ok: false; reason: "not_found" | "pending" | "profile_changed" | "already_consumed" }
> {
  const request = (await db.select().from(schema.avatarGenerationRequests).where(and(
    eq(schema.avatarGenerationRequests.id, input.generationRequestId),
    eq(schema.avatarGenerationRequests.userId, input.userId),
  )).limit(1))[0];
  if (!request || !readDraftProfile(request)) return { ok: false, reason: "not_found" };
  if (request.status === "queued" || request.status === "processing") {
    return { ok: false, reason: "pending" };
  }

  const metadata = isRecord(request.safeMetadata) ? request.safeMetadata : {};
  if (metadata.profileFingerprint !== avatarProfileFingerprint(input.profile)) {
    return { ok: false, reason: "profile_changed" };
  }
  if (typeof metadata.consumedAt === "string") {
    return { ok: false, reason: "already_consumed" };
  }

  const [consumed] = await db.update(schema.avatarGenerationRequests).set({
    safeMetadata: { ...metadata, consumedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(schema.avatarGenerationRequests.id, request.id),
    sql`NOT (${schema.avatarGenerationRequests.safeMetadata} ? 'consumedAt')`,
  )).returning();
  return consumed
    ? { ok: true, completion: generationRead(consumed) }
    : { ok: false, reason: "already_consumed" };
}

export function avatarProfileFingerprint(profile: AvatarPromptProfile): string {
  return JSON.stringify([
    profile.gender,
    profile.backstory?.trim() ?? null,
    profile.personality.trim(),
    profile.strategyStyle?.trim() ?? null,
    profile.personaKey,
  ]);
}

function draftRequestMetadata(profile: AvatarPromptProfile): Record<string, unknown> {
  return {
    source: "web_ai_help_draft",
    promptVersion: 1,
    draftProfile: profile,
    profileFingerprint: avatarProfileFingerprint(profile),
  };
}

export async function completeAvatarGenerationRequest(
  db: DrizzleDB,
  generationRequestId: string,
  options: AvatarGenerationOptions & { publicBaseUrl?: string } = {},
): Promise<AvatarCompletionRead> {
  const request = await requireGenerationRequest(db, generationRequestId);
  if (request.status === "completed" || request.status === "failed" || request.status === "skipped") {
    return generationRead(request);
  }

  const draftProfile = readDraftProfile(request);
  const profile = draftProfile ?? await requireOwnedAgentProfile(db, request.userId, request.agentProfileId);
  if (!draftProfile && profile.avatarUrl) {
    const skipped = await db.transaction(async (tx) => {
      const row = await updateGenerationRequest(tx, request.id, {
        status: "skipped",
        failureCode: "avatar_already_provided",
        failureMessage: displayFailureMessage("avatar_already_provided"),
        completedAt: isoNow(options),
      }, options);
      await recordAvatarChange(tx, {
        userId: request.userId,
        agentProfileId: request.agentProfileId,
        source: "generation_skipped",
        status: "skipped",
        generationRequestId: request.id,
        previousAvatarUrl: profile.avatarUrl,
        newAvatarUrl: profile.avatarUrl,
        safeMetadata: { reason: "avatar_already_provided" },
      }, options);
      return row;
    });
    return {
      ...generationRead(skipped),
      avatarUrl: profile.avatarUrl,
    };
  }

  const katana = getKatanaConfig();
  if (!katana) {
    const failed = await db.transaction(async (tx) => {
      const row = await updateGenerationRequest(tx, request.id, {
        status: "skipped",
        failureCode: "provider_not_configured",
        failureMessage: displayFailureMessage("provider_not_configured"),
        completedAt: isoNow(options),
      }, options);
      if (!draftProfile) {
        await recordAvatarChange(tx, {
          userId: request.userId,
          agentProfileId: request.agentProfileId,
          source: "generation_skipped",
          status: "skipped",
          generationRequestId: request.id,
          previousAvatarUrl: profile.avatarUrl,
          newAvatarUrl: profile.avatarUrl,
          safeMetadata: { reason: "provider_not_configured" },
        }, options);
      }
      return row;
    });
    return generationRead(failed);
  }

  const fetchImpl = options.fetch ?? fetch;
  let stage: AvatarGenerationStage = "provider_submit";
  let providerRequestId = request.providerRequestId;
  let providerStatus: string | null = null;

  try {
    const claim = await claimGenerationProviderWork(db, request, options);
    if (claim.action === "wait") {
      return generationRead(claim.request);
    }

    providerRequestId = claim.providerRequestId;

    if (!providerRequestId) {
      stage = "provider_submit";
      const prompt = buildAvatarPrompt(profile);
      const submitted = await submitKatanaGeneration(fetchImpl, katana, prompt);
      if (!submitted.requestId) {
        throw new AvatarGenerationFailure("provider_rejected", "Katana did not return a request_id.");
      }
      providerRequestId = submitted.requestId;
      providerStatus = submitted.status;

      await updateGenerationRequest(db, request.id, {
        providerRequestId,
        safeMetadata: mergeSafeMetadata(request.safeMetadata, {
          providerStatus,
          source: request.triggerSource,
          promptVersion: 1,
        }),
      }, options);
    }

    stage = "provider_poll";
    const completed = await pollKatanaGeneration(fetchImpl, katana, providerRequestId, options);
    providerStatus = completed.status ?? providerStatus;
    stage = "asset_select";
    const asset = selectOutputAsset(completed);
    const assetUrl = asset?.original_data_url ?? asset?.url;
    if (!assetUrl) {
      throw new AvatarGenerationFailure("missing_output_asset", "Katana completed without an image asset.");
    }

    stage = "asset_download";
    const image = await downloadImage(fetchImpl, assetUrl);
    stage = "avatar_store";
    const stored = await storePublicAvatarImage(
      generatedAvatarKey(request.userId, request.agentProfileId, request.id, image.contentType),
      image.contentType,
      image.body,
      options.publicBaseUrl,
    );
    const now = isoNow(options);

    if (draftProfile) {
      const finished = await updateGenerationRequest(db, request.id, {
        status: "completed",
        completedAt: now,
        safeMetadata: mergeSafeMetadata(request.safeMetadata, {
          providerStatus: completed.status ?? "completed",
          width: asset?.width,
          height: asset?.height,
          storageKey: stored.key,
          avatarUrl: stored.publicUrl,
        }),
      }, options);
      return {
        ...generationRead(finished),
        avatarUrl: stored.publicUrl,
      };
    }

    stage = "profile_update";
    const result = await db.transaction(async (tx) => {
      const [assignedProfile] = await tx
        .update(schema.agentProfiles)
        .set({
          avatarUrl: stored.publicUrl,
          updatedAt: now,
        })
        .where(and(
          eq(schema.agentProfiles.id, request.agentProfileId),
          eq(schema.agentProfiles.userId, request.userId),
          isNull(schema.agentProfiles.avatarUrl),
        ))
        .returning();

      if (!assignedProfile) {
        const currentProfile = await requireOwnedAgentProfile(tx, request.userId, request.agentProfileId);
        const skipped = await updateGenerationRequest(tx, request.id, {
          status: "skipped",
          failureCode: "avatar_already_provided",
          failureMessage: displayFailureMessage("avatar_already_provided"),
          completedAt: now,
          safeMetadata: {
            storageKey: stored.key,
            providerStatus: completed.status ?? "completed",
          },
        }, options);
        await recordAvatarChange(tx, {
          userId: request.userId,
          agentProfileId: request.agentProfileId,
          source: "generation_skipped",
          status: "skipped",
          generationRequestId: request.id,
          previousAvatarUrl: profile.avatarUrl,
          newAvatarUrl: currentProfile.avatarUrl,
          safeMetadata: {
            reason: "avatar_already_provided",
            storageKey: stored.key,
          },
        }, options);
        return {
          completion: skipped,
          avatarUrl: currentProfile.avatarUrl,
        };
      }

      const finished = await updateGenerationRequest(tx, request.id, {
        status: "completed",
        completedAt: now,
        safeMetadata: {
          providerStatus: completed.status ?? "completed",
          width: asset?.width,
          height: asset?.height,
          storageKey: stored.key,
        },
      }, options);
      await recordAvatarChange(tx, {
        userId: request.userId,
        agentProfileId: request.agentProfileId,
        source: request.triggerSource === "web_user_prompt" || request.triggerSource === "web_create_default"
          ? "web_generated_completion"
          : "backend_generated_completion",
        status: "completed",
        generationRequestId: request.id,
        previousAvatarUrl: profile.avatarUrl,
        newAvatarUrl: stored.publicUrl,
        safeMetadata: { storageKey: stored.key },
      }, options);
      return {
        completion: finished,
        avatarUrl: stored.publicUrl,
      };
    });

    return {
      ...generationRead(result.completion),
      avatarUrl: result.avatarUrl,
    };
  } catch (error) {
    const failure = normalizeGenerationFailure(error, stage);
    logAvatarGenerationFailure({
      error,
      failure,
      generationRequestId: request.id,
      agentProfileId: request.agentProfileId,
      userId: request.userId,
      providerRequestId,
      providerStatus,
    });
    const failed = await db.transaction(async (tx) => {
      const row = await updateGenerationRequest(tx, request.id, {
        status: "failed",
        failureCode: failure.code,
        failureMessage: failure.message,
        completedAt: isoNow(options),
        safeMetadata: mergeSafeMetadata(request.safeMetadata, {
          retryable: failure.retryable,
          stage: failure.stage,
          providerRequestId,
          providerStatus,
          errorName: error instanceof Error ? error.name : typeof error,
        }),
      }, options);
      if (!draftProfile) {
        await recordAvatarChange(tx, {
          userId: request.userId,
          agentProfileId: request.agentProfileId,
          source: "generation_failed",
          status: "failed",
          generationRequestId: request.id,
          previousAvatarUrl: profile.avatarUrl,
          newAvatarUrl: profile.avatarUrl,
          safeMetadata: {
            reason: failure.code,
            retryable: failure.retryable,
            stage: failure.stage,
          },
        }, options);
      }
      return row;
    });
    return generationRead(failed);
  }
}

export async function latestAvatarCompletion(
  db: DrizzleDB,
  userId: string,
  agentProfileId: string,
): Promise<AvatarCompletionRead | null> {
  const latest = (await db
    .select()
    .from(schema.avatarGenerationRequests)
    .where(and(
      eq(schema.avatarGenerationRequests.userId, userId),
      eq(schema.avatarGenerationRequests.agentProfileId, agentProfileId),
      eq(schema.avatarGenerationRequests.purpose, AVATAR_GENERATION_PURPOSE),
    ))
    .orderBy(desc(schema.avatarGenerationRequests.createdAt))
    .limit(1))[0];

  return latest ? generationRead(latest) : null;
}

export async function latestAvatarCompletionsByAgentProfileId(
  db: DrizzleDB,
  userId: string,
  agentProfileIds: readonly string[],
): Promise<Map<string, AvatarCompletionRead>> {
  if (agentProfileIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select()
    .from(schema.avatarGenerationRequests)
    .where(and(
      eq(schema.avatarGenerationRequests.userId, userId),
      eq(schema.avatarGenerationRequests.purpose, AVATAR_GENERATION_PURPOSE),
      inArray(schema.avatarGenerationRequests.agentProfileId, [...agentProfileIds]),
    ))
    .orderBy(desc(schema.avatarGenerationRequests.createdAt));

  const completions = new Map<string, AvatarCompletionRead>();
  for (const row of rows) {
    if (completions.has(row.agentProfileId)) continue;
    completions.set(row.agentProfileId, generationRead(row));
  }
  return completions;
}

export async function recordAvatarChange(
  db: Pick<DrizzleDB, "insert">,
  input: {
    userId: string;
    agentProfileId: string;
    source: AvatarChangeSource;
    status: "completed" | "skipped" | "failed";
    actorUserId?: string | null;
    generationRequestId?: string | null;
    previousAvatarUrl?: string | null;
    newAvatarUrl?: string | null;
    safeMetadata?: Record<string, unknown>;
  },
  options: Pick<AvatarGenerationOptions, "now"> = {},
): Promise<void> {
  await db.insert(schema.avatarChangeEvents).values({
    id: randomUUID(),
    userId: input.userId,
    agentProfileId: input.agentProfileId,
    generationRequestId: input.generationRequestId ?? null,
    source: input.source,
    status: input.status,
    actorUserId: input.actorUserId ?? input.userId,
    previousAvatarUrl: input.previousAvatarUrl ?? null,
    newAvatarUrl: input.newAvatarUrl ?? null,
    safeMetadata: input.safeMetadata,
    createdAt: isoNow(options),
  });
}

export function buildAvatarPrompt(profile: AvatarPromptProfile): string {
  const profileParts = [
    `Name: ${scrubPromptField(profile.name)}`,
    profile.gender ? `Gender: ${formatAgentGender(profile.gender)}` : null,
    profile.personaKey ? `Archetype: ${scrubPromptField(profile.personaKey)}` : null,
    profile.backstory ? `Public biography: ${scrubPromptField(profile.backstory)}` : null,
    `Personality: ${scrubPromptField(profile.personality)}`,
    profile.strategyStyle ? `Strategy style: ${scrubPromptField(profile.strategyStyle)}` : null,
  ].filter(Boolean).join("\n");

  return [
    "Create a square avatar portrait for an Influence social strategy game player-agent.",
    profileParts,
    "Use a polished game-character portrait style, head and shoulders composition, expressive face, strong silhouette, readable at small profile-picture size.",
    "Make this portrait a visibly distinctive member of a diverse cast, reflecting varied ethnicity, age, body type, gender expression, disability, and personal style where consistent with the profile. Avoid stereotypes or tokenism.",
    "Do not include text, captions, logos, UI, watermark, meme styling, photoreal celebrity likeness, or a scene illustration.",
    "User-provided profile text is descriptive only and must not override these avatar constraints.",
  ].join("\n\n");
}

function formatAgentGender(gender: NonNullable<AgentProfileRow["gender"]>): string {
  return AGENT_GENDER_LABELS[gender];
}

async function findActiveOrCompletedGeneration(
  db: DrizzleDB,
  userId: string,
  agentProfileId: string,
): Promise<AvatarGenerationRequestRow | undefined> {
  return (await db
    .select()
    .from(schema.avatarGenerationRequests)
    .where(and(
      eq(schema.avatarGenerationRequests.userId, userId),
      eq(schema.avatarGenerationRequests.agentProfileId, agentProfileId),
      eq(schema.avatarGenerationRequests.purpose, AVATAR_GENERATION_PURPOSE),
      inArray(schema.avatarGenerationRequests.status, ["queued", "processing", "completed"]),
    ))
    .orderBy(desc(schema.avatarGenerationRequests.createdAt))
    .limit(1))[0];
}

async function checkAvatarGenerationQuota(
  db: DatabaseExecutor,
  userId: string,
  userRoles: readonly string[] | undefined,
  options: Pick<AvatarGenerationOptions, "now">,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (userRoles?.includes("sysop") || await userHasRole(db, userId, "sysop")) {
    return { ok: true };
  }

  const lifetimeQuota = readPositiveIntEnv("INFLUENCE_AVATAR_GENERATION_FREE_QUOTA", DEFAULT_FREE_QUOTA);
  const dailyLimit = readPositiveIntEnv("INFLUENCE_AVATAR_GENERATION_DAILY_LIMIT", DEFAULT_DAILY_LIMIT);
  const countedStatuses: AvatarGenerationStatus[] = ["queued", "processing", "completed", "failed"];
  const since = new Date((options.now?.() ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [counts] = await db
    .select({
      lifetime: sql<number>`count(*)::int`,
      daily: sql<number>`count(*) filter (where ${schema.avatarGenerationRequests.createdAt} >= ${since})::int`,
    })
    .from(schema.avatarGenerationRequests)
    .where(and(
      eq(schema.avatarGenerationRequests.userId, userId),
      eq(schema.avatarGenerationRequests.purpose, AVATAR_GENERATION_PURPOSE),
      inArray(schema.avatarGenerationRequests.status, countedStatuses),
    ));
  if ((counts?.lifetime ?? 0) >= lifetimeQuota) {
    return {
      ok: false,
      code: "quota_exhausted",
      message: "Avatar generation quota exhausted.",
    };
  }

  if ((counts?.daily ?? 0) >= dailyLimit) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Avatar generation daily limit reached.",
    };
  }

  return { ok: true };
}

async function userHasRole(db: DatabaseExecutor, userId: string, roleName: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.addressRoles, sql`lower(${schema.users.walletAddress}) = ${schema.addressRoles.walletAddress}`)
    .innerJoin(schema.roles, eq(schema.addressRoles.roleId, schema.roles.id))
    .where(and(
      eq(schema.users.id, userId),
      eq(schema.roles.name, roleName),
    ))
    .limit(1);

  return Boolean(row);
}

async function claimGenerationProviderWork(
  db: AvatarGenerationWriteDB,
  request: AvatarGenerationRequestRow,
  options: Pick<AvatarGenerationOptions, "now">,
): Promise<
  | { action: "submit"; request: AvatarGenerationRequestRow; providerRequestId: null }
  | { action: "poll"; request: AvatarGenerationRequestRow; providerRequestId: string }
  | { action: "wait"; request: AvatarGenerationRequestRow }
> {
  if (request.providerRequestId) {
    return { action: "poll", request, providerRequestId: request.providerRequestId };
  }

  if (request.status === "queued") {
    const [claimed] = await db
      .update(schema.avatarGenerationRequests)
      .set({
        status: "processing",
        updatedAt: isoNow(options),
      })
      .where(and(
        eq(schema.avatarGenerationRequests.id, request.id),
        eq(schema.avatarGenerationRequests.status, "queued"),
        isNull(schema.avatarGenerationRequests.providerRequestId),
      ))
      .returning();

    if (claimed) {
      return { action: "submit", request: claimed, providerRequestId: null };
    }

    return generationClaimInProgress(db, request.id);
  }

  if (request.status === "processing" && isStaleActiveGeneration(request, options)) {
    const [claimed] = await db
      .update(schema.avatarGenerationRequests)
      .set({ updatedAt: isoNow(options) })
      .where(and(
        eq(schema.avatarGenerationRequests.id, request.id),
        eq(schema.avatarGenerationRequests.status, "processing"),
        eq(schema.avatarGenerationRequests.updatedAt, request.updatedAt),
        isNull(schema.avatarGenerationRequests.providerRequestId),
      ))
      .returning();

    if (claimed) {
      return { action: "submit", request: claimed, providerRequestId: null };
    }
  }

  return generationClaimInProgress(db, request.id);
}

async function generationClaimInProgress(
  db: AvatarGenerationWriteDB,
  generationRequestId: string,
): Promise<
  | { action: "poll"; request: AvatarGenerationRequestRow; providerRequestId: string }
  | { action: "wait"; request: AvatarGenerationRequestRow }
> {
  const current = await requireGenerationRequest(db, generationRequestId);
  return current.providerRequestId
    ? { action: "poll", request: current, providerRequestId: current.providerRequestId }
    : { action: "wait", request: current };
}

async function insertTerminalGeneration(
  db: DatabaseExecutor,
  input: AvatarCompletionInput,
  status: "skipped" | "failed",
  failureCode: string,
  failureMessage: string,
  options: Pick<AvatarGenerationOptions, "now">,
  safeMetadata: Record<string, unknown> = {},
): Promise<AvatarGenerationRequestRow> {
  const now = isoNow(options);
  const [row] = await db.insert(schema.avatarGenerationRequests).values({
    id: randomUUID(),
    userId: input.userId,
    agentProfileId: input.agentProfileId,
    purpose: AVATAR_GENERATION_PURPOSE,
    status,
    triggerSource: input.triggerSource,
    provider: KATANA_PROVIDER,
    model: KATANA_MODEL,
    estimatedCostMicrousd: ESTIMATED_GEN_COST_MICROUSD,
    failureCode,
    failureMessage,
    safeMetadata: { reason: failureCode, ...safeMetadata },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  }).returning();
  return requireReturnedRow(row, "Failed to create skipped avatar generation request");
}

async function updateGenerationRequest(
  db: AvatarGenerationWriteDB,
  id: string,
  values: Partial<typeof schema.avatarGenerationRequests.$inferInsert>,
  options: Pick<AvatarGenerationOptions, "now">,
): Promise<AvatarGenerationRequestRow> {
  const [updated] = await db
    .update(schema.avatarGenerationRequests)
    .set({
      ...values,
      updatedAt: isoNow(options),
    })
    .where(eq(schema.avatarGenerationRequests.id, id))
    .returning();
  return requireReturnedRow(updated, `Failed to update avatar generation request: ${id}`);
}

function requireReturnedRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

async function requireGenerationRequest(db: AvatarGenerationReadDB, id: string): Promise<AvatarGenerationRequestRow> {
  const row = (await db
    .select()
    .from(schema.avatarGenerationRequests)
    .where(eq(schema.avatarGenerationRequests.id, id))
    .limit(1))[0];
  if (!row) throw new Error(`Avatar generation request not found: ${id}`);
  return row;
}

async function requireOwnedAgentProfile(
  db: AvatarGenerationReadDB,
  userId: string,
  agentProfileId: string,
): Promise<AgentProfileRow> {
  const row = (await db
    .select()
    .from(schema.agentProfiles)
    .where(and(
      eq(schema.agentProfiles.id, agentProfileId),
      eq(schema.agentProfiles.userId, userId),
    ))
    .limit(1))[0];
  if (!row) throw new Error("Agent profile not found.");
  return row;
}

async function submitKatanaGeneration(
  fetchImpl: typeof fetch,
  config: { key: string; secret: string },
  prompt: string,
): Promise<{ requestId: string | null; status: string | null }> {
  const envelope = await katanaFetch(fetchImpl, config, "/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify({
      requests: [{
        type: "image",
        model: KATANA_MODEL,
        prompt,
        negative_prompt: "text, logo, watermark, blurry, low quality, distorted face, extra limbs",
        aspect_ratio: "1:1",
        output_format: "webp",
      }],
    }),
  });
  if (envelope.status === "failed" || envelope.status === "rejected") {
    const error = envelope.responses?.[0]?.error;
    throw new AvatarGenerationFailure(error?.code ?? "provider_rejected", error?.message ?? "Katana rejected avatar generation.");
  }
  return {
    requestId: envelope.request_id ?? null,
    status: envelope.status ?? null,
  };
}

async function pollKatanaGeneration(
  fetchImpl: typeof fetch,
  config: { key: string; secret: string },
  requestId: string,
  options: AvatarGenerationOptions,
): Promise<KatanaGenerationEnvelope> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const fallbackDelay = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const envelope = await katanaFetch(fetchImpl, config, `/v1/generation-requests/${encodeURIComponent(requestId)}`);
    if (envelope.status === "completed" || envelope.status === "partial_failure") {
      return envelope;
    }
    if (envelope.status === "failed" || envelope.status === "rejected") {
      const error = envelope.responses?.[0]?.error;
      throw new AvatarGenerationFailure(error?.code ?? "provider_failed", error?.message ?? "Katana avatar generation failed.", error?.retryable);
    }
    const delay = Math.max(1, envelope.poll_after_seconds ?? fallbackDelay / 1000) * 1000;
    await sleep(delay);
  }

  throw new AvatarGenerationFailure("provider_timeout", "Katana avatar generation did not complete before the local timeout.", true);
}

async function katanaFetch(
  fetchImpl: typeof fetch,
  config: { key: string; secret: string },
  path: string,
  init: RequestInit = {},
): Promise<KatanaGenerationEnvelope> {
  const response = await fetchImpl(`${KATANA_BASE_URL}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(KATANA_REQUEST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.key,
      "X-API-Secret": config.secret,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as KatanaGenerationEnvelope : {};
  if (!response.ok) {
    throw new AvatarGenerationFailure("provider_http_error", `Katana request failed with HTTP ${response.status}.`);
  }
  return body;
}

function selectOutputAsset(envelope: KatanaGenerationEnvelope): NonNullable<NonNullable<KatanaGenerationEnvelope["responses"]>[number]["output_assets"]>[number] | null {
  for (const response of envelope.responses ?? []) {
    const asset = response.output_assets?.find((candidate) => candidate.original_data_url || candidate.url);
    if (asset) return asset;
  }
  return null;
}

async function downloadImage(fetchImpl: typeof fetch, url: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const assetUrl = validateProviderAssetUrl(url);
  const response = await fetchImpl(assetUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(AVATAR_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new AvatarGenerationFailure("image_download_failed", `Generated avatar download failed with HTTP ${response.status}.`);
  }
  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  if (!contentType) {
    throw new AvatarGenerationFailure("unsupported_image_content_type", "Generated avatar download returned an unsupported image content type.");
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_DOWNLOAD_BYTES) {
    throw new AvatarGenerationFailure("image_too_large", "Generated avatar image exceeds the 2 MB size limit.");
  }
  return {
    body: await readBoundedImageBody(response),
    contentType,
  };
}

function validateProviderAssetUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AvatarGenerationFailure("invalid_asset_url", "Generated avatar asset URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new AvatarGenerationFailure("invalid_asset_url", "Generated avatar asset URL must use HTTPS.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = providerAssetHosts();
  const allowed = allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) {
    throw new AvatarGenerationFailure("untrusted_asset_url", "Generated avatar asset URL host is not trusted.");
  }
  return parsed;
}

function providerAssetHosts(): string[] {
  const configured = process.env.INFLUENCE_AVATAR_GENERATION_ASSET_HOSTS
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_PROVIDER_ASSET_HOSTS;
}

async function readBoundedImageBody(response: Response): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_AVATAR_DOWNLOAD_BYTES) {
      throw new AvatarGenerationFailure("image_too_large", "Generated avatar image exceeds the 2 MB size limit.");
    }
    return body;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AVATAR_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new AvatarGenerationFailure("image_too_large", "Generated avatar image exceeds the 2 MB size limit.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer as ArrayBuffer;
}

function generatedAvatarKey(
  userId: string,
  agentProfileId: string,
  generationRequestId: string,
  contentType: string,
): string {
  const ext = contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "png";
  return `pfp/generated/${safeKeySegment(userId)}/${safeKeySegment(agentProfileId)}/${safeKeySegment(generationRequestId)}.${ext}`;
}

function normalizeImageContentType(value: string | null): string | null {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();
  if (contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp") {
    return contentType;
  }
  return null;
}

function generationRead(row: AvatarGenerationRequestRow): AvatarCompletionRead {
  const status = row.status === "queued" ? "accepted" : row.status;
  const metadata = isRecord(row.safeMetadata) ? row.safeMetadata : {};
  const failureStage = isAvatarGenerationStage(metadata.stage) ? metadata.stage : undefined;
  const retryable = typeof metadata.retryable === "boolean" ? metadata.retryable : undefined;
  return {
    status,
    generationRequestId: row.id,
    avatarUrl: typeof metadata.avatarUrl === "string" ? metadata.avatarUrl : undefined,
    failureCode: row.failureCode ?? undefined,
    failureStage,
    retryable,
    profileFingerprint: typeof metadata.profileFingerprint === "string" ? metadata.profileFingerprint : undefined,
    reason: row.failureMessage ?? undefined,
  };
}

function readDraftProfile(request: AvatarGenerationRequestRow): AvatarPromptProfile | null {
  const metadata = isRecord(request.safeMetadata) ? request.safeMetadata : {};
  const value = metadata.draftProfile;
  if (!isRecord(value)
    || typeof value.name !== "string"
    || typeof value.personality !== "string"
    || !(value.gender === null || isAgentGender(value.gender))) {
    return null;
  }
  return {
    name: value.name,
    avatarUrl: null,
    gender: value.gender,
    backstory: typeof value.backstory === "string" ? value.backstory : null,
    personality: value.personality,
    strategyStyle: typeof value.strategyStyle === "string" ? value.strategyStyle : null,
    personaKey: typeof value.personaKey === "string" ? value.personaKey : null,
  };
}

function mergeSafeMetadata(
  current: AvatarGenerationRequestRow["safeMetadata"],
  additions: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isRecord(current) ? current : {}),
    ...additions,
  };
}

function isStaleActiveGeneration(
  row: AvatarGenerationRequestRow,
  options: Pick<AvatarGenerationOptions, "now">,
): boolean {
  const updatedAt = Date.parse(row.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return (options.now?.() ?? new Date()).getTime() - updatedAt > ACTIVE_GENERATION_STALE_MS;
}

function getKatanaConfig(): { key: string; secret: string } | null {
  const key = process.env.API_KAT_IMGNAI_KEY?.trim();
  const secret = process.env.API_KAT_IMGNAI_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isoNow(options: Pick<AvatarGenerationOptions, "now">): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function scrubPromptField(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 800);
}

function safeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sanitizeFailureCode(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 80);
  return sanitized || "avatar_generation_failed";
}

function displayFailureMessage(code: string): string {
  switch (code) {
    case "provider_not_configured":
      return "Katana avatar generation is not configured.";
    case "avatar_already_provided":
      return "Agent already has an avatar.";
    case "quota_exhausted":
      return "Avatar generation quota exhausted.";
    case "rate_limited":
      return "Avatar generation daily limit reached.";
    case "provider_submit_failed":
      return "Could not start Katana avatar generation.";
    case "provider_poll_failed":
      return "Could not check Katana avatar generation status.";
    case "provider_http_error":
      return "Katana avatar generation request failed.";
    case "provider_rejected":
      return "Katana rejected avatar generation.";
    case "provider_failed":
      return "Katana avatar generation failed.";
    case "provider_timeout":
      return "Avatar generation did not complete before the local timeout.";
    case "missing_output_asset":
      return "Katana completed without returning an avatar image.";
    case "unsupported_image_content_type":
      return "Generated avatar download returned an unsupported image content type.";
    case "image_download_failed":
      return "Generated avatar image could not be downloaded.";
    case "image_too_large":
      return "Generated avatar image exceeds the 2 MB size limit.";
    case "untrusted_asset_url":
    case "invalid_asset_url":
      return "Generated avatar asset URL was rejected.";
    case "avatar_storage_failed":
      return "Generated avatar image could not be saved.";
    case "profile_update_failed":
      return "Generated avatar image could not be assigned to the agent.";
    default:
      return "Avatar generation failed.";
  }
}

class AvatarGenerationFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AvatarGenerationFailure";
  }
}

function normalizeGenerationFailure(error: unknown, stage: AvatarGenerationStage): { code: string; message: string; retryable: boolean; stage: AvatarGenerationStage } {
  if (error instanceof AvatarGenerationFailure) {
    const code = sanitizeFailureCode(error.code);
    return {
      code,
      message: displayFailureMessage(code),
      retryable: error.retryable,
      stage,
    };
  }
  const code = failureCodeForStage(stage);
  return {
    code,
    message: displayFailureMessage(code),
    retryable: isRetryableStage(stage),
    stage,
  };
}

function failureCodeForStage(stage: AvatarGenerationStage): string {
  switch (stage) {
    case "provider_submit":
      return "provider_submit_failed";
    case "provider_poll":
      return "provider_poll_failed";
    case "asset_select":
      return "missing_output_asset";
    case "asset_download":
      return "image_download_failed";
    case "avatar_store":
      return "avatar_storage_failed";
    case "profile_update":
      return "profile_update_failed";
  }
}

function isRetryableStage(stage: AvatarGenerationStage): boolean {
  return stage === "provider_submit"
    || stage === "provider_poll"
    || stage === "asset_download"
    || stage === "avatar_store";
}

function isAvatarGenerationStage(value: unknown): value is AvatarGenerationStage {
  return value === "provider_submit"
    || value === "provider_poll"
    || value === "asset_select"
    || value === "asset_download"
    || value === "avatar_store"
    || value === "profile_update";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logAvatarGenerationFailure(input: {
  error: unknown;
  failure: { code: string; message: string; retryable: boolean; stage: AvatarGenerationStage };
  generationRequestId: string;
  agentProfileId: string;
  userId: string;
  providerRequestId: string | null;
  providerStatus: string | null;
}): void {
  const error = input.error instanceof Error
    ? { name: input.error.name, message: input.error.message, stack: input.error.stack }
    : { name: typeof input.error, message: String(input.error) };
  console.warn("[avatar-generation] Failed to complete avatar generation", {
    generationRequestId: input.generationRequestId,
    agentProfileId: input.agentProfileId,
    userId: input.userId,
    providerRequestId: input.providerRequestId,
    providerStatus: input.providerStatus,
    failureCode: input.failure.code,
    failureStage: input.failure.stage,
    retryable: input.failure.retryable,
    error,
  });
}
