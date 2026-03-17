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
  /** Called for diary room interviews — the House asks a question, agent responds */
  getDiaryEntry(context: PhaseContext, question: string): Promise<string>;

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
  // Endgame context
  endgameStage?: EndgameStage;
  jury?: JuryMember[];
  finalists?: [UUID, UUID];
}

// ---------------------------------------------------------------------------
// Transcript entry
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  round: number;
  phase: Phase;
  timestamp: number;
  from: string;
  scope: "public" | "whisper" | "system" | "diary";
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
  /** Diary room entries: question/answer pairs per agent per phase */
  private diaryEntries: Array<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> = [];
  /** Name of the most recently eliminated player (for diary room context) */
  private lastEliminatedName: string | null = null;
  /** House interviewer for diary room question generation */
  private readonly houseInterviewer: IHouseInterviewer;

  constructor(agents: IAgent[], config: GameConfig, houseInterviewer?: IHouseInterviewer) {
    this.config = config;
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

      // --- Normal round phases ---
      if (state === "introduction") {
        await this.runIntroductionPhase(actor);
        await this.runDiaryRoom(Phase.INTRODUCTION);
      } else if (state === "lobby") {
        await this.runLobbyPhase(actor);
        await this.runDiaryRoom(Phase.LOBBY);
      } else if (state === "whisper") {
        await this.runWhisperPhase(actor);
      } else if (state === "rumor") {
        await this.runRumorPhase(actor);
        await this.runDiaryRoom(Phase.RUMOR);
      } else if (state === "vote") {
        await this.runVotePhase(actor);
      } else if (state === "power") {
        await this.runPowerPhase(actor);
      } else if (state === "reveal") {
        await this.runRevealPhase(actor);
        await this.runDiaryRoom(Phase.REVEAL);
      } else if (state === "council") {
        await this.runCouncilPhase(actor);
        await this.runDiaryRoom(Phase.COUNCIL);

      // --- THE RECKONING (4 -> 3) ---
      } else if (state === "reckoning_lobby") {
        await this.runReckoningLobby(actor);
        await this.runDiaryRoom(Phase.LOBBY);
      } else if (state === "reckoning_whisper") {
        await this.runReckoningWhisper(actor);
      } else if (state === "reckoning_plea") {
        await this.runReckoningPlea(actor);
        await this.runDiaryRoom(Phase.PLEA);
      } else if (state === "reckoning_vote") {
        await this.runReckoningVote(actor);
        await this.runDiaryRoom(Phase.VOTE);

      // --- THE TRIBUNAL (3 -> 2) ---
      } else if (state === "tribunal_lobby") {
        await this.runTribunalLobby(actor);
        await this.runDiaryRoom(Phase.LOBBY);
      } else if (state === "tribunal_accusation") {
        await this.runTribunalAccusation(actor);
      } else if (state === "tribunal_defense") {
        await this.runTribunalDefense(actor);
        await this.runDiaryRoom(Phase.DEFENSE);
      } else if (state === "tribunal_vote") {
        await this.runTribunalVote(actor);
        await this.runDiaryRoom(Phase.VOTE);

      // --- THE JUDGMENT (2 finalists) ---
      } else if (state === "judgment_opening") {
        await this.runJudgmentOpening(actor);
      } else if (state === "judgment_jury_questions") {
        await this.runJudgmentJuryQuestions(actor);
        await this.runDiaryRoom(Phase.JURY_QUESTIONS);
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
          `${player.name} council vote -> ${this.gameState.getPlayerName(vote)}`,
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
  // THE RECKONING (4 -> 3 players)
  // ---------------------------------------------------------------------------

  private async runReckoningLobby(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.gameState.startRound();
    this.gameState.setEndgameStage("reckoning");
    const round = this.gameState.round;
    this.logSystem(`\n========================================`, Phase.LOBBY);
    this.logSystem(`=== THE RECKONING (Round ${round}) ===`, Phase.LOBBY);
    this.logSystem(`========================================`, Phase.LOBBY);
    this.logSystem(`${this.gameState.describeState()}`, Phase.LOBBY);

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

  private async runReckoningWhisper(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
    this.logSystem("=== RECKONING: WHISPER PHASE ===", Phase.WHISPER);
    const alivePlayers = this.gameState.getAlivePlayers();
    this.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const ctx = this.buildPhaseContext(player.id, Phase.WHISPER);
        const whispers = await agent.getWhispers(ctx);
        for (const { to, text } of whispers) {
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

  private async runReckoningPlea(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
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
    this.logPublic(eliminatedId, lastMsg, Phase.VOTE);
    this.gameState.eliminatePlayer(eliminatedId);

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
    this.logSystem(`\n========================================`, Phase.LOBBY);
    this.logSystem(`=== THE TRIBUNAL (Round ${round}) ===`, Phase.LOBBY);
    this.logSystem(`========================================`, Phase.LOBBY);
    this.logSystem(`${this.gameState.describeState()}`, Phase.LOBBY);

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

  /** Accusations stored for the defense phase */
  private _currentAccusations = new Map<UUID, { accuserId: UUID; accuserName: string; text: string }>();

  private async runTribunalAccusation(
    actor: ReturnType<typeof createActor<ReturnType<typeof createPhaseMachine>>>,
  ): Promise<void> {
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
    if (this.gameState.jury.length > 0) {
      juryTiebreakerVotes = {};
      for (const juror of this.gameState.jury) {
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
    this.logPublic(eliminatedId, lastMsg, Phase.VOTE);
    this.gameState.eliminatePlayer(eliminatedId);

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
    this.logSystem(`\n========================================`, Phase.OPENING_STATEMENTS);
    this.logSystem(`=== THE JUDGMENT ===`, Phase.OPENING_STATEMENTS);
    this.logSystem(`========================================`, Phase.OPENING_STATEMENTS);
    this.logSystem(`Finalists: ${this.gameState.getAlivePlayers().map((p) => p.name).join(" vs ")}`, Phase.OPENING_STATEMENTS);
    this.logSystem(`Jury: ${this.gameState.jury.map((j) => j.playerName).join(", ")}`, Phase.OPENING_STATEMENTS);

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
    this.logSystem("=== JUDGMENT: JURY QUESTIONS ===", Phase.JURY_QUESTIONS);
    const finalists = this.gameState.getAlivePlayers();
    const finalist0 = finalists[0];
    const finalist1 = finalists[1];
    if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury questions phase");
    const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

    // Each juror asks one question to one finalist, and the finalist answers
    for (const juror of this.gameState.jury) {
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
    this.logSystem("=== JUDGMENT: JURY VOTE ===", Phase.JURY_VOTE);
    const finalists = this.gameState.getAlivePlayers();
    const finalist0 = finalists[0];
    const finalist1 = finalists[1];
    if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury vote phase");
    const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

    for (const juror of this.gameState.jury) {
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

    const winnerId = this.gameState.tallyJuryVotes();
    const winnerName = this.gameState.getPlayerName(winnerId);
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
  // Diary Room — House interviews agents between phases
  // ---------------------------------------------------------------------------

  /**
   * Run a diary room session after a game phase completes.
   * The House asks each alive agent a contextual interview question,
   * and agents respond with their strategic thoughts.
   * During Judgment, jury members are also interviewed.
   */
  private async runDiaryRoom(precedingPhase: Phase): Promise<void> {
    this.logSystem(`--- Diary Room (after ${precedingPhase}) ---`, Phase.DIARY_ROOM);
    const alivePlayers = this.gameState.getAlivePlayers();

    // Interview alive players
    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        const diaryContext = this.buildDiaryRoomContext(precedingPhase, player.name);
        const question = await this.houseInterviewer.generateQuestion(diaryContext);
        const ctx = this.buildPhaseContext(player.id, Phase.DIARY_ROOM);

        // Log the House's question
        this.logDiary(`House -> ${player.name}`, question);

        const answer = await agent.getDiaryEntry(ctx, question);

        // Log the agent's response
        this.logDiary(player.name, answer);

        // Store structured diary entry
        this.diaryEntries.push({
          round: this.gameState.round,
          precedingPhase,
          agentId: player.id,
          agentName: player.name,
          question,
          answer,
        });
      }),
    );

    // During Judgment phases, also interview jury members
    if (this.gameState.endgameStage === "judgment") {
      await Promise.all(
        this.gameState.jury.map(async (juror) => {
          const agent = this.agents.get(juror.playerId);
          if (!agent) return;

          const diaryContext = this.buildDiaryRoomContext(precedingPhase, juror.playerName);
          const question = await this.houseInterviewer.generateQuestion(diaryContext);
          const ctx = this.buildPhaseContext(juror.playerId, Phase.DIARY_ROOM);

          this.logDiary(`House -> ${juror.playerName} (juror)`, question);
          const answer = await agent.getDiaryEntry(ctx, question);
          this.logDiary(`${juror.playerName} (juror)`, answer);

          this.diaryEntries.push({
            round: this.gameState.round,
            precedingPhase,
            agentId: juror.playerId,
            agentName: juror.playerName,
            question,
            answer,
          });
        }),
      );
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
    };
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
      // Endgame context
      endgameStage: this.gameState.endgameStage ?? undefined,
      jury: this.gameState.jury.length > 0 ? [...this.gameState.jury] : undefined,
      finalists: (() => {
        const alivePlayers = this.gameState.getAlivePlayers();
        if (alivePlayers.length !== 2) return undefined;
        const f0 = alivePlayers[0];
        const f1 = alivePlayers[1];
        if (!f0 || !f1) return undefined;
        return [f0.id, f1.id] as [UUID, UUID];
      })(),
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

  private logDiary(from: string, text: string): void {
    this.transcript.push({
      round: this.gameState.round,
      phase: Phase.DIARY_ROOM,
      timestamp: Date.now(),
      from,
      scope: "diary",
      text,
    });
  }
}
