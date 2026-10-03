import { observeWerewolf } from "../werewolf/observation";
import { ProviderUnavailableError } from "../provider-execution";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { werewolfFallback, type WerewolfAgent } from "../werewolf/runner";

export type WerewolfResultScenario = "village" | "wolves" | "saved" | "disagreement" | "unavailable";
/** Provider-free, rules-driven fixtures shared by projection, HTTP and browser tests. */
export async function werewolfResultsFixture(scenario: WerewolfResultScenario, gameId = `results-${scenario}`, maxDays = 1) {
  const preset = scenario === "village" ? "one_wolf" : "two_wolves";
  const players = Array.from({length: preset === "one_wolf" ? 6 : 8}, (_,i) => ({id:`${gameId}-p${i}`,name:`Player ${i} ${i === 0 ? "With a Very Long Match Frozen Name" : ""}`.trim(),personality:"Fixture",backstory:"Frozen backstory",strategy:"SECRET_STRATEGY",avatarUrl:null}));
  const events = [startWerewolf(gameId,players,werewolfConfig(preset, scenario === "wolves" ? 10 : maxDays),"SECRET_SEED")];
  const roles = replayWerewolf(events).roles;
  const wolves = players.filter(p => roles[p.id] === "werewolf").map(p=>p.id);
  const doctor = players.find(p=>roles[p.id] === "doctor")?.id;
  const agent: WerewolfAgent = {async decide({request,observation}) {
    const legal = request.legalTargetIds;
    const village = legal.filter(id=>roles[id] !== "werewolf");
    if (request.action === "open_thread") return {kind:"opening",text:null,cue:null,recipientIds:[]};
    if (request.action === "attack") {
      const targetId = scenario === "disagreement" || scenario === "unavailable" ? village[wolves.indexOf(request.actorId)]!
        : scenario === "saved" ? legal.find(id=>id===doctor) ?? village[0]!
        : village.find(id=>roles[id] === (scenario === "wolves" ? "doctor" : "seer")) ?? village[0]!;
      return {kind:"target",targetId,thinking:"SECRET_THINKING"};
    }
    if (request.action === "protect") return {kind:"target",targetId:scenario === "saved" ? legal.find(id=>id===doctor) ?? legal.find(id=>roles[id] !== "werewolf")! : legal.find(id=>roles[id] === "werewolf") ?? legal[0]!,thinking:"SECRET_THINKING"};
    if (request.action === "vote") {
      if (scenario === "unavailable" && request.actorId === players[0]!.id) throw new ProviderUnavailableError("Fixture unavailable", "malformed_output");
      if (["saved","disagreement","unavailable"].includes(scenario)) {
        const alive = observation.board.players.filter(p=>p.alive).map(p=>p.id);
        return {kind:"target",targetId:request.voteMode === "majority" ? null : alive[(alive.indexOf(request.actorId)+1)%alive.length]!,thinking:"SECRET_THINKING"};
      }
      return {kind:"target",targetId:scenario === "village" || observation.board.day === 1 ? legal.find(id=>wolves.includes(id)) ?? village[0]! : village[0]!,thinking:"SECRET_THINKING"};
    }
    return legal.length ? {kind:"target",targetId:legal[0]!,thinking:"SECRET_THINKING"} : {kind:"speech",text:request.action === "pack_talk" ? "SECRET_PACK" : "Hello, village.",cue:null};
  }};
  let state = replayWerewolf(events);
  while (!state.outcome) {
    const step = nextWerewolfStep(state);
    if(step.kind === "complete") break;
    let data;
    if(step.kind === "event") data = step.event;
    else {
      let decision, fallback: "provider_unavailable" | null = null;
      try { decision = await agent.decide({gameId,actionSlot:state.sequence+1,request:step.request,observation:observeWerewolf(state,step.request.actorId)}); }
      catch(error) {
        if(!(error instanceof ProviderUnavailableError)) throw error;
        fallback = "provider_unavailable"; decision = werewolfFallback(state,step.request);
      }
      data = {type:"werewolf.action_accepted" as const,payload:{...step.request,decision,fallback}};
    }
    const event = werewolfEvent(state,data);
    state = applyWerewolfEvent(state,event);
    events.push(event);
  }
  return events;
}
