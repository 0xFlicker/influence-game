/**
 * Influence Game — Database Schema
 *
 * Drizzle ORM schema for PostgreSQL.
 * Tables: users, games, game_players, transcripts, game_results, agent_profiles,
 *         permissions, roles, role_permissions, address_roles
 */

import { pgTable, text, integer, primaryKey, serial, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(), // UUID
  walletAddress: text("wallet_address").unique(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()::text`),
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled";
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

export type TranscriptScope = "public" | "whisper" | "system" | "diary";

export const transcripts = pgTable("transcripts", {
  id: serial("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  round: integer("round").notNull(),
  phase: text("phase").notNull(), // Phase enum value
  fromPlayerId: text("from_player_id"), // null for system messages
  scope: text("scope").notNull().$type<TranscriptScope>().default("public"),
  toPlayerIds: text("to_player_ids"), // JSON array for whispers, null otherwise
  text: text("text").notNull(),
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
