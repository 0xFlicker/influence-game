/** Werewolf owns its rules and event vocabulary; Influence phases do not apply. */
import type { RetrospectiveDefinitionV1, RetrospectiveStatementV1, RetrospectiveCompletionV1, RetrospectiveOutcomeSource, RetrospectiveStateV1 } from "../retrospective";
export type WerewolfRole = "werewolf" | "villager" | "seer" | "doctor";
export type WerewolfFaction = "village" | "wolves";
export type WerewolfPreset = "one_wolf" | "two_wolves";
export type WerewolfPhase = "introduction" | "pack" | "night" | "day" | "vote" | "retrospective" | "complete";
export type WerewolfAction = "speaking_priority" | "introduce" | "pack_talk" | "attack" | "investigate" | "protect" | "open_thread" | "discuss" | "vote" | "conversation" | "public_vote" | "pack_propose";
export type WerewolfVoteMode = "majority" | "plurality";

export interface WerewolfPlayer {
  agentProfileId?: string;
  contentRevisionId?: string | null;
  id: string;
  name: string;
  /** Stored character identity frozen in werewolf.started; never inferred from a name. */
  gender?: import("../types").AgentGender | null;
  personality: string;
  backstory: string;
  strategy: string;
  avatarUrl: string | null;
  personaKey?: string | null;
}

export interface WerewolfSetup { playerCount: 6 | 7 | 8; wolves: 1 | 2; seer: boolean; doctor: boolean }

export interface WerewolfConfig {
  rulesVersion: 7 | 8 | 9 | 10 | 11;
  preset: WerewolfPreset;
  setup?: WerewolfSetup;
  maxDays: number;
  /** Frozen v9 output policy. Absent in historical v7/v8 records. */
  discussionPolicy?: { bytesPerLivingPlayer: number; messageBytes: number; maxHandoffs: number };
}

export type WerewolfDecision =
  | { kind: "speaking_priority"; priority: number }
  | { kind: "opening"; text: string | null; cue: string | null; recipientIds: string[] }
  | { kind: "speech"; text: string | null; cue: string | null }
  | { kind: "conversation"; text: string | null; cue: string | null; recipientId: string | null; replyToContributionId: number | null }
  | { kind: "spoken_target"; targetId: string | null; text: string | null; cue: string | null; thinking: string }
  | { kind: "solo_target"; targetId: string | null; text: string | null; cue: string | null }
  | { kind: "target"; targetId: string | null; thinking: string };

export type WerewolfRequest = {
  actorId: string;
  legalTargetIds: string[];
} & (
  | { action: "open_thread"; legalRecipientIds: string[] }
  | { action: "vote"; voteMode: WerewolfVoteMode }
  | { action: "conversation"; legalRecipientIds: string[]; legalReplyIds: number[]; messageBytes: number }
  | { action: "public_vote"; messageBytes: number }
  | { action: "pack_propose"; messageBytes: number; targetRequired: boolean; solo?: true }
  | { action: "protect" | "investigate"; solo: true; messageBytes: number }
  | { action: Exclude<WerewolfAction, "open_thread" | "vote" | "conversation" | "public_vote" | "pack_propose"> }
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
  | { type: "werewolf.retrospective_started"; payload: RetrospectiveDefinitionV1 }
  | { type: "werewolf.retrospective_statement_recorded"; payload: RetrospectiveStatementV1 }
  | { type: "werewolf.retrospective_completed"; payload: RetrospectiveCompletionV1 }
  | { type: "werewolf.started"; payload: { config: WerewolfConfig; seed: string; players: WerewolfPlayer[]; roles: Record<string, WerewolfRole> } }
  | { type: "werewolf.phase_started"; payload: { phase: Exclude<WerewolfPhase, "complete" | "introduction" | "retrospective">; day: number } }
  | { type: "werewolf.action_accepted"; payload: WerewolfAcceptedAction }
  | { type: "werewolf.pack_vote_resolved"; payload: WerewolfPackVote }
  | { type: "werewolf.night_resolved"; payload: WerewolfNightResult }
  | { type: "werewolf.day_vote_resolved"; payload: WerewolfDayResult }
  | { type: "werewolf.completed"; payload: WerewolfOutcome };

/** Raw events are private authority. Serve only audience projections. */
export type WerewolfEvent = WerewolfEventData & { gameId: string; sequence: number };

export interface WerewolfState {
  retrospectiveOutcomeSource: RetrospectiveOutcomeSource | null;
  retrospective: RetrospectiveStateV1 | null;
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
  conversation?: WerewolfConversationState | null;
  pack: WerewolfPackNegotiation | null;
  resolved: boolean;
  previousProtection: string | null;
  investigations: Array<{ day: number; seerId: string; targetId: string; isWolf: boolean }>;
  history: WerewolfHistoryEntry[];
  outcome: WerewolfOutcome | null;
}

export interface WerewolfConversationState {
  order: string[];
  voterIds: string[];
  totalBytes: number;
  remainingBytes: number;
  messageBytes: number;
  maxHandoffs: number;
  lastOffered: Record<string, number>;
  offers: number;
  nextActorId: string;
  handoffsUsed: number;
  previousSpeakerId: string | null;
  silentIds: string[];
  unavailableIds: string[];
  ended: boolean;
  endReason: "output_budget" | "silence" | "unavailable_sweep" | null;
}

/** Public coordinates are contribution ordinals, never private event sequences. */
export interface WerewolfConversationEntry {
  kind: "conversation"; day: number; id: number; actorId: string;
  text: string | null; cue: string | null; recipientId: string | null;
  replyToContributionId: number | null; unavailable: boolean;
  remainingBytes: number;
}
export interface WerewolfBallotEntry {
  kind: "ballot"; day: number; actorId: string; targetId: string | null;
  text: string | null; cue: string | null; unavailable: boolean;
  totals: Record<string, number>; requiredVotes: number; remainingVoterIds: string[];
}
export interface WerewolfProposalEntry {
  kind: "proposal"; day: number; actorId: string; targetId: string | null;
  text: string | null; cue: string | null; unavailable: boolean; beat: number;
}

export type WerewolfHistoryEntry =
  | WerewolfConversationEntry | WerewolfBallotEntry | WerewolfProposalEntry
  | { kind: "phase"; day: number; phase: "introduction" | "night" | "day" | "vote" }
  | ({ kind: "speech"; day: number; actorId: string; audience: "public" | "pack"; text: string | null; cue: string | null }
    & ({ purpose: "retrospective"; ordinal: number } | { purpose?: never; ordinal?: never }))
  | { kind: "discussion"; day: number; contribution: WerewolfDiscussionTurn }
  | { kind: "pack_vote"; day: number; result: WerewolfPackVote }
  | { kind: "night"; day: number; result: WerewolfNightResult }
  | { kind: "vote"; day: number; result: WerewolfDayResult }
  | { kind: "result"; day: number; outcome: WerewolfOutcome };

export type WerewolfStep =
  | { kind: "action"; request: WerewolfRequest }
  | { kind: "event"; event: Exclude<WerewolfEventData, { type: "werewolf.started" | "werewolf.action_accepted" }> }
  | { kind: "complete" };
