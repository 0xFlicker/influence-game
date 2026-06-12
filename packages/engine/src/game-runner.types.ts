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
  MingleSessionDiagnostics,
  MingleRoomCount,
  MingleIntentSummary as MingleIntentSummaryBase,
} from "./types";

export type { MingleIntentSummary, MinglePreferredRoomSize } from "./types";

// ---------------------------------------------------------------------------
// Stream events — emitted in real-time for WebSocket observers
// ---------------------------------------------------------------------------

export type GameStreamEvent =
  | { type: "transcript_entry"; entry: TranscriptEntry }
  | AgentTurnEvent
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
  /**
   * Raw model-provided reasoning context (e.g. `reasoning_content` from local LLMs).
   * Captured alongside `thinking` for richer simulation traces.
   */
  reasoningContext?: string;
}

export interface MingleTurnAction {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Private room message. Empty/null means no TALK action. */
  message?: string | null;
  /** True when the agent intentionally sends NO_REPLY for this turn. */
  noReply?: boolean;
  /** Optional local room number to enter for the next turn. */
  gotoRoomId?: number | null;
  /** Optional producer/debug label describing the strategic signal in this turn. */
  strategySignal?: string | null;
  /** Optional producer/debug explanation for movement, or null when staying put. */
  movementPurpose?: string | null;
  /** Raw model reasoning context from local LLM */
  reasoningContext?: string;
}

export interface MingleRoomChoiceAction {
  /** Local room number chosen by the agent, or null when no valid choice is available. */
  roomId: number | null;
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Raw model reasoning context from local LLM */
  reasoningContext?: string;
}

export interface MingleIntentAction extends MingleIntentSummaryBase {
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Raw model reasoning context from local LLM */
  reasoningContext?: string;
}

export interface StrategicReflectionAction {
  certainties: string[];
  suspicions: string[];
  allies: string[];
  threats: string[];
  plan: string;
  /** Agent's internal thinking (hidden from players, visible to viewers) */
  thinking?: string;
  /** Raw model reasoning context from local LLM */
  reasoningContext?: string;
}

export type StrategicReflectionSummary = Omit<StrategicReflectionAction, "thinking" | "reasoningContext">;

export interface TargetDecision {
  target: UUID;
  thinking?: string;
  reasoningContext?: string;
}

export type AgentTurnVisibility = "public" | "private" | "anonymous" | "diary" | "system";

export interface AgentTurnActor {
  id?: UUID;
  name: string;
  role?: "player" | "juror" | "house";
}

export interface AgentTurnEvent {
  type: "agent_turn";
  round: number;
  phase: Phase;
  timestamp: number;
  action: string;
  actor: AgentTurnActor;
  visibility: AgentTurnVisibility;
  response: Record<string, unknown>;
  thinking?: string;
  reasoningContext?: string;
  scope?: TranscriptEntry["scope"];
  text?: string;
  to?: string[];
  roomId?: number;
  anonymous?: boolean;
  displayOrder?: number;
}

export interface PowerLobbyExposure {
  id: UUID;
  name: string;
  score: number;
}

export interface AgentCallOptions {
  signal?: AbortSignal;
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
  /** Called before initial Mingle room choice to form a hidden private-room strategy intent */
  getMingleIntent?(context: PhaseContext): Promise<MingleIntentAction | null>;
  /** Choose a Mingle room by room number (current active method for the Mingle phase) */
  chooseMingleRoom(context: PhaseContext): Promise<MingleRoomChoiceAction>;
  /** Send a private room message to all other occupants, or null to pass */
  sendRoomMessage(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null>;
  /** Mingle turn action: TALK or NO_REPLY, plus optional GOTO ROOM N for the next turn */
  takeMingleTurn?(context: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<MingleTurnAction>;
  /** Called to collect a rumor message */
  getRumorMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called to collect votes */
  getVotes(
    context: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID; thinking?: string; reasoningContext?: string }>;
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
  ): Promise<PowerAction & { thinking?: string; reasoningContext?: string }>;
  /** Called for council vote (empowered agent also votes as tiebreaker) */
  getCouncilVote(
    context: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<{ target: UUID; thinking?: string; reasoningContext?: string }>;
  /** Called when the agent is about to be eliminated */
  getLastMessage(context: PhaseContext): Promise<AgentResponse>;
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse>;

  // --- Endgame methods ---
  /** Reckoning: public plea to the group */
  getPlea(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Reckoning/Tribunal: vote to eliminate one player (simple plurality) */
  getEndgameEliminationVote(context: PhaseContext, options?: AgentCallOptions): Promise<TargetDecision>;
  /** Tribunal: publicly accuse one player */
  getAccusation(context: PhaseContext, options?: AgentCallOptions): Promise<{ targetId: UUID; text: string; thinking?: string; reasoningContext?: string }>;
  /** Tribunal: defend against an accusation */
  getDefense(context: PhaseContext, accusation: string, accuserName: string, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: opening statement to the jury */
  getOpeningStatement(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: juror asks one question to one finalist */
  getJuryQuestion(context: PhaseContext, finalistIds: [UUID, UUID], options?: AgentCallOptions): Promise<{ targetFinalistId: UUID; question: string; thinking?: string; reasoningContext?: string }>;
  /** Judgment: finalist answers a jury question */
  getJuryAnswer(context: PhaseContext, question: string, jurorName: string, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: closing argument to the jury */
  getClosingArgument(context: PhaseContext, options?: AgentCallOptions): Promise<AgentResponse>;
  /** Judgment: juror votes for the winner */
  getJuryVote(context: PhaseContext, finalistIds: [UUID, UUID], options?: AgentCallOptions): Promise<TargetDecision>;

  // --- Strategic reflection (called after diary room) ---
  /** Produce a strategic reflection after diary room interview */
  getStrategicReflection(context: PhaseContext): Promise<StrategicReflectionAction | null | void>;

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
  /** Messages this agent received in the current Mingle/private room */
  mingleMessages: Array<{ from: string; text: string }>;
  empoweredId?: UUID;
  councilCandidates?: [UUID, UUID];
  // Mingle room allocation context
  /** Number of available rooms this round */
  roomCount?: number;
  /** Current occupant count for each room. Player identities outside the current room are hidden. */
  roomCounts?: MingleRoomCount[];
  /** This agent's current local room number, if they are in a Mingle room. */
  currentRoomId?: number;
  /** Room assignments for this round (if Mingle phase completed) */
  roomAllocations?: Array<{ roomId: number; beat: number; playerIds: string[]; playerNames: string[] }>;
  /** This agent's current room occupants, including self */
  roomMates?: string[];
  /** Hidden Mingle intent formed before initial room choice */
  mingleIntent?: MingleIntentSummaryBase | null;
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
  scope: "public" | "mingle" | "whisper" | "system" | "diary" | "thinking";
  to?: string[];
  text: string;
  /** Agent's internal thinking when producing this message (hidden from players, visible to viewers) */
  thinking?: string;
  /**
   * Raw model reasoning context (e.g. `reasoning_content` from local models like Gemma via LM Studio).
   * Captured separately from the agent's "thinking" field for richer simulation traces.
   */
  reasoningContext?: string;
  /** When true, author identity is hidden from players (viewers still see it) */
  anonymous?: boolean;
  /** Shuffled display position for anonymous rumors */
  displayOrder?: number;
  /** Room ID for this private-room message */
  roomId?: number;
  /** Room allocation metadata attached to system events */
  roomMetadata?: {
    rooms: RoomAllocation[];
    excluded: string[];
    diagnostics?: MingleSessionDiagnostics;
  };
}
