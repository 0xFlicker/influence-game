/**
 * Influence Game — Database Migration Runner
 *
 * Applies Drizzle migrations from the drizzle/ directory.
 * Can be run standalone or imported programmatically.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDB } from "./index.js";
import path from "path";

export async function runMigrations(connectionString?: string) {
  const db = createDB(connectionString);
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
  return db;
}

// Run directly: bun run src/db/migrate.ts
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  await runMigrations(url);
  process.exit(0);
}
