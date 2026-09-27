import { WEREWOLF_DISCUSSION_BEATS, WEREWOLF_DISCUSSION_MESSAGES } from "./rules";
import type { WerewolfDayResult, WerewolfDiscussionBeat, WerewolfFaction, WerewolfOutcome, WerewolfRole, WerewolfState } from "./types";

export type WerewolfAudience = "mystery" | "omniscient";
export type WerewolfPublicEntry =
  | { kind: "phase"; day: number; phase: "introduction" | "night" | "day" | "vote" }
  | { kind: "speech"; day: number; actorId: string; audience: "public" | "pack"; text: string }
  | { kind: "discussion"; day: number; result: WerewolfDiscussionBeat }
  | { kind: "night"; day: number; killedId: string | null; attackTargetId?: string; protectedId?: string | null; investigation?: { seerId: string; targetId: string; isWolf: boolean } | null }
  | { kind: "vote"; day: number; result: WerewolfDayResult }
  | { kind: "result"; day: number; outcome: WerewolfOutcome };

export interface WerewolfView {
  gameId: string;
  rulesVersion: 2;
  preset: "one_wolf" | "two_wolves";
  audience: WerewolfAudience;
  day: number;
  maxDays: number;
  phase: "introduction" | "night" | "day" | "vote" | "complete";
  discussion: { beat: number; maxBeats: number; maxMessages: number; messagesRemaining: Record<string, number>; ended: boolean } | null;
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
        ? [{ kind: "speech", day: entry.day, actorId: entry.actorId, audience: entry.audience, text: entry.text }] : [];
      case "discussion": return [{ kind: "discussion", day: entry.day, result: structuredClone(entry.result) }];
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
      beat: state.discussion.beatsCompleted + (state.discussion.ended ? 0 : 1), maxBeats: WEREWOLF_DISCUSSION_BEATS,
      maxMessages: WEREWOLF_DISCUSSION_MESSAGES, messagesRemaining: { ...state.discussion.messagesRemaining }, ended: state.discussion.ended,
    } : null,
    cursor: entries.length,
    players: state.players.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, personaKey: p.personaKey ?? null, alive: state.aliveIds.includes(p.id),
      ...(omniscient || state.outcome ? { role: state.roles[p.id]! } : {}),
    })), entries, outcome: state.outcome ? structuredClone(state.outcome) : null,
  };
}

export interface WerewolfObservation {
  board: WerewolfView;
  self: { id: string; role: WerewolfRole; faction: WerewolfFaction; personality: string; backstory: string; strategy: string };
  packIds: string[];
  packDiscussion: Array<{ day: number; actorId: string; text: string }>;
  packAttacks: Array<{ day: number; targetId: string }>;
  investigations: Array<{ day: number; targetId: string; isWolf: boolean }>;
  previousProtection: string | null;
}

/** Contestants never receive spectator mode selection or the raw event ledger. */
export function observeWerewolf(state: WerewolfState, actorId: string): WerewolfObservation {
  const player = state.players.find((p) => p.id === actorId);
  if (!player || !state.aliveIds.includes(actorId) || state.outcome) throw new Error("Only living contestants in an active match can act");
  const role = state.roles[actorId]!;
  return {
    board: projectWerewolfView(state, "mystery"),
    self: { id: actorId, role, faction: role === "werewolf" ? "wolves" : "village", personality: player.personality, backstory: player.backstory, strategy: player.strategy },
    packIds: role === "werewolf" ? state.players.filter((p) => state.roles[p.id] === "werewolf").map((p) => p.id) : [],
    packDiscussion: role === "werewolf" ? state.history.flatMap((entry) => entry.kind === "speech" && entry.audience === "pack"
      ? [{ day: entry.day, actorId: entry.actorId, text: entry.text }] : []) : [],
    packAttacks: role === "werewolf" ? state.history.flatMap((entry) => entry.kind === "night"
      ? [{ day: entry.day, targetId: entry.result.attackTargetId }] : []) : [],
    investigations: role === "seer" ? state.investigations.filter((i) => i.seerId === actorId).map(({ day, targetId, isWolf }) => ({ day, targetId, isWolf })) : [],
    previousProtection: role === "doctor" ? state.previousProtection : null,
  };
}
