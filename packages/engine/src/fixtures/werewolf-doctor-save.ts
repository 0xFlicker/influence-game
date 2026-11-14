/** Deterministic two-night fixture: one wolf dies, then the survivor's hunt is saved. */
import {applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent} from "../werewolf/rules";
import {werewolfFallback} from "../werewolf/runner";
import type {WerewolfDecision} from "../werewolf/types";
export function werewolfDoctorSaveFixture(version: 13 | 14 = 14) {
  const players = Array.from({length:8}, (_, i) => ({id:`p${i}`,name:`Player ${i}`,personality:"Fixture",backstory:"",strategy:"",avatarUrl:null}));
  const events = [startWerewolf("doctor-save-proof",players,{...werewolfConfig("two_wolves",2,{wolves:2,playerCount:8,doctor:true,seer:true,hunter:true}),rulesVersion:version},"doctor-save")];
  let state = replayWerewolf(events);
  const wolves = players.filter(p => state.roles[p.id] === "werewolf").map(p=>p.id);
  const villagers = players.filter(p => state.roles[p.id] === "villager").map(p=>p.id);
  while (!state.outcome) {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") throw new Error("Fixture ended before outcome");
    let data;
    if (step.kind === "event") data = step.event;
    else {
      const request = step.request;
      let decision: WerewolfDecision = werewolfFallback(state,request);
      if (request.action === "introduce") decision = {kind:"speech",text:"I will watch the votes.",cue:null};
      if (request.action === "pack_propose") decision = request.solo
        ? {kind:"solo_target",targetId:villagers[1]!,text:"One wolf remains. I will hunt the player who can rally the village tomorrow.",cue:null}
        : {kind:"spoken_target",targetId:villagers[0]!,text:null,cue:null,thinking:"Agree on the target."};
      if (request.action === "investigate") decision = {kind:"solo_target",targetId:request.legalTargetIds[0]!,text:"I will check this player.",cue:null};
      if (request.action === "snipe") decision = {kind:"item_use",itemId:state.day === 2 ? "snipe" : null,targetId:state.day === 2 ? villagers[2]! : null,text:"I will weigh the confirmed alignments before choosing.",cue:null};
      if (request.action === "protect") decision = {kind:"solo_target",targetId:state.day === 1 ? wolves[1]! : villagers[1]!,text:"I will protect this player tonight.",cue:null};
      if (request.action === "public_vote") decision = {kind:"spoken_target",targetId:state.day === 1 && request.actorId !== wolves[0] ? wolves[0]! : null,text:null,cue:null,thinking:"Use the public record."};
      data = {type:"werewolf.action_accepted" as const,payload:{...request,decision,fallback:null}};
    }
    const event = werewolfEvent(state,data);
    state = applyWerewolfEvent(state,event);events.push(event);
  }
  return events;
}
