/**
 * E2E Test Database Lifecycle
 *
 * Connects to a PostgreSQL test database, runs all Drizzle migrations,
 * seeds RBAC tables, and provides table truncation for isolation.
 */

import type { DrizzleDB } from "../db/index.js";
import { createDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { sql } from "drizzle-orm";

// Use TEST_DATABASE_URL or hardcoded default — never fall back to DATABASE_URL
// which may point to the Paperclip platform database.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://paperclip:paperclip@127.0.0.1:5432/influence_test";

export interface TestDB {
  db: DrizzleDB;
  databaseUrl: string;
}

let migrated = false;

// All Influence table names — truncate only these, not Paperclip system tables
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

/**
 * Create a PostgreSQL test database connection for e2e testing.
 *
 * - Runs all Drizzle migrations (once per process)
 * - Truncates all Influence tables for isolation
 * - Seeds RBAC tables (roles, permissions, role_permissions)
 */
export async function createTestDb(): Promise<TestDB> {
  if (!migrated) {
    await runMigrations(TEST_DATABASE_URL);
    migrated = true;
  }

  const db = createDB(TEST_DATABASE_URL);

  // Truncate only Influence tables for isolation
  const tableList = INFLUENCE_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));

  // Seed RBAC roles and permissions
  await seedRBAC(db);

  return { db, databaseUrl: TEST_DATABASE_URL };
}

/**
 * No-op for PostgreSQL — no file cleanup needed.
 * Kept for API compatibility with existing e2e test suites.
 */
export function destroyTestDb(_databaseUrl: string): void {
  // Nothing to clean up for PostgreSQL (no temp files)
}
