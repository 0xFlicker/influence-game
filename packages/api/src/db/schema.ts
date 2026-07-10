/**
 * Influence Game — Database Schema
 *
 * Drizzle ORM schema for PostgreSQL.
 * Tables: users, games, game_players, transcripts, game_results, agent_profiles,
 *         permissions, roles, role_permissions, address_roles
 */

import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

export const games = pgTable("games", {
  id: text("id").primaryKey(), // UUID
  slug: text("slug").unique(), // Human-readable identifier, e.g. "punk-green-apple"
  config: text("config").notNull(), // JSON-serialized GameConfig
  status: text("status").notNull().$type<GameStatus>().default("waiting"),
  trackType: text("track_type").notNull().$type<TrackType>().default("custom"),
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
  index("games_status_ended_at_idx").on(table.status, table.endedAt),
  index("games_status_ended_created_idx").on(table.status, table.endedAt, table.createdAt),
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
]);

export type AvatarGenerationPurpose = "agent_profile_completion";
export type AvatarGenerationStatus = "queued" | "processing" | "completed" | "skipped" | "failed";
export type AvatarGenerationTriggerSource =
  | "web_user_prompt"
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
  check("avatar_generation_requests_trigger_source_check", sql`${table.triggerSource} IN ('web_user_prompt', 'mcp_create_default')`),
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
  persona: text("persona").notNull(), // JSON: { name, personality, strategyHints }
  agentConfig: text("agent_config").notNull(), // JSON: { model, temperature, etc. }
  joinedAt: text("joined_at")
    .notNull()
    .default(sql`now()::text`),
}, (table) => [
  index("game_players_game_id_idx").on(table.gameId),
  index("game_players_user_id_idx").on(table.userId),
  index("game_players_agent_profile_id_idx").on(table.agentProfileId),
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
// Durable Game Run Kernel
// ---------------------------------------------------------------------------

export type DurableRunSource = "api" | "simulation_import";
export type GameRunOwnerStatus = "active" | "closed" | "revoked" | "expired";
export type KernelHealthStatus = "healthy" | "degraded" | "suspended";
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

export const gameWatchStateSummaries = pgTable("game_watch_state_summaries", {
  gameId: text("game_id")
    .primaryKey()
    .references(() => games.id),
  slug: text("slug"),
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
    .notNull()
    .$type<unknown>(),
  renderInputSnapshotHash: text("render_input_snapshot_hash").notNull(),
  renderInputSnapshotVersion: integer("render_input_snapshot_version").notNull(),
  rendererVersion: text("renderer_version").notNull(),
  timingContractVersion: text("timing_contract_version").notNull(),
  musicAssetId: text("music_asset_id").notNull(),
  artifactMetadata: jsonb("artifact_metadata").$type<PostgameMediaArtifactMetadata>(),
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
  check("game_postgame_media_snapshot_version_check", sql`${table.renderInputSnapshotVersion} > 0`),
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
});

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
