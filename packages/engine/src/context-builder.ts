/**
 * Influence Game - Context Builder
 *
 * Builds PhaseContext objects passed to agents during game phases.
 */

import type { GameState } from "./game-state";
import type { TranscriptLogger } from "./transcript-logger";
import type { AllianceProposalLineage, AllianceProposalVersion, AllianceRecord, UUID, RoomAllocation, JuryMember, MingleRoomCount } from "./types";
import { Phase } from "./types";
import type { JudgmentQuestionHistoryEntry, MingleIntentSummary, PhaseContext, PlayerAllianceContext, PlayerAllianceContextProposal, PlayerAllianceContextTerms, PublicTranscriptContextEntry, RecentDecisionContextEntry, RevealedVoteLedgerEntry } from "./game-runner.types";
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

  private allianceTermsForContext(terms: { name: string; memberIds: UUID[]; purpose: string; timebox: string | null }): PlayerAllianceContextTerms {
    return {
      name: terms.name,
      memberIds: [...terms.memberIds],
      memberNames: terms.memberIds.map((id) => this.name(id)),
      purpose: terms.purpose,
      timebox: terms.timebox,
    };
  }

  private consentMemberIdsForAllianceVersion(version: AllianceProposalVersion): UUID[] {
    return version.requiredConsentMemberIds ?? version.terms.memberIds;
  }

  private agentParticipatedInLineage(lineage: AllianceProposalLineage, agentId: UUID): boolean {
    for (const version of lineage.versions) {
      if (version.proposerId === agentId) return true;
      if (version.terms.memberIds.includes(agentId)) return true;
      if (this.consentMemberIdsForAllianceVersion(version).includes(agentId)) return true;
    }
    return Object.values(lineage.responsesByVersion).some((responses) => agentId in responses);
  }

  private allianceRecordVisibleToAgent(alliance: AllianceRecord, agentId: UUID): boolean {
    if (alliance.memberIds.includes(agentId)) return true;
    return alliance.lineageIds.some((lineageId) => {
      const lineage = this.gameState.getAllianceProposalLineage(lineageId);
      return lineage ? this.agentParticipatedInLineage(lineage, agentId) : false;
    });
  }

  private buildAllianceContext(agentId: UUID): PlayerAllianceContext {
    const huddleOutcomes = this.gameState.getDomainProjection().allianceHuddleOutcomes;
    const activeAlliances = this.gameState.getAllianceRecords()
      .filter((alliance) => alliance.memberIds.includes(agentId))
      .map((alliance) => ({
        id: alliance.id,
        status: alliance.status,
        ...this.allianceTermsForContext(alliance),
        huddleOutcomes: alliance.huddleOutcomeIds
          .map((id) => huddleOutcomes[id])
          .filter((outcome): outcome is NonNullable<typeof outcome> => Boolean(outcome))
          .map((outcome) => ({
            id: outcome.id,
            round: outcome.round,
            ask: outcome.ask,
            plan: outcome.plan,
            promises: [...outcome.promises],
            dissent: [...outcome.dissent],
            confidence: outcome.confidence,
            posture: outcome.posture,
            leakOrBetrayalClaims: [...outcome.leakOrBetrayalClaims],
          })),
      }));

    const proposals: PlayerAllianceContextProposal[] = [];
    for (const lineage of this.gameState.getAllianceProposalLineages()) {
      const currentVersion = lineage.versions.find((version) => version.versionId === lineage.currentVersionId);
      if (!currentVersion || !this.agentParticipatedInLineage(lineage, agentId)) continue;
      const responses = lineage.responsesByVersion[currentVersion.versionId] ?? {};
      proposals.push({
        lineageId: lineage.id,
        allianceId: lineage.allianceId,
        status: lineage.status,
        currentVersionId: currentVersion.versionId,
        currentTerms: this.allianceTermsForContext(currentVersion.terms),
        yourResponse: responses[agentId] ?? null,
      });
    }

    return {
      activeAlliances,
      openProposals: proposals.filter((proposal) => proposal.status === "open"),
      proposalHistory: proposals.filter((proposal) => proposal.status !== "open"),
    };
  }

  private decisionPhaseOrder(phase: Phase): number {
    switch (phase) {
      case Phase.MINGLE_I:
        return 5;
      case Phase.PRE_VOTE_HUDDLE:
        return 8;
      case Phase.VOTE:
        return 10;
      case Phase.MINGLE:
      case Phase.POST_VOTE_MINGLE:
        return 15;
      case Phase.POWER:
        return 20;
      case Phase.REVEAL:
        return 25;
      case Phase.PRE_COUNCIL_HUDDLE:
        return 28;
      case Phase.COUNCIL:
        return 30;
      case Phase.JURY_QUESTIONS:
        return 40;
      case Phase.JURY_VOTE:
        return 50;
      default:
        return 90;
    }
  }

  private latestResolvedEliminationName(): string | undefined {
    const events = this.gameState.getCanonicalEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;
      switch (event.type) {
        case "player.eliminated":
          return event.payload.playerName;
        case "endgame.elimination_resolved":
        case "council.elimination_resolved":
          return this.name(event.payload.eliminated);
        case "power.candidates_resolved":
          if (event.payload.autoEliminated) return this.name(event.payload.autoEliminated);
          break;
        default:
          break;
      }
    }
    return undefined;
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
      case "alliance.proposal_submitted":
        return `${prefix}: Alliance proposal submitted for ${event.payload.lineage.versions[0]?.terms.name ?? event.payload.lineage.allianceId}.`;
      case "alliance.response_recorded":
        return `${prefix}: ${this.name(event.payload.playerId)} responded ${event.payload.response} to alliance proposal ${event.payload.lineage.versions.find((version) => version.versionId === event.payload.versionId)?.terms.name ?? event.payload.lineage.allianceId}.`;
      case "alliance.counter_submitted":
        return `${prefix}: Alliance counter submitted for ${event.payload.lineage.versions.find((version) => version.versionId === event.payload.lineage.currentVersionId)?.terms.name ?? event.payload.lineage.allianceId}.`;
      case "alliance.activated":
        return `${prefix}: Alliance activated: ${event.payload.alliance.name} with ${this.formatPlayerList(event.payload.alliance.memberIds)}.`;
      case "alliance.amendment_resolved":
        return `${prefix}: Alliance amended: ${event.payload.alliance.name} with ${this.formatPlayerList(event.payload.alliance.memberIds)}.`;
      case "alliance.proposal_expired":
        return `${prefix}: Alliance proposal expired for ${event.payload.lineage.versions.find((version) => version.versionId === event.payload.lineage.currentVersionId)?.terms.name ?? event.payload.lineage.allianceId}.`;
      case "alliance.closed":
        return `${prefix}: Alliance closed: ${event.payload.alliance.name}${event.payload.alliance.closedReason ? ` (${event.payload.alliance.closedReason})` : ""}.`;
      case "alliance.archived":
        return `${prefix}: Alliance archived: ${event.payload.alliance.name}${event.payload.alliance.archivedReason ? ` (${event.payload.alliance.archivedReason})` : ""}.`;
      case "alliance.huddle_scheduled":
        return `${prefix}: Alliance huddle scheduled for ${event.payload.schedule.allianceId} in ${event.payload.schedule.window}: ${event.payload.schedule.rationale}`;
      case "alliance.huddle_skipped":
        return `${prefix}: Alliance huddle skipped for ${event.payload.schedule.allianceId} in ${event.payload.schedule.window}: ${event.payload.schedule.rationale}`;
      case "alliance.huddle_completed":
        return `${prefix}: Alliance huddle completed for ${event.payload.session.allianceId} in ${event.payload.session.window}.`;
      case "alliance.huddle_outcome_recorded":
        return `${prefix}: Alliance huddle outcome recorded for ${event.payload.alliance?.name ?? event.payload.outcome.allianceId}: ${event.payload.outcome.plan}`;
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
      case "judgment.speech_recorded": {
        const speaker = this.name(event.payload.playerId);
        const kindLabel = event.payload.speechKind.replaceAll("_", " ");
        const addressee = event.payload.addresseeId
          ? ` to ${this.name(event.payload.addresseeId)}`
          : "";
        return `${prefix}: ${speaker} ${kindLabel}${addressee}: "${event.payload.text}"`;
      }
      case "endgame.speech_recorded": {
        const speaker = this.name(event.payload.playerId);
        const kindLabel = event.payload.speechKind.replaceAll("_", " ");
        const target = event.payload.targetId
          ? ` targeting ${this.name(event.payload.targetId)}`
          : "";
        const counterpart = event.payload.counterpartId
          ? ` re ${this.name(event.payload.counterpartId)}`
          : "";
        return `${prefix}: ${speaker} ${kindLabel}${target}${counterpart}: "${event.payload.text}"`;
      }
      case "round.result_recorded":
        return `${prefix}: Round result recorded: empowered=${this.name(event.payload.result.empoweredId)}, candidates=${this.formatPlayerList(event.payload.result.candidates)}, power=${event.payload.result.powerAction}, shield granted=${this.name(event.payload.result.shieldGranted)}, eliminated=${this.name(event.payload.result.eliminated)}.`;
    }
  }

  private canonicalEventVisibleToAgent(event: CanonicalGameEvent, agentId: UUID): boolean {
    switch (event.type) {
      case "alliance.proposal_submitted":
      case "alliance.response_recorded":
      case "alliance.counter_submitted":
      case "alliance.proposal_expired":
        return this.agentParticipatedInLineage(event.payload.lineage, agentId);
      case "alliance.activated":
      case "alliance.amendment_resolved":
        return this.allianceRecordVisibleToAgent(event.payload.alliance, agentId)
          || this.agentParticipatedInLineage(event.payload.lineage, agentId);
      case "alliance.closed":
      case "alliance.archived":
        return this.allianceRecordVisibleToAgent(event.payload.alliance, agentId);
      case "alliance.huddle_scheduled":
      case "alliance.huddle_skipped":
      case "alliance.huddle_completed":
        return false;
      case "alliance.huddle_outcome_recorded": {
        const alliance = event.payload.alliance
          ?? this.gameState.getAlliance(event.payload.outcome.allianceId);
        return alliance ? this.allianceRecordVisibleToAgent(alliance, agentId) : false;
      }
      default:
        return true;
    }
  }

  private buildGameEventRecord(agentId: UUID): string[] {
    return this.gameState.getCanonicalEvents()
      .filter((event) => this.canonicalEventVisibleToAgent(event, agentId))
      .map((event) => this.formatCanonicalEvent(event));
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

  private buildRecentDecisionHistory(agentId: UUID): RecentDecisionContextEntry[] {
    const decisions: RecentDecisionContextEntry[] = [];
    const playerName = this.gameState.getPlayerName(agentId);
    const councilResolvedByRound = new Map<number, Extract<CanonicalGameEvent, { type: "council.elimination_resolved" }>>();

    for (const event of this.gameState.getCanonicalEvents()) {
      if (event.type === "council.elimination_resolved") {
        councilResolvedByRound.set(event.round, event);
      }
    }

    for (const event of this.gameState.getCanonicalEvents()) {
      switch (event.type) {
        case "vote.cast":
          if (event.payload.voterId === agentId) {
            decisions.push({
              round: event.round,
              phase: Phase.VOTE,
              label: "Standard Vote",
              detail: `Your standard Vote in Round ${event.round}: empowered ${this.name(event.payload.empowerTarget)}, exposed ${this.name(event.payload.exposeTarget)}.`,
            });
          }
          break;
        case "vote.empower_revote_cast":
          if (event.payload.voterId === agentId) {
            decisions.push({
              round: event.round,
              phase: Phase.VOTE,
              label: "Empower Revote",
              detail: `Your empower revote in Round ${event.round}: ${this.name(event.payload.target)}. Your expose ballot did not change.`,
            });
          }
          break;
        case "power.action_set":
          if (event.sourcePointers.some((pointer) => pointer.actorId === agentId)) {
            decisions.push({
              round: event.round,
              phase: Phase.POWER,
              label: "Power Action",
              detail: `Your Power action in Round ${event.round}: ${event.payload.action.action}${event.payload.action.action === "pass" ? "" : ` -> ${this.name(event.payload.action.target)}`}.`,
            });
          }
          break;
        case "council.vote_cast":
          if (event.payload.voterId === agentId) {
            const resolved = councilResolvedByRound.get(event.round);
            const isEmpoweredTiebreaker = resolved?.payload.empoweredId === agentId
              || (event.round === this.gameState.round && this.gameState.empoweredId === agentId);
            const timing = event.round === this.gameState.round ? "this round" : `in Round ${event.round}`;
            decisions.push({
              round: event.round,
              phase: Phase.COUNCIL,
              label: isEmpoweredTiebreaker ? "Council Tiebreaker" : "Council Vote",
              detail: isEmpoweredTiebreaker
                ? `Your Council tiebreaker ${timing}: ${this.name(event.payload.target)}. You were empowered; this counts only if the Council vote ties.`
                : `Your Council vote ${timing}: ${this.name(event.payload.target)}.`,
            });
          }
          break;
        case "endgame.elimination_vote_cast":
          if (event.payload.voterId === agentId) {
            decisions.push({
              round: event.round,
              phase: event.phase ?? Phase.VOTE,
              label: "Endgame Elimination Vote",
              detail: `Your endgame direct elimination vote in Round ${event.round}: ${this.name(event.payload.target)}. This was not empower/expose.`,
            });
          }
          break;
        case "jury.vote_cast":
          if (event.payload.jurorId === agentId) {
            decisions.push({
              round: event.round,
              phase: Phase.JURY_VOTE,
              label: "Jury Vote",
              detail: `Your jury vote: ${this.name(event.payload.finalistId)} to win.`,
            });
          }
          break;
        default:
          break;
      }
    }

    for (const resolved of councilResolvedByRound.values()) {
      if (!resolved.payload.candidates.includes(agentId)) continue;
      decisions.push({
        round: resolved.round,
        phase: Phase.COUNCIL,
        label: "Council Candidate",
        detail: `You were a Council candidate this round and did not cast a Council vote. Candidates: ${this.formatPlayerList(resolved.payload.candidates)}; eliminated: ${this.name(resolved.payload.eliminated)}.`,
      });
    }

    for (const resolved of councilResolvedByRound.values()) {
      if (
        resolved.payload.empoweredId !== agentId ||
        resolved.payload.method !== "plurality" ||
        resolved.payload.candidates.includes(agentId) ||
        resolved.payload.tally.votes[agentId]
      ) {
        continue;
      }
      decisions.push({
        round: resolved.round,
        phase: Phase.COUNCIL,
        label: "Council Tiebreak Not Needed",
        detail: `You were empowered in Round ${resolved.round}, but the Council vote resolved by plurality. You did not cast a tiebreaker; eliminated: ${this.name(resolved.payload.eliminated)}.`,
      });
    }

    const currentCandidates = this.gameState.councilCandidates;
    if (
      currentCandidates?.includes(agentId) &&
      !decisions.some((decision) => decision.round === this.gameState.round && decision.label === "Council Candidate")
    ) {
      decisions.push({
        round: this.gameState.round,
        phase: Phase.COUNCIL,
        label: "Council Candidate",
        detail: `You are a Council candidate this round and do not cast a Council vote. Candidates: ${this.formatPlayerList(currentCandidates)}.`,
      });
    }

    for (const entry of this.logger.transcript) {
      if (entry.phase !== Phase.JURY_QUESTIONS || entry.scope !== "public") continue;
      const question = entry.text.match(/^\[QUESTION to (.+?)\] (.+)$/);
      if (entry.from === playerName && question) {
        decisions.push({
          round: entry.round,
          phase: Phase.JURY_QUESTIONS,
          label: "Judgment Question",
          detail: `Your Judgment question to ${question[1] ?? "unknown"}: "${question[2] ?? ""}"`,
        });
        continue;
      }
      const answer = entry.text.match(/^\[ANSWER to (.+?)\] (.+)$/);
      if (entry.from === playerName && answer) {
        decisions.push({
          round: entry.round,
          phase: Phase.JURY_QUESTIONS,
          label: "Judgment Answer",
          detail: `Your Judgment answer to ${answer[1] ?? "unknown"}: "${answer[2] ?? ""}"`,
        });
      }
    }

    return decisions
      .sort((a, b) => a.round - b.round || this.decisionPhaseOrder(a.phase) - this.decisionPhaseOrder(b.phase))
      .slice(-12);
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
      gameEventRecord: this.buildGameEventRecord(agentId),
      publicTranscriptContext: this.buildPublicTranscriptContext(),
      judgmentQuestionHistory: this.buildJudgmentQuestionHistory(),
      recentDecisions: this.buildRecentDecisionHistory(agentId),
      allianceContext: this.buildAllianceContext(agentId),
      latestEliminatedPlayerName: this.latestResolvedEliminationName(),
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
