/**
 * Influence Game - Context Builder
 *
 * Builds PhaseContext objects passed to agents during game phases.
 */

import type { GameState } from "./game-state";
import type { TranscriptLogger } from "./transcript-logger";
import type { UUID, RoomAllocation, JuryMember, MingleRoomCount } from "./types";
import { Phase } from "./types";
import type { JudgmentQuestionHistoryEntry, MingleIntentSummary, PhaseContext, PublicTranscriptContextEntry, RevealedVoteLedgerEntry } from "./game-runner.types";
import { computeJurySize } from "./types";
import type { PostVotePressureProjection } from "./post-vote-pressure";
import type { CanonicalGameEvent } from "./canonical-events";

export class ContextBuilder {
  /** Room allocations for the current round */
  currentRoomAllocations: RoomAllocation[] = [];
  /** Players excluded from rooms this round */
  currentExcludedPlayerIds: UUID[] = [];
  /** Privacy-safe room counts for the current or most recent Mingle turn */
  currentRoomCounts: MingleRoomCount[] = [];
  /** Vote-derived pressure available after the empowered player is resolved */
  currentPostVotePressure: PostVotePressureProjection | null = null;
  /** Public named vote record available to players after votes are resolved. */
  revealedVoteLedger: RevealedVoteLedgerEntry[] = [];

  constructor(
    private readonly gameState: GameState,
    private readonly logger: TranscriptLogger,
    private readonly mingleInbox: Map<UUID, Array<{ from: string; text: string }>>,
    private readonly totalPlayerCount: number,
  ) {}

  /**
   * Get the active jury — the last N eliminated players based on game size.
   * Early eliminations don't earn jury seats.
   */
  getActiveJury(): readonly JuryMember[] {
    const maxJurors = computeJurySize(this.totalPlayerCount);
    const allJurors = this.gameState.jury;
    if (allJurors.length <= maxJurors) return allJurors;
    return allJurors.slice(allJurors.length - maxJurors);
  }

  revealVoteLedgerEntries(entries: RevealedVoteLedgerEntry[]): void {
    const retained = this.revealedVoteLedger.filter(
      (entry) => !entries.some((next) => next.round === entry.round && next.voterId === entry.voterId),
    );
    this.revealedVoteLedger = [
      ...retained,
      ...entries.map((entry) => ({ ...entry })),
    ].sort((a, b) => a.round - b.round || a.voterName.localeCompare(b.voterName));
  }

  private name(id: UUID | null | undefined): string {
    return id ? this.gameState.getPlayerName(id) : "none";
  }

  private formatVoteMap(votes: Record<UUID, UUID> | undefined): string {
    if (!votes || Object.keys(votes).length === 0) return "none";
    return Object.entries(votes)
      .map(([voterId, targetId]) => `${this.name(voterId)} -> ${this.name(targetId)}`)
      .join("; ");
  }

  private formatCounts(counts: Record<UUID, number> | undefined): string {
    if (!counts || Object.keys(counts).length === 0) return "none";
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([playerId, count]) => `${this.name(playerId)}=${count}`)
      .join(", ");
  }

  private formatPlayerList(ids: readonly UUID[] | null | undefined): string {
    if (!ids || ids.length === 0) return "none";
    return ids.map((id) => this.name(id)).join(", ");
  }

  private formatCanonicalEvent(event: CanonicalGameEvent): string {
    const prefix = `R${event.round}${event.phase ? `/${event.phase}` : ""}`;
    switch (event.type) {
      case "game.roster_initialized":
        return `${prefix}: Game roster: ${event.payload.players.map((p) => p.name).join(", ")}`;
      case "round.started":
        return `${prefix}: Round ${event.payload.round} started.`;
      case "shields.expired":
        return `${prefix}: Shields expired: ${this.formatPlayerList(event.payload.expiredPlayerIds)}.`;
      case "mingle.rooms_allocated":
        return `${prefix}: Mingle rooms allocated: ${event.payload.rooms.map((room) => `Room ${room.roomId}: ${this.formatPlayerList(room.playerIds)}`).join(" | ")}.`;
      case "vote.cast":
        return `${prefix}: ${this.name(event.payload.voterId)} voted empower=${this.name(event.payload.empowerTarget)}, expose=${this.name(event.payload.exposeTarget)}.`;
      case "vote.empower_tally_resolved":
        return `${prefix}: Empower tally resolved: ${this.name(event.payload.empowered)} by ${event.payload.method}; counts ${this.formatCounts(event.payload.counts)}${event.payload.tied ? `; tied ${this.formatPlayerList(event.payload.tied)}` : ""}.`;
      case "vote.empower_revote_cast":
        return `${prefix}: ${this.name(event.payload.voterId)} re-voted empower=${this.name(event.payload.target)}.`;
      case "vote.empower_vote_cleared":
        return `${prefix}: ${this.name(event.payload.voterId)}'s initial empower vote was cleared for re-vote.`;
      case "vote.empowered_set":
        return `${prefix}: Empowered player set to ${this.name(event.payload.empowered)} by ${event.payload.method}.`;
      case "power.action_set":
        return `${prefix}: Power action: ${event.payload.action.action}${event.payload.action.action === "pass" ? "" : ` -> ${this.name(event.payload.action.target)}`}.`;
      case "power.candidates_resolved":
        return `${prefix}: Power resolved candidates=${event.payload.candidates ? this.formatPlayerList(event.payload.candidates) : "none"}; shield granted=${this.name(event.payload.shieldGranted)}; auto-eliminated=${this.name(event.payload.autoEliminated)}; expose scores ${this.formatCounts(event.payload.exposeScores)}.`;
      case "council.vote_cast":
        return `${prefix}: ${this.name(event.payload.voterId)} voted at Council to eliminate ${this.name(event.payload.target)}.`;
      case "council.elimination_resolved":
        return `${prefix}: Council resolved: candidates ${this.formatPlayerList(event.payload.candidates)}; votes ${this.formatVoteMap(event.payload.tally.votes)}; eliminated ${this.name(event.payload.eliminated)} by ${event.payload.method}.`;
      case "player.last_message_recorded":
        return `${prefix}: ${this.name(event.payload.playerId)} gave final words: "${event.payload.message}"`;
      case "player.eliminated":
        return `${prefix}: ${event.payload.playerName} was eliminated.`;
      case "endgame.stage_set":
        return `${prefix}: Endgame stage set to ${event.payload.stage}; last regular empowered=${this.name(event.payload.lastEmpoweredFromRegularRounds)}.`;
      case "endgame.elimination_vote_cast":
        return `${prefix}: ${this.name(event.payload.voterId)} voted to eliminate ${this.name(event.payload.target)}.`;
      case "endgame.elimination_resolved":
        return `${prefix}: ${event.payload.stage ?? "endgame"} elimination resolved: votes ${this.formatVoteMap(event.payload.tally.votes)}${event.payload.juryTiebreakerVotes ? `; jury tiebreaker ${this.formatVoteMap(event.payload.juryTiebreakerVotes)}` : ""}; eliminated ${this.name(event.payload.eliminated)} by ${event.payload.method}.`;
      case "jury.vote_cast":
        return `${prefix}: Juror ${this.name(event.payload.jurorId)} voted for finalist ${this.name(event.payload.finalistId)}.`;
      case "jury.winner_determined":
        return `${prefix}: Jury winner determined: ${this.name(event.payload.winnerId)} by ${event.payload.method}; counts ${event.payload.voteCounts.map((count) => `${count.name}=${count.votes}`).join(", ")}.`;
      case "round.result_recorded":
        return `${prefix}: Round result recorded: empowered=${this.name(event.payload.result.empoweredId)}, candidates=${this.formatPlayerList(event.payload.result.candidates)}, power=${event.payload.result.powerAction}, shield granted=${this.name(event.payload.result.shieldGranted)}, eliminated=${this.name(event.payload.result.eliminated)}.`;
    }
  }

  private buildGameEventRecord(): string[] {
    return this.gameState.getCanonicalEvents().map((event) => this.formatCanonicalEvent(event));
  }

  private buildPublicTranscriptContext(): PublicTranscriptContextEntry[] {
    return this.logger.transcript
      .filter((entry) => entry.scope === "public" || entry.scope === "system")
      .map((entry) => ({
        round: entry.round,
        phase: entry.phase,
        from: entry.from,
        text: entry.text,
      }));
  }

  private buildJudgmentQuestionHistory(): JudgmentQuestionHistoryEntry[] {
    const history: JudgmentQuestionHistoryEntry[] = [];
    for (const entry of this.logger.transcript) {
      if (entry.phase !== Phase.JURY_QUESTIONS || entry.scope !== "public") continue;
      const question = entry.text.match(/^\[QUESTION to (.+?)\] (.+)$/);
      if (question) {
        history.push({
          jurorName: entry.from,
          finalistName: question[1] ?? "unknown",
          question: question[2] ?? "",
        });
        continue;
      }
      const answer = entry.text.match(/^\[ANSWER to (.+?)\] (.+)$/);
      if (answer) {
        const finalistName = entry.from;
        for (let index = history.length - 1; index >= 0; index -= 1) {
          const item = history[index];
          if (item && item.jurorName === answer[1] && item.finalistName === finalistName && item.answer == null) {
            item.answer = answer[2] ?? "";
            break;
          }
        }
      }
    }
    return history;
  }

  buildPhaseContext(
    agentId: UUID,
    phase: Phase,
    extra?: {
      empoweredId?: UUID;
      councilCandidates?: [UUID, UUID];
      postVotePressure?: PostVotePressureProjection | null;
      eliminationContext?: PhaseContext["eliminationContext"];
    },
    isEliminated?: boolean,
    roomInfo?: {
      roomCount?: number;
      roomCounts?: MingleRoomCount[];
      currentRoomId?: number;
      roomMates?: string[];
      mingleIntent?: MingleIntentSummary | null;
      includeRoomAllocations?: boolean;
    },
  ): PhaseContext {
    const player = this.gameState.getPlayer(agentId)!;

    const roomAllocations = roomInfo?.includeRoomAllocations && this.currentRoomAllocations.length > 0
      ? this.currentRoomAllocations.map((r) => ({
          roomId: r.roomId,
          beat: r.beat,
          playerIds: [...r.playerIds],
          playerNames: r.playerIds.map((id) => this.gameState.getPlayerName(id)),
        }))
      : undefined;

    return {
      gameId: this.gameState.gameId,
      round: this.gameState.round,
      phase,
      selfId: agentId,
      selfName: player.name,
      alivePlayers: this.gameState.getAlivePlayers().map((p) => ({ id: p.id, name: p.name, shielded: p.shielded })),
      publicMessages: [...this.logger.publicMessages],
      mingleMessages: this.mingleInbox.get(agentId) ?? [],
      empoweredId: extra?.empoweredId ?? this.gameState.empoweredId ?? undefined,
      councilCandidates: extra && "councilCandidates" in extra
        ? extra.councilCandidates
        : this.gameState.councilCandidates ?? undefined,
      postVotePressure: extra && "postVotePressure" in extra
        ? extra.postVotePressure ?? undefined
        : this.currentPostVotePressure ?? undefined,
      revealedVoteLedger: this.revealedVoteLedger.map((entry) => ({ ...entry })),
      gameEventRecord: this.buildGameEventRecord(),
      publicTranscriptContext: this.buildPublicTranscriptContext(),
      judgmentQuestionHistory: this.buildJudgmentQuestionHistory(),
      roomCount: roomInfo?.roomCount,
      roomCounts: roomInfo?.roomCounts ?? (this.currentRoomCounts.length > 0 ? [...this.currentRoomCounts] : undefined),
      currentRoomId: roomInfo?.currentRoomId,
      roomAllocations,
      roomMates: roomInfo?.roomMates,
      mingleIntent: roomInfo?.mingleIntent,
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
      eliminationContext: extra?.eliminationContext,
    };
  }
}
