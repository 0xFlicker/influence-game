/**
 * Shared test utilities for PostgreSQL-based tests.
 *
 * Provides a setupTestDB helper that connects to a test PG database,
 * runs migrations, and truncates all tables for test isolation.
 */

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createDB, type DrizzleDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";

// Use TEST_DATABASE_URL or hardcoded default — never fall back to DATABASE_URL
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://influence:influence@127.0.0.1:54320/influence_test";

let migrated = false;

const TEST_DB_LOCK_NAMESPACE = 0x494e464c; // "INFL"
const DEFAULT_TEST_DB_LOCK_ID = 0x54455354; // "TEST"
const TEST_DB_LOCK_ID = readTestDatabaseLockId();

type TestDbLockClient = ReturnType<typeof postgres>;
type TestDbLockConnection = Awaited<ReturnType<TestDbLockClient["reserve"]>>;
type TestDbLockLease = {
  client: TestDbLockClient;
  connection: TestDbLockConnection;
};

let processLockPromise: Promise<TestDbLockLease> | null = null;

function readTestDatabaseLockId(): number {
  const rawOverride = process.env.INFLUENCE_TEST_DB_ADVISORY_LOCK_ID;
  if (rawOverride === undefined) return DEFAULT_TEST_DB_LOCK_ID;

  const lockId = Number(rawOverride);
  if (!Number.isInteger(lockId) || lockId < 1 || lockId > 0x7fffffff) {
    throw new Error("INFLUENCE_TEST_DB_ADVISORY_LOCK_ID must be a positive 32-bit integer");
  }
  return lockId;
}

async function acquireTestDatabaseProcessLock(): Promise<void> {
  const lockPromise = processLockPromise ??= createTestDatabaseProcessLock();
  try {
    await lockPromise;
  } catch (error) {
    if (processLockPromise === lockPromise) processLockPromise = null;
    throw error;
  }
}

async function createTestDatabaseProcessLock(): Promise<TestDbLockLease> {
  const client = postgres(TEST_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  let connection: TestDbLockConnection | null = null;
  try {
    connection = await client.reserve();
    await connection`
      SELECT pg_advisory_lock(
        ${TEST_DB_LOCK_NAMESPACE},
        ${TEST_DB_LOCK_ID}
      )
    `;
    return { client, connection };
  } catch (error) {
    connection?.release();
    await client.end({ timeout: 1 });
    throw error;
  }
}

/**
 * Set up a test database connection.
 * Serializes Bun processes with a PostgreSQL session advisory lock, runs migrations
 * once per process, then truncates all Influence tables for isolation.
 */
export async function setupTestDB(): Promise<DrizzleDB> {
  await acquireTestDatabaseProcessLock();
  if (!migrated) {
    await runMigrations(TEST_DATABASE_URL);
    migrated = true;
  }
  const db = createDB(TEST_DATABASE_URL);
  await truncateAll(db);
  return db;
}

// All Influence table names (from schema) — truncate only these, not unrelated tables.
const INFLUENCE_TABLES = [
  "agent_learning_events",
  "agent_learning_review_applications",
  "agent_learning_review_calls",
  "agent_learning_review_games",
  "agent_learning_moment_evidence",
  "agent_learning_reviews",
  "agent_learning_game_evidence",
  "agent_learning_review_entitlements",
  "mcp_oauth_access_tokens",
  "mcp_oauth_refresh_tokens",
  "mcp_oauth_authorization_codes",
  "mcp_oauth_clients",
  "authentication_credentials",
  "verified_email_claims",
  "game_cognitive_artifact_reads",
  "game_cognitive_artifacts",
  "game_cost_accounting_audit_events",
  "game_cost_reconciliations",
  "game_cost_rollups",
  "game_provider_spend_entries",
  "game_evidence_manifest_reads",
  "game_evidence_manifests",
  "game_checkpoints",
  "game_completion_settlement_attempts",
  "game_completion_settlements",
  "game_transcript_states",
  "game_watch_state_summaries",
  "game_events",
  "game_run_owners",
  "deployment_recovery_reconciliations",
  "deployment_admission_leases",
  "deployment_admission_state",
  "season_honors",
  "competition_receipt_evidence",
  "competition_receipts",
  "competition_rating_events",
  "agent_competition_ratings",
  "free_track_ratings",
  "free_queue_prompt_suppressions",
  "free_game_queue",
  "avatar_change_events",
  "avatar_generation_requests",
  "agent_memories",
  "transcripts",
  "game_results",
  "game_players",
  "agent_revisions",
  "agent_profiles",
  "games",
  "seasons",
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
