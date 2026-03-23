/**
 * Influence Game — Database Migration Runner
 *
 * Applies Drizzle migrations from the directory specified by DRIZZLE_MIGRATIONS_DIR.
 * Can be run standalone or imported programmatically.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDB } from "./index.js";

export async function runMigrations(connectionString?: string) {
  const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_DIR;
  if (!migrationsFolder) {
    throw new Error(
      "DRIZZLE_MIGRATIONS_DIR is not set. Set it to the path of the drizzle migrations directory."
    );
  }
  const db = createDB(connectionString);
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
