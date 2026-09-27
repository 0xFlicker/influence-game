import { seededRandom } from "../seeded-random";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import type {
  WerewolfAcceptedAction, WerewolfConfig, WerewolfDayResult, WerewolfDiscussionBeat, WerewolfEvent,
  WerewolfEventData, WerewolfNightResult, WerewolfOutcome, WerewolfPlayer,
  WerewolfPreset, WerewolfRequest, WerewolfRole, WerewolfState, WerewolfStep,
} from "./types";

export const WEREWOLF_PRESETS = {
  one_wolf: { label: "One wolf", players: 6, roles: ["werewolf", "seer", "villager", "villager", "villager", "villager"] },
  two_wolves: { label: "Two wolves", players: 8, roles: ["werewolf", "werewolf", "seer", "doctor", "villager", "villager", "villager", "villager"] },
} as const;

export const WEREWOLF_DISCUSSION_BEATS = 6;
export const WEREWOLF_DISCUSSION_MESSAGES = 4;

export class WerewolfRulesVersionError extends Error {
  constructor() { super("This game uses an unsupported Werewolf rules version. Start a new game to use shared discussion beats."); }
}

export const WEREWOLF_RULES = `Werewolf is a fictional social deduction game. Win with your faction, even if you die.
Wolves know their partners and collectively attack one living non-wolf each night. They have a private discussion first. When two attack choices disagree, a seeded draw chooses between their targets.
The Seer privately learns whether one other living player is a wolf. The Doctor protects any living player, including themself, but cannot protect the same player on consecutive nights.
All night choices use the same starting roster and resolve together. Protection prevents the attack, including when the Doctor is attacked. The Seer's result is recorded even if the Seer dies, but dead players cannot communicate it.
Everyone introduces themself before the first night. Each day has at most six shared discussion beats and each living player may send at most four messages. Choose one concise message or pass with null text on each beat. A pass uses a beat, not a message: two passes still leave room for four messages. You may pass more, but the day still has only six beats. Once your four messages are spent, you keep listening and voting.
All discussion decisions use the public history through the previous beat plus each player's own private knowledge. Messages reveal together; nobody can respond to another message from the same beat. An all-pass first beat gives everyone another opening beat. From beat two onward, an all-pass beat ends discussion. Discussion also ends at six beats or when everyone has spent their messages. Provider-unavailable absences are marked separately and count as passes for ending discussion. The observation shows the current beat and message budgets. Saving a message for a later response is legal strategy. False role claims and invented investigation stories are legal speech, never certified facts.
Living players then vote for one other living player. Ballots are revealed together. A unique highest count eliminates that player; a tied highest count eliminates nobody. There is no abstention or self-vote.
Death removes all speaking, voting and night actions. Roles remain secret until game end. There are no final words, whispers, jury, empowerment, role changes, or resurrection.
The village wins when no wolves remain. Wolves win when living wolves equal or outnumber living non-wolves. Check victory after the entire night or day resolution. The day limit is a draw if neither faction has won.`;

export function werewolfConfig(preset: WerewolfPreset, maxDays = 10): WerewolfConfig {
  if (!Object.hasOwn(WEREWOLF_PRESETS, preset)) throw new Error("Unknown Werewolf preset");
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 20) throw new Error("Werewolf maxDays must be an integer from 1 to 20");
  return { rulesVersion: 2, preset, maxDays };
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, i) => same(value, right[i]));
  const a = Object.entries(left);
  const b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key)
    && same(value, (right as Record<string, unknown>)[key]));
}

export function assignWerewolfRoles(players: readonly WerewolfPlayer[], config: WerewolfConfig, seed: string): Record<string, WerewolfRole> {
  if (config.rulesVersion !== 2) throw new WerewolfRulesVersionError();
  const validConfig = werewolfConfig(config.preset, config.maxDays);
  if (!same(config, validConfig)) throw new Error("Invalid Werewolf rules configuration");
  if (players.length !== WEREWOLF_PRESETS[config.preset].players) throw new Error("Werewolf roster does not match preset");
  if (!seed || new Set(players.map((p) => p.id)).size !== players.length) throw new Error("Werewolf requires a seed and distinct seat IDs");
  if (new Set(players.map((p) => p.name.trim().toLowerCase())).size !== players.length) throw new Error("Werewolf requires distinct player names");
  for (const p of players) {
    if (!p.id || !p.name.trim() || ![p.personality, p.backstory, p.strategy].every((v) => typeof v === "string")) throw new Error("Invalid Werewolf player");
  }
  const ids = players.map((p) => p.id).sort();
  const random = seededRandom(hashCanonicalJson({ seed, purpose: "roles" }));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return Object.fromEntries(ids.map((id, i) => [id, WEREWOLF_PRESETS[config.preset].roles[i]!])) as Record<string, WerewolfRole>;
}

export function startWerewolf(gameId: string, players: WerewolfPlayer[], config: WerewolfConfig, seed: string): WerewolfEvent {
  if (!gameId) throw new Error("Werewolf game ID is required");
  return { gameId, sequence: 1, type: "werewolf.started", payload: {
    config, seed, players: structuredClone(players), roles: assignWerewolfRoles(players, config, seed),
  } };
}

function requests(state: WerewolfState): WerewolfRequest[] {
  const alive = state.aliveIds;
  const wolves = alive.filter((id) => state.roles[id] === "werewolf");
  const speech = (ids: string[], action: "introduce" | "pack_talk" | "discuss") => ids.map((actorId) => ({ actorId, action, legalTargetIds: [] }));
  switch (state.phase) {
    case "introduction": return speech(alive, "introduce");
    case "pack": return wolves.length > 1 ? speech(wolves, "pack_talk") : [];
    case "night": return [
      ...wolves.map((actorId): WerewolfRequest => ({ actorId, action: "attack", legalTargetIds: alive.filter((id) => state.roles[id] !== "werewolf") })),
      ...alive.filter((id) => state.roles[id] === "doctor").map((actorId): WerewolfRequest => ({ actorId, action: "protect", legalTargetIds: alive.filter((id) => id !== state.previousProtection) })),
      ...alive.filter((id) => state.roles[id] === "seer").map((actorId): WerewolfRequest => ({ actorId, action: "investigate", legalTargetIds: alive.filter((id) => id !== actorId) })),
    ];
    case "day": {
      if (!state.discussion || state.discussion.ended) return [];
      const offset = (state.day - 1) % alive.length;
      const order = [...alive.slice(offset), ...alive.slice(0, offset)];
      return speech(order.filter((id) => state.discussion!.messagesRemaining[id]! > 0), "discuss");
    }
    case "vote": return alive.map((actorId) => ({ actorId, action: "vote", legalTargetIds: alive.filter((id) => id !== actorId) }));
    case "complete": return [];
  }
}

/** Reserve stable action coordinates for the whole beat before concurrent dispatch. */
export function werewolfActionPlans(state: WerewolfState): Array<{ sequence: number; request: WerewolfRequest }> {
  if (state.outcome) return [];
  const pending = requests(state).slice(state.actions.length);
  return (state.phase === "day" ? pending : pending.slice(0, 1))
    .map((request, index) => ({ sequence: state.sequence + index + 1, request }));
}

function discussionResult(state: WerewolfState): WerewolfDiscussionBeat {
  const discussion = state.discussion;
  if (!discussion) throw new Error("Missing Werewolf discussion");
  const beat = discussion.beatsCompleted + 1;
  const messagesRemaining = { ...discussion.messagesRemaining };
  const contributions = state.actions.map((action) => {
    if (action.action !== "discuss" || action.decision.kind !== "speech") throw new Error("Invalid Werewolf discussion contribution");
    if (action.decision.text !== null) messagesRemaining[action.actorId] = messagesRemaining[action.actorId]! - 1;
    return { actorId: action.actorId, text: action.decision.text, unavailable: action.fallback !== null };
  });
  const endReason = beat >= WEREWOLF_DISCUSSION_BEATS ? "beat_limit"
    : Object.values(messagesRemaining).every((remaining) => remaining === 0) ? "message_limit"
    : beat >= 2 && contributions.every((entry) => entry.text === null) ? "all_passed" : null;
  return { beat, contributions, messagesRemaining, endReason };
}

function targets(state: WerewolfState, action: WerewolfRequest["action"]): Array<{ actorId: string; targetId: string }> {
  return state.actions.flatMap((a) => a.action === action && a.decision.kind === "target"
    ? [{ actorId: a.actorId, targetId: a.decision.targetId }] : []);
}

function nightResult(state: WerewolfState): WerewolfNightResult {
  const attacks = targets(state, "attack");
  const choices = [...new Set(attacks.map((a) => a.targetId))].sort();
  const attackTargetId = choices[Math.floor(seededRandom(hashCanonicalJson({ seed: state.seed, purpose: "attack_tie", day: state.day }))() * choices.length)];
  if (!attackTargetId) throw new Error("A living pack must select a night target");
  const protectedId = targets(state, "protect")[0]?.targetId ?? null;
  const check = targets(state, "investigate")[0];
  return {
    attackTargetId, protectedId, killedId: attackTargetId === protectedId ? null : attackTargetId,
    investigation: check ? { seerId: check.actorId, targetId: check.targetId, isWolf: state.roles[check.targetId] === "werewolf" } : null,
  };
}

function dayResult(state: WerewolfState): WerewolfDayResult {
  const ballots = targets(state, "vote").map(({ actorId, targetId }) => ({ voterId: actorId, targetId }));
  const totals: Record<string, number> = Object.fromEntries(state.aliveIds.map((id) => [id, 0]));
  for (const ballot of ballots) totals[ballot.targetId] = (totals[ballot.targetId] ?? 0) + 1;
  const highest = Math.max(...Object.values(totals));
  const leaders = state.aliveIds.filter((id) => totals[id] === highest);
  return { ballots, totals, tiedIds: leaders.length > 1 ? leaders : [], eliminatedId: leaders.length === 1 ? leaders[0]! : null };
}

function outcome(state: WerewolfState): WerewolfOutcome | null {
  const wolves = state.aliveIds.filter((id) => state.roles[id] === "werewolf").length;
  const faction = wolves === 0 ? "village" : wolves * 2 >= state.aliveIds.length ? "wolves" : null;
  if (faction) return { faction, winnerIds: state.players.filter((p) => (state.roles[p.id] === "werewolf") === (faction === "wolves")).map((p) => p.id), reason: faction === "village" ? "wolves_eliminated" : "wolf_parity" };
  return state.phase === "vote" && state.resolved && state.day >= state.config.maxDays
    ? { faction: null, winnerIds: [], reason: "day_limit" } : null;
}

export function nextWerewolfStep(state: WerewolfState): WerewolfStep {
  if (state.outcome) return { kind: "complete" };
  if (state.resolved) {
    const result = outcome(state);
    if (result) return { kind: "event", event: { type: "werewolf.completed", payload: result } };
  }
  const request = requests(state)[state.actions.length];
  if (request) return { kind: "action", request };
  if (state.phase === "day" && state.discussion && !state.discussion.ended) return { kind: "event", event: { type: "werewolf.discussion_revealed", payload: discussionResult(state) } };
  if (!state.resolved && state.phase === "night") return { kind: "event", event: { type: "werewolf.night_resolved", payload: nightResult(state) } };
  if (!state.resolved && state.phase === "vote") return { kind: "event", event: { type: "werewolf.day_resolved", payload: dayResult(state) } };
  const phase = state.phase === "introduction" || state.phase === "vote" ? "pack"
    : state.phase === "pack" ? "night" : state.phase === "night" ? "day" : "vote";
  const day = phase === "pack" ? state.day + 1 : state.day;
  return { kind: "event", event: { type: "werewolf.phase_started", payload: { phase, day } } };
}

export function validateWerewolfAction(request: WerewolfRequest, action: WerewolfAcceptedAction): void {
  if (!same(request, { actorId: action.actorId, action: action.action, legalTargetIds: action.legalTargetIds })) throw new Error("Werewolf action does not match the current action slot");
  if (action.fallback !== null && action.fallback !== "provider_unavailable") throw new Error("Invalid Werewolf fallback");
  const d = action.decision;
  if (typeof d.thinking !== "string" || d.thinking.length > 2000) throw new Error("Invalid private Werewolf rationale");
  if (request.legalTargetIds.length) {
    if (d.kind !== "target" || !request.legalTargetIds.includes(d.targetId) || !same(Object.keys(d).sort(), ["kind", "targetId", "thinking"])) throw new Error("Illegal Werewolf target decision");
  } else if (d.kind !== "speech" || (d.text !== null && (typeof d.text !== "string" || !d.text.trim() || d.text.length > 1200))
    || !same(Object.keys(d).sort(), ["kind", "text", "thinking"])) throw new Error("Invalid Werewolf speech decision");
  if (!same(Object.keys(action).sort(), ["action", "actorId", "decision", "fallback", "legalTargetIds"])) throw new Error("Unexpected Werewolf action fields");
}

/** Validate every prefix on both the live writer and recovery reader. */
export function applyWerewolfEvent(previous: WerewolfState | null, event: WerewolfEvent): WerewolfState {
  if (!event.gameId || !Number.isInteger(event.sequence)) throw new Error("Invalid Werewolf event identity");
  if (!same(Object.keys(event).sort(), ["gameId", "payload", "sequence", "type"])) throw new Error("Unexpected Werewolf envelope fields");
  if (!previous) {
    if (event.sequence !== 1 || event.type !== "werewolf.started") throw new Error("Werewolf must start with one setup event");
    const { config, seed, players, roles } = event.payload;
    if (!same(event.payload, { config, seed, players, roles }) || !same(roles, assignWerewolfRoles(players, config, seed))) throw new Error("Corrupt Werewolf role assignment");
    return {
      gameId: event.gameId, sequence: 1, config: structuredClone(config), seed,
      players: structuredClone(players), roles: { ...roles }, aliveIds: players.map((p) => p.id),
      phase: "introduction", day: 0, actions: [], discussion: null, resolved: false, previousProtection: null,
      investigations: [], history: [{ kind: "phase", day: 0, phase: "introduction" }], outcome: null,
    };
  }
  if (event.gameId !== previous.gameId || event.sequence !== previous.sequence + 1) throw new Error("Discontinuous Werewolf event sequence");
  const expected = nextWerewolfStep(previous);
  if (expected.kind === "complete") throw new Error("Werewolf is already complete");
  if (expected.kind === "action") {
    if (event.type !== "werewolf.action_accepted") throw new Error("Missing Werewolf action");
    validateWerewolfAction(expected.request, event.payload);
  } else if (!same(expected.event, { type: event.type, payload: event.payload })) throw new Error("Werewolf rule event contradicts the accepted prefix");
  const state = structuredClone(previous);
  state.sequence = event.sequence;
  switch (event.type) {
    case "werewolf.started": throw new Error("Duplicate Werewolf setup");
    case "werewolf.action_accepted": {
      state.actions.push(structuredClone(event.payload));
      if (event.payload.action !== "discuss" && event.payload.decision.kind === "speech" && event.payload.decision.text !== null) state.history.push({
        kind: "speech", day: state.day, actorId: event.payload.actorId,
        audience: event.payload.action === "pack_talk" ? "pack" : "public", text: event.payload.decision.text,
      });
      break;
    }
    case "werewolf.phase_started": {
      state.phase = event.payload.phase;
      state.day = event.payload.day;
      state.actions = [];
      state.resolved = false;
      state.discussion = state.phase === "day" ? {
        beatsCompleted: 0, messagesRemaining: Object.fromEntries(state.aliveIds.map((id) => [id, WEREWOLF_DISCUSSION_MESSAGES])), ended: false,
      } : null;
      // The pack and role-action stages share one public night boundary.
      if (state.phase !== "night") state.history.push({ kind: "phase", day: state.day, phase: state.phase === "pack" ? "night" : state.phase });
      break;
    }
    case "werewolf.discussion_revealed": {
      state.discussion = { beatsCompleted: event.payload.beat, messagesRemaining: { ...event.payload.messagesRemaining }, ended: event.payload.endReason !== null };
      state.actions = [];
      state.history.push({ kind: "discussion", day: state.day, result: structuredClone(event.payload) });
      break;
    }
    case "werewolf.night_resolved": {
      state.resolved = true;
      state.previousProtection = event.payload.protectedId;
      if (event.payload.killedId) state.aliveIds = state.aliveIds.filter((id) => id !== event.payload.killedId);
      if (event.payload.investigation) state.investigations.push({ day: state.day, ...event.payload.investigation });
      state.history.push({ kind: "night", day: state.day, result: structuredClone(event.payload) });
      break;
    }
    case "werewolf.day_resolved": {
      state.resolved = true;
      if (event.payload.eliminatedId) state.aliveIds = state.aliveIds.filter((id) => id !== event.payload.eliminatedId);
      state.history.push({ kind: "vote", day: state.day, result: structuredClone(event.payload) });
      break;
    }
    case "werewolf.completed": {
      state.outcome = structuredClone(event.payload);
      state.phase = "complete";
      state.history.push({ kind: "result", day: state.day, outcome: structuredClone(event.payload) });
    }
  }
  return state;
}

export function replayWerewolf(events: readonly WerewolfEvent[]): WerewolfState {
  let state: WerewolfState | null = null;
  for (const event of events) state = applyWerewolfEvent(state, event);
  if (!state) throw new Error("Werewolf event history is empty");
  return state;
}

export function werewolfEvent(state: WerewolfState, data: WerewolfEventData): WerewolfEvent {
  const event = { ...data, gameId: state.gameId, sequence: state.sequence + 1 };
  applyWerewolfEvent(state, event);
  return event;
}
