import postgres from "postgres";
import { accountEmailKeyCheck, hashAccountEmail } from "../lib/verified-email.js";
import { containsEmailLike } from "../lib/display-name.js";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const MIGRATION_LOCK_NAMESPACE = 0x494e464c; // INFL
export const MIGRATION_LOCK_ID = 0x4d494752; // MIGR
const EMAIL_BACKFILL = "-- account-email-hash-backfill-v1";

/**
 * Keep the Drizzle journal contract, but acquire the database-wide lock BEFORE
 * its bootstrap/read. Drizzle's stock migrator reads the journal before opening
 * its transaction; locking only its DDL transaction therefore does not suffice.
 * postgres.begin pins one backend and rejects connection loss rather than
 * transparently continuing unlocked on another pooled connection.
 */
export async function applyMigrationsSerialized(connectionString: string, migrationsFolder: string, options: { accountEmailCutover?: boolean; verifyWritersStopped?: boolean } = {}): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  const emailMigration = migrations.find(m => m.sql.some(statement => statement.trim() === EMAIL_BACKFILL));
  const client = postgres(connectionString, { max: 1, connection: { application_name: "influence-migrator" } });
  try {
    // A waiter must see the preceding owner's committed journal after waking,
    // even if this database has a different default transaction isolation.
    await client.begin("isolation level read committed", async tx => {
      await tx.unsafe("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
      await tx.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
      await tx.unsafe("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
      const [last] = await tx.unsafe<{created_at: string}[]>("SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1");
      if (options.verifyWritersStopped) {
        const [connection] = await tx.unsafe(`
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND backend_type = 'client backend' AND pid <> pg_backend_pid() LIMIT 1`);
        if (connection) throw new Error("Disconnect all account database clients before cutover");
      }
      for (const migration of migrations) {
        if (last && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) {
          if (statement.trim() === EMAIL_BACKFILL) {
            if (last && !options.accountEmailCutover) throw new Error("Account email migration requires a stopped-writer cutover");
            await backfillAccountEmails(tx);
          } else {
            await tx.unsafe(statement);
          }
        }
        await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
      }
      if (emailMigration) {
        const [record] = await tx.unsafe<{ hash: string }[]>(
          "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [emailMigration.folderMillis]);
        if (record?.hash !== emailMigration.hash) throw new Error("Account email migration journal does not match this release");
        const [check] = await tx.unsafe<{ key_check: string }[]>("SELECT key_check FROM drizzle.account_email_hash_config WHERE id = true");
        if (!check || check.key_check !== accountEmailKeyCheck()) throw new Error("Account email hash key does not match this database");
      }
    });
  } finally {
    // COMMIT/ROLLBACK (or backend death) releases the transaction lock. Close
    // this dedicated migration connection on every path; never return it to an
    // application pool with session-level state attached.
    await client.end({ timeout: 5 });
  }
}

async function backfillAccountEmails(tx: postgres.TransactionSql) {
  const keyCheck = accountEmailKeyCheck();
  let after = "(0,0)";
  for (;;) {
    const users: { locator: string; email: string | null; display_name: string | null }[] = await tx.unsafe(
      `SELECT ctid::text AS locator, email, display_name FROM users
      WHERE ctid > $1::tid AND legacy_email_hash IS NULL AND (email IS NOT NULL OR display_name IS NOT NULL)
      ORDER BY ctid LIMIT 250`, [after]);
    if (!users.length) break;
    for (const user of users) {
      const hash = user.email?.trim() ? hashAccountEmail(user.email) : null;
      const name = containsEmailLike(user.display_name) ? null : user.display_name;
      if (hash === null && name === user.display_name) continue;
      await tx.unsafe("UPDATE users SET legacy_email_hash = $1, display_name = $2 WHERE ctid = $3::tid",
        [hash, name, user.locator]);
    }
    after = users.at(-1)!.locator;
  }
  after = "(0,0)";
  for (;;) {
    const claims: { locator: string; normalized_email: string }[] = await tx.unsafe(
      `SELECT ctid::text AS locator, normalized_email FROM verified_email_claims
      WHERE ctid > $1::tid AND email_hash IS NULL ORDER BY ctid LIMIT 250`, [after]);
    if (!claims.length) break;
    for (const claim of claims) {
      const hash = hashAccountEmail(claim.normalized_email);
      await tx.unsafe("UPDATE verified_email_claims SET email_hash = $1 WHERE ctid = $2::tid", [hash, claim.locator]);
    }
    after = claims.at(-1)!.locator;
  }
  const [coverage] = await tx.unsafe<{ missing: string }[]>(`
    SELECT (SELECT count(*) FROM users WHERE email ~ '[^[:space:]]' AND legacy_email_hash IS NULL)
      + (SELECT count(*) FROM verified_email_claims WHERE email_hash IS NULL) AS missing`);
  if (Number(coverage?.missing) !== 0) throw new Error("Account email hash coverage is incomplete");
  const [collision] = await tx.unsafe("SELECT 1 FROM verified_email_claims GROUP BY email_hash HAVING count(*) > 1 LIMIT 1");
  if (collision) throw new Error("Existing email claims conflict after normalization");
  await tx.unsafe("INSERT INTO drizzle.account_email_hash_config (id, key_check) VALUES (true, $1)", [keyCheck]);
}
