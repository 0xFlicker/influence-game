/**
 * Influence Game — Database Connection
 *
 * Creates a Drizzle ORM instance backed by PostgreSQL via postgres.js.
 * Caches connection pools per URL to avoid connection exhaustion.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type DrizzleDB = ReturnType<typeof createDB>;

const DEFAULT_DATABASE_URL = "postgresql://influence:influence@127.0.0.1:54320/influence_dev";

const poolCache = new Map<string, ReturnType<typeof drizzle>>();

export function createDB(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const existing = poolCache.get(url);
  if (existing) return existing;

  const client = postgres(url);
  const db = drizzle(client, { schema });
  poolCache.set(url, db);
  return db;
}

export { schema };
