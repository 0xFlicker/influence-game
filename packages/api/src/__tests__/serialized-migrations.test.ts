import { expect, test } from "bun:test";
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrationsSerialized, MIGRATION_LOCK_ID, MIGRATION_LOCK_NAMESPACE } from "../db/serialized-migrations.js";

// Each test owns an empty, uniquely named DB. Never call the shared truncation
// helper or load the application migration set against a developer database.
async function fixture(run: (input: {url:string; folder:string; observer:postgres.Sql; sql:(body:string)=>void}) => Promise<void>) {
  const base = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test");
  base.pathname = "/postgres";
  const admin = postgres(base.toString(),{max:1,onnotice:()=>{}});
  const name = `migration_race_${randomUUID().replaceAll("-","")}`;
  const folder = mkdtempSync(path.join(tmpdir(),"influence-migration-race-"));
  mkdirSync(path.join(folder,"meta"));
  writeFileSync(path.join(folder,"meta/_journal.json"),JSON.stringify({version:"7",dialect:"postgresql",entries:[{idx:0,version:"7",when:1,tag:"0000_probe",breakpoints:true}]}));
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  base.pathname = `/${name}`;
  const observer = postgres(base.toString(),{max:1,onnotice:()=>{}});
  try {await run({url:base.toString(),folder,observer,sql:body=>writeFileSync(path.join(folder,"0000_probe.sql"),body)});}
  finally {await observer.end();await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();rmSync(folder,{recursive:true,force:true});}
}
function child(url: string, folder: string) {
  return Bun.spawn([process.execPath,"--eval",`import {runMigrations} from ${JSON.stringify(new URL("../db/migrate.ts",import.meta.url).pathname)};import {closeDB} from ${JSON.stringify(new URL("../db/index.ts",import.meta.url).pathname)};await runMigrations(process.env.MIGRATION_TEST_URL);await closeDB(process.env.MIGRATION_TEST_URL);`],{
    env:{...process.env,MIGRATION_TEST_URL:url,DRIZZLE_MIGRATIONS_DIR:folder},stdout:"pipe",stderr:"pipe",
  });
}
async function waitFor(check:()=>Promise<boolean>, timeout=10000) {
  const until=Date.now()+timeout;
  while(Date.now()<until){if(await check())return;await Bun.sleep(25);}
  throw new Error("Timed out waiting for disposable migrator");
}
const probe = `CREATE TABLE migration_probe (backend integer, locked boolean);
--> statement-breakpoint
INSERT INTO migration_probe SELECT pg_backend_pid(), EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=${MIGRATION_LOCK_NAMESPACE} AND objid=${MIGRATION_LOCK_ID} AND granted);`;

test("fresh concurrent process migrations share one lock, backend and journal decision", async()=>fixture(async f=>{
  f.sql(`${probe}\n--> statement-breakpoint\nSELECT pg_sleep(0.5);`);
  const a=child(f.url,f.folder),b=child(f.url,f.folder);
  try {
    const results=await Promise.all([a.exited,b.exited]);
    if(results.some(code=>code!==0)) throw new Error(await new Response(a.stderr).text()+await new Response(b.stderr).text());
    expect(results).toEqual([0,0]);
    const rows=await f.observer`SELECT * FROM migration_probe`;expect(rows).toHaveLength(1);expect(rows[0]!.locked).toBe(true);
    expect(await f.observer`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(1);
    await applyMigrationsSerialized(f.url,f.folder);
    expect(await f.observer`SELECT * FROM migration_probe`).toHaveLength(1);
    expect(await f.observer`SELECT * FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=${MIGRATION_LOCK_NAMESPACE} AND objid=${MIGRATION_LOCK_ID}`).toHaveLength(0);
  } finally {a.kill();b.kill();await Promise.all([a.exited,b.exited]);}
}),30000);

test("failed SQL rolls back bootstrap and DDL and releases the migration lock", async()=>fixture(async f=>{
  f.sql(`${probe}\n--> statement-breakpoint\nSELECT 1/0;`);
  await expect(applyMigrationsSerialized(f.url,f.folder)).rejects.toThrow();
  const [row]=await f.observer`SELECT to_regclass('public.migration_probe') AS probe,to_regclass('drizzle.__drizzle_migrations') AS journal`;
  expect(row).toMatchObject({probe:null,journal:null});
  f.sql(probe);await applyMigrationsSerialized(f.url,f.folder);
  expect(await f.observer`SELECT * FROM migration_probe`).toHaveLength(1);
}),30000);

test("killing a lock-owning migrator rolls back its work and lets a waiting process finish",async()=>fixture(async f=>{
  f.sql(`${probe}\n--> statement-breakpoint\nSELECT pg_sleep(5);`);
  const owner=child(f.url,f.folder);let waiter:ReturnType<typeof child>|undefined;
  try {
    let ownerBackend=0;
    await waitFor(async()=>{const [row]=await f.observer`SELECT pid FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=${MIGRATION_LOCK_NAMESPACE} AND objid=${MIGRATION_LOCK_ID} AND granted`;ownerBackend=row?.pid ?? 0;return !!ownerBackend;});
    waiter=child(f.url,f.folder);
    await waitFor(async()=>{const rows=await f.observer`SELECT pid FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=${MIGRATION_LOCK_NAMESPACE} AND objid=${MIGRATION_LOCK_ID} AND NOT granted`;return rows.length===1;});
    owner.kill("SIGKILL");expect(await owner.exited).not.toBe(0);
    expect(await waiter.exited).toBe(0);
    const rows=await f.observer`SELECT * FROM migration_probe`;expect(rows).toHaveLength(1);expect(rows[0]!.backend).not.toBe(ownerBackend);expect(rows[0]!.locked).toBe(true);
    expect(await f.observer`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(1);
    expect(await f.observer`SELECT * FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=${MIGRATION_LOCK_NAMESPACE} AND objid=${MIGRATION_LOCK_ID}`).toHaveLength(0);
  }finally{owner.kill();waiter?.kill();await Promise.all([owner.exited,waiter?.exited]);}
}),30000);

// Upgrade an existing Drizzle journal without rewriting earlier evidence.
test("concurrent upgrades preserve existing rows and append exactly one migration", async () => fixture(async f => {
  f.sql(probe);
  await applyMigrationsSerialized(f.url, f.folder);
  const before = await f.observer`SELECT * FROM drizzle.__drizzle_migrations`;
  const next = "ALTER TABLE migration_probe ADD COLUMN upgraded boolean NOT NULL DEFAULT true;";
  writeFileSync(path.join(f.folder, "0001_upgrade.sql"), next);
  writeFileSync(path.join(f.folder, "meta/_journal.json"), JSON.stringify({version:"7",dialect:"postgresql",entries:[
    {idx:0,version:"7",when:1,tag:"0000_probe",breakpoints:true},
    {idx:1,version:"7",when:2,tag:"0001_upgrade",breakpoints:true},
  ]}));
  const a = child(f.url, f.folder), b = child(f.url, f.folder);
  try {
    expect(await Promise.all([a.exited, b.exited])).toEqual([0, 0]);
    const after = await f.observer`SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at`;
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.hash).toBe(createHash("sha256").update(next).digest("hex"));
    const upgraded = await f.observer`SELECT upgraded FROM migration_probe`;
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]!.upgraded).toBe(true);
  } finally { a.kill(); b.kill(); await Promise.all([a.exited, b.exited]); }
}), 30000);
