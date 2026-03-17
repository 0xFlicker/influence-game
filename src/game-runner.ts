/**
 * Influence Game - Game Runner
 *
 * Orchestrates the phase machine, game state, event bus, and agents.
 * Drives the full game loop from INIT to END.
 */

import { createActor } from "xstate";
import { GameEventBus } from "./event-bus";
import { GameState, createUUID } from "./game-state";
import { createPhaseMachine } from "./phase-machine";
import type {
  UUID,
  GameConfig,
  AgentAction,
  PowerAction,
  RoundResult,
} from "./types";
import { Phase } from "./types";

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
  /** Called to collect a lobby message */
  getLobbyMessage(context: PhaseContext): Promise<string>;
  /** Called to collect whisper actions (list of {to, text}) */
  getWhispers(context: PhaseContext): Promise<Array<{ to: UUID[]; text: string }>>;
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
  /** Called for diary/strategy entries */
  getDiaryEntry(context: PhaseContext): Promise<string>;
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
  publicMessages: Array<{ from: string; text: string; phase: Phase }>;
  /** Messages this agent received as whispers */
  whisperMessages: Array<{ from: string; text: string }>;
  empoweredId?: UUID;
  councilCandidates?: [UUID, UUID];
}

// ---------------------------------------------------------------------------
// Transcript entry
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;
  scope: "public" | "whisper" | "system";
  to?: string[];
  text: string;
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
  private publicMessages: Array<{ from: string; text: string; phase: Phase }> = [];

  constructor(agents: IAgent[], config: GameConfig) {
    this.config = config;
    this.agents = new Map(agents.map((a) => [a.id, a]));
    this.gameState = new GameState(agents.map((a) => ({ id: a.id, name: a.name })));
    this.machine = createPhaseMachine();
  }

  get transcriptLog(): readonly TranscriptEntry[] {
    return this.transcript;
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async run(): Promise<{ winner?: UUID; winnerName?: string; rounds: number; transcript: TranscriptEntry[] }> {
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
    return {
      winner: winner?.id,
      winnerName: winner?.name,
      rounds: this.gameState.round,
      transcript: this.transcript,
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

    while (!done) {
      const snapshot = actor.getSnapshot();
      const state = snapshot.value as string;

      if (state === "introduction") {
        await this.runIntroductionPhase(actor);
      } else if (state === "lobby") {
        await this.runLobbyPhase(actor);
      } else if (state === "whisper") {
        await this.runWhisperPhase(actor);
      } else if (state === "rumor") {
        await this.runRumorPhase(actor);
      } else if (state === "vote") {
        await this.runVotePhase(actor);
      } else if (state === "power") {
        await this.runPowerPhase(actor);
      } else if (state === "reveal") {
        await this.runRevealPhase(actor);
      } else if (state === "council") {
        await this.runCouncilPhase(actor);
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

    await completionPromise.catch(() => {}); // resolve if already done
  }

  private async runPhase(
    _phase: Phase,
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // Phase implementations
  // ---------------------------------------------------------------------------

  private async runIntroductionPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
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

  private async runLobbyPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.startRound();
    this.gameState.expireShields();
    const round = this.gameState.round;
    this.logSystem(`=== ROUND ${round}: LOBBY PHASE ===`, Phase.LOBBY);

    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.LOBBY);
        const text = await agent.getLobbyMessage(ctx);
        this.logPublic(player.id, text, Phase.LOBBY);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runWhisperPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.logSystem("=== WHISPER PHASE ===", Phase.WHISPER);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Clear whisper inboxes
    this.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.WHISPER);
        const whispers = await agent.getWhispers(ctx);
        for (const { to, text } of whispers) {
          // Deliver to recipients
          for (const recipientId of to) {
            const inbox = this.whisperInbox.get(recipientId) ?? [];
            inbox.push({ from: player.name, text });
            this.whisperInbox.set(recipientId, inbox);
          }
          this.logWhisper(player.id, to, text);
        }
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runRumorPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.logSystem("=== RUMOR PHASE ===", Phase.RUMOR);
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.RUMOR);
        const text = await agent.getRumorMessage(ctx);
        this.logPublic(player.id, text, Phase.RUMOR);
      }),
    );

    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runVotePhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
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

    const empoweredId = this.gameState.tallyEmpowerVotes();
    this.logSystem(
      `Empowered: ${this.gameState.getPlayerName(empoweredId)}`,
      Phase.VOTE,
    );

    actor.send({ type: "VOTES_TALLIED", empoweredId });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  private async runPowerPhase(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
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
    const prelim: [UUID, UUID] = [sorted[0], sorted[1] ?? sorted[0]];

    const empoweredAgent = this.agents.get(empoweredId)!;
    const ctx = this.buildPhaseContext(empoweredId, Phase.POWER, { empoweredId, councilCandidates: prelim });
    const powerAction = await empoweredAgent.getPowerAction(ctx, prelim);

    this.gameState.setPowerAction(powerAction);
    this.logSystem(
      `${this.gameState.getPlayerName(empoweredId)} power action: ${powerAction.action} → ${this.gameState.getPlayerName(powerAction.target)}`,
      Phase.POWER,
    );

    const { candidates, autoEliminated, shieldGranted } =
      this.gameState.determineCandidates();

    if (shieldGranted) {
      this.logSystem(
        `${this.gameState.getPlayerName(shieldGranted)} is protected (shield granted)`,
        Phase.POWER,
      );
    }

    if (autoEliminated) {
      this.logSystem(
        `AUTO-ELIMINATE: ${this.gameState.getPlayerName(autoEliminated)}`,
        Phase.POWER,
      );
      const eliminated = this.gameState.getPlayer(autoEliminated)!;
      const lastMsg = eliminated.lastMessage ?? "(no final words)";
      this.logPublic(autoEliminated, lastMsg, Phase.POWER);
      this.gameState.eliminatePlayer(autoEliminated);

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

    this.logSystem("=== COUNCIL PHASE ===", Phase.COUNCIL);
    const alivePlayers = this.gameState.getAlivePlayers();

    // All players vote (including empowered — they only count as tiebreaker)
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.COUNCIL, {
          empoweredId,
          councilCandidates: candidates,
        });
        const vote = await agent.getCouncilVote(ctx, candidates);
        this.gameState.recordCouncilVote(player.id, vote);
        this.logSystem(
          `${player.name} council vote → ${this.gameState.getPlayerName(vote)}`,
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
    this.logPublic(eliminatedId, lastMsg, Phase.COUNCIL);

    this.gameState.eliminatePlayer(eliminatedId);

    actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
    actor.send({
      type: "UPDATE_ALIVE_PLAYERS",
      aliveIds: this.gameState.getAlivePlayerIds(),
    });
    actor.send({ type: "PHASE_COMPLETE" });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------------------
  // Context builder
  // ---------------------------------------------------------------------------

  private buildPhaseContext(
    agentId: UUID,
    phase: Phase,
    extra?: { empoweredId?: UUID; councilCandidates?: [UUID, UUID] },
  ): PhaseContext {
    const player = this.gameState.getPlayer(agentId)!;
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
    };
  }

  // ---------------------------------------------------------------------------
  // Transcript helpers
  // ---------------------------------------------------------------------------

  private logPublic(fromId: UUID, text: string, phase: Phase): void {
    const name = this.gameState.getPlayerName(fromId);
    this.publicMessages.push({ from: name, text, phase });
    this.transcript.push({
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: name,
      scope: "public",
      text,
    });
  }

  private logWhisper(fromId: UUID, toIds: UUID[], text: string): void {
    const fromName = this.gameState.getPlayerName(fromId);
    const toNames = toIds.map((id) => this.gameState.getPlayerName(id));
    this.transcript.push({
      round: this.gameState.round,
      phase: Phase.WHISPER,
      timestamp: Date.now(),
      from: fromName,
      scope: "whisper",
      to: toNames,
      text,
    });
  }

  private logSystem(text: string, phase: Phase): void {
    this.transcript.push({
      round: this.gameState.round,
      phase,
      timestamp: Date.now(),
      from: "House",
      scope: "system",
      text,
    });
  }
}
