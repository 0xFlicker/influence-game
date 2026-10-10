import { seededRandom } from "../seeded-random";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import type {
  WerewolfAcceptedAction, WerewolfConfig, WerewolfDayResult, WerewolfDiscussion, WerewolfDiscussionTurn, WerewolfTurnReminder, WerewolfEvent,
  WerewolfEventData, WerewolfNightResult, WerewolfOutcome, WerewolfPackVote, WerewolfPlayer,
  WerewolfSetup, WerewolfPreset, WerewolfRequest, WerewolfRole, WerewolfState, WerewolfStep,
} from "./types";

export const WEREWOLF_PRESETS = {
  one_wolf: { label: "One wolf", players: 6, roles: ["werewolf", "seer", "villager", "villager", "villager", "villager"] },
  two_wolves: { label: "Two wolves", players: 8, roles: ["werewolf", "werewolf", "seer", "doctor", "villager", "villager", "villager", "villager"] },
} as const;

export const WEREWOLF_MAX_RECIPIENTS = 3;
export const WEREWOLF_PACK_ATTEMPTS = 3;

export class WerewolfRulesVersionError extends Error {
  constructor() { super("This game uses an unsupported Werewolf rules version. Start a new game to use ordered recipient threads (rules v7)."); }
}

export const WEREWOLF_RULES = `Werewolf is a fictional social deduction game. Win with your faction, even if you die.
Wolves know their partners and must unanimously choose one living non-wolf to attack. Each night allows at most three attempts. On each attempt, each living wolf gets one optional sequential proposal, then all living wolves submit sealed attack ballots together. A seeded opening speaker is chosen each night; the speaking order reverses after each disagreement. Proposals may pass with null text. The observation shows the attempt, speaking order, and previously revealed ballots. Current ballots remain hidden until all are committed. Agreement locks the attack; disagreement reveals every ballot only to the pack and starts another attempt. After three disagreements, the pack makes no attack that night. A lone living wolf skips proposals and selects a target with one ballot.
The Seer investigates exactly one other living player per night and privately learns whether that player is a wolf when the night resolves. There are no daytime investigations. Before night one resolves there are no results; during day one there can be at most one result (from night one), during day two at most two results, and during day N at most N results. Another daytime thread, reply, speech turn, or vote does not grant another investigation. A second result cannot arrive before night two resolves; do not demand it during day one. Asking about a future investigation plan is different from asking for an already completed result. A claimant may disclose fewer results than this maximum, and a dead Seer cannot obtain or communicate later results. The Doctor protects any living player, including themself, but cannot protect the same player on consecutive nights.
All night choices use the same starting roster and resolve together. Protection prevents the attack, including when the Doctor is attacked. The Seer's result is recorded even if the Seer dies, but dead players cannot communicate it.
Everyone introduces themself before the first night. A seeded opening order is rolled once for the whole game. It rotates round robin across days, skipping dead players; each living player gets at most one opening per day. An opener supplies a short statement or question and an ordered list of zero to three distinct other living recipients. Those recipients respond in that order, then the rest of the room responds in a seeded random order fixed for this thread. Each respondent gets one Speak or Pass. After each spoken response, the opener gets one Speak or Pass replying to that response and is told who may speak next. A respondent's Pass skips the opener's answer. Addressing someone does not change the queue. There are no repeated response rounds. After each thread, including a skipped opening, a fresh sealed ballot is held.
Each contribution is accepted and public before the next turn starts. Respond to the conversation as it exists now; there are no future replies, simultaneous batches or recursive branches. Make one conversational move, usually one sentence and roughly 10–30 words: ask a pointed question, answer, challenge, defend yourself, or state a changed position. Do not recap the room or repeat your point. Pass with null text when you have nothing useful to add. A speech or pass may include an optional short production cue describing observable acting or feeling, never extra dialogue, secret strategy or directions to another model. Cues do not change the schedule. An opening pass forfeits that thread. Provider-unavailable silence is marked separately. False role claims and invented investigation stories are legal speech, never certified facts.
After earlier threads, all living players submit sealed ballots: choose one other living player to eliminate now, or null to hear more (an abstention). More than half of ALL living players must choose the same target; abstentions count in the denominator. A strict majority ends the day immediately, skipping remaining threads and without another vote. Otherwise the next opening begins. After the final opening, everyone MUST choose another living player: null is not a legal model choice. This final ballot uses plurality: the unique highest vote count eliminates that player, even without a majority. A tie for highest means no village elimination. Then normal night actions follow. Reveal all ballots together. Each checkpoint is fresh; votes never carry forward. Self-votes are illegal. A provider-unavailable ballot is recorded as an unavailable abstention, even at the final vote; it is not a player choice.
Death removes all speaking, voting and night actions. Roles remain secret until game end. There are no final words, whispers, jury, empowerment, role changes, or resurrection.
The village wins when no wolves remain. Wolves win when living wolves equal or outnumber living non-wolves. Check victory after the entire night or day resolution. The day limit is a draw if neither faction has won.`;

export function werewolfConfig(preset: WerewolfPreset, maxDays = 10, setup?: WerewolfSetup): WerewolfConfig {
  if (!Object.hasOwn(WEREWOLF_PRESETS, preset)) throw new Error("Unknown Werewolf preset");
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 20) throw new Error("Werewolf maxDays must be an integer from 1 to 20");
  if (setup !== undefined && (!setup || typeof setup !== "object" || Array.isArray(setup)
    || Object.keys(setup).length !== 4 || ![6, 7, 8].includes(setup.playerCount) || ![1, 2].includes(setup.wolves)
    || typeof setup.seer !== "boolean" || typeof setup.doctor !== "boolean")) throw new Error("Choose 6–8 players, 1–2 wolves, and Seer/Doctor toggles");
  if (setup && (setup.wolves === 1 ? "one_wolf" : "two_wolves") !== preset) throw new Error("Werewolf preset must match the selected wolf count");
  return { rulesVersion: 7, preset, maxDays, ...(setup ? { setup: { ...setup } } : {}) };
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
  if (config.rulesVersion !== 7) throw new WerewolfRulesVersionError();
  const validConfig = werewolfConfig(config.preset, config.maxDays, config.setup);
  if (!same(config, validConfig)) throw new Error("Invalid Werewolf rules configuration");
  if (players.length !== (config.setup?.playerCount ?? WEREWOLF_PRESETS[config.preset].players)) throw new Error("Werewolf roster does not match preset");
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
  const roles: readonly WerewolfRole[] = config.setup ? [
    ...Array<WerewolfRole>(config.setup.wolves).fill("werewolf"),
    ...(config.setup.seer ? ["seer" as const] : []), ...(config.setup.doctor ? ["doctor" as const] : []),
    ...Array<WerewolfRole>(config.setup.playerCount - config.setup.wolves - Number(config.setup.seer) - Number(config.setup.doctor)).fill("villager"),
  ] : WEREWOLF_PRESETS[config.preset].roles;
  return Object.fromEntries(ids.map((id, i) => [id, roles[i]!])) as Record<string, WerewolfRole>;
}

export function startWerewolf(gameId: string, players: WerewolfPlayer[], config: WerewolfConfig, seed: string): WerewolfEvent {
  if (!gameId) throw new Error("Werewolf game ID is required");
  return { gameId, sequence: 1, type: "werewolf.started", payload: {
    config, seed, players: structuredClone(players), roles: assignWerewolfRoles(players, config, seed),
  } };
}

/** Seeded per night, with alternating initiative after each failed ballot. */
export function werewolfPackOrder(state: WerewolfState): string[] {
  const wolves = state.aliveIds.filter((id) => state.roles[id] === "werewolf").sort();
  const random = seededRandom(hashCanonicalJson({ seed: state.seed, purpose: "pack_initiative", day: state.day }));
  if (random() < 0.5) wolves.reverse();
  if ((state.pack?.attemptsCompleted ?? 0) % 2 === 1) wolves.reverse();
  return wolves;
}

function requests(state: WerewolfState): WerewolfRequest[] {
  const alive = state.aliveIds;
  const wolves = alive.filter((id) => state.roles[id] === "werewolf");
  const speech = (ids: string[], action: "introduce" | "pack_talk" | "discuss") => ids.map((actorId) => ({ actorId, action, legalTargetIds: [] }));
  switch (state.phase) {
    case "introduction": return speech(alive, "introduce");
    case "pack": {
      if (!state.pack || state.pack.ended) return [];
      const order = werewolfPackOrder(state);
      return [
        ...(wolves.length > 1 ? speech(order, "pack_talk") : []),
        ...order.map((actorId): WerewolfRequest => ({ actorId, action: "attack", legalTargetIds: alive.filter((id) => state.roles[id] !== "werewolf") })),
      ];
    }
    case "night": return [
      ...alive.filter((id) => state.roles[id] === "doctor").map((actorId): WerewolfRequest => ({ actorId, action: "protect", legalTargetIds: alive.filter((id) => id !== state.previousProtection) })),
      ...alive.filter((id) => state.roles[id] === "seer").map((actorId): WerewolfRequest => ({ actorId, action: "investigate", legalTargetIds: alive.filter((id) => id !== actorId) })),
    ];
    case "day": {
      const discussion = state.discussion;
      if (!discussion || discussion.ended || discussion.checkpointPending) return [];
      const opener = discussion.initiativeIds[discussion.threadIndex]!;
      const actor = discussion.stage === "reply" ? discussion.respondentIds[discussion.respondentIndex]! : opener;
      return discussion.stage === "opening"
        ? [{ actorId: actor, action: "open_thread", legalTargetIds: [], legalRecipientIds: alive.filter(id => id !== actor) }]
        : speech([actor], "discuss");
    }
    case "vote": return alive.map((actorId) => ({ actorId, action: "vote", voteMode: werewolfVoteMode(state), legalTargetIds: alive.filter((id) => id !== actorId) }));
    case "complete": return [];
  }
}

/** Sealed pack and day ballots reserve concurrent batches; public speech stays sequential. */
export function werewolfActionPlans(state: WerewolfState): Array<{ sequence: number; request: WerewolfRequest }> {
  if (state.outcome) return [];
  const pending = requests(state).slice(state.phase === "day" ? 0 : state.actions.length);
  return (pending[0]?.action === "attack" || pending[0]?.action === "vote" ? pending : pending.slice(0, 1))
    .map((request, index) => ({ sequence: state.sequence + index + 1, request }));
}

function shuffled(ids: readonly string[], seed: string, purpose: string, day = 0, thread = 0): string[] {
  const order = [...ids].sort();
  const random = seededRandom(hashCanonicalJson({ seed, purpose, day, thread }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Rotate the once-shuffled ring from the durable cursor, then omit dead seats. */
export function werewolfDayInitiative(state: WerewolfState): string[] {
  return [...state.openingOrderIds.slice(state.openingCursor), ...state.openingOrderIds.slice(0, state.openingCursor)]
    .filter(id => state.aliveIds.includes(id));
}

export function werewolfVoteMode(state: WerewolfState): "majority" | "plurality" {
  if (!state.discussion?.checkpointPending) throw new Error("Missing day vote checkpoint");
  return state.discussion.threadIndex === state.discussion.initiativeIds.length ? "plurality" : "majority";
}

function newThread(initiativeIds: string[], threadIndex: number): WerewolfDiscussion {
  return { initiativeIds, threadIndex, stage: "opening", recipientIds: [], respondentIds: [], respondentIndex: 0, turn: 0,
    openingText: null, latestStatement: null, checkpointPending: false, ended: threadIndex >= initiativeIds.length };
}

/** This reminder is a rules projection, never an inferred intent or reply target. */
export function werewolfTurnReminder(state: WerewolfState, actorId: string): WerewolfTurnReminder | null {
  const d = state.discussion;
  if (state.phase !== "day" || !d || d.ended || d.checkpointPending) return null;
  const index = d.initiativeIds.indexOf(actorId);
  if (index < 0) return null;
  const openerId = d.initiativeIds[d.threadIndex]!;
  const remaining = d.respondentIds.length - d.respondentIndex;
  const respondentIndex = d.respondentIds.indexOf(actorId);
  const canStillRespond = d.stage === "opening" || respondentIndex > d.respondentIndex
    || respondentIndex === d.respondentIndex && d.stage === "reply";
  return { thread: d.threadIndex + 1, totalThreads: d.initiativeIds.length, openerId,
    openingStatement: d.openingText, latestStatement: d.latestStatement ? { ...d.latestStatement } : null,
    stage: d.stage, recipientIds: [...d.recipientIds], respondentIds: [...d.respondentIds],
    nextSpeakerId: d.stage === "opening" ? null : d.respondentIds[d.respondentIndex + 1] ?? null,
    hasUsedOwnOpening: index < d.threadIndex || index === d.threadIndex && d.stage !== "opening",
    remainingOpportunitiesThisThread: actorId === openerId ? (d.stage === "opening" ? state.aliveIds.length : remaining)
      : canStillRespond ? 1 : 0 };
}

function closeThread(state: WerewolfState, discussion: WerewolfDiscussion): void {
  const openerId = discussion.initiativeIds[discussion.threadIndex]!;
  state.openingCursor = (state.openingOrderIds.indexOf(openerId) + 1) % state.openingOrderIds.length;
  state.discussion = { ...newThread(discussion.initiativeIds, discussion.threadIndex + 1), checkpointPending: true };
}

function advanceRespondent(state: WerewolfState, d: WerewolfDiscussion): void {
  d.respondentIndex++;
  if (d.respondentIndex === d.respondentIds.length) closeThread(state, d);
  else d.stage = "reply";
}

function acceptDiscussion(state: WerewolfState, action: WerewolfAcceptedAction): void {
  const d = state.discussion;
  if (!d || d.ended || action.decision.kind === "target") throw new Error("Missing discussion turn");
  const { text, cue } = action.decision;
  if (action.decision.kind === "opening" && text !== null) {
    d.recipientIds = [...action.decision.recipientIds];
    d.respondentIds = [...d.recipientIds, ...shuffled(state.aliveIds.filter(id => id !== action.actorId && !d.recipientIds.includes(id)),
      state.seed, "thread_floor", state.day, d.threadIndex)];
  }
  const contribution: WerewolfDiscussionTurn = { thread: d.threadIndex + 1, openerId: d.initiativeIds[d.threadIndex]!,
    stage: d.stage, recipientIds: [...d.recipientIds], turn: d.turn + 1,
    replyToTurn: d.stage === "answer" ? d.turn : null,
    nextSpeakerId: d.stage === "opening" ? d.respondentIds[0] ?? null : d.respondentIds[d.respondentIndex + 1] ?? null,
    publicHistoryPosition: state.history.filter(entry => entry.kind !== "pack_vote" && (entry.kind !== "speech" || entry.audience === "public")).length + 1,
    actorId: action.actorId, text, cue, unavailable: action.fallback !== null };
  state.history.push({ kind: "discussion", day: state.day, contribution });
  d.turn++;
  if (text !== null) d.latestStatement = { actorId: action.actorId, text };
  if (d.stage === "opening") {
    if (text === null) closeThread(state, d);
    else { d.openingText = text; d.stage = "reply"; }
  } else if (d.stage === "reply" && text !== null) d.stage = "answer";
  else advanceRespondent(state, d);
}

function targets(state: WerewolfState, action: WerewolfRequest["action"]): Array<{ actorId: string; targetId: string }> {
  return state.actions.flatMap((a) => a.action === action && a.decision.kind === "target" && a.decision.targetId !== null
    ? [{ actorId: a.actorId, targetId: a.decision.targetId }] : []);
}

function packVoteResult(state: WerewolfState): WerewolfPackVote {
  if (!state.pack || state.pack.ended) throw new Error("Missing active pack negotiation");
  const ballots = targets(state, "attack").map(({ actorId, targetId }) => ({ voterId: actorId, targetId }));
  if (!ballots.length || ballots.length !== werewolfPackOrder(state).length) throw new Error("Incomplete pack ballot");
  const targetId = ballots.every((ballot) => ballot.targetId === ballots[0]!.targetId) ? ballots[0]!.targetId : null;
  const attempt = state.pack.attemptsCompleted + 1;
  return { attempt, ballots, targetId, endReason: targetId !== null ? "agreed" : attempt === WEREWOLF_PACK_ATTEMPTS ? "attempt_limit" : null };
}

function nightResult(state: WerewolfState): WerewolfNightResult {
  if (!state.pack?.ended) throw new Error("Pack negotiation must finish before dawn");
  const attackTargetId = state.pack.targetId;
  const protectedId = targets(state, "protect")[0]?.targetId ?? null;
  const check = targets(state, "investigate")[0];
  return {
    attackTargetId, protectedId, killedId: attackTargetId === protectedId ? null : attackTargetId,
    investigation: check ? { seerId: check.actorId, targetId: check.targetId, isWolf: state.roles[check.targetId] === "werewolf" } : null,
  };
}

function dayResult(state: WerewolfState): WerewolfDayResult {
  if (!state.discussion?.checkpointPending) throw new Error("Missing day vote checkpoint");
  const ballots = state.actions.flatMap(a => a.action === "vote" && a.decision.kind === "target"
    ? [{ voterId: a.actorId, targetId: a.decision.targetId, unavailable: a.fallback !== null }] : []);
  if (ballots.length !== state.aliveIds.length) throw new Error("Incomplete day ballot");
  const totals: Record<string, number> = Object.fromEntries(state.aliveIds.map(id => [id, 0]));
  for (const ballot of ballots) if (ballot.targetId !== null) totals[ballot.targetId] = (totals[ballot.targetId] ?? 0) + 1;
  const voteMode = werewolfVoteMode(state);
  const requiredVotes = voteMode === "majority" ? Math.floor(state.aliveIds.length / 2) + 1 : null;
  const highest = Math.max(...Object.values(totals));
  const leaders = state.aliveIds.filter(id => totals[id] === highest);
  const eliminatedId = voteMode === "majority" ? state.aliveIds.find(id => totals[id]! >= requiredVotes!) ?? null
    : highest > 0 && leaders.length === 1 ? leaders[0]! : null;
  return { thread: state.discussion.threadIndex, voteMode, ballots, totals, requiredVotes, eliminatedId,
    dayEnded: eliminatedId !== null || state.discussion.ended };
}

function outcome(state: WerewolfState): WerewolfOutcome | null {
  const wolves = state.aliveIds.filter((id) => state.roles[id] === "werewolf").length;
  const faction = wolves === 0 ? "village" : wolves * 2 >= state.aliveIds.length ? "wolves" : null;
  if (faction) return { faction, winnerIds: state.players.filter((p) => (state.roles[p.id] === "werewolf") === (faction === "wolves")).map((p) => p.id), reason: faction === "village" ? "wolves_eliminated" : "wolf_parity" };
  return state.phase === "vote" && state.resolved && state.discussion?.ended && state.day >= state.config.maxDays
    ? { faction: null, winnerIds: [], reason: "day_limit" } : null;
}

export function nextWerewolfStep(state: WerewolfState): WerewolfStep {
  if (state.outcome) return { kind: "complete" };
  if (state.resolved) {
    const result = outcome(state);
    if (result) return { kind: "event", event: { type: "werewolf.completed", payload: result } };
  }
  const request = requests(state)[state.phase === "day" ? 0 : state.actions.length];
  if (request) return { kind: "action", request };
  if (state.phase === "pack" && state.pack && !state.pack.ended) return { kind: "event", event: { type: "werewolf.pack_vote_resolved", payload: packVoteResult(state) } };
  if (!state.resolved && state.phase === "night") return { kind: "event", event: { type: "werewolf.night_resolved", payload: nightResult(state) } };
  if (!state.resolved && state.phase === "vote") return { kind: "event", event: { type: "werewolf.day_vote_resolved", payload: dayResult(state) } };
  const phase = state.phase === "vote" && !state.discussion?.ended ? "day"
    : state.phase === "introduction" || state.phase === "vote" ? "pack"
    : state.phase === "pack" ? "night" : state.phase === "night" ? "day" : "vote";
  const day = phase === "pack" ? state.day + 1 : state.day;
  return { kind: "event", event: { type: "werewolf.phase_started", payload: { phase, day } } };
}

export function validateWerewolfAction(request: WerewolfRequest, action: WerewolfAcceptedAction): void {
  const { decision: d, fallback, ...acceptedRequest } = action;
  if (!same(request, acceptedRequest)) throw new Error("Werewolf action does not match the current action slot");
  if (fallback !== null && fallback !== "provider_unavailable") throw new Error("Invalid Werewolf fallback");
  if (request.legalTargetIds.length) {
    const nullAllowed = request.action === "vote" && (request.voteMode === "majority" || fallback === "provider_unavailable");
    if (d.kind !== "target" || typeof d.thinking !== "string" || d.thinking.length > 2000
      || !(d.targetId === null ? nullAllowed : request.legalTargetIds.includes(d.targetId))
      || !same(Object.keys(d).sort(), ["kind", "targetId", "thinking"])) throw new Error("Illegal Werewolf target decision");
    if (request.action === "vote" && fallback !== null && d.targetId !== null) throw new Error("Unavailable voters must abstain");
    return;
  }
  const opening = request.action === "open_thread";
  if (d.kind !== (opening ? "opening" : "speech")
    || (d.text !== null && (typeof d.text !== "string" || !d.text.trim() || d.text.length > 300))
    || !same(Object.keys(d).sort(), opening ? ["cue", "kind", "recipientIds", "text"] : ["cue", "kind", "text"])) throw new Error("Invalid Werewolf speech decision");
  if (d.cue !== null && (typeof d.cue !== "string" || !d.cue.trim() || d.cue.length > 240)) throw new Error("Invalid Werewolf performance cue");
  if (fallback !== null && (d.text !== null || d.cue !== null)) throw new Error("Unavailable players cannot perform");
  if (request.action === "open_thread" && d.kind === "opening") {
    if (!Array.isArray(d.recipientIds) || d.recipientIds.length > WEREWOLF_MAX_RECIPIENTS
      || new Set(d.recipientIds).size !== d.recipientIds.length || d.recipientIds.some(id => !request.legalRecipientIds.includes(id))
      || d.text === null && d.recipientIds.length !== 0) throw new Error("Illegal Werewolf recipients");
  }
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
      openingOrderIds: shuffled(players.map(p => p.id), seed, "opening_order"), openingCursor: 0,
      phase: "introduction", day: 0, actions: [], discussion: null, pack: null, resolved: false, previousProtection: null,
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
      if ((event.payload.action === "discuss" || event.payload.action === "open_thread")) { acceptDiscussion(state, event.payload); break; }
      state.actions.push(structuredClone(event.payload));
      if (event.payload.decision.kind === "speech" && (event.payload.decision.text !== null || event.payload.decision.cue !== null)) state.history.push({
        kind: "speech", day: state.day, actorId: event.payload.actorId,
        audience: event.payload.action === "pack_talk" ? "pack" : "public", text: event.payload.decision.text,
        cue: event.payload.decision.cue,
      });
      break;
    }
    case "werewolf.phase_started": {
      state.phase = event.payload.phase;
      state.day = event.payload.day;
      state.actions = [];
      state.resolved = false;
      if (state.phase === "pack") state.pack = { attemptsCompleted: 0, targetId: null, ended: false };
      else if (state.phase !== "night") state.pack = null;
      if (state.phase === "day") {
        if (previous.phase === "vote") {
          if (!state.discussion) throw new Error("Missing continuing discussion");
          state.discussion.checkpointPending = false;
        } else state.discussion = newThread(werewolfDayInitiative(state), 0);
      } else if (state.phase !== "vote") state.discussion = null;
      // The pack and role-action stages share one public night boundary.
      if (state.phase !== "night") state.history.push({ kind: "phase", day: state.day, phase: state.phase === "pack" ? "night" : state.phase });
      break;
    }
    case "werewolf.pack_vote_resolved": {
      state.pack = { attemptsCompleted: event.payload.attempt, targetId: event.payload.targetId, ended: event.payload.endReason !== null };
      state.actions = [];
      state.history.push({ kind: "pack_vote", day: state.day, result: structuredClone(event.payload) });
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
    case "werewolf.day_vote_resolved": {
      state.resolved = true;
      if (!state.discussion) throw new Error("Missing resolved discussion");
      state.discussion.ended = event.payload.dayEnded;
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
