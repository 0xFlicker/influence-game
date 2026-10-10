import { walkWerewolfHistory } from "./watch";
import type { WerewolfEvent, WerewolfState } from "./types";
import type { WerewolfResultSource, WerewolfResultRecap, WerewolfResultPlayer, WerewolfResults } from "./results-contract";

/** Spoiler-explicit completed facts. No accepted decisions, strategy, seed or thinking escape. */
export function buildWerewolfResults(events: readonly WerewolfEvent[]): WerewolfResults {
  let final: WerewolfState | null = null;
  let source: WerewolfResultSource | null = null;
  const recap: WerewolfResultRecap[] = [];
  const eliminations = new Map<string, NonNullable<WerewolfResultPlayer["elimination"]>>();
  let failedPackDay: number | null = null;
  for (const frame of walkWerewolfHistory(events, "omniscient")) {
    final = frame.state;
    const {event, state, cursor} = frame;
    const reference = { sequence: event.sequence, cursor };
    if (event.type === "werewolf.pack_vote_resolved" && event.payload.endReason === "attempt_limit") failedPackDay = state.day;
    if (event.type === "werewolf.night_resolved") {
      const result = structuredClone(event.payload);
      recap.push({id:`event-${event.sequence}`,day:state.day,source:reference,kind:"night",result,
        noAttackReason:result.attackTargetId === null && failedPackDay === state.day ? "no_agreement" : null});
      if (result.killedId) eliminations.set(result.killedId,{day:state.day,kind:"night",source:reference});
    }
    if (event.type === "werewolf.day_vote_resolved") {
      const result = structuredClone(event.payload);
      recap.push({id:`event-${event.sequence}`,day:state.day,source:reference,kind:"vote",result});
      if (result.eliminatedId) eliminations.set(result.eliminatedId,{day:state.day,kind:"vote",source:reference});
    }
    if (event.type === "werewolf.completed") source = reference;
  }
  if (!final?.outcome || !source) throw new Error("Werewolf history has no completed outcome");
  const outcome = structuredClone(final.outcome);
  return {rulesVersion:final.config.rulesVersion,day:final.day,maxDays:final.config.maxDays,outcome,source,
    players:final.players.map(player => {
      const role = final.roles[player.id]!;
      return {id:player.id,name:player.name,role,faction:role === "werewolf" ? "wolves" : "village",
        won:outcome.winnerIds.includes(player.id),alive:final.aliveIds.includes(player.id),elimination:eliminations.get(player.id) ?? null};
    }),recap};
}
