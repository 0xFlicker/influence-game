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

export type MessageScope = "public" | "whisper" | "system" | "thinking";

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
  /** Room ID this whisper happened in (new room-based whisper system) */
  roomId?: number;
}

// ---------------------------------------------------------------------------
// Whisper room allocation
// ---------------------------------------------------------------------------

export interface RoomAllocation {
  roomId: number; // 1-indexed
  playerA: UUID;
  playerB: UUID;
  round: number;
}

/** System event emitted when whisper rooms are allocated for a round */
export interface RoomAllocationEvent {
  type: "system";
  scope: "system";
  text: string; // e.g. "Room 1: Atlas & Vera | Room 2: Finn & Mira | Commons: Lyra, Rex"
  round: number;
  phase: "WHISPER";
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
    whisper: number;
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
  /** Messages per player in the lobby phase. If unset, uses player-count scaling: fewer players get more messages. */
  lobbyMessagesPerPlayer?: number;
  /** Max whisper conversations per agent per round (default 2). Scarcity makes whispers more strategic. */
  maxWhisperPairsPerAgent?: number;
  /** Max message exchanges per whisper conversation (default 2). Each exchange = 1 message per agent. */
  maxWhisperExchanges?: number;
  /** Number of whisper sessions per round (default 2). Each session allocates new rooms. */
  whisperSessionsPerRound?: number;
  /** Simulator experiment flag: avoid honoring repeat whisper-room pair requests. */
  experimentalAntiRepeatWhisperRooms?: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  timers: {
    introduction: 30_000, // 30s for prototype
    lobby: 30_000,
    whisper: 45_000,
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
