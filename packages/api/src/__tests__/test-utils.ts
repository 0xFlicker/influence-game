/**
 * Shared test utilities for PostgreSQL-based tests.
 *
 * Provides a setupTestDB helper that connects to a test PG database,
 * runs migrations, and truncates all tables for test isolation.
 */

import { eq, getTableName, is, sql } from "drizzle-orm";
import { legacyWerewolfConfig } from "@influence/engine/werewolf";
import "./payload-test-store.js";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { createDB, schema, type DrizzleDB } from "../db/index.js";
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
    // This explicitly disposable test database may contain old-version fixtures.
    // Empty existing application tables before a data-preserving cutover migration;
    // real development/staging/production bodies must instead be copied and verified.
    const cleanup = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const tables = await cleanup`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
      const known = tables.map(row => String(row.tablename)).filter(name => INFLUENCE_TABLES.some(known => known === name));
      if (known.length) await cleanup.unsafe(`TRUNCATE TABLE ${known.map(name => `"${name.replaceAll('"', '""')}"`).join(",")} CASCADE`);
    } finally { await cleanup.end(); }
    await runMigrations(TEST_DATABASE_URL);
    migrated = true;
  }
  const db = createDB(TEST_DATABASE_URL);
  await truncateAll(db);
  await db.insert(schema.inferencePlans).values([
    {id:'free',name:'Free',policy:{text:100,image:25,renewal:'none',textBurst:5,imageDaily:5,textConcurrency:1,imageConcurrency:1}},
    {id:'faf',name:'Friends and Family',policy:{text:100,image:25,renewal:'monthly',textBurst:5,imageDaily:5,textConcurrency:1,imageConcurrency:1}},
  ]);
  return db;
}

// Derive every Influence table from the Drizzle schema so reset ownership
// grows with schema additions while excluding unrelated database tables.
const INFLUENCE_TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

async function truncateAll(db: DrizzleDB): Promise<void> {
  const tableList = INFLUENCE_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
}

/** Pin a generated Werewolf fixture to its intended historical reducer. */
export async function pinWerewolfRulesVersion(db: DrizzleDB, gameId: string, version: import("@influence/engine/werewolf").WerewolfConfig["rulesVersion"]) {
  const [row] = await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, gameId));
  if (!row || row.event.type !== "werewolf.started") throw new Error("Cannot pin a Werewolf game without its start event");
  const { preset, maxDays, setup } = row.event.payload.config;
  const config = { ...(version < 9 ? legacyWerewolfConfig(preset, maxDays, setup) : row.event.payload.config), rulesVersion: version };
  await db.update(schema.werewolfEvents).set({ event: { ...row.event, payload: { ...row.event.payload, config } } }).where(eq(schema.werewolfEvents.gameId, gameId));
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (game) await db.update(schema.games).set({ config: JSON.stringify({ ...(JSON.parse(game.config ?? "{}") as Record<string, unknown>), rulesVersion: version }) }).where(eq(schema.games.id, gameId));
}

/** Explicit fixture acceptance. Tests exercise the same fenced publisher without a paid provider. */
export async function acceptTestAgent(db: DrizzleDB, agentId: string) {
  const { publishScreenedAgent } = await import("../services/agent-screening-publication.js");
  const { SCREENING_POLICY_VERSION } = await import("../services/agent-screening-policy.js");
  const [before]=await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id,agentId));
  if(!before)throw new Error("Fixture agent is missing");
  if(before.latestContentRevisionId){
    await db.update(schema.agentScreenings).set({status:"completed",recommendation:"no_concern"}).where(sql`${schema.agentScreenings.contentRevisionId}=${before.latestContentRevisionId} AND ${schema.agentScreenings.policyVersion}=${SCREENING_POLICY_VERSION}`);
    return publishScreenedAgent(db,before.latestContentRevisionId);
  }
  return undefined;
}

/** Exercise submit, assessment persistence and publication together for tests about accepted behavior. */
export async function submitAcceptedTestProfile(...args:Parameters<typeof import("../services/agent-profile-management.js").updateOwnedAgentProfile>) {
  const {updateOwnedAgentProfile}=await import("../services/agent-profile-management.js");
  const submission=await updateOwnedAgentProfile(...args);
  const published=await acceptTestAgent(args[0],args[2]);
  return published && "profileRevision" in published ? {...submission,...published}:submission;
}

/** A saved, accepted character fixture for tests whose subject is enrollment or playback. */
export async function createAcceptedTestProfile(...args:Parameters<typeof import("../services/agent-profile-management.js").createOwnedAgentProfile>) {
  const {createOwnedAgentProfile}=await import("../services/agent-profile-management.js");
  const submission=await createOwnedAgentProfile(...args);
  const published=await acceptTestAgent(args[0],submission.profile.id);
  if(!published)throw new Error("Fixture character was not accepted");
  return {...submission,...published};
}

export async function applyAcceptedTestReview(...args:Parameters<typeof import("../services/owner-learning-apply.js").applyOwnedOwnerLearningReview>) {
  const {applyOwnedOwnerLearningReview}=await import("../services/owner-learning-apply.js");
  const first=await applyOwnedOwnerLearningReview(...args);
  const [review]=await args[0].select().from(schema.agentLearningReviews).where(eq(schema.agentLearningReviews.id,String(args[1].reviewId)));
  if(review && first.receipt.publication!=="published")await acceptTestAgent(args[0],review.agentProfileId);
  return {...await applyOwnedOwnerLearningReview(...args),replayed:first.replayed};
}
