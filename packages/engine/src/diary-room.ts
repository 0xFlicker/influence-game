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
  HouseProducerBrief,
  HouseRoundFacts,
  HouseStrategyBiblePacket,
  IAgent,
} from "./game-runner.types";
import { emptyRecallContinuitySnapshot } from "./context-recall-plan";
import { formatHouseProducerBriefOperatorText } from "./operator-turn-text";
import { transcriptThinkingFor } from "./phases/phase-runner-context";
import { pairProviderLogicalCallOrdinals } from "./provider-execution";
import { isProviderFallbackEligible } from "./provider-execution";
import type { HouseAudienceSummaryArtifact } from "./house-summary-frontier";

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
    private readonly getHouseStrategyBible?: () => HouseStrategyBiblePacket | null,
    private readonly getHouseRoundFacts?: () => HouseRoundFacts,
    private readonly beforeAcceptedCommit?: () => Promise<void> | void,
    private readonly getHouseAudienceSummaryArtifacts?: () => HouseAudienceSummaryArtifact[],
  ) {}

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
    const providerInterviewOrdinal = this.providerInterviewOrdinal(playerId);

    const diaryContext = this.buildDiaryRoomContext(
      precedingPhase,
      playerId,
      playerName,
      providerInterviewOrdinal,
    );
    const sessionExchanges: Array<{ question: string; answer: string }> = [];
    const producerBrief = await this.generateProducerBrief(diaryContext);
    if (producerBrief) {
      diaryContext.producerBrief = producerBrief;
    }

    // First question
    const firstQuestion = await this.houseInterviewer.generateQuestion(diaryContext);
    this.logger.logDiary(houseLabel, firstQuestion);

    const ctx = this.buildAgentDiaryContext(agent, playerId, isJuror);
    ctx.providerLogicalCallOrdinal = 1;
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
      const updatedContext = this.buildDiaryRoomContext(
        precedingPhase,
        playerId,
        playerName,
        providerInterviewOrdinal,
      );
      const result = await this.houseInterviewer.generateFollowUpOrClose(updatedContext, sessionExchanges);

      if (result.type === "close") {
        break;
      }

      this.logger.logDiary(houseLabel, result.question);

      const followUpContext = this.buildAgentDiaryContext(agent, playerId, isJuror);
      followUpContext.providerLogicalCallOrdinal = i + 1;
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
  ) {
    const continuity = agent.getRecallContinuitySnapshot?.() ?? emptyRecallContinuitySnapshot();
    return this.contextBuilder.buildPhaseContextForAgentCall({
      agentId: playerId,
      phase: Phase.DIARY_ROOM,
      promptClass: isJuror ? "ordinary_speech" : "strategic_decision",
      continuity,
      isEliminated: isJuror || undefined,
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
    providerInterviewOrdinal: number,
  ): DiaryRoomContext {
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

    const roundFacts = this.getHouseRoundFacts?.();
    const playerIdByName = new Map(allPlayers.map((player) => [player.name, player.id]));
    const recentMessages = this.logger.publicMessages
      .slice(-8)
      .flatMap((message) => {
        const fromPlayerId = playerIdByName.get(message.from);
        return fromPlayerId
          ? [{ fromPlayerId, from: message.from, text: message.text, phase: message.phase }]
          : [];
      });

    return {
      precedingPhase,
      round: this.gameState.round,
      providerInterviewOrdinal,
      agentId,
      agentName,
      canonicalHead: this.gameState.getCanonicalEvents().at(-1)?.sequence ?? 0,
      players: allPlayers.map((player) => ({
        id: player.id,
        name: player.name,
        status: player.status === "alive" ? "alive" : "eliminated",
      })),
      alivePlayers: alivePlayers.map((p) => p.name),
      activeShieldNames: alivePlayers.filter((p) => p.shielded).map((p) => p.name),
      eliminatedPlayers,
      lastEliminated: this.lastEliminatedName,
      empoweredName: empoweredId ? this.gameState.getPlayerName(empoweredId) : null,
      councilCandidates: candidates
        ? [this.gameState.getPlayerName(candidates[0]), this.gameState.getPlayerName(candidates[1])]
        : null,
      recentMessages,
      previousDiaryEntries,
      playerMessages,
      audienceSummaryArtifacts: structuredClone(
        this.getHouseAudienceSummaryArtifacts?.() ?? [],
      ),
      roundFacts,
      councilRole: roundFacts?.councilRoles.find((role) => role.playerName === agentName) ?? null,
    };
  }

  private providerInterviewOrdinal(playerId: UUID): number {
    const allPlayers = this.gameState.getAllPlayers();
    const playerOrdinal =
      allPlayers.findIndex((player) => player.id === playerId) + 1;
    if (playerOrdinal < 1) {
      throw new Error(`Diary interview player ${playerId} is not in the game roster`);
    }
    const sessionBoundaryOrdinal =
      (this.gameState.getCanonicalEvents().at(-1)?.sequence ?? 0) + 1;
    return pairProviderLogicalCallOrdinals(
      sessionBoundaryOrdinal,
      playerOrdinal,
    );
  }

  private async generateProducerBrief(context: DiaryRoomContext): Promise<HouseProducerBrief | null> {
    if (this.config.enableHouseProducerBriefs !== true) {
      return null;
    }

    const packet = this.getHouseStrategyBible?.() ?? null;
    const brief = await this.houseInterviewer.generateProducerBrief(context, packet);
    this.logger.emitAgentTurn({
        phase: Phase.DIARY_ROOM,
        action: "house-producer-brief",
        actor: { name: "House", role: "house" },
        visibility: "private",
        response: {
          precedingPhase: context.precedingPhase,
          playerName: context.agentName,
          producerBrief: {
            playerName: brief.playerName,
            playerId: brief.playerId,
            packetRevisionId: brief.packetRevisionId,
            focusItems: brief.focusItems,
            questionAngles: brief.questionAngles,
            producerNote: brief.producerNote,
            fallback: brief.fallback,
          },
        },
        thinking: brief.thinking,
        reasoningContext: brief.reasoningContext,
        scope: "diary",
        text: formatHouseProducerBriefOperatorText({
          playerName: context.agentName,
          focusItems: brief.focusItems,
          questionAngles: brief.questionAngles,
        }),
      });
    return brief;
  }
}
