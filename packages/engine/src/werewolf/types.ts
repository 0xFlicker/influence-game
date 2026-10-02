/** Werewolf owns its rules and event vocabulary; Influence phases do not apply. */
export type WerewolfRole = "werewolf" | "villager" | "seer" | "doctor";
export type WerewolfFaction = "village" | "wolves";
export type WerewolfPreset = "one_wolf" | "two_wolves";
export type WerewolfPhase = "introduction" | "pack" | "night" | "day" | "vote" | "complete";
export type WerewolfAction = "introduce" | "pack_talk" | "attack" | "investigate" | "protect" | "open_thread" | "discuss" | "vote";
export type WerewolfVoteMode = "majority" | "plurality";

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

export interface WerewolfSetup { playerCount: 6 | 7 | 8; wolves: 1 | 2; seer: boolean; doctor: boolean }

export interface WerewolfConfig {
  rulesVersion: 7;
  preset: WerewolfPreset;
  setup?: WerewolfSetup;
  maxDays: number;
}

export type WerewolfDecision =
  | { kind: "opening"; text: string | null; cue: string | null; recipientIds: string[] }
  | { kind: "speech"; text: string | null; cue: string | null }
  | { kind: "target"; targetId: string | null; thinking: string };

export type WerewolfRequest = {
  actorId: string;
  legalTargetIds: string[];
} & (
  | { action: "open_thread"; legalRecipientIds: string[] }
  | { action: "vote"; voteMode: WerewolfVoteMode }
  | { action: Exclude<WerewolfAction, "open_thread" | "vote"> }
);

export type WerewolfAcceptedAction = WerewolfRequest & {
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
  thread: number;
  voteMode: WerewolfVoteMode;
  ballots: Array<{ voterId: string; targetId: string | null; unavailable: boolean }>;
  totals: Record<string, number>;
  requiredVotes: number | null;
  dayEnded: boolean;
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
  recipientIds: string[];
  respondentIds: string[];
  respondentIndex: number;
  turn: number;
  openingText: string | null;
  latestStatement: { actorId: string; text: string } | null;
  checkpointPending: boolean;
  ended: boolean;
}

export interface WerewolfDiscussionTurn {
  thread: number;
  openerId: string;
  stage: "opening" | "reply" | "answer";
  recipientIds: string[];
  replyToTurn: number | null;
  nextSpeakerId: string | null;
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
  recipientIds: string[];
  respondentIds: string[];
  nextSpeakerId: string | null;
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
  | { type: "werewolf.day_vote_resolved"; payload: WerewolfDayResult }
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
  openingOrderIds: string[];
  openingCursor: number;
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
