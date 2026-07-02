import type { CanonicalGameEvent, CanonicalGameEventType } from "./canonical-events";
import type {
  CompletedGameResultsElimination,
  CompletedGameResultsJury,
  CompletedGameResultsRead,
  CompletedGameResultsRound,
  CompletedGameResultsVotePattern,
} from "./completed-game-results";
import type {
  RevealedCouncilVoteLedgerEntry,
  RevealedPlayerRef,
  RevealedVoteLedgerEntry,
} from "./revealed-round-facts";
import type { PowerActionType, UUID } from "./types";

export type PostgameAnalysisDetailLevel = "brief" | "standard" | "full";

export type PostgameDerivationConfidence = "high" | "medium" | "low";

export interface PostgameDerivedText {
  text: string;
  confidence: PostgameDerivationConfidence;
  derivationMethod: string;
}

export type PostgameTurningPointType =
  | "power_shift"
  | "majority_consolidation"
  | "alliance_member_cut"
  | "threat_removed"
  | "jury_split"
  | "endgame_pivot"
  | "near_miss";

export interface PostgameAnalysisDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface PostgameAnalysisEvidenceRef {
  eventType: CanonicalGameEventType;
  round: number;
  sequence: number;
  players: RevealedPlayerRef[];
}

export interface PostgameVoteCount {
  player: RevealedPlayerRef;
  votes: number;
}

export interface PostgameFinalVote {
  status: "available" | "unavailable";
  winner: RevealedPlayerRef | null;
  runnerUp: RevealedPlayerRef | null;
  voteCounts: PostgameVoteCount[];
  totalVotes: number;
  margin: number | null;
  method: string | null;
}

export type PostgameBootOrderEntry = CompletedGameResultsElimination;

export interface PostgameRoundSummary {
  round: number;
  phase: string | null;
  headline: PostgameDerivedText | null;
  empowered: RevealedPlayerRef | null;
  empowerVoteCounts: PostgameVoteCount[];
  exposeLeaders: PostgameVoteCount[];
  powerAction: {
    action: PowerActionType | null;
    target: RevealedPlayerRef | null;
  };
  shieldGranted: RevealedPlayerRef | null;
  councilCandidates: RevealedPlayerRef[];
  eliminated: RevealedPlayerRef | null;
  majorityCohort: {
    basis: "council_vote" | "empower_vote" | "unavailable";
    alignedPlayers: RevealedPlayerRef[];
    target: RevealedPlayerRef | null;
    votes: number;
    confidence: PostgameDerivationConfidence;
    derivationMethod: string;
  };
  keyRiskMoments: Array<{
    type: "candidate" | "exposure_leader" | "eliminated" | "survived_council";
    player: RevealedPlayerRef;
    note: string;
  }>;
  diagnostics: PostgameAnalysisDiagnostic[];
  evidence?: PostgameAnalysisEvidenceRef[];
}

export interface PostgameJuryVoteEntry {
  juror: RevealedPlayerRef;
  finalist: RevealedPlayerRef;
  jurorEliminatedRound: number | null;
  votedForMatchingVotePattern: boolean | null;
  votedForFinalistWhoVotedToEliminateThem: boolean | null;
  relationshipFlags: string[];
  evidence?: PostgameAnalysisEvidenceRef[];
}

export interface PostgameJuryBreakdown {
  status: CompletedGameResultsJury["status"];
  finalists: RevealedPlayerRef[];
  winner: RevealedPlayerRef | null;
  finalVote: PostgameFinalVote;
  perJurorVotes: PostgameJuryVoteEntry[];
  juryNarrative: PostgameDerivedText[];
  winnerSupporters: RevealedPlayerRef[];
  runnerUpSupporters: RevealedPlayerRef[];
  /**
   * @deprecated Use juryNarrative. Kept as a temporary compatibility alias.
   */
  narrativeHints: string[];
  /**
   * @deprecated Use runnerUpSupporters. Kept as a temporary compatibility alias.
   */
  nonWinnerSupporters: RevealedPlayerRef[];
  evidence?: PostgameAnalysisEvidenceRef[];
}

export interface PostgamePlayerVoteByRound {
  round: number;
  empowerTarget: RevealedPlayerRef | null;
  exposeTarget: RevealedPlayerRef | null;
  revoteEmpowerTarget: RevealedPlayerRef | null;
}

export interface PostgamePlayerMajorityAlignment {
  round: number;
  empowerAligned: boolean | null;
  councilAligned: boolean | null;
  aligned: boolean | null;
  basis: Array<"empower" | "council">;
}

export type PostgamePlayerShapeValue =
  | "power player"
  | "social survivor"
  | "under the radar"
  | "swing voter"
  | "consensus target"
  | "jury favorite";

export interface PostgamePlayerShape {
  value: PostgamePlayerShapeValue | null;
  confidence: PostgameDerivationConfidence;
  derivationMethod: string;
  supportingSignals: string[];
  diagnostics: PostgameAnalysisDiagnostic[];
}

export interface PostgamePlayerGameSummary {
  player: RevealedPlayerRef;
  placement: number | null;
  status: "winner" | "finalist" | "eliminated" | "unknown";
  eliminatedRound: number | null;
  won: boolean;
  votesCastByRound: PostgamePlayerVoteByRound[];
  empowerVotesReceivedByRound: Array<{ round: number; votes: number }>;
  exposeVotesReceivedByRound: Array<{ round: number; votes: number }>;
  councilVotesCast: Array<{ round: number; target: RevealedPlayerRef }>;
  councilVotesReceived: Array<{ round: number; votes: number }>;
  powersUsed: Array<{ round: number; action: PowerActionType; target: RevealedPlayerRef | null }>;
  shieldsReceived: Array<{ round: number; from: RevealedPlayerRef | null }>;
  majorityAlignmentByRound: PostgamePlayerMajorityAlignment[];
  timesNominated: Array<{ round: number; candidates: RevealedPlayerRef[]; eliminated: boolean }>;
  atRiskMoments: Array<{ round: number; type: "exposure_leader" | "council_candidate" | "endgame_target"; note: string }>;
  endgame: {
    finalist: boolean;
    endgameVotesCast: Array<{ round: number; target: RevealedPlayerRef }>;
    endgameVotesReceived: Array<{ round: number; votes: number }>;
    eliminatedByEndgame: boolean;
  };
  jury: {
    finalist: boolean;
    juror: boolean;
    voteCastFor: RevealedPlayerRef | null;
    votesReceived: number;
    wonFinalVote: boolean;
  };
  overallGameShape: PostgamePlayerShape;
  readableSummary: string;
  diagnostics: PostgameAnalysisDiagnostic[];
  evidence?: PostgameAnalysisEvidenceRef[];
}

export interface PostgameTurningPoint {
  round: number;
  type: PostgameTurningPointType;
  players: RevealedPlayerRef[];
  confidence: PostgameDerivationConfidence;
  description: string;
  derivationMethod: string;
  criteria: Record<string, unknown>;
  evidence: {
    factRefs: string[];
    eventRefs?: PostgameAnalysisEvidenceRef[];
  };
}

export type PostgameHighlightedEliminationReason =
  | "first_elimination"
  | "final_pre_jury_elimination"
  | "first_jury_member"
  | "endgame_elimination"
  | "winner_final_opponent"
  | "top_empowered_player"
  | "top_exposed_player";

export interface PostgameHighlightedElimination extends CompletedGameResultsElimination {
  highlightReasons: PostgameHighlightedEliminationReason[];
  confidence: PostgameDerivationConfidence;
  derivationMethod: "highlighted_elimination_rules";
}

export interface PostgameDerivedVoteCohort {
  basis: "derived_vote_cohesion";
  players: RevealedPlayerRef[];
  size: number;
  firstObservedRound: number;
  lastObservedRound: number;
  roundsControlled: number[];
  sharedVotes: Array<{
    round: number;
    target: RevealedPlayerRef | null;
    basis: "council_vote" | "empower_vote";
  }>;
  /**
   * @deprecated Use sharedVotes. Kept as a temporary compatibility alias.
   */
  targets: Array<{ round: number; target: RevealedPlayerRef | null; basis: string }>;
  cohesionScore: number;
  confidence: PostgameDerivationConfidence;
  derivationMethod: "shared_vote_outcomes";
  note: string;
}

export interface PostgameMomentumSegment {
  round: number;
  firstObservedRound: number;
  lastObservedRound: number;
  leader:
    | { kind: "player"; player: RevealedPlayerRef }
    | { kind: "cohort"; players: RevealedPlayerRef[] };
  indicators: Array<"empowerment" | "majority_vote" | "endgame_progression" | "jury_result">;
  confidence: PostgameDerivationConfidence;
  derivationMethod: string;
  criteria: Record<string, unknown>;
}

export interface PostgameAnalysisProjection {
  schemaVersion: 2;
  source: CompletedGameResultsRead["source"];
  availability: CompletedGameResultsRead["availability"];
  executiveSummary: PostgameDerivedText[];
  summary: {
    winner: RevealedPlayerRef | null;
    finalists: RevealedPlayerRef[];
    finalVote: PostgameFinalVote;
    bootOrder: PostgameBootOrderEntry[];
    roundCount: number;
    playerCount: number;
    dominantEmpoweredPlayers: PostgameVoteCount[];
    mostExposedPlayers: PostgameVoteCount[];
    unanimousOrNearUnanimousVotes: Array<{
      round: number | null;
      voteType: "empower" | "council" | "jury";
      target: RevealedPlayerRef;
      votes: number;
      totalVotes: number;
      unanimous: boolean;
    }>;
    highlightedEliminations: PostgameHighlightedElimination[];
    /**
     * @deprecated Use highlightedEliminations. Kept as a temporary compatibility alias.
     */
    majorEliminations: PostgameHighlightedElimination[];
    notableEndgameSequence: Array<{
      round: number;
      stage: string | null;
      eliminated: RevealedPlayerRef;
      method: string;
    }>;
  };
  derivedVoteCohorts: PostgameDerivedVoteCohort[];
  gameMomentum: PostgameMomentumSegment[];
  roundSummaries: PostgameRoundSummary[];
  jury: PostgameJuryBreakdown;
  playerSummaries: PostgamePlayerGameSummary[];
  turningPoints: PostgameTurningPoint[];
  diagnostics: PostgameAnalysisDiagnostic[];
}

export interface BuildPostgameAnalysisOptions {
  completedResults: CompletedGameResultsRead;
  events?: readonly CanonicalGameEvent[];
  includeEvidence?: boolean;
}

export function buildPostgameAnalysisProjection(
  options: BuildPostgameAnalysisOptions,
): PostgameAnalysisProjection {
  const completed = options.completedResults;
  const includeEvidence = options.includeEvidence === true;
  const diagnostics = completed.availability.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  const eventRefs = new EventReferenceIndex(options.events ?? []);
  const baseRoundSummaries = completed.rounds.map((round) =>
    buildRoundSummary(round, includeEvidence ? eventRefs : null)
  );
  const roundSummaries = addRoundHeadlines(baseRoundSummaries);
  const finalVote = buildFinalVote(completed.jury);
  const jury = buildJuryBreakdown(completed, finalVote, includeEvidence ? eventRefs : null);
  const bootOrder = buildPostgameBootOrder(completed);
  const dominantEmpoweredPlayers = topCounts(countPlayers(
    roundSummaries.flatMap((round) => round.empowered ? [round.empowered] : []),
  ));
  const mostExposedPlayers = topCounts(sumExposed(roundSummaries));
  const highlightedEliminations = buildHighlightedEliminations({
    bootOrder,
    finalVote,
    dominantEmpoweredPlayers,
    mostExposedPlayers,
  });
  const derivedVoteCohorts = buildDerivedVoteCohorts({
    completed,
    roundSummaries,
  });
  const gameMomentum = buildGameMomentum({
    completed,
    roundSummaries,
    derivedVoteCohorts,
    finalVote,
  });
  const playerSummaries = completed.players.map((player) =>
    buildPlayerSummary({
      player,
      completed,
      roundSummaries,
      finalVote,
      eventRefs: includeEvidence ? eventRefs : null,
    })
  );
  const turningPoints = buildTurningPoints({
    completed,
    roundSummaries,
    finalVote,
    eventRefs: includeEvidence ? eventRefs : null,
  });
  const executiveSummary = buildExecutiveSummary({
    completed,
    roundSummaries,
    finalVote,
    highlightedEliminations,
    gameMomentum,
  });

  return {
    schemaVersion: 2,
    source: completed.source,
    availability: completed.availability,
    executiveSummary,
    summary: {
      winner: completed.summary.winner,
      finalists: completed.summary.finalists,
      finalVote,
      bootOrder,
      roundCount: completed.summary.roundsPlayed,
      playerCount: completed.summary.playerCount,
      dominantEmpoweredPlayers,
      mostExposedPlayers,
      unanimousOrNearUnanimousVotes: findUnanimousOrNearUnanimousVotes(completed, finalVote),
      highlightedEliminations,
      majorEliminations: highlightedEliminations,
      notableEndgameSequence: completed.rounds.flatMap((round) =>
        round.endgameEliminations.map((entry) => ({
          round: entry.round,
          stage: entry.stage,
          eliminated: entry.eliminated,
          method: entry.method,
        }))
      ),
    },
    derivedVoteCohorts,
    gameMomentum,
    roundSummaries,
    jury,
    playerSummaries,
    turningPoints,
    diagnostics,
  };
}

function buildRoundSummary(
  round: CompletedGameResultsRound,
  eventRefs: EventReferenceIndex | null,
): PostgameRoundSummary {
  const facts = round.canonicalFacts.roundFacts;
  const standard = facts.standardVote;
  const power = facts.power;
  const council = facts.council;
  const councilCandidates = council.candidates.length > 0
    ? council.candidates
    : power.finalCouncilCandidates;
  const exposeLeaders = [...power.exposureScores]
    .sort(byVotesThenName)
    .slice(0, 3);
  const majorityCohort = buildRoundMajorityCohort(
    standard.ledger,
    council.ledger,
    standard.empowered,
    council.eliminated,
  );
  const riskPlayers = new Map<string, { player: RevealedPlayerRef; types: Set<PostgameRoundSummary["keyRiskMoments"][number]["type"]> }>();
  for (const player of councilCandidates) {
    addRisk(riskPlayers, player, "candidate");
  }
  for (const entry of exposeLeaders.slice(0, 2)) {
    if (entry.votes > 0) addRisk(riskPlayers, entry.player, "exposure_leader");
  }
  if (council.eliminated) addRisk(riskPlayers, council.eliminated, "eliminated");
  for (const player of councilCandidates) {
    if (council.eliminated && player.id !== council.eliminated.id) {
      addRisk(riskPlayers, player, "survived_council");
    }
  }

  const action = power.action?.action ?? null;
  const target = action === "pass" ? null : power.action?.target ?? null;
  const evidence = eventRefs?.forRound(round.round, [
    "vote.empower_tally_resolved",
    "power.candidates_resolved",
    "council.elimination_resolved",
  ], [
    ...(standard.empowered ? [standard.empowered] : []),
    ...councilCandidates,
    ...(council.eliminated ? [council.eliminated] : []),
  ]);

  return {
    round: round.round,
    phase: facts.phase,
    headline: null,
    empowered: standard.empowered,
    empowerVoteCounts: standard.empowerTally,
    exposeLeaders,
    powerAction: { action, target },
    shieldGranted: power.shieldGranted,
    councilCandidates,
    eliminated: council.eliminated ?? power.autoEliminated,
    majorityCohort,
    keyRiskMoments: Array.from(riskPlayers.values()).flatMap(({ player, types }) =>
      Array.from(types).map((type) => ({
        type,
        player,
        note: riskNote(type, player),
      }))
    ),
    diagnostics: postgameRoundDiagnostics(round),
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
}

function addRoundHeadlines(roundSummaries: readonly PostgameRoundSummary[]): PostgameRoundSummary[] {
  return roundSummaries.map((round, index) => ({
    ...round,
    headline: roundHeadline(round, roundSummaries[index - 1] ?? null),
  }));
}

function roundHeadline(
  round: PostgameRoundSummary,
  previousRound: PostgameRoundSummary | null,
): PostgameDerivedText | null {
  if (round.eliminated) {
    return {
      text: `${round.eliminated.name} is eliminated.`,
      confidence: "high",
      derivationMethod: "round_elimination",
    };
  }
  const enteredEndgame = round.phase && NON_STANDARD_POSTGAME_PHASES.has(round.phase) &&
    !(previousRound?.phase && NON_STANDARD_POSTGAME_PHASES.has(previousRound.phase));
  if (enteredEndgame) {
    return {
      text: "Endgame begins.",
      confidence: "high",
      derivationMethod: "first_non_standard_postgame_phase",
    };
  }
  if (round.empowered && previousRound?.empowered?.id === round.empowered.id) {
    return {
      text: `${round.empowered.name} controls power again.`,
      confidence: "high",
      derivationMethod: "consecutive_empowerment",
    };
  }
  const survivor = round.keyRiskMoments.find((moment) => moment.type === "survived_council");
  if (survivor) {
    return {
      text: `${survivor.player.name} survives the Council vote.`,
      confidence: "medium",
      derivationMethod: "survived_council_slate",
    };
  }
  if (round.shieldGranted) {
    return {
      text: `${round.shieldGranted.name} receives a shield.`,
      confidence: "high",
      derivationMethod: "shield_granted",
    };
  }
  if (round.majorityCohort.target && round.majorityCohort.basis !== "unavailable") {
    return {
      text: `The vote centers on ${round.majorityCohort.target.name}.`,
      confidence: round.majorityCohort.confidence,
      derivationMethod: "visible_majority_vote_target",
    };
  }
  return null;
}

function buildPostgameBootOrder(completed: CompletedGameResultsRead): PostgameBootOrderEntry[] {
  const finalistIds = new Set(completed.summary.finalists.map((player) => player.id));
  return completed.eliminationOrder.map((entry) => ({
    ...entry,
    juryMember: entry.juryMember && !finalistIds.has(entry.player.id),
  }));
}

const EXPECTED_NON_STANDARD_ROUND_DIAGNOSTIC_CODES = new Set([
  "standard_vote_not_yet_resolved",
  "power_not_yet_resolved",
  "council_not_yet_resolved",
]);

const NON_STANDARD_POSTGAME_PHASES = new Set([
  "RECKONING",
  "PLEA",
  "TRIBUNAL",
  "ACCUSATION",
  "DEFENSE",
  "OPENING_STATEMENTS",
  "JURY_QUESTIONS",
  "CLOSING_ARGUMENTS",
  "JURY_VOTE",
]);

function postgameRoundDiagnostics(round: CompletedGameResultsRound): PostgameAnalysisDiagnostic[] {
  const diagnostics = round.canonicalFacts.availability.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  const phase = round.canonicalFacts.roundFacts.phase;
  const isExpectedNonStandardRound =
    round.endgameEliminations.length > 0 ||
    (phase !== null && NON_STANDARD_POSTGAME_PHASES.has(phase));
  if (!isExpectedNonStandardRound) return diagnostics;
  return diagnostics.filter((diagnostic) => !EXPECTED_NON_STANDARD_ROUND_DIAGNOSTIC_CODES.has(diagnostic.code));
}

function buildRoundMajorityCohort(
  standardLedger: readonly RevealedVoteLedgerEntry[],
  councilLedger: readonly RevealedCouncilVoteLedgerEntry[],
  empowered: RevealedPlayerRef | null,
  eliminated: RevealedPlayerRef | null,
): PostgameRoundSummary["majorityCohort"] {
  if (eliminated && councilLedger.length > 0) {
    const aligned = councilLedger
      .filter((entry) => entry.target.id === eliminated.id)
      .map((entry) => entry.voter);
    if (aligned.length > 0) {
      return {
        basis: "council_vote",
        alignedPlayers: aligned,
        target: eliminated,
        votes: aligned.length,
        confidence: confidenceForShare(aligned.length, councilLedger.length),
        derivationMethod: "majority_vote_target_match",
      };
    }
  }

  if (empowered && standardLedger.length > 0) {
    const aligned = standardLedger
      .filter((entry) => (entry.revoteEmpowerTarget ?? entry.empowerTarget).id === empowered.id)
      .map((entry) => entry.voter);
    return {
      basis: "empower_vote",
      alignedPlayers: aligned,
      target: empowered,
      votes: aligned.length,
      confidence: confidenceForShare(aligned.length, standardLedger.length),
      derivationMethod: "majority_vote_target_match",
    };
  }

  return {
    basis: "unavailable",
    alignedPlayers: [],
    target: null,
    votes: 0,
    confidence: "low",
    derivationMethod: "unavailable_vote_target",
  };
}

function buildFinalVote(jury: CompletedGameResultsJury): PostgameFinalVote {
  if (jury.status !== "available" || !jury.winner) {
    return {
      status: "unavailable",
      winner: null,
      runnerUp: null,
      voteCounts: [],
      totalVotes: 0,
      margin: null,
      method: jury.method,
    };
  }
  const sorted = [...jury.voteCounts].sort(byVotesThenName);
  const winnerCount = sorted.find((entry) => entry.finalist.id === jury.winner?.id)?.votes ?? 0;
  const runnerUp = sorted.find((entry) => entry.finalist.id !== jury.winner?.id)?.finalist ?? null;
  const runnerUpVotes = sorted.find((entry) => entry.finalist.id !== jury.winner?.id)?.votes ?? 0;
  return {
    status: "available",
    winner: jury.winner,
    runnerUp,
    voteCounts: jury.voteCounts.map((entry) => ({
      player: entry.finalist,
      votes: entry.votes,
    })),
    totalVotes: jury.voteCounts.reduce((sum, entry) => sum + entry.votes, 0),
    margin: winnerCount - runnerUpVotes,
    method: jury.method,
  };
}

function buildJuryBreakdown(
  completed: CompletedGameResultsRead,
  finalVote: PostgameFinalVote,
  eventRefs: EventReferenceIndex | null,
): PostgameJuryBreakdown {
  const eliminatedRounds = eliminatedRoundMap(completed.eliminationOrder);
  const votePatterns = votePatternMap(completed.votePatterns);
  const finalistVoteCounts = new Map(finalVote.voteCounts.map((entry) => [entry.player.id, entry.votes]));
  const perJurorVotes = completed.jury.ledger.map((entry) => {
    const jurorPattern = votePatterns.get(entry.juror.id);
    const finalistPattern = votePatterns.get(entry.finalist.id);
    const votedForMatchingVotePattern = jurorPattern && finalistPattern
      ? jurorPattern.groupKey === finalistPattern.groupKey
      : null;
    const finalistVotedToEliminateJuror = didPlayerVoteToEliminate(
      completed.rounds,
      entry.finalist.id,
      entry.juror.id,
    );
    const flags = [];
    if (votedForMatchingVotePattern) flags.push("voted_for_matching_vote_pattern");
    if (finalistVotedToEliminateJuror) flags.push("voted_for_finalist_who_voted_to_eliminate_them");
    const evidence = eventRefs?.forRound(null, ["jury.vote_cast"], [entry.juror, entry.finalist]);
    return {
      juror: entry.juror,
      finalist: entry.finalist,
      jurorEliminatedRound: eliminatedRounds.get(entry.juror.id) ?? null,
      votedForMatchingVotePattern,
      votedForFinalistWhoVotedToEliminateThem: finalistVotedToEliminateJuror,
      relationshipFlags: flags,
      ...(evidence && evidence.length > 0 ? { evidence } : {}),
    };
  });

  const winnerId = finalVote.winner?.id;
  const winnerSupporters = winnerId
    ? perJurorVotes
      .filter((entry) => entry.finalist.id === winnerId)
      .map((entry) => entry.juror)
    : [];
  const runnerUpId = finalVote.runnerUp?.id;
  const runnerUpSupporters = runnerUpId
    ? perJurorVotes
      .filter((entry) => entry.finalist.id === runnerUpId)
      .map((entry) => entry.juror)
    : winnerId
      ? perJurorVotes
        .filter((entry) => entry.finalist.id !== winnerId)
        .map((entry) => entry.juror)
      : [];
  const juryNarrative = buildJuryNarrative(perJurorVotes, finalVote, finalistVoteCounts);
  const nonWinnerSupporters = runnerUpSupporters;
  const narrativeHints = juryNarrative.map((line) => line.text);
  const evidence = eventRefs?.forRound(null, ["jury.winner_determined"], completed.jury.finalists);

  return {
    status: completed.jury.status,
    finalists: completed.jury.finalists,
    winner: completed.jury.winner,
    finalVote,
    perJurorVotes,
    juryNarrative,
    winnerSupporters,
    runnerUpSupporters,
    narrativeHints,
    nonWinnerSupporters,
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
}

function buildJuryNarrative(
  perJurorVotes: readonly PostgameJuryVoteEntry[],
  finalVote: PostgameFinalVote,
  finalistVoteCounts: Map<string, number>,
): PostgameDerivedText[] {
  if (!finalVote.winner || !finalVote.runnerUp || perJurorVotes.length === 0) return [];
  const sorted = [...perJurorVotes].sort((left, right) =>
    (left.jurorEliminatedRound ?? Number.MAX_SAFE_INTEGER) -
    (right.jurorEliminatedRound ?? Number.MAX_SAFE_INTEGER) ||
    left.juror.name.localeCompare(right.juror.name)
  );
  const midpoint = Math.ceil(sorted.length / 2);
  const early = sorted.slice(0, midpoint);
  const late = sorted.slice(midpoint);
  const lines: PostgameDerivedText[] = [];
  const earlyWinnerVotes = early.filter((entry) => entry.finalist.id === finalVote.winner?.id).length;
  const lateRunnerUpVotes = late.filter((entry) => entry.finalist.id === finalVote.runnerUp?.id).length;
  if (early.length > 0 && earlyWinnerVotes > early.length / 2) {
    lines.push({
      text: `Early jurors favored ${finalVote.winner.name}.`,
      confidence: "high",
      derivationMethod: "jury_vote_elimination_order_split",
    });
  }
  if (late.length > 0 && lateRunnerUpVotes >= late.length / 2) {
    lines.push({
      text: `Later jurors favored ${finalVote.runnerUp.name}.`,
      confidence: "high",
      derivationMethod: "jury_vote_elimination_order_split",
    });
  }
  const maxVotes = Math.max(...Array.from(finalistVoteCounts.values()), 0);
  const minVotes = Math.min(...Array.from(finalistVoteCounts.values()), maxVotes);
  if (maxVotes > 0 && maxVotes - minVotes > 0) {
    lines.push({
      text: `Final margin: ${marginText(maxVotes - minVotes)}.`,
      confidence: "high",
      derivationMethod: "final_jury_vote_margin",
    });
  }
  return lines;
}

function marginText(margin: number): string {
  return margin === 1 ? "one vote" : `${margin} votes`;
}

function buildPlayerSummary(input: {
  player: { id: UUID; name: string; placement: number | null; status: "winner" | "finalist" | "eliminated" | "unknown" };
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
  finalVote: PostgameFinalVote;
  eventRefs: EventReferenceIndex | null;
}): PostgamePlayerGameSummary {
  const { player, completed, roundSummaries, finalVote, eventRefs } = input;
  const eliminated = completed.eliminationOrder.find((entry) => entry.player.id === player.id);
  const votesCastByRound: PostgamePlayerVoteByRound[] = [];
  const empowerVotesReceivedByRound: Array<{ round: number; votes: number }> = [];
  const exposeVotesReceivedByRound: Array<{ round: number; votes: number }> = [];
  const councilVotesCast: Array<{ round: number; target: RevealedPlayerRef }> = [];
  const councilVotesReceived: Array<{ round: number; votes: number }> = [];
  const powersUsed: Array<{ round: number; action: PowerActionType; target: RevealedPlayerRef | null }> = [];
  const shieldsReceived: Array<{ round: number; from: RevealedPlayerRef | null }> = [];
  const majorityAlignmentByRound: PostgamePlayerMajorityAlignment[] = [];
  const timesNominated: Array<{ round: number; candidates: RevealedPlayerRef[]; eliminated: boolean }> = [];
  const atRiskMoments: PostgamePlayerGameSummary["atRiskMoments"] = [];
  const endgameVotesCast: Array<{ round: number; target: RevealedPlayerRef }> = [];
  const endgameVotesReceived: Array<{ round: number; votes: number }> = [];

  for (const round of completed.rounds) {
    const facts = round.canonicalFacts.roundFacts;
    const standardVote = facts.standardVote.ledger.find((entry) => entry.voter.id === player.id);
    if (standardVote) {
      votesCastByRound.push({
        round: round.round,
        empowerTarget: standardVote.empowerTarget,
        exposeTarget: standardVote.exposeTarget,
        revoteEmpowerTarget: standardVote.revoteEmpowerTarget,
      });
    }
    empowerVotesReceivedByRound.push({
      round: round.round,
      votes: facts.standardVote.empowerTally.find((entry) => entry.player.id === player.id)?.votes ?? 0,
    });
    exposeVotesReceivedByRound.push({
      round: round.round,
      votes: facts.power.exposureScores.find((entry) => entry.player.id === player.id)?.votes ?? 0,
    });
    const councilCast = facts.council.ledger.find((entry) => entry.voter.id === player.id);
    if (councilCast) councilVotesCast.push({ round: round.round, target: councilCast.target });
    const councilReceived = facts.council.ledger.filter((entry) => entry.target.id === player.id).length;
    if (councilReceived > 0) councilVotesReceived.push({ round: round.round, votes: councilReceived });
    const roundSummary = roundSummaries.find((summary) => summary.round === round.round);
    if (roundSummary?.empowered?.id === player.id && roundSummary.powerAction.action) {
      powersUsed.push({
        round: round.round,
        action: roundSummary.powerAction.action,
        target: roundSummary.powerAction.target,
      });
    }
    if (facts.power.shieldGranted?.id === player.id) {
      shieldsReceived.push({ round: round.round, from: facts.standardVote.empowered });
    }
    const candidates = facts.council.candidates.length > 0
      ? facts.council.candidates
      : facts.power.finalCouncilCandidates;
    if (candidates.some((candidate) => candidate.id === player.id)) {
      timesNominated.push({
        round: round.round,
        candidates,
        eliminated: facts.council.eliminated?.id === player.id,
      });
      atRiskMoments.push({
        round: round.round,
        type: "council_candidate",
        note: `${player.name} was on the Council slate.`,
      });
    }
    const exposureLeader = facts.power.exposureScores[0];
    if (exposureLeader?.player.id === player.id && exposureLeader.votes > 0) {
      atRiskMoments.push({
        round: round.round,
        type: "exposure_leader",
        note: `${player.name} led expose pressure with ${exposureLeader.votes} votes.`,
      });
    }
    majorityAlignmentByRound.push(alignmentForPlayer(roundSummary, player.id));
    for (const endgame of round.endgameEliminations) {
      const cast = endgame.ledger.find((entry) => entry.voter.id === player.id);
      if (cast) endgameVotesCast.push({ round: endgame.round, target: cast.target });
      const received = endgame.ledger.filter((entry) => entry.target.id === player.id).length;
      if (received > 0) {
        endgameVotesReceived.push({ round: endgame.round, votes: received });
        atRiskMoments.push({
          round: endgame.round,
          type: "endgame_target",
          note: `${player.name} received ${received} endgame elimination vote${received === 1 ? "" : "s"}.`,
        });
      }
    }
  }

  const juryVoteCast = completed.jury.ledger.find((entry) => entry.juror.id === player.id)?.finalist ?? null;
  const finalVotesReceived = finalVote.voteCounts.find((entry) => entry.player.id === player.id)?.votes ?? 0;
  const finalist = completed.summary.finalists.some((finalistPlayer) => finalistPlayer.id === player.id);
  const evidence = eventRefs?.forPlayer(player, [
    "vote.cast",
    "council.vote_cast",
    "endgame.elimination_vote_cast",
    "jury.vote_cast",
    "jury.winner_determined",
  ]);
  const overallGameShape = buildOverallGameShape({
    player,
    roundSummaries,
    finalVote,
    empowerVotesReceivedByRound,
    exposeVotesReceivedByRound,
    councilVotesReceived,
    majorityAlignmentByRound,
    timesNominated,
    atRiskMoments,
    finalist,
  });
  const diagnostics = [
    ...completed.availability.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    ...overallGameShape.diagnostics,
  ];

  return {
    player,
    placement: player.placement,
    status: player.status,
    eliminatedRound: eliminated?.round ?? null,
    won: player.status === "winner",
    votesCastByRound,
    empowerVotesReceivedByRound,
    exposeVotesReceivedByRound,
    councilVotesCast,
    councilVotesReceived,
    powersUsed,
    shieldsReceived,
    majorityAlignmentByRound,
    timesNominated,
    atRiskMoments,
    endgame: {
      finalist,
      endgameVotesCast,
      endgameVotesReceived,
      eliminatedByEndgame: eliminated?.source === "endgame",
    },
    jury: {
      finalist,
      juror: completed.jury.ledger.some((entry) => entry.juror.id === player.id),
      voteCastFor: juryVoteCast,
      votesReceived: finalVotesReceived,
      wonFinalVote: finalVote.winner?.id === player.id,
    },
    overallGameShape,
    readableSummary: readablePlayerSummary(player, majorityAlignmentByRound, finalVote, eliminated),
    diagnostics,
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
}

function buildOverallGameShape(input: {
  player: { id: UUID; name: string; status: "winner" | "finalist" | "eliminated" | "unknown" };
  roundSummaries: readonly PostgameRoundSummary[];
  finalVote: PostgameFinalVote;
  empowerVotesReceivedByRound: ReadonlyArray<{ round: number; votes: number }>;
  exposeVotesReceivedByRound: ReadonlyArray<{ round: number; votes: number }>;
  councilVotesReceived: ReadonlyArray<{ round: number; votes: number }>;
  majorityAlignmentByRound: readonly PostgamePlayerMajorityAlignment[];
  timesNominated: ReadonlyArray<{ round: number; candidates: RevealedPlayerRef[]; eliminated: boolean }>;
  atRiskMoments: ReadonlyArray<PostgamePlayerGameSummary["atRiskMoments"][number]>;
  finalist: boolean;
}): PostgamePlayerShape {
  const candidates: Array<{
    value: PostgamePlayerShapeValue;
    confidence: PostgameDerivationConfidence;
    signals: string[];
  }> = [];
  const totalResolvedRounds = input.roundSummaries.filter((round) => round.majorityCohort.basis !== "unavailable").length;
  const empoweredRounds = input.roundSummaries.filter((round) => round.empowered?.id === input.player.id).length;
  const exposureVotes = input.exposeVotesReceivedByRound.reduce((sum, entry) => sum + entry.votes, 0);
  const councilVotes = input.councilVotesReceived.reduce((sum, entry) => sum + entry.votes, 0);
  const alignedRounds = input.majorityAlignmentByRound.filter((round) => round.aligned !== null);
  const majorityAligned = alignedRounds.filter((round) => round.aligned === true).length;
  const majorityNotAligned = alignedRounds.filter((round) => round.aligned === false).length;
  const powerShare = totalResolvedRounds > 0 ? empoweredRounds / totalResolvedRounds : 0;
  const isPowerPlayer = empoweredRounds >= 3 || powerShare >= 0.35;
  if (isPowerPlayer) {
    candidates.push({
      value: "power player",
      confidence: empoweredRounds >= 3 ? "high" : "medium",
      signals: [`empowered_rounds:${empoweredRounds}`, `resolved_round_share:${roundToTwo(powerShare)}`],
    });
  }
  if (input.finalist && input.atRiskMoments.length >= 2 && !isPowerPlayer) {
    candidates.push({
      value: "social survivor",
      confidence: input.atRiskMoments.length >= 3 ? "high" : "medium",
      signals: [`at_risk_moments:${input.atRiskMoments.length}`, "finalist:true"],
    });
  }
  if (input.finalist && exposureVotes <= 1 && councilVotes <= 1 && input.timesNominated.length === 0) {
    candidates.push({
      value: "under the radar",
      confidence: "high",
      signals: [
        `expose_votes_received:${exposureVotes}`,
        `council_votes_received:${councilVotes}`,
        "nominations:0",
      ],
    });
  }
  if (majorityAligned >= 2 && majorityNotAligned >= 2) {
    candidates.push({
      value: "swing voter",
      confidence: majorityAligned >= 3 && majorityNotAligned >= 3 ? "high" : "medium",
      signals: [`majority_aligned_rounds:${majorityAligned}`, `non_aligned_rounds:${majorityNotAligned}`],
    });
  }
  if (
    input.timesNominated.length >= 2 ||
    input.exposeVotesReceivedByRound.filter((entry) => entry.votes > 0).length >= 2 ||
    input.councilVotesReceived.filter((entry) => entry.votes >= 2).length >= 1
  ) {
    candidates.push({
      value: "consensus target",
      confidence: input.timesNominated.length >= 2 ? "high" : "medium",
      signals: [
        `nominations:${input.timesNominated.length}`,
        `expose_vote_rounds:${input.exposeVotesReceivedByRound.filter((entry) => entry.votes > 0).length}`,
      ],
    });
  }
  const playerJuryVotes = input.finalVote.voteCounts.find((entry) => entry.player.id === input.player.id)?.votes ?? 0;
  const maxJuryVotes = Math.max(...input.finalVote.voteCounts.map((entry) => entry.votes), 0);
  if (input.finalist && playerJuryVotes > 0 && playerJuryVotes === maxJuryVotes) {
    candidates.push({
      value: "jury favorite",
      confidence: (input.finalVote.margin ?? 0) >= 2 ? "high" : "medium",
      signals: [`jury_votes:${playerJuryVotes}`, `final_margin:${input.finalVote.margin ?? "unknown"}`],
    });
  }

  if (candidates.length === 0) {
    return {
      value: null,
      confidence: "low",
      derivationMethod: "measurable_shape_thresholds",
      supportingSignals: [],
      diagnostics: [{
        code: "player_shape_threshold_not_met",
        severity: "info",
        message: `No overall game-shape threshold was met for ${input.player.name}.`,
      }],
    };
  }

  const ranked = [...candidates].sort((left, right) =>
    confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
    left.value.localeCompare(right.value)
  );
  const bestRank = confidenceRank(ranked[0]!.confidence);
  const tied = ranked.filter((candidate) => confidenceRank(candidate.confidence) === bestRank);
  if (tied.length > 1) {
    return {
      value: null,
      confidence: ranked[0]!.confidence,
      derivationMethod: "measurable_shape_thresholds",
      supportingSignals: tied.flatMap((candidate) => candidate.signals),
      diagnostics: [{
        code: "player_shape_ambiguous",
        severity: "info",
        message: `${input.player.name} matched multiple same-confidence game-shape thresholds.`,
      }],
    };
  }

  const best = ranked[0]!;
  return {
    value: best.value,
    confidence: best.confidence,
    derivationMethod: "measurable_shape_thresholds",
    supportingSignals: best.signals,
    diagnostics: [],
  };
}

function confidenceRank(confidence: PostgameDerivationConfidence): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDerivedVoteCohorts(input: {
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
}): PostgameDerivedVoteCohort[] {
  const eliminatedRounds = eliminatedRoundMap(input.completed.eliminationOrder);
  const blocs = new Map<string, VoteCohortBuilder>();

  for (const round of input.roundSummaries) {
    const cohort = round.majorityCohort;
    if (cohort.basis === "unavailable" || cohort.alignedPlayers.length < 2) continue;
    for (const players of playerPairs(cohort.alignedPlayers)) {
      const key = players.map((player) => player.id).join("|");
      const current = blocs.get(key) ?? {
        players,
        roundsControlled: [],
        sharedVotes: [],
        highConfidenceRounds: 0,
      };
      current.roundsControlled.push(round.round);
      current.sharedVotes.push({
        round: round.round,
        target: cohort.target,
        basis: cohort.basis,
      });
      if (cohort.confidence === "high") current.highConfidenceRounds += 1;
      blocs.set(key, current);
    }
  }

  return Array.from(consolidateVoteCohortBuilders(blocs, input.roundSummaries).values())
    .filter((bloc) => bloc.roundsControlled.length >= 2)
    .map((bloc) => {
      const firstObservedRound = Math.min(...bloc.roundsControlled);
      const lastObservedRound = Math.max(...bloc.roundsControlled);
      const eligibleRounds = input.roundSummaries.filter((round) =>
        round.round >= firstObservedRound &&
        round.round <= lastObservedRound &&
        round.majorityCohort.basis !== "unavailable" &&
        bloc.players.every((player) => {
          const eliminatedRound = eliminatedRounds.get(player.id);
          return eliminatedRound === undefined || round.round <= eliminatedRound;
        })
      );
      const cohesionScore = eligibleRounds.length > 0
        ? roundToTwo(bloc.roundsControlled.length / eligibleRounds.length)
        : 0;
      return {
        basis: "derived_vote_cohesion" as const,
        players: bloc.players,
        size: bloc.players.length,
        firstObservedRound,
        lastObservedRound,
        roundsControlled: bloc.roundsControlled,
        sharedVotes: bloc.sharedVotes,
        targets: bloc.sharedVotes,
        cohesionScore,
        confidence: cohortConfidence(bloc.roundsControlled.length, cohesionScore),
        derivationMethod: "shared_vote_outcomes" as const,
        note: "Derived from repeated shared vote outcomes; this is not confirmed alliance membership.",
      };
    })
    .sort((left, right) =>
      confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
      right.roundsControlled.length - left.roundsControlled.length ||
      right.cohesionScore - left.cohesionScore ||
      left.players.map((player) => player.name).join(",").localeCompare(
        right.players.map((player) => player.name).join(","),
      )
    )
    .slice(0, 8);
}

type VoteCohortBuilder = {
  players: RevealedPlayerRef[];
  roundsControlled: number[];
  sharedVotes: PostgameDerivedVoteCohort["sharedVotes"];
  highConfidenceRounds: number;
};

function consolidateVoteCohortBuilders(
  blocs: ReadonlyMap<string, VoteCohortBuilder>,
  roundSummaries: readonly PostgameRoundSummary[],
): Map<string, VoteCohortBuilder> {
  const consolidated = new Map<string, VoteCohortBuilder>();
  for (const bloc of blocs.values()) {
    const players = playersSharedAcrossRounds(roundSummaries, bloc.roundsControlled);
    if (players.length < 2) continue;
    const key = `${players.map((player) => player.id).join("|")}::${bloc.roundsControlled.join(",")}`;
    const existing = consolidated.get(key);
    if (existing) {
      existing.highConfidenceRounds = Math.max(existing.highConfidenceRounds, bloc.highConfidenceRounds);
      continue;
    }
    consolidated.set(key, {
      ...bloc,
      players,
    });
  }
  return consolidated;
}

function playersSharedAcrossRounds(
  roundSummaries: readonly PostgameRoundSummary[],
  rounds: readonly number[],
): RevealedPlayerRef[] {
  const summaries = rounds
    .map((roundNumber) => roundSummaries.find((round) => round.round === roundNumber))
    .filter((round): round is PostgameRoundSummary => Boolean(round));
  if (summaries.length === 0) return [];
  const sharedIds = new Set(summaries[0]!.majorityCohort.alignedPlayers.map((player) => player.id));
  const playerRefs = new Map(summaries[0]!.majorityCohort.alignedPlayers.map((player) => [player.id, player]));
  for (const summary of summaries.slice(1)) {
    const roundIds = new Set(summary.majorityCohort.alignedPlayers.map((player) => player.id));
    for (const playerId of [...sharedIds]) {
      if (!roundIds.has(playerId)) sharedIds.delete(playerId);
    }
    for (const player of summary.majorityCohort.alignedPlayers) {
      if (sharedIds.has(player.id) && !playerRefs.has(player.id)) playerRefs.set(player.id, player);
    }
  }
  return [...sharedIds]
    .flatMap((playerId) => {
      const player = playerRefs.get(playerId);
      return player ? [player] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function cohortConfidence(sharedRounds: number, cohesionScore: number): PostgameDerivationConfidence {
  if (sharedRounds >= 3 && cohesionScore >= 0.75) return "high";
  if (sharedRounds >= 2 && cohesionScore >= 0.5) return "medium";
  return "low";
}

function playerPairs(players: readonly RevealedPlayerRef[]): RevealedPlayerRef[][] {
  const sorted = [...players].sort((left, right) => left.name.localeCompare(right.name));
  const pairs: RevealedPlayerRef[][] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      pairs.push([sorted[leftIndex]!, sorted[rightIndex]!]);
    }
  }
  return pairs;
}

function buildGameMomentum(input: {
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
  derivedVoteCohorts: readonly PostgameDerivedVoteCohort[];
  finalVote: PostgameFinalVote;
}): PostgameMomentumSegment[] {
  const segments: PostgameMomentumSegment[] = [];
  const empoweredCounts = new Map<string, { player: RevealedPlayerRef; rounds: number[] }>();
  for (const round of input.roundSummaries) {
    if (!round.empowered) continue;
    const current = empoweredCounts.get(round.empowered.id) ?? { player: round.empowered, rounds: [] };
    current.rounds.push(round.round);
    empoweredCounts.set(round.empowered.id, current);
  }
  for (const entry of empoweredCounts.values()) {
    const longestStreak = longestConsecutiveStreak(entry.rounds);
    if (entry.rounds.length < 3 && longestStreak < 2) continue;
    segments.push({
      round: entry.rounds[0]!,
      firstObservedRound: entry.rounds[0]!,
      lastObservedRound: entry.rounds.at(-1)!,
      leader: { kind: "player", player: entry.player },
      indicators: ["empowerment"],
      confidence: entry.rounds.length >= 3 || longestStreak >= 3 ? "high" : "medium",
      derivationMethod: "repeated_empowerment_momentum",
      criteria: {
        empoweredRounds: entry.rounds,
        totalEmpoweredRounds: entry.rounds.length,
        longestConsecutiveStreak: longestStreak,
      },
    });
  }

  for (const cohort of input.derivedVoteCohorts.filter((entry) => entry.confidence !== "low").slice(0, 1)) {
    segments.push({
      round: cohort.firstObservedRound,
      firstObservedRound: cohort.firstObservedRound,
      lastObservedRound: cohort.lastObservedRound,
      leader: { kind: "cohort", players: cohort.players },
      indicators: ["majority_vote"],
      confidence: cohort.confidence,
      derivationMethod: "repeated_majority_vote_momentum",
      criteria: {
        cohesionScore: cohort.cohesionScore,
        sharedRounds: cohort.roundsControlled.length,
      },
    });
  }

  if (input.finalVote.status === "available" && input.finalVote.winner) {
    segments.push({
      round: input.completed.summary.roundsPlayed,
      firstObservedRound: input.completed.summary.roundsPlayed,
      lastObservedRound: input.completed.summary.roundsPlayed,
      leader: { kind: "player", player: input.finalVote.winner },
      indicators: ["jury_result"],
      confidence: "high",
      derivationMethod: "final_jury_result",
      criteria: {
        voteScore: formatFinalVoteScore(input.finalVote),
        margin: input.finalVote.margin,
      },
    });
  }

  return dedupeMomentumSegments(segments)
    .sort((left, right) =>
      left.round - right.round ||
      momentumIndicatorPriority(left) - momentumIndicatorPriority(right) ||
      confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
      momentumLeaderName(left).localeCompare(momentumLeaderName(right))
    )
    .slice(0, 8);
}

function buildExecutiveSummary(input: {
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
  finalVote: PostgameFinalVote;
  highlightedEliminations: readonly PostgameHighlightedElimination[];
  gameMomentum: readonly PostgameMomentumSegment[];
}): PostgameDerivedText[] {
  const lines: PostgameDerivedText[] = [];
  const controlSegment = input.gameMomentum.find((segment) => segment.indicators.includes("empowerment"));
  if (controlSegment?.leader.kind === "player") {
    const empoweredRounds = controlSegment.criteria.empoweredRounds;
    const total = Array.isArray(empoweredRounds) ? empoweredRounds.length : null;
    const streak = typeof controlSegment.criteria.longestConsecutiveStreak === "number"
      ? controlSegment.criteria.longestConsecutiveStreak
      : null;
    if (total !== null) {
      lines.push({
        text: streak !== null && streak >= 3
          ? `${controlSegment.leader.player.name} controlled power for ${streak} consecutive rounds.`
          : `${controlSegment.leader.player.name} controlled power in ${total} rounds.`,
        confidence: controlSegment.confidence,
        derivationMethod: "executive_summary_repeated_empowerment",
      });
    }
  }

  const lowExposureWinner = input.finalVote.winner
    ? exposeVoteTotal(input.completed, input.finalVote.winner.id)
    : null;
  if (input.finalVote.winner && lowExposureWinner !== null && lowExposureWinner <= 1) {
    lines.push({
      text: `${input.finalVote.winner.name} received ${lowExposureWinner === 1 ? "one expose vote" : "no expose votes"} all game.`,
      confidence: "high",
      derivationMethod: "executive_summary_expose_vote_total",
    });
  }

  const highlightedEndgame = input.highlightedEliminations.find((entry) =>
    entry.highlightReasons.includes("endgame_elimination")
  );
  if (highlightedEndgame) {
    lines.push({
      text: `${highlightedEndgame.player.name} was eliminated during the endgame.`,
      confidence: highlightedEndgame.confidence,
      derivationMethod: "executive_summary_highlighted_elimination",
    });
  }

  if (input.finalVote.status === "available" && input.finalVote.winner && input.finalVote.runnerUp) {
    lines.push({
      text: `${input.finalVote.winner.name} defeated ${input.finalVote.runnerUp.name} ${formatFinalVoteScore(input.finalVote)}.`,
      confidence: "high",
      derivationMethod: "executive_summary_final_vote",
    });
  }

  if (input.finalVote.margin !== null && input.finalVote.margin > 0) {
    lines.push({
      text: `Final margin: ${marginText(input.finalVote.margin)}.`,
      confidence: "high",
      derivationMethod: "executive_summary_final_margin",
    });
  }

  return dedupeDerivedText(lines).slice(0, 5);
}

function buildTurningPoints(input: {
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
  finalVote: PostgameFinalVote;
  eventRefs: EventReferenceIndex | null;
}): PostgameTurningPoint[] {
  const points: PostgameTurningPoint[] = [];
  const empoweredCounts = new Map<string, { player: RevealedPlayerRef; rounds: number[] }>();
  for (const round of input.roundSummaries) {
    if (!round.empowered) continue;
    const current = empoweredCounts.get(round.empowered.id) ?? { player: round.empowered, rounds: [] };
    current.rounds.push(round.round);
    empoweredCounts.set(round.empowered.id, current);
    if (current.rounds.length === 2 && round.round <= 3) {
      points.push({
        round: round.round,
        type: "majority_consolidation",
        players: [round.empowered],
        confidence: "high",
        description: `${round.empowered.name} controlled power in the early game.`,
        derivationMethod: "early_repeated_empowerment",
        criteria: {
          empoweredRounds: current.rounds,
          threshold: "two empowered rounds by round 3",
        },
        evidence: {
          factRefs: current.rounds.map((roundNumber) => `round:${roundNumber}:empowered:${round.empowered?.id}`),
          ...(input.eventRefs ? { eventRefs: input.eventRefs.forRound(round.round, ["vote.empower_tally_resolved"], [round.empowered]) } : {}),
        },
      });
    }
  }

  const dominant = [...empoweredCounts.values()]
    .sort((left, right) => right.rounds.length - left.rounds.length)[0];
  if (dominant && dominant.rounds.length >= 3) {
    const longestStreak = longestConsecutiveStreak(dominant.rounds);
    points.push({
      round: dominant.rounds.at(-1) ?? dominant.rounds[0]!,
      type: "power_shift",
      players: [dominant.player],
      confidence: "medium",
      description: longestStreak >= 3
        ? `${dominant.player.name} controlled power for ${longestStreak} consecutive rounds.`
        : `${dominant.player.name} controlled power in ${dominant.rounds.length} rounds.`,
      derivationMethod: "repeated_empowerment_count",
      criteria: {
        empoweredRounds: dominant.rounds,
        totalEmpoweredRounds: dominant.rounds.length,
        longestConsecutiveStreak: longestStreak,
      },
      evidence: {
        factRefs: dominant.rounds.map((round) => `round:${round}:empowered:${dominant.player.id}`),
      },
    });
  }

  for (const elimination of inputSummaryMajorEliminations(input)) {
    points.push({
      round: elimination.round,
      type: elimination.source === "endgame" ? "endgame_pivot" : "threat_removed",
      players: [elimination.player],
      confidence: elimination.source === "endgame" ? "high" : "medium",
      description: elimination.source === "endgame"
        ? `${elimination.player.name} was eliminated during the endgame.`
        : `${elimination.player.name} was eliminated by ${elimination.source} vote.`,
      derivationMethod: "highlighted_elimination",
      criteria: {
        source: elimination.source,
        round: elimination.round,
      },
      evidence: {
        factRefs: [`round:${elimination.round}:eliminated:${elimination.player.id}`],
        ...(input.eventRefs
          ? { eventRefs: input.eventRefs.forRound(elimination.round, ["council.elimination_resolved", "endgame.elimination_resolved"], [elimination.player]) }
          : {}),
      },
    });
  }

  if (input.finalVote.status === "available" && input.finalVote.margin !== null && input.finalVote.margin <= 1) {
    points.push({
      round: input.completed.summary.roundsPlayed,
      type: "jury_split",
      players: input.completed.summary.finalists,
      confidence: "high",
      description: `The jury vote was ${formatFinalVoteScore(input.finalVote)}, a one-vote final margin.`,
      derivationMethod: "final_jury_vote_margin",
      criteria: {
        margin: input.finalVote.margin,
        totalVotes: input.finalVote.totalVotes,
      },
      evidence: {
        factRefs: ["jury:final_vote"],
        ...(input.eventRefs ? { eventRefs: input.eventRefs.forRound(null, ["jury.winner_determined"], input.completed.summary.finalists) } : {}),
      },
    });
  }

  for (const round of input.roundSummaries) {
    for (const moment of round.keyRiskMoments) {
      if (moment.type !== "survived_council") continue;
      points.push({
        round: round.round,
        type: "near_miss",
        players: [moment.player],
        confidence: "medium",
        description: `${moment.player.name} survived the Council vote in round ${round.round}.`,
        derivationMethod: "survived_council_slate",
        criteria: {
          round: round.round,
          candidateCount: round.councilCandidates.length,
        },
        evidence: {
          factRefs: [`round:${round.round}:survived_council:${moment.player.id}`],
          ...(input.eventRefs ? { eventRefs: input.eventRefs.forRound(round.round, ["power.candidates_resolved", "council.elimination_resolved"], [moment.player]) } : {}),
        },
      });
    }
  }

  return dedupeTurningPoints(points).slice(0, 12);
}

function findUnanimousOrNearUnanimousVotes(
  completed: CompletedGameResultsRead,
  finalVote: PostgameFinalVote,
): PostgameAnalysisProjection["summary"]["unanimousOrNearUnanimousVotes"] {
  const votes: PostgameAnalysisProjection["summary"]["unanimousOrNearUnanimousVotes"] = [];
  for (const round of completed.rounds) {
    const standard = round.canonicalFacts.roundFacts.standardVote;
    const empowerTotal = standard.empowerTally.reduce((sum, entry) => sum + entry.votes, 0);
    const empowerLeader = standard.empowerTally[0];
    if (empowerLeader && isNearUnanimous(empowerLeader.votes, empowerTotal)) {
      votes.push({
        round: round.round,
        voteType: "empower",
        target: empowerLeader.player,
        votes: empowerLeader.votes,
        totalVotes: empowerTotal,
        unanimous: empowerLeader.votes === empowerTotal,
      });
    }
    const councilCounts = countPlayers(round.canonicalFacts.roundFacts.council.ledger.map((entry) => entry.target));
    const councilTotal = round.canonicalFacts.roundFacts.council.ledger.length;
    const councilLeader = topCounts(councilCounts)[0];
    if (councilLeader && isNearUnanimous(councilLeader.votes, councilTotal)) {
      votes.push({
        round: round.round,
        voteType: "council",
        target: councilLeader.player,
        votes: councilLeader.votes,
        totalVotes: councilTotal,
        unanimous: councilLeader.votes === councilTotal,
      });
    }
  }
  const juryLeader = [...finalVote.voteCounts].sort((left, right) =>
    right.votes - left.votes || left.player.name.localeCompare(right.player.name)
  )[0];
  if (juryLeader && isNearUnanimous(juryLeader.votes, finalVote.totalVotes)) {
    votes.push({
      round: null,
      voteType: "jury",
      target: juryLeader.player,
      votes: juryLeader.votes,
      totalVotes: finalVote.totalVotes,
      unanimous: juryLeader.votes === finalVote.totalVotes,
    });
  }
  return votes;
}

const HIGHLIGHTED_ELIMINATION_REASON_PRIORITY: PostgameHighlightedEliminationReason[] = [
  "first_elimination",
  "final_pre_jury_elimination",
  "first_jury_member",
  "endgame_elimination",
  "winner_final_opponent",
  "top_empowered_player",
  "top_exposed_player",
];

function buildHighlightedEliminations(input: {
  bootOrder: readonly PostgameBootOrderEntry[];
  finalVote: PostgameFinalVote;
  dominantEmpoweredPlayers: readonly PostgameVoteCount[];
  mostExposedPlayers: readonly PostgameVoteCount[];
}): PostgameHighlightedElimination[] {
  const reasonsByPlayerId = new Map<string, Set<PostgameHighlightedEliminationReason>>();
  const addReason = (entry: PostgameBootOrderEntry | undefined, reason: PostgameHighlightedEliminationReason) => {
    if (!entry) return;
    const current = reasonsByPlayerId.get(entry.player.id) ?? new Set<PostgameHighlightedEliminationReason>();
    current.add(reason);
    reasonsByPlayerId.set(entry.player.id, current);
  };

  addReason(input.bootOrder[0], "first_elimination");
  addReason(
    [...input.bootOrder].reverse().find((entry) => !entry.juryMember && entry.source !== "jury"),
    "final_pre_jury_elimination",
  );
  addReason(input.bootOrder.find((entry) => entry.juryMember), "first_jury_member");
  for (const entry of input.bootOrder) {
    if (entry.source === "endgame") addReason(entry, "endgame_elimination");
    if (input.finalVote.runnerUp && entry.player.id === input.finalVote.runnerUp.id) {
      addReason(entry, "winner_final_opponent");
    }
  }
  const powerPlayerIds = new Set(input.dominantEmpoweredPlayers.slice(0, 2).map((entry) => entry.player.id));
  const exposedPlayerIds = new Set(input.mostExposedPlayers.slice(0, 2).map((entry) => entry.player.id));
  for (const entry of input.bootOrder) {
    if (powerPlayerIds.has(entry.player.id)) addReason(entry, "top_empowered_player");
    if (exposedPlayerIds.has(entry.player.id)) addReason(entry, "top_exposed_player");
  }

  return input.bootOrder
    .flatMap((entry): PostgameHighlightedElimination[] => {
      const reasons = reasonsByPlayerId.get(entry.player.id);
      if (!reasons || reasons.size === 0) return [];
      const highlightReasons = [...reasons].sort(reasonPriority);
      return [{
        ...entry,
        highlightReasons,
        confidence: highlightedEliminationConfidence(highlightReasons),
        derivationMethod: "highlighted_elimination_rules",
      }];
    })
    .sort((left, right) =>
      left.round - right.round ||
      reasonPriority(left.highlightReasons[0]!) - reasonPriority(right.highlightReasons[0]!) ||
      left.player.name.localeCompare(right.player.name)
    );
}

function reasonPriority(reason: PostgameHighlightedEliminationReason): number {
  return HIGHLIGHTED_ELIMINATION_REASON_PRIORITY.indexOf(reason);
}

function highlightedEliminationConfidence(
  reasons: readonly PostgameHighlightedEliminationReason[],
): PostgameDerivationConfidence {
  if (reasons.some((reason) =>
    reason === "first_elimination" ||
    reason === "final_pre_jury_elimination" ||
    reason === "first_jury_member" ||
    reason === "endgame_elimination" ||
    reason === "winner_final_opponent"
  )) {
    return "high";
  }
  return "medium";
}

function sumExposed(roundSummaries: readonly PostgameRoundSummary[]): Map<string, { player: RevealedPlayerRef; votes: number }> {
  const counts = new Map<string, { player: RevealedPlayerRef; votes: number }>();
  for (const round of roundSummaries) {
    for (const entry of round.exposeLeaders) {
      const current = counts.get(entry.player.id) ?? { player: entry.player, votes: 0 };
      current.votes += entry.votes;
      counts.set(entry.player.id, current);
    }
  }
  return counts;
}

function countPlayers(players: readonly RevealedPlayerRef[]): Map<string, { player: RevealedPlayerRef; votes: number }> {
  const counts = new Map<string, { player: RevealedPlayerRef; votes: number }>();
  for (const player of players) {
    const current = counts.get(player.id) ?? { player, votes: 0 };
    current.votes += 1;
    counts.set(player.id, current);
  }
  return counts;
}

function topCounts(
  counts: Map<string, { player: RevealedPlayerRef; votes: number }>,
): PostgameVoteCount[] {
  return Array.from(counts.values())
    .sort(byVotesThenName)
    .map((entry) => ({ player: entry.player, votes: entry.votes }));
}

function byVotesThenName<T extends { votes: number; player?: RevealedPlayerRef; finalist?: RevealedPlayerRef }>(
  left: T,
  right: T,
): number {
  if (right.votes !== left.votes) return right.votes - left.votes;
  const leftName = (left.player ?? left.finalist)?.name ?? "";
  const rightName = (right.player ?? right.finalist)?.name ?? "";
  return leftName.localeCompare(rightName);
}

function confidenceForShare(count: number, total: number): "high" | "medium" | "low" {
  if (total <= 0) return "low";
  const share = count / total;
  if (share >= 0.67) return "high";
  if (share >= 0.5) return "medium";
  return "low";
}

function addRisk(
  risks: Map<string, { player: RevealedPlayerRef; types: Set<PostgameRoundSummary["keyRiskMoments"][number]["type"]> }>,
  player: RevealedPlayerRef,
  type: PostgameRoundSummary["keyRiskMoments"][number]["type"],
): void {
  const current = risks.get(player.id) ?? { player, types: new Set() };
  current.types.add(type);
  risks.set(player.id, current);
}

function riskNote(type: PostgameRoundSummary["keyRiskMoments"][number]["type"], player: RevealedPlayerRef): string {
  switch (type) {
    case "candidate":
      return `${player.name} was nominated for Council.`;
    case "exposure_leader":
      return `${player.name} led or nearly led expose pressure.`;
    case "eliminated":
      return `${player.name} was eliminated.`;
    case "survived_council":
      return `${player.name} survived the Council vote.`;
  }
}

function eliminatedRoundMap(eliminations: readonly CompletedGameResultsElimination[]): Map<string, number> {
  return new Map(eliminations.map((entry) => [entry.player.id, entry.round]));
}

function votePatternMap(patterns: readonly CompletedGameResultsVotePattern[]): Map<string, CompletedGameResultsVotePattern> {
  return new Map(patterns.map((pattern) => [pattern.player.id, pattern]));
}

function didPlayerVoteToEliminate(
  rounds: readonly CompletedGameResultsRound[],
  voterId: UUID,
  eliminatedId: UUID,
): boolean | null {
  let sawRelevantElimination = false;
  for (const round of rounds) {
    const councilEliminated = round.canonicalFacts.roundFacts.council.eliminated;
    if (councilEliminated?.id === eliminatedId) {
      sawRelevantElimination = true;
      if (round.canonicalFacts.roundFacts.council.ledger.some((entry) =>
        entry.voter.id === voterId && entry.target.id === eliminatedId
      )) {
        return true;
      }
    }
    for (const endgame of round.endgameEliminations) {
      if (endgame.eliminated.id !== eliminatedId) continue;
      sawRelevantElimination = true;
      if (endgame.ledger.some((entry) => entry.voter.id === voterId && entry.target.id === eliminatedId)) {
        return true;
      }
    }
  }
  return sawRelevantElimination ? false : null;
}

function alignmentForPlayer(
  roundSummary: PostgameRoundSummary | undefined,
  playerId: UUID,
): PostgamePlayerMajorityAlignment {
  if (!roundSummary) {
    return { round: 0, empowerAligned: null, councilAligned: null, aligned: null, basis: [] };
  }
  const basis: Array<"empower" | "council"> = [];
  let councilAligned: boolean | null = null;
  let empowerAligned: boolean | null = null;
  if (roundSummary.majorityCohort.basis === "council_vote") {
    basis.push("council");
    councilAligned = roundSummary.majorityCohort.alignedPlayers.some((player) => player.id === playerId);
  }
  if (roundSummary.majorityCohort.basis === "empower_vote") {
    basis.push("empower");
    empowerAligned = roundSummary.majorityCohort.alignedPlayers.some((player) => player.id === playerId);
  }
  const alignedValues = [empowerAligned, councilAligned].filter((value): value is boolean => value !== null);
  return {
    round: roundSummary.round,
    empowerAligned,
    councilAligned,
    aligned: alignedValues.length > 0 ? alignedValues.some(Boolean) : null,
    basis,
  };
}

function readablePlayerSummary(
  player: { name: string; status: string; placement: number | null },
  alignment: readonly PostgamePlayerMajorityAlignment[],
  finalVote: PostgameFinalVote,
  eliminated: CompletedGameResultsElimination | undefined,
): string {
  const alignedRounds = alignment.filter((entry) => entry.aligned === true).length;
  const decidedRounds = alignment.filter((entry) => entry.aligned !== null).length;
  if (player.status === "winner") {
    return `${player.name} won the game with ${finalVote.status === "available" ? formatFinalVote(finalVote) : "the final jury vote unavailable"} and voted with the majority signal in ${alignedRounds} of ${decidedRounds} resolved rounds.`;
  }
  if (player.status === "finalist") {
    return `${player.name} reached the finale and received ${finalVote.voteCounts.find((entry) => entry.player.name === player.name)?.votes ?? 0} jury votes.`;
  }
  if (eliminated) {
    return `${player.name} placed ${player.placement ?? "unknown"} after being eliminated in round ${eliminated.round} by ${eliminated.source}.`;
  }
  return `${player.name} has incomplete postgame facts.`;
}

function formatFinalVote(finalVote: PostgameFinalVote): string {
  const winnerVotes = finalVote.winner
    ? finalVote.voteCounts.find((entry) => entry.player.id === finalVote.winner?.id)?.votes
    : null;
  const runnerUpVotes = finalVote.runnerUp
    ? finalVote.voteCounts.find((entry) => entry.player.id === finalVote.runnerUp?.id)?.votes
    : null;
  if (!finalVote.winner || !finalVote.runnerUp || winnerVotes === null || runnerUpVotes === null) {
    return "jury vote unavailable";
  }
  return `${winnerVotes}-${runnerUpVotes} over ${finalVote.runnerUp.name}`;
}

function formatFinalVoteScore(finalVote: PostgameFinalVote): string {
  const winnerVotes = finalVote.winner
    ? finalVote.voteCounts.find((entry) => entry.player.id === finalVote.winner?.id)?.votes
    : null;
  const runnerUpVotes = finalVote.runnerUp
    ? finalVote.voteCounts.find((entry) => entry.player.id === finalVote.runnerUp?.id)?.votes
    : null;
  if (!finalVote.winner || !finalVote.runnerUp || winnerVotes === null || runnerUpVotes === null) {
    return "jury vote unavailable";
  }
  return `${winnerVotes}-${runnerUpVotes}`;
}

function isNearUnanimous(votes: number, total: number): boolean {
  return total > 0 && (votes === total || votes === total - 1);
}

function longestConsecutiveStreak(rounds: readonly number[]): number {
  if (rounds.length === 0) return 0;
  const sorted = [...rounds].sort((left, right) => left - right);
  let longest = 1;
  let current = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]! + 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

function dedupeDerivedText(lines: readonly PostgameDerivedText[]): PostgameDerivedText[] {
  const seen = new Set<string>();
  const result = [];
  for (const line of lines) {
    if (seen.has(line.text)) continue;
    seen.add(line.text);
    result.push(line);
  }
  return result;
}

function dedupeTurningPoints(points: readonly PostgameTurningPoint[]): PostgameTurningPoint[] {
  const seen = new Set<string>();
  const result = [];
  for (const point of points) {
    const key = `${point.round}:${point.type}:${point.players.map((player) => player.id).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function dedupeMomentumSegments(segments: readonly PostgameMomentumSegment[]): PostgameMomentumSegment[] {
  const seen = new Set<string>();
  const result = [];
  for (const segment of segments) {
    const key = `${segment.round}:${segment.indicators.join(",")}:${momentumLeaderName(segment)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(segment);
  }
  return result;
}

function momentumLeaderName(segment: PostgameMomentumSegment): string {
  return segment.leader.kind === "player"
    ? segment.leader.player.name
    : segment.leader.players.map((player) => player.name).join(",");
}

function momentumIndicatorPriority(segment: PostgameMomentumSegment): number {
  if (segment.indicators.includes("empowerment")) return 0;
  if (segment.indicators.includes("majority_vote")) return 1;
  if (segment.indicators.includes("endgame_progression")) return 2;
  if (segment.indicators.includes("jury_result")) return 3;
  return 4;
}

function exposeVoteTotal(completed: CompletedGameResultsRead, playerId: UUID): number {
  return completed.rounds.reduce((sum, round) =>
    sum + (round.canonicalFacts.roundFacts.power.exposureScores.find((entry) =>
      entry.player.id === playerId
    )?.votes ?? 0), 0);
}

class EventReferenceIndex {
  constructor(private readonly events: readonly CanonicalGameEvent[]) {}

  forRound(
    round: number | null,
    eventTypes: readonly CanonicalGameEventType[],
    players: readonly RevealedPlayerRef[],
  ): PostgameAnalysisEvidenceRef[] {
    const playerIds = new Set(players.map((player) => player.id));
    return this.events
      .filter((event) => (round === null || event.round === round) && eventTypes.includes(event.type))
      .map((event) => ({
        eventType: event.type,
        round: event.round,
        sequence: event.sequence,
        players: playersForEvent(event, playerIds, players),
      }));
  }

  forPlayer(
    player: RevealedPlayerRef,
    eventTypes: readonly CanonicalGameEventType[],
  ): PostgameAnalysisEvidenceRef[] {
    return this.events
      .filter((event) => eventTypes.includes(event.type) && JSON.stringify(event.payload).includes(player.id))
      .map((event) => ({
        eventType: event.type,
        round: event.round,
        sequence: event.sequence,
        players: [player],
      }));
  }
}

function playersForEvent(
  event: CanonicalGameEvent,
  playerIds: ReadonlySet<string>,
  players: readonly RevealedPlayerRef[],
): RevealedPlayerRef[] {
  const payload = JSON.stringify(event.payload);
  return players.filter((player) => playerIds.has(player.id) && payload.includes(player.id));
}

function inputSummaryMajorEliminations(input: {
  completed: CompletedGameResultsRead;
  roundSummaries: readonly PostgameRoundSummary[];
  finalVote: PostgameFinalVote;
}): PostgameHighlightedElimination[] {
  const dominantEmpoweredPlayers = topCounts(countPlayers(
    input.roundSummaries.flatMap((round) => round.empowered ? [round.empowered] : []),
  ));
  const mostExposedPlayers = topCounts(sumExposed(input.roundSummaries));
  return buildHighlightedEliminations({
    bootOrder: buildPostgameBootOrder(input.completed),
    finalVote: input.finalVote,
    dominantEmpoweredPlayers,
    mostExposedPlayers,
  });
}
