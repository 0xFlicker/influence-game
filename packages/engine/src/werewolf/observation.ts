import { werewolfTurnReminder, WEREWOLF_PACK_ATTEMPTS, werewolfPackOrder } from "./rules";
import type { WerewolfDayResult, WerewolfDiscussionTurn, WerewolfTurnReminder, WerewolfFaction, WerewolfOutcome, WerewolfPackVote, WerewolfRole, WerewolfState } from "./types";

export type WerewolfAudience = "mystery" | "omniscient";

/** Live spectator telemetry only. Never part of contestant observations or replay entries. */
export interface WerewolfVoteProgress {
  kind: "day_vote";
  day: number;
  thread: number;
  total: number;
  ready: number;
  voteMode: "majority" | "plurality";
  requiredVotes: number | null;
}
export type WerewolfPublicEntry =
  | { kind: "phase"; day: number; phase: "introduction" | "night" | "day" | "vote" }
  | { kind: "speech"; day: number; actorId: string; audience: "public" | "pack"; text: string | null; cue: string | null }
  | { kind: "discussion"; day: number; contribution: WerewolfDiscussionTurn }
  | { kind: "pack_vote"; day: number; result: WerewolfPackVote }
  | { kind: "night"; day: number; killedId: string | null; attackTargetId?: string | null; protectedId?: string | null; investigation?: { seerId: string; targetId: string; isWolf: boolean } | null }
  | { kind: "vote"; day: number; result: WerewolfDayResult }
  | { kind: "result"; day: number; outcome: WerewolfOutcome };

export interface WerewolfView {
  gameId: string;
  rulesVersion: 7;
  preset: "one_wolf" | "two_wolves";
  audience: WerewolfAudience;
  day: number;
  maxDays: number;
  phase: "introduction" | "night" | "day" | "vote" | "complete";
  discussion: { initiativeIds: string[]; thread: number; totalThreads: number; stage: "opening" | "reply" | "answer"; recipientIds: string[]; respondentIds: string[]; ended: boolean } | null;
  /** Audience-local cursor; private action counts/coordinates never leave the server. */
  cursor: number;
  players: Array<{ id: string; name: string; avatarUrl: string | null; personaKey: string | null; alive: boolean; role?: WerewolfRole }>;
  entries: WerewolfPublicEntry[];
  outcome: WerewolfOutcome | null;
}

/** Public allowlist, not a redacted copy of authoritative state. */
export function projectWerewolfView(state: WerewolfState, audience: WerewolfAudience): WerewolfView {
  if (audience !== "mystery" && audience !== "omniscient") throw new Error("Invalid Werewolf audience");
  const omniscient = audience === "omniscient";
  const entries: WerewolfPublicEntry[] = state.history.flatMap((entry): WerewolfPublicEntry[] => {
    switch (entry.kind) {
      case "phase": return [{ kind: "phase", day: entry.day, phase: entry.phase }];
      case "speech": return entry.audience === "public" || omniscient
        ? [{ kind: "speech", day: entry.day, actorId: entry.actorId, audience: entry.audience, text: entry.text, cue: entry.cue }] : [];
      case "discussion": return [{ kind: "discussion", day: entry.day, contribution: structuredClone(entry.contribution) }];
      case "pack_vote": return omniscient ? [{ kind: "pack_vote", day: entry.day, result: structuredClone(entry.result) }] : [];
      case "night": return [{ kind: "night", day: entry.day, killedId: entry.result.killedId,
        ...(omniscient ? {
          attackTargetId: entry.result.attackTargetId, protectedId: entry.result.protectedId,
          investigation: entry.result.investigation ? { ...entry.result.investigation } : null,
        } : {}),
      }];
      case "vote": return [{ kind: "vote", day: entry.day, result: structuredClone(entry.result) }];
      case "result": return [{ kind: "result", day: entry.day, outcome: structuredClone(entry.outcome) }];
    }
  });
  return {
    gameId: state.gameId, rulesVersion: state.config.rulesVersion, preset: state.config.preset, audience,
    day: state.day, maxDays: state.config.maxDays,
    phase: state.phase === "pack" ? "night" : state.phase,
    discussion: state.discussion ? {
      initiativeIds: [...state.discussion.initiativeIds], thread: state.phase === "vote" ? state.discussion.threadIndex : Math.min(state.discussion.threadIndex + 1, state.discussion.initiativeIds.length), totalThreads: state.discussion.initiativeIds.length,
      stage: state.discussion.stage, recipientIds: [...state.discussion.recipientIds], respondentIds: [...state.discussion.respondentIds], ended: state.discussion.ended,
    } : null,
    cursor: entries.length,
    players: state.players.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, personaKey: p.personaKey ?? null, alive: state.aliveIds.includes(p.id),
      ...(omniscient || state.outcome ? { role: state.roles[p.id]! } : {}),
    })), entries, outcome: state.outcome ? structuredClone(state.outcome) : null,
  };
}

export interface WerewolfObservation {
  board: WerewolfView;
  turnReminder: WerewolfTurnReminder | null;
  self: { id: string; role: WerewolfRole; faction: WerewolfFaction; personality: string; backstory: string; strategy: string };
  packIds: string[];
  packDiscussion: Array<{ day: number; actorId: string; text: string | null; cue: string | null }>;
  packAttacks: Array<{ day: number; targetId: string | null }>;
  packNegotiation: { attempt: number; maxAttempts: number; speakerIds: string[]; stage: "propose" | "vote" } | null;
  packVotes: Array<{ day: number; result: WerewolfPackVote }>;
  investigations: Array<{ day: number; targetId: string; isWolf: boolean }>;
  previousProtection: string | null;
}

/** Contestants never receive spectator mode selection or the raw event ledger. */
export function observeWerewolf(state: WerewolfState, actorId: string): WerewolfObservation {
  const player = state.players.find((p) => p.id === actorId);
  if (!player || !state.aliveIds.includes(actorId) || state.outcome) throw new Error("Only living contestants in an active match can act");
  const role = state.roles[actorId]!;
  const order = werewolfPackOrder(state);
  return {
    board: projectWerewolfView(state, "mystery"),
    turnReminder: werewolfTurnReminder(state, actorId),
    self: { id: actorId, role, faction: role === "werewolf" ? "wolves" : "village", personality: player.personality, backstory: player.backstory, strategy: player.strategy },
    packIds: role === "werewolf" ? state.players.filter((p) => state.roles[p.id] === "werewolf").map((p) => p.id) : [],
    packDiscussion: role === "werewolf" ? state.history.flatMap((entry) => entry.kind === "speech" && entry.audience === "pack"
      ? [{ day: entry.day, actorId: entry.actorId, text: entry.text, cue: entry.cue }] : []) : [],
    packNegotiation: role === "werewolf" && state.phase === "pack" && state.pack && !state.pack.ended ? {
      attempt: state.pack.attemptsCompleted + 1, maxAttempts: WEREWOLF_PACK_ATTEMPTS, speakerIds: order,
      stage: order.length > 1 && state.actions.length < order.length ? "propose" : "vote",
    } : null,
    packVotes: role === "werewolf" ? state.history.flatMap((entry) => entry.kind === "pack_vote"
      ? [{ day: entry.day, result: structuredClone(entry.result) }] : []) : [],
    packAttacks: role === "werewolf" ? state.history.flatMap((entry) => entry.kind === "night"
      ? [{ day: entry.day, targetId: entry.result.attackTargetId }] : []) : [],
    investigations: role === "seer" ? state.investigations.filter((i) => i.seerId === actorId).map(({ day, targetId, isWolf }) => ({ day, targetId, isWolf })) : [],
    previousProtection: role === "doctor" ? state.previousProtection : null,
  };
}
