import { randomUUID } from "crypto";
import { isReservedHouseAgentName } from "@influence/engine";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { AvatarChangeSource, AvatarGenerationTriggerSource } from "../db/schema.js";
import { isAgentGender, type AgentGender } from "../lib/agent-gender.js";
import { normalizeUploadedAvatarUrl } from "../lib/storage.js";
import {
  consumeOwnedDraftAvatarCompletion,
  recordAvatarChange,
  requestAndStartAvatarCompletion,
  type AvatarCompletionRead,
  type AvatarPromptProfile,
} from "./avatar-generation.js";
import {
  formatUserSelectableAgentArchetypeKeys,
  getUserSelectableAgentArchetype,
  isUserSelectableAgentArchetype,
  type AgentArchetypeKey,
} from "./agent-archetypes.js";
import {
  ensureActiveAgentRevisionInTransaction,
  resolveFreeTrackEffectiveRuntimeSnapshot,
  type EnsuredAgentRevision,
} from "./agent-revisions.js";
import {
  AGENT_MUTATION_RECEIPT_SCHEMA_VERSION,
  boundAgentMutationWaitingSeatReferences,
  type AgentMutationProfileRevisionReceipt,
  type AgentMutationReceipt,
  type AgentMutationWaitingSeatReference,
} from "./agent-mutation-receipt.js";
import {
  lockRosterGamesInTransaction,
  OwnedSeatProjectionError,
  reconcileOwnedProfileSeatsInLockedGame,
} from "./owned-seat-projection.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type DatabaseExecutor = DrizzleDB | DrizzleTransaction;

const DEFAULT_AGENT_LIMIT = 50;
const MAX_AGENT_LIMIT = 100;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_PERSONALITY_PROMPT_LENGTH = 8_000;
const MAX_PUBLIC_BIOGRAPHY_LENGTH = 2_000;
const MAX_STRATEGY_STYLE_LENGTH = 2_000;
const AGENT_NAME_UNIQUE_INDEX = "agent_profiles_normalized_name_unique";
const AGENT_NAME_TAKEN_MESSAGE = "That agent name is already in use. Choose another name.";

const CREATE_AGENT_FIELDS = new Set([
  "displayName",
  "archetype",
  "personalityPrompt",
  "publicBiography",
  "strategyStyle",
  "gender",
  "avatarUrl",
]);

const UPDATE_AGENT_FIELDS = new Set([
  "agentId",
  "displayName",
  "archetype",
  "personalityPrompt",
  "publicBiography",
  "strategyStyle",
  "gender",
  "avatarUrl",
]);

const IMMUTABLE_AGENT_FIELDS = new Set([
  "id",
  "userId",
  "ownerId",
  "agentProfileId",
  "createdAt",
  "updatedAt",
  "gamesPlayed",
  "gamesWon",
  "stats",
  "rating",
  "statsReset",
]);

export type AgentProfileManagementErrorCode =
  | "agent_not_found"
  | "account_not_found"
  | "invalid_agent_input"
  | "invalid_archetype"
  | "immutable_field"
  | "agent_name_taken"
  | "waiting_roster_name_conflict"
  | "agent_update_reconciliation_failed"
  | "agent_update_conflict"
  | "account_limit_reached";

export class AgentProfileManagementError extends Error {
  constructor(
    public readonly code: AgentProfileManagementErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentProfileManagementError";
  }
}

export type ParsedAgentAvatarUrl =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string };

export interface AgentProfileManagementContext {
  userId: string;
  publicBaseUrl?: string;
  avatarCompletion?: {
    triggerSource: AvatarGenerationTriggerSource;
    processImmediately?: boolean;
    /** Internal service collaborator override; never populated from request input. */
    request?: typeof requestAndStartAvatarCompletion;
  };
  avatarChangeSource?: AvatarChangeSource;
  avatarGenerationRequestId?: string;
}

export interface ListOwnedAgentsInput extends AgentProfileManagementContext {
  limit?: number;
}

export interface GetOwnedAgentInput extends AgentProfileManagementContext {
  agentId: string;
}

export interface SearchOwnedAgentsInput extends AgentProfileManagementContext {
  query: string;
  limit?: number;
}

export type CreateOwnedAgentInput = Record<string, unknown>;
export type UpdateOwnedAgentInput = Record<string, unknown>;

export interface CreateAgentProfileMutationInput {
  name: unknown;
  personality: unknown;
  backstory?: unknown;
  strategyStyle?: unknown;
  personaKey?: unknown;
  gender?: unknown;
  avatarUrl?: unknown;
}

export interface UpdateAgentProfileMutationInput {
  name?: unknown;
  personality?: unknown;
  backstory?: unknown;
  strategyStyle?: unknown;
  personaKey?: unknown;
  gender?: unknown;
  avatarUrl?: unknown;
}

export interface AgentProfileMutationRead {
  profile: typeof schema.agentProfiles.$inferSelect;
  revisionCreated: boolean;
  profileRevision: AgentProfileRevisionMutationRead;
  receipt: AgentMutationReceipt;
}

export interface AgentProfileRevisionMutationRead extends AgentMutationProfileRevisionReceipt {
  ratingRecalibrated: boolean;
}

export type DraftAvatarAdoptionResult =
  | { ok: true; result: AgentProfileMutationRead; completion: AvatarCompletionRead }
  | { ok: false; reason: "not_found" | "pending" | "profile_changed" | "already_consumed" };

export interface AccountRatingSummary {
  kind: "account-level-free-track";
  currentElo: number;
  peakElo: number;
  accountGamesPlayed: number;
  accountWins: number;
  agentEloAvailable: false;
}

export interface AgentStatsSummary {
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

export interface AgentQueueStateSummary {
  dailyFree: "queued" | "not-queued";
  joinedAt?: string;
  eligibility?: "eligible" | "temporarily-ineligible";
  currentGame?: AgentActiveEnrollmentSummary;
}

export interface AgentActiveEnrollmentSummary {
  gameId: string;
  slug: string;
  status: "waiting" | "in_progress" | "suspended";
  queueType: "daily-free" | "open-game";
}

export interface AgentSummary {
  id: string;
  displayName: string;
  archetype: AgentArchetypeKey | null;
  archetypeLabel: string | null;
  publicBiography: string | null;
  personalityPrompt: string;
  strategyStyle: string | null;
  gender: AgentGender | null;
  avatarUrl: string | null;
  stats: AgentStatsSummary;
  rating: AccountRatingSummary;
  queueState: AgentQueueStateSummary;
  activeEnrollment: AgentActiveEnrollmentSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListRead {
  schemaVersion: 1;
  accountRating: AccountRatingSummary;
  agents: AgentSummary[];
}

export interface AgentRead {
  schemaVersion: 1;
  accountRating: AccountRatingSummary;
  agent: AgentSummary;
}

export interface AgentCommandRead extends AgentRead {
  message: string;
  receipt: AgentMutationReceipt;
  avatarCompletion?: AvatarCompletionRead;
}

type AgentProfileRow = typeof schema.agentProfiles.$inferSelect;
type AccountRatingRow = Pick<
  typeof schema.users.$inferSelect,
  "rating" | "peakRating" | "gamesPlayed" | "gamesWon"
>;

interface EnrollmentRow {
  agentProfileId: string | null;
  gameId: string;
  slug: string;
  status: string;
  trackType: string;
  createdAt: string;
}

export function normalizeAgentAvatarUrlInput(
  value: unknown,
  publicBaseUrl?: string,
): ParsedAgentAvatarUrl {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "avatarUrl must be a string or null" };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };

  return {
    ok: true,
    value: normalizeUploadedAvatarUrl(trimmed, publicBaseUrl),
  };
}

export async function listOwnedAgents(
  db: DrizzleDB,
  input: ListOwnedAgentsInput,
): Promise<AgentListRead> {
  const accountRating = await getAccountRating(db, input.userId);
  const profiles = await db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.userId, input.userId))
    .orderBy(desc(schema.agentProfiles.updatedAt))
    .limit(clampLimit(input.limit, DEFAULT_AGENT_LIMIT, MAX_AGENT_LIMIT));

  const serialization = await loadAgentSerializationContext(db, input.userId, profiles, accountRating);
  return {
    schemaVersion: 1,
    accountRating,
    agents: profiles.map((profile) => serializeAgent(profile, serialization)),
  };
}

export async function getOwnedAgent(
  db: DatabaseExecutor,
  input: GetOwnedAgentInput,
): Promise<AgentRead> {
  const accountRating = await getAccountRating(db, input.userId);
  const profile = await requireOwnedAgentProfile(db, input.userId, input.agentId);
  const serialization = await loadAgentSerializationContext(db, input.userId, [profile], accountRating);
  return {
    schemaVersion: 1,
    accountRating,
    agent: serializeAgent(profile, serialization),
  };
}

export async function searchOwnedAgents(
  db: DrizzleDB,
  input: SearchOwnedAgentsInput,
): Promise<AgentListRead & { query: string }> {
  const accountRating = await getAccountRating(db, input.userId);
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return {
      schemaVersion: 1,
      query: input.query,
      accountRating,
      agents: [],
    };
  }

  const profiles = await db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.userId, input.userId))
    .orderBy(desc(schema.agentProfiles.updatedAt));

  const matchingProfiles = profiles
    .filter((profile) => agentProfileMatches(profile, normalizedQuery))
    .slice(0, clampLimit(input.limit, DEFAULT_AGENT_LIMIT, MAX_AGENT_LIMIT));

  const serialization = await loadAgentSerializationContext(db, input.userId, matchingProfiles, accountRating);
  return {
    schemaVersion: 1,
    query: input.query,
    accountRating,
    agents: matchingProfiles.map((profile) => serializeAgent(profile, serialization)),
  };
}

function prepareAgentProfileCreate(
  context: AgentProfileManagementContext,
  input: CreateAgentProfileMutationInput,
): typeof schema.agentProfiles.$inferInsert {
  const name = requiredStringField(input.name, "name", MAX_DISPLAY_NAME_LENGTH);
  assertAgentNameNotReserved(name);
  const personality = requiredStringField(
    input.personality,
    "personality",
    MAX_PERSONALITY_PROMPT_LENGTH,
  );
  const backstory = input.backstory === undefined
    ? null
    : optionalStringField(input.backstory, "backstory", MAX_PUBLIC_BIOGRAPHY_LENGTH);
  const strategyStyle = input.strategyStyle === undefined
    ? null
    : optionalStringField(input.strategyStyle, "strategyStyle", MAX_STRATEGY_STYLE_LENGTH);
  const personaKey = input.personaKey === undefined || input.personaKey === null
    ? null
    : optionalArchetype(input.personaKey);
  const gender = optionalAgentGender(input.gender);
  const avatarUrl = normalizeAgentAvatarUrlInput(input.avatarUrl, context.publicBaseUrl);
  if (!avatarUrl.ok) {
    throw new AgentProfileManagementError("invalid_agent_input", avatarUrl.error, 400);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    userId: context.userId,
    name,
    backstory,
    personality,
    strategyStyle,
    personaKey,
    gender,
    avatarUrl: avatarUrl.value ?? null,
    gamesPlayed: 0,
    gamesWon: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function createAgentProfileInTransaction(
  tx: DrizzleTransaction,
  values: typeof schema.agentProfiles.$inferInsert,
): Promise<AgentProfileMutationRead> {
  const profile = (await tx.insert(schema.agentProfiles).values(values).returning())[0];
  if (!profile) throw new Error("Agent profile insert returned no row");
  const revision = await ensureActiveAgentRevisionInTransaction(tx, {
    profile,
    effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile),
    trigger: "profile_create",
  });
  return profileMutationRead(profile, revision, emptyMutationReceipt(profile.id, revision, "created"));
}

export async function createOwnedAgentProfile(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  input: CreateAgentProfileMutationInput,
): Promise<AgentProfileMutationRead> {
  await getAccountRating(db, context.userId);
  const values = prepareAgentProfileCreate(context, input);
  let result: AgentProfileMutationRead;
  try {
    result = await db.transaction(async (tx) => {
      const created = await createAgentProfileInTransaction(tx, values);
      if (created.profile.avatarUrl) {
        await recordAvatarChange(tx, {
          userId: context.userId,
          agentProfileId: created.profile.id,
          source: context.avatarChangeSource ?? "mcp_provided_avatar",
          status: "completed",
          generationRequestId: context.avatarGenerationRequestId,
          previousAvatarUrl: null,
          newAvatarUrl: created.profile.avatarUrl,
        });
      }
      return created;
    });
  } catch (error) {
    throw mapAgentNameConflict(error);
  }
  return result;
}

export async function adoptOwnedDraftAvatarAndCreateAgentProfile(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  generationRequestId: string,
  draftProfile: AvatarPromptProfile,
  input: CreateAgentProfileMutationInput,
): Promise<DraftAvatarAdoptionResult> {
  await getAccountRating(db, context.userId);
  const values = prepareAgentProfileCreate(context, input);

  try {
    return await db.transaction(async (tx) => {
      const consumed = await consumeOwnedDraftAvatarCompletion(tx, {
        userId: context.userId,
        generationRequestId,
        profile: draftProfile,
      });
      if (!consumed.ok) return consumed;

      const completion = consumed.completion;
      const avatarUrl = completion.avatarUrl ?? null;
      const result = await createAgentProfileInTransaction(tx, { ...values, avatarUrl });
      if (avatarUrl) {
        await recordAvatarChange(tx, {
          userId: context.userId,
          agentProfileId: result.profile.id,
          source: "web_generated_completion",
          status: "completed",
          generationRequestId,
          previousAvatarUrl: null,
          newAvatarUrl: avatarUrl,
        });
      }
      return { ok: true, result, completion };
    });
  } catch (error) {
    throw mapAgentNameConflict(error);
  }
}

export async function updateOwnedAgentProfile(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  agentId: string,
  input: UpdateAgentProfileMutationInput,
): Promise<AgentProfileMutationRead> {
  // Keep foreign roster rows out of the candidate lock set. Ownership remains
  // authoritative under the profile lock inside each transaction attempt.
  await requireOwnedAgentProfile(db, context.userId, agentId);
  const MAX_UPDATE_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const candidateGames = await findWaitingFollowerGames(db, agentId);
    try {
      return await db.transaction(async (tx) => updateAgentProfileInTransaction(tx, {
        context,
        agentId,
        input,
        candidateGames,
      }));
    } catch (error) {
      if (error instanceof ExpandedWaitingGameSetError) {
        if (attempt < MAX_UPDATE_ATTEMPTS) continue;
        throw new AgentProfileManagementError(
          "agent_update_conflict",
          "The agent's waiting-game enrollment changed during the update. Try again.",
          409,
          undefined,
          true,
        );
      }
      throw mapAgentNameConflict(error);
    }
  }
  throw new Error("Agent profile update attempts exhausted unexpectedly");
}

async function updateAgentProfileInTransaction(
  tx: DrizzleTransaction,
  input: {
    context: AgentProfileManagementContext;
    agentId: string;
    input: UpdateAgentProfileMutationInput;
    candidateGames: WaitingFollowerGame[];
  },
): Promise<AgentProfileMutationRead> {
  const lockedGames = await lockRosterGamesInTransaction(
    tx,
    input.candidateGames.map((game) => game.id),
  );
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${input.agentId}
    FOR UPDATE
  `);
  const existing = await requireOwnedAgentProfile(tx, input.context.userId, input.agentId);
  const updates = prepareAgentProfileUpdates(input.context, input.input, existing);
  const profile = (await tx.update(schema.agentProfiles)
    .set(updates)
    .where(and(
      eq(schema.agentProfiles.id, input.agentId),
      eq(schema.agentProfiles.userId, input.context.userId),
    ))
    .returning())[0];
  if (!profile) {
    throw new AgentProfileManagementError("agent_not_found", "Agent not found.", 404, {
      agentId: input.agentId,
    });
  }
  const revision = await ensureActiveAgentRevisionInTransaction(tx, {
    profile,
    effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile),
    trigger: "profile_edit",
  });

  const references: AgentMutationWaitingSeatReference[] = [];
  for (const game of lockedGames) {
    if (game.status === "waiting" && !game.startedAt) {
      try {
        const reconciliations = await reconcileOwnedProfileSeatsInLockedGame(tx, {
          game,
          userId: input.context.userId,
          agentProfileId: input.agentId,
        });
        references.push(...reconciliations.map((reconciliation) => ({
          gameId: game.id,
          slug: game.slug,
          disposition: reconciliation.disposition,
          effectiveRevisionId: reconciliation.seat.agentRevisionId,
        })));
      } catch (error) {
        throw mapWaitingReconciliationError(error, game);
      }
      continue;
    }

    const crossedSeats = await tx.select().from(schema.gamePlayers).where(and(
      eq(schema.gamePlayers.gameId, game.id),
      eq(schema.gamePlayers.agentProfileId, input.agentId),
    ));
    references.push(...crossedSeats.map((seat) => ({
      gameId: game.id,
      slug: game.slug,
      disposition: "crossed_freeze" as const,
      effectiveRevisionId: seat.agentRevisionId,
    })));
  }

  const currentWaitingGames = await findWaitingFollowerGames(tx, input.agentId);
  const lockedGameIds = new Set(input.candidateGames.map((game) => game.id));
  if (currentWaitingGames.some((game) => !lockedGameIds.has(game.id))) {
    throw new ExpandedWaitingGameSetError();
  }

  if (input.input.avatarUrl !== undefined && profile.avatarUrl !== existing.avatarUrl) {
    await recordAvatarChange(tx, {
      userId: input.context.userId,
      agentProfileId: input.agentId,
      source: input.context.avatarChangeSource ?? "mcp_update",
      status: "completed",
      generationRequestId: input.context.avatarGenerationRequestId,
      previousAvatarUrl: existing.avatarUrl,
      newAvatarUrl: profile.avatarUrl,
    });
  }

  const [standingMembership, frozenSeatCount] = await Promise.all([
    tx.select({ id: schema.freeGameQueue.id }).from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.agentProfileId, input.agentId)).limit(1),
    tx.select({ count: sql<number>`count(*)::int` }).from(schema.gamePlayers)
      .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
      .where(and(
        eq(schema.gamePlayers.agentProfileId, input.agentId),
        inArray(schema.games.status, ["in_progress", "suspended"]),
      )),
  ]);
  references.sort((left, right) => left.gameId.localeCompare(right.gameId));
  const boundedReferences = boundAgentMutationWaitingSeatReferences(references);
  const receipt: AgentMutationReceipt = {
    schemaVersion: AGENT_MUTATION_RECEIPT_SCHEMA_VERSION,
    operation: "updated",
    agent: {
      agentProfileId: input.agentId,
      identityDisposition: "preserved",
    },
    profileRevision: profileRevisionReceipt(revision),
    dailyFree: standingMembership.length > 0
      ? "preserved_follows_profile"
      : "not_enrolled",
    waitingSeats: {
      total: references.length,
      reconciled: references.filter((reference) => reference.disposition === "reconciled").length,
      alreadyCurrent: references.filter((reference) => reference.disposition === "already_current").length,
      crossedFreeze: references.filter((reference) => reference.disposition === "crossed_freeze").length,
      ...boundedReferences,
    },
    frozenSeats: { unchanged: frozenSeatCount[0]?.count ?? 0 },
    warnings: [],
  };
  return profileMutationRead(profile, revision, receipt);
}

function prepareAgentProfileUpdates(
  context: AgentProfileManagementContext,
  input: UpdateAgentProfileMutationInput,
  existing: AgentProfileRow,
): Partial<typeof schema.agentProfiles.$inferInsert> {
  const updates: Partial<typeof schema.agentProfiles.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.name !== undefined) {
    updates.name = requiredStringField(input.name, "name", MAX_DISPLAY_NAME_LENGTH);
    if (normalizeSavedAgentName(updates.name) !== normalizeSavedAgentName(existing.name)) {
      assertAgentNameNotReserved(updates.name);
    }
  }
  if (input.personality !== undefined) {
    updates.personality = requiredStringField(
      input.personality,
      "personality",
      MAX_PERSONALITY_PROMPT_LENGTH,
    );
  }
  if (input.backstory !== undefined) {
    updates.backstory = optionalStringField(input.backstory, "backstory", MAX_PUBLIC_BIOGRAPHY_LENGTH);
  }
  if (input.strategyStyle !== undefined) {
    updates.strategyStyle = optionalStringField(input.strategyStyle, "strategyStyle", MAX_STRATEGY_STYLE_LENGTH);
  }
  if (input.personaKey !== undefined) {
    updates.personaKey = input.personaKey === null ? null : optionalArchetype(input.personaKey);
  }
  if (input.gender !== undefined) {
    updates.gender = optionalAgentGender(input.gender);
  }
  if (input.avatarUrl !== undefined) {
    const avatarUrl = normalizeAgentAvatarUrlInput(input.avatarUrl, context.publicBaseUrl);
    if (!avatarUrl.ok) {
      throw new AgentProfileManagementError("invalid_agent_input", avatarUrl.error, 400);
    }
    updates.avatarUrl = avatarUrl.value ?? null;
  }
  return updates;
}

function profileMutationRead(
  profile: typeof schema.agentProfiles.$inferSelect,
  revision: EnsuredAgentRevision,
  receipt: AgentMutationReceipt,
): AgentProfileMutationRead {
  return {
    profile: { ...profile, currentRevisionId: revision.revision.id },
    revisionCreated: revision.created,
    profileRevision: {
      revisionId: revision.revision.id,
      ordinal: revision.revision.ordinal,
      outcome: revision.created ? "created" : "preserved",
      active: true,
      ratingRecalibrated: revision.ratingRecalibrated,
    },
    receipt,
  };
}

interface WaitingFollowerGame {
  id: string;
  slug: string;
}

class ExpandedWaitingGameSetError extends Error {
  constructor() {
    super("Waiting follower game set expanded during update");
    this.name = "ExpandedWaitingGameSetError";
  }
}

async function findWaitingFollowerGames(
  db: DatabaseExecutor,
  agentProfileId: string,
): Promise<WaitingFollowerGame[]> {
  const rows = await db.select({
    id: schema.games.id,
    slug: schema.games.slug,
  }).from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(and(
      eq(schema.gamePlayers.agentProfileId, agentProfileId),
      eq(schema.games.status, "waiting"),
    ))
    .orderBy(asc(schema.games.id));
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function profileRevisionReceipt(
  revision: EnsuredAgentRevision,
): AgentMutationProfileRevisionReceipt {
  return {
    revisionId: revision.revision.id,
    ordinal: revision.revision.ordinal,
    outcome: revision.created ? "created" : "preserved",
    active: true,
  };
}

function emptyMutationReceipt(
  agentProfileId: string,
  revision: EnsuredAgentRevision,
  operation: "created" | "updated",
): AgentMutationReceipt {
  return {
    schemaVersion: AGENT_MUTATION_RECEIPT_SCHEMA_VERSION,
    operation,
    agent: {
      agentProfileId,
      identityDisposition: operation === "created" ? "created" : "preserved",
    },
    profileRevision: profileRevisionReceipt(revision),
    dailyFree: "not_enrolled",
    waitingSeats: {
      total: 0,
      reconciled: 0,
      alreadyCurrent: 0,
      crossedFreeze: 0,
      games: [],
      truncatedCount: 0,
    },
    frozenSeats: { unchanged: 0 },
    warnings: [],
  };
}

function mapWaitingReconciliationError(
  error: unknown,
  game: Pick<typeof schema.games.$inferSelect, "id" | "slug">,
): unknown {
  if (!(error instanceof OwnedSeatProjectionError)) return error;
  const details = {
    games: [{ gameId: game.id, slug: game.slug }],
    truncatedCount: 0,
  };
  if (error.reason === "name_conflict") {
    return new AgentProfileManagementError(
      "waiting_roster_name_conflict",
      "That agent name is already in use in a waiting game. Choose another name.",
      409,
      details,
    );
  }
  return new AgentProfileManagementError(
    "agent_update_reconciliation_failed",
    "The agent could not be updated across its waiting games.",
    409,
    details,
  );
}

export async function createOwnedAgent(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  input: CreateOwnedAgentInput,
): Promise<AgentCommandRead> {
  rejectUnsupportedFields(input, CREATE_AGENT_FIELDS);

  const displayName = requiredStringField(input.displayName, "displayName", MAX_DISPLAY_NAME_LENGTH);
  const personalityPrompt = requiredStringField(
    input.personalityPrompt,
    "personalityPrompt",
    MAX_PERSONALITY_PROMPT_LENGTH,
  );
  const archetype = requiredArchetype(input.archetype);
  const publicBiography = optionalStringField(input.publicBiography, "publicBiography", MAX_PUBLIC_BIOGRAPHY_LENGTH);
  const strategyStyle = optionalStringField(input.strategyStyle, "strategyStyle", MAX_STRATEGY_STYLE_LENGTH);
  const avatarUrl = normalizeAgentAvatarUrlInput(input.avatarUrl, context.publicBaseUrl);
  if (!avatarUrl.ok) {
    throw new AgentProfileManagementError("invalid_agent_input", avatarUrl.error, 400);
  }

  const mutation = await createOwnedAgentProfile(db, context, {
    name: displayName,
    backstory: publicBiography,
    personality: personalityPrompt,
    strategyStyle,
    personaKey: archetype,
    gender: input.gender,
    avatarUrl: avatarUrl.value,
  });
  const { profile } = mutation;

  let receipt = mutation.receipt;
  let avatarCompletion: AvatarCompletionRead | {
    status: "already_provided";
    avatarUrl: string;
    reason: string;
  } | undefined;
  if (profile.avatarUrl) {
    avatarCompletion = {
      status: "already_provided",
      avatarUrl: profile.avatarUrl,
      reason: "Agent already has an avatar.",
    };
  } else {
    try {
      avatarCompletion = await maybeRequestAvatarCompletion(db, context, profile.id);
    } catch (error) {
      console.warn("[agent-profile-management] Failed to request automatic avatar generation:", error);
      receipt = addMutationWarning(receipt, "avatar_generation_failed");
    }
  }
  if (avatarCompletion) {
    receipt = { ...receipt, avatarCompletion };
    if (avatarCompletion.status === "failed") {
      receipt = addMutationWarning(receipt, "avatar_generation_failed");
    }
  }

  return {
    ...(await getOwnedAgent(db, { userId: context.userId, agentId: profile.id })),
    message: "Agent created.",
    receipt,
    ...(avatarCompletion && { avatarCompletion }),
  };
}

export async function updateOwnedAgent(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  input: UpdateOwnedAgentInput,
): Promise<AgentCommandRead> {
  rejectUnsupportedFields(input, UPDATE_AGENT_FIELDS);

  const agentId = requiredStringField(input.agentId, "agentId", 200);
  await requireOwnedAgentProfile(db, context.userId, agentId);
  const updates: UpdateAgentProfileMutationInput = {};

  if (input.displayName !== undefined) {
    updates.name = requiredStringField(input.displayName, "displayName", MAX_DISPLAY_NAME_LENGTH);
  }
  if (input.personalityPrompt !== undefined) {
    updates.personality = requiredStringField(
      input.personalityPrompt,
      "personalityPrompt",
      MAX_PERSONALITY_PROMPT_LENGTH,
    );
  }
  if (input.publicBiography !== undefined) {
    updates.backstory = optionalStringField(input.publicBiography, "publicBiography", MAX_PUBLIC_BIOGRAPHY_LENGTH);
  }
  if (input.strategyStyle !== undefined) {
    updates.strategyStyle = optionalStringField(input.strategyStyle, "strategyStyle", MAX_STRATEGY_STYLE_LENGTH);
  }
  if (input.archetype !== undefined) {
    updates.personaKey = optionalArchetype(input.archetype);
  }
  if (input.gender !== undefined) {
    updates.gender = optionalAgentGender(input.gender);
  }
  if (input.avatarUrl !== undefined) {
    const avatarUrl = normalizeAgentAvatarUrlInput(input.avatarUrl, context.publicBaseUrl);
    if (!avatarUrl.ok) {
      throw new AgentProfileManagementError("invalid_agent_input", avatarUrl.error, 400);
    }
    updates.avatarUrl = avatarUrl.value ?? null;
  }
  const mutation = await updateOwnedAgentProfile(db, context, agentId, updates);
  let receipt = mutation.receipt;
  let avatarCompletion: AvatarCompletionRead | undefined;
  if (!mutation.profile.avatarUrl && context.avatarCompletion) {
    try {
      avatarCompletion = await maybeRequestAvatarCompletion(db, context, agentId);
      if (avatarCompletion) receipt = { ...receipt, avatarCompletion };
      if (avatarCompletion?.status === "failed") {
        receipt = addMutationWarning(receipt, "avatar_generation_failed");
      }
    } catch (error) {
      console.warn("[agent-profile-management] Failed to request automatic avatar generation:", error);
      receipt = addMutationWarning(receipt, "avatar_generation_failed");
    }
  }

  return {
    ...(await getOwnedAgent(db, { userId: context.userId, agentId })),
    message: "Agent updated.",
    receipt,
    ...(avatarCompletion && { avatarCompletion }),
  };
}

function addMutationWarning(
  receipt: AgentMutationReceipt,
  warning: string,
): AgentMutationReceipt {
  return receipt.warnings.includes(warning)
    ? receipt
    : { ...receipt, warnings: [...receipt.warnings, warning] };
}

async function maybeRequestAvatarCompletion(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  agentProfileId: string,
): Promise<AvatarCompletionRead | undefined> {
  if (!context.avatarCompletion) return undefined;

  const request = context.avatarCompletion.request ?? requestAndStartAvatarCompletion;
  return request(db, {
    userId: context.userId,
    agentProfileId,
    triggerSource: context.avatarCompletion.triggerSource,
    publicBaseUrl: context.publicBaseUrl,
  }, {
    processImmediately: context.avatarCompletion.processImmediately,
    publicBaseUrl: context.publicBaseUrl,
  });
}

async function requireOwnedAgentProfile(
  db: DatabaseExecutor,
  userId: string,
  agentId: string,
): Promise<AgentProfileRow> {
  const profile = (await db
    .select()
    .from(schema.agentProfiles)
    .where(and(
      eq(schema.agentProfiles.id, agentId),
      eq(schema.agentProfiles.userId, userId),
    ))
    .limit(1))[0];

  if (!profile) {
    throw new AgentProfileManagementError("agent_not_found", "Agent not found.", 404, { agentId });
  }
  return profile;
}

async function getAccountRating(db: DatabaseExecutor, userId: string): Promise<AccountRatingSummary> {
  const user = (await db
    .select({
      rating: schema.users.rating,
      peakRating: schema.users.peakRating,
      gamesPlayed: schema.users.gamesPlayed,
      gamesWon: schema.users.gamesWon,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1))[0];

  if (!user) {
    throw new AgentProfileManagementError("account_not_found", "Authenticated account not found.", 404, { userId });
  }
  return accountRatingSummary(user);
}

function accountRatingSummary(user: AccountRatingRow): AccountRatingSummary {
  return {
    kind: "account-level-free-track",
    currentElo: user.rating,
    peakElo: user.peakRating,
    accountGamesPlayed: user.gamesPlayed,
    accountWins: user.gamesWon,
    agentEloAvailable: false,
  };
}

async function loadAgentSerializationContext(
  db: DatabaseExecutor,
  userId: string,
  profiles: AgentProfileRow[],
  accountRating: AccountRatingSummary,
): Promise<{
  accountRating: AccountRatingSummary;
  queuedAgentProfileId: string | null;
  queueJoinedAt: string | null;
  activeEnrollmentByAgentProfileId: Map<string, AgentActiveEnrollmentSummary>;
  currentDailyFreeEnrollment: AgentActiveEnrollmentSummary | null;
}> {
  if (profiles.length === 0) {
    return {
      accountRating,
      queuedAgentProfileId: null,
      queueJoinedAt: null,
      activeEnrollmentByAgentProfileId: new Map(),
      currentDailyFreeEnrollment: null,
    };
  }

  const [queueEntry] = await db
    .select()
    .from(schema.freeGameQueue)
    .where(eq(schema.freeGameQueue.userId, userId))
    .limit(1);

  const profileIds = profiles.map((profile) => profile.id);
  const enrollmentRows = await db
    .select({
      agentProfileId: schema.gamePlayers.agentProfileId,
      gameId: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      trackType: schema.games.trackType,
      createdAt: schema.games.createdAt,
    })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(and(
      eq(schema.gamePlayers.userId, userId),
      inArray(schema.gamePlayers.agentProfileId, profileIds),
      inArray(schema.games.status, ["waiting", "in_progress", "suspended"]),
    ));

  const activeEnrollmentByAgentProfileId = activeEnrollmentMap(enrollmentRows);
  const currentDailyFreeEnrollment = [...activeEnrollmentByAgentProfileId.values()]
    .find((enrollment) => enrollment.queueType === "daily-free") ?? null;
  return {
    accountRating,
    queuedAgentProfileId: queueEntry?.agentProfileId ?? null,
    queueJoinedAt: queueEntry?.joinedAt ?? null,
    activeEnrollmentByAgentProfileId,
    currentDailyFreeEnrollment,
  };
}

function activeEnrollmentMap(
  rows: EnrollmentRow[],
): Map<string, AgentActiveEnrollmentSummary> {
  const sortedRows = [...rows].sort((a, b) => {
    const statusDelta = enrollmentStatusRank(a.status) - enrollmentStatusRank(b.status);
    if (statusDelta !== 0) return statusDelta;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const byProfileId = new Map<string, AgentActiveEnrollmentSummary>();
  for (const row of sortedRows) {
    if (!row.agentProfileId || byProfileId.has(row.agentProfileId)) continue;
    if (row.status !== "waiting" && row.status !== "in_progress" && row.status !== "suspended") continue;
    byProfileId.set(row.agentProfileId, {
      gameId: row.gameId,
      slug: row.slug,
      status: row.status,
      queueType: row.trackType === "free" ? "daily-free" : "open-game",
    });
  }
  return byProfileId;
}

function enrollmentStatusRank(status: string): number {
  if (status === "in_progress") return 0;
  if (status === "waiting") return 1;
  if (status === "suspended") return 2;
  return 3;
}

function serializeAgent(
  profile: AgentProfileRow,
  context: {
    accountRating: AccountRatingSummary;
    queuedAgentProfileId: string | null;
    queueJoinedAt: string | null;
    activeEnrollmentByAgentProfileId: Map<string, AgentActiveEnrollmentSummary>;
    currentDailyFreeEnrollment: AgentActiveEnrollmentSummary | null;
  },
): AgentSummary {
  const archetype = profile.personaKey && isUserSelectableAgentArchetype(profile.personaKey)
    ? profile.personaKey
    : null;
  const archetypeRecord = archetype ? getUserSelectableAgentArchetype(archetype) : null;
  const queued = context.queuedAgentProfileId === profile.id;
  return {
    id: profile.id,
    displayName: profile.name,
    archetype,
    archetypeLabel: archetypeRecord?.label ?? null,
    publicBiography: profile.backstory,
    personalityPrompt: profile.personality,
    strategyStyle: profile.strategyStyle,
    gender: profile.gender,
    avatarUrl: profile.avatarUrl,
    stats: {
      gamesPlayed: profile.gamesPlayed,
      wins: profile.gamesWon,
      winRate: profile.gamesPlayed > 0 ? profile.gamesWon / profile.gamesPlayed : 0,
    },
    rating: context.accountRating,
    queueState: {
      dailyFree: queued ? "queued" : "not-queued",
      ...(queued && context.queueJoinedAt && { joinedAt: context.queueJoinedAt }),
      ...(queued && {
        eligibility: context.currentDailyFreeEnrollment ? "temporarily-ineligible" as const : "eligible" as const,
      }),
      ...(queued && context.currentDailyFreeEnrollment && { currentGame: context.currentDailyFreeEnrollment }),
    },
    activeEnrollment: context.activeEnrollmentByAgentProfileId.get(profile.id) ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function agentProfileMatches(profile: AgentProfileRow, query: string): boolean {
  return [
    profile.name,
    profile.personaKey,
    profile.backstory,
    profile.personality,
    profile.strategyStyle,
  ].some((value) => value?.toLowerCase().includes(query));
}

function rejectUnsupportedFields(input: Record<string, unknown>, allowedFields: Set<string>): void {
  for (const key of Object.keys(input)) {
    if (IMMUTABLE_AGENT_FIELDS.has(key)) {
      throw new AgentProfileManagementError(
        "immutable_field",
        `${key} is not editable through the MCP agent-management tools.`,
        400,
        { field: key },
      );
    }
    if (key === "cosmetics") {
      throw new AgentProfileManagementError(
        "invalid_agent_input",
        "cosmetics are not supported in v1. Use avatarUrl for the durable profile cosmetic field.",
        400,
        { field: key, supportedCosmeticFields: ["avatarUrl"] },
      );
    }
    if (!allowedFields.has(key)) {
      throw new AgentProfileManagementError(
        "invalid_agent_input",
        `Unsupported agent field: ${key}.`,
        400,
        { field: key },
      );
    }
  }
}

function requiredStringField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new AgentProfileManagementError(
      "invalid_agent_input",
      `${field} must be a string.`,
      400,
      { field },
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AgentProfileManagementError(
      "invalid_agent_input",
      `${field} is required.`,
      400,
      { field },
    );
  }
  if (trimmed.length > maxLength) {
    throw new AgentProfileManagementError(
      "invalid_agent_input",
      `${field} must be ${maxLength} characters or less.`,
      400,
      { field, maxLength },
    );
  }
  return trimmed;
}

function assertAgentNameNotReserved(name: string): void {
  if (isReservedHouseAgentName(name)) {
    throw agentNameTakenError();
  }
}

function normalizeSavedAgentName(name: string): string {
  return name.trim().toLowerCase();
}

function agentNameTakenError(): AgentProfileManagementError {
  return new AgentProfileManagementError(
    "agent_name_taken",
    AGENT_NAME_TAKEN_MESSAGE,
    409,
  );
}

function mapAgentNameConflict(error: unknown): unknown {
  return isNormalizedAgentNameUniqueViolation(error) ? agentNameTakenError() : error;
}

function isNormalizedAgentNameUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const record = current as Record<string, unknown>;
    if (record.code === "23505"
      && (record.constraint_name === AGENT_NAME_UNIQUE_INDEX
        || record.constraint === AGENT_NAME_UNIQUE_INDEX)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function optionalStringField(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AgentProfileManagementError(
      "invalid_agent_input",
      `${field} must be a string or null.`,
      400,
      { field },
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AgentProfileManagementError(
      "invalid_agent_input",
      `${field} must be ${maxLength} characters or less.`,
      400,
      { field, maxLength },
    );
  }
  return trimmed;
}

function requiredArchetype(value: unknown): AgentArchetypeKey {
  const normalized = normalizeArchetype(value);
  if (normalized) return normalized;
  throw invalidArchetypeError();
}

function optionalArchetype(value: unknown): AgentArchetypeKey | null {
  if (value === null) return null;
  const normalized = normalizeArchetype(value);
  if (normalized) return normalized;
  throw invalidArchetypeError();
}

function optionalAgentGender(value: unknown): AgentGender | null {
  if (value === undefined || value === null || value === "") return null;
  if (isAgentGender(value)) return value;
  throw new AgentProfileManagementError(
    "invalid_agent_input",
    "gender must be male, female, non-binary, or null.",
    400,
    { field: "gender" },
  );
}

function normalizeArchetype(value: unknown): AgentArchetypeKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isUserSelectableAgentArchetype(normalized) ? normalized : null;
}

function invalidArchetypeError(): AgentProfileManagementError {
  return new AgentProfileManagementError(
    "invalid_archetype",
    `Invalid archetype. Must be one of: ${formatUserSelectableAgentArchetypeKeys()}.`,
    400,
    { supportedArchetypes: formatUserSelectableAgentArchetypeKeys().split(", ") },
  );
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
