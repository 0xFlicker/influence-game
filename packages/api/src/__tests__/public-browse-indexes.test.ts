import { expect, test } from "bun:test";
import postgres from "postgres";
import { checkPublicBrowseIndexes, ensurePublicBrowseIndexes } from "../db/public-browse-indexes.js";
import { setupTestDB } from "./test-utils.js";
import { calculateMigrationSet } from "../db/migrate.js";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test";
const names = ["games_public_browse_order_idx", "games_public_browse_kind_idx", "games_public_browse_status_idx", "games_public_browse_season_idx", "games_public_browse_kind_status_idx"];

async function dropOrder(client: ReturnType<typeof postgres>) {
  await client.unsafe("DROP INDEX CONCURRENTLY IF EXISTS public.games_public_browse_order_idx");
}

test("concurrent browse indexes verify retries and refuse invalid or mismatched existing names", async () => {
  await setupTestDB();
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const name of names) await client.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS public.${name}`);
    await expect(checkPublicBrowseIndexes(url)).rejects.toThrow("is missing");
    await ensurePublicBrowseIndexes(url);
    await checkPublicBrowseIndexes(url);
    await ensurePublicBrowseIndexes(url);
    const rows = await client<{ relname: string; indisvalid: boolean; indisready: boolean }[]>`
      SELECT c.relname,i.indisvalid,i.indisready FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relname=ANY(${names}::text[])`;
    expect(rows).toHaveLength(5); expect(rows.every(row => row.indisvalid && row.indisready)).toBe(true);
    await dropOrder(client);
    await client.unsafe("CREATE INDEX CONCURRENTLY games_public_browse_order_idx ON public.games(id)");
    await expect(ensurePublicBrowseIndexes(url)).rejects.toThrow("invalid or differs");
    await expect(checkPublicBrowseIndexes(url)).rejects.toThrow("invalid or differs");
    await dropOrder(client);
    await client`INSERT INTO public.games(id,slug,status,config) VALUES ('index-a','index-a','waiting','{}'),('index-b','index-b','waiting','{}')`;
    let duplicateRejected = false;
    try { await client.unsafe("CREATE UNIQUE INDEX CONCURRENTLY games_public_browse_order_idx ON public.games(status)"); }
    catch { duplicateRejected = true; }
    expect(duplicateRejected).toBe(true);
    const [invalid] = await client<{ indisvalid: boolean }[]>`SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='games_public_browse_order_idx'`;
    expect(invalid?.indisvalid).toBe(false);
    await expect(ensurePublicBrowseIndexes(url)).rejects.toThrow("invalid or differs");
    await expect(checkPublicBrowseIndexes(url)).rejects.toThrow("invalid or differs");
    await dropOrder(client);
    await ensurePublicBrowseIndexes(url);
  } finally { await client.end({ timeout: 5 }); }
}, 30_000);

test("an unrelated game write completes while the concurrent build waits for an earlier writer", async () => {
  await setupTestDB();
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const blocker = postgres(url, { max: 1, onnotice: () => {} });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let holding: Promise<unknown> | undefined, building: Promise<void> | undefined;
  try {
    await ensurePublicBrowseIndexes(url);
    await dropOrder(admin);
    holding = blocker.begin(async tx => {
      await tx.unsafe("INSERT INTO public.games(id,slug,status,config) VALUES ('writer-a','writer-a','waiting','{}')");
      entered(); await gate;
    });
    await ready;
    building = ensurePublicBrowseIndexes(url);
    let waiting = false;
    for (let i = 0; i < 80 && !waiting; i++) {
      const [row] = await admin<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_progress_create_index WHERE relid='public.games'::regclass AND phase LIKE 'waiting for writers%') AS waiting`;
      waiting = Boolean(row?.waiting);
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await admin.unsafe("SET statement_timeout='1s'");
    await admin`INSERT INTO public.games(id,slug,status,config) VALUES ('writer-b','writer-b','waiting','{}')`;
    await admin.unsafe("SET statement_timeout=0");
    release(); await holding; await building;
    const [row] = await admin<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.games WHERE id IN ('writer-a','writer-b')`;
    expect(row?.count).toBe(2);
  } finally {
    release?.(); await holding?.catch(() => {}); await building?.catch(() => {});
    await Promise.all([admin.end({ timeout: 5 }), blocker.end({ timeout: 5 })]);
  }
}, 30_000);

test("a lost builder session aborts and leaves an invalid index for explicit inspection", async () => {
  await setupTestDB();
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const blocker = postgres(url, { max: 1, onnotice: () => {} });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let holding: Promise<unknown> | undefined, outcome: Promise<unknown> | undefined;
  try {
    await ensurePublicBrowseIndexes(url);
    await dropOrder(admin);
    holding = blocker.begin(async tx => {
      await tx.unsafe("INSERT INTO public.games(id,slug,status,config) VALUES ('writer-loss','writer-loss','waiting','{}')");
      entered(); await gate;
    });
    await ready;
    outcome = ensurePublicBrowseIndexes(url).then(() => null, error => error);
    let pid: number | null = null;
    for (let i = 0; i < 80 && !pid; i++) {
      const [row] = await admin<{ pid: number | null }[]>`SELECT a.pid FROM pg_stat_activity a JOIN pg_stat_progress_create_index p ON p.pid=a.pid WHERE a.application_name='public-browse-index-builder' AND p.relid='public.games'::regclass AND p.phase LIKE 'waiting for writers%' LIMIT 1`;
      pid = row?.pid ?? null;
      if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(pid).not.toBeNull();
    const [terminated] = await admin<{ terminated: boolean }[]>`SELECT pg_terminate_backend(${pid!}) AS terminated`;
    expect(terminated?.terminated).toBe(true);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    release(); await holding;
    const [invalid] = await admin<{ indisvalid: boolean }[]>`SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='games_public_browse_order_idx'`;
    expect(invalid?.indisvalid).toBe(false);
    await expect(ensurePublicBrowseIndexes(url)).rejects.toThrow("invalid or differs");
    await dropOrder(admin);
    await ensurePublicBrowseIndexes(url);
  } finally {
    release?.(); await holding?.catch(() => {}); await outcome?.catch(() => {});
    await Promise.all([admin.end({ timeout: 5 }), blocker.end({ timeout: 5 })]);
  }
}, 30_000);

test("a non-superuser table owner can build the browse indexes", async () => {
  await setupTestDB();
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const role = `browse_index_owner_${process.pid}`;
  const password = "isolated-fixture-only";
  let originalOwner = "";
  try {
    const [current] = await admin<{ name: string }[]>`SELECT current_user AS name`;
    originalOwner = current!.name;
    for (const name of names) await admin.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS public.${name}`);
    await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
    await admin.unsafe(`GRANT CREATE ON SCHEMA public TO "${role}"`);
    await admin.unsafe(`ALTER TABLE public.games OWNER TO "${role}"`);
    const ownerUrl = new URL(url); ownerUrl.username = role; ownerUrl.password = password;
    await ensurePublicBrowseIndexes(ownerUrl.toString());
    const [row] = await admin<{ count: number; superuser: boolean }[]>`
      SELECT count(*)::integer AS count, (SELECT rolsuper FROM pg_roles WHERE rolname=${role}) AS superuser
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=ANY(${names}::text[]) AND i.indisvalid AND i.indisready`;
    expect(row).toEqual({ count: 5, superuser: false });
  } finally {
    if (originalOwner) await admin.unsafe(`ALTER TABLE public.games OWNER TO "${originalOwner.replaceAll('"', '""')}"`);
    await admin.unsafe(`REVOKE CREATE ON SCHEMA public FROM "${role}"`);
    await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end({ timeout: 5 });
  }
}, 30_000);


test("a read-only database role can verify but cannot build indexes", async () => {
  await setupTestDB();
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const role = `browse_index_reader_${process.pid}`;
  const password = "isolated-fixture-only";
  try {
    await ensurePublicBrowseIndexes(url);
    await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
    const readerUrl = new URL(url); readerUrl.username = role; readerUrl.password = password;
    await checkPublicBrowseIndexes(readerUrl.toString());
    const reader = postgres(readerUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      let denied = false;
      try { await reader.unsafe("CREATE INDEX CONCURRENTLY forbidden_browse_idx ON public.games(id)"); }
      catch { denied = true; }
      expect(denied).toBe(true);
    } finally { await reader.end({ timeout: 5 }); }
  } finally {
    await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end({ timeout: 5 });
  }
}, 30_000);

test("bundled release commands fail closed before building and verify afterwards", async () => {
  await setupTestDB();
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "house-browse-gate-"));
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../db/public-browse-indexes.ts"), resolve(import.meta.dir, "../db/migrate.ts")],
      outdir: dir, target: "bun", naming: "[name].js",
    });
    expect(result.success).toBe(true);
    const run = async (file: string, ...args: string[]) => {
      const child = Bun.spawn([processExecPath, join(dir, file), ...args], {
        env: { ...process.env, DATABASE_URL: url, DRIZZLE_MIGRATIONS_DIR: resolve(import.meta.dir, "../../drizzle") },
        stdout: "pipe", stderr: "pipe",
      });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { exit, output: stdout + stderr };
    };
    const processExecPath = process.execPath;
    const migrationSet = await run("migrate.js", "--print-release-migration-set");
    expect(migrationSet.exit).toBe(0);
    expect(migrationSet.output.trim()).toBe(calculateMigrationSet(resolve(import.meta.dir, "../../drizzle")));
    expect((await run("migrate.js")).exit).toBe(0);
    await dropOrder(admin);
    const failedCheck = await run("public-browse-indexes.js", "--check");
    expect(failedCheck.exit).not.toBe(0); expect(failedCheck.output).toContain("is missing");
    const [missing] = await admin<{ missing: boolean }[]>`SELECT to_regclass('public.games_public_browse_order_idx') IS NULL AS missing`;
    expect(missing?.missing).toBe(true);
    expect((await run("public-browse-indexes.js")).exit).toBe(0);
    expect((await run("public-browse-indexes.js", "--check")).exit).toBe(0);
    expect((await run("public-browse-indexes.js", "--unexpected")).exit).not.toBe(0);
  } finally {
    await admin.end({ timeout: 5 });
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
