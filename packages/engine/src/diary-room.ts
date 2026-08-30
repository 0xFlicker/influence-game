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
import type {
  CompactStrategyApplicationResult,
  CompactStrategyDecisionBoundary,
  IAgent,
  PhaseContext,
  RecallPromptClass,
} from "./game-runner.types";
import { emptyRecallContinuitySnapshot } from "./context-recall-plan";
import { transcriptThinkingFor } from "./phases/phase-runner-context";
import { isProviderFallbackEligible } from "./provider-execution";

export class DiaryRoom {
  /** Diary room entries: question/answer pairs per agent per phase */
  readonly diaryEntries: Array<{ round: number; precedingPhase: Phase; agentId: UUID; agentName: string; question: string; answer: string }> = [];
  /** @deprecated Thinking is now stored on transcript entries via the `thinking` field. */
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
    private readonly beforeAcceptedCommit?: () => Promise<void> | void,
  ) {
    this.hydrateAcceptedDiaryHistory();
  }

  /**
   * Restore accepted Q&A from typed transcript coordinates. Questions carry an
   * engine-written recipient ID; answers carry the speaker player ID. The text
   * remains opaque presentation and is never inspected for game facts.
   */
  private hydrateAcceptedDiaryHistory(): void {
    const pendingQuestions = new Map<UUID, {
      round: number;
      precedingPhase: Phase;
      question: string;
    }>();
    let precedingPhase = Phase.INIT;
    for (const entry of this.logger.transcript) {
      if (entry.phase !== Phase.DIARY_ROOM) {
        precedingPhase = entry.phase;
        continue;
      }
      if (entry.scope !== "diary") continue;
      const recipientId = entry.speakerPlayerId == null && entry.to?.length === 1
        ? entry.to[0]
        : undefined;
      if (recipientId && this.agents.has(recipientId)) {
        pendingQuestions.set(recipientId, {
          round: entry.round,
          precedingPhase,
          question: entry.text,
        });
        continue;
      }
      const playerId = entry.speakerPlayerId;
      if (!playerId) continue;
      const question = pendingQuestions.get(playerId);
      const agent = this.agents.get(playerId);
      if (!question || !agent) continue;
      this.diaryEntries.push({
        round: question.round,
        precedingPhase: question.precedingPhase,
        agentId: playerId,
        agentName: agent.name,
        question: question.question,
        answer: entry.text,
      });
      pendingQuestions.delete(playerId);
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
        const agent = this.agents.get(player.id);
        if (!agent) return;
        try {
          await this.runDiaryInterview(precedingPhase, player.id, player.name, false);
        } catch (error) {
          if (!isProviderFallbackEligible(error)) throw error;
          await this.markFailedReconciliationOpportunity(agent);
          console.error(`[DiaryRoom] Interview failed for ${player.name}, skipping:`, error);
        }
      }),
    );

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
            if (!isProviderFallbackEligible(error)) throw error;
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
    const sessionEventSequence = this.sessionEventSequence();
    const phaseContext = this.contextBuilder.buildPhaseContext(
      playerId,
      Phase.DIARY_ROOM,
      undefined,
      isJuror || undefined,
    );
    const previousDiaryEntries = this.diaryEntries
      .filter((entry) => entry.agentId === playerId)
      .map((entry) => ({ round: entry.round, question: entry.question, answer: entry.answer }));

    const diaryContext = this.buildDiaryRoomContext(
      precedingPhase,
      playerId,
      playerName,
      sessionEventSequence,
      agent,
      isJuror,
      phaseContext,
      previousDiaryEntries,
    );
    const sessionExchanges: Array<{ question: string; answer: string }> = [];

    // First question
    const firstQuestion = await this.houseInterviewer.generateQuestion(diaryContext);
    this.logger.logDiary(houseLabel, firstQuestion, undefined, undefined, playerId);

    const ctx = this.buildAgentDiaryContext(agent, playerId, isJuror, phaseContext);
    ctx.providerSemanticCoordinate = {
      version: 1,
      kind: "diary_exchange",
      sessionEventSequence,
      playerId,
      exchangeOrdinal: 1,
    };
    const firstResponse = await agent.getDiaryEntry(ctx, firstQuestion, sessionExchanges);
    if (firstResponse.providerAbsence) return;
    await this.beforeAcceptedCommit?.();
    const firstTranscriptThinking = transcriptThinkingFor(
      agent,
      firstResponse.thinking,
      firstResponse.reasoningContext,
      firstResponse,
    );
    this.logger.logDiary(label, firstResponse.message, firstTranscriptThinking.thinking, firstTranscriptThinking.reasoningContext);
    const firstStrategyResult = this.commitDiaryStrategy(agent, firstResponse, isJuror);
    this.logger.emitAgentTurn({
      phase: Phase.DIARY_ROOM,
      action: "diary-answer",
      actor: { id: playerId, name: playerName, role: isJuror ? "juror" : "player" },
      visibility: "diary",
      response: {
        question: firstQuestion,
        message: firstResponse.message,
        precedingPhase,
        followUpIndex: 0,
      },
      ...(firstTranscriptThinking.decisionId && { decisionId: firstTranscriptThinking.decisionId }),
      ...(firstStrategyResult && { strategyResult: firstStrategyResult }),
      thinking: firstResponse.thinking,
      reasoningContext: firstResponse.reasoningContext,
      scope: "diary",
      text: firstResponse.message,
    });

    sessionExchanges.push({ question: firstQuestion, answer: firstResponse.message });
    this.diaryEntries.push({
      round: this.gameState.round,
      precedingPhase,
      agentId: playerId,
      agentName: playerName,
      question: firstQuestion,
      answer: firstResponse.message,
    });

    // Follow-up loop
    for (let i = 1; i < MAX_QUESTIONS; i++) {
      const result = await this.houseInterviewer.generateFollowUpOrClose(diaryContext, sessionExchanges);

      if (result.type === "close") {
        break;
      }

      this.logger.logDiary(houseLabel, result.question, undefined, undefined, playerId);

      const followUpContext = this.buildAgentDiaryContext(agent, playerId, isJuror, phaseContext);
      followUpContext.providerSemanticCoordinate = {
        version: 1,
        kind: "diary_exchange",
        sessionEventSequence,
        playerId,
        exchangeOrdinal: i + 1,
      };
      const followUpResponse = await agent.getDiaryEntry(followUpContext, result.question, sessionExchanges);
      if (followUpResponse.providerAbsence) break;
      await this.beforeAcceptedCommit?.();
      const followUpTranscriptThinking = transcriptThinkingFor(
        agent,
        followUpResponse.thinking,
        followUpResponse.reasoningContext,
        followUpResponse,
      );
      this.logger.logDiary(label, followUpResponse.message, followUpTranscriptThinking.thinking, followUpTranscriptThinking.reasoningContext);
      const followUpStrategyResult = this.commitDiaryStrategy(agent, followUpResponse, isJuror);
      this.logger.emitAgentTurn({
        phase: Phase.DIARY_ROOM,
        action: "diary-answer",
        actor: { id: playerId, name: playerName, role: isJuror ? "juror" : "player" },
        visibility: "diary",
        response: {
          question: result.question,
          message: followUpResponse.message,
          precedingPhase,
          followUpIndex: i,
        },
        ...(followUpTranscriptThinking.decisionId && { decisionId: followUpTranscriptThinking.decisionId }),
        ...(followUpStrategyResult && { strategyResult: followUpStrategyResult }),
        thinking: followUpResponse.thinking,
        reasoningContext: followUpResponse.reasoningContext,
        scope: "diary",
        text: followUpResponse.message,
      });

      sessionExchanges.push({ question: result.question, answer: followUpResponse.message });
      this.diaryEntries.push({
        round: this.gameState.round,
        precedingPhase,
        agentId: playerId,
        agentName: playerName,
        question: result.question,
        answer: followUpResponse.message,
      });
    }
  }

  private buildAgentDiaryContext(
    agent: IAgent,
    playerId: UUID,
    isJuror: boolean,
    phaseContext: PhaseContext,
  ) {
    return this.buildDiaryPhaseContext(
      agent,
      playerId,
      isJuror ? "ordinary_speech" : "strategic_decision",
      isJuror,
      phaseContext,
    );
  }

  private buildDiaryPhaseContext(
    agent: IAgent,
    playerId: UUID,
    promptClass: RecallPromptClass,
    isJuror: boolean,
    phaseContext: PhaseContext,
  ): PhaseContext {
    const continuity = agent.getRecallContinuitySnapshot?.() ?? emptyRecallContinuitySnapshot();
    return this.contextBuilder.buildPhaseContextForAgentCall({
      agentId: playerId,
      phase: Phase.DIARY_ROOM,
      promptClass,
      continuity,
      isEliminated: isJuror || undefined,
      phaseContext,
    });
  }

  private diaryStrategyBoundary(
    agent: IAgent,
    isJuror: boolean,
  ): CompactStrategyDecisionBoundary | null {
    if (isJuror) return null;
    const state = agent.getCompactStrategyState?.();
    if (!state) return null;
    if (state.lifecycle === "reconciliation_required") return "post_eviction_diary";
    if (state.lifecycle === "repair_required") return "diary_repair";
    return "diary_follow_up";
  }

  private commitDiaryStrategy(
    agent: IAgent,
    response: { strategy?: unknown; strategyDelta?: unknown },
    isJuror: boolean,
  ): CompactStrategyApplicationResult | undefined {
    const boundary = this.diaryStrategyBoundary(agent, isJuror);
    if (!boundary) return undefined;
    return agent.commitCompactStrategyCandidate?.(boundary, response);
  }

  /** A failed post-eviction interview consumes the diary repair opportunity. */
  private async markFailedReconciliationOpportunity(agent: IAgent): Promise<void> {
    const state = agent.getCompactStrategyState?.();
    if (!state || (state.lifecycle !== "reconciliation_required" && state.lifecycle !== "repair_required")) {
      return;
    }
    await this.beforeAcceptedCommit?.();
    agent.commitCompactStrategyCandidate?.(
      state.lifecycle === "reconciliation_required" ? "post_eviction_diary" : "diary_repair",
      {},
    );
  }

  /**
   * Build the context object passed to the House interviewer.
   */
  private buildDiaryRoomContext(
    precedingPhase: Phase,
    agentId: UUID,
    agentName: string,
    sessionEventSequence: number,
    agent: IAgent,
    isJuror: boolean,
    phaseContext: PhaseContext,
    previousDiaryEntries: DiaryRoomContext["previousDiaryEntries"],
  ): DiaryRoomContext {
    const playerKnowledge = this.buildDiaryPhaseContext(
      agent,
      agentId,
      "strategic_decision",
      isJuror,
      phaseContext,
    );

    return {
      precedingPhase,
      round: this.gameState.round,
      sessionEventSequence,
      agentId,
      agentName,
      playerKnowledge,
      previousDiaryEntries,
    };
  }

  private sessionEventSequence(): number {
    return (this.gameState.getCanonicalEvents().at(-1)?.sequence ?? 0) + 1;
  }

}
