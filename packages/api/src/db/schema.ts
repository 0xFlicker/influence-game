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
  minPlayers: integer("min_players").notNull().default(4),
  maxPlayers: integer("max_players").notNull().default(12),
  createdById: text("created_by_id").references(() => users.id),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  hiddenAt: text("hidden_at"), // Soft-delete: non-null means game is hidden from public lists
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

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
});

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
});

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type TranscriptScope = "public" | "mingle" | "whisper" | "system" | "diary" | "thinking";

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
export type EvidenceRedactionStatus = "active" | "expired" | "redacted";

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
  check("mcp_oauth_clients_scope_check", sql`${table.scope} = 'mcp'`),
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
  walletAddress: text("wallet_address").notNull(),
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
  check("mcp_oauth_authorization_codes_scope_check", sql`${table.scope} = 'mcp'`),
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
  walletAddress: text("wallet_address").notNull(),
  clientId: text("client_id").notNull(),
  resourceUri: text("resource_uri").notNull(),
  scope: text("scope").notNull(),
  audience: text("audience").notNull(),
  purpose: text("purpose").notNull(),
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
  index("mcp_oauth_access_tokens_expires_at_idx").on(table.expiresAt),
  check("mcp_oauth_access_tokens_scope_check", sql`${table.scope} = 'mcp'`),
  check("mcp_oauth_access_tokens_audience_check", sql`${table.audience} = 'game-mcp'`),
  check("mcp_oauth_access_tokens_purpose_check", sql`${table.purpose} = 'mcp_access'`),
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
