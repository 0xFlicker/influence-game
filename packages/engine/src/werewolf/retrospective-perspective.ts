import { validateExactStructuredValue } from "../structured-output";
import { RetrospectiveContractError } from "../retrospective";
import type { WerewolfEvent, WerewolfRole, WerewolfState, WerewolfRequest, WerewolfOutcome } from "./types";

type NamedPlayer = { id: string; name: string };
type RevealedPlayer = NamedPlayer & { role: WerewolfRole };
export interface WerewolfRetrospectivePerspective {
  knownDuringPlay: {
    role: WerewolfRole;
    faction: "village" | "wolves";
    packMembers: NamedPlayer[];
    investigations: Array<{ eventSequence: number; day: number; target: NamedPlayer; isWolf: boolean }>;
  };
  ownRecordedActions: Array<{ eventSequence: number; day: number; action: WerewolfRequest["action"]; target: NamedPlayer | null; unavailable: boolean }>;
  eliminatedAtEventSequence: number | null;
  revealedAfterGame: {
    winningFaction: WerewolfOutcome["faction"];
    reason: WerewolfOutcome["reason"];
    winners: RevealedPlayer[];
    survivors: RevealedPlayer[];
    eliminations: Array<{ eventSequence: number; day: number; cause: "night" | "vote"; player: RevealedPlayer }>;
    dayVotes: Array<{ eventSequence: number; day: number; voteMode: "majority" | "plurality"; requiredVotes: number | null;
      totals: Array<{ player: RevealedPlayer; votes: number }>; abstentions: number; eliminated: RevealedPlayer | null }>;
  };
}

const named = { type: "object", additionalProperties: false, required: ["id", "name"], properties: {
  id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
} };
const roleSchema = { enum: ["villager", "seer", "doctor", "werewolf"] };
const revealedPlayer = { ...named, required: [...named.required, "role"], properties: { ...named.properties, role: roleSchema } };
const sequence = { type: "integer", minimum: 1 };
const day = { type: "integer", minimum: 0 };
const schema = { type: "object", additionalProperties: false, required: ["knownDuringPlay", "ownRecordedActions", "eliminatedAtEventSequence", "revealedAfterGame"], properties: {
  knownDuringPlay: { type: "object", additionalProperties: false, required: ["role", "faction", "packMembers", "investigations"], properties: {
    role: roleSchema, faction: { enum: ["village", "wolves"] },
    packMembers: { type: "array", items: named },
    investigations: { type: "array", items: { type: "object", additionalProperties: false, required: ["eventSequence", "day", "target", "isWolf"], properties: {
      eventSequence: sequence, day, target: named, isWolf: { type: "boolean" },
    } } },
  } },
  ownRecordedActions: { type: "array", items: { type: "object", additionalProperties: false, required: ["eventSequence", "day", "action", "target", "unavailable"], properties: {
    eventSequence: sequence, day, action: { enum: ["vote", "public_vote", "attack", "pack_propose", "investigate", "protect"] },
    target: { anyOf: [named, { type: "null" }] }, unavailable: { type: "boolean" },
  } } },
  eliminatedAtEventSequence: { anyOf: [sequence, { type: "null" }] },
  revealedAfterGame: { type: "object", additionalProperties: false, required: ["winningFaction", "reason", "winners", "survivors", "eliminations", "dayVotes"], properties: {
    winningFaction: { enum: ["village", "wolves", null] }, reason: { enum: ["wolves_eliminated", "wolf_parity", "day_limit"] },
    winners: { type: "array", items: revealedPlayer }, survivors: { type: "array", items: revealedPlayer },
    eliminations: { type: "array", items: { type: "object", additionalProperties: false, required: ["eventSequence", "day", "cause", "player"], properties: {
      eventSequence: sequence, day, cause: { enum: ["night", "vote"] }, player: revealedPlayer,
    } } },
    dayVotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["eventSequence", "day", "voteMode", "requiredVotes", "totals", "abstentions", "eliminated"], properties: {
      eventSequence: sequence, day, voteMode: { enum: ["majority", "plurality"] }, requiredVotes: { anyOf: [sequence, { type: "null" }] },
      totals: { type: "array", items: { type: "object", additionalProperties: false, required: ["player", "votes"], properties: { player: revealedPlayer, votes: { type: "integer", minimum: 1 } } } },
      abstentions: { type: "integer", minimum: 0 }, eliminated: { anyOf: [revealedPlayer, { type: "null" }] },
    } } },
  } },
} };

export function assertWerewolfRetrospectivePerspective(value: unknown): asserts value is WerewolfRetrospectivePerspective {
  const result = validateExactStructuredValue(schema, value, "Werewolf retrospective perspective");
  if (result.status === "invalid") throw new RetrospectiveContractError(result.message);
  const perspective = value as WerewolfRetrospectivePerspective;
  const known = perspective.knownDuringPlay;
  if (known.faction !== (known.role === "werewolf" ? "wolves" : "village")
    || known.role !== "werewolf" && known.packMembers.length > 0
    || known.role !== "seer" && known.investigations.length > 0
    || known.investigations.some(result => perspective.eliminatedAtEventSequence !== null && result.eventSequence >= perspective.eliminatedAtEventSequence)) {
    throw new RetrospectiveContractError("Werewolf retrospective knowledge does not match the speaker's role or lifetime");
  }
}

/** Derived only from canonical events; motives and dialogue never become knowledge.
 * Projection v1 is reserved for an exact historical frozen-definition match.
 */
export function werewolfRetrospectivePerspective(events: readonly WerewolfEvent[], state: WerewolfState, actorId: string, projectionVersion: 1 | 2 = 2): WerewolfRetrospectivePerspective {
  const player = (id: string): NamedPlayer => {
    const found = state.players.find(p => p.id === id);
    if (!found) throw new RetrospectiveContractError("Retrospective target is outside the roster");
    return { id, name: found.name };
  };
  if (!state.outcome) throw new RetrospectiveContractError("Retrospective summary requires a completed competitive outcome");
  const revealed = (id: string): RevealedPlayer => ({ ...player(id), role: state.roles[id]! });
  const role = state.roles[actorId]!;
  const perspective: WerewolfRetrospectivePerspective = {
    knownDuringPlay: { role, faction: role === "werewolf" ? "wolves" : "village",
      packMembers: role === "werewolf" ? state.players.filter(p => state.roles[p.id] === "werewolf").map(p => player(p.id)) : [], investigations: [] },
    ownRecordedActions: [], eliminatedAtEventSequence: null,
    revealedAfterGame: { winningFaction: state.outcome.faction, reason: state.outcome.reason,
      winners: state.outcome.winnerIds.map(revealed), survivors: state.aliveIds.map(revealed), eliminations: [], dayVotes: [] },
  };
  let day = 0;
  for (const event of events) {
    if (event.type === "werewolf.phase_started") day = event.payload.day;
    if (event.type === "werewolf.action_accepted" && event.payload.actorId === actorId) {
      const { decision, action, fallback } = event.payload;
      if (decision.kind === "target" || decision.kind === "spoken_target" || projectionVersion === 2 && decision.kind === "solo_target") perspective.ownRecordedActions.push({
        eventSequence: event.sequence, day, action, target: decision.targetId === null ? null : player(decision.targetId), unavailable: fallback !== null,
      });
    }
    if (event.type === "werewolf.night_resolved") {
      if (event.payload.killedId) perspective.revealedAfterGame.eliminations.push({ eventSequence: event.sequence, day, cause: "night", player: revealed(event.payload.killedId) });
      if (event.payload.killedId === actorId) perspective.eliminatedAtEventSequence = event.sequence;
      const result = event.payload.investigation;
      // A check resolving on the Seer's death night was never available for a later gameplay decision.
      if (result?.seerId === actorId && perspective.eliminatedAtEventSequence === null) perspective.knownDuringPlay.investigations.push({
        eventSequence: event.sequence, day, target: player(result.targetId), isWolf: result.isWolf,
      });
    }
    if (event.type === "werewolf.day_vote_resolved") {
      const result = event.payload;
      const eliminated = result.eliminatedId === null ? null : revealed(result.eliminatedId);
      perspective.revealedAfterGame.dayVotes.push({ eventSequence: event.sequence, day, voteMode: result.voteMode, requiredVotes: result.requiredVotes,
        totals: Object.entries(result.totals).filter(([, votes]) => votes > 0).map(([id, votes]) => ({ player: revealed(id), votes })),
        abstentions: result.ballots.filter(ballot => ballot.targetId === null).length, eliminated });
      if (eliminated) perspective.revealedAfterGame.eliminations.push({ eventSequence: event.sequence, day, cause: "vote", player: eliminated });
      if (result.eliminatedId === actorId) perspective.eliminatedAtEventSequence = event.sequence;
    }
  }
  assertWerewolfRetrospectivePerspective(perspective);
  return perspective;
}
