import {afterEach,beforeEach,expect,test} from "bun:test";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {seedProductionStudioFixture} from "./production-studio-fixtures.js";
import {productionEditorial} from "../services/production-editorial.js";
import {editorialContent,editorialInputSchemas,editorialToolNames,type EditorialToolName} from "../game-mcp/production-editorial-contracts.js";
import {createMcpRoutes} from "../routes/mcp.js";
import {MCP_OAUTH_CLIENT_ID,MCP_OAUTH_AUDIENCE,MCP_OAUTH_PURPOSE,hashOpaqueSecret} from "../services/mcp-oauth.js";
import {CURRENT_PRIVACY_VERSION,CURRENT_TERMS_VERSION} from "../services/legal-acceptance.js";
import {decodeProductionReview} from "@influence/engine/production-moments/review";
import {previewAudioTrack,queueAudioBackfill,runAudioTrack} from "../services/audio-tracks.js";
let db:DrizzleDB,f:Awaited<ReturnType<typeof seedProductionStudioFixture>>;
const prior={JWT_SECRET:process.env.JWT_SECRET,MCP_OAUTH_RESOURCE_URI:process.env.MCP_OAUTH_RESOURCE_URI};
beforeEach(async()=>{db=await setupTestDB();process.env.JWT_SECRET="editorial-test-only";process.env.MCP_OAUTH_RESOURCE_URI="http://127.0.0.1:3000/mcp";f=await seedProductionStudioFixture(db);});
afterEach(()=>{for(const [key,value] of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;});
const recipe={mode:"recipe",thinking:true,base:"full",policies:{thinking:{mode:"any",labels:["smart"]},speech:{mode:"all"}}} as const;
const input=()=>({gameIdOrSlug:f.influence.id,audience:"public",thinking:true});
type Row={momentId:string;kind:string;text:string|null;tags:Record<string,string>;revision:number};
type Next={tool:EditorialToolName;arguments:Record<string,unknown>}|null;
async function call(name:EditorialToolName,args:Record<string,unknown>){const result=await productionEditorial(db,f.producer.userId,name,args);editorialContent(name,result);return result;}
const read=(extra:Record<string,unknown>={})=>call("read_production_moments",{...input(),...extra});
const preview=(snapshot:unknown,extra:Record<string,unknown>={})=>call("preview_production_cut",{...input(),snapshot,recipe,music:true,volume:.3,...extra});

test("exact Studio text, patch preservation, stale revisions, no-op and malformed input",async()=>{
 const page=await read({momentId:f.influence.thoughtId});expect(page.status).toBe("ok");const [thought]=page.moments as Row[];
 expect(thought!.text).toContain("A promise gives");expect(thought!.tags.cut).toBe("youtube");
 const args={...input(),snapshot:page.snapshot,momentId:thought!.momentId,expectedRevision:thought!.revision,set:{"label.smart":"true",note:"interesting"},remove:[]};
 const patch=await call("update_production_moment_tags",args);expect(patch.status).toBe("saved");expect(patch.annotation).toMatchObject({tags:{cut:"youtube",note:"interesting","label.smart":"true"},revision:2});
 expect((await call("update_production_moment_tags",args)).status).toBe("conflict");
 expect((await call("update_production_moment_tags",{...args,expectedRevision:2})).status).toBe("unchanged");
 for(const invalid of [{set:{"label.fake":"true"}},{set:{"label.smart":"false"}},{set:{note:"x"},remove:["note"]},{remove:["note","note"]},{momentId:"foreign"},{extra:true}])expect((await call("update_production_moment_tags",{...args,expectedRevision:2,...invalid})).status).toBe("invalid_input");
 expect((await call("update_production_moment_tags",{...args,expectedRevision:2,set:{},remove:["note"]})).status).toBe("saved");
 expect(((await read({momentId:f.influence.speechId})).moments as Row[])[0]!.revision).toBe(0);
 expect((await productionEditorial(db,f.legacyVisual.userId,"update_production_moment_tags",args)).status).toBe("unavailable");
},30000);

test("pinned pagination, Smart-only thinking, stable review fingerprint and changed-selection continuation",async()=>{
 let page=await read({limit:2}),next=page.next as Next;const first=page,ids=(page.moments as Row[]).map(row=>row.momentId);
 if(next)expect((await call(next.tool,{...next.arguments,kind:"speech"})).status).toBe("invalid_cursor");
 while(next){page=await call(next.tool,next.arguments);expect(page.status).toBe("ok");ids.push(...(page.moments as Row[]).map(row=>row.momentId));next=page.next as Next;}
 expect(new Set(ids).size).toBe(ids.length);expect(ids).toContain(f.influence.thoughtId);expect(ids).toContain(f.influence.speechId);
 const cut=await preview(first.snapshot,{limit:1});expect(cut.status).toBe("ok");expect(cut.counts).toMatchObject({thinking:1});expect((cut.audio as {missing:number}).missing).toBeGreaterThan(0);
 expect((await preview((await read()).snapshot)).fingerprint).toBe(cut.fingerprint);
 const link=new URL(String(cut.reviewPath),"http://localhost:3001"),review=decodeProductionReview(link.searchParams.get("review")!);expect(review.recipe).toEqual(recipe);expect(review.music).toBe(true);
 await call("update_production_moment_tags",{...input(),snapshot:first.snapshot,momentId:f.influence.thoughtId,expectedRevision:1,set:{},remove:["label.smart"]});
 const continuation=cut.next as NonNullable<Next>;expect(continuation).toBeTruthy();expect((await call(continuation.tool,continuation.arguments)).status).toBe("selection_changed");
 const now=await preview(first.snapshot);expect(now.counts).toMatchObject({thinking:0});expect(now.fingerprint).not.toBe(cut.fingerprint);
},30000);

test("Werewolf privacy and existing recording coverage",async()=>{
 const base={gameIdOrSlug:f.werewolf.id,audience:"omniscient",thinking:true};
 const page=await call("read_production_moments",{...base,kind:"thinking",limit:100});expect(page.status).toBe("ok");const thoughts=page.moments as Row[];expect(thoughts.length).toBeGreaterThan(0);expect(thoughts.every(row=>row.text)).toBe(true);
 expect((await call("read_production_moments",{...base,audience:"mystery"})).status).not.toBe("ok");
 const mystery=await call("read_production_moments",{...base,audience:"mystery",thinking:false});expect(mystery.status).toBe("ok");expect((mystery.moments as Row[]).some(row=>row.kind==="thinking")).toBe(false);
 const audio=await previewAudioTrack(db,f.werewolf.id),track=await queueAudioBackfill(db,f.werewolf.id,f.producer.userId,audio.previewHash);
 await runAudioTrack(db,async recipe=>({bytes:new TextEncoder().encode(recipe.text),durationMs:1000,evidence:{fixture:true}}),undefined,track);
 const cut=await call("preview_production_cut",{...base,snapshot:page.snapshot,recipe,music:true,volume:.3});expect(cut.status).toBe("ok");expect(cut.audio).toMatchObject({missing:0,mismatched:0});expect((cut.audio as {covered:number}).covered).toBeGreaterThan(0);
},30000);

test("real HTTP MCP requires edit consent and current role",async()=>{
 const wallet="0xeditorial",userId=f.producer.userId;
 await db.update(schema.users).set({walletAddress:wallet}).where(eq(schema.users.id,userId));
 await db.insert(schema.legalAcceptances).values({userId,termsVersion:CURRENT_TERMS_VERSION,privacyVersion:CURRENT_PRIVACY_VERSION,deploymentSha:"0123456789abcdef0123456789abcdef01234567",source:"existing_account"});
 async function token(scope:string){const raw=randomUUID();await db.insert(schema.mcpOauthAccessTokens).values({id:randomUUID(),tokenHash:hashOpaqueSecret(raw),userId,walletAddress:wallet,clientId:MCP_OAUTH_CLIENT_ID,resourceUri:"http://127.0.0.1:3000/mcp",scope,audience:MCP_OAUTH_AUDIENCE,purpose:MCP_OAUTH_PURPOSE,expiresAt:"2099-01-01T00:00:00.000Z"});return raw;}
 const readToken=await token("producer"),editToken=await token("producer producer:edit");
 const app=createMcpRoutes(db,{auditLogger:()=>undefined,ownerLearningConnectionRecorder:async()=>undefined}),server=Bun.serve({port:0,hostname:"127.0.0.1",fetch:app.fetch});
 const rpc=async(token:string,method:string,params?:unknown)=>{const r=await fetch(`http://127.0.0.1:${server.port}/mcp`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});return {status:r.status,body:await r.json() as {error?:unknown;result:{tools:Array<{name:string;inputSchema:unknown}>;structuredContent:{status:string;snapshot:unknown};isError?:boolean}}};};
 try {
  const listed=await rpc(editToken,"tools/list");expect(listed.status).toBe(200);for(const name of editorialToolNames)expect(listed.body.result.tools.find((t:{name:string})=>t.name===name)!.inputSchema).toEqual(editorialInputSchemas[name]);
  const read=await rpc(readToken,"tools/call",{name:"read_production_moments",arguments:{...input(),momentId:f.influence.thoughtId}});expect(read.body.result.structuredContent.status).toBe("ok");
  const args={...input(),snapshot:read.body.result.structuredContent.snapshot,momentId:f.influence.thoughtId,expectedRevision:1,set:{note:"MCP"},remove:[]};
  expect((await rpc(readToken,"tools/call",{name:"update_production_moment_tags",arguments:args})).body.result.isError).toBe(true);
  expect((await rpc(editToken,"tools/call",{name:"update_production_moment_tags",arguments:args})).body.result.structuredContent.status).toBe("saved");
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId,userId));const denied=await rpc(editToken,"tools/call",{name:"update_production_moment_tags",arguments:{...args,expectedRevision:2}});expect(denied.status===401 || Boolean(denied.body.error)).toBe(true);
  expect((await db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.momentKey,f.influence.thoughtId)))[0]!.revision).toBe(2);
 }finally{server.stop(true);}
},30000);

test("whole oversized thinking is explicit, cross-source pins fail, and racing edits return one conflict",async()=>{
 const page=await read({momentId:f.influence.thoughtId});const row=(page.moments as Array<Row & {transcriptId:string}>)[0]!;
 const args={...input(),snapshot:page.snapshot,momentId:row.momentId,expectedRevision:row.revision,remove:[]};
 const writes=await Promise.all([call("update_production_moment_tags",{...args,set:{note:"one"}}),call("update_production_moment_tags",{...args,set:{note:"two"}})]);
 expect(writes.map(row=>row.status).sort()).toEqual(["conflict","saved"]);
 expect((await read({snapshot:{...(page.snapshot as object),gameId:"foreign"}})).status).not.toBe("ok");
 await db.update(schema.transcripts).set({thinking:"Valid long thinking. ".repeat(4000)}).where(eq(schema.transcripts.id,Number(row.transcriptId)));
 const oversized=await read({momentId:f.influence.thoughtId});expect(oversized.status).toBe("oversized_entry");expect(String(oversized.studioPath)).toContain(encodeURIComponent(f.influence.thoughtId));expect(oversized.moments).toBeUndefined();
},30000);
