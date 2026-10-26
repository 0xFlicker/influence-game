import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { seededRandom } from "../seeded-random";
import { applyRetrospectiveRecord, type RetrospectiveRecordV1 } from "../retrospective";
import { werewolfRetrospectiveSpeakerIds } from "./retrospective-order";
import * as legacy from "./legacy-rules";
import type { WerewolfAcceptedAction, WerewolfConfig, WerewolfEvent, WerewolfRequest, WerewolfState, WerewolfStep, WerewolfPlayer, WerewolfDayResult, WerewolfPackVote, WerewolfOutcome } from "./types";

export const DEFAULT_DISCUSSION_POLICY = { bytesPerLivingPlayer: 400, messageBytes: 320, maxHandoffs: 3 };
export const WEREWOLF_RULES_V9 = `Werewolf is a social deduction game. Win with your faction even if you die. Wolves know their partners; other roles are private until the competitive outcome. Lies and false role claims are legal speech, never verified facts.
Everyone may introduce themselves before the first night. Each night the Seer investigates exactly one other living player and learns wolf/not-wolf only when night resolves. Day N has at most N completed checks; no daytime speech or vote creates another investigation. The Doctor protects one living player, including themself, but cannot repeat the previous night's target. All night choices resolve together. Protection prevents the pack attack; a Seer killed that night still receives their check but cannot communicate it.
Two wolves alternate combined speech plus explicit target proposals for up to three full exchanges (six individual beats). Your proposal remains a standing offer until replaced or night ends. Matching current targets immediately lock the attack, including after the first back-and-forth; there is no extra ballot. Six beats without agreement mean no attack. A lone wolf selects one target. Only living non-wolves are legal pack targets.
Day discussion has a shared UTF-8 speech byte allowance, visible in the observation. This is a ceiling, not a target to spend. Silence costs no spoken bytes. If you have nothing new or consequential to add, pass with null text; an offered turn or direct question does not require speech. Do not recap the room, repeat a position, or announce you have nothing to add. Not everyone is guaranteed a discussion opportunity. When less than one full message allowance remains, discussion ends with the unused bytes; a complete silent sweep also ends discussion. Passing does not abstain from the later vote.
A structured recipient receives the next opportunity when handoffs remain. After three directed handoffs, if you speak, address someone other than the preceding speaker or the room; passing remains valid. References to earlier statements remain legal and do not schedule speakers. On the penultimate turn, if you speak, close your point instead of asking for a further direct answer from the final speaker. See the turn-specific instructions. Original accepted speech is published before anyone else acts; no future speech exists yet. Unspoken opportunities are private: your history contains spoken contributions only, and does not tell you who was offered a turn or chose to pass.
After discussion, everyone votes exactly once in a published seeded order. Submit the target you want eliminated, or null to abstain, together with optional speech. A vote is against its target, never an endorsement or a vote to save them. Each voter sees all earlier votes, speeches, totals and remaining voters. Votes cannot change. More than half of ALL living players must vote for the same target to eliminate them; abstentions never lower this threshold. Everyone gets their ballot before resolution even if a majority is already secured. Otherwise no one is eliminated. The day ends either way: no plurality, runoff, trial or extra discussion.
Death removes all gameplay speech, voting and night actions. No whispers, jury, empowerment, resurrection or death speeches. The village wins when no wolves remain; wolves win at parity or greater. Check victory after the complete night or day resolution. The day limit is a draw if neither faction has won. After the outcome all original contestants speak once in a separate retrospective which cannot change the result.`;
export const WEREWOLF_RULES_V11 = `${WEREWOLF_RULES_V9}
At the start of each day, before discussion, every living player privately submits an integer speaking priority from 1 to 100. These silent requests run independently in parallel. Higher priorities receive earlier normal speaking opportunities; tied priorities use a seeded daily order. Directed replies still work during discussion. Priorities are private scheduling data, not dialogue or evidence of anyone's role. The voting order remains independently seeded.`;
const same = (a: unknown, b: unknown) => hashCanonicalJson(a) === hashCanonicalJson(b);
const bytes = (text: string) => new TextEncoder().encode(text).length;
function shuffled(ids: string[], seed: string, purpose: string, day: number) {
  const order = [...ids].sort(), random = seededRandom(hashCanonicalJson({ seed, purpose, day }));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}
export function assignRoles(players: readonly WerewolfPlayer[], config: WerewolfConfig, seed: string) {
  const policy = config.discussionPolicy;
  if (!policy || !same(Object.keys(policy).sort(), ["bytesPerLivingPlayer", "maxHandoffs", "messageBytes"]) || !Object.values(policy).every(v => Number.isSafeInteger(v) && v > 0)
    || policy.messageBytes > 4096 || policy.bytesPerLivingPlayer > 10000 || policy.maxHandoffs !== 3) throw new Error("Invalid Werewolf discussion policy");
  const { discussionPolicy: _policy, ...base } = config;
  return legacy.assignWerewolfRoles(players, { ...base, rulesVersion: 8 }, seed);
}
export function packOrder(state: WerewolfState) { return shuffled(state.aliveIds.filter(id => state.roles[id] === "werewolf"), state.seed, "pack_initiative", state.day); }
function packChoices(state: WerewolfState) {
  return packOrder(state).flatMap(id => {
    const action = state.actions.findLast(a => a.actorId === id && a.action === "pack_propose");
    return (action?.decision.kind === "spoken_target" || action?.decision.kind === "solo_target") && action.decision.targetId !== null && action.fallback === null
      ? [{ voterId: id, targetId: action.decision.targetId }] : [];
  });
}
function packResult(state: WerewolfState): WerewolfPackVote | null {
  const order = packOrder(state), ballots = packChoices(state);
  // A lone-wolf mandatory fallback is an explicit legal target, not fabricated consensus.
  if (order.length === 1 && state.actions.length) {
    const d = state.actions[0]!.decision;
    if ((d.kind !== "spoken_target" && d.kind !== "solo_target") || d.targetId === null) throw new Error("Missing lone-wolf target");
    return { attempt: 1, ballots: [{ voterId: order[0]!, targetId: d.targetId }], targetId: d.targetId, endReason: "agreed" };
  }
  const agreed = ballots.length === order.length && ballots.length > 0 && ballots.every(b => b.targetId === ballots[0]!.targetId);
  if (!agreed && state.actions.length < 6) return null;
  return { attempt: Math.ceil(state.actions.length / 2), ballots, targetId: agreed ? ballots[0]!.targetId : null, endReason: agreed ? "agreed" : "attempt_limit" };
}
function dayResult(state: WerewolfState): WerewolfDayResult {
  const ballots = state.actions.map(a => {
    if (a.action !== "public_vote" || a.decision.kind !== "spoken_target") throw new Error("Invalid public ballot");
    return { voterId: a.actorId, targetId: a.decision.targetId, unavailable: a.fallback !== null };
  });
  const totals = Object.fromEntries(state.aliveIds.map(id => [id, 0]));
  for (const ballot of ballots) if (ballot.targetId !== null) totals[ballot.targetId]!++;
  const requiredVotes = Math.floor(state.aliveIds.length / 2) + 1;
  return { thread: 1, voteMode: "majority", ballots, totals, requiredVotes, dayEnded: true,
    eliminatedId: state.aliveIds.find(id => totals[id]! >= requiredVotes) ?? null };
}
function outcome(state: WerewolfState): WerewolfOutcome | null {
  const wolves = state.aliveIds.filter(id => state.roles[id] === "werewolf").length;
  const faction = wolves === 0 ? "village" : wolves * 2 >= state.aliveIds.length ? "wolves" : null;
  if (faction) return { faction, reason: wolves === 0 ? "wolves_eliminated" : "wolf_parity", winnerIds: state.players.filter(p => (state.roles[p.id] === "werewolf") === (faction === "wolves")).map(p => p.id) };
  return state.phase === "vote" && state.day >= state.config.maxDays ? { faction: null, winnerIds: [], reason: "day_limit" } : null;
}
export function nextStep(state: WerewolfState): WerewolfStep {
  if (state.outcome) return { kind: "complete" };
  if (state.resolved) { const result = outcome(state); if (result) return { kind: "event", event: { type: "werewolf.completed", payload: result } }; }
  let request: WerewolfRequest | undefined;
  const n = state.actions.length;
  if (state.phase === "introduction" && n < state.aliveIds.length) request = { actorId: state.aliveIds[n]!, action: "introduce", legalTargetIds: [] };
  if (state.phase === "pack" && !state.pack?.ended) {
    const result = packResult(state);
    if (result) return { kind: "event", event: { type: "werewolf.pack_vote_resolved", payload: result } };
    const order = packOrder(state);
    request = { actorId: order[n % order.length]!, action: "pack_propose", legalTargetIds: state.aliveIds.filter(id => state.roles[id] !== "werewolf"), messageBytes: state.config.discussionPolicy!.messageBytes, targetRequired: order.length === 1, ...(state.config.rulesVersion >= 10 && order.length === 1 ? {solo: true as const} : {}) };
  }
  if (state.phase === "night" && !state.resolved) {
    const solo = state.config.rulesVersion >= 10 ? {solo: true as const, messageBytes: state.config.discussionPolicy!.messageBytes} : {};
    const requests = state.aliveIds.flatMap<WerewolfRequest>(id => state.roles[id] === "doctor" ? [{ actorId: id, action: "protect" as const, ...solo, legalTargetIds: state.aliveIds.filter(x => x !== state.previousProtection) }]
      : state.roles[id] === "seer" ? [{ actorId: id, action: "investigate" as const, ...solo, legalTargetIds: state.aliveIds.filter(x => x !== id) }] : []);
    request = requests[n];
    if (!request) {
      const protection = state.actions.find(a => a.action === "protect")?.decision;
      const investigation = state.actions.find(a => a.action === "investigate");
      const protectedId = (protection?.kind === "target" || protection?.kind === "solo_target") ? protection.targetId : null;
      const attackTargetId = state.pack!.targetId;
      return { kind: "event", event: { type: "werewolf.night_resolved", payload: { attackTargetId, protectedId, killedId: attackTargetId === protectedId ? null : attackTargetId,
        investigation: (investigation?.decision.kind === "target" || investigation?.decision.kind === "solo_target") && investigation.decision.targetId !== null ? { seerId: investigation.actorId, targetId: investigation.decision.targetId, isWolf: state.roles[investigation.decision.targetId] === "werewolf" } : null } } };
    }
  }
  if (state.phase === "day") {
    const c = state.conversation!;
    if (state.config.rulesVersion >= 11 && n < state.aliveIds.length) return { kind: "action", request: {
      actorId: c.order[n]!, action: "speaking_priority", legalTargetIds: [],
    } };
    if (!c.ended) request = { actorId: c.nextActorId, action: "conversation", legalTargetIds: [], messageBytes: c.messageBytes,
      legalRecipientIds: state.aliveIds.filter(id => id !== c.nextActorId && !(c.handoffsUsed === c.maxHandoffs && id === c.previousSpeakerId)),
      legalReplyIds: state.history.flatMap(e => e.kind === "conversation" && e.text !== null ? [e.id] : []) };
  }
  if (state.phase === "vote" && !state.resolved) {
    const actorId = state.conversation!.voterIds[n];
    if (actorId) request = { actorId, action: "public_vote", legalTargetIds: state.aliveIds.filter(id => id !== actorId), messageBytes: state.config.discussionPolicy!.messageBytes };
    else return { kind: "event", event: { type: "werewolf.day_vote_resolved", payload: dayResult(state) } };
  }
  if (request) return { kind: "action", request };
  const phase = state.phase === "introduction" || state.phase === "vote" ? "pack" : state.phase === "pack" ? "night" : state.phase === "night" ? "day" : "vote";
  return { kind: "event", event: { type: "werewolf.phase_started", payload: { phase, day: phase === "pack" ? state.day + 1 : state.day } } };
}
export function validateAction(request: WerewolfRequest, action: WerewolfAcceptedAction) {
  const { decision: d, fallback, ...actual } = action;
  if (!same(actual, request) || fallback !== null && fallback !== "provider_unavailable") throw new Error("Action does not match its frozen slot");
  if (request.action === "speaking_priority") {
    if (d.kind !== "speaking_priority" || !same(Object.keys(d).sort(), ["kind", "priority"])
      || !Number.isInteger(d.priority) || d.priority < 1 || d.priority > 100
      || fallback !== null && d.priority !== 1) throw new Error("Speaking priority must be an integer from 1 to 100; unavailable actors use 1");
    return;
  }
  if (!("messageBytes" in request)) throw new Error("Missing speech byte limit");
  if (d.kind !== "conversation" && d.kind !== "spoken_target" && d.kind !== "solo_target") throw new Error("Invalid v9 decision kind");
  if (d.text !== null && (typeof d.text !== "string" || !d.text.trim() || bytes(d.text) > request.messageBytes)) throw new Error("Speech exceeds its UTF-8 byte allowance or is blank");
  if (d.cue !== null && (typeof d.cue !== "string" || !d.cue.trim() || d.cue.length > 240)) throw new Error("Invalid production cue");
  if (fallback !== null && (d.text !== null || d.cue !== null)) throw new Error("Unavailable actors cannot speak");
  if ("solo" in request && request.solo) {
    if (d.kind !== "solo_target" || !same(Object.keys(d).sort(), ["cue", "kind", "targetId", "text"])) throw new Error("Invalid solo target decision shape");
    if (d.targetId === null || !request.legalTargetIds.includes(d.targetId)) throw new Error("Solo decision requires a legal target");
    if (fallback === null && d.text === null) throw new Error("Solo decision requires a spoken explanation");
  } else if (request.action === "conversation") {
    if (d.kind !== "conversation" || !same(Object.keys(d).sort(), ["cue", "kind", "recipientId", "replyToContributionId", "text"]) || d.recipientId !== null && !request.legalRecipientIds.includes(d.recipientId)
      || d.replyToContributionId !== null && !request.legalReplyIds.includes(d.replyToContributionId) || d.text === null && (d.recipientId !== null || d.replyToContributionId !== null)) throw new Error("Invalid conversation recipient/reference");
  } else {
    if (d.kind !== "spoken_target" || !same(Object.keys(d).sort(), ["cue", "kind", "targetId", "text", "thinking"]) || typeof d.thinking !== "string" || fallback === null && !d.thinking.trim() || d.thinking.length > 2000) throw new Error("Invalid spoken target decision shape or thinking");
    if (request.action === "pack_propose" && request.targetRequired && (d.targetId === null || !request.legalTargetIds.includes(d.targetId))) throw new Error("Lone wolf proposal requires a legal target");
    if (d.targetId === null ? request.action !== "public_vote" && fallback === null : !request.legalTargetIds.includes(d.targetId)) throw new Error("Spoken target is not legal for this action");
    if (request.action === "public_vote" && fallback !== null && d.targetId !== null) throw new Error("Unavailable vote must abstain");
    if (request.action === "pack_propose" && fallback !== null && !request.targetRequired && d.targetId !== null) throw new Error("Unavailable pack proposal must clear its target");
  }
}
export function applyEvent(previous: WerewolfState | null, event: WerewolfEvent): WerewolfState {
  if (!event.gameId || !Number.isInteger(event.sequence) || !same(Object.keys(event).sort(), ["gameId", "payload", "sequence", "type"])) throw new Error("Invalid Werewolf event envelope");
  if (!previous) {
    if (event.sequence !== 1 || event.type !== "werewolf.started") throw new Error("Missing Werewolf start");
    const { config, seed, players, roles } = event.payload;
    if (!same(event.payload, { config, seed, players, roles }) || !same(roles, assignRoles(players, config, seed))) throw new Error("Corrupt Werewolf setup");
    const historicalStart = legacy.startWerewolf(event.gameId, players, legacy.werewolfConfig(config.preset, config.maxDays, config.setup), seed);
    return { ...legacy.applyWerewolfEvent(null, historicalStart), config: structuredClone(config), conversation: null };
  }
  if (event.gameId !== previous.gameId || event.sequence !== previous.sequence + 1) throw new Error("Discontinuous Werewolf event sequence");
  let record: RetrospectiveRecordV1 | null = null;
  if (event.type === "werewolf.retrospective_started") record = { kind: "started", payload: event.payload };
  if (event.type === "werewolf.retrospective_statement_recorded") record = { kind: "statement", payload: event.payload };
  if (event.type === "werewolf.retrospective_completed") record = { kind: "completed", payload: event.payload };
  if (record) {
    if (record.kind === "started" && !same(record.payload.speakerIds, werewolfRetrospectiveSpeakerIds(previous))) throw new Error("Invalid retrospective speaker order");
    const retrospective = applyRetrospectiveRecord(previous.retrospective, record, { outcome: previous.retrospectiveOutcomeSource, rosterIds: previous.players.map(p => p.id), eventSequence: event.sequence });
    const state = { ...structuredClone(previous), sequence: event.sequence, retrospective, phase: retrospective.completedAtEventSequence === null ? "retrospective" as const : "complete" as const };
    if (event.type === "werewolf.retrospective_statement_recorded") state.history.push({ kind: "speech", day: state.day, actorId: event.payload.actorId, audience: "public", text: event.payload.speech, cue: null, purpose: "retrospective", ordinal: event.payload.ordinal });
    return state;
  }
  const expected = nextStep(previous);
  if (expected.kind === "complete") throw new Error("Werewolf is already complete");
  if (expected.kind === "action") {
    if (event.type !== "werewolf.action_accepted") throw new Error("Missing Werewolf action");
    if ("solo" in expected.request && expected.request.solo || ["speaking_priority", "conversation", "public_vote", "pack_propose"].includes(expected.request.action)) validateAction(expected.request, event.payload);
    else legacy.validateWerewolfAction(expected.request, event.payload);
  } else if (!same(expected.event, { type: event.type, payload: event.payload })) throw new Error("Rule event contradicts accepted prefix");
  const state = structuredClone(previous); state.sequence = event.sequence;
  switch (event.type) {
    case "werewolf.started": throw new Error("Duplicate start");
    case "werewolf.action_accepted": {
      const action = event.payload, d = action.decision;
      if (action.action === "conversation" && d.kind === "conversation") {
        const c = state.conversation!;
        c.lastOffered[action.actorId] = ++c.offers;
        if (d.text !== null) { c.remainingBytes -= bytes(d.text); c.silentIds = []; c.unavailableIds = []; }
        else { if (!c.silentIds.includes(action.actorId)) c.silentIds.push(action.actorId); if (action.fallback !== null) c.unavailableIds.push(action.actorId); }
        const id = state.history.filter(e => e.kind === "conversation").length + 1;
        state.history.push({ day: state.day, id, actorId: action.actorId, ...d, unavailable: action.fallback !== null, remainingBytes: c.remainingBytes });
        c.endReason = c.remainingBytes < c.messageBytes ? "output_budget" : c.silentIds.length === state.aliveIds.length ? c.unavailableIds.length ? "unavailable_sweep" : "silence" : null;
        c.ended = c.endReason !== null;
        if (d.text !== null && d.recipientId !== null && c.handoffsUsed < c.maxHandoffs) { c.nextActorId = d.recipientId; c.handoffsUsed++; }
        else { c.nextActorId = [...c.order].sort((a,b) => (c.lastOffered[a] ?? -1) - (c.lastOffered[b] ?? -1))[0]!; c.handoffsUsed = 0; }
        c.previousSpeakerId = action.actorId;
        break;
      }
      state.actions.push(structuredClone(action));
      if (action.action === "speaking_priority" && state.actions.length === state.aliveIds.length) {
        const priorities = new Map(state.actions.map(a => {
          if (a.decision.kind !== "speaking_priority") throw new Error("Missing daily speaking priority");
          return [a.actorId, a.decision.priority] as const;
        }));
        // Stable sort retains the seeded daily order for tied priorities.
        const c = state.conversation!;
        c.order.sort((a, b) => priorities.get(b)! - priorities.get(a)!);
        c.nextActorId = c.order[0]!;
      }
      if (action.action === "public_vote" && d.kind === "spoken_target") {
        const result = dayResult(state);
        state.history.push({ kind: "ballot", day: state.day, actorId: action.actorId, targetId: d.targetId, text: d.text, cue: d.cue, unavailable: action.fallback !== null,
          totals: result.totals, requiredVotes: result.requiredVotes!, remainingVoterIds: state.conversation!.voterIds.slice(state.actions.length) });
      } else if (action.action === "pack_propose" && (d.kind === "spoken_target" || d.kind === "solo_target")) {
        state.history.push({ kind: "proposal", day: state.day, actorId: action.actorId, targetId: d.targetId, text: d.text, cue: d.cue, unavailable: action.fallback !== null, beat: state.actions.length });
      } else if (d.kind === "speech" && (d.text !== null || d.cue !== null)) state.history.push({ kind: "speech", day: state.day, actorId: action.actorId, text: d.text, cue: d.cue, audience: "public" });
      break;
    }
    case "werewolf.phase_started": {
      state.phase = event.payload.phase; state.day = event.payload.day; state.actions = []; state.resolved = false;
      if (state.phase === "pack") { state.pack = { attemptsCompleted: 0, targetId: null, ended: false }; state.conversation = null; }
      if (state.phase === "day") {
        state.pack = null;
        const policy = state.config.discussionPolicy!, order = shuffled(state.aliveIds, state.seed, "discussion", state.day);
        const totalBytes = policy.bytesPerLivingPlayer * state.aliveIds.length;
        state.conversation = { order, voterIds: shuffled(state.aliveIds, state.seed, "day_vote", state.day), totalBytes, remainingBytes: totalBytes, messageBytes: policy.messageBytes, maxHandoffs: policy.maxHandoffs,
          lastOffered: {}, offers: 0, nextActorId: order[0]!, handoffsUsed: 0, previousSpeakerId: null, silentIds: [], unavailableIds: [], ended: totalBytes < policy.messageBytes, endReason: totalBytes < policy.messageBytes ? "output_budget" : null };
      }
      if (state.phase !== "night") state.history.push({ kind: "phase", day: state.day, phase: state.phase === "pack" ? "night" : state.phase });
      break;
    }
    case "werewolf.pack_vote_resolved": state.pack = { attemptsCompleted: event.payload.attempt, targetId: event.payload.targetId, ended: true }; state.history.push({ kind: "pack_vote", day: state.day, result: event.payload }); break;
    case "werewolf.night_resolved":
      state.resolved = true; state.previousProtection = event.payload.protectedId;
      if (event.payload.killedId) state.aliveIds = state.aliveIds.filter(id => id !== event.payload.killedId);
      if (event.payload.investigation) state.investigations.push({ day: state.day, ...event.payload.investigation });
      state.history.push({ kind: "night", day: state.day, result: event.payload }); break;
    case "werewolf.day_vote_resolved":
      state.resolved = true;
      if (event.payload.eliminatedId) state.aliveIds = state.aliveIds.filter(id => id !== event.payload.eliminatedId);
      state.history.push({ kind: "vote", day: state.day, result: event.payload }); break;
    case "werewolf.completed":
      state.outcome = event.payload; state.phase = "retrospective";
      state.retrospectiveOutcomeSource = { gameId: event.gameId, gameKind: "werewolf", eventSequence: event.sequence, eventHash: hashCanonicalJson(event) };
      state.history.push({ kind: "result", day: state.day, outcome: event.payload });
  }
  return state;
}
