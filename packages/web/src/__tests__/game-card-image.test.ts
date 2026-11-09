import {afterEach, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {GET} from "../app/games/[slug]/card-image/route";

const original = globalThis.fetch;
afterEach(() => {globalThis.fetch = original;});
const request = () => GET(new Request("http://example.test/card.png"), {params:Promise.resolve({slug:"quiet-jade-moon"})});
test("renders opening-cast cutouts via the fixed application endpoint", async () => {
 const calls: string[] = [];
 const local = resolve(process.cwd(), process.cwd().endsWith("packages/web") ? "public/avatars/personas/observer.png" : "packages/web/public/avatars/personas/observer.png");
 const png = await readFile(local);
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
   const url = String(input); calls.push(url);
   if (url.endsWith("/card")) return Response.json({id:"game",slug:"quiet-jade-moon",gameKind:"werewolf",status:"completed",visibility:"unlisted",title:"A night in the village",description:"Meet the cast",coverUrl:"http://localhost/secret",cast:[{id:"one",name:"Iris"}]});
   expect(url).toEndWith("/api/game-entries/quiet-jade-moon/card/portrait/one?kind=cutout");
   expect(init?.redirect).toBe("error");
   return new Response(png, {headers:{"Content-Type":"image/png"}});
 }) as typeof fetch;
 const response = await request();
 expect(response.status).toBe(200);
 expect(response.headers.get("content-type")).toContain("image/png");
 expect(response.headers.get("cache-control")).toContain("no-store");
 expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
 expect(calls).toHaveLength(3);
 expect(calls.join(" ")).not.toContain("secret");
});
test("uses a headshot when a transparent cutout is unavailable", async () => {
 const png = await readFile(resolve(process.cwd(), process.cwd().endsWith("packages/web") ? "public/avatars/personas/observer.png" : "packages/web/public/avatars/personas/observer.png"));
 const calls: string[] = [];
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
   const url = String(input); calls.push(url);
   if (url.endsWith("/card")) return Response.json({id:"game",slug:"quiet-jade-moon",gameKind:"influence",status:"completed",visibility:"public",title:"In Good Company",description:"",coverUrl:null,cast:[{id:"one",name:"Iris"}]});
   if (url.endsWith("?kind=cutout")) return new Response(null,{status:404});
   return new Response(png,{headers:{"Content-Type":"image/png"}});
 }) as typeof fetch;
 expect((await request()).status).toBe(200);
 expect(calls.filter(url => url.includes("/card/portrait/"))).toEqual([
   "http://127.0.0.1:3000/api/game-entries/quiet-jade-moon/card/portrait/one?kind=cutout",
   "http://127.0.0.1:3000/api/game-entries/quiet-jade-moon/card/portrait/one",
 ]);
});
test("Farcaster uses the same opening cast in a 3:2 card", async () => {
 const png = await readFile(resolve(process.cwd(), process.cwd().endsWith("packages/web") ? "public/avatars/personas/observer.png" : "packages/web/public/avatars/personas/observer.png"));
 const game = {id:"game",slug:"quiet-jade-moon",gameKind:"werewolf",status:"completed",visibility:"public",title:"A Long Night at the House",description:"",coverUrl:null,cast:["one","two","three","four"].map(id=>({id,name:id}))};
 const portraits: string[] = [];
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
   const url = String(input);
   if (url.endsWith("/card")) return Response.json(game);
   portraits.push(url);
   return new Response(png,{headers:{"Content-Type":"image/png"}});
 }) as typeof fetch;
 const response = await GET(new Request("http://example.test/card.png?format=farcaster"), {params:Promise.resolve({slug:"quiet-jade-moon"})});
 const bytes = Buffer.from(await response.arrayBuffer());
 expect(response.status).toBe(200);
 expect(bytes.readUInt32BE(16)).toBe(1200);
 expect(bytes.readUInt32BE(20)).toBe(800);
 expect(portraits).toHaveLength(4);
 expect(portraits.every(url=>url.endsWith("?kind=cutout"))).toBe(true);
});
test("hidden game returns 404 without loading artwork", async () => {
 let count = 0;
 globalThis.fetch = (async () => {count++; return new Response(null,{status:404});}) as unknown as typeof fetch;
 expect((await request()).status).toBe(404);
 expect(count).toBe(1);
});
test("missing portraits may fall back, but overloads and broken artwork fail the card", async () => {
 const game = {id:"game",slug:"quiet-jade-moon",gameKind:"influence",status:"completed",visibility:"public",title:"Game",description:"",coverUrl:null,cast:[{id:"one",name:"Iris"}]};
 for (const scenario of ["missing", "busy", "invalid", "network"] as const) {
   globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
     if (String(input).endsWith("/card")) return Response.json(game);
     if (scenario === "missing") return new Response(null,{status:404});
     if (scenario === "busy") return new Response(null,{status:503,headers:{"Retry-After":"5"}});
     if (scenario === "invalid") return new Response("not an image",{headers:{"Content-Type":"text/plain"}});
     throw new Error("network unavailable");
   }) as typeof fetch;
   const response = await request();
   expect(response.status).toBe(scenario === "missing" ? 200 : 503);
   if (scenario === "busy") expect(response.headers.get("retry-after")).toBe("5");
 }
});
test("each request rechecks visibility after sharing an in-flight render", async () => {
 let release!: () => void, started!: () => void;
 const gate = new Promise<void>(resolve => {release = resolve;});
 const artworkStarted = new Promise<void>(resolve => {started = resolve;});
 let metadataReads = 0;
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
   const url = String(input);
   if (url.endsWith("/card")) {
     metadataReads++;
     if (metadataReads > 1) return new Response(null,{status:404});
     return Response.json({id:"game",slug:"quiet-jade-moon",gameKind:"werewolf",status:"completed",visibility:"public",title:"Game",description:"",coverUrl:null,cast:[{id:"one",name:"Iris"}]});
   }
   if (url.includes("/card/portrait/")) {started();await gate;return new Response(null,{status:404});}
   throw new Error("Unexpected request");
 }) as typeof fetch;
 const first = request();
 await artworkStarted;
 const second = request();
 release();
 expect((await first).status).toBe(404);
 expect((await second).status).toBe(404);
 expect(metadataReads).toBe(3);
});
test("waiting cast changes during a shared render invalidate every request", async () => {
 let release!: () => void, started!: () => void;
 const gate = new Promise<void>(resolve => {release = resolve;});
 const artworkStarted = new Promise<void>(resolve => {started = resolve;});
 let reads = 0;
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
   const url = String(input);
   if (url.endsWith("/card")) {
     reads++;
     return Response.json({id:"game",slug:"quiet-jade-moon",gameKind:"werewolf",status:"waiting",visibility:"public",title:"Game",description:"",coverUrl:null,cast:reads === 1 ? [{id:"one",name:"Iris"}] : [{id:"two",name:"Nova"}]});
   }
   if (url.includes("/card/portrait/")) {started();await gate;return new Response(null,{status:404});}
   throw new Error("Unexpected request");
 }) as typeof fetch;
 const first = request();
 await artworkStarted;
 const second = request();
 release();
 for (const result of await Promise.all([first, second])) {expect(result.status).toBe(503);expect(result.headers.get("retry-after")).toBe("5");}
 expect(reads).toBe(3);
});
test("a changed episode title invalidates a rendered card", async () => {
 let reads = 0;
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
   if (!String(input).endsWith("/card")) throw new Error("Unexpected request");
   reads++;
   return Response.json({id:"game",slug:"quiet-jade-moon",gameKind:"influence",status:"completed",visibility:"public",title:reads === 1 ? "Original Title" : "Updated Title",description:"",coverUrl:null,cast:[]});
 }) as typeof fetch;
 const response = await request();
 expect(response.status).toBe(503);
 expect(response.headers.get("retry-after")).toBe("5");
});
