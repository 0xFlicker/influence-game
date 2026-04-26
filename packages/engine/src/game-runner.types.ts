/**
 * Influence Game - Game Runner Types
 *
 * Shared types and interfaces used by the game runner and its extracted modules.
 */

import type {
  UUID,
  PowerAction,
  JuryMember,
  EndgameStage,
  RoomAllocation,
  Phase,
  WhisperSessionDiagnostics,
} from "./types";

// ---------------------------------------------------------------------------
// Stream events — emitted in real-time for WebSocket observers
// ---------------------------------------------------------------------------

export type GameStreamEvent =
  | { type: "transcript_entry"; entry: TranscriptEntry }
  | { type: "phase_change"; phase: Phase; round: number; alivePlayers: Array<{ id: UUID; name: string }> }
  | { type: "player_eliminated"; playerId: UUID; playerName: string; round: number }
  | { type: "game_over"; winner?: UUID; winnerName?: string; totalRounds: number };

export interface GameStateSnapshot {
  gameId: UUID;
  round: number;
  alivePlayers: Array<{ id: UUID; name: string; shielded: boolean }>;
  eliminatedPlayers: Array<{ id: UUID; name: string }>;
  transcript: TranscriptEntry[];
}

// ---------------------------------------------------------------------------
// Agent response — structured output from message-producing methods
// ---------------------------------------------------------------------------

export interface AgentResponse {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking: string;
  /** The actual message content */
  message: string;
}

export interface PowerLobbyExposure {
  id: UUID;
  name: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Agent interface (implemented by InfluenceAgent in agent.ts)
// ---------------------------------------------------------------------------

export interface IAgent {
  readonly id: UUID;
  readonly name: string;
  /** Called once when the game starts */
  onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void;
  /** Called at the start of each phase with current game context */
  onPhaseStart(context: PhaseContext): Promise<void>;
  /** Called to collect this agent's introduction message */
  getIntroduction(context: PhaseContext): Promise<AgentResponse>;
  /** Called once before lobby sub-rounds to form a lobby strategy intent */
  getLobbyIntent?(context: PhaseContext): Promise<string>;
  /** Called to collect a lobby message */
  getLobbyMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect whisper actions (list of {to, text}) — DEPRECATED, use room methods */
  getWhispers(context: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>>;
  /** Request a preferred whisper room partner */
  requestRoom(context: PhaseContext): Promise<UUID | null>;
  /** Send a private message to room partner, or null to pass */
  sendRoomMessage(context: PhaseContext, partnerName: string, conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null>;
  /** Called to collect a rumor message */
  getRumorMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect votes */
  getVotes(
    context: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }>;
  /** Called during the optional post-vote Power Lobby experiment before the empowered action */
  getPowerLobbyMessage?(
    context: PhaseContext,
    provisionalCandidates: [UUID, UUID],
    exposePressure: PowerLobbyExposure[],
  ): Promise<AgentResponse>;
  /** Called only if this agent is the empowered agent */
  getPowerAction(
    context: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<PowerAction>;
  /** Called for council vote (empowered agent also votes as tiebreaker) */
  getCouncilVote(context: PhaseContext, candidates: [UUID, UUID]): Promise<UUID>;
  /** Called when the agent is about to be eliminated */
  getLastMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse>;

  // --- Endgame methods ---
  /** Reckoning: public plea to the group */
  getPlea(context: PhaseContext): Promise<AgentResponse>;
  /** Reckoning/Tribunal: vote to eliminate one player (simple plurality) */
  getEndgameEliminationVote(context: PhaseContext): Promise<UUID>;
  /** Tribunal: publicly accuse one player */
  getAccusation(context: PhaseContext): Promise<{ targetId: UUID; text: string; thinking?: string }>;
  /** Tribunal: defend against an accusation */
  getDefense(context: PhaseContext, accusation: string, accuserName: string): Promise<AgentResponse>;
  /** Judgment: opening statement to the jury */
  getOpeningStatement(context: PhaseContext): Promise<AgentResponse>;
  /** Judgment: juror asks one question to one finalist */
  getJuryQuestion(context: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string; thinking?: string }>;
  /** Judgment: finalist answers a jury question */
  getJuryAnswer(context: PhaseContext, question: string, jurorName: string): Promise<AgentResponse>;
  /** Judgment: closing argument to the jury */
  getClosingArgument(context: PhaseContext): Promise<AgentResponse>;
  /** Judgment: juror votes for the winner */
  getJuryVote(context: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID>;

  // --- Strategic reflection (called after diary room) ---
  /** Produce a strategic reflection after diary room interview */
  getStrategicReflection?(context: PhaseContext): Promise<void>;

  // --- Memory updates (called by GameRunner after phase events) ---
  /** Record a player as an ally */
  updateAlly(playerName: string): void;
  /** Record a player as a threat */
  updateThreat(playerName: string): void;
  /** Add a note about a player */
  addNote(playerName: string, note: string): void;
  /** Remove a player from memory (after elimination) */
  removeFromMemory?(playerName: string): void;
}

// ---------------------------------------------------------------------------
// Phase context passed to agents
// ---------------------------------------------------------------------------

export interface PhaseContext {
  gameId: UUID;
  round: number;
  phase: Phase;
  selfId: UUID;
  selfName: string;
  alivePlayers: Array<{ id: UUID; name: string }>;
  publicMessages: Array<{ from: string; text: string; phase: Phase; round?: number; anonymous?: boolean; displayOrder?: number }>;
  /** Messages this agent received as whispers */
  whisperMessages: Array<{ from: string; text: string }>;
  empoweredId?: UUID;
  councilCandidates?: [UUID, UUID];
  // Room allocation context (whisper rooms)
  /** Number of available rooms this round */
  roomCount?: number;
  /** Room assignments for this round (if whisper phase completed) */
  roomAllocations?: Array<{ roomId: number; playerA: string; playerB: string }>;
  /** Players excluded from rooms this round */
  excludedPlayers?: string[];
  /** This agent's room partner (if assigned a room) */
  roomPartner?: string;
  // Endgame context
  endgameStage?: EndgameStage;
  jury?: JuryMember[];
  finalists?: [UUID, UUID];
  /** True when this agent has been eliminated (e.g. juror in diary room) */
  isEliminated?: boolean;
  /** Context about how this agent was just eliminated for final words. */
  eliminationContext?: {
    mode: "power" | "council" | "endgame";
    exposedBy?: string[];
    councilVoters?: string[];
    eliminationVoters?: string[];
    directExecutor?: string;
  };
  /** Current lobby sub-round index (0-based) */
  lobbySubRound?: number;
  /** Total lobby sub-rounds this phase */
  lobbyTotalSubRounds?: number;
}

// ---------------------------------------------------------------------------
// Transcript entry
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;
  scope: "public" | "whisper" | "system" | "diary" | "thinking";
  to?: string[];
  text: string;
  /** Agent's internal thinking when producing this message (hidden from players, visible to viewers) */
  thinking?: string;
  /** When true, author identity is hidden from players (viewers still see it) */
  anonymous?: boolean;
  /** Shuffled display position for anonymous rumors */
  displayOrder?: number;
  /** Room ID this whisper happened in (room-based whisper system) */
  roomId?: number;
  /** Room allocation metadata attached to system events */
  roomMetadata?: {
    rooms: RoomAllocation[];
    excluded: string[];
    diagnostics?: WhisperSessionDiagnostics;
  };
}
