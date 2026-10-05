import {expect,test} from "bun:test";
import {startWerewolf,werewolfConfig} from "../werewolf/rules";
import {runWerewolf, type WerewolfAgent} from "../werewolf/runner";
import {isWerewolfPlayable} from "../werewolf/watch-contract";
import {projectWerewolfWatch} from "../werewolf/watch";
import {projectWerewolfPresentation} from "../werewolf/presentation";
for (const preset of ["one_wolf","two_wolves"] as const) test(`${preset}: bounded watch windows preserve audience, causal snapshots and private staging`,async()=>{
  const players=Array.from({length:preset==="one_wolf"?6:8},(_,i)=>({id:`p${i}`,name:`Player ${i}`,personality:"careful",backstory:"frozen identity",strategy:"PRIVATE STRATEGY",avatarUrl:null}));
  const events=[startWerewolf("window",players,werewolfConfig(preset,2),"window")];
  const agent:WerewolfAgent={async decide({request}){return request.action==="open_thread"?{kind:"opening",text:null,cue:"Waits",recipientIds:[]}:request.legalTargetIds.length?{kind:"target",targetId:request.legalTargetIds[0]!,thinking:"PRIVATE THINKING"}:{kind:"speech",text:request.action==="pack_talk"?"PRIVATE PACK":"Hello",cue:null};}};
  await runWerewolf({read:async()=>structuredClone(events),append:async e=>{events.push(structuredClone(e));}},agent);
  for(const audience of ["mystery","omniscient"] as const){
    const final=projectWerewolfPresentation(events,audience);
    for(let from=1;from<=final.latestCursor;from+=8){
      const window=projectWerewolfWatch(events,audience,from,8);
      expect(window.latestCursor).toBe(final.latestCursor);expect(window.moments.length).toBeLessThanOrEqual(8);
      expect(JSON.stringify(window)).not.toContain("PRIVATE STRATEGY");expect(JSON.stringify(window)).not.toContain("PRIVATE THINKING");
      if(audience==="mystery")expect(JSON.stringify(window)).not.toContain("PRIVATE PACK");
      for(const moment of window.moments){const legacy=projectWerewolfPresentation(events,audience,moment.cursor);const {entries,...snapshot}=legacy.view;
        if (moment.entry.day === 0) { expect(moment.staging.roomId).toBeNull(); expect(moment.staging.participantIds).toEqual([]); }
        expect(moment.snapshot).toEqual(snapshot);expect(moment.entry).toEqual(entries.at(-1)!);expect(moment.staging.participantIds).toEqual(legacy.participantIds);
        if(moment.entry.kind==="discussion")expect(isWerewolfPlayable(moment.entry)).toBe(false);
      }
      for(const nav of window.navigation){const entry=final.view.entries[nav.cursor-1]!;expect(isWerewolfPlayable(entry)).toBe(true);}
    }
    expect(projectWerewolfWatch(events,audience,final.latestCursor+1).moments).toEqual([]);
  }
  expect(()=>projectWerewolfWatch(events,"mystery",1,65)).toThrow();
});

for (const scenario of ["saved", "disagreement", "wolves", "village"] as const) test(`${scenario}: resolved doctor and seer choices get private, causal replay beats`, async () => {
  const {werewolfResultsFixture} = await import("../fixtures/werewolf-results");
  const {replayWerewolf} = await import("../werewolf/rules");
  const events = await werewolfResultsFixture(scenario);
  const first = projectWerewolfWatch(events, "omniscient");
  const nights = events.filter(event => event.type === "werewolf.night_resolved");
  const moments = Array.from({length:first.latestCursor},(_,i)=>projectWerewolfWatch(events,"omniscient",i+1,1).moments[0]!).filter(moment=>moment.entry.kind === "night");
  expect(moments).toHaveLength(nights.length);
  for (const [index, moment] of moments.entries()) {
    const event = nights[index]!, before = replayWerewolf(events.filter(e=>e.sequence < event.sequence));
    const actions = moment.night?.actions ?? [];
    const protection = actions.find(action=>action.kind === "protect");
    if (event.payload.protectedId) {
      expect(protection?.targetId).toBe(event.payload.protectedId);
      expect(before.roles[protection!.actorId]).toBe("doctor");
      expect(moment.night!.before.players.find(player=>player.id===protection!.actorId)?.alive).toBe(true);
    } else expect(protection).toBeUndefined();
    const investigation = actions.find(action=>action.kind === "investigate");
    expect(investigation ? {seerId:investigation.actorId,targetId:investigation.targetId,isWolf:investigation.isWolf} : null).toEqual(event.payload.investigation);
    expect(first.playback.find(stop=>stop.cursor===moment.cursor)?.steps).toBe(actions.length+1);
    if (scenario === "disagreement") expect(actions.map(action=>action.kind)).toEqual(["protect","investigate"]);
    if (event.payload.killedId && moment.night) expect(moment.night.before.players.find(player=>player.id===event.payload.killedId)?.alive).toBe(true);
  }
  const mystery = projectWerewolfWatch(events,"mystery");
  for (let cursor=1;cursor<=mystery.latestCursor;cursor++) {
    const moment=projectWerewolfWatch(events,"mystery",cursor,1).moments[0]!;
    expect(moment.night).toBeUndefined();
    if(moment.entry.kind === "night") {
      expect(moment.entry).not.toHaveProperty("protectedId");
      expect(moment.entry).not.toHaveProperty("investigation");
      expect(mystery.playback.find(stop=>stop.cursor===cursor)?.steps).toBe(1);
    }
  }
});

test("disabled doctor and seer roles produce no fabricated role actions", async () => {
  const events=[startWerewolf("no-specialists",playersForNight(),werewolfConfig("one_wolf",1,{playerCount:6,wolves:1,seer:false,doctor:false}),"no-specialists")];
  const agent: WerewolfAgent={async decide({request}) { return request.action === "open_thread" ? {kind:"opening",text:null,cue:null,recipientIds:[]} : request.legalTargetIds.length ? {kind:"target",targetId:request.legalTargetIds[0]!,thinking:""} : {kind:"speech",text:null,cue:null}; }};
  await runWerewolf({read:async()=>events,append:async event=>{events.push(event);}},agent);
  const first=projectWerewolfWatch(events,"omniscient");
  const night=Array.from({length:first.latestCursor},(_,i)=>projectWerewolfWatch(events,"omniscient",i+1,1).moments[0]!).find(moment=>moment.entry.kind==="night")!;
  expect(night.night!.actions.map(action=>action.kind)).toEqual(["hunt"]);
});
function playersForNight() { return Array.from({length:6},(_,i)=>({id:`p${i}`,name:`Player ${i}`,personality:"",backstory:"",strategy:"",avatarUrl:null})); }
