/**
 * Influence Game — Database Schema
 *
 * Drizzle ORM schema for PostgreSQL.
 * Tables: users, games, game_players, transcripts, game_results, agent_profiles,
 *         permissions, roles, role_permissions, address_roles
 */

import {
  type AnyPgColumn,
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AgentGender } from "../lib/agent-gender.js";
import { MCP_OAUTH_SCOPE_CHECK_VALUES } from "../services/mcp-scope-policy.js";

export type PostgameMediaType = "house_highlights_trailer";
export type PostgameMediaStatus =
  | "waiting_inputs"
  | "waiting_music"
  | "queued"
  | "claimed"
  | "rendering"
  | "composing"
  | "uploading"
  | "ready"
  | "failed";

export type PostgameMediaAuditAction =
  | "completion_reconcile"
  | "backfill"
  | "rerender";

export type PostgameMediaAuditOutcome =
  | "queued"
  | "waiting_inputs"
  | "suppressed"
  | "failed"
  | "denied";

export interface PostgameMediaPreviewMetadata {
  title: string;
  description: string;
}

export interface PostgameMediaVideoArtifact {
  publicUrl: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  width: number;
  height: number;
}

export interface PostgameMediaPosterArtifact {
  publicUrl: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  altText: string;
}

export interface PostgameMediaCaptionsArtifact {
  publicUrl: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  language: string;
  label: string;
}

export interface PostgameMediaManifestArtifact {
  publicUrl: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface PostgameMediaArtifactMetadata {
  preview: PostgameMediaPreviewMetadata;
  video: PostgameMediaVideoArtifact;
  poster: PostgameMediaPosterArtifact;
  captions: PostgameMediaCaptionsArtifact;
  manifest: PostgameMediaManifestArtifact;
  storage: {
    provider: string;
    bucket: string;
  };
}

export type PostgameMediaArtifactKind =
  | "video"
  | "poster"
  | "captions"
  | "metadata";

export interface PostgameMediaUploadTargetMetadata {
  targetId: string;
  attemptNumber: number;
  artifactVersion: string;
  artifact: PostgameMediaArtifactKind;
  filename: string;
  objectKey: string;
  publicUrl: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

const MCP_OAUTH_SCOPE_CHECK_SQL = sql.raw(
  `(${MCP_OAUTH_SCOPE_CHECK_VALUES.map((scope) => `'${scope}'`).join(", ")})`,
);
const MCP_OAUTH_REFRESH_SCOPE_CHECK_SQL = sql.raw(
  `(${MCP_OAUTH_SCOPE_CHECK_VALUES
    .filter((scope) => !scope.split(/\s+/).includes("producer"))
    .map((scope) => `'${scope}'`)
    .join(", ")})`,
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(), // UUID
  walletAddress: text("wallet_address").unique(),
  email: text("email"),
  displayName: text("display_name"),
  rating: integer("rating").notNull().default(1200),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesWon: integer("games_won").notNull().default(0),
  peakRating: integer("peak_rating").notNull().default(1200),
  lastGameAt: text("last_game_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled" | "suspended";
export type TrackType = "custom" | "free";
export type SeasonStatus = "active" | "closing" | "final";
export type SeasonRatedPool = "free";

export const seasons = pgTable("seasons", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().$type<SeasonStatus>().default("active"),
  ratedPool: text("rated_pool").notNull().$type<SeasonRatedPool>().default("free"),
  admissionStartsAt: text("admission_starts_at"),
  admissionClosesAt: text("admission_closes_at"),
  finalizedAt: text("finalized_at"),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
  updatedAt: text("updated_at").notNull().default(sql`now()::text`),
}, (table) => [
  uniqueIndex("seasons_one_active_pool_unique")
    .on(table.ratedPool)
    .where(sql`${table.status} = 'active'`),
  index("seasons_status_created_idx").on(table.status, table.createdAt),
  check("seasons_status_check", sql`${table.status} IN ('active', 'closing', 'final')`),
  check("seasons_rated_pool_check", sql`${table.ratedPool} IN ('free')`),
]);

export const games = pgTable("games", {
  id: text("id").primaryKey(), // UUID
  slug: text("slug").notNull().unique(), // Human-readable identifier, e.g. "punk-green-apple"
  config: text("config").notNull(), // JSON-serialized GameConfig
  status: text("status").notNull().$type<GameStatus>().default("waiting"),
  trackType: text("track_type").notNull().$type<TrackType>().default("custom"),
  freeDrawRequestKey: text("free_draw_request_key"),
  seasonId: text("season_id").references(() => seasons.id),
  cognitiveArtifactCaptureVersion: integer("cognitive_artifact_capture_version").notNull().default(0),
  minPlayers: integer("min_players").notNull().default(4),
  maxPlayers: integer("max_players").notNull().default(12),
  createdById: text("created_by_id").references(() => users.id),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  hiddenAt: text("hidden_at"), // Soft-delete: non-null means game is hidden from public lists
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("games_created_by_id_idx").on(table.createdById),
  index("games_season_id_status_idx").on(table.seasonId, table.status),
  index("games_status_ended_at_idx").on(table.status, table.endedAt),
  index("games_status_ended_created_idx").on(table.status, table.endedAt, table.createdAt),
  uniqueIndex("games_free_draw_request_key_unique")
    .on(table.freeDrawRequestKey)
    .where(sql`${table.trackType} = 'free' AND ${table.freeDrawRequestKey} IS NOT NULL`),
  check(
    "games_free_draw_request_key_length_check",
    sql`${table.freeDrawRequestKey} IS NULL OR char_length(${table.freeDrawRequestKey}) BETWEEN 1 AND 200`,
  ),
]);

// ---------------------------------------------------------------------------
// Agent Profiles (saved, reusable player agent identities)
// ---------------------------------------------------------------------------

export const agentProfiles = pgTable("agent_profiles", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  backstory: text("backstory"), // Rich character backstory
  personality: text("personality").notNull(), // Personality prompt / description
  strategyStyle: text("strategy_style"), // Strategy hints
  personaKey: text("persona_key"), // Archetype key (honest, strategic, etc.)
  gender: text("gender").$type<AgentGender>(),
  currentRevisionId: text("current_revision_id")
    .references((): AnyPgColumn => agentRevisions.id, { onDelete: "restrict" }),
  avatarUrl: text("avatar_url"),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesWon: integer("games_won").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("agent_profiles_user_id_idx").on(table.userId),
  index("agent_profiles_name_idx").on(table.name),
  index("agent_profiles_name_id_idx").on(table.name, table.id),
  uniqueIndex("agent_profiles_normalized_name_unique").on(sql`lower(btrim(${table.name}))`),
  index("agent_profiles_current_revision_idx").on(table.currentRevisionId),
  check("agent_profiles_name_not_house_reserved", sql`
    lower(btrim(${table.name})) NOT IN (
      'atlas', 'vera', 'finn', 'mira', 'rex',
      'lyra', 'kael', 'echo', 'sage', 'jace',
      'nyx', 'orion', 'zara', 'riven', 'luna',
      'thane', 'iris', 'cyrus', 'wren', 'dax'
    )
  `),
  check("agent_profiles_gender_check", sql`${table.gender} IS NULL OR ${table.gender} IN ('male', 'female', 'non-binary')`),
]);

export type AgentRevisionTrigger = "initial_backfill" | "profile_create" | "profile_edit" | "runtime_policy_change";
export type AgentRevisionMagnitude = "initial" | "small" | "material" | "execution";

export const agentRevisions = pgTable("agent_revisions", {
  id: text("id").primaryKey(),
  agentProfileId: text("agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  ordinal: integer("ordinal").notNull(),
  priorRevisionId: text("prior_revision_id")
    .references((): AnyPgColumn => agentRevisions.id, { onDelete: "restrict" }),
  trigger: text("trigger").notNull().$type<AgentRevisionTrigger>(),
  magnitude: text("magnitude").notNull().$type<AgentRevisionMagnitude>(),
  fingerprint: text("fingerprint").notNull(),
  behaviorSnapshot: jsonb("behavior_snapshot").notNull().$type<Record<string, unknown>>(),
  effectiveRuntimeSnapshot: jsonb("effective_runtime_snapshot").notNull().$type<Record<string, unknown>>(),
  revisionPolicyVersion: text("revision_policy_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
}, (table) => [
  uniqueIndex("agent_revisions_profile_ordinal_unique").on(table.agentProfileId, table.ordinal),
  index("agent_revisions_profile_fingerprint_idx").on(table.agentProfileId, table.fingerprint),
  index("agent_revisions_profile_created_idx").on(table.agentProfileId, table.createdAt),
  check("agent_revisions_ordinal_check", sql`${table.ordinal} > 0`),
  check("agent_revisions_trigger_check", sql`${table.trigger} IN ('initial_backfill', 'profile_create', 'profile_edit', 'runtime_policy_change')`),
  check("agent_revisions_magnitude_check", sql`${table.magnitude} IN ('initial', 'small', 'material', 'execution')`),
]);

export type AvatarGenerationPurpose = "agent_profile_completion";
export type AvatarGenerationStatus = "queued" | "processing" | "completed" | "skipped" | "failed";
export type AvatarGenerationTriggerSource =
  | "web_user_prompt"
  | "web_ai_help_draft"
  | "web_create_default"
  | "mcp_create_default";

export const avatarGenerationRequests = pgTable("avatar_generation_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  agentProfileId: text("agent_profile_id")
    .notNull(),
  purpose: text("purpose").notNull().$type<AvatarGenerationPurpose>(),
  status: text("status").notNull().$type<AvatarGenerationStatus>(),
  triggerSource: text("trigger_source").notNull().$type<AvatarGenerationTriggerSource>(),
  provider: text("provider").notNull().default("katana"),
  model: text("model").notNull().default("gen"),
  providerRequestId: text("provider_request_id"),
  promptHash: text("prompt_hash"),
  estimatedCostMicrousd: integer("estimated_cost_microusd"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
  completedAt: text("completed_at"),
}, (table) => [
  index("avatar_generation_requests_user_idx").on(table.userId, table.createdAt),
  index("avatar_generation_requests_agent_idx").on(table.agentProfileId, table.createdAt),
  index("avatar_generation_requests_status_idx").on(table.status, table.updatedAt),
  uniqueIndex("avatar_generation_requests_completion_active_unique")
    .on(table.userId, table.agentProfileId, table.purpose)
    .where(sql`${table.status} IN ('queued', 'processing', 'completed')`),
  check("avatar_generation_requests_purpose_check", sql`${table.purpose} IN ('agent_profile_completion')`),
  check("avatar_generation_requests_status_check", sql`${table.status} IN ('queued', 'processing', 'completed', 'skipped', 'failed')`),
  check("avatar_generation_requests_trigger_source_check", sql`${table.triggerSource} IN ('web_user_prompt', 'web_ai_help_draft', 'web_create_default', 'mcp_create_default')`),
]);

export type AvatarChangeSource =
  | "web_upload"
  | "web_generated_completion"
  | "web_manual_update"
  | "mcp_create_default"
  | "mcp_provided_avatar"
  | "mcp_update"
  | "backend_generated_completion"
  | "generation_skipped"
  | "generation_failed"
  | "producer_action";

export type AvatarChangeStatus = "completed" | "skipped" | "failed";

export const avatarChangeEvents = pgTable("avatar_change_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  agentProfileId: text("agent_profile_id")
    .notNull(),
  generationRequestId: text("generation_request_id")
    .references(() => avatarGenerationRequests.id),
  source: text("source").notNull().$type<AvatarChangeSource>(),
  status: text("status").notNull().$type<AvatarChangeStatus>(),
  actorUserId: text("actor_user_id").references(() => users.id),
  previousAvatarUrl: text("previous_avatar_url"),
  newAvatarUrl: text("new_avatar_url"),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("avatar_change_events_user_idx").on(table.userId, table.createdAt),
  index("avatar_change_events_agent_idx").on(table.agentProfileId, table.createdAt),
  index("avatar_change_events_source_idx").on(table.source, table.createdAt),
  check("avatar_change_events_source_check", sql`${table.source} IN ('web_upload', 'web_generated_completion', 'web_manual_update', 'mcp_create_default', 'mcp_provided_avatar', 'mcp_update', 'backend_generated_completion', 'generation_skipped', 'generation_failed', 'producer_action')`),
  check("avatar_change_events_status_check", sql`${table.status} IN ('completed', 'skipped', 'failed')`),
]);

// ---------------------------------------------------------------------------
// Game Players
// ---------------------------------------------------------------------------

export const gamePlayers = pgTable("game_players", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  userId: text("user_id").references(() => users.id),
  agentProfileId: text("agent_profile_id").references(() => agentProfiles.id),
  agentRevisionId: text("agent_revision_id").references(() => agentRevisions.id, { onDelete: "restrict" }),
  persona: text("persona").notNull(), // JSON: { name, personality, strategyHints }
  agentConfig: text("agent_config").notNull(), // JSON: { model, temperature, etc. }
  joinedAt: text("joined_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_players_game_id_idx").on(table.gameId),
  index("game_players_user_id_idx").on(table.userId),
  index("game_players_agent_profile_id_idx").on(table.agentProfileId),
  index("game_players_agent_revision_id_idx").on(table.agentRevisionId),
  index("game_players_agent_profile_game_id_idx").on(table.agentProfileId, table.gameId),
  index("game_players_user_game_id_idx").on(table.userId, table.gameId),
]);

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type TranscriptScope = "public" | "mingle" | "huddle" | "whisper" | "system" | "diary" | "thinking";

export const transcripts = pgTable("transcripts", {
  id: serial("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  round: integer("round").notNull(),
  phase: text("phase").notNull(), // Phase enum value
  fromPlayerId: text("from_player_id"), // null for system messages
  scope: text("scope").notNull().$type<TranscriptScope>().default("public"),
  toPlayerIds: text("to_player_ids"), // JSON array for Mingle room messages (or legacy whispers), null otherwise
  roomId: integer("room_id"), // Mingle room ID (1-indexed; legacy whisper too), null for non-room entries
  roomMetadata: text("room_metadata"), // JSON allocation metadata for Mingle room system events (legacy whisper too)
  text: text("text").notNull(),
  thinking: text("thinking"), // Per-message thinking (null for old entries / system messages)
  timestamp: bigint("timestamp", { mode: "number" }).notNull(), // Unix ms
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// Game Results
// ---------------------------------------------------------------------------

export const gameResults = pgTable("game_results", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .unique()
    .references(() => games.id),
  winnerId: text("winner_id"), // game_player id, null if draw
  roundsPlayed: integer("rounds_played").notNull(),
  tokenUsage: text("token_usage").notNull(), // JSON: { promptTokens, completionTokens, totalTokens, estimatedCost }
  finishedAt: text("finished_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// Dual Crown Competition Ledger
// ---------------------------------------------------------------------------

export type CompetitionEligibilityStatus = "eligible" | "ineligible";
export type CompetitionRatingEventType = "initialization" | "revision_recalibration" | "game_result";

export const agentCompetitionRatings = pgTable("agent_competition_ratings", {
  agentProfileId: text("agent_profile_id")
    .primaryKey()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  effectiveRevisionId: text("effective_revision_id")
    .notNull()
    .references(() => agentRevisions.id, { onDelete: "restrict" }),
  mu: doublePrecision("mu").notNull(),
  sigma: doublePrecision("sigma").notNull(),
  gamesPlayed: integer("games_played").notNull().default(0),
  ratingPolicyVersion: text("rating_policy_version").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`now()::text`),
}, (table) => [
  index("agent_competition_ratings_revision_idx").on(table.effectiveRevisionId),
  check("agent_competition_ratings_mu_check", sql`${table.mu} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`),
  check("agent_competition_ratings_sigma_check", sql`${table.sigma} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) AND ${table.sigma} > 0`),
  check("agent_competition_ratings_games_check", sql`${table.gamesPlayed} >= 0`),
]);

export const competitionRatingSnapshots = pgTable("competition_rating_snapshots", {
  id: text("id").primaryKey(),
  gameId: text("game_id").notNull()
    .references(() => games.id, { onDelete: "restrict" }),
  agentProfileId: text("agent_profile_id").notNull()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  agentRevisionId: text("agent_revision_id").notNull()
    .references(() => agentRevisions.id, { onDelete: "restrict" }),
  mu: doublePrecision("mu").notNull(),
  sigma: doublePrecision("sigma").notNull(),
  ratingPolicyVersion: text("rating_policy_version").notNull(),
  capturedAt: text("captured_at").notNull().default(sql`now()::text`),
}, (table) => [
  uniqueIndex("competition_rating_snapshots_game_agent_unique")
    .on(table.gameId, table.agentProfileId),
  index("competition_rating_snapshots_game_idx").on(table.gameId),
  check("competition_rating_snapshots_mu_check", sql`${table.mu} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`),
  check("competition_rating_snapshots_sigma_check", sql`${table.sigma} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) AND ${table.sigma} > 0`),
]);

export const competitionRatingEvents = pgTable("competition_rating_events", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  agentProfileId: text("agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  agentRevisionId: text("agent_revision_id")
    .notNull()
    .references(() => agentRevisions.id, { onDelete: "restrict" }),
  seasonId: text("season_id").references(() => seasons.id, { onDelete: "restrict" }),
  gameId: text("game_id").references(() => games.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull().$type<CompetitionRatingEventType>(),
  beforeMu: doublePrecision("before_mu"),
  beforeSigma: doublePrecision("before_sigma"),
  afterMu: doublePrecision("after_mu").notNull(),
  afterSigma: doublePrecision("after_sigma").notNull(),
  ratingPolicyVersion: text("rating_policy_version").notNull(),
  revisionPolicyVersion: text("revision_policy_version"),
  evidence: jsonb("evidence").notNull().$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
}, (table) => [
  index("competition_rating_events_agent_created_idx").on(table.agentProfileId, table.createdAt),
  index("competition_rating_events_game_idx").on(table.gameId),
  check("competition_rating_events_type_check", sql`${table.eventType} IN ('initialization', 'revision_recalibration', 'game_result')`),
  check("competition_rating_events_before_pair_check", sql`(${table.beforeMu} IS NULL) = (${table.beforeSigma} IS NULL)`),
  check("competition_rating_events_before_values_check", sql`
    ${table.beforeMu} IS NULL
    OR (${table.beforeMu} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      AND ${table.beforeSigma} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      AND ${table.beforeSigma} > 0)
  `),
  check("competition_rating_events_after_check", sql`
    ${table.afterMu} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND ${table.afterSigma} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    AND ${table.afterSigma} > 0
  `),
]);

export const competitionReceipts = pgTable("competition_receipts", {
  id: text("id").primaryKey(),
  seasonId: text("season_id")
    .notNull()
    .references(() => seasons.id, { onDelete: "restrict" }),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "restrict" }),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  agentProfileId: text("agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  agentRevisionId: text("agent_revision_id")
    .notNull()
    .references(() => agentRevisions.id, { onDelete: "restrict" }),
  ownerDisplayNameSnapshot: text("owner_display_name_snapshot"),
  agentNameSnapshot: text("agent_name_snapshot").notNull(),
  eligibilityStatus: text("eligibility_status").notNull().$type<CompetitionEligibilityStatus>(),
  eligibilityReason: text("eligibility_reason"),
  lobbySize: integer("lobby_size").notNull(),
  placement: integer("placement"),
  basePoints: integer("base_points").notNull().default(0),
  fieldBonus: integer("field_bonus").notNull().default(0),
  totalPoints: integer("total_points").notNull().default(0),
  accountRatingDelta: integer("account_rating_delta"),
  scoringPolicyVersion: text("scoring_policy_version").notNull(),
  earnedAt: text("earned_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
}, (table) => [
  uniqueIndex("competition_receipts_season_game_agent_unique")
    .on(table.seasonId, table.gameId, table.agentProfileId),
  index("competition_receipts_season_agent_idx")
    .on(table.seasonId, table.agentProfileId, table.earnedAt),
  index("competition_receipts_season_owner_idx")
    .on(table.seasonId, table.ownerId, table.earnedAt),
  index("competition_receipts_game_idx").on(table.gameId),
  check("competition_receipts_eligibility_check", sql`${table.eligibilityStatus} IN ('eligible', 'ineligible')`),
  check("competition_receipts_lobby_size_check", sql`${table.lobbySize} >= 2`),
  check("competition_receipts_points_check", sql`
    ${table.basePoints} >= 0
    AND ${table.fieldBonus} >= 0
    AND ${table.totalPoints} = ${table.basePoints} + ${table.fieldBonus}
  `),
  check("competition_receipts_status_values_check", sql`
    (${table.eligibilityStatus} = 'eligible'
      AND ${table.placement} BETWEEN 1 AND ${table.lobbySize}
      AND ${table.eligibilityReason} IS NULL)
    OR (${table.eligibilityStatus} = 'ineligible'
      AND ${table.basePoints} = 0
      AND ${table.fieldBonus} = 0
      AND ${table.totalPoints} = 0
      AND ${table.eligibilityReason} IS NOT NULL)
  `),
]);

export const competitionReceiptEvidence = pgTable("competition_receipt_evidence", {
  receiptId: text("receipt_id")
    .primaryKey()
    .references(() => competitionReceipts.id, { onDelete: "restrict" }),
  ratingPolicyVersion: text("rating_policy_version").notNull(),
  pregameRating: jsonb("pregame_rating").notNull().$type<Record<string, unknown>>(),
  postgameRating: jsonb("postgame_rating").$type<Record<string, unknown>>(),
  opponentRatings: jsonb("opponent_ratings").notNull().$type<Array<Record<string, unknown>>>(),
  fieldStrengthEvidence: jsonb("field_strength_evidence").notNull().$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

export const seasonHonors = pgTable("season_honors", {
  id: text("id").primaryKey(),
  seasonId: text("season_id")
    .notNull()
    .unique()
    .references(() => seasons.id, { onDelete: "restrict" }),
  agentChampionAgentProfileId: text("agent_champion_agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id, { onDelete: "restrict" }),
  agentChampionOwnerId: text("agent_champion_owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  agentChampionNameSnapshot: text("agent_champion_name_snapshot").notNull(),
  agentChampionOwnerNameSnapshot: text("agent_champion_owner_name_snapshot"),
  agentChampionPoints: integer("agent_champion_points").notNull(),
  architectChampionOwnerId: text("architect_champion_owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  architectChampionOwnerNameSnapshot: text("architect_champion_owner_name_snapshot"),
  architectChampionPointsHundredths: integer("architect_champion_points_hundredths").notNull(),
  architectContributions: jsonb("architect_contributions").notNull().$type<Array<Record<string, unknown>>>(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
}, (table) => [
  check("season_honors_points_check", sql`
    ${table.agentChampionPoints} >= 0
    AND ${table.architectChampionPointsHundredths} >= 0
  `),
]);

// ---------------------------------------------------------------------------
// Durable Game Run Kernel
// ---------------------------------------------------------------------------

export type DurableRunSource = "api" | "simulation_import";
export type GameRunOwnerStatus = "active" | "closed" | "revoked" | "expired";
export type KernelHealthStatus = "healthy" | "degraded" | "suspended";
export type GameCompletionSettlementState = "pending" | "repair_required" | "completed";
export type GameCompletionSettlementAttemptSource = "runner" | "admin";
export type GameCompletionSettlementAttemptOutcome =
  | "requested"
  | "succeeded"
  | "already_completed"
  | "repair_required"
  | "repair_blocked"
  | "invalid_state"
  | "failed"
  | "denied";
export type GameWatchStateSummarySource =
  | "durable_projection"
  | "degraded"
  | "best_available_terminal_result"
  | "pre_kernel_empty";
export type GameWatchStateSummaryCursorSource = "trusted_prefix" | "none";
export type GameWatchStateSummaryProjectionAvailability = "available" | "degraded" | "unavailable";
export type GameWatchStateSummaryEventLogStatus = "empty" | "complete" | "invalid";
export type GameWatchStateSummaryProjectionStatus = "empty" | "complete" | "incomplete" | "failed";
export type GameWatchStateSummaryFinalStatus = "not_final" | "final";
export type EvidenceRedactionStatus = "active" | "expired" | "redacted";
export type CognitiveArtifactType = "reasoning" | "thinking" | "strategy";
export type CognitiveArtifactActorRole = "player" | "juror" | "house" | "system" | "producer";
export type CognitiveArtifactVisibilityStatus = "active" | "capture_degraded";
export type CognitiveArtifactReadOutcome =
  | "allowed"
  | "denied"
  | "not_captured"
  | "not_captured_for_game"
  | "capture_degraded"
  | "expired"
  | "redacted";

export const gameRunOwners = pgTable("game_run_owners", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  ownerEpoch: text("owner_epoch").notNull(), // Durable stale-writer rejection token
  status: text("status").notNull().$type<GameRunOwnerStatus>().default("active"),
  runSource: text("run_source").notNull().$type<DurableRunSource>().default("api"),
  processId: text("process_id"),
  acquiredAt: text("acquired_at")
    .notNull()
    .default(sql`now()::text`),
  heartbeatAt: text("heartbeat_at")
    .notNull()
    .default(sql`now()::text`),
  expiresAt: text("expires_at"),
  closedAt: text("closed_at"),
  revokedAt: text("revoked_at"),
  lastPersistedEventSequence: integer("last_persisted_event_sequence").notNull().default(0),
  kernelHealth: text("kernel_health").notNull().$type<KernelHealthStatus>().default("healthy"),
  failureReason: text("failure_reason"),
  failureDetails: jsonb("failure_details").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_run_owners_owner_epoch_unique").on(table.ownerEpoch),
  uniqueIndex("game_run_owners_game_owner_epoch_unique").on(table.gameId, table.ownerEpoch),
  uniqueIndex("game_run_owners_one_active_per_game")
    .on(table.gameId)
    .where(sql`${table.status} = 'active'`),
  index("game_run_owners_game_id_idx").on(table.gameId),
  check("game_run_owners_status_check", sql`${table.status} IN ('active', 'closed', 'revoked', 'expired')`),
  check("game_run_owners_run_source_check", sql`${table.runSource} IN ('api', 'simulation_import')`),
  check("game_run_owners_kernel_health_check", sql`${table.kernelHealth} IN ('healthy', 'degraded', 'suspended')`),
  check("game_run_owners_last_persisted_event_sequence_check", sql`${table.lastPersistedEventSequence} >= 0`),
]);

export const gameEvents = pgTable("game_events", {
  id: serial("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  eventHash: text("event_hash").notNull(),
  ownerEpoch: text("owner_epoch")
    .notNull()
    .references(() => gameRunOwners.ownerEpoch),
  visibility: text("visibility").notNull(),
  payloadVersion: integer("payload_version").notNull().default(1),
  runSource: text("run_source").notNull().$type<DurableRunSource>().default("api"),
  sourcePointers: jsonb("source_pointers").$type<ReadonlyArray<Record<string, unknown>>>(),
  envelope: jsonb("envelope").notNull().$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_events_game_id_sequence_unique").on(table.gameId, table.sequence),
  index("game_events_game_id_idx").on(table.gameId),
  index("game_events_event_type_idx").on(table.eventType),
  foreignKey({
    name: "game_events_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  check("game_events_sequence_positive_check", sql`${table.sequence} > 0`),
  check("game_events_visibility_check", sql`${table.visibility} IN ('public', 'player', 'producer', 'system')`),
  check("game_events_run_source_check", sql`${table.runSource} IN ('api', 'simulation_import')`),
  check("game_events_envelope_game_id_check", sql`${table.envelope} ? 'gameId' AND (${table.envelope}->>'gameId') = ${table.gameId}`),
  check("game_events_envelope_sequence_check", sql`${table.envelope} ? 'sequence' AND ((${table.envelope}->>'sequence')::integer) = ${table.sequence}`),
  check("game_events_envelope_type_check", sql`${table.envelope} ? 'type' AND (${table.envelope}->>'type') = ${table.eventType}`),
  check("game_events_envelope_payload_version_check", sql`${table.envelope} ? 'payloadVersion' AND ((${table.envelope}->>'payloadVersion')::integer) = ${table.payloadVersion}`),
]);

export const gameCompletionSettlements = pgTable("game_completion_settlements", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  ownerEpoch: text("owner_epoch").notNull(),
  finalEventSequence: integer("final_event_sequence").notNull(),
  finalEventHash: text("final_event_hash").notNull(),
  payloadSchemaVersion: integer("payload_schema_version").notNull().default(1),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  payloadHash: text("payload_hash").notNull(),
  state: text("state").notNull().$type<GameCompletionSettlementState>().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastSafeFailureCode: text("last_safe_failure_code"),
  retryReadyAt: text("retry_ready_at"),
  capturedAt: text("captured_at")
    .notNull()
    .default(sql`now()::text`),
  lastAttemptedAt: text("last_attempted_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_completion_settlements_game_id_unique").on(table.gameId),
  unique("game_completion_settlements_game_id_id_unique").on(table.gameId, table.id),
  index("game_completion_settlements_state_idx").on(table.state, table.retryReadyAt),
  foreignKey({
    name: "game_completion_settlements_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  foreignKey({
    name: "game_completion_settlements_event_boundary_fk",
    columns: [table.gameId, table.finalEventSequence],
    foreignColumns: [gameEvents.gameId, gameEvents.sequence],
  }),
  check("game_completion_settlements_state_check", sql`${table.state} IN ('pending', 'repair_required', 'completed')`),
  check("game_completion_settlements_event_sequence_check", sql`${table.finalEventSequence} > 0`),
  check("game_completion_settlements_payload_schema_version_check", sql`${table.payloadSchemaVersion} = 1`),
  check("game_completion_settlements_attempt_count_check", sql`${table.attemptCount} >= 0`),
  check("game_completion_settlements_final_event_hash_check", sql`${table.finalEventHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("game_completion_settlements_payload_hash_check", sql`${table.payloadHash} ~ '^sha256:[0-9a-f]{64}$'`),
  check("game_completion_settlements_completed_at_check", sql`
    (${table.state} = 'completed' AND ${table.completedAt} IS NOT NULL)
    OR (${table.state} <> 'completed' AND ${table.completedAt} IS NULL)
  `),
  check("game_completion_settlements_retry_ready_check", sql`
    ${table.retryReadyAt} IS NULL OR ${table.state} = 'pending'
  `),
]);

export const gameCompletionSettlementAttempts = pgTable("game_completion_settlement_attempts", {
  id: text("id").primaryKey(), // UUID
  requestAttemptId: text("request_attempt_id"),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  settlementId: text("settlement_id"),
  source: text("source").notNull().$type<GameCompletionSettlementAttemptSource>(),
  actorUserId: text("actor_user_id").references(() => users.id),
  requestedReason: text("requested_reason"),
  outcome: text("outcome").notNull().$type<GameCompletionSettlementAttemptOutcome>(),
  priorState: text("prior_state").$type<GameCompletionSettlementState>(),
  resultingState: text("resulting_state").$type<GameCompletionSettlementState>(),
  resultHash: text("result_hash"),
  safeFailureCode: text("safe_failure_code"),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_completion_settlement_attempts_game_id_idx").on(table.gameId, table.createdAt),
  index("game_completion_settlement_attempts_settlement_id_idx").on(table.settlementId),
  uniqueIndex("game_completion_settlement_attempts_request_attempt_id_unique").on(table.requestAttemptId),
  foreignKey({
    name: "game_completion_settlement_attempts_request_attempt_fk",
    columns: [table.requestAttemptId],
    foreignColumns: [table.id],
  }).onDelete("set null"),
  foreignKey({
    name: "game_completion_settlement_attempts_game_settlement_fk",
    columns: [table.gameId, table.settlementId],
    foreignColumns: [gameCompletionSettlements.gameId, gameCompletionSettlements.id],
  }).onDelete("cascade"),
  check("game_completion_settlement_attempts_source_check", sql`${table.source} IN ('runner', 'admin')`),
  check("game_completion_settlement_attempts_outcome_check", sql`${table.outcome} IN ('requested', 'succeeded', 'already_completed', 'repair_required', 'repair_blocked', 'invalid_state', 'failed', 'denied')`),
  check("game_completion_settlement_attempts_prior_state_check", sql`${table.priorState} IS NULL OR ${table.priorState} IN ('pending', 'repair_required', 'completed')`),
  check("game_completion_settlement_attempts_resulting_state_check", sql`${table.resultingState} IS NULL OR ${table.resultingState} IN ('pending', 'repair_required', 'completed')`),
  check("game_completion_settlement_attempts_result_hash_check", sql`${table.resultHash} IS NULL OR ${table.resultHash} ~ '^sha256:[0-9a-f]{64}$'`),
]);

export const gameWatchStateSummaries = pgTable("game_watch_state_summaries", {
  gameId: text("game_id")
    .primaryKey()
    .references(() => games.id),
  slug: text("slug").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  status: text("status").notNull().$type<GameStatus>(),
  source: text("source").notNull().$type<GameWatchStateSummarySource>(),
  currentRound: integer("current_round").notNull().default(0),
  currentPhase: text("current_phase").notNull().default("INIT"),
  maxRounds: integer("max_rounds").notNull().default(10),
  totalPlayers: integer("total_players").notNull().default(0),
  alivePlayers: integer("alive_players").notNull().default(0),
  eliminatedPlayers: integer("eliminated_players").notNull().default(0),
  unknownPlayers: integer("unknown_players").notNull().default(0),
  eventCursorSequence: integer("event_cursor_sequence").notNull().default(0),
  eventCursorSource: text("event_cursor_source").notNull().$type<GameWatchStateSummaryCursorSource>().default("none"),
  eventCursorEventType: text("event_cursor_event_type"),
  eventCursorCreatedAt: text("event_cursor_created_at"),
  projectionAvailability: text("projection_availability")
    .notNull()
    .$type<GameWatchStateSummaryProjectionAvailability>()
    .default("unavailable"),
  projectionEventLogStatus: text("projection_event_log_status")
    .notNull()
    .$type<GameWatchStateSummaryEventLogStatus>()
    .default("empty"),
  projectionStatus: text("projection_status")
    .notNull()
    .$type<GameWatchStateSummaryProjectionStatus>()
    .default("empty"),
  projectionEventCount: integer("projection_event_count").notNull().default(0),
  projectionTrustedEventCount: integer("projection_trusted_event_count").notNull().default(0),
  projectionValidPrefixLength: integer("projection_valid_prefix_length").notNull().default(0),
  projectionLastTrustedSequence: integer("projection_last_trusted_sequence").notNull().default(0),
  projectionFirstInvalidSequence: integer("projection_first_invalid_sequence"),
  projectionPersistedHead: jsonb("projection_persisted_head").$type<{
    sequence: number;
    eventType: string;
    createdAt: string;
  }>(),
  projectionDiagnostics: jsonb("projection_diagnostics")
    .$type<ReadonlyArray<Record<string, unknown>>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  finalStatus: text("final_status")
    .notNull()
    .$type<GameWatchStateSummaryFinalStatus>()
    .default("not_final"),
  winnerId: text("winner_id"),
  winnerName: text("winner_name"),
  winnerMethod: text("winner_method"),
  winnerSource: text("winner_source").$type<Exclude<GameWatchStateSummarySource, "pre_kernel_empty">>(),
  roundsPlayed: integer("rounds_played"),
  lastRefreshReason: text("last_refresh_reason"),
  refreshedAt: text("refreshed_at")
    .notNull()
    .default(sql`now()::text`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_watch_state_summaries_status_idx").on(table.status),
  index("game_watch_state_summaries_source_idx").on(table.source),
  check("game_watch_state_summaries_schema_version_check", sql`${table.schemaVersion} > 0`),
  check("game_watch_state_summaries_status_check", sql`${table.status} IN ('waiting', 'in_progress', 'completed', 'cancelled', 'suspended')`),
  check("game_watch_state_summaries_source_check", sql`${table.source} IN ('durable_projection', 'degraded', 'best_available_terminal_result', 'pre_kernel_empty')`),
  check("game_watch_state_summaries_current_round_check", sql`${table.currentRound} >= 0`),
  check("game_watch_state_summaries_max_rounds_check", sql`${table.maxRounds} > 0`),
  check("game_watch_state_summaries_counts_check", sql`
    ${table.totalPlayers} >= 0
    AND ${table.alivePlayers} >= 0
    AND ${table.eliminatedPlayers} >= 0
    AND ${table.unknownPlayers} >= 0
    AND ${table.totalPlayers} = ${table.alivePlayers} + ${table.eliminatedPlayers} + ${table.unknownPlayers}
  `),
  check("game_watch_state_summaries_event_cursor_sequence_check", sql`${table.eventCursorSequence} >= 0`),
  check("game_watch_state_summaries_event_cursor_source_check", sql`${table.eventCursorSource} IN ('trusted_prefix', 'none')`),
  check("game_watch_state_summaries_projection_availability_check", sql`${table.projectionAvailability} IN ('available', 'degraded', 'unavailable')`),
  check("game_watch_state_summaries_projection_event_log_status_check", sql`${table.projectionEventLogStatus} IN ('empty', 'complete', 'invalid')`),
  check("game_watch_state_summaries_projection_status_check", sql`${table.projectionStatus} IN ('empty', 'complete', 'incomplete', 'failed')`),
  check("game_watch_state_summaries_projection_counts_check", sql`
    ${table.projectionEventCount} >= 0
    AND ${table.projectionTrustedEventCount} >= 0
    AND ${table.projectionValidPrefixLength} >= 0
    AND ${table.projectionLastTrustedSequence} >= 0
    AND (${table.projectionFirstInvalidSequence} IS NULL OR ${table.projectionFirstInvalidSequence} > 0)
  `),
  check("game_watch_state_summaries_final_status_check", sql`${table.finalStatus} IN ('not_final', 'final')`),
  check("game_watch_state_summaries_winner_source_check", sql`${table.winnerSource} IS NULL OR ${table.winnerSource} IN ('durable_projection', 'degraded', 'best_available_terminal_result')`),
  check("game_watch_state_summaries_rounds_played_check", sql`${table.roundsPlayed} IS NULL OR ${table.roundsPlayed} >= 0`),
]);

export const gameCheckpoints = pgTable("game_checkpoints", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  ownerEpoch: text("owner_epoch")
    .notNull()
    .references(() => gameRunOwners.ownerEpoch),
  lastEventSequence: integer("last_event_sequence").notNull(),
  checkpointKind: text("checkpoint_kind").notNull().default("phase_boundary"),
  actorCoordinate: text("actor_coordinate").notNull().default("none"),
  phase: text("phase"),
  round: integer("round"),
  eventHeadHash: text("event_head_hash").notNull(),
  projectionHash: text("projection_hash").notNull(),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
  transcriptCursor: jsonb("transcript_cursor").$type<Record<string, unknown>>(),
  tokenCostCursor: jsonb("token_cost_cursor").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_checkpoints_boundary_unique").on(
    table.gameId,
    table.lastEventSequence,
    table.checkpointKind,
    table.actorCoordinate,
  ),
  index("game_checkpoints_game_id_idx").on(table.gameId),
  foreignKey({
    name: "game_checkpoints_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  foreignKey({
    name: "game_checkpoints_event_boundary_fk",
    columns: [table.gameId, table.lastEventSequence],
    foreignColumns: [gameEvents.gameId, gameEvents.sequence],
  }),
  check("game_checkpoints_checkpoint_kind_check", sql`${table.checkpointKind} IN ('initial', 'phase_boundary', 'terminal')`),
  check("game_checkpoints_last_event_sequence_check", sql`${table.lastEventSequence} >= 0`),
]);

export const gameEvidenceManifests = pgTable("game_evidence_manifests", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  ownerEpoch: text("owner_epoch")
    .notNull(),
  eventSequence: integer("event_sequence"),
  evidenceType: text("evidence_type").notNull(),
  retentionClass: text("retention_class").notNull().default("debug"),
  accessScope: text("access_scope").notNull().default("producer_admin"),
  redactionStatus: text("redaction_status").notNull().$type<EvidenceRedactionStatus>().default("active"),
  expiresAt: text("expires_at"),
  redactedAt: text("redacted_at"),
  storageProvider: text("storage_provider"),
  storageBucket: text("storage_bucket"),
  storageKey: text("storage_key"),
  sourcePointers: jsonb("source_pointers").$type<ReadonlyArray<Record<string, unknown>>>(),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_evidence_manifests_game_id_idx").on(table.gameId),
  index("game_evidence_manifests_event_sequence_idx").on(table.gameId, table.eventSequence),
  foreignKey({
    name: "game_evidence_owner_epoch_fk",
    columns: [table.ownerEpoch],
    foreignColumns: [gameRunOwners.ownerEpoch],
  }),
  foreignKey({
    name: "game_evidence_manifests_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  foreignKey({
    name: "game_evidence_manifests_event_boundary_fk",
    columns: [table.gameId, table.eventSequence],
    foreignColumns: [gameEvents.gameId, gameEvents.sequence],
  }),
  check("game_evidence_manifests_retention_class_check", sql`${table.retentionClass} IN ('debug', 'audit', 'legal_hold')`),
  check("game_evidence_manifests_access_scope_check", sql`${table.accessScope} IN ('producer_admin')`),
  check("game_evidence_manifests_redaction_status_check", sql`${table.redactionStatus} IN ('active', 'expired', 'redacted')`),
  check("game_evidence_manifests_event_sequence_check", sql`${table.eventSequence} IS NULL OR ${table.eventSequence} > 0`),
]);

export const gameEvidenceManifestReads = pgTable("game_evidence_manifest_reads", {
  id: serial("id").primaryKey(),
  manifestId: text("manifest_id")
    .notNull(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  accessorUserId: text("accessor_user_id").references(() => users.id),
  accessorRole: text("accessor_role"),
  purpose: text("purpose").notNull(),
  outcome: text("outcome").notNull(),
  readAt: text("read_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_evidence_manifest_reads_manifest_id_idx").on(table.manifestId),
  index("game_evidence_manifest_reads_game_id_idx").on(table.gameId),
  foreignKey({
    name: "evidence_reads_manifest_fk",
    columns: [table.manifestId],
    foreignColumns: [gameEvidenceManifests.id],
  }),
  check("game_evidence_manifest_reads_outcome_check", sql`${table.outcome} IN ('allowed', 'denied', 'expired', 'redacted')`),
]);

// ---------------------------------------------------------------------------
// Provider Cost Accounting (producer/admin operational spend metadata)
// ---------------------------------------------------------------------------

export type ProviderSpendCaptureSource =
  | "live_trace"
  | "trace_manifest_backfill"
  | "terminal_result_backfill"
  | "manual_adjustment";
export type ProviderSpendCostSource =
  | "provider_actual"
  | "router_actual"
  | "org_reconciled"
  | "catalog_estimate"
  | "static_estimate"
  | "unavailable";
export type ProviderSpendCallStatus = "succeeded" | "failed" | "unknown";
export type GameCostRollupScope = "game" | "owner_epoch";
export type CostReconciliationStatus = "matched" | "partial" | "unavailable";
export type CostAccountingAuditAction = "backfill_game" | "rebuild_rollup" | "record_reconciliation";
export type CostAccountingAuditOutcome = "succeeded" | "failed" | "denied";

export const gameProviderSpendEntries = pgTable("game_provider_spend_entries", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  ownerEpoch: text("owner_epoch")
    .references(() => gameRunOwners.ownerEpoch),
  eventSequence: integer("event_sequence"),
  sourceKey: text("source_key").notNull(),
  captureSource: text("capture_source").notNull().$type<ProviderSpendCaptureSource>(),
  costSource: text("cost_source").notNull().$type<ProviderSpendCostSource>().default("unavailable"),
  callStatus: text("call_status").notNull().$type<ProviderSpendCallStatus>().default("unknown"),
  callId: text("call_id"),
  attemptOrdinal: integer("attempt_ordinal").notNull().default(1),
  retryParentSourceKey: text("retry_parent_source_key"),
  providerResponseId: text("provider_response_id"),
  traceManifestId: text("trace_manifest_id")
    .references(() => gameEvidenceManifests.id),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  actorRole: text("actor_role"),
  action: text("action"),
  phase: text("phase"),
  round: integer("round"),
  provider: text("provider"),
  providerProfileId: text("provider_profile_id"),
  catalogId: text("catalog_id"),
  modelName: text("model_name"),
  apiSurface: text("api_surface"),
  reasoningPolicy: text("reasoning_policy"),
  requestedReasoningEffort: text("requested_reasoning_effort"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  actualCostMicrousd: bigint("actual_cost_microusd", { mode: "number" }),
  estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
  costCurrency: text("cost_currency").notNull().default("USD"),
  providerNativeUnit: text("provider_native_unit"),
  providerNativeAmount: text("provider_native_amount"),
  pricingSourceId: text("pricing_source_id"),
  rateCardVersion: text("rate_card_version"),
  pricedAt: text("priced_at"),
  latencyMs: integer("latency_ms"),
  routerBilling: jsonb("router_billing").$type<Record<string, unknown>>(),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  observedAt: text("observed_at")
    .notNull()
    .default(sql`now()::text`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_provider_spend_entries_source_key_unique").on(table.sourceKey),
  uniqueIndex("game_provider_spend_entries_trace_manifest_unique")
    .on(table.traceManifestId)
    .where(sql`${table.traceManifestId} IS NOT NULL`),
  index("game_provider_spend_entries_game_id_idx").on(table.gameId, table.createdAt),
  index("game_provider_spend_entries_owner_epoch_idx").on(table.ownerEpoch),
  index("game_provider_spend_entries_trace_manifest_idx").on(table.traceManifestId),
  index("game_provider_spend_entries_cost_source_idx").on(table.costSource),
  index("game_provider_spend_entries_capture_source_idx").on(table.captureSource),
  foreignKey({
    name: "game_provider_spend_entries_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  foreignKey({
    name: "game_provider_spend_entries_event_boundary_fk",
    columns: [table.gameId, table.eventSequence],
    foreignColumns: [gameEvents.gameId, gameEvents.sequence],
  }),
  check("game_provider_spend_entries_capture_source_check", sql`${table.captureSource} IN ('live_trace', 'trace_manifest_backfill', 'terminal_result_backfill', 'manual_adjustment')`),
  check("game_provider_spend_entries_cost_source_check", sql`${table.costSource} IN ('provider_actual', 'router_actual', 'org_reconciled', 'catalog_estimate', 'static_estimate', 'unavailable')`),
  check("game_provider_spend_entries_call_status_check", sql`${table.callStatus} IN ('succeeded', 'failed', 'unknown')`),
  check("game_provider_spend_entries_attempt_check", sql`${table.attemptOrdinal} > 0`),
  check("game_provider_spend_entries_event_sequence_check", sql`${table.eventSequence} IS NULL OR ${table.eventSequence} > 0`),
  check("game_provider_spend_entries_round_check", sql`${table.round} IS NULL OR ${table.round} >= 0`),
  check("game_provider_spend_entries_token_counts_check", sql`
    ${table.promptTokens} >= 0
    AND ${table.cachedTokens} >= 0
    AND ${table.completionTokens} >= 0
    AND ${table.reasoningTokens} >= 0
    AND ${table.totalTokens} >= 0
  `),
  check("game_provider_spend_entries_cost_counts_check", sql`
    (${table.actualCostMicrousd} IS NULL OR ${table.actualCostMicrousd} >= 0)
    AND (${table.estimatedCostMicrousd} IS NULL OR ${table.estimatedCostMicrousd} >= 0)
    AND (${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0)
  `),
]);

export const gameCostRollups = pgTable("game_cost_rollups", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  ownerEpoch: text("owner_epoch")
    .references(() => gameRunOwners.ownerEpoch),
  rollupScope: text("rollup_scope").notNull().$type<GameCostRollupScope>(),
  callCount: integer("call_count").notNull().default(0),
  failedCallCount: integer("failed_call_count").notNull().default(0),
  unpricedCallCount: integer("unpriced_call_count").notNull().default(0),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  actualCostMicrousd: bigint("actual_cost_microusd", { mode: "number" }).notNull().default(0),
  estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }).notNull().default(0),
  providerNativeTotals: jsonb("provider_native_totals").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  breakdowns: jsonb("breakdowns").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  costSourceCounts: jsonb("cost_source_counts").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  captureSourceCounts: jsonb("capture_source_counts").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  firstEntryAt: text("first_entry_at"),
  lastEntryAt: text("last_entry_at"),
  rebuiltAt: text("rebuilt_at")
    .notNull()
    .default(sql`now()::text`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("game_cost_rollups_game_scope_unique").on(table.gameId, table.rollupScope, table.ownerEpoch),
  uniqueIndex("game_cost_rollups_game_total_unique")
    .on(table.gameId)
    .where(sql`${table.rollupScope} = 'game'`),
  index("game_cost_rollups_game_id_idx").on(table.gameId),
  index("game_cost_rollups_owner_epoch_idx").on(table.ownerEpoch),
  foreignKey({
    name: "game_cost_rollups_game_owner_fk",
    columns: [table.gameId, table.ownerEpoch],
    foreignColumns: [gameRunOwners.gameId, gameRunOwners.ownerEpoch],
  }),
  check("game_cost_rollups_scope_check", sql`${table.rollupScope} IN ('game', 'owner_epoch')`),
  check("game_cost_rollups_scope_owner_check", sql`
    (${table.rollupScope} = 'game' AND ${table.ownerEpoch} IS NULL)
    OR (${table.rollupScope} = 'owner_epoch' AND ${table.ownerEpoch} IS NOT NULL)
  `),
  check("game_cost_rollups_counts_check", sql`
    ${table.callCount} >= 0
    AND ${table.failedCallCount} >= 0
    AND ${table.unpricedCallCount} >= 0
    AND ${table.promptTokens} >= 0
    AND ${table.cachedTokens} >= 0
    AND ${table.completionTokens} >= 0
    AND ${table.reasoningTokens} >= 0
    AND ${table.totalTokens} >= 0
    AND ${table.actualCostMicrousd} >= 0
    AND ${table.estimatedCostMicrousd} >= 0
  `),
]);

export const gameCostReconciliations = pgTable("game_cost_reconciliations", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  provider: text("provider"),
  status: text("status").notNull().$type<CostReconciliationStatus>(),
  reconciliationSource: text("reconciliation_source").notNull(),
  reportHash: text("report_hash"),
  internalActualCostMicrousd: bigint("internal_actual_cost_microusd", { mode: "number" }).notNull().default(0),
  internalEstimatedCostMicrousd: bigint("internal_estimated_cost_microusd", { mode: "number" }).notNull().default(0),
  providerActualCostMicrousd: bigint("provider_actual_cost_microusd", { mode: "number" }),
  deltaMicrousd: bigint("delta_microusd", { mode: "number" }),
  costCurrency: text("cost_currency").notNull().default("USD"),
  normalizedDeltas: jsonb("normalized_deltas").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  reconciledAt: text("reconciled_at")
    .notNull()
    .default(sql`now()::text`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_cost_reconciliations_game_id_idx").on(table.gameId, table.createdAt),
  check("game_cost_reconciliations_status_check", sql`${table.status} IN ('matched', 'partial', 'unavailable')`),
  check("game_cost_reconciliations_costs_check", sql`
    ${table.internalActualCostMicrousd} >= 0
    AND ${table.internalEstimatedCostMicrousd} >= 0
    AND (${table.providerActualCostMicrousd} IS NULL OR ${table.providerActualCostMicrousd} >= 0)
  `),
]);

export const gameCostAccountingAuditEvents = pgTable("game_cost_accounting_audit_events", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .references(() => games.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  action: text("action").notNull().$type<CostAccountingAuditAction>(),
  outcome: text("outcome").notNull().$type<CostAccountingAuditOutcome>(),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_cost_accounting_audit_game_id_idx").on(table.gameId, table.createdAt),
  index("game_cost_accounting_audit_actor_idx").on(table.actorUserId, table.createdAt),
  check("game_cost_accounting_audit_action_check", sql`${table.action} IN ('backfill_game', 'rebuild_rollup', 'record_reconciliation')`),
  check("game_cost_accounting_audit_outcome_check", sql`${table.outcome} IN ('succeeded', 'failed', 'denied')`),
]);

// ---------------------------------------------------------------------------
// Postgame Media (durable House Highlights render state)
// ---------------------------------------------------------------------------

export const gamePostgameMedia = pgTable("game_postgame_media", {
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  mediaType: text("media_type").notNull().$type<PostgameMediaType>(),
  status: text("status").notNull().$type<PostgameMediaStatus>().default("queued"),
  renderVersion: integer("render_version").notNull().default(1),
  artifactVersion: text("artifact_version"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  workerIdHash: text("worker_id_hash"),
  leaseTokenHash: text("lease_token_hash"),
  leaseExpiresAt: text("lease_expires_at"),
  claimedAt: text("claimed_at"),
  attemptStartedAt: text("attempt_started_at"),
  attemptFinishedAt: text("attempt_finished_at"),
  failureCategory: text("failure_category"),
  failureMessage: text("failure_message"),
  renderDurationMs: integer("render_duration_ms"),
  renderInputSnapshot: jsonb("render_input_snapshot")
    .$type<unknown>(),
  renderInputSnapshotHash: text("render_input_snapshot_hash"),
  renderInputSnapshotVersion: integer("render_input_snapshot_version"),
  rendererVersion: text("renderer_version"),
  timingContractVersion: text("timing_contract_version"),
  musicAssetId: text("music_asset_id"),
  artifactMetadata: jsonb("artifact_metadata").$type<PostgameMediaArtifactMetadata>(),
  uploadTargetMetadata: jsonb("upload_target_metadata")
    .$type<PostgameMediaUploadTargetMetadata[]>(),
  cueMetadata: jsonb("cue_metadata").$type<Record<string, unknown>>(),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  currentReadyRenderVersion: integer("current_ready_render_version"),
  currentReadyDurationMs: integer("current_ready_duration_ms"),
  currentReadyArtifactMetadata: jsonb("current_ready_artifact_metadata")
    .$type<PostgameMediaArtifactMetadata>(),
  currentReadyPublishedAt: text("current_ready_published_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  primaryKey({ columns: [table.gameId, table.mediaType] }),
  index("game_postgame_media_status_idx").on(table.status, table.updatedAt),
  check("game_postgame_media_type_check", sql`${table.mediaType} IN ('house_highlights_trailer')`),
  check("game_postgame_media_status_check", sql`${table.status} IN ('waiting_inputs', 'waiting_music', 'queued', 'claimed', 'rendering', 'composing', 'uploading', 'ready', 'failed')`),
  check("game_postgame_media_render_version_check", sql`${table.renderVersion} > 0 AND ${table.attemptNumber} > 0`),
  check("game_postgame_media_duration_check", sql`${table.renderDurationMs} IS NULL OR ${table.renderDurationMs} >= 0`),
  check("game_postgame_media_snapshot_provenance_check", sql`
    (${table.renderInputSnapshot} IS NULL
      AND ${table.renderInputSnapshotHash} IS NULL
      AND ${table.renderInputSnapshotVersion} IS NULL
      AND ${table.artifactVersion} IS NULL
      AND ${table.rendererVersion} IS NULL
      AND ${table.timingContractVersion} IS NULL
      AND ${table.musicAssetId} IS NULL)
    OR (${table.renderInputSnapshot} IS NOT NULL
      AND ${table.renderInputSnapshotHash} IS NOT NULL
      AND ${table.renderInputSnapshotVersion} > 0
      AND ${table.artifactVersion} IS NOT NULL
      AND ${table.rendererVersion} IS NOT NULL
      AND ${table.timingContractVersion} IS NOT NULL
      AND ${table.musicAssetId} IS NOT NULL)
  `),
  check("game_postgame_media_current_ready_check", sql`
    (${table.currentReadyRenderVersion} IS NULL
      AND ${table.currentReadyDurationMs} IS NULL
      AND ${table.currentReadyArtifactMetadata} IS NULL
      AND ${table.currentReadyPublishedAt} IS NULL)
    OR (${table.currentReadyRenderVersion} IS NOT NULL
      AND ${table.currentReadyDurationMs} IS NOT NULL
      AND ${table.currentReadyArtifactMetadata} IS NOT NULL
      AND ${table.currentReadyPublishedAt} IS NOT NULL)
  `),
]);

export const gamePostgameMediaAuditEvents = pgTable("game_postgame_media_audit_events", {
  id: text("id").primaryKey(),
  gameId: text("game_id").references(() => games.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  action: text("action").notNull().$type<PostgameMediaAuditAction>(),
  outcome: text("outcome").notNull().$type<PostgameMediaAuditOutcome>(),
  reason: text("reason"),
  source: text("source").notNull(),
  previousRenderVersion: integer("previous_render_version"),
  currentRenderVersion: integer("current_render_version"),
  safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_postgame_media_audit_game_idx").on(table.gameId, table.createdAt),
  index("game_postgame_media_audit_actor_idx").on(table.actorUserId, table.createdAt),
  check("game_postgame_media_audit_action_check", sql`${table.action} IN ('completion_reconcile', 'backfill', 'rerender')`),
  check("game_postgame_media_audit_outcome_check", sql`${table.outcome} IN ('queued', 'waiting_inputs', 'suppressed', 'failed', 'denied')`),
]);

// ---------------------------------------------------------------------------
// Cognitive Artifacts (user-facing split decision artifacts, new games only)
// ---------------------------------------------------------------------------

export const gameCognitiveArtifacts = pgTable("game_cognitive_artifacts", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  captureVersion: integer("capture_version").notNull().default(1),
  eventSequence: integer("event_sequence"),
  artifactType: text("artifact_type").notNull().$type<CognitiveArtifactType>(),
  actorRole: text("actor_role").notNull().$type<CognitiveArtifactActorRole>(),
  actorPlayerId: text("actor_player_id").references(() => gamePlayers.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  actorAgentProfileId: text("actor_agent_profile_id").references(() => agentProfiles.id),
  action: text("action").notNull(),
  phase: text("phase"),
  round: integer("round"),
  visibilityStatus: text("visibility_status").notNull().$type<CognitiveArtifactVisibilityStatus>().default("active"),
  payloadByteLength: integer("payload_byte_length").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
  retentionClass: text("retention_class").notNull().default("debug"),
  redactionStatus: text("redaction_status").notNull().$type<EvidenceRedactionStatus>().default("active"),
  expiresAt: text("expires_at"),
  redactedAt: text("redacted_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_cognitive_artifacts_game_type_actor_idx").on(table.gameId, table.artifactType, table.actorPlayerId),
  index("game_cognitive_artifacts_game_phase_round_idx").on(table.gameId, table.phase, table.round),
  index("game_cognitive_artifacts_game_action_idx").on(table.gameId, table.action),
  index("game_cognitive_artifacts_event_sequence_idx").on(table.gameId, table.eventSequence),
  foreignKey({
    name: "game_cognitive_artifacts_event_boundary_fk",
    columns: [table.gameId, table.eventSequence],
    foreignColumns: [gameEvents.gameId, gameEvents.sequence],
  }),
  check("game_cognitive_artifacts_capture_version_check", sql`${table.captureVersion} > 0`),
  check("game_cognitive_artifacts_artifact_type_check", sql`${table.artifactType} IN ('reasoning', 'thinking', 'strategy')`),
  check("game_cognitive_artifacts_actor_role_check", sql`${table.actorRole} IN ('player', 'juror', 'house', 'system', 'producer')`),
  check("game_cognitive_artifacts_visibility_status_check", sql`${table.visibilityStatus} IN ('active', 'capture_degraded')`),
  check("game_cognitive_artifacts_retention_class_check", sql`${table.retentionClass} IN ('debug', 'audit', 'legal_hold')`),
  check("game_cognitive_artifacts_redaction_status_check", sql`${table.redactionStatus} IN ('active', 'expired', 'redacted')`),
  check("game_cognitive_artifacts_event_sequence_check", sql`${table.eventSequence} IS NULL OR ${table.eventSequence} > 0`),
  check("game_cognitive_artifacts_round_check", sql`${table.round} IS NULL OR ${table.round} >= 0`),
  check("game_cognitive_artifacts_payload_byte_length_check", sql`${table.payloadByteLength} >= 0`),
]);

export const gameCognitiveArtifactReads = pgTable("game_cognitive_artifact_reads", {
  id: serial("id").primaryKey(),
  artifactId: text("artifact_id"),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  actorPlayerId: text("actor_player_id").references(() => gamePlayers.id),
  artifactType: text("artifact_type").$type<CognitiveArtifactType>(),
  accessorUserId: text("accessor_user_id").references(() => users.id),
  authProfile: text("auth_profile"),
  purpose: text("purpose").notNull(),
  outcome: text("outcome").notNull().$type<CognitiveArtifactReadOutcome>(),
  denialReason: text("denial_reason"),
  readAt: text("read_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_cognitive_artifact_reads_artifact_id_idx").on(table.artifactId),
  index("game_cognitive_artifact_reads_game_id_idx").on(table.gameId),
  index("game_cognitive_artifact_reads_accessor_user_id_idx").on(table.accessorUserId),
  foreignKey({
    name: "cognitive_artifact_reads_artifact_fk",
    columns: [table.artifactId],
    foreignColumns: [gameCognitiveArtifacts.id],
  }),
  check("game_cognitive_artifact_reads_artifact_type_check", sql`${table.artifactType} IS NULL OR ${table.artifactType} IN ('reasoning', 'thinking', 'strategy')`),
  check("game_cognitive_artifact_reads_outcome_check", sql`${table.outcome} IN ('allowed', 'denied', 'not_captured', 'not_captured_for_game', 'capture_degraded', 'expired', 'redacted')`),
]);

// ---------------------------------------------------------------------------
// Agent Memories (operational, per-game)
// ---------------------------------------------------------------------------

export const agentMemories = pgTable("agent_memories", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  agentId: text("agent_id").notNull(), // game_player id
  round: integer("round").notNull(),
  memoryType: text("memory_type").notNull(), // ally, threat, note, vote_history, reflection
  subject: text("subject"), // player name or null
  content: text("content").notNull(),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .default(sql`(extract(epoch from now()))::bigint`),
});

// ---------------------------------------------------------------------------
// RBAC — Permissions
// ---------------------------------------------------------------------------

export const permissions = pgTable("permissions", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// RBAC — Roles
// ---------------------------------------------------------------------------

export const roles = pgTable("roles", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystem: integer("is_system").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// RBAC — Role ↔ Permission mapping
// ---------------------------------------------------------------------------

export const rolePermissions = pgTable("role_permissions", {
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  permissionId: text("permission_id")
    .notNull()
    .references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionId] }),
]);

// ---------------------------------------------------------------------------
// RBAC — Wallet Address ↔ Role assignments
// ---------------------------------------------------------------------------

export const addressRoles = pgTable("address_roles", {
  walletAddress: text("wallet_address").notNull(), // lowercase
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by"), // wallet address of granter
  grantedAt: text("granted_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  primaryKey({ columns: [table.walletAddress, table.roleId] }),
]);

// ---------------------------------------------------------------------------
// MCP OAuth — Dynamic Public Clients
// ---------------------------------------------------------------------------

export const mcpOauthClients = pgTable("mcp_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: jsonb("redirect_uris").notNull().$type<string[]>(),
  grantTypes: jsonb("grant_types").notNull().$type<string[]>(),
  responseTypes: jsonb("response_types").notNull().$type<string[]>(),
  scope: text("scope").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  clientUri: text("client_uri"),
  logoUri: text("logo_uri"),
  tosUri: text("tos_uri"),
  policyUri: text("policy_uri"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("mcp_oauth_clients_created_at_idx").on(table.createdAt),
  check("mcp_oauth_clients_scope_check", sql`${table.scope} IN ${MCP_OAUTH_SCOPE_CHECK_SQL}`),
  check("mcp_oauth_clients_token_auth_check", sql`${table.tokenEndpointAuthMethod} = 'none'`),
]);

// ---------------------------------------------------------------------------
// MCP OAuth — Authorization Codes
// ---------------------------------------------------------------------------

export const mcpOauthAuthorizationCodes = pgTable("mcp_oauth_authorization_codes", {
  id: text("id").primaryKey(), // UUID
  codeHash: text("code_hash").notNull().unique(), // sha256:<hex>; raw code is never stored
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  walletAddress: text("wallet_address"),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  resourceUri: text("resource_uri").notNull(),
  scope: text("scope").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("mcp_oauth_authorization_codes_code_hash_unique").on(table.codeHash),
  index("mcp_oauth_authorization_codes_user_id_idx").on(table.userId),
  index("mcp_oauth_authorization_codes_resource_uri_idx").on(table.resourceUri),
  index("mcp_oauth_authorization_codes_expires_at_idx").on(table.expiresAt),
  check("mcp_oauth_authorization_codes_scope_check", sql`${table.scope} IN ${MCP_OAUTH_SCOPE_CHECK_SQL}`),
  check("mcp_oauth_authorization_codes_pkce_method_check", sql`${table.codeChallengeMethod} = 'S256'`),
]);

// ---------------------------------------------------------------------------
// MCP OAuth — Access Tokens
// ---------------------------------------------------------------------------

export const mcpOauthAccessTokens = pgTable("mcp_oauth_access_tokens", {
  id: text("id").primaryKey(), // UUID
  tokenHash: text("token_hash").notNull().unique(), // sha256:<hex>; raw token is never stored
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  walletAddress: text("wallet_address"),
  clientId: text("client_id").notNull(),
  resourceUri: text("resource_uri").notNull(),
  scope: text("scope").notNull(),
  audience: text("audience").notNull(),
  purpose: text("purpose").notNull(),
  refreshTokenId: text("refresh_token_id"),
  refreshTokenFamilyId: text("refresh_token_family_id"),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("mcp_oauth_access_tokens_token_hash_unique").on(table.tokenHash),
  index("mcp_oauth_access_tokens_user_id_idx").on(table.userId),
  index("mcp_oauth_access_tokens_resource_uri_idx").on(table.resourceUri),
  index("mcp_oauth_access_tokens_refresh_token_family_id_idx").on(table.refreshTokenFamilyId),
  index("mcp_oauth_access_tokens_expires_at_idx").on(table.expiresAt),
  check("mcp_oauth_access_tokens_scope_check", sql`${table.scope} IN ${MCP_OAUTH_SCOPE_CHECK_SQL}`),
  check("mcp_oauth_access_tokens_audience_check", sql`${table.audience} = 'game-mcp'`),
  check("mcp_oauth_access_tokens_purpose_check", sql`${table.purpose} = 'mcp_access'`),
]);

// ---------------------------------------------------------------------------
// MCP OAuth — Refresh Tokens
// ---------------------------------------------------------------------------

export const mcpOauthRefreshTokens = pgTable("mcp_oauth_refresh_tokens", {
  id: text("id").primaryKey(), // UUID
  tokenHash: text("token_hash").notNull().unique(), // sha256:<hex>; raw token is never stored
  tokenFamilyId: text("token_family_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  walletAddress: text("wallet_address"),
  clientId: text("client_id").notNull(),
  resourceUri: text("resource_uri").notNull(),
  scope: text("scope").notNull(),
  audience: text("audience").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  replacedAt: text("replaced_at"),
  reusedAt: text("reused_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  uniqueIndex("mcp_oauth_refresh_tokens_token_hash_unique").on(table.tokenHash),
  index("mcp_oauth_refresh_tokens_token_family_id_idx").on(table.tokenFamilyId),
  index("mcp_oauth_refresh_tokens_user_id_idx").on(table.userId),
  index("mcp_oauth_refresh_tokens_resource_uri_idx").on(table.resourceUri),
  index("mcp_oauth_refresh_tokens_expires_at_idx").on(table.expiresAt),
  check("mcp_oauth_refresh_tokens_scope_check", sql`${table.scope} IN ${MCP_OAUTH_REFRESH_SCOPE_CHECK_SQL}`),
  check("mcp_oauth_refresh_tokens_audience_check", sql`${table.audience} = 'game-mcp'`),
  check("mcp_oauth_refresh_tokens_purpose_check", sql`${table.purpose} = 'mcp_access'`),
]);

// ---------------------------------------------------------------------------
// Free Game Queue
// ---------------------------------------------------------------------------

export const freeGameQueue = pgTable("free_game_queue", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  agentProfileId: text("agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id),
  joinedAt: text("joined_at")
    .notNull()
    .default(sql`now()::text`),
  consecutiveMisses: integer("consecutive_misses")
    .notNull()
    .default(0),
});

export const freeQueuePromptSuppressions = pgTable("free_queue_prompt_suppressions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  seasonId: text("season_id")
    .notNull()
    .references(() => seasons.id),
  reason: text("reason").notNull(),
  suppressedUntil: text("suppressed_until"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  check("free_queue_prompt_suppressions_reason_check", sql`${table.reason} IN ('maybe_later', 'left_queue', 'admin_removed')`),
]);

// ---------------------------------------------------------------------------
// Invite Codes
// ---------------------------------------------------------------------------

export const inviteCodes = pgTable("invite_codes", {
  id: text("id").primaryKey(), // UUID
  code: text("code").notNull().unique(), // 8-char alphanumeric code
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id), // User who owns/generated this code
  usedById: text("used_by_id").references(() => users.id), // User who redeemed it
  usedAt: text("used_at"), // Timestamp when redeemed
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// App Settings (global key-value config)
// ---------------------------------------------------------------------------

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded value
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// Free Track Ratings (ELO)
// ---------------------------------------------------------------------------

export const freeTrackRatings = pgTable("free_track_ratings", {
  id: text("id").primaryKey(), // UUID
  agentProfileId: text("agent_profile_id")
    .notNull()
    .unique()
    .references(() => agentProfiles.id),
  userId: text("user_id").references(() => users.id), // denormalized for leaderboard queries
  rating: integer("rating").notNull().default(1200),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesWon: integer("games_won").notNull().default(0),
  peakRating: integer("peak_rating").notNull().default(1200),
  lastGameAt: text("last_game_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()::text`),
});
