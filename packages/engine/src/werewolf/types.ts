/** Werewolf owns its rules and event vocabulary; Influence phases do not apply. */
export type WerewolfRole = "werewolf" | "villager" | "seer" | "doctor";
export type WerewolfFaction = "village" | "wolves";
export type WerewolfPreset = "one_wolf" | "two_wolves";
export type WerewolfPhase = "introduction" | "pack" | "night" | "day" | "vote" | "complete";
export type WerewolfAction = "introduce" | "pack_talk" | "attack" | "investigate" | "protect" | "discuss" | "vote";

export interface WerewolfPlayer {
  agentProfileId?: string;
  contentRevisionId?: string | null;
  id: string;
  name: string;
  personality: string;
  backstory: string;
  strategy: string;
  avatarUrl: string | null;
  personaKey?: string | null;
}

export interface WerewolfConfig {
  rulesVersion: 5;
  responseRounds: number;
  preset: WerewolfPreset;
  maxDays: number;
}

export type WerewolfDecision =
  | { kind: "speech"; text: string | null; cue: string | null }
  | { kind: "target"; targetId: string; thinking: string };

export interface WerewolfRequest {
  actorId: string;
  action: WerewolfAction;
  legalTargetIds: string[];
}

export interface WerewolfAcceptedAction extends WerewolfRequest {
  decision: WerewolfDecision;
  fallback: "provider_unavailable" | null;
}

export interface WerewolfNightResult {
  attackTargetId: string | null;
  protectedId: string | null;
  killedId: string | null;
  investigation: { seerId: string; targetId: string; isWolf: boolean } | null;
}

export interface WerewolfDayResult {
  ballots: Array<{ voterId: string; targetId: string }>;
  totals: Record<string, number>;
  tiedIds: string[];
  eliminatedId: string | null;
}

export interface WerewolfPackVote {
  attempt: number;
  ballots: Array<{ voterId: string; targetId: string }>;
  targetId: string | null;
  endReason: "agreed" | "attempt_limit" | null;
}

export interface WerewolfPackNegotiation {
  attemptsCompleted: number;
  targetId: string | null;
  ended: boolean;
}

/** Engine-owned sequence; production cues never control the schedule. */
export interface WerewolfDiscussion {
  initiativeIds: string[];
  threadIndex: number;
  stage: "opening" | "reply" | "answer";
  responseRound: number;
  respondentIndex: number;
  turn: number;
  openingText: string | null;
  latestStatement: { actorId: string; text: string } | null;
  roundHadSpeech: boolean;
  ended: boolean;
}

export interface WerewolfDiscussionTurn {
  thread: number;
  openerId: string;
  stage: "opening" | "reply" | "answer";
  responseRound: number;
  turn: number;
  publicHistoryPosition: number;
  actorId: string;
  text: string | null;
  cue: string | null;
  unavailable: boolean;
}

export interface WerewolfTurnReminder {
  thread: number;
  totalThreads: number;
  openerId: string;
  openingStatement: string | null;
  latestStatement: { actorId: string; text: string } | null;
  stage: "opening" | "reply" | "answer";
  responseRound: number;
  maxResponseRounds: number;
  hasUsedOwnOpening: boolean;
  remainingOpportunitiesThisThread: number;
}

export interface WerewolfOutcome {
  faction: WerewolfFaction | null;
  winnerIds: string[];
  reason: "wolves_eliminated" | "wolf_parity" | "day_limit";
}

export type WerewolfEventData =
  | { type: "werewolf.started"; payload: { config: WerewolfConfig; seed: string; players: WerewolfPlayer[]; roles: Record<string, WerewolfRole> } }
  | { type: "werewolf.phase_started"; payload: { phase: Exclude<WerewolfPhase, "complete" | "introduction">; day: number } }
  | { type: "werewolf.action_accepted"; payload: WerewolfAcceptedAction }
  | { type: "werewolf.pack_vote_resolved"; payload: WerewolfPackVote }
  | { type: "werewolf.night_resolved"; payload: WerewolfNightResult }
  | { type: "werewolf.day_resolved"; payload: WerewolfDayResult }
  | { type: "werewolf.completed"; payload: WerewolfOutcome };

/** Raw events are private authority. Serve only audience projections. */
export type WerewolfEvent = WerewolfEventData & { gameId: string; sequence: number };

export interface WerewolfState {
  gameId: string;
  sequence: number;
  config: WerewolfConfig;
  seed: string;
  players: WerewolfPlayer[];
  roles: Record<string, WerewolfRole>;
  aliveIds: string[];
  phase: WerewolfPhase;
  day: number;
  actions: WerewolfAcceptedAction[];
  discussion: WerewolfDiscussion | null;
  pack: WerewolfPackNegotiation | null;
  resolved: boolean;
  previousProtection: string | null;
  investigations: Array<{ day: number; seerId: string; targetId: string; isWolf: boolean }>;
  history: WerewolfHistoryEntry[];
  outcome: WerewolfOutcome | null;
}

export type WerewolfHistoryEntry =
  | { kind: "phase"; day: number; phase: "introduction" | "night" | "day" | "vote" }
  | { kind: "speech"; day: number; actorId: string; audience: "public" | "pack"; text: string | null; cue: string | null }
  | { kind: "discussion"; day: number; contribution: WerewolfDiscussionTurn }
  | { kind: "pack_vote"; day: number; result: WerewolfPackVote }
  | { kind: "night"; day: number; result: WerewolfNightResult }
  | { kind: "vote"; day: number; result: WerewolfDayResult }
  | { kind: "result"; day: number; outcome: WerewolfOutcome };

export type WerewolfStep =
  | { kind: "action"; request: WerewolfRequest }
  | { kind: "event"; event: Exclude<WerewolfEventData, { type: "werewolf.started" | "werewolf.action_accepted" }> }
  | { kind: "complete" };
