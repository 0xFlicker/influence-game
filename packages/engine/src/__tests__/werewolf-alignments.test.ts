import {expect,test} from "bun:test";
import {werewolfDoctorSaveFixture} from "../fixtures/werewolf-doctor-save";
import {applyWerewolfEvent,replayWerewolf,WEREWOLF_RULES_V14,WEREWOLF_RULES_V13} from "../werewolf/rules";
import {observeWerewolf,projectWerewolfView} from "../werewolf/observation";
import {werewolfRoleCoaching} from "../werewolf/strategy";
import {werewolfSceneInventory} from "../werewolf/visual-scenes";
import {werewolfHouseNarrationInput} from "../werewolf/house-narration";
for (const version of [13,14] as const) test(`v${version} observations reveal only version-authorized eliminated alignments`,()=>{
  const events=werewolfDoctorSaveFixture(version);
  let state=replayWerewolf(events.slice(0,1));let checked=0;
  for (const event of events.slice(1)) {
    state=applyWerewolfEvent(state,event);
    if(state.outcome) break;
    for(const actorId of state.aliveIds) {
      const observation=observeWerewolf(state,actorId);
      for(const player of observation.board.players) {
        expect(player).not.toHaveProperty("role");
        if(version===14&&!player.alive) {expect(player.alignment).toBe(state.roles[player.id]==="werewolf"?"wolves":"village");checked++;}
        else expect(player).not.toHaveProperty("alignment");
      }
    }
    const mystery=projectWerewolfView(state,"mystery");
    expect(mystery.players.every(p=>!p.role)).toBe(true);
    expect(mystery.players.filter(p=>p.alignment).length).toBe(version===14?8-state.aliveIds.length:0);
  }
  if(version===14)expect(checked).toBeGreaterThan(0);
  const save=events.find(e=>e.type==="werewolf.night_resolved"&&e.payload.attackTargetId===e.payload.protectedId)!;
  const scenes=werewolfSceneInventory(events);
  expect(scenes.find(s=>s.boundarySequence===save.sequence-1)).toMatchObject({purpose:"hunt",doctorSaved:true});
  expect(scenes.find(s=>s.doctorSaved)?.wolfIds).toHaveLength(1);
  const death=events.findIndex(e=>e.type==="werewolf.day_vote_resolved"&&e.payload.eliminatedId);
  const narration=werewolfHouseNarrationInput(events.slice(0,death+1),"mystery");
  expect(JSON.stringify(narration)).toContain(version===14?'"alignment":"wolves"':'"day"');
});
test("all role coaching agrees with the new public alignment rule and historical rules stay frozen",()=>{
  expect(WEREWOLF_RULES_V14).toContain("board.players[].alignment");
  expect(WEREWOLF_RULES_V13).not.toContain("board.players[].alignment");
  for(const role of ["villager","hunter","doctor","seer","werewolf"] as const){
    expect(werewolfRoleCoaching(role,14)).toContain("confirmed public wolves/village alignment");
    expect(werewolfRoleCoaching(role,14)).not.toContain("Do not assume the remaining wolf count is known");
    expect(werewolfRoleCoaching(role,13)).not.toContain("confirmed public wolves/village alignment");
  }
});

test("every actual contestant invocation receives versioned rules and confirmed alignments",async()=>{
  const {default:OpenAI}=await import("openai");
  const {createProviderAdapter}=await import("../provider-adapters");
  const {modelCatalogEntryById}=await import("../model-catalog");
  const {WerewolfModelAgent}=await import("../werewolf/agent");
  const events=werewolfDoctorSaveFixture();
  let answer:Record<string,unknown>={};
  const seen=new Set<string>();
  const client=new OpenAI({apiKey:"fixture",baseURL:"http://fixture.invalid/v1",maxRetries:0,fetch:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    const task=JSON.parse(body.messages.at(-1).content);
    expect(body.messages[0].content).toContain("board.players[].alignment");
    expect(task.roleCoaching).toContain("confirmed public wolves/village alignment");
    expect(JSON.stringify(body.messages)).not.toContain("Roles remain hidden on death");
    for(const player of task.observation.board.players){
      if(!player.alive)expect(["wolves","village"]).toContain(player.alignment);
      else expect(player).not.toHaveProperty("alignment");
    }
    seen.add(task.request.action);
    if(body.response_format?.json_schema?.schema?.properties?.thinking && !("thinking" in answer)) answer={...answer,thinking:"Use only the confirmed public record."};
    return Response.json({id:"alignment-prompt",object:"chat.completion",created:0,model:"glm-5-2",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(answer)}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }});
  const entry=modelCatalogEntryById("katana:glm-5-2")!;
  const agent=new WerewolfModelAgent({runtimes:[{adapter:createProviderAdapter("katana",client),catalogId:entry.id,providerProfileId:"katana",modelId:entry.modelId,modelCapabilities:entry.capabilities,reasoningPolicy:"medium",position:0,role:"primary"}]});
  let state=replayWerewolf(events.slice(0,1));
  for(const event of events.slice(1)){
    if(event.type==="werewolf.action_accepted"){
      const {decision,fallback:_fallback,...request}=event.payload;
      const {kind:_kind,...value}=decision;answer=value;
      await agent.decide({gameId:state.gameId,actionSlot:event.sequence,request,observation:observeWerewolf(state,request.actorId)});
    }
    state=applyWerewolfEvent(state,event);
  }
  expect([...seen].sort()).toEqual(["conversation","introduce","investigate","pack_propose","protect","public_vote","snipe","speaking_priority"]);
});

test("retrospectives retain alignment knowledge from the speaker's living turns only",async()=>{
  const {werewolfRetrospectivePerspective}=await import("../werewolf/retrospective-perspective");
  for(const version of [13,14] as const){
    const events=werewolfDoctorSaveFixture(version),state=replayWerewolf(events);
    for(const actor of state.players){
      const perspective=werewolfRetrospectivePerspective(events,state,actor.id);
      if(version===13)expect(perspective.knownDuringPlay).not.toHaveProperty("eliminatedAlignments");
      else {
        const expected=perspective.revealedAfterGame.eliminations.filter(death=>perspective.eliminatedAtEventSequence===null||death.eventSequence<perspective.eliminatedAtEventSequence);
        expect(perspective.knownDuringPlay.eliminatedAlignments).toEqual(expected.map(death=>({eventSequence:death.eventSequence,day:death.day,player:{id:death.player.id,name:death.player.name},alignment:death.player.role==="werewolf"?"wolves":"village"})));
      }
    }
  }
});
