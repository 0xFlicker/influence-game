/**
 * Influence Game — Database Connection
 *
 * Creates a Drizzle ORM instance backed by Bun's built-in SQLite.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import path from "path";
import * as schema from "./schema.js";

export type DrizzleDB = ReturnType<typeof createDB>;

/** Root of the api package (packages/api/) */
const API_ROOT = path.resolve(import.meta.dir, "../..");

export function createDB(dbPath?: string) {
  const filename = dbPath ?? "influence.db";
  const resolvedPath = path.isAbsolute(filename) ? filename : path.join(API_ROOT, filename);
  const sqlite = new Database(resolvedPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });

  return db;
}

export { schema };
