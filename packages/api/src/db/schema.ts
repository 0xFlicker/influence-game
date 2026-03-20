/**
 * Influence Game — Database Schema
 *
 * Drizzle ORM schema for SQLite (better-sqlite3).
 * Tables: users, games, game_players, transcripts, game_results, agent_profiles,
 *         payments, payouts
 */

import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
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

export type PayoutGameStatus = "none" | "pending" | "paid";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(), // UUID
  slug: text("slug").unique(), // Human-readable identifier, e.g. "punk-green-apple"
  config: text("config").notNull(), // JSON-serialized GameConfig
  status: text("status").notNull().$type<GameStatus>().default("waiting"),
  minPlayers: integer("min_players").notNull().default(4),
  maxPlayers: integer("max_players").notNull().default(12),
  createdById: text("created_by_id").references(() => users.id),
  // Buy-in / monetization fields
  tierId: text("tier_id"), // Pricing tier: free, standard, premium, showcase
  buyInAmount: real("buy_in_amount"), // Buy-in per player in USD cents
  prizePool: real("prize_pool").default(0), // Accumulated prize pool in USD cents
  rakeAmount: real("rake_amount").default(0), // Total rake taken in USD cents
  payoutStatus: text("payout_status").$type<PayoutGameStatus>(), // none | pending | paid
  freeEntry: integer("free_entry").default(0), // 1 = free game, 0 = paid
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
  paymentId: text("payment_id").references(() => payments.id), // Link to buy-in payment
  modelUpgrade: integer("model_upgrade").default(0), // 1 = upgraded AI model
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

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentCurrency = "usd" | "eth" | "usdc";
export type PaymentMethod = "stripe" | "crypto";
export type PaymentStatus = "pending" | "confirmed" | "failed" | "refunded";

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  gameId: text("game_id").references(() => games.id),
  amount: real("amount").notNull(), // Decimal amount (e.g. 5.00 for $5)
  currency: text("currency").notNull().$type<PaymentCurrency>(),
  method: text("method").notNull().$type<PaymentMethod>(),
  stripePaymentIntentId: text("stripe_payment_intent_id"), // Stripe PI ID when method=stripe
  txHash: text("tx_hash"), // On-chain tx hash when method=crypto
  status: text("status").notNull().$type<PaymentStatus>().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export type PayoutStatus = "pending" | "confirmed" | "failed";

export const payouts = sqliteTable("payouts", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  gameId: text("game_id").references(() => games.id),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().$type<PaymentCurrency>(),
  method: text("method").notNull().$type<PaymentMethod>(),
  txHash: text("tx_hash"),
  status: text("status").notNull().$type<PayoutStatus>().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// RBAC — Permissions
// ---------------------------------------------------------------------------

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// RBAC — Roles
// ---------------------------------------------------------------------------

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystem: integer("is_system").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// RBAC — Role ↔ Permission mapping
// ---------------------------------------------------------------------------

export const rolePermissions = sqliteTable("role_permissions", {
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

export const addressRoles = sqliteTable("address_roles", {
  walletAddress: text("wallet_address").notNull(), // lowercase
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by"), // wallet address of granter
  grantedAt: text("granted_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.walletAddress, table.roleId] }),
]);
