import {afterAll,beforeEach,expect,spyOn,test} from "bun:test";
import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {createGameEntryRoutes} from "../routes/game-entries.js";
import {createSessionToken} from "../middleware/auth.js";
import {withPublicArtworkCapacity} from "../services/public-artwork-admission.js";
import {completedWerewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import * as visualGameAssets from "../services/visual-game-assets.js";
import {readFile} from "node:fs/promises";
import sharp from "sharp";
import {HOUSE_BODY_ART} from "@influence/engine/house-character-art";
import {gameCardCutoutPng} from "../services/game-card-cutout.js";
import {storeBinary} from "../services/payload-storage.js";
const secret=process.env.JWT_SECRET;
process.env.JWT_SECRET="house-entry-test-secret";
afterAll(()=>{if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;});
let db:DrizzleDB;
beforeEach(async()=>{db=await setupTestDB();await db.insert(schema.users).values(["owner","participant","other","operator"].map(id=>({id})));});
async function seed(kind:"influence"|"werewolf",visibility="public") {
 const game={id:`${kind}-id`,slug:`${kind}-slug`,gameKind:kind,createdById:"owner",config:JSON.stringify({visibility,privateNotes:"DO_NOT_LEAK"})};
 await db.insert(schema.games).values(game);return game;
}
async function read(key:string,user?:string) {
 return createGameEntryRoutes(db).request(`/api/game-entries/${key}`,{headers:user ? {Authorization:`Bearer ${await createSessionToken(user)}`} : {}});
}
test("both kinds resolve anonymously by id and slug with only routing identity",async()=>{
 for(const kind of ["influence","werewolf"] as const) {
  const game=await seed(kind);
  for(const key of [game.id,game.slug]) {
   const result=await read(key);expect(result.status).toBe(200);expect(result.headers.get("Cache-Control")).toBe("private, no-store");
   expect(await result.json()).toEqual({id:game.id,slug:game.slug,gameKind:kind,visibility:"public"});
  }
 }
});
test("removed Private is inaccessible to everyone",async()=>{
 const game=await seed("influence","private");
 for(const user of [undefined,"owner","participant","operator"]) expect((await read(game.slug,user)).status).toBe(404);
});
test("unlisted entry works by known URL; malformed config fails closed; unsupported private Werewolf stays inaccessible",async()=>{
 const game=await seed("werewolf","unlisted");expect((await read(game.slug)).status).toBe(200);
 for(const config of ["bad","null","[]",'{"visibility":"surprise"}','{"visibility":["public"]}']) {
  await db.update(schema.games).set({config}).where(eq(schema.games.id,game.id));expect((await read(game.id)).status).toBe(404);
 }
 await db.update(schema.games).set({config:'{"visibility":"private"}'}).where(eq(schema.games.id,game.id));
 expect((await read(game.id,"owner")).status).toBe(404);
 expect(await (await read("missing")).json()).toEqual({error:"Game not found"});
});

test("anonymous cards are bounded and respect hidden and unlisted visibility",async()=>{
 const game=await seed("werewolf","unlisted");
 await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,game.id));
 const card=()=>createGameEntryRoutes(db).request(`/api/game-entries/${game.slug}/card`);
 const response=await card();expect(response.status).toBe(200);
 expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 expect(await response.json()).toEqual({id:game.id,slug:game.slug,gameKind:"werewolf",status:"completed",visibility:"unlisted",title:game.slug,description:"Watch AI agents make allies, tell lies, and turn on each other.",coverUrl:null,cast:[]});
 await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,game.id));
 expect((await card()).status).toBe(404);
});

test("card cast and portraits use original public identities, and disappear when hidden",async()=>{
 const game=await seed("influence","unlisted");
 await db.insert(schema.gamePlayers).values({id:"actor",gameId:game.id,agentConfig:"{}",persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png",personality:"PRIVATE_STRATEGY"})});
 const app=createGameEntryRoutes(db);
 const card=await app.request(`/api/game-entries/${game.slug}/card`);
 const json=await card.json() as {cast: Array<{id:string;name:string}>};
 expect(json.cast).toEqual([{id:"actor",name:"Original"}]);
 expect(JSON.stringify(json)).not.toContain("PRIVATE_STRATEGY");
 const portrait=()=>app.request(`/api/game-entries/${game.slug}/card/portrait/actor`);
 const image=await portrait();
 expect(image.status).toBe(200);expect(image.headers.get("content-type")).toBe("image/png");
 expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(1000);
 let release!:()=>void;
 const pending = new Promise<void>(resolve => {release = resolve;});
 const busy = Array.from({length:4},()=>withPublicArtworkCapacity(()=>pending));
 try {
  const overloaded=await portrait();expect(overloaded.status).toBe(503);expect(overloaded.headers.get("retry-after")).toBe("5");
  const overloadedCard=await app.request(`/api/game-entries/${game.slug}/card`);
  expect(overloadedCard.status).toBe(503);expect(overloadedCard.headers.get("retry-after")).toBe("5");
 }
 finally {release();await Promise.all(busy);}
 expect((await app.request(`/api/game-entries/${game.slug}/card/portrait/outsider`)).status).toBe(404);
 await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,game.id));
 expect((await portrait()).status).toBe(404);
});

test("Werewolf card cast contains only sequence-one identity, never hidden roles or later facts",async()=>{
 const game=await seed("werewolf");
 const events=await completedWerewolfResultsFixture("saved",game.id,2);
 await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,game.id));
 await db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:game.id,sequence:event.sequence,event})));
 const first=events[0]!;
 if(first.type!=="werewolf.started") throw new Error("Missing opening event");
 const response=await createGameEntryRoutes(db).request(`/api/game-entries/${game.slug}/card`);
 expect(response.status).toBe(200);
 const json=await response.json() as {cast:Array<{id:string;name:string}>};
 expect(json.cast).toEqual(first.payload.players.slice(0,4).map(({id,name})=>({id,name})));
 for(const member of json.cast) expect(Object.keys(member).sort()).toEqual(["id","name"]);
 expect(JSON.stringify(json)).not.toContain("PRIVATE_THINKING");
});

test("portrait is withdrawn when cast identity changes during artwork loading",async()=>{
 const game=await seed("influence");
 await db.insert(schema.gamePlayers).values({id:"actor",gameId:game.id,agentConfig:"{}",persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png"})});
 let release!:()=>void, markStarted!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{markStarted=resolve;});
 const png=await readFile(new URL("../../../web/public/avatars/personas/observer.png",import.meta.url));
 const read=spyOn(visualGameAssets,"readVisualProfileImage").mockImplementation(async()=>{markStarted();await gate;return png;});
 try {
  const response=createGameEntryRoutes(db).request(`/api/game-entries/${game.slug}/card/portrait/actor`);
  await started;
  await db.update(schema.gamePlayers).set({persona:JSON.stringify({name:"Changed",avatarUrl:"/avatars/personas/observer.png"})}).where(eq(schema.gamePlayers.id,"actor"));
  release();
  expect((await response).status).toBe(503);
 } finally {release();read.mockRestore();}
});

test("cutout requires a frozen confirmed head and returns bounded transparent artwork",async()=>{
 const game=await seed("influence");
 const source=HOUSE_BODY_ART.observer;
 const headPosition={sourceUrl:source.url,sourceHash:source.sha256,sourceWidth:source.width,sourceHeight:source.height,
  rect:{x:0.42,y:0.05,width:0.16,height:0.14},confirmation:{userId:"owner",at:"2026-01-01T00:00:00.000Z"}};
 await db.insert(schema.gamePlayers).values({id:"actor",gameId:game.id,agentConfig:"{}",persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png",fullBodyReferenceUrl:source.url,headPosition})});
 const app=createGameEntryRoutes(db), path=`/api/game-entries/${game.slug}/card/portrait/actor`;
 const response=await app.request(`${path}?kind=cutout`);
 expect(response.status).toBe(200);
 const bytes=Buffer.from(await response.arrayBuffer());
 expect(await sharp(bytes).metadata()).toMatchObject({format:"png",width:480,height:600,hasAlpha:true});
 expect((await sharp(bytes).stats()).isOpaque).toBe(false);
 expect((await app.request(`${path}?kind=invalid`)).status).toBe(400);
 await db.update(schema.gamePlayers).set({persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png",fullBodyReferenceUrl:source.url})}).where(eq(schema.gamePlayers.id,"actor"));
 expect((await app.request(`${path}?kind=cutout`)).status).toBe(404);
 await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,game.id));
 expect((await app.request(`${path}?kind=cutout`)).status).toBe(404);
});

test("cutout crop rejects opaque artwork and invalid coordinates",async()=>{
 const opaque=await sharp({create:{width:100,height:150,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();
 expect(await gameCardCutoutPng(opaque,{x:0.3,y:0.1,width:0.4,height:0.2})).toBeNull();
 expect(await gameCardCutoutPng(opaque,{x:0.8,y:0.1,width:0.4,height:0.2})).toBeNull();
});

test("game card selects a ready non-private cutout of the exact frozen source",async()=>{
 const game=await seed("influence"), source=HOUSE_BODY_ART.observer;
 const sourceBytes=await readFile(new URL("../../../web/public/avatars/personas/full-body-v1/observer.webp",import.meta.url));
 const payload=await storeBinary(sourceBytes);
 const headPosition={sourceUrl:source.url,sourceHash:source.sha256,sourceWidth:source.width,sourceHeight:source.height,
  rect:{x:0.42,y:0.05,width:0.16,height:0.14},confirmation:{userId:"owner",at:"2026-01-01T00:00:00.000Z"}};
 await db.insert(schema.gamePlayers).values({id:"actor",gameId:game.id,agentConfig:"{}",persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png",fullBodyReferenceUrl:source.url,headPosition})});
 await db.insert(schema.characterCutouts).values({id:"ready",privateSource:false,sourceHash:source.sha256,recipe:"test",source:payload,image:payload,width:source.width,height:source.height,status:"ready"});
 const opaque=await sharp({create:{width:100,height:150,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();
 const read=spyOn(visualGameAssets,"readVisualProfileImage").mockResolvedValue(opaque);
 try {
  const path=`/api/game-entries/${game.slug}/card/portrait/actor?kind=cutout`;
  expect((await createGameEntryRoutes(db).request(path)).status).toBe(200);
  expect(read).not.toHaveBeenCalled();
  await db.update(schema.characterCutouts).set({privateSource:true}).where(eq(schema.characterCutouts.id,"ready"));
  expect((await createGameEntryRoutes(db).request(path)).status).toBe(404);
  const wrongSource=await storeBinary(opaque);
  await db.update(schema.characterCutouts).set({privateSource:false,source:wrongSource}).where(eq(schema.characterCutouts.id,"ready"));
  expect((await createGameEntryRoutes(db).request(path)).status).toBe(404);
 } finally {read.mockRestore();}
});

test("frozen artifact cutouts cannot cross game boundaries",async()=>{
 const game=await seed("influence");
 await db.insert(schema.games).values({id:"other-game",slug:"other-game",gameKind:"influence",config:'{"visibility":"public"}'});
 const image=await readFile(new URL("../../../web/public/avatars/personas/full-body-v1/observer.webp",import.meta.url));
 const payload=await storeBinary(image);
 await db.insert(schema.gamePlayers).values({id:"actor",gameId:game.id,agentConfig:"{}",persona:JSON.stringify({name:"Original",avatarUrl:"/avatars/personas/observer.png"})});
 await db.insert(schema.visualArtifacts).values([
  {id:"source",gameId:game.id,contentHash:payload.sha256,image:payload,width:1024,height:1536},
  {id:"foreign-cutout",gameId:"other-game",contentHash:payload.sha256,image:payload,width:1024,height:1536},
 ]);
 await db.insert(schema.visualGameAssets).values({gameId:game.id,profiles:[],cast:[{id:"actor",name:"Original",referenceArtifactId:"source",performanceInstructions:"",headRectangle:{x:0.42,y:0.05,width:0.16,height:0.14}}]});
 await db.insert(schema.visualCharacterCutouts).values({sourceArtifactId:"source",artifactId:"foreign-cutout"});
 const response=await createGameEntryRoutes(db).request(`/api/game-entries/${game.slug}/card/portrait/actor?kind=cutout`);
 expect(response.status).toBe(503);
});
