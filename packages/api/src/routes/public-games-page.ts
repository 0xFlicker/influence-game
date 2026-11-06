import { Hono } from "hono";
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { schema, type DrizzleDB } from "../db/index.js";
import { readPublicInfluenceSummaries, readPublicWerewolfSummaries } from "../services/public-library-summaries.js";
import { decodePublicGamesCursor, encodePublicGamesCursor, type PublicGamesFilter, type PublicGamesPosition } from "../services/public-games-page.js";

const fields = new Set(["kind","status","collection","season","category","excludeSeason","limit","cursor"]);
function parse(query: URLSearchParams): { filter: PublicGamesFilter; cursor: string | null; limit: number } {
  for (const key of query.keys()) if (!fields.has(key) || query.getAll(key).length!==1) throw new Error("Invalid query");
  const kind=query.get("kind")??"all", status=query.get("status")??"all", collection=query.get("collection")??"all";
  const season=query.get("season"), category=query.get("category")??"all", excludeSeason=query.get("excludeSeason"), cursor=query.get("cursor");
  const rawLimit=query.get("limit")??"20";
  if (!/^(?:[1-9]|1[0-9]|20)$/.test(rawLimit)) throw new Error("Invalid query");
  if (!["all","influence","werewolf"].includes(kind) || !["all","waiting","in_progress","suspended","completed","cancelled","nonwaiting"].includes(status) || !["all","public","season"].includes(collection)) throw new Error("Invalid query");
  if ((collection==="season")!==Boolean(season) || (season && (Buffer.byteLength(season)>512 || season.includes("\0"))) || (excludeSeason!==null && (!excludeSeason || Buffer.byteLength(excludeSeason)>512 || excludeSeason.includes("\0")))) throw new Error("Invalid query");
  if (!["all","free","custom"].includes(category) && (!category.startsWith("season:") || category.length===7 || Buffer.byteLength(category)>519 || category.includes("\0"))) throw new Error("Invalid query");
  if (cursor!==null && (!cursor || cursor.length>8192)) throw new Error("Invalid query");
  return { filter: {kind:kind as PublicGamesFilter["kind"],status:status as PublicGamesFilter["status"],collection:collection as PublicGamesFilter["collection"],season,category:category as PublicGamesFilter["category"],excludeSeason},cursor,limit:Number(rawLimit) };
}

type Selected = { game: typeof schema.games.$inferSelect; rank: number; time: string | null };
type Item = { kind:"influence"; game:Awaited<ReturnType<typeof readPublicInfluenceSummaries>>[number] } | { kind:"werewolf"; game:Awaited<ReturnType<typeof readPublicWerewolfSummaries>>[number] };

/** Public direct seek; no user credentials, global totals or automatic page traversal. */
export function createPublicGamesPageRoutes(db: DrizzleDB) {
  const app=new Hono();
  app.get("/api/public-games/page",async c=>{
    c.header("Cache-Control","private, no-store");
    let request: ReturnType<typeof parse>, position: PublicGamesPosition | null;
    try { request=parse(new URL(c.req.url).searchParams); position=request.cursor ? decodePublicGamesCursor(request.filter,request.cursor) : null; if (request.cursor && !position) throw new Error("Invalid cursor"); }
    catch { return c.json({error:"Invalid game page query"},400); }
    const {filter}=request, kinds=enabledGameKinds().filter(kind=>filter.kind==="all" || filter.kind===kind);
    if (!kinds.length) return c.json({items:[],nextCursor:null});
    const g=schema.games, rawTime=sql`public.public_game_sort_time(${g.createdAt})`;
    const rank=sql<number>`CASE ${g.status} WHEN 'waiting' THEN 0 WHEN 'in_progress' THEN -1 WHEN 'suspended' THEN -2 WHEN 'completed' THEN -3 ELSE -4 END`;
    const sort=sql`coalesce(${rawTime},'-infinity'::timestamptz)`;
    const predicates: SQL[]=[inArray(g.gameKind,kinds),isNull(g.hiddenAt),sql`public.public_game_is_public(${g.config})`];
    if (filter.status==="nonwaiting") predicates.push(ne(g.status,"waiting"));
    else if (filter.status!=="all") predicates.push(eq(g.status,filter.status));
    if (filter.collection==="public") predicates.push(or(eq(g.gameKind,"werewolf"),isNull(g.seasonId))!);
    if (filter.collection==="season") predicates.push(and(eq(g.gameKind,"influence"),eq(g.seasonId,filter.season!))!);
    if (filter.category==="free") predicates.push(and(eq(g.gameKind,"influence"),isNull(g.seasonId),eq(g.trackType,"free"))!);
    if (filter.category==="custom") predicates.push(or(eq(g.gameKind,"werewolf"),and(eq(g.gameKind,"influence"),isNull(g.seasonId),eq(g.trackType,"custom")))!);
    if (filter.category.startsWith("season:")) predicates.push(and(eq(g.gameKind,"influence"),eq(g.seasonId,filter.category.slice(7)))!);
    if (filter.excludeSeason) predicates.push(sql`${g.seasonId} IS DISTINCT FROM ${filter.excludeSeason}`);
    const budget=request.limit;
    try {
      const result=await db.transaction(async tx=>{
        await tx.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
        const selection={game:g,rank,time:sql<string|null>`CASE WHEN ${rawTime} IS NULL THEN NULL ELSE to_char(${rawTime} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`};
        const seek=position ? sql`(${rank},${sort},${g.id} COLLATE "C") < (${position.rank},coalesce(${position.time}::timestamptz,'-infinity'::timestamptz),${position.id} COLLATE "C")` : undefined;
        const rows: Selected[]=await tx.select(selection).from(g).where(and(...predicates,seek))
          .orderBy(sql`${rank} DESC`,sql`${sort} DESC`,sql`${g.id} COLLATE "C" DESC`).limit(budget+1);
        const candidates=rows.slice(0,budget), source=candidates.map(row=>row.game);
        const [influence,wolves]=await Promise.all([
          readPublicInfluenceSummaries(tx,source.filter(game=>game.gameKind==="influence"),{includeEpisodeNumbers:false,includeKernelHealth:false}),
          readPublicWerewolfSummaries(tx,source.filter(game=>game.gameKind==="werewolf").map(game=>({id:game.id,slug:game.slug,status:game.status,gameKind:game.gameKind,seasonId:game.seasonId,config:game.config,createdAt:game.createdAt,playerCount:game.maxPlayers})),{includeEpisodeNumbers:false}),
        ]);
        const byId=new Map<string,Item>([...influence.map(game=>[game.id,{kind:"influence" as const,game}] as const),...wolves.map(game=>[game.id,{kind:"werewolf" as const,game}] as const)]);
        const items:Item[]=[]; let consumed=0;
        for (const row of candidates) { const item=byId.get(row.game.id); consumed++; if (item) items.push(item); if (items.length===budget) break; }
        const last=candidates[consumed-1];
        const nextCursor=last && (consumed<candidates.length || rows.length>budget) ? encodePublicGamesCursor(filter,{rank:last.rank,time:last.time,id:last.game.id}) : null;
        return {items,nextCursor};
      },{isolationLevel:"repeatable read",accessMode:"read only"});
      return c.json(result);
    } catch (error) { console.error("[public-games] page read failed",error instanceof Error ? error.message : error); return c.json({error:"Could not load games"},503); }
  });
  return app;
}
