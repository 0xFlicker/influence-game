import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const MIGRATION_LOCK_NAMESPACE = 0x494e464c; // INFL
export const MIGRATION_LOCK_ID = 0x4d494752; // MIGR

/**
 * Keep the Drizzle journal contract, but acquire the database-wide lock BEFORE
 * its bootstrap/read. Drizzle's stock migrator reads the journal before opening
 * its transaction; locking only its DDL transaction therefore does not suffice.
 * postgres.begin pins one backend and rejects connection loss rather than
 * transparently continuing unlocked on another pooled connection.
 */
export async function applyMigrationsSerialized(connectionString: string, migrationsFolder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  const client = postgres(connectionString, { max: 1, connection: { application_name: "influence-migrator" } });
  try {
    // A waiter must see the preceding owner's committed journal after waking,
    // even if this database has a different default transaction isolation.
    await client.begin("isolation level read committed", async tx => {
      await tx.unsafe("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
      await tx.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
      await tx.unsafe("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
      const [last] = await tx.unsafe<{created_at: string}[]>("SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1");
      for (const migration of migrations) {
        if (last && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
      }
    });
  } finally {
    // COMMIT/ROLLBACK (or backend death) releases the transaction lock. Close
    // this dedicated migration connection on every path; never return it to an
    // application pool with session-level state attached.
    await client.end({ timeout: 5 });
  }
}
