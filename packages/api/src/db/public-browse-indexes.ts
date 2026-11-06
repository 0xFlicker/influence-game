import postgres from "postgres";

/** These indexes are built separately because the normal migrator is transactional. */
const INDEXES = [
  { name: "games_public_browse_order_idx", prefix: "" },
  { name: "games_public_browse_kind_idx", prefix: "game_kind, " },
  { name: "games_public_browse_status_idx", prefix: "status, " },
  { name: "games_public_browse_season_idx", prefix: "season_id, " },
  { name: "games_public_browse_kind_status_idx", prefix: "game_kind, status, " },
] as const;

const rank = "(CASE status WHEN 'waiting' THEN 0 WHEN 'in_progress' THEN -1 WHEN 'suspended' THEN -2 WHEN 'completed' THEN -3 ELSE -4 END)";
const canonicalRank = "( CASE status WHEN 'waiting'::text THEN 0 WHEN 'in_progress'::text THEN '-1'::integer WHEN 'suspended'::text THEN '-2'::integer WHEN 'completed'::text THEN '-3'::integer ELSE '-4'::integer END)";
const canonicalTail = `COALESCE(public.public_game_sort_time(created_at), '-infinity'::timestamp with time zone) DESC, id COLLATE "C" DESC) WHERE ((hidden_at IS NULL) AND public.public_game_is_public(config))`;
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();

type Index = (typeof INDEXES)[number];
type CatalogConnection = Pick<postgres.Sql, "unsafe">;
type IndexRow = { kind: string; valid: boolean | null; ready: boolean | null; definition: string | null };

async function indexExists(connection: CatalogConnection, index: Index): Promise<boolean> {
  const expected = normalized(`CREATE INDEX ${index.name} ON public.games USING btree (${index.prefix}${canonicalRank} DESC, ${canonicalTail}`);
  const [row] = await connection.unsafe<IndexRow[]>(`
    SELECT c.relkind AS kind, i.indisvalid AS valid, i.indisready AS ready, pg_get_indexdef(c.oid) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=c.oid
    WHERE n.nspname='public' AND c.relname=$1`, [index.name]);
  if (!row) return false;
  if (row.kind !== "i" || !row.valid || !row.ready || !row.definition || normalized(row.definition) !== expected) {
    throw new Error(`Existing index ${index.name} is invalid or differs from the expected definition; inspect it before repair`);
  }
  return true;
}

/** Check the complete set using one read-only snapshot; this does not build or repair anything. */
export async function checkPublicBrowseIndexes(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, connection: { application_name: "public-browse-index-check" } });
  try {
    await client.begin("isolation level repeatable read read only", async tx => {
      await tx.unsafe("SET LOCAL search_path = pg_catalog");
      await tx.unsafe("SET LOCAL lock_timeout = '2s'");
      await tx.unsafe("SET LOCAL statement_timeout = '15s'");
      for (const index of INDEXES) {
        if (!await indexExists(tx, index)) throw new Error(`Required index ${index.name} is missing`);
      }
    });
  } finally { await client.end({ timeout: 5 }); }
}

/**
 * Build each versioned index outside a transaction, with one session-level
 * advisory lock. An invalid or differently defined existing name is an error:
 * an operator can inspect it before any explicit repair. No index is dropped.
 */
export async function ensurePublicBrowseIndexes(databaseUrl: string): Promise<void> {
  let disconnected = false;
  const client = postgres(databaseUrl, { max: 1, connection: { application_name: "public-browse-index-builder" }, onclose: () => { disconnected = true; } });
  try {
    const connection = await client.reserve();
    let locked = false;
    const requireConnection = () => { if (disconnected) throw new Error("Public browse index builder lost its database session"); };
    try {
      const [lock] = await connection<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${0x494e464c}::integer, ${0x50424958}::integer) AS acquired`;
      if (!lock?.acquired) throw new Error("Another public browse index build is running");
      locked = true;
      await connection.unsafe("SET search_path = pg_catalog");
      await connection.unsafe("SET lock_timeout = '2s'");
      await connection.unsafe("SET statement_timeout = '15min'");
      for (const index of INDEXES) {
        requireConnection();
        if (await indexExists(connection, index)) continue;
        await connection.unsafe(`CREATE INDEX CONCURRENTLY ${index.name} ON public.games (${index.prefix}${rank} DESC, (coalesce(public.public_game_sort_time(created_at),'-infinity'::timestamptz)) DESC, id COLLATE "C" DESC) WHERE hidden_at IS NULL AND public.public_game_is_public(config)`);
        requireConnection();
        if (!await indexExists(connection, index)) throw new Error(`Index ${index.name} was not found after creation`);
      }
    } finally {
      if (locked && !disconnected) await connection`SELECT pg_advisory_unlock(${0x494e464c}::integer, ${0x50424958}::integer)`.catch(() => undefined);
      connection.release();
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the public browse index build");
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== "--check")) throw new Error("Usage: public-browse-indexes.js [--check]");
  if (args[0] === "--check") await checkPublicBrowseIndexes(url);
  else await ensurePublicBrowseIndexes(url);
  console.log("Public browse indexes are valid and ready.");
}
