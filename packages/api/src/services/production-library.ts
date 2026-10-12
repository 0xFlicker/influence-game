import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readInfluenceVisualPause } from "./visual-policy.js";
import { readWerewolfVisualPause } from "./werewolf-visual-policy.js";

export class ProductionLibraryInputError extends Error {}
export type ProductionLibraryAccess = { roles: readonly string[]; permissions: readonly string[] };
type Cursor = { version: 1; createdAt: string; id: string };
export type ProductionLibraryQuery = {
  limit: number; cursor?: Cursor; kind?: "influence" | "werewolf";
  status?: "completed" | "suspended"; search?: string; attention?: "needs_attention";
  id?:string;
};

export function canDiscoverProduction(access: ProductionLibraryAccess) {
  return access.roles.some(role => role === "producer" || role === "sysop")
    || access.permissions.some(permission => permission === "view_admin" || permission === "manage_roles");
}

/** Library inputs are bounded before issuing a database read. */
export function parseProductionLibraryQuery(query: Record<string, string>): ProductionLibraryQuery {
  if (Object.keys(query).some(key => !["limit", "cursor", "kind", "status", "search", "attention","id"].includes(key)))
    throw new ProductionLibraryInputError("Unknown production library filter");
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ProductionLibraryInputError("Library limit must be an integer from 1 to 100");
  if (query.kind !== undefined && query.kind !== "influence" && query.kind !== "werewolf") throw new ProductionLibraryInputError("Invalid game kind");
  if (query.status !== undefined && query.status !== "completed" && query.status !== "suspended") throw new ProductionLibraryInputError("Invalid production status");
  if (query.attention !== undefined && query.attention !== "needs_attention") throw new ProductionLibraryInputError("Invalid attention filter");
  const search = query.search?.trim();
  if (query.id !== undefined && (!query.id || query.id.length > 200 || /[\u0000-\u001f]/.test(query.id))) throw new ProductionLibraryInputError("Invalid production game ID");
  if (search && search.length > 200) throw new ProductionLibraryInputError("Search must be at most 200 characters");
  let cursor: Cursor | undefined;
  if (query.cursor !== undefined) {
    try {
      if (!query.cursor || query.cursor.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      const decoded: unknown = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
      const value = decoded as Record<string, unknown>;
      if (Object.keys(value).length !== 3 || value.version !== 1 || typeof value.id !== "string" || !value.id || value.id.length > 200 || /[\u0000-\u001f]/.test(value.id)
        || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.createdAt)
        || !Number.isFinite(Date.parse(value.createdAt))) throw new Error();
      // PostgreSQL timestamps may contain microseconds; converting through Date would skip peers in keyset paging.
      cursor = { version: 1, createdAt: value.createdAt, id: value.id };
    } catch { throw new ProductionLibraryInputError("Invalid production library cursor"); }
  }
  return { limit, cursor, kind: query.kind, status: query.status, search: search || undefined, attention: query.attention,id:query.id };
}

/** Metadata allowlist only. No scene plans, provider receipts, cast references or history. */
export async function readProductionLibrary(db: DrizzleDB, query: ProductionLibraryQuery, access: ProductionLibraryAccess) {
  const games = schema.games, episodes = schema.gameEpisodePresentations, jobs = schema.visualRepairJobs;
  const created = sql`${games.createdAt}::timestamptz`;
  const needsAttention = sql<boolean>`(${games.status} = 'suspended' OR EXISTS (
    SELECT 1 FROM ${jobs} WHERE ${jobs.gameId} = ${games.id} AND ${jobs.status} IN ('failed', 'needs_reconciliation')
  ) OR ${episodes.status} = 'failed')`;
  const search = query.search?.replace(/[\\%_]/g, "\\$&");
  const rows = await db.select({ id: games.id, slug: games.slug, gameKind: games.gameKind, status: games.status,
    createdAt: games.createdAt, hiddenAt: games.hiddenAt, playerCount: games.maxPlayers,
    title: episodes.title, namingStatus: episodes.status, needsAttention })
    .from(games).leftJoin(episodes, eq(episodes.gameId, games.id)).where(and(
      query.id && access.permissions.includes("view_admin")
        ? or(inArray(games.status, ["completed", "suspended"]),eq(games.gameKind,"influence"))
        : inArray(games.status, ["completed", "suspended"]),
      query.id ? eq(games.id,query.id) : undefined,
      query.kind ? eq(games.gameKind, query.kind) : undefined,
      query.status ? eq(games.status, query.status) : undefined,
      query.attention ? needsAttention : undefined,
      search ? or(sql`${games.slug} ILIKE ${`%${search}%`} ESCAPE '\\'`, sql`${episodes.title} ILIKE ${`%${search}%`} ESCAPE '\\'`) : undefined,
      query.cursor ? or(sql`${created} < ${query.cursor.createdAt}::timestamptz`,
        and(sql`${created} = ${query.cursor.createdAt}::timestamptz`, sql`${games.id} < ${query.cursor.id}`)) : undefined,
    )).orderBy(desc(created), desc(games.id)).limit(query.limit + 1);
  const candidates = rows.slice(0, query.limit);
  const producer = access.roles.some(role => role === "producer" || role === "sysop");
  const permission = (name: string) => access.permissions.includes(name);
  const episodeRead = permission("view_admin") || permission("manage_roles");
  const episodeEdit = permission("manage_postgame_media") || permission("manage_roles");
  const items = [];
  let skippedInvalidPauses = 0;
  for (const row of candidates) {
    let recovery: "influence" | "scene" | "form" | null = null;
    if (row.status === "suspended") {
      // Canonical validation is confined to this bounded page. Never return its private work descriptor.
      try {
        if (row.gameKind === "werewolf") recovery = (await readWerewolfVisualPause(db, row.id))?.work.kind ?? null;
        else if (await readInfluenceVisualPause(db, row.id)) recovery = "influence";
      } catch (error) {
        if (!(error instanceof Error) || ![
          "Paused visual boundary changed", "Paused scene is not at the canonical frontier", "Paused wolf form is not at the canonical frontier",
        ].includes(error.message)) throw error;
        recovery = null;
      }
      if (!recovery && !(query.id && row.gameKind === "influence" && permission("view_admin"))) { skippedInvalidPauses++; continue; }
    }
    const influence = row.gameKind === "influence", completed = row.status === "completed";
    items.push({ id: row.id, slug: row.slug, gameKind: row.gameKind, status: row.status, createdAt: row.createdAt,
      hidden: row.hiddenAt !== null, playerCount: row.playerCount, title: row.title, namingStatus: row.namingStatus,
      needsAttention: Boolean(row.needsAttention), recovery: producer ? recovery : recovery ? "visual" : null,
      capabilities: {
        visualRead: influence ? permission("view_admin") || producer && completed : producer,
        sceneRepair: influence ? permission("start_game") || producer && completed : producer && recovery !== "form",
        editorial: producer && (completed || recovery !== null),
        policy: permission("start_game") && !completed && (influence || producer),
        resume: permission("start_game") && !completed && (influence || producer),
        influenceRecovery: influence && !completed && permission("start_game"),
        formRepair: producer && recovery === "form",
        episodeRead, episodeEdit, trailerRead: episodeRead && completed, trailerRender: episodeEdit && completed,
      } });
  }
  const last = candidates.at(-1);
  return { items, skippedInvalidPauses,
    // Advance across examined invalid pauses too; an empty page may still have a next page.
    nextCursor: rows.length > query.limit && last
      ? Buffer.from(JSON.stringify({ version: 1, createdAt: last.createdAt, id: last.id })).toString("base64url") : null };
}
