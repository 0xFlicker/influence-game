# Serialize gateway and worker migrations

Both API roles invoke `runMigrations` on startup. Previously the Drizzle migrator
read its journal before its DDL transaction. Concurrent gateway/worker starts
could both decide to apply the same migration, producing PostgreSQL duplicate
catalog-type errors even with `CREATE TABLE IF NOT EXISTS`.

`applyMigrationsSerialized` uses one dedicated postgres.js transaction/backend.
It acquires the database-scoped transaction advisory lock `(0x494e464c,
0x4d494752)` before journal schema/table bootstrap, journal read, migration SQL
and journal writes. READ COMMITTED makes the waiter observe the preceding
owner's commit, regardless of the database's default isolation. Migration files,
hashes, ordering and the existing Drizzle journal contract remain unchanged.

Commit, SQL failure, connection loss and process death release the lock; failed
DDL and journal writes roll back together. The dedicated connection closes on
all paths. Application pools are created/reused only after migration succeeds.
All concurrent migrators must use this entry point; old binaries or direct
third-party migration commands do not participate in its lock.

Do not repair a duplicate-catalog error by deleting tables or journal rows.
Inspect committed schema and journal evidence first. If another process already
completed the migration, restarting only the failed service is sufficient.

Verification: `serialized-migrations.test.ts` creates its own uniquely named
disposable databases and runs actual startup entry points in separate processes.
It covers concurrent first startup, existing-journal upgrade, idempotent replay,
SQL failure rollback, SIGKILL of the lock holder, waiter continuation, same-backend
lock evidence and lock release. No developer database is copied or modified.
