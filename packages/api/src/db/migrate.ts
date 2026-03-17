/**
 * Influence Game — Database Migration Runner
 *
 * Applies Drizzle migrations from the drizzle/ directory.
 * Can be run standalone or imported programmatically.
 */

import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDB } from "./index.js";
import path from "path";

export function runMigrations(dbPath?: string) {
  const db = createDB(dbPath);
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
  return db;
}

// Run directly: bun run src/db/migrate.ts
if (import.meta.main) {
  const dbPath = process.env.SQLITE_PATH ?? "influence.db";
  runMigrations(dbPath);
}
