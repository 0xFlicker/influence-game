/**
 * E2E Test Database Lifecycle
 *
 * Creates a temporary SQLite file, runs all Drizzle migrations, seeds RBAC
 * tables, and provides cleanup on teardown.
 */

import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";
import path from "path";
import type { DrizzleDB } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { seedRBAC } from "../db/rbac-seed.js";

export interface TestDB {
  db: DrizzleDB;
  dbPath: string;
}

/**
 * Create a temporary SQLite database for e2e testing.
 *
 * - Creates a file at `/tmp/influence-e2e-{timestamp}-{uuid}.db`
 * - Runs all Drizzle migrations
 * - Seeds RBAC tables (roles, permissions, role_permissions)
 */
export function createTestDb(): TestDB {
  const dbPath = path.join(
    "/tmp",
    `influence-e2e-${Date.now()}-${randomUUID().slice(0, 8)}.db`,
  );

  // runMigrations creates the DB + applies all migrations
  const db = runMigrations(dbPath);

  // Seed RBAC roles and permissions
  seedRBAC(db);

  return { db, dbPath };
}

/**
 * Destroy the temporary test database file.
 */
export function destroyTestDb(dbPath: string): void {
  try {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    // Also clean up WAL and SHM files
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (existsSync(walPath)) unlinkSync(walPath);
    if (existsSync(shmPath)) unlinkSync(shmPath);
  } catch (err) {
    console.warn(`[test-db] Failed to clean up ${dbPath}:`, err);
  }
}
