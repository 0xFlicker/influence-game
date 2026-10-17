import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolveMigrationsFolder } from "../db/migrate.js";
import { auditEmbeddedBinaries, copyPayloads, inventoryPayloads, verifyPayloads } from "../services/storage-payload-migration.js";

const command = process.argv[2];
if (!["inventory", "copy", "verify", "cutover"].includes(command ?? "")) throw new Error("Usage: migrate-storage-payloads.ts inventory|copy|verify|cutover --writers-stopped (explicit DATABASE_URL required)");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; migration never chooses an environment implicitly");
const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await client`SELECT pg_advisory_lock(hashtext('storage-payload-migration-v1'))`;
  if (command === "inventory") { await auditEmbeddedBinaries(client); console.log(JSON.stringify(await inventoryPayloads(client), null, 2)); }
  else if (command === "copy") await copyPayloads(client, console.log);
  else if (command === "verify") console.log(JSON.stringify(await verifyPayloads(client), null, 2));
  else {
    if (!process.argv.includes("--writers-stopped")) throw new Error("Cutover requires all old gateways/workers stopped, including retrying clients; pass --writers-stopped only after that operational drain");
    const [connections] = await client`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`;
    if (connections?.count) throw new Error(`Cutover refused: ${connections.count} other database connections remain`);
    await copyPayloads(client, console.log);
    console.log(JSON.stringify(await verifyPayloads(client), null, 2));
    // One maintenance release. The SQL takes table locks and rechecks every source
    // hash inside the same transaction that replaces bodies and records migration 0119.
    await client`SET influence.storage_cutover='writers-stopped'`;
    const [remaining] = await client`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`;
    if (remaining?.count) throw new Error(`Cutover refused: ${remaining.count} database connections appeared during verification`);
    await migrate(drizzle(client), { migrationsFolder: resolveMigrationsFolder() });
    console.log(JSON.stringify(await verifyPayloads(client), null, 2));
    console.log("Storage cutover verified. Start only the matching new application release.");
  }
} finally { await client.end(); }
