/**
 * Influence Game — Database Schema
 *
 * Drizzle ORM schema for SQLite (better-sqlite3).
 * Tables: users, games, game_players, transcripts, game_results, agent_profiles
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUID
  walletAddress: text("wallet_address").unique(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "in_progress" | "completed" | "cancelled";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(), // UUID
  slug: text("slug").unique(), // Human-readable identifier, e.g. "punk-green-apple"
  config: text("config").notNull(), // JSON-serialized GameConfig
  status: text("status").notNull().$type<GameStatus>().default("waiting"),
  minPlayers: integer("min_players").notNull().default(4),
  maxPlayers: integer("max_players").notNull().default(12),
  createdById: text("created_by_id").references(() => users.id),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Agent Profiles (saved, reusable player agent identities)
// ---------------------------------------------------------------------------

export const agentProfiles = sqliteTable("agent_profiles", {
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
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Game Players
// ---------------------------------------------------------------------------

export const gamePlayers = sqliteTable("game_players", {
  id: text("id").primaryKey(), // UUID
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  userId: text("user_id").references(() => users.id),
  agentProfileId: text("agent_profile_id").references(() => agentProfiles.id), // Link to saved agent profile
  persona: text("persona").notNull(), // JSON: { name, personality, strategyHints }
  agentConfig: text("agent_config").notNull(), // JSON: { model, temperature, etc. }
  joinedAt: text("joined_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type TranscriptScope = "public" | "whisper" | "system" | "diary";

export const transcripts = sqliteTable("transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id),
  round: integer("round").notNull(),
  phase: text("phase").notNull(), // Phase enum value
  fromPlayerId: text("from_player_id"), // null for system messages
  scope: text("scope").notNull().$type<TranscriptScope>().default("public"),
  toPlayerIds: text("to_player_ids"), // JSON array for whispers, null otherwise
  text: text("text").notNull(),
  timestamp: integer("timestamp").notNull(), // Unix ms
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Game Results
// ---------------------------------------------------------------------------

export const gameResults = sqliteTable("game_results", {
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
    .default(sql`(datetime('now'))`),
});
