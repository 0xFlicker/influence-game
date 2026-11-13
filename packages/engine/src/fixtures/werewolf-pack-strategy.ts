import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "./retrospective-agent";
import { applyWerewolfEvent, replayWerewolf, startWerewolf, werewolfConfig } from "../werewolf/rules";
import { runWerewolf, type WerewolfAgent } from "../werewolf/runner";

/** Accepted v13 eight-player evidence: agreement, two strategy speeches, two passes. */
export async function completedPackStrategyFixture(gameId = "pack-strategy", rulesVersion: 13 | 14 = 13) {
  const players = Array.from({length:8}, (_, index) => ({id:`${gameId}-p${index}`,name:`Alexandria Long Frozen Name ${index}`,personality:"Fixture",backstory:"",strategy:"",avatarUrl:null}));
  const events = [startWerewolf(gameId,players,{...werewolfConfig("two_wolves",1,{playerCount:8,wolves:2,seer:true,doctor:true}),rulesVersion},"pack-strategy")];
  const agent: WerewolfAgent = {
    prepareRetrospectiveCapacity:fixtureRetrospectiveCapacity, getRetrospectiveStatement:fixtureWerewolfRetrospective,
    async decide({request,observation}) {
      if (request.action === "pack_propose") return {kind:"spoken_target",targetId:request.legalTargetIds[0]!,
        text: request.packTurn?.turn === 3 ? null : request.packTurn?.lockedTargetId
          ? "Tomorrow I will pressure the player who avoided naming a suspect. Build your own case from the public ballots; do not echo mine. If our attack is blocked, we should reconsider who can gather a majority without revealing what we know. If my partner faces a very strong case, weigh redirection against credible distancing."
          : "Let us agree on this attack and use the time left to prepare our next public vote.",
        cue:null,thinking:request.packTurn?.turn === 3 ? "SECRET_PASS_THINKING" : "PRIVATE_PACK_THINKING: I want a believable case and a backup without making our public positions identical."};
      if ("solo" in request && request.solo) return {kind:"solo_target",targetId:request.action === "protect" ? request.actorId : request.legalTargetIds[0]!,text:"My private choice tonight.",cue:null};
      if (request.action === "speaking_priority") return {kind:"speaking_priority",priority:50};
      if (request.action === "conversation") return {kind:"conversation",text:observation.board.entries.some(e=>e.kind === "conversation") ? null : "Which public voting claim should we test?",cue:null,recipientId:null,replyToContributionId:null};
      if (request.action === "public_vote") return {kind:"spoken_target",targetId:null,text:null,cue:null,thinking:"No elimination today."};
      return {kind:"speech",text:"I will listen carefully to the village.",cue:null};
    },
  };
  await runWerewolf({read:async()=>structuredClone(events),append:async event=>{applyWerewolfEvent(replayWerewolf(events),event);events.push(event);}},agent);
  return events;
}
