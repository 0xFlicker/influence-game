import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { AvatarChangeSource, AvatarGenerationTriggerSource } from "../db/schema.js";
import { normalizeUploadedAvatarUrl } from "../lib/storage.js";
import {
  completeAvatarGenerationRequest,
  recordAvatarChange,
  requestAvatarCompletion,
  type AvatarCompletionRead,
} from "./avatar-generation.js";
import {
  formatUserSelectableAgentArchetypeKeys,
  getUserSelectableAgentArchetype,
  isUserSelectableAgentArchetype,
  type AgentArchetypeKey,
} from "./agent-archetypes.js";

const DEFAULT_AGENT_LIMIT = 50;
const MAX_AGENT_LIMIT = 100;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_PERSONALITY_PROMPT_LENGTH = 8_000;
const MAX_PUBLIC_BIOGRAPHY_LENGTH = 2_000;
const MAX_STRATEGY_STYLE_LENGTH = 2_000;

const CREATE_AGENT_FIELDS = new Set([
  "displayName",
  "archetype",
  "personalityPrompt",
  "publicBiography",
  "strategyStyle",
  "avatarUrl",
]);

const UPDATE_AGENT_FIELDS = new Set([
  "agentId",
  "displayName",
  "archetype",
  "personalityPrompt",
  "publicBiography",
  "strategyStyle",
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
  | "account_limit_reached";

export class AgentProfileManagementError extends Error {
  constructor(
    public readonly code: AgentProfileManagementErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
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
  };
  avatarChangeSource?: AvatarChangeSource;
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
}

export interface AgentActiveEnrollmentSummary {
  gameId: string;
  slug?: string;
  status: "waiting" | "in_progress";
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
  slug: string | null;
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
  db: DrizzleDB,
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

  await getAccountRating(db, context.userId);

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(schema.agentProfiles).values({
    id,
    userId: context.userId,
    name: displayName,
    backstory: publicBiography,
    personality: personalityPrompt,
    strategyStyle,
    personaKey: archetype,
    avatarUrl: avatarUrl.value ?? null,
    gamesPlayed: 0,
    gamesWon: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (avatarUrl.value) {
    await recordAvatarChange(db, {
      userId: context.userId,
      agentProfileId: id,
      source: context.avatarChangeSource ?? "mcp_provided_avatar",
      status: "completed",
      previousAvatarUrl: null,
      newAvatarUrl: avatarUrl.value,
    });
  }

  const avatarCompletion = avatarUrl.value
    ? {
        status: "already_provided" as const,
        avatarUrl: avatarUrl.value,
        reason: "Agent already has an avatar.",
      }
    : await maybeRequestAvatarCompletion(db, context, id);

  return {
    ...(await getOwnedAgent(db, { userId: context.userId, agentId: id })),
    message: "Agent created.",
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
  const existing = await requireOwnedAgentProfile(db, context.userId, agentId);

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

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
  if (input.avatarUrl !== undefined) {
    const avatarUrl = normalizeAgentAvatarUrlInput(input.avatarUrl, context.publicBaseUrl);
    if (!avatarUrl.ok) {
      throw new AgentProfileManagementError("invalid_agent_input", avatarUrl.error, 400);
    }
    updates.avatarUrl = avatarUrl.value ?? null;
  }

  if (profileIdentityChanged(existing, updates) && existing.gamesPlayed > 0) {
    updates.gamesPlayed = 0;
    updates.gamesWon = 0;
  }

  await db
    .update(schema.agentProfiles)
    .set(updates)
    .where(and(
      eq(schema.agentProfiles.id, agentId),
      eq(schema.agentProfiles.userId, context.userId),
    ));

  if (input.avatarUrl !== undefined && updates.avatarUrl !== existing.avatarUrl) {
    await recordAvatarChange(db, {
      userId: context.userId,
      agentProfileId: agentId,
      source: context.avatarChangeSource ?? "mcp_update",
      status: "completed",
      previousAvatarUrl: existing.avatarUrl,
      newAvatarUrl: updates.avatarUrl as string | null,
    });
  }

  return {
    ...(await getOwnedAgent(db, { userId: context.userId, agentId })),
    message: "Agent updated.",
  };
}

async function maybeRequestAvatarCompletion(
  db: DrizzleDB,
  context: AgentProfileManagementContext,
  agentProfileId: string,
): Promise<AvatarCompletionRead | undefined> {
  if (!context.avatarCompletion) return undefined;

  const read = await requestAvatarCompletion(db, {
    userId: context.userId,
    agentProfileId,
    triggerSource: context.avatarCompletion.triggerSource,
    publicBaseUrl: context.publicBaseUrl,
  }, {
    processImmediately: context.avatarCompletion.processImmediately,
  });

  if (read.status === "accepted" && !context.avatarCompletion.processImmediately && read.generationRequestId) {
    void completeAvatarGenerationRequest(db, read.generationRequestId, {
      publicBaseUrl: context.publicBaseUrl,
    }).catch((error) => {
      console.warn("[avatar-generation] Background avatar completion failed:", error);
    });
  }

  return read;
}

async function requireOwnedAgentProfile(
  db: DrizzleDB,
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

async function getAccountRating(db: DrizzleDB, userId: string): Promise<AccountRatingSummary> {
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
  db: DrizzleDB,
  userId: string,
  profiles: AgentProfileRow[],
  accountRating: AccountRatingSummary,
): Promise<{
  accountRating: AccountRatingSummary;
  queuedAgentProfileId: string | null;
  queueJoinedAt: string | null;
  activeEnrollmentByAgentProfileId: Map<string, AgentActiveEnrollmentSummary>;
}> {
  if (profiles.length === 0) {
    return {
      accountRating,
      queuedAgentProfileId: null,
      queueJoinedAt: null,
      activeEnrollmentByAgentProfileId: new Map(),
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
      inArray(schema.games.status, ["waiting", "in_progress"]),
    ));

  return {
    accountRating,
    queuedAgentProfileId: queueEntry?.agentProfileId ?? null,
    queueJoinedAt: queueEntry?.joinedAt ?? null,
    activeEnrollmentByAgentProfileId: activeEnrollmentMap(enrollmentRows),
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
    if (row.status !== "waiting" && row.status !== "in_progress") continue;
    byProfileId.set(row.agentProfileId, {
      gameId: row.gameId,
      ...(row.slug && { slug: row.slug }),
      status: row.status,
      queueType: row.trackType === "free" ? "daily-free" : "open-game",
    });
  }
  return byProfileId;
}

function enrollmentStatusRank(status: string): number {
  if (status === "in_progress") return 0;
  if (status === "waiting") return 1;
  return 2;
}

function serializeAgent(
  profile: AgentProfileRow,
  context: {
    accountRating: AccountRatingSummary;
    queuedAgentProfileId: string | null;
    queueJoinedAt: string | null;
    activeEnrollmentByAgentProfileId: Map<string, AgentActiveEnrollmentSummary>;
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

function profileIdentityChanged(
  existing: AgentProfileRow,
  updates: Record<string, unknown>,
): boolean {
  return (
    (updates.name !== undefined && updates.name !== existing.name) ||
    (updates.personality !== undefined && updates.personality !== existing.personality) ||
    (updates.personaKey !== undefined && updates.personaKey !== existing.personaKey) ||
    (updates.backstory !== undefined && updates.backstory !== existing.backstory) ||
    (updates.strategyStyle !== undefined && updates.strategyStyle !== existing.strategyStyle)
  );
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
