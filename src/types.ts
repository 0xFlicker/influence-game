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
  /** One-time last message (pre-registered during VOTE, posted on elimination) */
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

export type MessageScope = "public" | "whisper" | "system";

export interface PublicMessage {
  type: "public";
  from: UUID;
  text: string;
  round: number;
  phase: Phase;
  timestamp: number;
}

export interface WhisperMessage {
  type: "whisper";
  from: UUID;
  to: UUID[];
  text: string;
  round: number;
  timestamp: number;
}

export interface SystemMessage {
  type: "system";
  text: string;
  data?: unknown;
  round: number;
  phase: Phase;
  timestamp: number;
}

export type GameMessage = PublicMessage | WhisperMessage | SystemMessage;

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
  | { type: "GAME_OVER"; winner?: UUID; winnerName?: string; totalRounds: number };

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
  | { type: "DIARY_ENTRY"; from: UUID; text: string; phase: Phase };

// ---------------------------------------------------------------------------
// Game configuration
// ---------------------------------------------------------------------------

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
  };
  /** Max rounds before game is declared a draw */
  maxRounds: number;
  /** Minimum players to start */
  minPlayers: number;
  /** Maximum players */
  maxPlayers: number;
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
  },
  maxRounds: 10,
  minPlayers: 4,
  maxPlayers: 12,
};
