/**
 * Influence Game — Database Migration Runner
 *
 * Applies Drizzle migrations from the drizzle/ directory.
 * Can be run standalone or imported programmatically.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDB } from "./index.js";
import path from "path";
import fs from "fs";

export async function runMigrations(connectionString?: string) {
  const db = createDB(connectionString);
  // In source: import.meta.dir is src/db/, drizzle/ is ../../drizzle
  // In bundle:  import.meta.dir is dist/,   drizzle/ is ../drizzle
  const bundledPath = path.resolve(import.meta.dir, "../drizzle");
  const sourcePath = path.resolve(import.meta.dir, "../../drizzle");
  const migrationsFolder = fs.existsSync(path.join(bundledPath, "meta/_journal.json"))
    ? bundledPath
    : sourcePath;
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
