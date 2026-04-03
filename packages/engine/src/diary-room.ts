/**
 * Influence Game - Diary Room
 *
 * Handles diary room interviews and revealable thinking.
 */

import type { GameState } from "./game-state";
import type { TranscriptLogger } from "./transcript-logger";
import type { ContextBuilder } from "./context-builder";
import type { IHouseInterviewer, DiaryRoomContext } from "./house-interviewer";
import type { UUID, GameConfig } from "./types";
import { Phase } from "./types";
import type { IAgent } from "./game-runner.types";

export class DiaryRoom {
  /** Diary room entries: question/answer pairs per agent per phase */
  readonly diaryEntries: Array<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> = [];
  /** Thinking entries: agent internal monologue per phase (revealable by viewers) */
  readonly thinkingEntries: Array<{ round: number; phase: Phase; agentId: UUID; agentName: string; text: string }> = [];
  /** Name of the most recently eliminated player (for diary room context) */
  lastEliminatedName: string | null = null;

  constructor(
    private readonly gameState: GameState,
    private readonly logger: TranscriptLogger,
    private readonly contextBuilder: ContextBuilder,
    private readonly agents: Map<UUID, IAgent>,
    private readonly config: GameConfig,
    private readonly houseInterviewer: IHouseInterviewer,
  ) {}

  /**
   * Collect thinking events from all alive agents for a given phase.
   */
  async collectThinking(phase: Phase): Promise<void> {
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        const agent = this.agents.get(player.id)!;
        if (!agent.getThinking) return;
        try {
          const ctx = this.contextBuilder.buildPhaseContext(player.id, phase);
          const text = await agent.getThinking(ctx);
          if (text && text !== "[No response]") {
            this.logger.logThinking(player.id, text, phase);
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

    // Run strategic reflections after vote phase thinking
    if (phase === Phase.VOTE) {
      try {
        await Promise.all(
          alivePlayers.map(async (player) => {
            const agent = this.agents.get(player.id);
            if (agent?.getStrategicReflection) {
              const ctx = this.contextBuilder.buildPhaseContext(player.id, phase);
              await agent.getStrategicReflection(ctx);
            }
          }),
        );
      } catch (error) {
        console.error(`[Thinking] Strategic reflections failed, continuing:`, error);
      }
    }
  }

  /**
   * Run a diary room session after a game phase completes.
   */
  async runDiaryRoom(precedingPhase: Phase): Promise<void> {
    const allowedPhases = this.config.diaryRoomAfterPhases;
    if (allowedPhases && !allowedPhases.includes(precedingPhase)) {
      return;
    }

    this.logger.logSystem(`--- Diary Room (after ${precedingPhase}) ---`, Phase.DIARY_ROOM);
    const alivePlayers = this.gameState.getAlivePlayers();

    await Promise.all(
      alivePlayers.map(async (player) => {
        try {
          await this.runDiaryInterview(precedingPhase, player.id, player.name, false);
        } catch (error) {
          console.error(`[DiaryRoom] Interview failed for ${player.name}, skipping:`, error);
        }
      }),
    );

    // Strategic reflections after diary room
    try {
      await Promise.all(
        alivePlayers.map(async (player) => {
          const agent = this.agents.get(player.id);
          if (agent?.getStrategicReflection) {
            const ctx = this.contextBuilder.buildPhaseContext(player.id, Phase.DIARY_ROOM);
            await agent.getStrategicReflection(ctx);
          }
        }),
      );
    } catch (error) {
      console.error(`[DiaryRoom] Strategic reflections failed, continuing:`, error);
    }

    // During Judgment, also interview active jury members
    if (this.gameState.endgameStage === "judgment") {
      const activeJury = this.contextBuilder.getActiveJury();
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
   */
  private async runDiaryInterview(
    precedingPhase: Phase,
    playerId: UUID,
    playerName: string,
    isJuror: boolean,
  ): Promise<void> {
    const maxFollowUps = this.config.maxDiaryFollowUps ?? 1;
    const MAX_QUESTIONS = 1 + maxFollowUps;
    const agent = this.agents.get(playerId)!;
    const label = isJuror ? `${playerName} (juror)` : playerName;
    const houseLabel = isJuror ? `House -> ${playerName} (juror)` : `House -> ${playerName}`;

    const diaryContext = this.buildDiaryRoomContext(precedingPhase, playerName);
    const sessionExchanges: Array<{ question: string; answer: string }> = [];

    // First question
    const firstQuestion = await this.houseInterviewer.generateQuestion(diaryContext);
    this.logger.logDiary(houseLabel, firstQuestion);

    const ctx = this.contextBuilder.buildPhaseContext(playerId, Phase.DIARY_ROOM, undefined, isJuror || undefined);
    const firstAnswer = await agent.getDiaryEntry(ctx, firstQuestion, sessionExchanges);
    this.logger.logDiary(label, firstAnswer);

    sessionExchanges.push({ question: firstQuestion, answer: firstAnswer });
    this.diaryEntries.push({
      round: this.gameState.round,
      precedingPhase,
      agentId: playerId,
      agentName: playerName,
      question: firstQuestion,
      answer: firstAnswer,
    });

    // Follow-up loop
    for (let i = 1; i < MAX_QUESTIONS; i++) {
      const updatedContext = this.buildDiaryRoomContext(precedingPhase, playerName);
      const result = await this.houseInterviewer.generateFollowUpOrClose(updatedContext, sessionExchanges);

      if (result.type === "close") {
        this.logger.logDiary("House", result.message);
        break;
      }

      this.logger.logDiary(houseLabel, result.question);

      const followUpAnswer = await agent.getDiaryEntry(ctx, result.question, sessionExchanges);
      this.logger.logDiary(label, followUpAnswer);

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

    if (sessionExchanges.length >= MAX_QUESTIONS) {
      this.logger.logDiary("House", `That's enough for now, ${playerName}. The House sees everything.`);
    }
  }

  /**
   * Build the context object passed to the House interviewer.
   */
  private buildDiaryRoomContext(precedingPhase: Phase, agentName: string): DiaryRoomContext {
    const allPlayers = this.gameState.getAllPlayers();
    const alivePlayers = this.gameState.getAlivePlayers();
    const eliminatedPlayers = allPlayers
      .filter((p) => p.status === "eliminated")
      .map((p) => p.name);
    const candidates = this.gameState.councilCandidates;
    const empoweredId = this.gameState.empoweredId;

    const previousDiaryEntries = this.diaryEntries
      .filter((d) => d.agentName === agentName)
      .map((d) => ({ round: d.round, question: d.question, answer: d.answer }));

    const playerMessages = this.logger.publicMessages
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
      recentMessages: this.logger.publicMessages.slice(-8),
      previousDiaryEntries,
      playerMessages,
    };
  }
}
