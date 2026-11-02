import {and,asc,desc,eq,ilike,or,sql,type SQL} from "drizzle-orm";
import {createHash} from "node:crypto";
import {schema,type DrizzleDB} from "../db";
import {renderJobView,RenderJobError} from "./render-jobs";

const states=["uploading_inputs","queued","rendering","uploading","verifying","succeeded","failed","cancelled"];
const activeStates=["uploading_inputs","queued","rendering","uploading","verifying"];
type Cursor={version:1;binding:string;rank:0|1;createdAt:string;id:string};
export interface RenderMonitorQuery {gameId?:string;workload?:"trailer"|"studio-export";status:string;search?:string;limit:number;cursor?:Cursor}
function binding(query:Omit<RenderMonitorQuery,"cursor"|"limit">) {
  return createHash("sha256").update(JSON.stringify({gameId:query.gameId??null,workload:query.workload??null,status:query.status,search:query.search??null})).digest("hex");
}
export function parseRenderMonitorQuery(raw:Record<string,string>):RenderMonitorQuery {
  const fail=():never=>{throw new RenderJobError("Invalid render monitor filter or page cursor",400);};
  if(Object.keys(raw).some(k=>!["gameId","workload","status","search","limit","cursor"].includes(k)))return fail();
  const limit=raw.limit===undefined?50:Number(raw.limit),status=raw.status??"all",search=raw.search?.trim()||undefined;
  if(!Number.isInteger(limit)||limit<1||limit>100||!["all","active",...states].includes(status)
    ||raw.workload!==undefined&&!["trailer","studio-export"].includes(raw.workload)
    ||raw.gameId!==undefined&&(!raw.gameId||raw.gameId.length>200||/[\u0000-\u001f]/.test(raw.gameId))
    ||search!==undefined&&(search.length>200||/[\u0000-\u001f]/.test(search)))return fail();
  const query:RenderMonitorQuery={gameId:raw.gameId,workload:raw.workload as RenderMonitorQuery["workload"],status,search,limit};
  if(raw.cursor!==undefined)try {
    if(raw.cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(raw.cursor))return fail();
    const value=JSON.parse(Buffer.from(raw.cursor,"base64url").toString("utf8")) as Cursor;
    if(!value||Object.keys(value).sort().join()!=="binding,createdAt,id,rank,version"||value.version!==1||value.binding!==binding(query)
      ||![0,1].includes(value.rank)||typeof value.createdAt!=="string"||!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.createdAt)
      ||!Number.isFinite(Date.parse(value.createdAt))||typeof value.id!=="string"||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id))return fail();
    query.cursor=value;
  }catch {return fail();}
  return query;
}

/** Indexed metadata only: never fetch frozen input documents to draw a queue. */
export async function readRenderMonitor(db:DrizzleDB,query:RenderMonitorQuery) {
  const jobs=schema.renderJobs,games=schema.games,episodes=schema.gameEpisodePresentations;
  const active=sql`${jobs.state} IN ('uploading_inputs','queued','rendering','uploading','verifying')`;
  const rank=sql<number>`CASE WHEN ${active} THEN 0 ELSE 1 END`,created=sql`${jobs.createdAt}::timestamptz`;
  const pattern=query.search?`%${query.search.replace(/[\\%_]/g,"\\$&")}%`:undefined;
  const scope=and(query.gameId?eq(jobs.gameId,query.gameId):undefined,query.workload?eq(jobs.workload,query.workload):undefined,
    pattern?or(ilike(games.slug,pattern),ilike(episodes.title,pattern),ilike(sql`${jobs.id}::text`,pattern)):undefined);
  const status=query.status==="all"?sql`true`:query.status==="active"?active:eq(jobs.state,query.status);
  const cursor=query.cursor;
  let after:SQL|undefined;
  if(cursor)after=sql`(${rank}>${cursor.rank} OR (${rank}=${cursor.rank} AND (${created}<${cursor.createdAt}::timestamptz OR (${created}=${cursor.createdAt}::timestamptz AND ${jobs.id}<${cursor.id}::uuid))))`;
  const [rows,totals]=await Promise.all([
    db.select({job:jobs,slug:games.slug,gameKind:games.gameKind,title:episodes.title,displayName:schema.users.displayName,handle:schema.users.handle})
      .from(jobs).innerJoin(games,eq(games.id,jobs.gameId)).leftJoin(episodes,eq(episodes.gameId,games.id)).leftJoin(schema.users,eq(schema.users.id,jobs.requestedBy))
      .where(and(scope,status,after)).orderBy(asc(rank),desc(created),desc(jobs.id)).limit(query.limit+1),
    db.select({total:sql<number>`count(*)::int`,matching:sql<number>`count(*) FILTER (WHERE ${status})::int`,active:sql<number>`count(*) FILTER (WHERE ${active})::int`,
      failed:sql<number>`count(*) FILTER (WHERE ${jobs.state}='failed')::int`,succeeded:sql<number>`count(*) FILTER (WHERE ${jobs.state}='succeeded')::int`})
      .from(jobs).innerJoin(games,eq(games.id,jobs.gameId)).leftJoin(episodes,eq(episodes.gameId,games.id)).where(scope),
  ]);
  const page=rows.slice(0,query.limit),last=page.at(-1)?.job;
  const nextCursor=rows.length>query.limit&&last?Buffer.from(JSON.stringify({version:1,binding:binding(query),rank:activeStates.includes(last.state)?0:1,createdAt:last.createdAt,id:last.id})).toString("base64url"):null;
  return {jobs:page.map(row=>({...renderJobView(row.job),game:{id:row.job.gameId,slug:row.slug,kind:row.gameKind,title:row.title},
    requester:row.job.requestedBy===null?"Automatic":row.handle?`@${row.handle}`:row.displayName??"Producer"})),
    summary:totals[0]!,nextCursor};
}
