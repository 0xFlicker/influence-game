/**
 * E2E Test Database Lifecycle
 *
 * Creates one PostgreSQL database per browser test process, runs all Drizzle
 * migrations, seeds RBAC tables, and drops the database during cleanup.
 */

import type { DrizzleDB } from "../db/index.js";
import { closeDB, createDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { cleanupE2eResources } from "./cleanup.js";

// Use TEST_DATABASE_URL or hardcoded default — never fall back to DATABASE_URL
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://influence:influence@127.0.0.1:54320/influence_test";

export interface TestDB {
  db: DrizzleDB;
  databaseUrl: string;
}

export interface CreateIsolatedTestDbOptions {
  signal?: AbortSignal;
}

/**
 * Create a per-run PostgreSQL database for browser harnesses that may execute
 * beside the DB suite. The shared influence_test database is intentionally not
 * touched.
 */
export async function createIsolatedTestDb(
  options: CreateIsolatedTestDbOptions = {},
): Promise<TestDB> {
  const databaseName = `influence_e2e_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = withDatabaseName(TEST_DATABASE_URL, databaseName);
  const admin = postgres(withDatabaseName(TEST_DATABASE_URL, "postgres"), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  let abortCleanup: Promise<void> | null = null;
  const destroyOnAbort = () => {
    abortCleanup ??= destroyIsolatedTestDb(databaseUrl);
  };
  options.signal?.addEventListener("abort", destroyOnAbort, { once: true });
  if (options.signal?.aborted) destroyOnAbort();

  try {
    if (options.signal?.aborted) throw new Error("Isolated database startup aborted");
    await runMigrations(databaseUrl);
    if (options.signal?.aborted) throw new Error("Isolated database startup aborted");
    const db = createDB(databaseUrl);
    await seedRBAC(db);
    if (options.signal?.aborted) throw new Error("Isolated database startup aborted");
    return { db, databaseUrl };
  } catch (error) {
    try {
      await (abortCleanup ?? destroyIsolatedTestDb(databaseUrl));
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Isolated database startup and cleanup both failed",
      );
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", destroyOnAbort);
  }
}

export async function destroyIsolatedTestDb(databaseUrl: string): Promise<void> {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!/^influence_e2e_[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing to drop non-isolated test database: ${databaseName}`);
  }
  await cleanupE2eResources([
    ["cached database connection", () => withTimeout(
      closeDB(databaseUrl),
      5_000,
      "Timed out closing isolated database connection",
    )],
    ["isolated database", async () => {
      const admin = postgres(withDatabaseName(TEST_DATABASE_URL, "postgres"), { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }],
  ]);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}
