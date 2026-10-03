import { beforeEach, expect, test } from "bun:test";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { publicGameFilter, isViewerGame } from "../services/game-visibility.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createGameRoutes } from "../routes/games.js";
import { createWerewolfLobby, joinWerewolfLobby, startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { createWerewolfGame } from "../services/werewolf-games.js";
import { setServer, broadcastGamePublication, handleOpen, handleClose } from "../services/ws-manager.js";
import { viewerGameAvailable } from "../services/game-visibility.js";
import type { ServerWebSocket } from "bun";
import type { WsConnectionData } from "../services/ws-manager.js";
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); await db.insert(schema.users).values({id:"owner"}); });

test("discovery filters before limit and counts, while unlisted links work for both games", async () => {
  for (const kind of ["influence", "werewolf"] as const) {
    await db.insert(schema.games).values(Array.from({length: 102}, (_, i) => ({id:`${kind}-${i}`, slug:`${kind}-${i}`, gameKind:kind, config: JSON.stringify({visibility:i === 101 ? "public" : "unlisted", providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}], preset:"one_wolf"}), createdAt: new Date(2026,0,1,0,0,102-i).toISOString()})));
  }
  const listed = await db.select().from(schema.games).where(publicGameFilter()).limit(100);
  expect(listed.map(g=>g.id).sort()).toEqual(["influence-101","werewolf-101"]);
  const wolves = createWerewolfRoutes(db), influence = createGameRoutes(db);
  expect(await (await wolves.request("/api/werewolf")).json()).toMatchObject([{id:"werewolf-101"}]);
  expect((await influence.request("/api/games/influence-0")).status).toBe(200);
  expect((await wolves.request("/api/werewolf/werewolf-0/lobby")).status).toBe(200);
  await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,"influence-0"));
  for (const suffix of ["", "/transcript", "/results", "/episode", "/visual", "/replay-watch-frames"]) expect((await influence.request(`/api/games/influence-0${suffix}`)).status).toBe(404);
});

test("missing visibility defaults public; null and removed or malformed values fail closed", async () => {
  for (const value of [null,"private","other",false,{},["public"]]) {
    const config=JSON.stringify({visibility:value});
    await db.insert(schema.games).values({id:JSON.stringify(value),slug:JSON.stringify(value),config});
    expect(isViewerGame({id:"invalid",config})).toBe(false);
  }
  await db.insert(schema.games).values({id:"default",slug:"default",config:"{}"});
  expect((await db.select().from(schema.games).where(publicGameFilter())).map(g=>g.id)).toEqual(["default"]);
});

test("Werewolf unlisted lobby accepts owned agents and retains visibility on start", async () => {
  const game=await createWerewolfLobby(db,"owner",{preset:"one_wolf",visibility:"unlisted"});
  await db.insert(schema.agentProfiles).values({id:"agent",userId:"owner",name:"Player",personality:"Calm",strategyStyle:"Observe"});
  await joinWerewolfLobby(db,game.slug,"owner","agent");
  await startWerewolfLobby(db,game.id);
  const [row]=await db.select().from(schema.games).where(eq(schema.games.id,game.id));
  expect(JSON.parse(row!.config).visibility).toBe("unlisted");
  expect(await (await createWerewolfRoutes(db).request("/api/werewolf")).json()).toEqual([]);
  expect((await createWerewolfRoutes(db).request(`/api/werewolf/${game.slug}?audience=mystery`)).status).toBe(200);
});

test("both Werewolf creation paths reject invalid visibility before any game write", async () => {
  for (const visibility of [null,"private","invalid",false,{}]) {
    await expect(createWerewolfLobby(db,"owner",{preset:"one_wolf",visibility})).rejects.toThrow("visibility");
    await expect(createWerewolfGame(db,"owner",{preset:"one_wolf",agentProfileIds:[],visibility})).rejects.toThrow("visibility");
  }
  expect(await db.select().from(schema.games)).toHaveLength(0);
});

test("hiding an open stream blocks subsequent publications and closes its viewer", async () => {
  await db.insert(schema.games).values({id:"stream",slug:"stream",config:'{"visibility":"unlisted"}'});
  const sent:string[]=[], closed:number[]=[];
  const ws={data:{gameId:"stream"},subscribe(){},unsubscribe(){},close(code:number){closed.push(code);}} as unknown as ServerWebSocket<WsConnectionData>;
  setServer({publish(_topic,data){sent.push(String(data));}}, id=>viewerGameAvailable(db,id)); handleOpen(ws);
  try {
    const event={type:"publication",gameId:"stream",publicationSequence:1,turnSequence:1,payload:{type:"game_over",totalRounds:1}} as const;
    broadcastGamePublication(event);
    for (let i=0; i<100 && sent.length===0; i++) await Bun.sleep(10);
    expect(sent).toHaveLength(1);
    await db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,"stream"));
    broadcastGamePublication({...event,publicationSequence:2});
    for (let i=0; i<100 && closed.length===0; i++) await Bun.sleep(10);
    expect(closed).toEqual([1008]); expect(sent).toHaveLength(1);
  } finally {handleClose(ws);setServer({publish(){}});}
});


test("asynchronous visibility checks preserve live publication order", async () => {
  const sent: number[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let checks = 0;
  setServer({publish(_topic, data) { sent.push(JSON.parse(String(data)).publicationSequence); }}, async () => {
    if (++checks === 1) await gate;
    return true;
  });
  try {
    const event = {type:"publication",gameId:"ordered",publicationSequence:1,turnSequence:1,payload:{type:"game_over",totalRounds:1}} as const;
    broadcastGamePublication(event);
    broadcastGamePublication({...event,publicationSequence:2});
    await Bun.sleep(10);
    expect(sent).toEqual([]);
    expect(checks).toBe(1);
    release();
    for (let i=0; i<100 && sent.length<2; i++) await Bun.sleep(10);
    expect(sent).toEqual([1,2]);
  } finally {release();setServer({publish(){}});}
});
