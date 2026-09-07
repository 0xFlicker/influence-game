/**
 * Mock agent for deterministic testing — no LLM calls.
 * Uses simple scripted strategies to validate game mechanics.
 */

import type { AgentResponse, AllianceAction, AllianceActionOpportunity, AllianceHuddlePromptContext, AllianceHuddleTurnAction, CandidateChoiceRequest, CandidateSelectionDecision, IAgent, MingleIntentAction, MingleTurnAction, PhaseContext, PowerActionDecision, PowerActionOptions, PowerLobbyExposure, RecallContinuitySnapshot, TargetDecision, TwoNamesInitialNamesDecision, TwoNamesOverrideDecision, TwoNamesTargetDecision } from "../game-runner";
import type { CompactStrategyCandidate, CompactStrategyDecisionBoundary, FormatDecisionProvenance } from "../game-runner.types";
import type { LaunchFormatId } from "../formats";
import {
  TemplateHouseInterviewer,
  type HouseAllianceProposerSelectionContext,
  type HouseAllianceProposerSelectionResult,
} from "../house-interviewer";
import type { UUID } from "../types";
import { emptyRecallContinuitySnapshot } from "../context-recall-plan";
import { applyStrategyCandidate, cloneCompactStrategyState, createOpeningStrategyState, markStrategyReconciliationRequired } from "../strategy-state";

/** Assert a value is defined — throws in tests if assumption is violated */
function defined<T>(value: T | undefined, msg = "Expected value to be defined"): T {
  if (value === undefined) throw new Error(msg);
  return value;
}

/** Helper to wrap a message string into an AgentResponse */
function respond(message: string, thinking = "", reasoningContext?: string): AgentResponse {
  return { thinking, message, ...(reasoningContext && { reasoningContext }) };
}

export class ScriptedHouseInterviewer extends TemplateHouseInterviewer {
  readonly allianceProposerSelectionContexts: HouseAllianceProposerSelectionContext[] = [];
  private readonly allianceProposerSelections: HouseAllianceProposerSelectionResult[];

  constructor(allianceProposerSelections: HouseAllianceProposerSelectionResult[] = []) {
    super();
    this.allianceProposerSelections = [...allianceProposerSelections];
  }

  override async selectAllianceProposers(
    context: HouseAllianceProposerSelectionContext,
  ): Promise<HouseAllianceProposerSelectionResult> {
    this.allianceProposerSelectionContexts.push({
      ...context,
      candidates: context.candidates.map((candidate) => ({ ...candidate })),
    });
    return this.allianceProposerSelections.shift() ?? super.selectAllianceProposers(context);
  }
}

export class MockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;
  private compactStrategy = createOpeningStrategyState();

  /** Optional override for endgame elimination vote target */
  eliminationTarget?: UUID;
  /** Optional override for accusation target */
  accusationTarget?: UUID;
  /** Optional override for jury vote target */
  juryVoteTarget?: UUID;
  allianceActions: AllianceAction[] = [];
  allianceActionErrors: Error[] = [];
  allianceOpportunities: AllianceActionOpportunity[] = [];
  huddleTurns: AllianceHuddleTurnAction[] = [];

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart(_gameId: UUID, _allPlayers: Array<{ id: UUID; name: string }>): void {}

  async onPhaseStart(_ctx: PhaseContext): Promise<void> {}

  getRecallContinuitySnapshot(): RecallContinuitySnapshot {
    return {
      ...emptyRecallContinuitySnapshot(),
      compactStrategy: cloneCompactStrategyState(this.compactStrategy),
    };
  }

  getCompactStrategyState() {
    return cloneCompactStrategyState(this.compactStrategy);
  }

  commitCompactStrategyCandidate(boundary: CompactStrategyDecisionBoundary, candidate: CompactStrategyCandidate) {
    const result = applyStrategyCandidate(this.compactStrategy, boundary, candidate);
    this.compactStrategy = result.state;
    return result;
  }

  markCompactStrategyReconciliationRequired() {
    this.compactStrategy = markStrategyReconciliationRequired(this.compactStrategy);
    return this.getCompactStrategyState();
  }

  private strategyDelta(action = "use current compact strategy"): string | undefined {
    if (this.compactStrategy.revision === 0) return undefined;
    return `mock: ${action}`;
  }

  async getIntroduction(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(`Hello, I'm ${this.name}. I'm here to play strategically and win!`, `Introducing myself as ${this.name}`);
  }

  async getLobbyMessage(ctx: PhaseContext): Promise<AgentResponse> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const target = others[ctx.round % others.length];
    return respond(
      `Round ${ctx.round}: I think ${target?.name ?? "everyone"} is playing well. Let's keep things interesting!`,
      `Lobby strategy: stay social, mention ${target?.name ?? "everyone"}`,
    );
  }

  async getWhispers(
    ctx: PhaseContext,
  ): Promise<Array<{ to: UUID[]; text: string }>> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) return [];

    // Whisper to first available player
    const target = defined(others[0], "Expected at least one other player to whisper to");
    return [
      {
        to: [target.id],
        text: `Hey ${target.name}, want to work together? Let's not target each other.`,
      },
    ];
  }

  async getMingleIntent(ctx: PhaseContext): Promise<MingleIntentAction> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const first = others[0]?.name ?? null;
    const second = others[1]?.name ?? null;
    return {
      seekPlayers: first ? [first] : [],
      avoidPlayers: second ? [second] : [],
      preferredRoomSize: "small_group",
      purpose: first ? `Compare notes with ${first}` : "Stay alert for a useful room",
      provisionalTarget: second,
      noTargetReason: second ? null : "No clear target yet",
      openingAsk: first ? `Ask ${first} who feels too comfortable.` : "Ask whoever arrives what they noticed.",
      strategicLens: "room_traffic",
      strategicLensRationale: "mock: use Mingle rooms to compare who seeks or avoids whom",
      thinking: "mock: form hidden Mingle intent",
      reasoningContext: undefined,
      strategyDelta: this.strategyDelta("form intent from current strategy packet"),
    };
  }

  async getAllianceAction(_ctx: PhaseContext, opportunity: AllianceActionOpportunity): Promise<AllianceAction> {
    this.allianceOpportunities.push(opportunity);
    const scriptedError = this.allianceActionErrors.shift();
    if (scriptedError) throw scriptedError;
    return this.allianceActions.shift() ?? {
      action: "pass",
      thinking: "mock: no alliance action queued",
      reasoningContext: undefined,
      strategyDelta: this.strategyDelta("pass alliance action"),
    };
  }

  async getAllianceHuddleTurn(
    _ctx: PhaseContext,
    huddle: AllianceHuddlePromptContext,
    conversationHistory?: Array<{ from: string; text: string }>,
  ): Promise<AllianceHuddleTurnAction> {
    const queued = this.huddleTurns.shift();
    if (queued) return queued;
    const alreadySpoke = conversationHistory?.some((entry) => entry.from === this.name) ?? false;
    const targetPlayerId = huddle.memberIds.find((playerId) => playerId !== this.id);
    return {
      thinking: alreadySpoke ? "mock: already spoke in this huddle" : "mock: coordinate with the alliance huddle",
      message: alreadySpoke
        ? null
        : `${huddle.allianceName}: I can hold the line if we keep the plan simple.`,
      noReply: alreadySpoke,
      factAtoms: targetPlayerId
        ? [{
            kind: "proposal",
            actorPlayerId: this.id,
            actionKind: huddle.window === "format"
              ? "format_ballot"
              : huddle.window === "pre_vote"
                ? "empower_vote"
                : "council_vote",
            targetPlayerId,
            confidence: "medium",
          }]
        : [],
      strategyDelta: this.strategyDelta("take alliance huddle turn"),
    };
  }

  async sendRoomMessage(_ctx: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<AgentResponse | null> {
    // Send one message, then pass on subsequent turns
    const alreadySpoke = conversationHistory?.some((m) => m.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    if (others.length === 0) return null;
    return respond(
      `${others.join(", ")}, let's compare notes before the vote.`,
      `Open-room group whisper to ${others.join(", ")}`,
    );
  }

  async takeMingleTurn(ctx: PhaseContext, roomMates: string[], conversationHistory?: Array<{ from: string; text: string }>): Promise<MingleTurnAction> {
    const response = await this.sendRoomMessage(ctx, roomMates, conversationHistory);
    return response
      ? { ...response, noReply: false, gotoRoomId: null, gotoPlayerName: null, strategyDelta: this.strategyDelta("talk from current strategy packet") }
      : { thinking: "", message: null, noReply: true, gotoRoomId: null, gotoPlayerName: null, strategyDelta: this.strategyDelta("defer current strategy packet") };
  }

  async getRumorMessage(ctx: PhaseContext): Promise<AgentResponse> {
    return {
      ...respond(
        `Round ${ctx.round} rumor from ${this.name}: Keep your friends close!`,
        `Spreading a general rumor`,
      ),
      strategicLens: "broad_read",
      strategicLensRationale: "mock: keep rumor broad",
    };
  }

  async getVotes(
    ctx: PhaseContext,
  ): Promise<{ empowerTarget: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) {
      return { empowerTarget: this.id, thinking: "No one else left", reasoningContext: undefined };
    }

    // Always empower the first other player (empower-only; no expose).
    const empowerTarget = defined(others[0], "Expected at least one other player to empower").id;
    return { empowerTarget, thinking: `Empower ally`, reasoningContext: undefined, strategyDelta: this.strategyDelta("empower ally") };
  }

  async getEmpowerRevote(
    ctx: PhaseContext,
    tiedCandidates: UUID[],
    _originalVote: { empowerTarget: UUID },
  ): Promise<{ empowerTarget: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const target = tiedCandidates[0] ?? ctx.alivePlayers.find((p) => p.id !== this.id)?.id ?? this.id;
    return {
      empowerTarget: target,
      thinking: "mock: empower first tied candidate in revote",
      reasoningContext: undefined,
      strategyDelta: this.strategyDelta("revote within current strategy packet"),
    };
  }

  async getCandidateSelection(
    _ctx: PhaseContext,
    request: CandidateChoiceRequest,
  ): Promise<CandidateSelectionDecision> {
    return {
      selectedCandidateIds: request.eligibleCandidateIds.slice(0, request.requiredCount),
      thinking: "mock: select first eligible candidate choice",
      reasoningContext: undefined,
      strategyDelta: this.strategyDelta("select first eligible candidate choice"),
    };
  }

  async getPowerLobbyMessage(
    ctx: PhaseContext,
    candidates: [UUID, UUID],
    exposePressure: PowerLobbyExposure[],
  ): Promise<AgentResponse> {
    const empoweredName = ctx.alivePlayers.find((p) => p.id === ctx.empoweredId)?.name ?? "the empowered player";
    const candidateNames = candidates.map(
      (id) => ctx.alivePlayers.find((p) => p.id === id)?.name ?? id,
    );
    const topPressure = exposePressure[0]?.name ?? candidateNames[0] ?? "the exposed players";
    const role = candidates.includes(this.id) ? "I need to redirect the vote" : `look closely at ${topPressure}`;
    return respond(
      `${empoweredName}, this power choice matters. ${role}; ${candidateNames.join(" and ")} should both answer for the expose vote.`,
      `Power lobby: address ${empoweredName} and candidates ${candidateNames.join(", ")}`,
    );
  }

  async getPowerAction(
    _ctx: PhaseContext,
    candidates: [UUID, UUID],
    options: PowerActionOptions = {},
  ): Promise<PowerActionDecision> {
    // Always pass to council (simplest action)
    const replacementRequest = options.shieldReplacementRequests?.find((request) => request.protectedCandidateId === candidates[0]);
    return {
      action: "pass",
      target: candidates[0],
      ...(replacementRequest ? { shieldPullUpCandidateIds: replacementRequest.eligibleCandidateIds.slice(0, replacementRequest.requiredCount) } : {}),
      thinking: "mock: pass to let council expose the field",
      reasoningContext: undefined,
      strategyDelta: this.strategyDelta("pass to let council expose the field"),
    };
  }

  async getCouncilVote(ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    // Always vote for the first candidate
    return { target: candidates[0], thinking: "mock: vote first candidate for council", reasoningContext: undefined, strategyDelta: this.strategyDelta("vote first candidate for council") };
  }

  async pickRoundFormat(
    _ctx: PhaseContext,
    offeredFormats: [LaunchFormatId, LaunchFormatId],
  ): Promise<FormatDecisionProvenance & { formatId: string; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    return {
      formatId: offeredFormats[0],
      thinking: `mock: pick first offered format ${offeredFormats[0]}`,
      strategyDelta: this.strategyDelta("pick first offered format"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getSaveOrEliminateBallot(
    ctx: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & {
    polarity: "save" | "eliminate";
    targetId: UUID;
    thinking?: string;
    reasoningContext?: string;
    strategyDelta?: string | null;
  }> {
    const others = aliveIds.filter((id) => id !== this.id);
    const targetId = others[others.length - 1] ?? this.id;
    // Even indices save first other; odd eliminate last other — creates mixed nets for tests.
    const polarity = ctx.round % 2 === 0 && others[0] ? "save" : "eliminate";
    const chosen = polarity === "save" ? (others[0] ?? targetId) : targetId;
    return {
      polarity,
      targetId: chosen,
      thinking: `mock: ${polarity} ${chosen}`,
      strategyDelta: this.strategyDelta("save-or-eliminate ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getVoteBombBallot(
    ctx: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const others = aliveIds.filter((id) => id !== this.id);
    // Spread votes: each agent votes for a different offset target to avoid pure pile-on.
    const idx = Math.max(0, ctx.alivePlayers.findIndex((p) => p.id === this.id)) % Math.max(1, others.length);
    const targetId = others[idx] ?? others[0] ?? this.id;
    return {
      targetId,
      thinking: `mock: vote bomb → ${targetId}`,
      strategyDelta: this.strategyDelta("vote bomb ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getMajorityEliminationBallot(
    _ctx: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const targetId = aliveIds.find((id) => id !== this.id) ?? this.id;
    return {
      targetId,
      thinking: `mock: majority elimination → ${targetId}`,
      strategyDelta: this.strategyDelta("majority elimination ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getEvenVotesBallot(
    ctx: PhaseContext,
    aliveIds: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const others = aliveIds.filter((id) => id !== this.id);
    const index = Math.max(
      0,
      ctx.alivePlayers.findIndex((player) => player.id === this.id),
    ) % Math.max(1, others.length);
    const targetId = others[index] ?? others[0] ?? this.id;
    return {
      targetId,
      thinking: `mock: even votes → ${targetId}`,
      strategyDelta: this.strategyDelta("even votes ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getRestrictedHistoryBallot(
    _ctx: PhaseContext,
    legalTargetIds: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const targetId = legalTargetIds[0] ?? this.id;
    return {
      targetId,
      thinking: `mock: restricted history → ${targetId}`,
      strategyDelta: this.strategyDelta("restricted history ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getTwoNamesInitialNames(
    _ctx: PhaseContext,
    legalNomineeIds: UUID[],
  ): Promise<TwoNamesInitialNamesDecision> {
    const firstNomineeId = legalNomineeIds[0] ?? this.id;
    const secondNomineeId = legalNomineeIds.find((id) => id !== firstNomineeId) ?? this.id;
    return {
      firstNomineeId,
      secondNomineeId,
      thinking: "mock: nominate the first two legal players",
      strategyDelta: this.strategyDelta("two names initial nominees"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getTwoNamesOverride(
    _ctx: PhaseContext,
    _initialNomineeIds: [UUID, UUID],
  ): Promise<TwoNamesOverrideDecision> {
    return {
      action: "decline",
      removedNomineeId: null,
      thinking: "mock: decline Override",
      strategyDelta: this.strategyDelta("two names override"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getTwoNamesReplacement(
    _ctx: PhaseContext,
    legalReplacementIds: UUID[],
  ): Promise<TwoNamesTargetDecision> {
    return {
      targetId: legalReplacementIds[0] ?? this.id,
      thinking: "mock: use the first legal replacement",
      strategyDelta: this.strategyDelta("two names replacement"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getTwoNamesBallot(
    _ctx: PhaseContext,
    finalistIds: [UUID, UUID],
  ): Promise<TwoNamesTargetDecision> {
    return {
      targetId: finalistIds[0],
      thinking: "mock: vote for the first finalist",
      strategyDelta: this.strategyDelta("two names ballot"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async breakTwoNamesTie(
    _ctx: PhaseContext,
    finalistIds: [UUID, UUID],
  ): Promise<TwoNamesTargetDecision> {
    return {
      targetId: finalistIds[0],
      thinking: "mock: break the tie against the first finalist",
      strategyDelta: this.strategyDelta("two names tiebreak"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getTwoNamesPlea(
    _ctx: PhaseContext,
    _finalistIds: [UUID, UUID],
  ): Promise<AgentResponse> {
    return respond(
      `${this.name} asks the room to keep them in the game.`,
      "mock: make a Two Names plea",
    );
  }

  async getBouncePointer(
    _ctx: PhaseContext,
    board: { safe: UUID[]; vulnerable: UUID[]; unclassified: UUID[]; nextActorId: UUID | null },
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const targetId = board.unclassified[0] ?? this.id;
    return {
      targetId,
      thinking: `mock: bounce → ${targetId}`,
      strategyDelta: this.strategyDelta("bounce pointer"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getSafetyBounceVote(
    _ctx: PhaseContext,
    vulnerableIds: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    const targetId = vulnerableIds[vulnerableIds.length - 1] ?? this.id;
    return {
      targetId,
      thinking: `mock: bounce vote → ${targetId}`,
      strategyDelta: this.strategyDelta("safety bounce vote"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async breakFormatEliminationTie(
    _ctx: PhaseContext,
    tiedSet: UUID[],
  ): Promise<FormatDecisionProvenance & { targetId: UUID; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }> {
    return {
      targetId: tiedSet[0] ?? this.id,
      thinking: "mock: break format tie with first tied player",
      strategyDelta: this.strategyDelta("format tiebreak"),
      decisionSource: "llm",
      fallbackReason: null,
    };
  }

  async getEliminationMessage(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `${this.name} here — well played, everyone. See you on the other side.`,
      `Preparing my final words`,
    );
  }

  async getDiaryEntry(_ctx: PhaseContext, question: string, _sessionHistory?: Array<{ question: string; answer: string }>): Promise<AgentResponse> {
    return respond(
      `[Diary Room] The House asked: "${question}" — My thoughts: staying the course, watching the others carefully. Trust is earned, not given.`,
      `Reflecting on the question: ${question}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Endgame methods
  // ---------------------------------------------------------------------------

  async getPlea(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `I, ${this.name}, have played with integrity. I deserve to stay because I've been loyal to my alliances and made strategic moves when it counted.`,
      `Making my plea to survive`,
    );
  }

  async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    if (this.eliminationTarget) {
      return { target: this.eliminationTarget, thinking: "mock: using configured elimination target" };
    }
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    // Vote for the last player in the list
    return {
      target: others[others.length - 1]?.id ?? this.id,
      thinking: "mock: vote last alive player for endgame elimination",
      reasoningContext: undefined,
    };
  }

  async getAccusation(ctx: PhaseContext): Promise<{ targetId: UUID; text: string; thinking?: string; reasoningContext?: string }> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    const target = defined(
      this.accusationTarget
        ? others.find((p) => p.id === this.accusationTarget) ?? others[0]
        : others[0],
      "Expected at least one other player to accuse",
    );
    return {
      targetId: target.id,
      text: `I accuse ${target.name} of playing a deceptive game. They can't be trusted.`,
      thinking: `Targeting ${target.name} for accusation`,
    };
  }

  async getDefense(_ctx: PhaseContext, accusation: string, accuserName: string): Promise<AgentResponse> {
    return respond(
      `${accuserName} accuses me, but I have played honestly. Their claims are baseless. I've been a reliable ally throughout this game.`,
      `Defending against ${accuserName}'s accusation`,
    );
  }

  async getOpeningStatement(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `Members of the jury, I am ${this.name}. I played this game with strategy and heart. I built genuine alliances and made tough decisions when they mattered most. I ask for your vote because I earned my place here.`,
      `Making my opening statement to the jury`,
    );
  }

  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<{ targetFinalistId: UUID; question: string; thinking?: string; reasoningContext?: string }> {
    // Always ask the first finalist
    return {
      targetFinalistId: finalistIds[0],
      question: "What was the single most important move you made in this game, and why?",
      thinking: "Asking about their key strategic move",
    };
  }

  async getJuryAnswer(_ctx: PhaseContext, _question: string, _jurorName: string): Promise<AgentResponse> {
    return respond(
      `That's a great question. My most important move was building trust early and staying true to my word. That's what got me to the final two.`,
      `Answering the jury question`,
    );
  }

  async getClosingArgument(_ctx: PhaseContext): Promise<AgentResponse> {
    return respond(
      `In closing, I played the best game I could. I was strategic but honest, and I never forgot that this is about people, not just moves. Vote for me.`,
      `Making my final argument`,
    );
  }

  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<TargetDecision> {
    if (this.juryVoteTarget) {
      return { target: this.juryVoteTarget, thinking: "mock: using configured jury vote target" };
    }
    // Vote for the first finalist
    return {
      target: finalistIds[0],
      thinking: "mock: vote first finalist for jury winner",
      reasoningContext: undefined,
    };
  }

  // Memory methods (no-ops for mock)
  updateAlly(_playerName: string): void { /* no-op */ }
  updateThreat(_playerName: string): void { /* no-op */ }
  addNote(_playerName: string, _note: string): void { /* no-op */ }
  removeFromMemory(_playerName: string): void { /* no-op */ }
}
