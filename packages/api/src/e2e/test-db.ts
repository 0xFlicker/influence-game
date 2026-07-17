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
import { randomUUID } from "node:crypto";
import postgres from "postgres";

// Use TEST_DATABASE_URL or hardcoded default — never fall back to DATABASE_URL
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://influence:influence@127.0.0.1:54320/influence_test";

export interface TestDB {
  db: DrizzleDB;
  databaseUrl: string;
}

let migrated = false;

// All Influence table names — truncate only these, not unrelated tables.
const INFLUENCE_TABLES = [
  "app_settings",
  "invite_codes",
  "free_track_ratings",
  "free_queue_prompt_suppressions",
  "free_game_queue",
  "mcp_oauth_refresh_tokens",
  "mcp_oauth_access_tokens",
  "mcp_oauth_authorization_codes",
  "mcp_oauth_clients",
  "address_roles",
  "role_permissions",
  "roles",
  "permissions",
  "agent_memories",
  "game_cognitive_artifact_reads",
  "game_cognitive_artifacts",
  "game_postgame_media_audit_events",
  "game_postgame_media",
  "game_cost_accounting_audit_events",
  "game_cost_reconciliations",
  "game_cost_rollups",
  "game_provider_spend_entries",
  "game_evidence_manifest_reads",
  "game_evidence_manifests",
  "game_checkpoints",
  "game_watch_state_summaries",
  "game_completion_settlement_attempts",
  "game_completion_settlements",
  "game_events",
  "game_run_owners",
  "season_honors",
  "competition_receipt_evidence",
  "competition_receipts",
  "competition_rating_events",
  "competition_rating_snapshots",
  "agent_competition_ratings",
  "transcripts",
  "game_results",
  "game_players",
  "avatar_change_events",
  "avatar_generation_requests",
  "agent_revisions",
  "agent_profiles",
  "games",
  "seasons",
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
 * Create a per-run PostgreSQL database for browser harnesses that may execute
 * beside the DB suite. The shared influence_test database is intentionally not
 * touched.
 */
export async function createIsolatedTestDb(): Promise<TestDB> {
  const databaseName = `influence_e2e_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = withDatabaseName(TEST_DATABASE_URL, databaseName);
  const admin = postgres(withDatabaseName(TEST_DATABASE_URL, "postgres"), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  try {
    await runMigrations(databaseUrl);
    const db = createDB(databaseUrl);
    await seedRBAC(db);
    return { db, databaseUrl };
  } catch (error) {
    await destroyIsolatedTestDb(databaseUrl);
    throw error;
  }
}

export async function destroyIsolatedTestDb(databaseUrl: string): Promise<void> {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!/^influence_e2e_[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing to drop non-isolated test database: ${databaseName}`);
  }
  const admin = postgres(withDatabaseName(TEST_DATABASE_URL, "postgres"), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * No-op for PostgreSQL — no file cleanup needed.
 * Kept for API compatibility with existing e2e test suites.
 */
export function destroyTestDb(_databaseUrl: string): void {
  // Nothing to clean up for PostgreSQL (no temp files)
}
