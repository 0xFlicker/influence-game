import {eq} from "drizzle-orm";
import { beforeEach, expect, test } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter, fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective, modelCatalogEntryById, type LlmProviderRuntime } from "@influence/engine";
import { advanceWerewolf, nextWerewolfStep, observeWerewolf, replayWerewolf, WerewolfModelAgent, type WerewolfAgent } from "@influence/engine/werewolf";
import { type DrizzleDB } from "../db/index.js";
import { createWerewolfGame, claimWerewolfGame, createWerewolfStore, releaseWerewolfOwner, readWerewolfView } from "../services/werewolf-games.js";
import { createApiProviderExecutionHooks } from "../services/provider-call-journal.js";
import { readWerewolfWatch } from "../services/werewolf-presentation.js";
import { readWerewolfThinking } from "../services/werewolf-thinking.js";
import { setupTestDB } from "./test-utils.js";
import { schema } from "../db/index.js";
import { grantTestAuthority } from "./rbac-fixtures.js";

let db: DrizzleDB;
beforeEach(async()=>{
  db = await setupTestDB();
  await db.insert(schema.users).values({id:"v13-owner"});
  await grantTestAuthority(db,"v13-owner",[],"admin");
});

const scripted: WerewolfAgent = { prepareRetrospectiveCapacity:fixtureRetrospectiveCapacity, getRetrospectiveStatement:fixtureWerewolfRetrospective, async decide({request}) {
  if (request.action === "pack_propose") return {kind:"spoken_target",targetId:request.legalTargetIds[0]!,text:request.packTurn?.turn === 3 ? null : "PRIVATE_STRATEGY: build a voting case tomorrow.",cue:null,thinking:"PRIVATE_THINKING"};
  return {kind:"speech",text:"My introduction.",cue:null};
}};

for (const version of [13,14] as const) for (const boundary of [2,3,5]) test(`v${version} owner recovery at pack beat ${boundary} preserves agreement and journaled strategy without redispatch`, async()=>{
  const game = await createWerewolfGame(db,"v13-owner",{preset:"two_wolves",agentProfileIds:[],providerManifest:[{catalogId:"katana:glm-5-2"}],maxDays:2});
  // Pin the synthetic starting event before exercising historical recovery.
  const [started] = await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId,game.id));
  if (!started || started.event.type !== "werewolf.started") throw new Error("Missing fixture start");
  await db.update(schema.werewolfEvents).set({event:{...started.event,payload:{...started.event.payload,config:{...started.event.payload.config,rulesVersion:version}}}}).where(eq(schema.werewolfEvents.gameId,game.id));
  const [row] = await db.select().from(schema.games).where(eq(schema.games.id,game.id));
  await db.update(schema.games).set({config:JSON.stringify({...JSON.parse(row!.config),rulesVersion:version})}).where(eq(schema.games.id,game.id));
  const claim = await claimWerewolfGame(db,game.id); if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(db,game.id,claim.claim.ownerEpoch);
  let state = replayWerewolf(await store.read());
  while (state.phase !== "pack" || state.actions.length < boundary) state = await advanceWerewolf(store,scripted);
  const locked = state.pack!.targetId;
  expect(state.config.rulesVersion).toBe(version); expect(locked).not.toBeNull();
  expect(state.pack?.discussion?.agreementBeat).toBe(2);
  const publicBefore = await readWerewolfView(db,game.id,"mystery");
  const next = nextWerewolfStep(state); if (next.kind !== "action") throw new Error("Missing strategy slot");
  const frozen = observeWerewolf(state,next.request.actorId);
  let dispatches=0;
  const client = new OpenAI({apiKey:"fixture",baseURL:"http://fixture.invalid/v1",maxRetries:0,fetch:async (_url,init)=>{
    dispatches++;
    const body = JSON.parse(String(init?.body));
    const task = JSON.parse(body.messages.at(-1).content);
    expect(task.request.legalTargetIds).toEqual([locked]);
    expect(task.observation).toEqual(frozen);
    return Response.json({id:`strategy-${dispatches}`,object:"chat.completion",created:0,model:"glm-5-2",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",reasoning_content:"PRIVATE_NATIVE_REASONING",
      content:JSON.stringify({targetId:dispatches === 1 ? "invalid-new-target" : locked,text:boundary === 5 ? null : "PRIVATE_STRATEGY: I will redirect tomorrow's vote.",cue:null,thinking:"PRIVATE_JOURNALED_THINKING"})}}],usage:{prompt_tokens:20,completion_tokens:15,total_tokens:35}});
  }});
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  const runtime: LlmProviderRuntime = {adapter:createProviderAdapter("katana",client),catalogId:model.id,providerProfileId:"katana",modelId:model.modelId,modelCapabilities:model.capabilities,reasoningPolicy:"medium",position:0,role:"primary"};
  const agent = (ownerEpoch:string)=>new WerewolfModelAgent({runtimes:[runtime],ownerEpoch,hooks:createApiProviderExecutionHooks(db,{gameId:game.id,ownerEpoch})});
  await expect(advanceWerewolf({...store,append:async()=>{throw new Error("Crash after accepted provider result");}},agent(claim.claim.ownerEpoch))).rejects.toThrow("Crash after accepted provider result");
  expect(dispatches).toBe(2); expect(replayWerewolf(await store.read())).toEqual(state);
  await releaseWerewolfOwner(db,game.id,claim.claim.ownerEpoch);
  const replacement = await claimWerewolfGame(db,game.id); if (!replacement.ok) throw new Error(replacement.error);
  const resumed = createWerewolfStore(db,game.id,replacement.claim.ownerEpoch);
  state = await advanceWerewolf(resumed,agent(replacement.claim.ownerEpoch));
  expect(dispatches).toBe(2);
  expect(state.actions).toHaveLength(boundary+1);
  expect(state.pack).toMatchObject({targetId:locked,ended:false,discussion:{agreementBeat:2,consecutivePasses:boundary === 5 ? 2 : 0}});
  expect(await readWerewolfView(db,game.id,"mystery")).toEqual(publicBefore);
  expect(JSON.stringify(await readWerewolfWatch(db,game.id,"mystery",1,64))).not.toContain("PRIVATE_");
  expect(JSON.stringify(await readWerewolfThinking(db,game.id,"omniscient",(await readWerewolfView(db,game.id,"omniscient")).cursor))).toContain("PRIVATE_JOURNALED_THINKING");
  if (boundary === 5) {
    state = await advanceWerewolf(resumed,scripted);
    expect(state.pack).toMatchObject({targetId:locked,ended:true});
    expect(state.history.at(-1)).toMatchObject({kind:"pack_vote",result:{discussion:{endedBy:"both_pass",beats:6}}});
  } else {
    while (state.phase === "pack" && !state.pack?.ended) state = await advanceWerewolf(resumed,scripted);
    expect(state.pack).toMatchObject({targetId:locked,ended:true});
  }
  expect(dispatches).toBe(2);
},30_000);
