/**
 * Influence Game - Game Runner
 *
 * Orchestrates the phase machine, game state, event bus, and agents.
 * Drives the full game loop from INIT to END, including endgame stages.
 */

import { createActor } from "xstate";
import { GameEventBus } from "./event-bus";
import { GameState } from "./game-state";
import { createPhaseMachine } from "./phase-machine";
import { TemplateHouseInterviewer } from "./house-interviewer";
import type { IHouseInterviewer, DiaryRoomContext } from "./house-interviewer";
import type {
  UUID,
  GameConfig,
  PowerAction,
  JuryMember,
  EndgameStage,
  RoomAllocation,
} from "./types";
import { Phase, PlayerStatus, computeMaxRounds, computeJurySize } from "./types";

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
  getIntroduction(context: PhaseContext): Promise<string>;
  /** Called once before lobby sub-rounds to form a lobby strategy intent */
  getLobbyIntent?(context: PhaseContext): Promise<string>;
  /** Called to collect a lobby message */
  getLobbyMessage(context: PhaseContext): Promise<string>;
  /** Called to collect whisper actions (list of {to, text}) — DEPRECATED, use room methods */
  getWhispers(context: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>>;
  /** Request a preferred whisper room partner */
  requestRoom(context: PhaseContext): Promise<UUID | null>;
  /** Send a private message to room partner, or null to pass */
  sendRoomMessage(context: PhaseContext, partnerName: string, conversationHistory?: Array<{ from: string; text: string }>): Promise<string | null>;
  /** Called to collect a rumor message */
  getRumorMessage(context: PhaseContext): Promise<string>;
  /** Called to collect votes */
  getVotes(
    context: PhaseContext,
  ): Promise<{ empowerTarget: UUID; exposeTarget: UUID }>;
  /** Called only if this agent is the empowered agent */
  getPowerAction(
    context: PhaseContext,
    candidates: [UUID, UUID],
  ): Promise<PowerAction>;
  /** Called for council vote (empowered agent also votes as tiebreaker) */
  getCouncilVote(context: PhaseContext, candidates: [UUID, UUID]): Promise<UUID>;
  /** Called when the agent is about to be eliminated */
  getLastMessage(context: PhaseContext): Promise<string>;
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string, sessionHistory?: Array<{ question: string; answer: string }>): Promise<string>;

  // --- Endgame methods ---
  /** Reckoning: public plea to the group */
  getPlea(context: PhaseContext): Promise<string>;
  /** Reckoning/Tribunal: vote to eliminate one player (simple plurality) */
  getEndgameEliminationVote(context: PhaseContext): Promise<UUID>;
  /** Tribunal: publicly accuse one player */
  getAccusation(context: PhaseContext): Promise<{ targetId: UUID; text: string }>;
  /** Tribunal: defend against an accusation */
  getDefense(context: PhaseContext, accusation: string, accuserName: string): Promise<string>;
  /** Judgment: opening statement to the jury */
  getOpeningStatement(context: PhaseContext): Promise<string>;
  /** Judgment: juror asks one question to one finalist */
  getJuryQuestion(context: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string }>;
  /** Judgment: finalist answers a jury question */
  getJuryAnswer(context: PhaseContext, question: string, jurorName: string): Promise<string>;
  /** Judgment: closing argument to the jury */
  getClosingArgument(context: PhaseContext): Promise<string>;
  /** Judgment: juror votes for the winner */
  getJuryVote(context: PhaseContext, finalistIds: [UUID, UUID]): Promise<UUID>;

  // --- Revealable thinking (replaces most diary rooms) ---
  /** Produce a brief internal thought during a phase (1-3 sentences, hidden from other players) */
  getThinking?(context: PhaseContext): Promise<string>;

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
  publicMessages: Array<{ from: string; text: string; phase: Phase; anonymous?: boolean; displayOrder?: number }>;
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
  /** When true, author identity is hidden from players (viewers still see it) */
  anonymous?: boolean;
  /** Shuffled display position for anonymous rumors */
  displayOrder?: number;
  /** Room ID this whisper happened in (room-based whisper system) */
  roomId?: number;
  /** Room allocation metadata attached to system events */
  roomMetadata?: {
    rooms: import("./types").RoomAllocation[];
    excluded: string[];
  };
}

// ---------------------------------------------------------------------------
// Game Runner
// ---------------------------------------------------------------------------

export class GameRunner {
  private readonly bus = new GameEventBus();
  private readonly gameState: GameState;
  private readonly machine: ReturnType<typeof createPhaseMachine>;
  private readonly config: GameConfig;
  private readonly agents: Map<UUID, IAgent>;
  private readonly transcript: TranscriptEntry[] = [];
  /** Whisper messages keyed by recipient */
  private whisperInbox = new Map<UUID, Array<{ from: string; text: string }>>();
  /** Public messages accumulated during the game */
  private publicMessages: Array<{ from: string; text: string; phase: Phase; anonymous?: boolean; displayOrder?: number }> = [];
  /** Diary room entries: question/answer pairs per agent per phase */
  private diaryEntries: Array<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> = [];
  /** Thinking entries: agent internal monologue per phase (revealable by viewers) */
  private thinkingEntries: Array<{ round: number; phase: Phase; agentId: UUID; agentName: string; text: string }> = [];
  /** Name of the most recently eliminated player (for diary room context) */
  private lastEliminatedName: string | null = null;
  /** Ordered list of eliminated player names (structured data, no regex needed) */
  private readonly eliminationOrder: string[] = [];
  /** Room allocations per round (for context building) */
  private currentRoomAllocations: RoomAllocation[] = [];
  /** Players excluded from rooms this round */
  private currentExcludedPlayerIds: UUID[] = [];
  /** House interviewer for diary room question generation */
  private readonly houseInterviewer: IHouseInterviewer;
  /** Optional listener for real-time game events (WebSocket streaming) */
  private _streamListener?: (event: GameStreamEvent) => void;
  /** When true, the game loop will exit at the next phase boundary. */
  private _aborted = false;

  /** Total number of players at game start (used for jury pool sizing) */
  private readonly totalPlayerCount: number;

  constructor(agents: IAgent[], config: GameConfig, houseInterviewer?: IHouseInterviewer) {
    // Scale maxRounds based on player count to ensure games can resolve
    const scaledMaxRounds = computeMaxRounds(agents.length);
    this.config = { ...config, maxRounds: Math.max(config.maxRounds, scaledMaxRounds) };
    this.totalPlayerCount = agents.length;
    this.agents = new Map(agents.map((a) => [a.id, a]));
    this.gameState = new GameState(agents.map((a) => ({ id: a.id, name: a.name })));
    this.machine = createPhaseMachine();
    this.houseInterviewer = houseInterviewer ?? new TemplateHouseInterviewer();
  }

  get transcriptLog(): readonly TranscriptEntry[] {
    return this.transcript;
  }

  get diaryLog(): ReadonlyArray<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> {
    return this.diaryEntries;
  }

  get thinkingLog(): ReadonlyArray<{ round: number; phase: Phase; agentId: UUID; agentName: string; text: string }> {
    return this.thinkingEntries;
  }

  /**
   * Get the active jury — the last N eliminated players based on game size.
   * Early eliminations don't earn jury seats.
   */
  private getActiveJury(): readonly JuryMember[] {
    const maxJurors = computeJurySize(this.totalPlayerCount);
    const allJurors = this.gameState.jury;
    if (allJurors.length <= maxJurors) return allJurors;
    // Take the last N (most recently eliminated = closest to finals)
    return allJurors.slice(allJurors.length - maxJurors);
  }

  /** Register a listener for real-time game events (for WebSocket streaming). */
  setStreamListener(listener: (event: GameStreamEvent) => void): void {
    this._streamListener = listener;
  }

  /** Get a snapshot of the current game state (for late-joining observers). */
  getStateSnapshot(): GameStateSnapshot {
    const allPlayers = this.gameState.getAllPlayers();
    return {
      gameId: this.gameState.gameId,
      round: this.gameState.round,
      alivePlayers: allPlayers
        .filter((p) => p.status === PlayerStatus.ALIVE)
        .map((p) => ({ id: p.id, name: p.name, shielded: p.shielded })),
      eliminatedPlayers: allPlayers
        .filter((p) => p.status === PlayerStatus.ELIMINATED)
        .map((p) => ({ id: p.id, name: p.name })),
      transcript: [...this.transcript],
    };
  }

  /** Signal the game to stop at the next phase boundary. */
  abort(): void {
    this._aborted = true;
  }

  private emitStream(event: GameStreamEvent): void {
    try {
      this._streamListener?.(event);
    } catch (err) {
      console.warn(`[game-runner] stream listener error on event="${event.type}":`, err instanceof Error ? err.message : err);
    }
  }

  private emitPhaseChange(phase: Phase): void {
    const alivePlayers = this.gameState.getAlivePlayers().map((p) => ({ id: p.id, name: p.name }));
    this.emitStream({ type: "phase_change", phase, round: this.gameState.round, alivePlayers });
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async run(): Promise<{ winner?: UUID; winnerName?: string; rounds: number; transcript: TranscriptEntry[]; eliminationOrder: string[] }> {
    const gameId = this.gameState.gameId;
    const allPlayers = this.gameState.getAllPlayers().map((p) => ({ id: p.id, name: p.name }));

    // Notify all agents of game start
    for (const agent of this.agents.values()) {
      agent.onGameStart(gameId, allPlayers);
    }

    const actor = createActor(this.machine, {
      input: {
        gameId,
        playerIds: allPlayers.map((p) => p.id),
        maxRounds: this.config.maxRounds,
      },
    });

    // Collect emitted events
    const emittedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    actor.on("PHASE_STARTED", (event) => emittedEvents.push(event as unknown as { type: string; [key: string]: unknown }));
    actor.on("GAME_OVER", (event) => emittedEvents.push(event as unknown as { type: string; [key: string]: unknown }));

    actor.start();

    // Run the game loop by advancing through phases
    await this.runGameLoop(actor);

    actor.stop();
    this.bus.complete();

    const winner = this.gameState.getWinner();
    this.emitStream({
      type: "game_over",
      winner: winner?.id,
      winnerName: winner?.name,
      totalRounds: this.gameState.round,
    });
    return {
      winner: winner?.id,
      winnerName: winner?.name,
      rounds: this.gameState.round,
      transcript: this.transcript,
      eliminationOrder: [...this.eliminationOrder],
    };
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  private async runGameLoop(actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>): Promise<void> {
    let done = false;

    // Subscribe to actor completion
    const completionPromise = new Promise<void>((resolve) => {
      actor.subscribe((snapshot) => {
        if (snapshot.status === "done") {
          done = true;
          resolve();
        }
      });
    });

    // Drive phases
    await this.runPhase(Phase.INIT, actor);

    while (!done && !this._aborted) {
      const snapshot = actor.getSnapshot();
      const state = snapshot.value as string;

      // --- Normal round phases ---
      if (state === "introduction") {
        await this.runIntroductionPhase(actor);
        // Diary room: intro only (round 1 — agents introduce strategy to audience)
        await this.runDiaryRoom(Phase.INTRODUCTION);
      } else if (state === "lobby") {
        await this.runLobbyPhase(actor);
        // Revealable thinking replaces diary room after lobby
        await this.collectThinking(Phase.LOBBY);
      } else if (state === "whisper") {
        await this.runWhisperPhase(actor);
        // Revealable thinking after whisper
        await this.collectThinking(Phase.WHISPER);
      } else if (state === "rumor") {
        await this.runRumorPhase(actor);
        // Revealable thinking after rumor
        await this.collectThinking(Phase.RUMOR);
      } else if (state === "vote") {
        await this.runVotePhase(actor);
        // Revealable thinking after vote (before vote is the plan, but post-vote thinking is more natural)
        await this.collectThinking(Phase.VOTE);
      } else if (state === "power") {
        await this.runPowerPhase(actor);
      } else if (state === "reveal") {
        await this.runRevealPhase(actor);
      } else if (state === "council") {
        await this.runCouncilPhase(actor);
        // Brief exit thought for eliminated agent (handled inside council phase)

      // --- THE RECKONING (4 -> 3) ---
      } else if (state === "reckoning_lobby") {
        await this.runReckoningLobby(actor);
        await this.collectThinking(Phase.LOBBY);
      } else if (state === "reckoning_whisper") {
        await this.runReckoningWhisper(actor);
        await this.collectThinking(Phase.WHISPER);
      } else if (state === "reckoning_plea") {
        await this.runReckoningPlea(actor);
        await this.collectThinking(Phase.PLEA);
      } else if (state === "reckoning_vote") {
        await this.runReckoningVote(actor);

      // --- THE TRIBUNAL (3 -> 2) ---
      } else if (state === "tribunal_lobby") {
        await this.runTribunalLobby(actor);
        await this.collectThinking(Phase.LOBBY);
      } else if (state === "tribunal_accusation") {
        await this.runTribunalAccusation(actor);
        await this.collectThinking(Phase.ACCUSATION);
      } else if (state === "tribunal_defense") {
        await this.runTribunalDefense(actor);
        await this.collectThinking(Phase.DEFENSE);
      } else if (state === "tribunal_vote") {
        await this.runTribunalVote(actor);

      // --- THE JUDGMENT (2 finalists) ---
      } else if (state === "judgment_opening") {
        await this.runJudgmentOpening(actor);
        // Diary room for final 2 — agents make their case to the audience
        await this.runDiaryRoom(Phase.OPENING_STATEMENTS);
      } else if (state === "judgment_jury_questions") {
        await this.runJudgmentJuryQuestions(actor);
        await this.collectThinking(Phase.JURY_QUESTIONS);
      } else if (state === "judgment_closing") {
        await this.runJudgmentClosing(actor);
      } else if (state === "judgment_jury_vote") {
        await this.runJudgmentJuryVote(actor);

      } else if (state === "checkGameOver") {
        // Handled by the machine automatically (always transitions)
        await new Promise((r) => setTimeout(r, 10));
      } else if (state === "end" || done) {
        break;
      } else {
        // Unknown state, break to prevent infinite loop
        break;
      }

      // Small yield to allow state machine to settle
      await new Promise((r) => setTimeout(r, 0));
    }

    await completionPromise;
  }

  private async runPhase(
    _phase: Phase,
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // Normal round phase implementations
  // ---------------------------------------------------------------------------

  private async runIntroductionPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.INTRODUCTION);
    this.logSystem("=== INTRODUCTION PHASE ===", Phase.INTRODUCTION);
    const alivePlayers = this.gameState.getAlivePlayers();
    const aliveInfos = alivePlayers.map((p) => ({ id: p.id, name: p.name }));

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.INTRODUCTION);
        const text = await agent.getIntroduction(ctx);
        this.logPublic(player.id, text, Phase.INTRODUCTION);
      }),
    );

    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: aliveInfos.map((p) => p.id) });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  /**
   * Compute messages per player for lobby phase.
   * Scaling: fewer players = more messages per player (more intimate discussion).
   * 4-5 players → 4, 6-7 → 3, 8+ → 2.
   */
  private computeLobbyMessagesPerPlayer(aliveCount: number): number {
    if (this.config.lobbyMessagesPerPlayer != null) return this.config.lobbyMessagesPerPlayer;
    if (aliveCount <= 5) return 4;
    if (aliveCount <= 7) return 3;
    return 2;
  }

  private async runLobbyPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.startRound();
    this.gameState.expireShields();
    const round = this.gameState.round;
    this.emitPhaseChange(Phase.LOBBY);
    this.logSystem(`=== ROUND ${round}: LOBBY PHASE ===`, Phase.LOBBY);

    const alivePlayers = this.gameState.getAlivePlayers();
    const messagesPerPlayer = this.computeLobbyMessagesPerPlayer(alivePlayers.length);

    // Pre-lobby: each agent formulates a lobby intent (what to subtly communicate)
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        if (agent.getLobbyIntent) {
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          await agent.getLobbyIntent(ctx);
        }
      }),
    );

    // Run multiple sub-rounds so players can react to each other's messages.
    // Each sub-round collects one message from all players in parallel,
    // then subsequent sub-rounds see the accumulated messages via buildPhaseContext.
    for (let sub = 0; sub < messagesPerPlayer; sub++) {
      await Promise.all(
        alivePlayers.map(async (player) => {
          const agent = this.agents.get(player.id)!;
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          ctx.lobbySubRound = sub;
          ctx.lobbyTotalSubRounds = messagesPerPlayer;
          const text = await agent.getLobbyMessage(ctx);
          this.logPublic(player.id, text, Phase.LOBBY);
        }),
      );
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  /**
   * Compute the number of whisper rooms for the current round.
   * Formula: max(1, floor(alivePlayers / 2) - 1)
   */
  private computeRoomCount(aliveCount: number): number {
    return Math.max(1, Math.floor(aliveCount / 2) - 1);
  }

  /**
   * Allocate rooms based on player preferences using mutual-match-first logic.
   * Returns paired rooms and excluded player IDs.
   */
  private allocateRooms(
    requests: Map<UUID, UUID>, // player -> preferred partner
    alivePlayers: Array<{ id: UUID; name: string }>,
    roomCount: number,
  ): { rooms: RoomAllocation[]; excluded: UUID[] } {
    const rooms: RoomAllocation[] = [];
    const paired = new Set<UUID>();
    const round = this.gameState.round;

    // Step 1: Mutual matches first
    for (const [playerId, partnerId] of requests) {
      if (paired.has(playerId) || paired.has(partnerId)) continue;
      if (rooms.length >= roomCount) break;
      // Check if partner also requested this player
      if (requests.get(partnerId) === playerId) {
        rooms.push({
          roomId: rooms.length + 1,
          playerA: playerId,
          playerB: partnerId,
          round,
        });
        paired.add(playerId);
        paired.add(partnerId);
      }
    }

    // Step 2: Remaining requests by order
    for (const [playerId, partnerId] of requests) {
      if (rooms.length >= roomCount) break;
      if (paired.has(playerId)) continue;
      if (paired.has(partnerId)) continue;
      // Partner is available — pair them
      rooms.push({
        roomId: rooms.length + 1,
        playerA: playerId,
        playerB: partnerId,
        round,
      });
      paired.add(playerId);
      paired.add(partnerId);
    }

    // Excluded: all alive players not in a room
    const excluded = alivePlayers
      .filter((p) => !paired.has(p.id))
      .map((p) => p.id);

    return { rooms, excluded };
  }

  /**
   * Run a turn-based conversation in a single whisper room.
   * Agents alternate sending messages (capped by maxWhisperExchanges config, default 2 per agent).
   * Room ends when both agents pass consecutively or both hit the limit.
   */
  private async runRoomConversation(room: RoomAllocation, roomCount: number): Promise<void> {
    const MAX_MESSAGES_PER_AGENT = this.config.maxWhisperExchanges ?? 2;
    const nameA = this.gameState.getPlayerName(room.playerA);
    const nameB = this.gameState.getPlayerName(room.playerB);

    const conversationHistory: Array<{ from: string; text: string }> = [];
    const msgCount = new Map<UUID, number>([[room.playerA, 0], [room.playerB, 0]]);
    let consecutivePasses = 0;

    // Alternate turns: playerA goes first
    let currentPlayerId: UUID = room.playerA;

    while (consecutivePasses < 2) {
      const partnerId = currentPlayerId === room.playerA ? room.playerB : room.playerA;
      const partnerName = currentPlayerId === room.playerA ? nameB : nameA;
      const currentName = currentPlayerId === room.playerA ? nameA : nameB;

      // Auto-pass if this agent hit their message limit
      if ((msgCount.get(currentPlayerId) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
        consecutivePasses++;
        currentPlayerId = partnerId;
        continue;
      }

      const agent = this.agents.get(currentPlayerId)!;
      const ctx = this.buildPhaseContext(currentPlayerId, Phase.WHISPER, undefined, undefined, {
        roomCount,
        roomPartner: partnerName,
      });

      const text = await agent.sendRoomMessage(ctx, partnerName, conversationHistory);

      if (text === null || text === "") {
        consecutivePasses++;
      } else {
        consecutivePasses = 0;
        msgCount.set(currentPlayerId, (msgCount.get(currentPlayerId) ?? 0) + 1);

        // Deliver to partner's whisper inbox
        const inbox = this.whisperInbox.get(partnerId) ?? [];
        inbox.push({ from: currentName, text });
        this.whisperInbox.set(partnerId, inbox);

        conversationHistory.push({ from: currentName, text });
        this.logWhisper(currentPlayerId, [partnerId], text, room.roomId);
      }

      // Check if both agents have exhausted their messages
      if ((msgCount.get(room.playerA) ?? 0) >= MAX_MESSAGES_PER_AGENT &&
          (msgCount.get(room.playerB) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
        break;
      }

      // Switch turns
      currentPlayerId = partnerId;
    }
  }

  private async runWhisperPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.WHISPER);
    this.logSystem("=== WHISPER PHASE ===", Phase.WHISPER);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Clear whisper inboxes and room state
    this.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
    this.currentRoomAllocations = [];
    this.currentExcludedPlayerIds = [];

    const maxPairsPerAgent = this.config.maxWhisperPairsPerAgent ?? 2;
    const sessionsPerRound = this.config.whisperSessionsPerRound ?? 2;

    // Track how many conversations each agent has had this round
    const conversationCount = new Map<UUID, number>(alivePlayers.map((p) => [p.id, 0]));
    const allRooms: RoomAllocation[] = [];
    const allExcluded = new Set<UUID>();
    let globalRoomId = 0;

    // Run multiple whisper sessions per round
    for (let session = 0; session < sessionsPerRound; session++) {
      // Eligible agents: alive and haven't hit their pair limit
      const eligible = alivePlayers.filter(
        (p) => (conversationCount.get(p.id) ?? 0) < maxPairsPerAgent,
      );
      if (eligible.length < 2) break;

      const roomCount = this.computeRoomCount(eligible.length);

      // Each eligible agent submits a preferred room partner
      const requests = new Map<UUID, UUID>();
      await Promise.all(
        eligible.map(async (player) => {
          const agent = this.agents.get(player.id)!;
          const ctx = this.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
          const partnerId = await agent.requestRoom(ctx);
          // Only accept if partner is also eligible
          if (partnerId && eligible.some((p) => p.id === partnerId)) {
            requests.set(player.id, partnerId);
          }
        }),
      );

      // Allocate rooms for this session
      const { rooms, excluded } = this.allocateRooms(requests, eligible, roomCount);

      // Re-number rooms globally across sessions
      const sessionRooms = rooms.map((r) => {
        globalRoomId++;
        return { ...r, roomId: globalRoomId };
      });

      // Track conversation counts
      for (const room of sessionRooms) {
        conversationCount.set(room.playerA, (conversationCount.get(room.playerA) ?? 0) + 1);
        conversationCount.set(room.playerB, (conversationCount.get(room.playerB) ?? 0) + 1);
      }

      allRooms.push(...sessionRooms);
      for (const id of excluded) allExcluded.add(id);

      // Log room assignments for this session
      const roomDescriptions = sessionRooms.map((r) => {
        const nameA = this.gameState.getPlayerName(r.playerA);
        const nameB = this.gameState.getPlayerName(r.playerB);
        return `Room ${r.roomId}: ${nameA} & ${nameB}`;
      });
      const excludedNames = excluded.map((id) => this.gameState.getPlayerName(id));
      const sessionLabel = sessionsPerRound > 1 ? ` (session ${session + 1})` : "";
      const allocationText = roomDescriptions.join(" | ") +
        (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "") +
        sessionLabel;
      this.logRoomAllocation(allocationText, sessionRooms, excludedNames);

      // Run conversations in parallel within this session
      await Promise.all(sessionRooms.map((room) => this.runRoomConversation(room, roomCount)));
    }

    // Store cumulative room allocations for context building
    this.currentRoomAllocations = allRooms;
    this.currentExcludedPlayerIds = [...allExcluded];
    this.gameState.recordRoomAllocations(allRooms, [...allExcluded]);

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runRumorPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.RUMOR);
    this.logSystem("=== RUMOR PHASE ===", Phase.RUMOR);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Collect all rumors in parallel
    const rumors = await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.RUMOR);
        const text = await agent.getRumorMessage(ctx);
        return { playerId: player.id, text };
      }),
    );

    // Shuffle display order (Fisher-Yates)
    const shuffled = [...rumors];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // Log rumors with anonymous metadata in shuffled order
    for (let i = 0; i < shuffled.length; i++) {
      const rumor = shuffled[i]!;
      this.logPublic(rumor.playerId, rumor.text, Phase.RUMOR, {
        anonymous: true,
        displayOrder: i + 1,
      });
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runVotePhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.VOTE);
    this.logSystem("=== VOTE PHASE ===", Phase.VOTE);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Collect votes and last messages
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.VOTE);

        const [votes, lastMsg] = await Promise.all([
          agent.getVotes(ctx),
          agent.getLastMessage(ctx),
        ]);

        this.gameState.recordVote(player.id, votes.empowerTarget, votes.exposeTarget);
        this.gameState.recordLastMessage(player.id, lastMsg);

        const empowerName = this.gameState.getPlayerName(votes.empowerTarget);
        const exposeName = this.gameState.getPlayerName(votes.exposeTarget);
        this.logSystem(
          `${player.name} votes: empower=${empowerName}, expose=${exposeName}`,
          Phase.VOTE,
        );
      }),
    );

    const { empowered: initialEmpowered, tied } = this.gameState.tallyEmpowerVotes();
    let empoweredId = initialEmpowered;

    if (tied) {
      // Empower tie — re-vote among tied candidates only
      const tiedNames = tied.map((id) => this.gameState.getPlayerName(id)).join(", ");
      this.logSystem(`Empower TIED between: ${tiedNames}. Re-vote!`, Phase.VOTE);

      // Non-tied players re-vote among tied candidates
      const reVoters = alivePlayers.filter((p) => !tied.includes(p.id));
      // Clear stale empower votes from re-voters so original votes don't
      // leak into the re-tally if a re-voter votes for a non-tied candidate
      for (const rv of reVoters) {
        this.gameState.clearEmpowerVote(rv.id);
      }
      if (reVoters.length > 0) {
        await Promise.all(
          reVoters.map(async (player) => {
            const agent = this.agents.get(player.id)!;
            const ctx = this.buildPhaseContext(player.id, Phase.VOTE);
            const votes = await agent.getVotes(ctx);
            // Only count if they voted for a tied candidate
            if (tied.includes(votes.empowerTarget)) {
              this.gameState.recordEmpowerReVote(player.id, votes.empowerTarget);
              const empowerName = this.gameState.getPlayerName(votes.empowerTarget);
              this.logSystem(`${player.name} re-votes: empower=${empowerName}`, Phase.VOTE);
            }
          }),
        );
      }

      // Re-tally among tied candidates only
      const reVoteCounts: Record<UUID, number> = {};
      for (const id of tied) reVoteCounts[id] = 0;
      for (const voter of reVoters) {
        const target = this.gameState.currentVoteTally.empowerVotes[voter.id];
        if (target && target in reVoteCounts) {
          reVoteCounts[target] = (reVoteCounts[target] ?? 0) + 1;
        }
      }

      const maxReVotes = Math.max(...Object.values(reVoteCounts), 0);
      const reVoteTied = tied.filter((id) => reVoteCounts[id] === maxReVotes);

      if (reVoteTied.length === 1) {
        empoweredId = reVoteTied[0]!;
        this.logSystem(`Re-vote resolved: ${this.gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
      } else {
        // Still tied — "the wheel" (random among tied)
        empoweredId = reVoteTied[Math.floor(Math.random() * reVoteTied.length)]!;
        this.logSystem(`Re-vote still tied! THE WHEEL decides: ${this.gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
      }
      this.gameState.setEmpowered(empoweredId);
    }

    this.logSystem(
      `Empowered: ${this.gameState.getPlayerName(empoweredId)}`,
      Phase.VOTE,
    );

    // Update agent memory based on votes
    const voteTally = this.gameState.currentVoteTally;
    for (const [voterId, empowerTargetId] of Object.entries(voteTally.empowerVotes)) {
      const agent = this.agents.get(voterId as UUID);
      if (agent) {
        const empowerName = this.gameState.getPlayerName(empowerTargetId);
        agent.updateAlly(empowerName);
      }
    }
    for (const [voterId, exposeTargetId] of Object.entries(voteTally.exposeVotes)) {
      const agent = this.agents.get(voterId as UUID);
      if (agent) {
        const exposeName = this.gameState.getPlayerName(exposeTargetId);
        agent.updateThreat(exposeName);
      }
    }

    actor.send({ type: "VOTES_TALLIED", empoweredId });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runPowerPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.POWER);
    const empoweredId = this.gameState.empoweredId;
    if (!empoweredId) {
      actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated: null });
      actor.send({ type: "PHASE_COMPLETE" });
      return;
    }

    this.logSystem(
      `=== POWER PHASE === (${this.gameState.getPlayerName(empoweredId)} is empowered)`,
      Phase.POWER,
    );

    // Determine preliminary candidates so empowered agent can make an informed choice
    const scores = this.gameState.getExposeScores();
    const aliveIds = this.gameState.getAlivePlayerIds();
    const sorted = [...aliveIds].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
    const sorted0 = sorted[0];
    const sorted1 = sorted[1];
    if (!sorted0) throw new Error("No players to sort for power phase preliminary candidates");
    const prelim: [UUID, UUID] = [sorted0, sorted1 ?? sorted0];

    const empoweredAgent = this.agents.get(empoweredId)!;
    const ctx = this.buildPhaseContext(empoweredId, Phase.POWER, { empoweredId, councilCandidates: prelim });
    const powerAction = await empoweredAgent.getPowerAction(ctx, prelim);

    this.gameState.setPowerAction(powerAction);
    this.logSystem(
      `${this.gameState.getPlayerName(empoweredId)} power action: ${powerAction.action} -> ${this.gameState.getPlayerName(powerAction.target)}`,
      Phase.POWER,
    );

    // Update empowered agent's memory based on power action
    if (powerAction.action === "protect") {
      empoweredAgent.updateAlly(this.gameState.getPlayerName(powerAction.target));
    } else if (powerAction.action === "eliminate") {
      empoweredAgent.updateThreat(this.gameState.getPlayerName(powerAction.target));
    }

    const { candidates, autoEliminated, shieldGranted } =
      this.gameState.determineCandidates();

    if (shieldGranted) {
      this.logSystem(
        `${this.gameState.getPlayerName(shieldGranted)} is protected (shield granted)`,
        Phase.POWER,
      );
    }

    if (autoEliminated) {
      const eliminatedName = this.gameState.getPlayerName(autoEliminated);
      this.logSystem(
        `AUTO-ELIMINATE: ${eliminatedName}`,
        Phase.POWER,
      );
      this.lastEliminatedName = eliminatedName;
      this.eliminationOrder.push(eliminatedName);
      const eliminated = this.gameState.getPlayer(autoEliminated)!;
      const lastMsg = eliminated.lastMessage ?? "(no final words)";
      this.logPublic(autoEliminated, lastMsg, Phase.POWER);
      this.gameState.eliminatePlayer(autoEliminated);
      this.emitStream({ type: "player_eliminated", playerId: autoEliminated, playerName: eliminatedName, round: this.gameState.round });

      // Remove eliminated player from all agents' memory
      for (const agent of this.agents.values()) {
        agent.removeFromMemory?.(eliminatedName);
      }

      actor.send({ type: "CANDIDATES_DETERMINED", candidates: null, autoEliminated });
      actor.send({ type: "PLAYER_ELIMINATED", playerId: autoEliminated });
      actor.send({
        type: "UPDATE_ALIVE_PLAYERS",
        aliveIds: this.gameState.getAlivePlayerIds(),
      });
    } else if (candidates) {
      actor.send({ type: "CANDIDATES_DETERMINED", candidates, autoEliminated: null });
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runRevealPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    const candidates = this.gameState.councilCandidates;
    if (!candidates) {
      actor.send({ type: "PHASE_COMPLETE" });
      return;
    }

    const [c1, c2] = candidates;
    this.logSystem(
      `=== REVEAL PHASE === Council candidates: ${this.gameState.getPlayerName(c1)} vs ${this.gameState.getPlayerName(c2)}`,
      Phase.REVEAL,
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runCouncilPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    const candidates = this.gameState.councilCandidates;
    const empoweredId = this.gameState.empoweredId;

    if (!candidates || !empoweredId) {
      actor.send({ type: "PHASE_COMPLETE" });
      return;
    }

    this.emitPhaseChange(Phase.COUNCIL);
    this.logSystem("=== COUNCIL PHASE ===", Phase.COUNCIL);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Non-candidate, non-empowered players vote normally.
    // Candidates cannot vote in their own elimination.
    // Empowered agent votes separately as tiebreaker only.
    const voters = alivePlayers.filter(
      (p) => p.id !== candidates[0] && p.id !== candidates[1],
    );
    await Promise.all(
      voters.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.COUNCIL, {
          empoweredId,
          councilCandidates: candidates,
        });
        const vote = await agent.getCouncilVote(ctx, candidates);
        this.gameState.recordCouncilVote(player.id, vote);

        // Record council vote in voter's memory
        const votedAgainstName = this.gameState.getPlayerName(vote);
        agent.addNote(votedAgainstName, `Voted against in council R${this.gameState.round}`);

        this.logSystem(
          `${player.name} council vote -> ${votedAgainstName}`,
          Phase.COUNCIL,
        );
      }),
    );

    const eliminatedId = this.gameState.tallyCouncilVotes(empoweredId);
    const eliminated = this.gameState.getPlayer(eliminatedId)!;
    const lastMsg = eliminated.lastMessage ?? "(no final words)";

    this.logSystem(
      `ELIMINATED: ${eliminated.name}`,
      Phase.COUNCIL,
    );
    this.lastEliminatedName = eliminated.name;
    this.eliminationOrder.push(eliminated.name);
    this.logPublic(eliminatedId, lastMsg, Phase.COUNCIL);

    this.gameState.eliminatePlayer(eliminatedId);
    this.emitStream({ type: "player_eliminated", playerId: eliminatedId, playerName: eliminated.name, round: this.gameState.round });

    // Remove eliminated player from all agents' memory
    for (const agent of this.agents.values()) {
      agent.removeFromMemory?.(eliminated.name);
    }

    actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
    actor.send({
      type: "UPDATE_ALIVE_PLAYERS",
      aliveIds: this.gameState.getAlivePlayerIds(),
    });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // THE RECKONING (4 -> 3 players)
  // ---------------------------------------------------------------------------

  private async runReckoningLobby(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.startRound();
    this.gameState.setEndgameStage("reckoning");
    const round = this.gameState.round;
    this.emitPhaseChange(Phase.LOBBY);
    this.logSystem(`\n========================================`, Phase.LOBBY);
    this.logSystem(`=== THE RECKONING (Round ${round}) ===`, Phase.LOBBY);
    this.logSystem(`========================================`, Phase.LOBBY);
    this.logSystem(`${this.gameState.describeState()}`, Phase.LOBBY);

    const alivePlayers = this.gameState.getAlivePlayers();
    const messagesPerPlayer = this.computeLobbyMessagesPerPlayer(alivePlayers.length);

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        if (agent.getLobbyIntent) {
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          await agent.getLobbyIntent(ctx);
        }
      }),
    );

    for (let sub = 0; sub < messagesPerPlayer; sub++) {
      await Promise.all(
        alivePlayers.map(async (player) => {
          const agent = this.agents.get(player.id)!;
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          ctx.lobbySubRound = sub;
          ctx.lobbyTotalSubRounds = messagesPerPlayer;
          const text = await agent.getLobbyMessage(ctx);
          this.logPublic(player.id, text, Phase.LOBBY);
        }),
      );
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runReckoningWhisper(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.WHISPER);
    this.logSystem("=== RECKONING: WHISPER PHASE ===", Phase.WHISPER);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Use room system for reckoning whisper (4 players → 1 room, 2 excluded)
    this.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
    this.currentRoomAllocations = [];
    this.currentExcludedPlayerIds = [];

    const roomCount = this.computeRoomCount(alivePlayers.length);

    // Sub-Step 1: Room Request
    const requests = new Map<UUID, UUID>();
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
        const partnerId = await agent.requestRoom(ctx);
        if (partnerId) {
          requests.set(player.id, partnerId);
        }
      }),
    );

    // Sub-Step 2: Room Allocation
    const { rooms, excluded } = this.allocateRooms(requests, alivePlayers, roomCount);
    this.currentRoomAllocations = rooms;
    this.currentExcludedPlayerIds = excluded;
    this.gameState.recordRoomAllocations(rooms, excluded);

    const roomDescriptions = rooms.map((r) => {
      const nameA = this.gameState.getPlayerName(r.playerA);
      const nameB = this.gameState.getPlayerName(r.playerB);
      return `Room ${r.roomId}: ${nameA} & ${nameB}`;
    });
    const excludedNames = excluded.map((id) => this.gameState.getPlayerName(id));
    const allocationText = roomDescriptions.join(" | ") +
      (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "");
    this.logRoomAllocation(allocationText, rooms, excludedNames);

    // Sub-Step 3: Room Conversation — rooms are independent, run in parallel
    await Promise.all(rooms.map((room) => this.runRoomConversation(room, roomCount)));

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runReckoningPlea(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.PLEA);
    this.logSystem("=== RECKONING: PLEA PHASE ===", Phase.PLEA);
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.PLEA);
        const text = await agent.getPlea(ctx);
        this.logPublic(player.id, text, Phase.PLEA);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runReckoningVote(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.VOTE);
    this.logSystem("=== RECKONING: ELIMINATION VOTE ===", Phase.VOTE);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Collect last messages and votes
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.VOTE);
        const [vote, lastMsg] = await Promise.all([
          agent.getEndgameEliminationVote(ctx),
          agent.getLastMessage(ctx),
        ]);
        this.gameState.recordEndgameEliminationVote(player.id, vote);
        this.gameState.recordLastMessage(player.id, lastMsg);
        this.logSystem(
          `${player.name} votes to eliminate: ${this.gameState.getPlayerName(vote)}`,
          Phase.VOTE,
        );
      }),
    );

    const eliminatedId = this.gameState.tallyEndgameEliminationVotes();
    const eliminated = this.gameState.getPlayer(eliminatedId)!;
    const lastMsg = eliminated.lastMessage ?? "(no final words)";

    this.logSystem(`ELIMINATED: ${eliminated.name}`, Phase.VOTE);
    this.lastEliminatedName = eliminated.name;
    this.eliminationOrder.push(eliminated.name);
    this.logPublic(eliminatedId, lastMsg, Phase.VOTE);
    this.gameState.eliminatePlayer(eliminatedId);
    this.emitStream({ type: "player_eliminated", playerId: eliminatedId, playerName: eliminated.name, round: this.gameState.round });

    for (const agent of this.agents.values()) {
      agent.removeFromMemory?.(eliminated.name);
    }

    actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: this.gameState.getAlivePlayerIds() });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // THE TRIBUNAL (3 -> 2 players)
  // ---------------------------------------------------------------------------

  private async runTribunalLobby(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.startRound();
    this.gameState.setEndgameStage("tribunal");
    const round = this.gameState.round;
    this.emitPhaseChange(Phase.LOBBY);
    this.logSystem(`\n========================================`, Phase.LOBBY);
    this.logSystem(`=== THE TRIBUNAL (Round ${round}) ===`, Phase.LOBBY);
    this.logSystem(`========================================`, Phase.LOBBY);
    this.logSystem(`${this.gameState.describeState()}`, Phase.LOBBY);

    const alivePlayers = this.gameState.getAlivePlayers();
    const messagesPerPlayer = this.computeLobbyMessagesPerPlayer(alivePlayers.length);

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        if (agent.getLobbyIntent) {
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          await agent.getLobbyIntent(ctx);
        }
      }),
    );

    for (let sub = 0; sub < messagesPerPlayer; sub++) {
      await Promise.all(
        alivePlayers.map(async (player) => {
          const agent = this.agents.get(player.id)!;
          const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
          ctx.lobbySubRound = sub;
          ctx.lobbyTotalSubRounds = messagesPerPlayer;
          const text = await agent.getLobbyMessage(ctx);
          this.logPublic(player.id, text, Phase.LOBBY);
        }),
      );
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  /** Accusations stored for the defense phase */
  private _currentAccusations = new Map<UUID, { accuserId: UUID; accuserName: string; text: string }>();

  private async runTribunalAccusation(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.ACCUSATION);
    this.logSystem("=== TRIBUNAL: ACCUSATION PHASE ===", Phase.ACCUSATION);
    const alivePlayers = this.gameState.getAlivePlayers();
    this._currentAccusations.clear();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.ACCUSATION);
        const { targetId, text } = await agent.getAccusation(ctx);
        const targetName = this.gameState.getPlayerName(targetId);
        this.logPublic(player.id, `[ACCUSES ${targetName}] ${text}`, Phase.ACCUSATION);
        this._currentAccusations.set(targetId, {
          accuserId: player.id,
          accuserName: player.name,
          text,
        });
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runTribunalDefense(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.DEFENSE);
    this.logSystem("=== TRIBUNAL: DEFENSE PHASE ===", Phase.DEFENSE);
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const accusation = this._currentAccusations.get(player.id);
        if (!accusation) return; // Not accused

        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.DEFENSE);
        const defense = await agent.getDefense(ctx, accusation.text, accusation.accuserName);
        this.logPublic(player.id, `[DEFENSE] ${defense}`, Phase.DEFENSE);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runTribunalVote(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.VOTE);
    this.logSystem("=== TRIBUNAL: ELIMINATION VOTE ===", Phase.VOTE);
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.VOTE);
        const [vote, lastMsg] = await Promise.all([
          agent.getEndgameEliminationVote(ctx),
          agent.getLastMessage(ctx),
        ]);
        this.gameState.recordEndgameEliminationVote(player.id, vote);
        this.gameState.recordLastMessage(player.id, lastMsg);
        this.logSystem(
          `${player.name} votes to eliminate: ${this.gameState.getPlayerName(vote)}`,
          Phase.VOTE,
        );
      }),
    );

    // For Tribunal, jury can break ties
    let juryTiebreakerVotes: Record<UUID, UUID> | undefined;
    // Check if we need a tiebreaker before tallying
    // We'll let tallyTribunalVotes handle it; collect jury votes preemptively
    const tribunalJury = this.getActiveJury();
    if (tribunalJury.length > 0) {
      juryTiebreakerVotes = {};
      for (const juror of tribunalJury) {
        const jurorAgent = this.agents.get(juror.playerId);
        if (jurorAgent) {
          const ctx = this.buildPhaseContext(juror.playerId, Phase.VOTE);
          const vote = await jurorAgent.getEndgameEliminationVote(ctx);
          juryTiebreakerVotes[juror.playerId] = vote;
        }
      }
    }

    const eliminatedId = this.gameState.tallyTribunalVotes(juryTiebreakerVotes);
    const eliminated = this.gameState.getPlayer(eliminatedId)!;
    const lastMsg = eliminated.lastMessage ?? "(no final words)";

    this.logSystem(`ELIMINATED: ${eliminated.name}`, Phase.VOTE);
    this.lastEliminatedName = eliminated.name;
    this.eliminationOrder.push(eliminated.name);
    this.logPublic(eliminatedId, lastMsg, Phase.VOTE);
    this.gameState.eliminatePlayer(eliminatedId);
    this.emitStream({ type: "player_eliminated", playerId: eliminatedId, playerName: eliminated.name, round: this.gameState.round });

    for (const agent of this.agents.values()) {
      agent.removeFromMemory?.(eliminated.name);
    }

    actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
    actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: this.gameState.getAlivePlayerIds() });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // THE JUDGMENT (2 finalists -- Jury Finale)
  // ---------------------------------------------------------------------------

  private async runJudgmentOpening(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.setEndgameStage("judgment");
    this.emitPhaseChange(Phase.OPENING_STATEMENTS);
    this.logSystem(`\n========================================`, Phase.OPENING_STATEMENTS);
    this.logSystem(`=== THE JUDGMENT ===`, Phase.OPENING_STATEMENTS);
    this.logSystem(`========================================`, Phase.OPENING_STATEMENTS);
    this.logSystem(`Finalists: ${this.gameState.getAlivePlayers().map((p) => p.name).join(" vs ")}`, Phase.OPENING_STATEMENTS);
    const activeJury = this.getActiveJury();
    const excludedJurors = this.gameState.jury.filter(
      (j) => !activeJury.some((aj) => aj.playerId === j.playerId),
    );
    this.logSystem(`Jury (${activeJury.length}): ${activeJury.map((j) => j.playerName).join(", ")}`, Phase.OPENING_STATEMENTS);
    if (excludedJurors.length > 0) {
      this.logSystem(`Eliminated too early for jury: ${excludedJurors.map((j) => j.playerName).join(", ")}`, Phase.OPENING_STATEMENTS);
    }

    this.logSystem("=== JUDGMENT: OPENING STATEMENTS ===", Phase.OPENING_STATEMENTS);
    const finalists = this.gameState.getAlivePlayers();

    await Promise.all(
      finalists.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.OPENING_STATEMENTS);
        const text = await agent.getOpeningStatement(ctx);
        this.logPublic(player.id, text, Phase.OPENING_STATEMENTS);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runJudgmentJuryQuestions(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.JURY_QUESTIONS);
    this.logSystem("=== JUDGMENT: JURY QUESTIONS ===", Phase.JURY_QUESTIONS);
    const finalists = this.gameState.getAlivePlayers();
    const finalist0 = finalists[0];
    const finalist1 = finalists[1];
    if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury questions phase");
    const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

    // Only active jury members (based on pool size) ask questions
    for (const juror of this.getActiveJury()) {
      const jurorAgent = this.agents.get(juror.playerId);
      if (!jurorAgent) continue;

      const jurorCtx = this.buildPhaseContext(juror.playerId, Phase.JURY_QUESTIONS);
      const { targetFinalistId, question } = await jurorAgent.getJuryQuestion(jurorCtx, finalistIds);
      const finalistName = this.gameState.getPlayerName(targetFinalistId);
      this.logPublic(juror.playerId, `[QUESTION to ${finalistName}] ${question}`, Phase.JURY_QUESTIONS);

      // Finalist answers
      const finalistAgent = this.agents.get(targetFinalistId);
      if (finalistAgent) {
        const finalistCtx = this.buildPhaseContext(targetFinalistId, Phase.JURY_QUESTIONS);
        const answer = await finalistAgent.getJuryAnswer(finalistCtx, question, juror.playerName);
        this.logPublic(targetFinalistId, `[ANSWER to ${juror.playerName}] ${answer}`, Phase.JURY_QUESTIONS);
      }
    }

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runJudgmentClosing(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.CLOSING_ARGUMENTS);
    this.logSystem("=== JUDGMENT: CLOSING ARGUMENTS ===", Phase.CLOSING_ARGUMENTS);
    const finalists = this.gameState.getAlivePlayers();

    await Promise.all(
      finalists.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.CLOSING_ARGUMENTS);
        const text = await agent.getClosingArgument(ctx);
        this.logPublic(player.id, text, Phase.CLOSING_ARGUMENTS);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runJudgmentJuryVote(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.emitPhaseChange(Phase.JURY_VOTE);
    this.logSystem("=== JUDGMENT: JURY VOTE ===", Phase.JURY_VOTE);
    const finalists = this.gameState.getAlivePlayers();
    const finalist0 = finalists[0];
    const finalist1 = finalists[1];
    if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury vote phase");
    const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

    // Use fixed-size jury pool (always odd)
    const votingJury = this.getActiveJury();

    for (const juror of votingJury) {
      const jurorAgent = this.agents.get(juror.playerId);
      if (!jurorAgent) continue;

      const ctx = this.buildPhaseContext(juror.playerId, Phase.JURY_VOTE);
      const vote = await jurorAgent.getJuryVote(ctx, finalistIds);
      this.gameState.recordJuryVote(juror.playerId, vote);
      this.logSystem(
        `${juror.playerName} (juror) votes for: ${this.gameState.getPlayerName(vote)}`,
        Phase.JURY_VOTE,
      );
    }

    const { winnerId, method, voteCounts } = this.gameState.tallyJuryVotes();
    const winnerName = this.gameState.getPlayerName(winnerId);

    // Log vote counts
    for (const vc of voteCounts) {
      this.logSystem(`Jury votes for ${vc.name}: ${vc.votes}`, Phase.JURY_VOTE);
    }

    // Log how the winner was determined
    if (method === "majority") {
      this.logSystem(`Winner determined by jury majority vote.`, Phase.JURY_VOTE);
    } else if (method === "empower_tiebreaker") {
      this.logSystem(`Jury vote tied! Tiebreaker: ${winnerName} wins with more cumulative empower votes (social capital).`, Phase.JURY_VOTE);
    } else {
      this.logSystem(`Jury vote tied and empower votes tied! Tiebreaker: ${winnerName} wins by random selection.`, Phase.JURY_VOTE);
    }

    this.logSystem(`\n*** THE WINNER IS: ${winnerName} ***`, Phase.JURY_VOTE);

    // Eliminate the loser so getWinner() works
    const loserId = finalistIds.find((id) => id !== winnerId);
    if (loserId) {
      this.gameState.eliminatePlayer(loserId);
    }

    actor.send({ type: "JURY_WINNER_DETERMINED", winnerId });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // Revealable Thinking — agents emit hidden internal monologue during phases
  // ---------------------------------------------------------------------------

  /**
   * Collect thinking events from all alive agents for a given phase.
   * Thinking is a brief internal monologue (1-3 sentences) that replaces most diary rooms.
   * Hidden by default — viewers can reveal on-demand.
   * Also triggers strategic reflections to maintain strategic continuity.
   */
  private async collectThinking(phase: Phase): Promise<void> {
    const alivePlayers = this.gameState.getAlivePlayers();

    // Collect thinking events in parallel
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        if (!agent.getThinking) return;
        try {
          const ctx = this.buildPhaseContext(player.id, phase);
          const text = await agent.getThinking(ctx);
          if (text && text !== "[No response]") {
            this.logThinking(player.id, text, phase);
            this.thinkingEntries.push({
              round: this.gameState.round,
              phase,
              agentId: player.id,
              agentName: player.name,
              text,
            });
          }
        } catch (error) {
          console.warn(`[Thinking] Failed for ${player.name}, skipping:`, error);
        }
      }),
    );

    // Run strategic reflections after vote phase thinking (once per round, not every phase)
    if (phase === Phase.VOTE) {
      try {
        await Promise.all(
          alivePlayers.map(async (player) => {
            const agent = this.agents.get(player.id);
            if (agent?.getStrategicReflection) {
              const ctx = this.buildPhaseContext(player.id, phase);
              await agent.getStrategicReflection(ctx);
            }
          }),
        );
      } catch (error) {
        console.error(`[Thinking] Strategic reflections failed, continuing:`, error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Diary Room — House interviews agents between phases
  // ---------------------------------------------------------------------------

  /**
   * Run a diary room session after a game phase completes.
   * The House asks each alive agent a contextual interview question,
   * and agents respond with their strategic thoughts.
   * During Judgment, jury members are also interviewed.
   */
  private async runDiaryRoom(precedingPhase: Phase): Promise<void> {
    // Skip diary room if config restricts to specific phases
    const allowedPhases = this.config.diaryRoomAfterPhases;
    if (allowedPhases && !allowedPhases.includes(precedingPhase)) {
      return;
    }

    this.logSystem(`--- Diary Room (after ${precedingPhase}) ---`, Phase.DIARY_ROOM);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Interviews are independent per-agent — run in parallel for wall-clock savings.
    // Each interview has agentId/agentName metadata for frontend grouping.
    await Promise.all(
      alivePlayers.map(async (player) => {
        try {
          await this.runDiaryInterview(precedingPhase, player.id, player.name, false);
        } catch (error) {
          console.error(`[DiaryRoom] Interview failed for ${player.name}, skipping:`, error);
        }
      }),
    );

    // After all interviews, agents produce strategic reflections in parallel
    try {
      await Promise.all(
        alivePlayers.map(async (player) => {
          const agent = this.agents.get(player.id);
          if (agent?.getStrategicReflection) {
            const ctx = this.buildPhaseContext(player.id, Phase.DIARY_ROOM);
            await agent.getStrategicReflection(ctx);
          }
        }),
      );
    } catch (error) {
      console.error(`[DiaryRoom] Strategic reflections failed, continuing:`, error);
    }

    // During Judgment phases, also interview active jury members in parallel
    if (this.gameState.endgameStage === "judgment") {
      const activeJury = this.getActiveJury();
      await Promise.all(
        activeJury.map(async (juror) => {
          const agent = this.agents.get(juror.playerId);
          if (!agent) return;
          try {
            await this.runDiaryInterview(precedingPhase, juror.playerId, juror.playerName, true);
          } catch (error) {
            console.error(`[DiaryRoom] Juror interview failed for ${juror.playerName}, skipping:`, error);
          }
        }),
      );
    }
  }

  /**
   * Run a single diary room interview session with one player.
   * The House asks 1-4 questions, probing deeper based on answers.
   * The session ends when the House decides to close or max questions are reached.
   */
  private async runDiaryInterview(
    precedingPhase: Phase,
    playerId: UUID,
    playerName: string,
    isJuror: boolean,
  ): Promise<void> {
    const maxFollowUps = this.config.maxDiaryFollowUps ?? 1;
    const MAX_QUESTIONS = 1 + maxFollowUps; // first question + follow-ups
    const agent = this.agents.get(playerId)!;
    const label = isJuror ? `${playerName} (juror)` : playerName;
    const houseLabel = isJuror ? `House -> ${playerName} (juror)` : `House -> ${playerName}`;

    const diaryContext = this.buildDiaryRoomContext(precedingPhase, playerName);
    const sessionExchanges: Array<{ question: string; answer: string }> = [];

    // First question
    const firstQuestion = await this.houseInterviewer.generateQuestion(diaryContext);
    this.logDiary(houseLabel, firstQuestion);

    const ctx = this.buildPhaseContext(playerId, Phase.DIARY_ROOM, undefined, isJuror || undefined);
    const firstAnswer = await agent.getDiaryEntry(ctx, firstQuestion, sessionExchanges);
    this.logDiary(label, firstAnswer);

    sessionExchanges.push({ question: firstQuestion, answer: firstAnswer });
    this.diaryEntries.push({
      round: this.gameState.round,
      precedingPhase,
      agentId: playerId,
      agentName: playerName,
      question: firstQuestion,
      answer: firstAnswer,
    });

    // Follow-up loop: House decides whether to probe further (up to MAX_QUESTIONS total)
    for (let i = 1; i < MAX_QUESTIONS; i++) {
      const updatedContext = this.buildDiaryRoomContext(precedingPhase, playerName);
      const result = await this.houseInterviewer.generateFollowUpOrClose(updatedContext, sessionExchanges);

      if (result.type === "close") {
        // Use "House" (not "House -> Name") so frontend doesn't treat close as a new question
        this.logDiary("House", result.message);
        break;
      }

      // Ask the follow-up question
      this.logDiary(houseLabel, result.question);

      const followUpAnswer = await agent.getDiaryEntry(ctx, result.question, sessionExchanges);
      this.logDiary(label, followUpAnswer);

      sessionExchanges.push({ question: result.question, answer: followUpAnswer });
      this.diaryEntries.push({
        round: this.gameState.round,
        precedingPhase,
        agentId: playerId,
        agentName: playerName,
        question: result.question,
        answer: followUpAnswer,
      });
    }

    // If we hit MAX_QUESTIONS without the House closing, add a closing message
    if (sessionExchanges.length >= MAX_QUESTIONS) {
      this.logDiary("House", `That's enough for now, ${playerName}. The House sees everything.`);
    }
  }

  /**
   * Build the context object passed to the House interviewer for question generation.
   */
  private buildDiaryRoomContext(precedingPhase: Phase, agentName: string): DiaryRoomContext {
    const allPlayers = this.gameState.getAllPlayers();
    const alivePlayers = this.gameState.getAlivePlayers();
    const eliminatedPlayers = allPlayers
      .filter((p) => p.status === "eliminated")
      .map((p) => p.name);
    const candidates = this.gameState.councilCandidates;
    const empoweredId = this.gameState.empoweredId;

    // This player's previous diary entries for follow-up continuity
    const previousDiaryEntries = this.diaryEntries
      .filter((d) => d.agentName === agentName)
      .map((d) => ({ round: d.round, question: d.question, answer: d.answer }));

    // What this specific player said recently in public phases
    const playerMessages = this.publicMessages
      .filter((m) => m.from === agentName)
      .slice(-5)
      .map((m) => ({ text: m.text, phase: m.phase }));

    return {
      precedingPhase,
      round: this.gameState.round,
      agentName,
      alivePlayers: alivePlayers.map((p) => p.name),
      eliminatedPlayers,
      lastEliminated: this.lastEliminatedName,
      empoweredName: empoweredId ? this.gameState.getPlayerName(empoweredId) : null,
      councilCandidates: candidates
        ? [this.gameState.getPlayerName(candidates[0]), this.gameState.getPlayerName(candidates[1])]
        : null,
      recentMessages: this.publicMessages.slice(-8),
      previousDiaryEntries,
      playerMessages,
    };
  }

  // ---------------------------------------------------------------------------
  // Context builder
  // ---------------------------------------------------------------------------

  private buildPhaseContext(
    agentId: UUID,
    phase: Phase,
    extra?: { empoweredId?: UUID; councilCandidates?: [UUID, UUID] },
    isEliminated?: boolean,
    roomInfo?: { roomCount?: number; roomPartner?: string },
  ): PhaseContext {
    const player = this.gameState.getPlayer(agentId)!;

    // Build room allocation context from current state
    const roomAllocations = this.currentRoomAllocations.length > 0
      ? this.currentRoomAllocations.map((r) => ({
          roomId: r.roomId,
          playerA: this.gameState.getPlayerName(r.playerA),
          playerB: this.gameState.getPlayerName(r.playerB),
        }))
      : undefined;
    const excludedPlayers = this.currentExcludedPlayerIds.length > 0
      ? this.currentExcludedPlayerIds.map((id) => this.gameState.getPlayerName(id))
      : undefined;

    return {
      gameId: this.gameState.gameId,
      round: this.gameState.round,
      phase,
      selfId: agentId,
      selfName: player.name,
      alivePlayers: this.gameState.getAlivePlayers().map((p) => ({ id: p.id, name: p.name })),
      publicMessages: [...this.publicMessages],
      whisperMessages: this.whisperInbox.get(agentId) ?? [],
      empoweredId: extra?.empoweredId ?? this.gameState.empoweredId ?? undefined,
      councilCandidates: extra?.councilCandidates ?? this.gameState.councilCandidates ?? undefined,
      // Room allocation context
      roomCount: roomInfo?.roomCount,
      roomAllocations,
      excludedPlayers,
      roomPartner: roomInfo?.roomPartner,
      // Endgame context
      endgameStage: this.gameState.endgameStage ?? undefined,
      jury: this.gameState.jury.length > 0 ? [...this.getActiveJury()] : undefined,
      finalists: (() => {
        const alivePlayers = this.gameState.getAlivePlayers();
        if (alivePlayers.length !== 2) return undefined;
        const f0 = alivePlayers[0];
        const f1 = alivePlayers[1];
        if (!f0 || !f1) return undefined;
        return [f0.id, f1.id] as [UUID, UUID];
      })(),
      isEliminated: isEliminated ?? false,
    };
  }

  // ---------------------------------------------------------------------------
  // Transcript helpers
  // ---------------------------------------------------------------------------

  private logPublic(
    fromId: UUID,
    text: string,
    phase: Phase,
    opts?: { anonymous?: boolean; displayOrder?: number },
  ): void {
    const name = this.gameState.getPlayerName(fromId);
    this.publicMessages.push({
      from: name,
      text,
      phase,
      ...(opts?.anonymous && { anonymous: true }),
      ...(opts?.displayOrder != null && { displayOrder: opts.displayOrder }),
    });
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "public",
      text,
      ...(opts?.anonymous && { anonymous: true }),
      ...(opts?.displayOrder != null && { displayOrder: opts.displayOrder }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private logWhisper(fromId: UUID, toIds: UUID[], text: string, roomId?: number): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.WHISPER,
      timestamp: Date.now(),
      from: fromName,
      scope: "whisper",
      to: toNames,
      text,
      ...(roomId != null && { roomId }),
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private logRoomAllocation(
    text: string,
    rooms: import("./types").RoomAllocation[],
    excludedNames: string[],
  ): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.WHISPER,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
      roomMetadata: { rooms, excluded: excludedNames },
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private logSystem(text: string, phase: Phase): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private logDiary(from: string, text: string): void {
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase: Phase.DIARY_ROOM,
      timestamp: Date.now(),
      from,
      scope: "diary",
      text,
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }

  private logThinking(fromId: UUID, text: string, phase: Phase): void {
    const name = this.gameState.getPlayerName(fromId);
    const entry: TranscriptEntry = {
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "thinking",
      text,
    };
    this.transcript.push(entry);
    this.emitStream({ type: "transcript_entry", entry });
  }
}
