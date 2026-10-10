import {afterAll,beforeEach,expect,test} from "bun:test";
import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {createGameEntryRoutes} from "../routes/game-entries.js";
import {createSessionToken} from "../middleware/auth.js";
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
