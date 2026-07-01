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
    confidence: "high" | "medium" | "low";
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
  narrativeHints: string[];
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
  readableSummary: string;
  diagnostics: PostgameAnalysisDiagnostic[];
  evidence?: PostgameAnalysisEvidenceRef[];
}

export interface PostgameTurningPoint {
  round: number;
  type: PostgameTurningPointType;
  players: RevealedPlayerRef[];
  confidence: "high" | "medium" | "low";
  description: string;
  evidence: {
    factRefs: string[];
    eventRefs?: PostgameAnalysisEvidenceRef[];
  };
}

export interface PostgameAnalysisProjection {
  schemaVersion: 1;
  source: CompletedGameResultsRead["source"];
  availability: CompletedGameResultsRead["availability"];
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
    majorEliminations: CompletedGameResultsElimination[];
    notableEndgameSequence: Array<{
      round: number;
      stage: string | null;
      eliminated: RevealedPlayerRef;
      method: string;
    }>;
  };
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
  const roundSummaries = completed.rounds.map((round) =>
    buildRoundSummary(round, includeEvidence ? eventRefs : null)
  );
  const finalVote = buildFinalVote(completed.jury);
  const jury = buildJuryBreakdown(completed, finalVote, includeEvidence ? eventRefs : null);
  const bootOrder = buildPostgameBootOrder(completed);
  const dominantEmpoweredPlayers = topCounts(countPlayers(
    roundSummaries.flatMap((round) => round.empowered ? [round.empowered] : []),
  ));
  const mostExposedPlayers = topCounts(sumExposed(roundSummaries));
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

  return {
    schemaVersion: 1,
    source: completed.source,
    availability: completed.availability,
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
      majorEliminations: majorEliminations(completed, dominantEmpoweredPlayers, mostExposedPlayers),
      notableEndgameSequence: completed.rounds.flatMap((round) =>
        round.endgameEliminations.map((entry) => ({
          round: entry.round,
          stage: entry.stage,
          eliminated: entry.eliminated,
          method: entry.method,
        }))
      ),
    },
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
    };
  }

  return {
    basis: "unavailable",
    alignedPlayers: [],
    target: null,
    votes: 0,
    confidence: "low",
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
  const nonWinnerSupporters = winnerId
    ? perJurorVotes
      .filter((entry) => entry.finalist.id !== winnerId)
      .map((entry) => entry.juror)
    : [];
  const evidence = eventRefs?.forRound(null, ["jury.winner_determined"], completed.jury.finalists);

  return {
    status: completed.jury.status,
    finalists: completed.jury.finalists,
    winner: completed.jury.winner,
    finalVote,
    perJurorVotes,
    narrativeHints: juryNarrativeHints(perJurorVotes, finalVote, finalistVoteCounts),
    nonWinnerSupporters,
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
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
    readableSummary: readablePlayerSummary(player, majorityAlignmentByRound, finalVote, eliminated),
    diagnostics: completed.availability.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
  };
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
        description: `${round.empowered.name} was empowered repeatedly in the early game.`,
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
    points.push({
      round: dominant.rounds.at(-1) ?? dominant.rounds[0]!,
      type: "power_shift",
      players: [dominant.player],
      confidence: "medium",
      description: `${dominant.player.name} held repeated empowerment across ${dominant.rounds.length} rounds.`,
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
      description: `${elimination.player.name} was removed by ${elimination.source} vote.`,
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
      description: `The jury split ${formatFinalVote(input.finalVote)}, leaving a one-vote final margin.`,
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
        description: `${moment.player.name} survived the Council slate in round ${round.round}.`,
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

function majorEliminations(
  completed: CompletedGameResultsRead,
  dominantEmpoweredPlayers: readonly PostgameVoteCount[],
  mostExposedPlayers: readonly PostgameVoteCount[],
): CompletedGameResultsElimination[] {
  const powerPlayerIds = new Set(dominantEmpoweredPlayers.slice(0, 2).map((entry) => entry.player.id));
  const exposedPlayerIds = new Set(mostExposedPlayers.slice(0, 2).map((entry) => entry.player.id));
  return completed.eliminationOrder.filter((entry) =>
    entry.source === "endgame" ||
    powerPlayerIds.has(entry.player.id) ||
    exposedPlayerIds.has(entry.player.id)
  );
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

function juryNarrativeHints(
  perJurorVotes: readonly PostgameJuryVoteEntry[],
  finalVote: PostgameFinalVote,
  finalistVoteCounts: Map<string, number>,
): string[] {
  if (!finalVote.winner || !finalVote.runnerUp || perJurorVotes.length === 0) return [];
  const sorted = [...perJurorVotes].sort((left, right) =>
    (left.jurorEliminatedRound ?? Number.MAX_SAFE_INTEGER) -
    (right.jurorEliminatedRound ?? Number.MAX_SAFE_INTEGER)
  );
  const midpoint = Math.ceil(sorted.length / 2);
  const early = sorted.slice(0, midpoint);
  const late = sorted.slice(midpoint);
  const hints = [];
  const earlyWinnerVotes = early.filter((entry) => entry.finalist.id === finalVote.winner?.id).length;
  const lateRunnerUpVotes = late.filter((entry) => entry.finalist.id === finalVote.runnerUp?.id).length;
  if (earlyWinnerVotes > early.length / 2 && late.length > 0 && lateRunnerUpVotes >= late.length / 2) {
    hints.push(`Early jurors favored ${finalVote.winner.name}; later jurors leaned toward ${finalVote.runnerUp.name}.`);
  }
  const maxVotes = Math.max(...Array.from(finalistVoteCounts.values()), 0);
  const minVotes = Math.min(...Array.from(finalistVoteCounts.values()), maxVotes);
  if (maxVotes - minVotes === 1) {
    hints.push(`The final jury vote was decided by one vote.`);
  }
  return hints;
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

function isNearUnanimous(votes: number, total: number): boolean {
  return total > 0 && (votes === total || votes === total - 1);
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
}): CompletedGameResultsElimination[] {
  const dominantEmpoweredPlayers = topCounts(countPlayers(
    input.roundSummaries.flatMap((round) => round.empowered ? [round.empowered] : []),
  ));
  const mostExposedPlayers = topCounts(sumExposed(input.roundSummaries));
  return majorEliminations(input.completed, dominantEmpoweredPlayers, mostExposedPlayers);
}
