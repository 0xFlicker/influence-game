/**
 * Deterministic authorization-safe Recall Plan compiler.
 *
 * Pure functions only — no LLM calls, no side effects.
 * Authorize → project → seed → rank → budget → receipt.
 */

import type { Phase, UUID } from "./types";
import type {
  PhaseContext,
  RecallBoardContractFacts,
  RecallContinuitySnapshot,
  RecallHistoryDialogueEvidence,
  RecallHotMessage,
  RecallPlan,
  RecallPlanBudgetLedger,
  RecallPlanReceipt,
  RecallPromptClass,
  RecallProtectedHuddleOutcome,
  StrategicDecisionReceipt,
  StrategyPacketSummary,
  StrategicReflectionSummary,
  TranscriptEntry,
} from "./game-runner.types";

// ---------------------------------------------------------------------------
// Budget envelopes (fixture-calibrated character ceilings per prompt class)
// Protected is reserved first; history is remaining after protected+hot,
// capped by historyCeilingChars. 50% reduction is a U5 promotion gate, not a budget value.
// ---------------------------------------------------------------------------

export interface RecallBudgetEnvelope {
  /** Total character envelope for protected + hot + history. */
  readonly envelopeChars: number;
  /** Max characters for the historical archive lane (0 = no history). */
  readonly historyCeilingChars: number;
}

/**
 * Character envelopes per prompt class. Calibrated for late-game board + thread
 * + a handful of compact huddles while leaving a bounded archive slot for
 * strategic classes only.
 */
export const RECALL_BUDGET_ENVELOPES: Readonly<Record<RecallPromptClass, RecallBudgetEnvelope>> = {
  ordinary_speech: {
    envelopeChars: 12_000,
    historyCeilingChars: 0,
  },
  strategic_decision: {
    envelopeChars: 16_000,
    historyCeilingChars: 4_000,
  },
  strategic_reflection: {
    envelopeChars: 18_000,
    historyCeilingChars: 6_000,
  },
};

/** Empty continuity when an agent does not implement the snapshot accessor (e.g. mocks). */
export function emptyRecallContinuitySnapshot(): RecallContinuitySnapshot {
  return {
    strategyPacket: null,
    reflectionSummary: null,
    recentStrategicDecisions: [],
    strategicEvidenceVersion: 0,
    strategyPacketRevisionCounter: 0,
  };
}

/**
 * Deterministic evidence-boundary key for process-local selected-reference cache (KTD4).
 * Derived only from actor-visible projection, public + actor-owned Mingle dialogue,
 * authorized huddle outcomes, and continuity snapshot revision — never foreign private material.
 */
export function buildRecallEvidenceBoundaryKey(params: {
  actorId: UUID;
  promptClass: RecallPromptClass;
  continuity: RecallContinuitySnapshot;
  phaseContext: PhaseContext;
  transcript: readonly TranscriptEntry[];
}): string {
  const { actorId, promptClass, continuity, phaseContext, transcript } = params;
  const authorized = collectAuthorizedCandidates(transcript, actorId);
  let maxAuthorizedEntrySequence: number | null = null;
  for (const candidate of authorized) {
    if (maxAuthorizedEntrySequence === null || candidate.entrySequence > maxAuthorizedEntrySequence) {
      maxAuthorizedEntrySequence = candidate.entrySequence;
    }
  }

  const huddleOutcomeIds = (phaseContext.allianceContext?.activeAlliances ?? []).flatMap((alliance) =>
    alliance.huddleOutcomes.map((outcome) => outcome.id),
  );

  const payload = {
    actorId,
    promptClass,
    strategicEvidenceVersion: continuity.strategicEvidenceVersion,
    strategyPacketRevisionCounter: continuity.strategyPacketRevisionCounter ?? 0,
    strategyRevisionId: continuity.strategyPacket?.revisionId ?? null,
    reflectionPlan: continuity.reflectionSummary?.plan ?? null,
    reflectionLens: continuity.reflectionSummary?.strategicLens ?? null,
    recentStrategicDecisions: continuity.recentStrategicDecisions.map((receipt) => ({
      round: receipt.round,
      phase: receipt.phase,
      action: receipt.action,
      label: receipt.label,
      decisionLog: receipt.decisionLog,
    })),
    board: {
      round: phaseContext.round,
      phase: phaseContext.phase,
      alive: phaseContext.alivePlayers.map((player) => player.id).slice().sort(),
      empoweredId: phaseContext.empoweredId ?? null,
      councilCandidates: phaseContext.councilCandidates ?? null,
      endgameStage: phaseContext.endgameStage ?? null,
      finalists: phaseContext.finalists ?? null,
      isEliminated: phaseContext.isEliminated ?? false,
      latestEliminatedPlayerName: phaseContext.latestEliminatedPlayerName ?? null,
    },
    huddleOutcomeIds: huddleOutcomeIds.slice().sort(),
    recentDecisionLabels: (phaseContext.recentDecisions ?? []).map((entry) => ({
      round: entry.round,
      phase: entry.phase,
      label: entry.label,
    })),
    revealedVoteRounds: (phaseContext.revealedVoteLedger ?? []).map((entry) => ({
      round: entry.round,
      voterId: entry.voterId,
      empowerTargetId: entry.empowerTargetId,
    })),
    hotMingle: (phaseContext.mingleMessages ?? []).map((message) => ({
      from: message.from,
      text: message.text,
    })),
    authorizedBoundary: {
      maxAuthorizedEntrySequence,
      authorizedCandidateCount: authorized.length,
    },
  };

  return JSON.stringify(payload);
}

/** Deterministic character→token estimator (KTD5). */
export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export function measureStructuredChars(value: unknown): number {
  return JSON.stringify(value).length;
}

// ---------------------------------------------------------------------------
// Stopwords + tokenization
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "while",
  "of", "to", "for", "in", "on", "at", "by", "with", "from", "as", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "shall", "can",
  "this", "that", "these", "those", "it", "its", "i", "me", "my", "we", "our",
  "you", "your", "he", "she", "they", "them", "their", "who", "what", "which",
  "not", "no", "yes", "so", "than", "too", "very", "just", "about", "into",
  "over", "after", "before", "out", "up", "down", "off", "again", "further",
  "once", "here", "there", "all", "each", "few", "more", "most", "other", "some",
  "such", "only", "own", "same", "both", "any", "how", "why", "now", "also",
  "been", "being", "get", "got", "let", "like", "make", "need", "still", "way",
  "well", "back", "even", "much", "really", "think", "know", "want", "going",
  "gonna", "yeah", "okay", "ok", "hey", "hi", "hello", "please", "thanks",
  "round", "phase", "player", "players", "game", "vote", "votes", "room",
]);

/** Tokenize free text into non-stopword lowercase terms (length ≥ 2). */
export function tokenizeRecallText(text: string): string[] {
  const parts = text.toLowerCase().split(/[^a-z0-9]+/g);
  const out: string[] = [];
  for (const part of parts) {
    if (part.length < 2) continue;
    if (STOPWORDS.has(part)) continue;
    out.push(part);
  }
  return out;
}

function addTokens(sink: Set<string>, text: string | null | undefined): void {
  if (!text) return;
  for (const token of tokenizeRecallText(text)) {
    sink.add(token);
  }
}

function addNameTokens(sink: Set<string>, name: string | null | undefined): void {
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  // Full lowercased name as a multi-token phrase is represented by its tokens.
  addTokens(sink, trimmed);
}

// ---------------------------------------------------------------------------
// Eligibility (authorize before rank — KTD2)
// ---------------------------------------------------------------------------

const INELIGIBLE_SCOPES = new Set<TranscriptEntry["scope"]>([
  "thinking",
  "diary",
  "huddle",
  "whisper",
  "system",
]);

/**
 * True when a transcript row may enter the historical candidate set for actorId.
 * Fail closed: missing/ambiguous modern identity excludes private Mingle.
 * No display-name fallback. No room-membership inference.
 */
export function isActorAuthorizedDialogueCandidate(
  entry: TranscriptEntry,
  actorId: UUID,
): boolean {
  if (INELIGIBLE_SCOPES.has(entry.scope)) return false;
  if (typeof entry.text !== "string" || entry.text.trim().length === 0) return false;
  if (typeof entry.entrySequence !== "number" || !Number.isFinite(entry.entrySequence)) {
    return false;
  }

  if (entry.scope === "public") {
    // Public dialogue is visible to all actors once it carries a dialogue sequence.
    return true;
  }

  if (entry.scope === "mingle") {
    const speakerId = entry.speakerPlayerId;
    if (typeof speakerId !== "string" || speakerId.length === 0) return false;
    if (!Array.isArray(entry.audiencePlayerIds)) return false;
    if (speakerId === actorId) return true;
    return entry.audiencePlayerIds.includes(actorId);
  }

  // Unknown / sealed / producer scopes fail closed.
  return false;
}

export interface ProjectedRecallCandidate {
  entrySequence: number;
  round: number;
  phase: Phase;
  speakerLabel: string;
  dialogueText: string;
  sourceClass: "public" | "mingle";
  /** Stable source order for tie-break: public before mingle. */
  sourceOrder: number;
}

/**
 * Project an authorized transcript row to the narrow safe dialogue shape.
 * Returns null if the row fails the post-eligibility projection checks
 * (callers should have filtered via isActorAuthorizedDialogueCandidate first).
 */
export function projectAuthorizedCandidate(
  entry: TranscriptEntry,
): ProjectedRecallCandidate | null {
  if (typeof entry.entrySequence !== "number" || !Number.isFinite(entry.entrySequence)) {
    return null;
  }
  if (entry.scope !== "public" && entry.scope !== "mingle") {
    return null;
  }
  const sourceClass: "public" | "mingle" = entry.scope;
  return {
    entrySequence: entry.entrySequence,
    round: entry.round,
    phase: entry.phase,
    speakerLabel: entry.from,
    dialogueText: entry.text,
    sourceClass,
    sourceOrder: sourceClass === "public" ? 0 : 1,
  };
}

export function collectAuthorizedCandidates(
  transcript: readonly TranscriptEntry[],
  actorId: UUID,
): ProjectedRecallCandidate[] {
  const out: ProjectedRecallCandidate[] = [];
  for (const entry of transcript) {
    if (!isActorAuthorizedDialogueCandidate(entry, actorId)) continue;
    const projected = projectAuthorizedCandidate(entry);
    if (projected) out.push(projected);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seed compilation
// ---------------------------------------------------------------------------

function collectEliminatedNameTokens(phaseContext: PhaseContext): Set<string> {
  const dead = new Set<string>();
  if (phaseContext.latestEliminatedPlayerName) {
    addNameTokens(dead, phaseContext.latestEliminatedPlayerName);
  }
  if (phaseContext.jury) {
    for (const juror of phaseContext.jury) {
      addNameTokens(dead, juror.playerName);
    }
  }
  return dead;
}

function collectAliveNameTokens(phaseContext: PhaseContext): Set<string> {
  const alive = new Set<string>();
  for (const player of phaseContext.alivePlayers) {
    addNameTokens(alive, player.name);
  }
  addNameTokens(alive, phaseContext.selfName);
  return alive;
}

/**
 * Compile non-stopword seed terms from board, non-conflicting Strategy Thread,
 * exact receipts, and recent strategic decisions. Strategy Thread terms that
 * name eliminated (Board-contradicted) players are removed before seeding.
 */
export function compileRecallSeedTerms(params: {
  promptClass: RecallPromptClass;
  phaseContext: PhaseContext;
  continuity: RecallContinuitySnapshot;
  huddleOutcomes: readonly RecallProtectedHuddleOutcome[];
}): Set<string> {
  const seeds = new Set<string>();
  const { phaseContext, continuity, huddleOutcomes, promptClass } = params;

  // Prompt class as a stable structural seed (does not leak content).
  addTokens(seeds, promptClass.replace(/_/g, " "));

  const aliveNames = collectAliveNameTokens(phaseContext);
  const deadNames = collectEliminatedNameTokens(phaseContext);

  // Board contract seeds
  for (const token of aliveNames) seeds.add(token);
  addTokens(seeds, phaseContext.phase);
  if (phaseContext.endgameStage) addTokens(seeds, phaseContext.endgameStage);
  if (phaseContext.empoweredId) {
    const empowered = phaseContext.alivePlayers.find((p) => p.id === phaseContext.empoweredId);
    if (empowered) addNameTokens(seeds, empowered.name);
  }
  if (phaseContext.councilCandidates) {
    for (const id of phaseContext.councilCandidates) {
      const player = phaseContext.alivePlayers.find((p) => p.id === id);
      if (player) addNameTokens(seeds, player.name);
    }
  }
  if (phaseContext.finalists) {
    for (const id of phaseContext.finalists) {
      const player = phaseContext.alivePlayers.find((p) => p.id === id);
      if (player) addNameTokens(seeds, player.name);
    }
  }
  // Latest elimination is a board fact (historical anchor), not a live target seed from strategy.
  if (phaseContext.latestEliminatedPlayerName) {
    addNameTokens(seeds, phaseContext.latestEliminatedPlayerName);
  }

  // Alliance + compact huddle outcome anchors (commitment language)
  if (phaseContext.allianceContext) {
    for (const alliance of phaseContext.allianceContext.activeAlliances) {
      addTokens(seeds, alliance.name);
      addTokens(seeds, alliance.purpose);
      for (const memberName of alliance.memberNames) {
        addNameTokens(seeds, memberName);
      }
    }
  }
  for (const outcome of huddleOutcomes) {
    addTokens(seeds, outcome.ask);
    addTokens(seeds, outcome.plan);
    addTokens(seeds, outcome.posture);
    for (const promise of outcome.promises) addTokens(seeds, promise);
    for (const claim of outcome.leakOrBetrayalClaims) addTokens(seeds, claim);
  }

  // Exact current receipts
  for (const decision of phaseContext.recentDecisions ?? []) {
    addTokens(seeds, decision.label);
    addTokens(seeds, decision.detail);
  }
  for (const receipt of continuity.recentStrategicDecisions) {
    addTokens(seeds, receipt.label);
    addTokens(seeds, receipt.action);
    addTokens(seeds, receipt.decisionLog);
  }
  for (const entry of phaseContext.revealedVoteLedger ?? []) {
    addNameTokens(seeds, entry.voterName);
    addNameTokens(seeds, entry.empowerTargetName);
    if (entry.exposeTargetName) addNameTokens(seeds, entry.exposeTargetName);
  }

  // Strategy Thread: drop terms contradicted by Board Contract (eliminated names as targets).
  addStrategyThreadSeeds(seeds, continuity.strategyPacket, continuity.reflectionSummary, deadNames, aliveNames);

  return seeds;
}

function addStrategyThreadSeeds(
  seeds: Set<string>,
  packet: StrategyPacketSummary | null,
  reflection: StrategicReflectionSummary | null,
  deadNames: Set<string>,
  aliveNames: Set<string>,
): void {
  const acceptToken = (token: string): boolean => {
    // Drop tokens that name Board-contradicted (eliminated) players.
    if (deadNames.has(token) && !aliveNames.has(token)) return false;
    return true;
  };

  const addFiltered = (text: string | null | undefined): void => {
    if (!text) return;
    for (const token of tokenizeRecallText(text)) {
      if (acceptToken(token)) seeds.add(token);
    }
  };

  if (packet) {
    addFiltered(packet.objective);
    addFiltered(packet.targetPosture);
    addFiltered(packet.coalitionPosture);
    addFiltered(packet.nextSocialProbe);
    addFiltered(packet.strategicLens);
    addFiltered(packet.strategicLensRationale);
    addFiltered(packet.uncertainty);
    addFiltered(packet.reviseTrigger);
    addFiltered(packet.changedSincePrevious);
  }

  if (reflection) {
    for (const item of reflection.certainties) addFiltered(item);
    for (const item of reflection.suspicions) addFiltered(item);
    for (const item of reflection.allies) addFiltered(item);
    for (const item of reflection.threats) addFiltered(item);
    addFiltered(reflection.plan);
    addFiltered(reflection.strategicLens);
    addFiltered(reflection.strategicLensRationale);
  }
}

// ---------------------------------------------------------------------------
// Scoring + ranking
// ---------------------------------------------------------------------------

export interface ScoredRecallCandidate extends ProjectedRecallCandidate {
  overlapCount: number;
  relevanceScore: number;
}

/**
 * Score candidates: zero non-stopword seed overlap → rejected.
 * Recency cannot rescue a zero-match row.
 */
export function scoreAndRankCandidates(
  candidates: readonly ProjectedRecallCandidate[],
  seeds: ReadonlySet<string>,
): ScoredRecallCandidate[] {
  const scored: ScoredRecallCandidate[] = [];
  for (const candidate of candidates) {
    const tokens = tokenizeRecallText(candidate.dialogueText);
    let overlapCount = 0;
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seeds.has(token) && !seen.has(token)) {
        seen.add(token);
        overlapCount += 1;
      }
    }
    if (overlapCount === 0) continue;

    // Lexical relevance: unique seed overlap; light boost for denser short messages.
    const density = overlapCount / Math.max(tokens.length, 1);
    const relevanceScore = overlapCount * 10 + density;

    scored.push({
      ...candidate,
      overlapCount,
      relevanceScore,
    });
  }

  // Higher relevance first; then more recent (higher entrySequence); then source order; then sequence asc as final stable key.
  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    if (b.entrySequence !== a.entrySequence) return b.entrySequence - a.entrySequence;
    if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
    return a.entrySequence - b.entrySequence;
  });

  return scored;
}

// ---------------------------------------------------------------------------
// Board / protected projection
// ---------------------------------------------------------------------------

export function projectBoardContractFacts(phaseContext: PhaseContext): RecallBoardContractFacts {
  const facts: RecallBoardContractFacts = {
    authority: "canonical_board_contract",
    gameId: phaseContext.gameId,
    round: phaseContext.round,
    phase: phaseContext.phase,
    selfId: phaseContext.selfId,
    selfName: phaseContext.selfName,
    alivePlayers: phaseContext.alivePlayers.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.shielded !== undefined ? { shielded: p.shielded } : {}),
    })),
  };
  if (phaseContext.empoweredId !== undefined) facts.empoweredId = phaseContext.empoweredId;
  if (phaseContext.councilCandidates !== undefined) {
    facts.councilCandidates = [...phaseContext.councilCandidates] as [UUID, UUID];
  }
  if (phaseContext.endgameStage !== undefined) facts.endgameStage = phaseContext.endgameStage;
  if (phaseContext.finalists !== undefined) {
    facts.finalists = [...phaseContext.finalists] as [UUID, UUID];
  }
  if (phaseContext.latestEliminatedPlayerName !== undefined) {
    facts.latestEliminatedPlayerName = phaseContext.latestEliminatedPlayerName;
  }
  if (phaseContext.jury !== undefined) facts.jury = phaseContext.jury.map((j) => ({ ...j }));
  if (phaseContext.isEliminated !== undefined) facts.isEliminated = phaseContext.isEliminated;
  return facts;
}

export function projectProtectedHuddleOutcomes(
  phaseContext: PhaseContext,
): RecallProtectedHuddleOutcome[] {
  const alliances = phaseContext.allianceContext?.activeAlliances ?? [];
  const out: RecallProtectedHuddleOutcome[] = [];
  for (const alliance of alliances) {
    for (const outcome of alliance.huddleOutcomes) {
      out.push({
        id: outcome.id,
        round: outcome.round,
        ask: outcome.ask,
        plan: outcome.plan,
        promises: [...outcome.promises],
        dissent: [...outcome.dissent],
        confidence: outcome.confidence,
        posture: outcome.posture,
        leakOrBetrayalClaims: [...outcome.leakOrBetrayalClaims],
      });
    }
  }
  // Stable order by round then id for byte-stable plans.
  out.sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  return out;
}

function projectHotMessages(phaseContext: PhaseContext): RecallHotMessage[] {
  return (phaseContext.mingleMessages ?? []).map((msg) => ({
    from: msg.from,
    text: msg.text,
  }));
}

function cloneReceipts(receipts: readonly StrategicDecisionReceipt[]): StrategicDecisionReceipt[] {
  return receipts.map((r) => ({
    round: r.round,
    phase: r.phase,
    action: r.action,
    label: r.label,
    decisionLog: r.decisionLog,
  }));
}

// ---------------------------------------------------------------------------
// History budget fill
// ---------------------------------------------------------------------------

function historyItemChars(item: RecallHistoryDialogueEvidence): number {
  return measureStructuredChars(item);
}

function fillHistoryWithinBudget(
  ranked: readonly ScoredRecallCandidate[],
  budgetChars: number,
): RecallHistoryDialogueEvidence[] {
  if (budgetChars <= 0 || ranked.length === 0) return [];
  const selected: RecallHistoryDialogueEvidence[] = [];
  let used = 0;
  for (const candidate of ranked) {
    const item: RecallHistoryDialogueEvidence = {
      entrySequence: candidate.entrySequence,
      round: candidate.round,
      phase: candidate.phase,
      speakerLabel: candidate.speakerLabel,
      dialogueText: candidate.dialogueText,
      sourceClass: candidate.sourceClass,
      evidenceRole: "historical_evidence",
    };
    const cost = historyItemChars(item);
    if (used + cost > budgetChars) continue;
    selected.push(item);
    used += cost;
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Compiler entry
// ---------------------------------------------------------------------------

export interface CompileRecallPlanParams {
  actorId: UUID;
  promptClass: RecallPromptClass;
  continuity: RecallContinuitySnapshot;
  phaseContext: PhaseContext;
  transcript: readonly TranscriptEntry[];
}

/**
 * Pure Recall Plan compiler.
 * Given identical authorized inputs, produces a byte-stable plan, budget ledger, and receipt.
 */
export function compileRecallPlan(params: CompileRecallPlanParams): RecallPlan {
  const { actorId, promptClass, continuity, phaseContext, transcript } = params;
  const envelope = RECALL_BUDGET_ENVELOPES[promptClass];

  const boardContract = projectBoardContractFacts(phaseContext);
  const huddleOutcomes = projectProtectedHuddleOutcomes(phaseContext);
  const strategyThread = continuity.strategyPacket
    ? { ...continuity.strategyPacket }
    : null;
  const reflectionSummary = continuity.reflectionSummary
    ? {
        certainties: [...continuity.reflectionSummary.certainties],
        suspicions: [...continuity.reflectionSummary.suspicions],
        allies: [...continuity.reflectionSummary.allies],
        threats: [...continuity.reflectionSummary.threats],
        plan: continuity.reflectionSummary.plan,
        strategicLens: continuity.reflectionSummary.strategicLens,
        strategicLensRationale: continuity.reflectionSummary.strategicLensRationale,
      }
    : null;
  const currentReceipts = {
    recentStrategicDecisions: cloneReceipts(continuity.recentStrategicDecisions),
    recentDecisions: (phaseContext.recentDecisions ?? []).map((d) => ({ ...d })),
    revealedVoteLedger: (phaseContext.revealedVoteLedger ?? []).map((e) => ({ ...e })),
  };

  const protectedLane = {
    boardContract,
    strategyThread,
    reflectionSummary,
    huddleOutcomes,
    currentReceipts,
  };

  const hotMessages = projectHotMessages(phaseContext);
  const hotLane = { activeRoomMessages: hotMessages };

  const protectedChars = measureStructuredChars(protectedLane);
  const hotChars = measureStructuredChars(hotLane);
  const protectedOverflow = protectedChars >= envelope.envelopeChars;

  // History only after protected + hot; ordinary_speech has zero history ceiling.
  const remainingAfterProtectedHot = Math.max(
    0,
    envelope.envelopeChars - protectedChars - hotChars,
  );
  const historyBudgetChars = protectedOverflow
    ? 0
    : Math.min(envelope.historyCeilingChars, remainingAfterProtectedHot);

  // Authorize → project (foreign private rows never enter candidate set or boundary).
  const authorizedCandidates = collectAuthorizedCandidates(transcript, actorId);
  const maxAuthorizedEntrySequence = authorizedCandidates.reduce<number | null>(
    (max, c) => (max === null || c.entrySequence > max ? c.entrySequence : max),
    null,
  );

  const seeds = compileRecallSeedTerms({
    promptClass,
    phaseContext,
    continuity,
    huddleOutcomes,
  });

  let historyEvidence: RecallHistoryDialogueEvidence[] = [];
  if (historyBudgetChars > 0 && promptClass !== "ordinary_speech") {
    const ranked = scoreAndRankCandidates(authorizedCandidates, seeds);
    historyEvidence = fillHistoryWithinBudget(ranked, historyBudgetChars);
  }

  const historyLane = { dialogueEvidence: historyEvidence };
  const historyChars = measureStructuredChars(historyLane);

  const budget: RecallPlanBudgetLedger = {
    envelopeChars: envelope.envelopeChars,
    historyCeilingChars: envelope.historyCeilingChars,
    protectedChars,
    hotChars,
    historyChars,
    historyBudgetChars,
    protectedTokenEstimate: estimateTokensFromChars(protectedChars),
    hotTokenEstimate: estimateTokensFromChars(hotChars),
    historyTokenEstimate: estimateTokensFromChars(historyChars),
    protectedOverflow,
  };

  const protectedRecordCount =
    1 // board contract
    + (strategyThread ? 1 : 0)
    + (reflectionSummary ? 1 : 0)
    + huddleOutcomes.length
    + currentReceipts.recentStrategicDecisions.length
    + currentReceipts.recentDecisions.length
    + currentReceipts.revealedVoteLedger.length;

  const receipt: RecallPlanReceipt = {
    promptClass,
    protectedTokenEstimate: budget.protectedTokenEstimate,
    hotTokenEstimate: budget.hotTokenEstimate,
    historyTokenEstimate: budget.historyTokenEstimate,
    selectedLaneCounts: {
      protected: protectedRecordCount,
      hot: hotMessages.length,
      history: historyEvidence.length,
    },
    selectedByRankSlot: historyEvidence.map((item, index) => ({
      rankSlot: index,
      lane: "history" as const,
      sourceClass: item.sourceClass,
    })),
    eventBoundary: {
      maxAuthorizedEntrySequence,
      authorizedCandidateCount: authorizedCandidates.length,
      protectedRecordCount,
    },
    protectedOverflow,
  };

  return {
    promptClass,
    actorId,
    protected: protectedLane,
    hot: hotLane,
    history: historyLane,
    budget,
    receipt,
  };
}

/** Normalize a plan to a stable JSON string for byte-stability assertions. */
export function serializeRecallPlan(plan: RecallPlan): string {
  return JSON.stringify(plan);
}
