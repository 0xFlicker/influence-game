import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createPublicGamesPageRoutes } from "../routes/public-games-page.js";
import { encodePublicGamesCursor, decodePublicGamesCursor, type PublicGamesFilter } from "../services/public-games-page.js";
import { inspectReleaseMigrationFiles } from "../db/migrate.js";
import path from "node:path";

test("direct library pages both kinds in status order with filters and stable cursors", async () => {
  const db=await setupTestDB();
  const app=createPublicGamesPageRoutes(db);
  await db.insert(schema.seasons).values({id:"season-a",slug:"season-a",name:"Season Alpha",status:"active"});
  const config=JSON.stringify({visibility:"public",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]});
  const games=Array.from({length:130},(_,i)=>({id:`game-${String(i).padStart(3,"0")}`,slug:`room-${String(i).padStart(3,"0")}`,gameKind:i%2 ? "werewolf" as const : "influence" as const,status:(["waiting","in_progress","suspended","completed","cancelled"] as const)[i%5]!,seasonId:i%2===0 && i%4===0 ? "season-a" : null,trackType:i%4===2 ? "free" as const : "custom" as const,config,createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}));
  await db.insert(schema.games).values(games);
  await db.insert(schema.gameEpisodePresentations).values(games.map((game,i)=>({gameId:game.id,title:i===1 ? "Rare title" : `Episode ${i}`,description:"Public teaser"})));
  await db.insert(schema.games).values([
    {id:"hidden",slug:"hidden",config:'{"visibility":"public"}',hiddenAt:"now",createdAt:"2030-01-01T00:00:00Z"},
    {id:"unlisted",slug:"unlisted",config:'{"visibility":"unlisted"}',createdAt:"2030-01-01T00:00:00Z"},
    {id:"invalid-config",slug:"invalid-config",config:"{broken",createdAt:"2030-01-01T00:00:00Z"},
    {id:"invalid-jsonb",slug:"invalid-jsonb",config:'{"value":"\\u0000"}',createdAt:"2030-01-01T00:00:00Z"},
    {id:"invalid-time",slug:"invalid-time",config,createdAt:"not-a-time"},
    {id:"invalid-live",slug:"invalid-live",config,status:"in_progress",createdAt:"not-a-time"},
    {id:"invalid-suspended",slug:"invalid-suspended",config,status:"suspended",createdAt:"not-a-time"},
    {id:"invalid-completed",slug:"invalid-completed",config,status:"completed",createdAt:"not-a-time"},
    {id:"invalid-cancelled",slug:"invalid-cancelled",config,status:"cancelled",createdAt:"not-a-time"},
    {id:"offset-a",slug:"offset-a",config,createdAt:"2026-01-02T01:00:00+01:00"},
    {id:"offset-b",slug:"offset-b",config,createdAt:"2026-01-02 00:00:00+00"},
  ]);
  const allIds:string[]=[]; const allStatuses:string[]=[]; let cursor:string|null=null, firstCursor:string|null=null;
  do {
    const response=await app.request(`/api/public-games/page${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`);
    expect(response.status).toBe(200);
    const page=await response.json() as {items:Array<{kind:string;game:{id:string;status:string}}>;nextCursor:string|null};
    expect(page.items.length).toBeLessThanOrEqual(20);
    allIds.push(...page.items.map(item=>item.game.id));
    allStatuses.push(...page.items.map(item=>item.game.status));
    cursor=page.nextCursor; firstCursor??=cursor;
  } while (cursor && allIds.length<200);
  expect(allIds).toHaveLength(137); expect(new Set(allIds).size).toBe(137);
  expect(allIds.slice(0,2)).toEqual(["offset-b","offset-a"]);
  const expected=[...games,
    {id:"offset-a",status:"waiting",createdAt:"2026-01-02T01:00:00+01:00"},
    {id:"offset-b",status:"waiting",createdAt:"2026-01-02 00:00:00+00"},
    ...([["invalid-time","waiting"],["invalid-live","in_progress"],["invalid-suspended","suspended"],["invalid-completed","completed"],["invalid-cancelled","cancelled"]] as const).map(([id,status])=>({id,status,createdAt:"not-a-time"})),
  ];
  const order:Record<string,number>={waiting:0,in_progress:1,suspended:2,completed:3,cancelled:4};
  expected.sort((a,b)=>order[a.status]!-order[b.status]! || (Date.parse(b.createdAt)||-Infinity)-(Date.parse(a.createdAt)||-Infinity) || (a.id<b.id ? 1 : a.id>b.id ? -1 : 0));
  expect(allIds).toEqual(expected.map(game=>game.id));
  const rank:Record<string,number>={waiting:0,in_progress:1,suspended:2,completed:3,cancelled:4};
  expect(allStatuses.map(status=>rank[status])).toEqual(allStatuses.map(status=>rank[status]).toSorted((a,b)=>a!-b!));
  for (const [id, nextStatus] of [["invalid-time","in_progress"],["invalid-live","suspended"],["invalid-suspended","completed"],["invalid-completed","cancelled"]] as const) expect(allStatuses[allIds.indexOf(id)+1]).toBe(nextStatus);
  expect(allIds.at(-1)).toBe("invalid-cancelled");
  expect(allIds).not.toContain("hidden"); expect(allIds).not.toContain("unlisted"); expect(allIds).not.toContain("invalid-jsonb");
  expect((await app.request(`/api/public-games/page?kind=werewolf&cursor=${encodeURIComponent(firstCursor!)}`)).status).toBe(400);
  expect((await app.request("/api/public-games/page?cursor=invalid")).status).toBe(400);
  expect((await app.request("/api/public-games/page?limit=21")).status).toBe(400);
  expect((await app.request("/api/public-games/page?limit=0")).status).toBe(400);
  const shortPage=await (await app.request("/api/public-games/page?limit=8")).json() as {items:unknown[];nextCursor:string|null};
  expect(shortPage.items).toHaveLength(8); expect(shortPage.nextCursor).not.toBeNull();
  const wolf=await (await app.request("/api/public-games/page?kind=werewolf&status=waiting")).json() as {items:Array<{kind:string;game:{status:string}}>};
  expect(wolf.items.length).toBeGreaterThan(0); expect(wolf.items.every(item=>item.kind==="werewolf" && item.game.status==="waiting")).toBe(true);
  const season=await (await app.request("/api/public-games/page?collection=season&season=season-a")).json() as {items:Array<{kind:string;game:{seasonId?:string}}>};
  expect(season.items.length).toBeGreaterThan(0); expect(season.items.every(item=>item.kind==="influence" && item.game.seasonId==="season-a")).toBe(true);
  expect((await app.request("/api/public-games/page?q=Rare%20title")).status).toBe(400);
});

test("direct index functions are timezone-stable, fail closed, and migration is additive", async () => {
  const db=await setupTestDB();
  const [row]=await db.execute<{same:boolean;bad_time:boolean;bad_json:boolean;nonpublic:boolean}>(sql`
    SELECT public.public_game_sort_time('2026-01-02T01:00:00+01:00')=public.public_game_sort_time('2026-01-02 00:00:00+00') AS same,
      public.public_game_sort_time('2026-02-31T00:00:00Z') IS NULL AS bad_time,
      NOT public.public_game_is_public('{"value":"\\u0000"}') AS bad_json,
      NOT public.public_game_is_public('{"visibility":null}') AS nonpublic`);
  expect(row).toEqual({same:true,bad_time:true,bad_json:true,nonpublic:true});
  const migration=path.resolve(import.meta.dir,"../../drizzle/0155_public_game_browse_indexes.sql");
  expect(inspectReleaseMigrationFiles([migration])).toEqual([]);
});

test("status cursors reject malformed ranks and filters", () => {
  const filter: PublicGamesFilter={kind:"all",status:"all",collection:"all",season:null,category:"all",excludeSeason:null};
  const cursor=encodePublicGamesCursor(filter,{rank:-3,time:null,id:"game"});
  expect(decodePublicGamesCursor(filter,cursor)).toEqual({rank:-3,time:null,id:"game"});
  expect(decodePublicGamesCursor({...filter,kind:"werewolf"},cursor)).toBeNull();
  const value=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
  value[2].rank=42;
  expect(decodePublicGamesCursor(filter,Buffer.from(JSON.stringify(value)).toString("base64url"))).toBeNull();
});

test("both game types can page past the old hundred-game limit", async () => {
  const db = await setupTestDB();
  const app = createPublicGamesPageRoutes(db);
  const config = JSON.stringify({ visibility: "public", providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  await db.insert(schema.games).values(Array.from({length: 250}, (_, i) => ({
    id: `long-${i}`, slug: `long-${i}`, gameKind: i % 2 ? "werewolf" as const : "influence" as const,
    status: "completed" as const, config, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  })));
  for (const kind of ["influence", "werewolf"] as const) {
    const ids: string[] = []; let cursor: string | null = null; let requests = 0;
    do {
      const params = new URLSearchParams({ kind }); if (cursor) params.set("cursor", cursor);
      const response = await app.request(`/api/public-games/page?${params}`);
      expect(response.status).toBe(200);
      const page = await response.json() as {items: Array<{kind:string;game:{id:string}}>;nextCursor:string|null};
      expect(page.items.length).toBeLessThanOrEqual(20);
      expect(page.items.every(item => item.kind === kind)).toBe(true);
      ids.push(...page.items.map(item => item.game.id)); cursor = page.nextCursor; requests++;
    } while (cursor && requests < 20);
    expect(cursor).toBeNull(); expect(ids).toHaveLength(125); expect(new Set(ids).size).toBe(125);
    expect(requests).toBe(7);
  }
});
