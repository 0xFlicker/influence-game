import { expect, test } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter } from "../provider-adapters";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";
import { exactStructuredOutputRegistry } from "../structured-output";
import { completedPackStrategyFixture } from "../fixtures/werewolf-pack-strategy";
import { werewolfCutSource } from "../house-cuts/werewolf-source";
import { werewolfDecisionArtifact, WerewolfModelAgent } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { werewolfFallback } from "../werewolf/runner";
import { projectWerewolfProductionWatch } from "../werewolf/watch";
import type { WerewolfDecision, WerewolfRequest } from "../werewolf/types";

function fixture(version: 9 | 10 | 11 | 12 | 13 = 13, wolves: 1 | 2 = 2) {
  const config = {...werewolfConfig(wolves === 2 ? "two_wolves" : "one_wolf"),rulesVersion:version};
  const players = Array.from({length:wolves === 2 ? 8 : 6}, (_,i)=>({id:`p${i}`,name:`Player ${i}`,personality:"Curious",backstory:"",strategy:"",avatarUrl:null}));
  const events = [startWerewolf("v13-test",players,config,"strategy-seed")];
  const state = () => replayWerewolf(events);
  const request = () => { const step = nextWerewolfStep(state()); if (step.kind !== "action") throw new Error("Expected action"); return step.request; };
  function accept(decision?: WerewolfDecision, fallback = false) {
    const before = state(), step = nextWerewolfStep(before);
    if (step.kind === "complete") throw new Error("Unexpected completion");
    const event = werewolfEvent(before, step.kind === "event" ? step.event : {type:"werewolf.action_accepted",payload:{...step.request,
      decision:decision ?? (step.request.action === "introduce" ? {kind:"speech",text:"My introduction.",cue:null} : werewolfFallback(before,step.request)),fallback:fallback ? "provider_unavailable" : null}});
    events.push(event); return state();
  }
  while (state().phase !== "pack") accept();
  const target = request().legalTargetIds[0]!, other = request().legalTargetIds[1]!;
  const propose = (id = target, text: string | null = "Plan our next vote.", unavailable = false) => accept(unavailable ? werewolfFallback(state(),request()) : {kind:"spoken_target",targetId:id,text,cue:null,thinking:"PRIVATE_THINKING"},unavailable);
  return {events,state,request,accept,propose,target,other};
}

test("fresh v13 setup keeps Hunter optional and lone wolves keep one solo explanation", () => {
  const c = fixture(13,1), request = c.request();
  expect(werewolfConfig("two_wolves").rulesVersion).toBe(14);
  expect(Object.values(c.state().roles)).not.toContain("hunter");
  expect(request).toMatchObject({solo:true,action:"pack_propose"});
  expect(request).not.toHaveProperty("packTurn");
  c.accept({kind:"solo_target",targetId:c.target,text:"My private attack and plan.",cue:null});
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{type:"werewolf.pack_vote_resolved",payload:{targetId:c.target,discussion:{beats:1,agreementBeat:1,endedBy:"solo"}}}});
});

for (const agreementBeat of [2,3,4,5,6]) test(`agreement at beat ${agreementBeat} locks without resetting either wolf's three turns`, () => {
  const c = fixture();
  for (let beat=1;beat<=agreementBeat;beat++) {
    const previous = c.state().actions.at(-1)?.decision;
    const target = beat === agreementBeat && previous?.kind === "spoken_target" ? previous.targetId! : beat % 2 ? c.target : c.other;
    c.propose(target);
  }
  const locked = c.state();
  const last = locked.actions.at(-1)!.decision;
  expect(locked.pack).toMatchObject({targetId:last.kind === "spoken_target" ? last.targetId : null,ended:false,discussion:{agreementBeat,consecutivePasses:0}});
  const evidence = structuredClone(locked.pack!.discussion!.agreementBallots);
  while (c.state().actions.length < 6) {
    expect(c.request()).toMatchObject({packTurn:{lockedTargetId:locked.pack!.targetId,maxTurns:3}});
    expect(c.request().legalTargetIds).toEqual([locked.pack!.targetId!]);
    c.propose(locked.pack!.targetId!);
  }
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{type:"werewolf.pack_vote_resolved",payload:{ballots:evidence,targetId:locked.pack!.targetId,discussion:{beats:6,agreementBeat,endedBy:"turn_limit"}}}});
  const counts = c.state().actions.reduce<Record<string,number>>((out,a)=>({...out,[a.actorId]:(out[a.actorId] ?? 0)+1}),{});
  expect(Object.values(counts)).toEqual([3,3]);
  const proposals = c.events.filter(e=>e.type === "werewolf.action_accepted" && e.payload.action === "pack_propose");
  const order = proposals.slice(0,2).map(e=>e.type === "werewolf.action_accepted" ? e.payload.actorId : "");
  for (const [index,event] of [...proposals.entries()].toReversed()) {
    const resumed = replayWerewolf(c.events.slice(0,event.sequence));
    const count = index+1;
    expect(resumed.pack?.targetId).toBe(count >= agreementBeat ? locked.pack!.targetId : null);
    if (count < 6) expect(nextWerewolfStep(resumed)).toMatchObject({kind:"action",request:{actorId:order[count%2],packTurn:{turn:Math.floor(count/2)+1,lockedTargetId:count >= agreementBeat ? locked.pack!.targetId : null}}});
    else expect(nextWerewolfStep(resumed)).toMatchObject({kind:"event",event:{type:"werewolf.pack_vote_resolved",payload:{targetId:locked.pack!.targetId}}});
  }
  c.accept();
  expect(c.state().pack?.ended).toBe(true);
  expect(c.state().history.filter(e=>e.kind === "pack_vote")).toHaveLength(1);
});

test("pre-agreement silence neither ends negotiation nor counts toward the post-lock pass streak", () => {
  const c = fixture(); c.propose(c.target,null); c.propose(c.other,null);
  expect(c.request()).toMatchObject({packTurn:{turn:2,lockedTargetId:null}});
  c.propose(c.other,null);
  expect(c.state().pack).toMatchObject({targetId:c.other,discussion:{agreementBeat:3,consecutivePasses:0}});
  c.propose(c.other,null);
  expect(c.request()).toMatchObject({packTurn:{turn:3,lockedTargetId:c.other}});
  c.propose(c.other,null);
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{payload:{discussion:{beats:5,agreementBeat:3,endedBy:"both_pass"}}}});
});

test("two silent matching proposals still leave strategy space; two later passes close at beat four", () => {
  const c = fixture(); c.propose(c.target,null); c.propose(c.target,null);
  expect(c.request()).toMatchObject({packTurn:{turn:2,lockedTargetId:c.target}});
  c.propose(c.target,null); c.propose(c.target,null);
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{payload:{targetId:c.target,discussion:{beats:4,endedBy:"both_pass"}}}});
});

test("speech resets passes; cues and private thinking do not create speech", () => {
  const c = fixture(); c.propose(); c.propose(); c.propose(c.target,null); c.propose();
  c.accept({kind:"spoken_target",targetId:c.target,text:null,cue:"Listens closely.",thinking:"Nothing new."});
  expect(c.state().pack?.discussion?.consecutivePasses).toBe(1);
  c.propose(c.target,null);
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{payload:{discussion:{beats:6,endedBy:"both_pass"}}}});
});

test("failed strategy slots cannot erase a lock or impersonate a voluntary pass", () => {
  const c = fixture(); c.propose(); c.propose(); c.propose(c.target,null);
  c.propose(c.target,null,true);
  expect(c.state().pack).toMatchObject({targetId:c.target,discussion:{consecutivePasses:0}});
  c.propose(c.target,null); c.propose(c.target,"Another strategy step.");
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{payload:{targetId:c.target,discussion:{beats:6,endedBy:"turn_limit"}}}});
});

test("six silent disagreements yield no attack and retain Doctor and Seer decisions", () => {
  const c = fixture(); for (let beat=1;beat<=6;beat++) c.propose(beat%2 ? c.target : c.other,null);
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{payload:{targetId:null,endReason:"attempt_limit",discussion:{agreementBeat:null,beats:6,endedBy:"turn_limit"}}}});
  c.accept(); c.accept();
  const actions: string[] = [];
  while (nextWerewolfStep(c.state()).kind === "action") {
    const request = c.request(); actions.push(request.action);
    c.accept({kind:"solo_target",targetId:request.legalTargetIds[0]!,text:"My private choice.",cue:null});
  }
  expect(actions.sort()).toEqual(["investigate","protect"]);
  expect(nextWerewolfStep(c.state())).toMatchObject({kind:"event",event:{type:"werewolf.night_resolved",payload:{attackTargetId:null}}});
});

for (const version of [9,10,11,12] as const) test(`released v${version} still ends immediately at agreement with its original shapes`, () => {
  const c = fixture(version); expect(c.request()).not.toHaveProperty("packTurn");
  c.propose(); c.propose();
  expect(c.state().pack).not.toHaveProperty("discussion");
  const next = nextWerewolfStep(c.state());
  expect(next).toMatchObject({kind:"event",event:{type:"werewolf.pack_vote_resolved",payload:{attempt:1,targetId:c.target}}});
  if (next.kind === "event") expect(next.event.payload).not.toHaveProperty("discussion");
});

test("strict v13 schemas reject malformed output and changed locked targets without accepting speech", () => {
  const c = fixture(); c.propose(); c.propose(); const before = c.state();
  const artifact = werewolfDecisionArtifact(c.request());
  expect(artifact.schema).toMatchObject({additionalProperties:false,properties:{targetId:{enum:[c.target]}}});
  const valid = {text:"Tomorrow we should build separate public cases.",cue:null,thinking:"My own private reasoning.",targetId:c.target};
  for (const raw of ["plain prose","{}","{broken",JSON.stringify({text:"Only prose"}),JSON.stringify({...valid,extra:true}),JSON.stringify({...valid,targetId:c.other}),JSON.stringify({...valid,targetId:null}),JSON.stringify({...valid,thinking:""}),JSON.stringify({...valid,text:" "}),JSON.stringify({...valid,text:"é".repeat(161)}),`[${JSON.stringify(valid)}`,`${JSON.stringify(valid)} ${JSON.stringify(valid)}`])
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact,raw).status).toBe("invalid");
  for (const raw of [JSON.stringify(valid),`prefix ${JSON.stringify(valid)}`,`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``])
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact,raw).status).toBe("valid");
  expect(()=>c.propose(c.other)).toThrow("locked");
  expect(c.state()).toEqual(before);
});

function model(capture: (body: {messages:Array<{content:string}>}) => unknown) {
  const client = new OpenAI({apiKey:"fixture",baseURL:"http://fixture.invalid/v1",maxRetries:0,fetch:async (_url,init)=>Response.json({id:"strategy-prompt",object:"chat.completion",created:0,model:"glm-5-2",
    choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(capture(JSON.parse(String(init?.body))))}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})});
  const entry = modelCatalogEntryById("katana:glm-5-2")!;
  const runtime: LlmProviderRuntime = {adapter:createProviderAdapter("katana",client),catalogId:entry.id,providerProfileId:"katana",modelId:entry.modelId,modelCapabilities:entry.capabilities,reasoningPolicy:"medium",position:0,role:"primary"};
  return new WerewolfModelAgent({runtimes:[runtime]});
}

test("actual pack and next-day invocations communicate the accepted plan only to wolves", async () => {
  const events = await completedPackStrategyFixture();
  let packInvocations=0,dayInvocations=0,villageInvocations=0;
  const agent = model(body=>{
    const task = JSON.parse(body.messages.at(-1)!.content) as {request:WerewolfRequest;instruction?:string;observation:ReturnType<typeof observeWerewolf>};
    const request = task.request;
    expect(body.messages[0]!.content).not.toContain("Matching current targets immediately lock the attack");
    if (request.action === "pack_propose") {
      packInvocations++;
      expect(task.instruction).toContain("two jobs"); expect(task.instruction).toContain("tomorrow's discussion and vote");
      expect(task.instruction).not.toContain("Matching targets immediately ends negotiation");
      expect(body.messages[0]!.content).toContain("Share wolf plans");
      expect(body.messages[0]!.content).not.toContain("Keep undisclosed role information and plans in thinking");
      return {targetId:request.legalTargetIds[0],text:null,cue:null,thinking:"Listen for a useful addition."};
    }
    if (task.observation.self.role === "werewolf") {
      dayInvocations++; expect(JSON.stringify(task.observation.packProposals)).toContain("Tomorrow I will pressure");
    } else {
      villageInvocations++; expect(JSON.stringify(task.observation)).not.toContain("Tomorrow I will pressure");
      expect(task.observation.packProposals).toEqual([]);
    }
    expect(JSON.stringify(task.observation)).not.toContain("PRIVATE_PACK_THINKING");
    return request.action === "speaking_priority" ? {priority:50} : request.action === "public_vote"
      ? {targetId:null,text:null,cue:null,thinking:"Adapt to public votes."} : {text:null,cue:null,recipientId:null,replyToContributionId:null,thinking:"Listen."};
  });
  let state = replayWerewolf(events.slice(0,1));
  for (const event of events.slice(1)) {
    if (event.type === "werewolf.action_accepted" && (event.payload.action === "pack_propose" || state.day === 1 && ["speaking_priority","conversation","public_vote"].includes(event.payload.action))) {
      const {decision:_d,fallback:_f,...request} = event.payload;
      await agent.decide({gameId:state.gameId,actionSlot:event.sequence,request,observation:observeWerewolf(state,request.actorId)});
    }
    state = applyWerewolfEvent(state,event);
  }
  expect(packInvocations).toBe(6); expect(dayInvocations).toBeGreaterThanOrEqual(4); expect(villageInvocations).toBeGreaterThan(0);
  expect(JSON.stringify(projectWerewolfView(state,"mystery"))).not.toContain("Tomorrow I will pressure");
  const watch = projectWerewolfProductionWatch(events,"omniscient");
  const passes = watch.moments.filter(m=>m.entry.kind === "proposal" && !m.entry.text);
  expect(passes).toHaveLength(2);
  expect(passes.every(m=>!watch.playback.some(p=>p.cursor === m.cursor))).toBe(true);
});

test("exhausted invalid pack output cannot consume a turn, lose agreement or become accepted prose", async () => {
  const c = fixture(); c.propose(); c.propose(); const before = c.state();
  let attempts=0; const agent = model(()=>{attempts++;return {text:"Invalid speech without a target."};});
  await expect(agent.decide({gameId:before.gameId,actionSlot:before.sequence+1,request:c.request(),observation:observeWerewolf(before,c.request().actorId)})).rejects.toThrow();
  expect(attempts).toBe(3); expect(c.state()).toEqual(before);
});

test("v13 House Cuts retain accepted strategy speech at its canonical night coordinate without leaking it to Mystery", async () => {
  const events = await completedPackStrategyFixture();
  const omni = werewolfCutSource(events,"pack-strategy","omniscient");
  const strategy = omni.evidence.filter(e=>e.content.kind === "dialogue" && e.content.text.startsWith("Tomorrow"));
  expect(strategy).toHaveLength(2);
  for (const row of strategy) {
    expect(row.group).toBe("night:1"); expect(row.replayHref).toContain("audience=omniscient");
    if (row.content.kind === "dialogue") expect(new TextEncoder().encode(row.content.text).length).toBe(320);
  }
  expect(JSON.stringify(omni)).not.toContain("PRIVATE_PACK_THINKING");
  expect(JSON.stringify(omni)).not.toContain("SECRET_PASS_THINKING");
  expect(JSON.stringify(werewolfCutSource(events,"pack-strategy","mystery"))).not.toContain("Tomorrow I will pressure");
});
