import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "./retrospective-agent";
import { applyWerewolfEvent, replayWerewolf, startWerewolf, werewolfConfig } from "../werewolf/rules";
import { runWerewolf, type WerewolfAgent } from "../werewolf/runner";

/** Canonical eight-player v12 games for item, catalog and rendered parity regressions. */
export async function completedHunterFixture(mode: "held" | "snipe-only" | "double" = "double") {
  const gameId = `hunter-${mode}`;
  const players = Array.from({length:8}, (_,index) => ({id:`p${index}`,name:`Player ${index}`,personality:"Fixture",backstory:"",strategy:"",avatarUrl:null}));
  const events = [startWerewolf(gameId,players,{...werewolfConfig("two_wolves",1,{playerCount:8,wolves:2,seer:false,doctor:true,hunter:true}),rulesVersion:12},"hunter-parity")];
  const roles = replayWerewolf(events).roles;
  const victim = players.find(p=>roles[p.id] === "villager")!.id;
  const wolf = players.find(p=>roles[p.id] === "werewolf")!.id;
  const agent:WerewolfAgent = {prepareRetrospectiveCapacity:fixtureRetrospectiveCapacity,getRetrospectiveStatement:fixtureWerewolfRetrospective,async decide({request}) {
    if (request.action === "snipe") return {kind:"item_use",itemId:mode === "held" ? null : "snipe",targetId:mode === "held" ? null : wolf,text:mode === "held" ? "I will hold my shot until the village gives me clearer evidence. A single accusation is not enough to spend the only snipe I have." : "I will fire my single snipe tonight. The repeated contradictions make this my strongest wolf read, and waiting would give the pack another chance.",cue:null};
    if (request.action === "protect") return {kind:"solo_target",targetId:mode === "snipe-only" ? victim : request.actorId,text:"I choose this protection tonight.",cue:null};
    if (request.action === "pack_propose") return {kind:"spoken_target",targetId:victim,text:"We agree on this target.",cue:null,thinking:"Fixture pack decision."};
    if (request.action === "speaking_priority") return {kind:"speaking_priority",priority:50};
    if (request.action === "conversation") return {kind:"conversation",text:null,cue:null,recipientId:null,replyToContributionId:null};
    if (request.action === "public_vote") return {kind:"spoken_target",targetId:null,text:null,cue:null,thinking:"Fixture abstention."};
    return {kind:"speech",text:"I will listen carefully to the village.",cue:null};
  }};
  await runWerewolf({read:async()=>structuredClone(events),append:async event=>{applyWerewolfEvent(replayWerewolf(events),event);events.push(event);}},agent);
  return events;
}
