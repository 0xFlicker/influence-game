import {beforeEach,afterEach,expect,test} from "bun:test";
import {Hono} from "hono";
import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db";
import {setupTestDB} from "./test-utils";
import {grantTestAuthority} from "./rbac-fixtures";
import {testPayloadStore} from "./payload-test-store";
import {setPayloadObjectStoreForTests} from "../services/payload-storage";
import {createRenderJob} from "../services/render-jobs";
import {createRenderJobRoutes} from "../routes/render-jobs";
import {createSessionToken,type AuthEnv} from "../middleware/auth";

let db:DrizzleDB,app:Hono<AuthEnv>,token:string,ids:string[];
const oldSecret=process.env.JWT_SECRET;
beforeEach(async()=> {
  db=await setupTestDB();process.env.JWT_SECRET="monitor-test-secret";
  await db.insert(schema.users).values([{id:"monitor-producer",displayName:"Mira"},{id:"monitor-viewer"}]);
  await grantTestAuthority(db,"monitor-producer",[],"producer");
  await db.insert(schema.games).values([{id:"monitor-alpha",slug:"alpha-game",status:"completed",config:"{}"},{id:"monitor-beta",slug:"beta-game",gameKind:"werewolf",status:"completed",config:"{}"}]);
  await db.insert(schema.gameEpisodePresentations).values([{gameId:"monitor-alpha",title:"The last promise"},{gameId:"monitor-beta",title:"Night in the village"}]);
  ids=[];
  for(const [i,state] of ["rendering","queued","failed","succeeded","cancelled"].entries()) {
    const gameId=i%2?"monitor-beta":"monitor-alpha",trailer=i===1;
    const job=await createRenderJob(db,{gameId,userId:trailer?null:"monitor-producer",requestKey:`monitor-${i}`,rendererDigest:`sha256:${"a".repeat(64)}`,
      input:trailer?{version:1,workload:"trailer",gameId,renderVersion:1}:{version:1,workload:"studio-export",selectionHash:`sha256:${"b".repeat(64)}`,files:[{path:"manifest.json",sha256:"c".repeat(64),byteLength:1}]}});
    await db.update(schema.renderJobs).set({state,createdAt:`2026-11-02T0${i}:00:00.000Z`,progress:state==="rendering"?68:0}).where(eq(schema.renderJobs.id,job.id));ids.push(job.id);
  }
  app=new Hono<AuthEnv>();app.route("/",createRenderJobRoutes(db));token=await createSessionToken("monitor-producer");
});
afterEach(()=>{setPayloadObjectStoreForTests(testPayloadStore);if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;});
type Page={jobs:Array<{id:string;state:string;requester:string;game:{id:string;slug:string;title:string}}>;summary:{total:number;matching:number;active:number;failed:number;succeeded:number};nextCursor:string|null};
const request=(query="",bearer=token)=>app.request(`/api/admin/renders/jobs${query?`?${query}`:""}`,{headers:{Authorization:`Bearer ${bearer}`}});
test("monitor combines both workloads across games, sorts active first and never reads object bodies",async()=> {
  setPayloadObjectStoreForTests({putIfAbsent:async()=>{throw new Error("storage unavailable");},get:async()=>{throw new Error("storage unavailable");}});
  const response=await request();expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toContain("no-store");
  const page=await response.json() as Page;
  expect(page.jobs.map(j=>j.id)).toEqual([ids[1]!,ids[0]!,ids[4]!,ids[3]!,ids[2]!]);
  expect(page.summary).toEqual({total:5,matching:5,active:2,failed:1,succeeded:1});
  expect(page.jobs[0]).toMatchObject({requester:"Automatic",game:{id:"monitor-beta",slug:"beta-game",title:"Night in the village"}});
  expect(page.jobs[1]?.requester).toBe("Mira");
  expect(JSON.stringify(page)).not.toContain("input_object");expect(JSON.stringify(page)).not.toContain("leaseHash");
  for(const id of [ids[0]!,ids[1]!]) {
    const cancelled=await app.request(`/api/admin/renders/${id}/cancel`,{method:"POST",headers:{Authorization:`Bearer ${token}`}});
    expect(cancelled.status).toBe(200);expect((await cancelled.json() as {state:string}).state).toBe("cancelled");
  }
});
test("filters and summary cover all matching records, rather than filtering the latest page",async()=> {
  const active=await (await request("status=active&limit=1")).json() as Page;expect(active.jobs).toHaveLength(1);expect(active.summary).toMatchObject({matching:2,active:2,failed:1});
  const failed=await (await request("status=failed")).json() as Page;expect(failed.jobs.map(j=>j.id)).toEqual([ids[2]!]);expect(failed.summary.active).toBe(2);
  const trailer=await (await request("workload=trailer")).json() as Page;expect(trailer.jobs.map(j=>j.id)).toEqual([ids[1]!]);
  const game=await (await request("gameId=monitor-beta")).json() as Page;expect(game.jobs.map(j=>j.id)).toEqual([ids[1]!,ids[3]!]);
  for(const search of ["last promise","alpha-game",ids[0]!]) {
    const page=await (await request(`search=${encodeURIComponent(search)}`)).json() as Page;expect(page.jobs.some(j=>j.id===ids[0])).toBe(true);
  }
  expect(((await (await request("search=%25_")).json()) as Page).jobs).toHaveLength(0);
});
test("keyset pages do not skip ties and reject cursor reuse under another filter",async()=> {
  await db.update(schema.renderJobs).set({createdAt:"2026-11-02T04:00:00.123456Z"}).where(eq(schema.renderJobs.id,ids[3]!));
  await db.update(schema.renderJobs).set({createdAt:"2026-11-02T04:00:00.123456Z"}).where(eq(schema.renderJobs.id,ids[4]!));
  const seen:string[]=[];let cursor:string|null=null;
  do {const params=new URLSearchParams({limit:"1",...(cursor?{cursor}:{})});const page=await (await request(String(params))).json() as Page;
    expect(page.jobs).toHaveLength(1);seen.push(page.jobs[0]!.id);cursor=page.nextCursor;
    if(cursor)expect((await request(`status=failed&cursor=${cursor}`)).status).toBe(400);
  }while(cursor);
  expect(new Set(seen).size).toBe(5);expect(seen).toHaveLength(5);
});
test("invalid filters fail early and current role revocation hides the complete inventory",async()=> {
  for(const query of ["limit=0","limit=101","status=unknown","workload=images","cursor=bad","extra=true"])expect((await request(query)).status).toBe(400);
  expect((await request("",await createSessionToken("monitor-viewer",{roles:["sysop"]}))).status).toBe(403);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId,"monitor-producer"));
  const denied=await request();expect(denied.status).toBe(403);expect((await denied.json() as {jobs?:unknown}).jobs).toBeUndefined();
});
