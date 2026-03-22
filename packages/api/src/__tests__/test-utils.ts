/**
 * Shared test utilities for PostgreSQL-based tests.
 *
 * Provides a setupTestDB helper that connects to a test PG database,
 * runs migrations, and truncates all tables for test isolation.
 */

import { sql } from "drizzle-orm";
import { createDB, type DrizzleDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";

// Use TEST_DATABASE_URL or hardcoded default — never fall back to DATABASE_URL
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://influence:influence@127.0.0.1:54320/influence_test";

let migrated = false;

/**
 * Set up a test database connection.
 * Runs migrations once per process, then truncates all Influence tables for isolation.
 */
export async function setupTestDB(): Promise<DrizzleDB> {
  if (!migrated) {
    await runMigrations(TEST_DATABASE_URL);
    migrated = true;
  }
  const db = createDB(TEST_DATABASE_URL);
  await truncateAll(db);
  return db;
}

// All Influence table names (from schema) — truncate only these, not Paperclip system tables
const INFLUENCE_TABLES = [
  "free_track_ratings",
  "free_game_queue",
  "agent_memories",
  "transcripts",
  "game_results",
  "game_players",
  "agent_profiles",
  "games",
  "address_roles",
  "role_permissions",
  "roles",
  "permissions",
  "users",
];

async function truncateAll(db: DrizzleDB): Promise<void> {
  const tableList = INFLUENCE_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
}
