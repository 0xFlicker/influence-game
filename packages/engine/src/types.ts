/**
 * Influence Game - Core Types
 *
 * Standalone prototype types — no ElizaOS dependency.
 */

export type UUID = string;

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------

export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  LOBBY = "LOBBY",
  MINGLE_I = "MINGLE_I",
  PRE_VOTE_HUDDLE = "PRE_VOTE_HUDDLE",
  MINGLE = "MINGLE",
  POST_VOTE_MINGLE = "POST_VOTE_MINGLE",
  PRE_COUNCIL_HUDDLE = "PRE_COUNCIL_HUDDLE",
  WHISPER = "WHISPER",
  RUMOR = "RUMOR",
  VOTE = "VOTE",
  POWER = "POWER",
  REVEAL = "REVEAL",
  COUNCIL = "COUNCIL",
  DIARY_ROOM = "DIARY_ROOM",
  // Endgame phases
  PLEA = "PLEA",
  ACCUSATION = "ACCUSATION",
  DEFENSE = "DEFENSE",
  OPENING_STATEMENTS = "OPENING_STATEMENTS",
  JURY_QUESTIONS = "JURY_QUESTIONS",
  CLOSING_ARGUMENTS = "CLOSING_ARGUMENTS",
  JURY_VOTE = "JURY_VOTE",
  END = "END",
}

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export enum PlayerStatus {
  ALIVE = "alive",
  ELIMINATED = "eliminated",
}

export interface Player {
  id: UUID;
  name: string;
  status: PlayerStatus;
  /** Shielded players cannot be revealed as council candidates this round */
  shielded: boolean;
  /** One-time last message generated at the moment this player is eliminated */
  lastMessage?: string;
}

// ---------------------------------------------------------------------------
// Vote tallies
// ---------------------------------------------------------------------------

export interface VoteTally {
  /** Who each player voted to empower */
  empowerVotes: Record<UUID, UUID>; // voter -> target
  /** Who each player voted to expose */
  exposeVotes: Record<UUID, UUID>; // voter -> target
}

export interface CouncilVoteTally {
  /** Votes to eliminate each candidate (empowered agent doesn't vote normally) */
  votes: Record<UUID, UUID>; // voter -> target candidate
}

// ---------------------------------------------------------------------------
// Endgame types
// ---------------------------------------------------------------------------

export type EndgameStage = "reckoning" | "tribunal" | "judgment";

export interface JuryMember {
  playerId: UUID;
  playerName: string;
  eliminatedRound: number;
}

export interface JuryQuestion {
  jurorId: UUID;
  targetFinalistId: UUID;
  question: string;
}

export interface JuryAnswer {
  finalistId: UUID;
  jurorId: UUID;
  answer: string;
}

export interface EndgameState {
  stage: EndgameStage;
  jury: JuryMember[];
  finalists?: [UUID, UUID];
}

/** Endgame elimination vote tally (simple plurality, no empower/expose split) */
export interface EndgameEliminationTally {
  /** voter -> target to eliminate */
  votes: Record<UUID, UUID>;
}

/** Jury vote tally for the Judgment finale */
export interface JuryVoteTally {
  /** juror -> finalist they vote for */
  votes: Record<UUID, UUID>;
}

// ---------------------------------------------------------------------------
// Round results
// ---------------------------------------------------------------------------

export interface RoundResult {
  round: number;
  empoweredId: UUID;
  exposeScores: Record<UUID, number>;
  candidates: [UUID, UUID]; // [expose-leader, second-most-exposed]
  powerAction: PowerActionType;
  powerTarget: UUID;
  eliminated: UUID;
  shieldGranted?: UUID; // player who got shielded via protect
}

// ---------------------------------------------------------------------------
// Power action
// ---------------------------------------------------------------------------

export type PowerActionType = "eliminate" | "protect" | "pass";

export interface PowerAction {
  action: PowerActionType;
  target: UUID;
}

// ---------------------------------------------------------------------------
// Messages passed between agents and the House
// ---------------------------------------------------------------------------

export type MessageScope = "public" | "mingle" | "huddle" | "whisper" | "system" | "diary" | "thinking";

export interface PublicMessage {
  type: "public";
  from: UUID;
  text: string;
  round: number;
  phase: Phase;
  timestamp: number;
  /** When true, author identity is hidden from players (viewers still see it) */
  anonymous?: boolean;
  /** Shuffled display position for anonymous rumors */
  displayOrder?: number;
}

export interface WhisperMessage {
  type: "whisper";
  from: UUID;
  to: UUID[];
  text: string;
  round: number;
  timestamp: number;
  /** Room ID for this private-room message */
  roomId?: number;
}

// ---------------------------------------------------------------------------
// Mingle room allocation
// ---------------------------------------------------------------------------

export interface RoomAllocation {
  roomId: number; // 1-indexed
  round: number;
  beat: number;
  playerIds: UUID[];
}

export interface MingleRoomPlayerRef {
  id: UUID;
  name: string;
}

export type MingleRoomChoiceStatus =
  | "valid"
  | "missing"
  | "invalid"
  | "player_valid"
  | "player_valid_room_ignored"
  | "player_unknown"
  | "player_dead"
  | "player_self"
  | "player_cycle";
export type MingleRoomAssignmentSource = "house" | "repaired" | "fallback" | "movement";

export type MinglePreferredRoomSize = "solo" | "pair" | "small_group" | "large_group" | "any";

export type StrategicLens =
  | "vote_math"
  | "room_traffic"
  | "promise_debt"
  | "power_position"
  | "private_inconsistency"
  | "coalition_geometry"
  | "information_control"
  | "jury_threat"
  | "loyalty_stress"
  | "retaliation_risk"
  | "social_cover"
  | "timing_pattern"
  | "presentation_read"
  | "relationship_repair"
  | "broad_read";

export interface MingleIntentSummary {
  seekPlayers: string[];
  avoidPlayers: string[];
  preferredRoomSize: MinglePreferredRoomSize;
  purpose: string;
  provisionalTarget: string | null;
  noTargetReason: string | null;
  openingAsk: string;
  strategicLens: StrategicLens;
  strategicLensRationale: string;
}

export interface MingleRoomAssignmentRecord {
  player: MingleRoomPlayerRef;
  assignedRoomId: number;
  source: MingleRoomAssignmentSource;
  repairNotes?: string[];
  intent?: MingleIntentSummary | null;
}

export interface MingleRoomCount {
  roomId: number;
  count: number;
}

export type MingleTurnActionType = "talk" | "no_reply";

export interface MingleTurnActionRecord {
  player: MingleRoomPlayerRef;
  turn: number;
  fromRoomId: number;
  toRoomId: number;
  moved: boolean;
  action: MingleTurnActionType;
  gotoRoomId: number | null;
  gotoPlayerName: string | null;
  gotoRoomIgnored?: boolean;
  gotoStatus: MingleRoomChoiceStatus;
}

export interface MingleAllocatedRoomDiagnostics {
  roomId: number;
  beat: number;
  players: MingleRoomPlayerRef[];
  conversationRan: boolean;
}

export interface MingleSessionDiagnostics {
  round: number;
  beat: number;
  roomCount: number;
  eligiblePlayers: MingleRoomPlayerRef[];
  assignments: MingleRoomAssignmentRecord[];
  allocatedRooms: MingleAllocatedRoomDiagnostics[];
  actions?: MingleTurnActionRecord[];
}

// ---------------------------------------------------------------------------
// Named alliances
// ---------------------------------------------------------------------------

export type AllianceProposalResponse = "accepted" | "declined" | "deferred" | "trial";

export type AllianceProposalStatus = "open" | "activated" | "declined" | "expired";

export type AllianceStatus = "active" | "closed" | "archived";

export type AllianceCloseReason =
  | "universal_all_alive_before_mingle"
  | "manual"
  | "endgame_dissolution";

export type AllianceArchiveReason = "fewer_than_two_live_members" | "manual";

export interface AllianceTerms {
  name: string;
  memberIds: UUID[];
  purpose: string;
  timebox: string | null;
}

export interface AllianceProposalVersion {
  versionId: UUID;
  proposerId: UUID;
  terms: AllianceTerms;
  requiredConsentMemberIds?: UUID[];
  counterIndex: number;
  createdRound: number;
  createdAt: string;
}

export interface AllianceProposalLineage {
  id: UUID;
  allianceId: UUID;
  status: AllianceProposalStatus;
  currentVersionId: UUID;
  versions: AllianceProposalVersion[];
  responsesByVersion: Record<UUID, Record<UUID, AllianceProposalResponse>>;
  createdRound: number;
  createdAt: string;
  resolvedRound: number | null;
  resolvedAt: string | null;
}

export interface AllianceRecord {
  id: UUID;
  name: string;
  memberIds: UUID[];
  purpose: string;
  timebox: string | null;
  status: AllianceStatus;
  createdRound: number;
  createdAt: string;
  updatedRound: number;
  updatedAt: string;
  lineageIds: UUID[];
  huddleOutcomeIds: UUID[];
  closedReason?: AllianceCloseReason;
  archivedReason?: AllianceArchiveReason;
}

export type AllianceHuddleWindow = "pre_vote" | "pre_council";

export type AllianceHuddleScheduleDecision = "scheduled" | "skipped";

export interface AllianceHuddleScheduleRecord {
  id: UUID;
  allianceId: UUID;
  window: AllianceHuddleWindow;
  round: number;
  pass: number;
  decision: AllianceHuddleScheduleDecision;
  memberIds: UUID[];
  rationale: string;
  createdAt: string;
}

export interface AllianceHuddleSessionRecord {
  id: UUID;
  scheduleId: UUID;
  allianceId: UUID;
  window: AllianceHuddleWindow;
  round: number;
  pass: number;
  speakerIds: UUID[];
  completedAt: string;
}

export interface AllianceHuddleOutcome {
  id: UUID;
  sessionId: UUID;
  allianceId: UUID;
  window: AllianceHuddleWindow;
  round: number;
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: "low" | "medium" | "high";
  posture: string;
  leakOrBetrayalClaims: string[];
  createdAt: string;
}

export interface AllianceProposalInput {
  allianceId?: UUID;
  lineageId?: UUID;
  versionId?: UUID;
  proposerId: UUID;
  name: string;
  memberIds: UUID[];
  purpose: string;
  timebox?: string | null;
}

export interface AllianceAmendmentInput extends AllianceProposalInput {
  allianceId: UUID;
}

export interface AllianceResponseInput {
  lineageId: UUID;
  versionId: UUID;
  playerId: UUID;
  response: AllianceProposalResponse;
}

export interface AllianceCounterInput {
  lineageId: UUID;
  versionId?: UUID;
  proposerId: UUID;
  name: string;
  memberIds: UUID[];
  purpose: string;
  timebox?: string | null;
}

/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperRoomPlayerRef = MingleRoomPlayerRef;
/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperRoomChoiceStatus = MingleRoomChoiceStatus;
/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperRoomChoiceRecord = MingleRoomAssignmentRecord;
/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperRoomCount = MingleRoomCount;
/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperAllocatedRoomDiagnostics = MingleAllocatedRoomDiagnostics;
/** @deprecated Legacy name kept only for old replay/import compatibility. */
export type WhisperSessionDiagnostics = MingleSessionDiagnostics;

/** System event emitted when mingle rooms are allocated for a round */
export interface RoomAllocationEvent {
  type: "system";
  scope: "system";
  text: string; // e.g. "Room 1: Atlas & Vera | Room 2: Finn & Mira | Commons: Lyra, Rex"
  round: number;
  phase: Phase;
  timestamp: number;
  metadata: {
    rooms: RoomAllocation[];
    excluded: UUID[];
  };
}

export interface SystemMessage {
  type: "system";
  text: string;
  data?: unknown;
  round: number;
  phase: Phase;
  timestamp: number;
}

/** Agent's hidden internal thought — revealable by viewers on-demand */
export interface ThinkingMessage {
  type: "thinking";
  from: UUID;
  text: string;
  round: number;
  phase: Phase;
  timestamp: number;
  /** Thinking events are hidden by default; viewers toggle visibility */
  visible: boolean;
}

export type GameMessage = PublicMessage | WhisperMessage | SystemMessage | ThinkingMessage;

// ---------------------------------------------------------------------------
// Events emitted by the House to agents
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "PHASE_STARTED"; phase: Phase; round: number; alivePlayers: UUID[] }
  | { type: "PHASE_ENDED"; phase: Phase; round: number }
  | { type: "VOTE_REQUESTED"; round: number; alivePlayers: UUID[] }
  | {
      type: "POWER_REQUESTED";
      round: number;
      empoweredId: UUID;
      candidates: [UUID, UUID];
      alivePlayers: UUID[];
    }
  | {
      type: "COUNCIL_REQUESTED";
      round: number;
      empoweredId: UUID;
      candidates: [UUID, UUID];
    }
  | { type: "PLAYER_ELIMINATED"; playerId: UUID; playerName: string; round: number }
  | { type: "ROUND_COMPLETE"; round: number; result: RoundResult }
  | { type: "GAME_OVER"; winner?: UUID; winnerName?: string; totalRounds: number }
  // Endgame events
  | { type: "ENDGAME_STARTED"; stage: EndgameStage; alivePlayers: UUID[]; jury: JuryMember[] }
  | { type: "ENDGAME_ELIMINATION_REQUESTED"; stage: EndgameStage; round: number; alivePlayers: UUID[] }
  | { type: "JURY_QUESTION_REQUESTED"; jurorId: UUID; finalistIds: [UUID, UUID] }
  | { type: "JURY_ANSWER_REQUESTED"; finalistId: UUID; question: JuryQuestion }
  | { type: "JURY_VOTE_REQUESTED"; jurorId: UUID; finalistIds: [UUID, UUID] };

// ---------------------------------------------------------------------------
// Actions sent by agents to the House
// ---------------------------------------------------------------------------

export type AgentAction =
  | { type: "INTRODUCTION"; from: UUID; text: string }
  | { type: "LOBBY_MESSAGE"; from: UUID; text: string }
  | { type: "WHISPER"; from: UUID; to: UUID[]; text: string }
  | { type: "RUMOR_MESSAGE"; from: UUID; text: string }
  | { type: "VOTE"; from: UUID; empowerTarget: UUID; exposeTarget: UUID }
  | { type: "POWER_ACTION"; from: UUID; action: PowerActionType; target: UUID }
  | { type: "COUNCIL_VOTE"; from: UUID; eliminateTarget: UUID }
  | { type: "LAST_MESSAGE"; from: UUID; text: string }
  | { type: "DIARY_ENTRY"; from: UUID; text: string; phase: Phase }
  | { type: "THINKING"; from: UUID; text: string; phase: Phase }
  // Endgame actions
  | { type: "PLEA"; from: UUID; text: string }
  | { type: "ENDGAME_ELIMINATION_VOTE"; from: UUID; eliminateTarget: UUID }
  | { type: "ACCUSATION"; from: UUID; targetId: UUID; text: string }
  | { type: "DEFENSE"; from: UUID; text: string }
  | { type: "OPENING_STATEMENT"; from: UUID; text: string }
  | { type: "JURY_QUESTION"; from: UUID; targetFinalistId: UUID; question: string }
  | { type: "JURY_ANSWER"; from: UUID; jurorId: UUID; answer: string }
  | { type: "CLOSING_ARGUMENT"; from: UUID; text: string }
  | { type: "JURY_VOTE_CAST"; from: UUID; finalistId: UUID };

// ---------------------------------------------------------------------------
// Game configuration
// ---------------------------------------------------------------------------

export type ViewerMode = "live" | "speedrun" | "replay";

export interface GameConfig {
  /** Phase durations in milliseconds (0 = wait for all players to respond) */
  timers: {
    introduction: number;
    lobby: number;
    mingle: number;
    rumor: number;
    vote: number;
    power: number;
    council: number;
    // Endgame timers
    plea?: number;
    accusation?: number;
    defense?: number;
    openingStatements?: number;
    juryQuestions?: number;
    closingArguments?: number;
    juryVote?: number;
  };
  /** Max rounds before game is declared a draw */
  maxRounds: number;
  /** Minimum players to start */
  minPlayers: number;
  /** Maximum players */
  maxPlayers: number;
  /** Presentation pacing mode: "live" for public viewers, "speedrun" for admin/testing, "replay" for post-game */
  viewerMode?: ViewerMode;
  /** Max follow-up questions per diary room interview (default 1). Set to 0 for single-question interviews. */
  maxDiaryFollowUps?: number;
  /** If set, only run diary rooms after these phases. If unset, diary rooms run after every phase. */
  diaryRoomAfterPhases?: Phase[];
  /** Enable hidden strategic reflection calls that update agent memory (default true). */
  enableStrategicReflections?: boolean;
  /** Messages per player in the lobby phase. If unset, uses player-count scaling: fewer players get more messages. */
  lobbyMessagesPerPlayer?: number;
  /** Number of open-room movement beats per round (default 2). */
  mingleSessionsPerRound?: number;
  /** Max milliseconds to wait for a single endgame agent action before using a House fallback. */
  agentActionTimeoutMs?: number;
  /** Simulator experiment flag: add one public post-vote Power Lobby beat before the empowered action. */
  powerLobbyAfterVote?: boolean;
  /** Emit persisted House MC summary artifacts between completed normal rounds (default true). */
  enableHouseRoundSummaries?: boolean;
  /** Enable private House Strategy Bible Packet updates for producer/debug carry-forward (default false). */
  enableHouseStrategyBible?: boolean;
  /** Enable long-form House gameplay summaries for rich producer validation (default false). */
  enableHouseLongFormSummaries?: boolean;
  /** Enable private House producer briefs before diary-room questions (default false). */
  enableHouseProducerBriefs?: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  timers: {
    introduction: 30_000, // 30s for prototype
    lobby: 30_000,
    mingle: 45_000,
    rumor: 30_000,
    vote: 20_000,
    power: 15_000,
    council: 20_000,
    // Endgame timers
    plea: 20_000,
    accusation: 20_000,
    defense: 20_000,
    openingStatements: 30_000,
    juryQuestions: 30_000,
    closingArguments: 30_000,
    juryVote: 20_000,
  },
  maxRounds: 10,
  minPlayers: 5,
  maxPlayers: 12,
  viewerMode: "speedrun",
};

/**
 * Compute fixed odd jury size based on total player count.
 * 5-6 players → 3 jurors, 7-9 → 5 jurors, 10-12 → 7 jurors.
 * Early eliminations don't earn jury seats.
 */
export function computeJurySize(totalPlayers: number): number {
  if (totalPlayers <= 6) return 3;
  if (totalPlayers <= 9) return 5;
  return 7;
}

/**
 * Compute a player-count-scaled maxRounds to ensure games resolve.
 * Formula: normal rounds to reach 4 players + 3 endgame rounds + 2 buffer.
 * For 10 players: (10-4) + 3 + 2 = 11. For 4 players: (4-4) + 3 + 2 = 5.
 */
export function computeMaxRounds(playerCount: number): number {
  const normalRoundsToEndgame = Math.max(0, playerCount - 4);
  const endgameRounds = 3; // reckoning + tribunal + judgment
  const buffer = 2;
  return Math.max(DEFAULT_CONFIG.maxRounds, normalRoundsToEndgame + endgameRounds + buffer);
}
