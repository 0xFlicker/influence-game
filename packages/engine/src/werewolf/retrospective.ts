import { canonicalJson } from "@influence/prompt-lab-protocol";
import { RetrospectiveContractError, type RetrospectiveInputV1 } from "../retrospective";
import { appendRetrospectiveSection, freezeRetrospectiveGame, type RetrospectiveCapacityPolicy } from "../retrospective-context";
import { werewolfRetrospectivePerspective } from "./retrospective-perspective";
import { werewolfRetrospectiveSpeakerIds } from "./retrospective-order";
import { applyWerewolfEvent, replayWerewolf } from "./rules";
import type { WerewolfEvent, WerewolfState } from "./types";

function werewolfFact(event: WerewolfEvent): unknown {
  switch (event.type) {
    case "werewolf.started": return { config: { rulesVersion: event.payload.config.rulesVersion, preset: event.payload.config.preset,
      maxDays: event.payload.config.maxDays, setup: event.payload.config.setup ?? null }, players: event.payload.players.map(player => ({ id: player.id, name: player.name, role: event.payload.roles[player.id] })) };
    case "werewolf.phase_started": return { phase: event.payload.phase, day: event.payload.day };
    case "werewolf.action_accepted": {
      const { actorId, action, decision, fallback } = event.payload;
      if (decision.kind === "speaking_priority") throw new RetrospectiveContractError("Private scheduling decisions do not belong in retrospective context");
      return { actorId, action, unavailable: fallback !== null, ...(decision.kind === "target" || decision.kind === "spoken_target" ? { targetId: decision.targetId, ...(decision.kind === "spoken_target" ? { passed: decision.text === null } : {}) }
        : { passed: decision.text === null, ...(decision.kind === "opening" ? { recipientIds: decision.recipientIds } : {}), ...(decision.kind === "conversation" ? { recipientId: decision.recipientId, replyToContributionId: decision.replyToContributionId } : {}) }) };
    }
    case "werewolf.pack_vote_resolved": return { attempt: event.payload.attempt,
      ballots: event.payload.ballots.map(({ voterId, targetId }) => ({ voterId, targetId })), targetId: event.payload.targetId, endReason: event.payload.endReason };
    case "werewolf.night_resolved": return { attackTargetId: event.payload.attackTargetId, protectedId: event.payload.protectedId,
      killedId: event.payload.killedId, result: event.payload.killedId ? "death" : event.payload.attackTargetId === null ? "no_attack"
        : event.payload.attackTargetId === event.payload.protectedId ? "doctor_save" : "no_death", investigation: event.payload.investigation ? {
        seerId: event.payload.investigation.seerId, targetId: event.payload.investigation.targetId, isWolf: event.payload.investigation.isWolf,
      } : null };
    case "werewolf.day_vote_resolved": {
      const highest = Math.max(0, ...Object.values(event.payload.totals));
      const tied = Object.entries(event.payload.totals).filter(([, count]) => count === highest).map(([id]) => id);
      return { thread: event.payload.thread, voteMode: event.payload.voteMode,
      ballots: event.payload.ballots.map(({ voterId, targetId, unavailable }) => ({ voterId, targetId, unavailable })), totals: event.payload.totals,
      requiredVotes: event.payload.requiredVotes, dayEnded: event.payload.dayEnded, eliminatedId: event.payload.eliminatedId,
      result: event.payload.eliminatedId ? "elimination" : event.payload.voteMode === "majority" ? "no_majority"
        : highest === 0 ? "no_votes_no_elimination" : "tie_no_elimination", tiedPlayerIds: tied.length > 1 ? tied : [] };
    }
    case "werewolf.completed": return { faction: event.payload.faction, winnerIds: event.payload.winnerIds, reason: event.payload.reason };
    case "werewolf.retrospective_started":
    case "werewolf.retrospective_statement_recorded":
    case "werewolf.retrospective_completed": throw new RetrospectiveContractError("Retrospective cannot be part of its own source account");
  }
  const unhandled: never = event;
  throw new RetrospectiveContractError(`Unsupported retrospective event: ${String(unhandled)}`);
}

export function compileWerewolfRetrospective(events: readonly WerewolfEvent[]) {
  const final = replayWerewolf(events), outcome = final.retrospectiveOutcomeSource;
  if (!outcome) throw new RetrospectiveContractError("Werewolf retrospective requires its canonical outcome");
  const prefix = events.slice(0, outcome.eventSequence), original = replayWerewolf(prefix);
  const speakerIds = werewolfRetrospectiveSpeakerIds(original);
  const input: RetrospectiveInputV1 = { version: 1, outcome, sections: [], dialogue: [] };
  let state: WerewolfState | null = null;
  for (const event of prefix) {
    state = applyWerewolfEvent(state, event);
    if (event.type === "werewolf.action_accepted" && event.payload.action === "speaking_priority") continue;
    appendRetrospectiveSection(input.sections, `day:${state.day}/${state.phase}`, event.sequence,
      `${event.type} ${canonicalJson(werewolfFact(event))}`);
    if (event.type === "werewolf.action_accepted" && event.payload.decision.kind !== "target" && event.payload.decision.kind !== "speaking_priority" && event.payload.decision.text !== null) {
      const packOnly = event.payload.action === "pack_talk" || event.payload.action === "pack_propose";
      input.dialogue.push({ eventSequence: event.sequence, source: { kind: "canonical_event", sequence: event.sequence },
        actorId: event.payload.actorId, scope: packOnly ? "pack" : "public",
        audiencePlayerIds: packOnly ? original.players.filter(player => original.roles[player.id] === "werewolf").map(player => player.id) : [],
        text: event.payload.decision.text });
    }
  }
  return { input, speakerIds, speakers: original.players.map(player => ({
    id: player.id, name: player.name, personality: player.personality, backstory: player.backstory, strategy: player.strategy,
    werewolfPerspective: werewolfRetrospectivePerspective(prefix, original, player.id),
  })), definition: final.retrospective?.definition ?? null };
}

export function freezeWerewolfRetrospective(options: { events: readonly WerewolfEvent[]; capacities: RetrospectiveCapacityPolicy }) {
  const source = compileWerewolfRetrospective(options.events);
  return freezeRetrospectiveGame(source.input, source.speakerIds, source.speakers, source.definition, options.capacities);
}
