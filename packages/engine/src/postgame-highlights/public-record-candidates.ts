import type {
  PostgameAnalysisProjection,
  PostgameTurningPoint,
} from "../postgame-analysis";
import {
  formatNames,
  numberArray,
  sanitizedEventRefs,
  uniquePlayers,
} from "./helpers";
import { resultsLink } from "./links";
import type {
  HouseHighlightsCandidate,
  PlayerSummary,
  RoundSummary,
  UnanimousVote,
  VoteCohort,
} from "./types";

export function buildTurningPointCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.turningPoints.flatMap((point) => {
    switch (point.type) {
      case "majority_consolidation":
      case "power_shift":
        return powerControlCandidate(point);
      case "threat_removed":
        return threatRemovedCandidate(point);
      case "endgame_pivot":
        return endgamePivotCandidate(point);
      case "near_miss":
        return nearMissCandidate(point);
      case "jury_split":
      case "alliance_member_cut":
        return [];
    }
  });
}

export function buildRoundFactCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.roundSummaries.flatMap((round) => [
    ...shieldSaveCandidate(round),
    ...voteFlipCandidate(round),
  ]);
}

export function buildPlayerSurvivalCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.playerSummaries
    .filter((summary) =>
      (summary.status === "winner" || summary.status === "finalist")
      && summary.atRiskMoments.length >= 2
    )
    .slice(0, 2)
    .map((summary) => playerSurvivalCandidate(summary));
}

export function buildVoteCohortCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.derivedVoteCohorts
    .filter((cohort) => cohort.confidence !== "low" && cohort.sharedVotes.length >= 2)
    .slice(0, 2)
    .map((cohort) => voteCohortCandidate(cohort));
}

export function buildNearUnanimousVoteCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.summary.unanimousOrNearUnanimousVotes
    .filter((vote) => vote.voteType === "council" && vote.round !== null)
    .slice(0, 2)
    .map((vote) => nearUnanimousVoteCandidate(vote));
}

function powerControlCandidate(point: PostgameTurningPoint): HouseHighlightsCandidate[] {
  const player = point.players[0];
  if (!player) return [];
  const candidateId = `power-control:${point.type}:${player.id}`;
  const rounds = numberArray(point.criteria.empoweredRounds);
  const roundLabel = rounds.length > 0
    ? rounds.join(", ")
    : String(point.round);
  return [{
    id: candidateId,
    title: `${player.name} kept taking the room's power`,
    category: "triumph",
    involvedAgents: [player],
    houseHook: `${player.name} turned repeated power votes into a public storyline.`,
    setup: `Power votes kept coming back to ${player.name}.`,
    conflict: `Every repeat made the room's control structure harder to ignore.`,
    payoff: point.description,
    receipts: [{
      id: candidateId,
      tier: "vote_record",
      label: "Power vote record",
      description: rounds.length > 0
        ? `${player.name} controlled power in round ${roundLabel}.`
        : point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open power record"),
    posterDirection: "Power tally card with the same agent avatar recurring across rounds.",
    source: point.derivationMethod,
    score: point.type === "power_shift" ? 94 : 92,
    narrativeOrder: 12,
    thesisTags: ["public-reckoning", "power-run"],
    dedupeKey: `power-control:${player.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function threatRemovedCandidate(point: PostgameTurningPoint): HouseHighlightsCandidate[] {
  const player = point.players[0];
  if (!player) return [];
  return [{
    id: `threat-removed:${point.round}:${player.id}`,
    title: `${player.name} stopped being a future problem`,
    category: "collapse",
    involvedAgents: [player],
    houseHook: `${player.name}'s exit mattered before the final vote ever arrived.`,
    setup: `${player.name} carried visible pressure in the postgame record.`,
    conflict: "The vote record finally turned that pressure into an exit.",
    payoff: point.description,
    receipts: [{
      id: `threat-removed:${point.round}:${player.id}`,
      tier: "vote_record",
      label: `Round ${point.round} elimination`,
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open round result"),
    posterDirection: "Elimination card with prior pressure marks behind the agent portrait.",
    source: point.derivationMethod,
    score: 82,
    narrativeOrder: 30 + point.round,
    thesisTags: ["public-reckoning", "pressure-break"],
    dedupeKey: `elimination:${point.round}:${player.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function endgamePivotCandidate(point: PostgameTurningPoint): HouseHighlightsCandidate[] {
  const player = point.players[0];
  if (!player) return [];
  return [{
    id: `endgame-pivot:${point.round}:${player.id}`,
    title: `${player.name} fell when the game changed shape`,
    category: "suspense",
    involvedAgents: [player],
    houseHook: `${player.name}'s exit marked the point where ordinary votes were gone.`,
    setup: "The game had moved into its endgame rules.",
    conflict: `${player.name} had to survive a smaller room with fewer places to hide.`,
    payoff: point.description,
    receipts: [{
      id: `endgame-pivot:${point.round}:${player.id}`,
      tier: "vote_record",
      label: "Endgame vote record",
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open endgame result"),
    posterDirection: "Endgame title card with the room narrowed to the remaining agents.",
    source: point.derivationMethod,
    score: 89,
    narrativeOrder: 60 + point.round,
    thesisTags: ["public-reckoning", "endgame-pivot"],
    dedupeKey: `endgame-pivot:${point.round}:${player.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function nearMissCandidate(point: PostgameTurningPoint): HouseHighlightsCandidate[] {
  const player = point.players[0];
  if (!player) return [];
  return [{
    id: `near-miss:${point.round}:${player.id}`,
    title: `${player.name} survived the vote's crosshairs`,
    category: "unlikely_survival",
    involvedAgents: [player],
    houseHook: `${player.name} was close enough to the edge for the record to remember it.`,
    setup: `${player.name} appeared on the Council slate.`,
    conflict: "The vote had to choose who actually left.",
    payoff: point.description,
    receipts: [{
      id: `near-miss:${point.round}:${player.id}`,
      tier: "vote_record",
      label: "Council survival record",
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open survival record"),
    posterDirection: "Council slate graphic with one agent crossed out and one left standing.",
    source: point.derivationMethod,
    score: 90,
    narrativeOrder: 24 + point.round,
    thesisTags: ["public-reckoning", "survival-thread"],
    dedupeKey: `near-miss:${point.round}:${player.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function shieldSaveCandidate(round: RoundSummary): HouseHighlightsCandidate[] {
  const shielded = round.shieldGranted;
  if (!shielded) return [];
  const firstDanger = round.exposeLeaders.find((entry) => entry.votes > 0)?.player ?? null;
  const eliminated = round.eliminated;
  return [{
    id: `shield-save:${round.round}:${shielded.id}`,
    title: `${shielded.name} got covered before the vote landed`,
    category: "triumph",
    involvedAgents: uniquePlayers([
      ...(round.empowered ? [round.empowered] : []),
      shielded,
      ...(eliminated ? [eliminated] : []),
    ]),
    houseHook: `${shielded.name} was protected before Council made someone else pay.`,
    setup: firstDanger?.id === shielded.id
      ? `${shielded.name} led the exposed board.`
      : `${shielded.name} was close enough to danger for the shield to matter.`,
    conflict: `${round.empowered?.name ?? "Power"} changed the vote math with a shield.`,
    payoff: eliminated && eliminated.id !== shielded.id
      ? `${eliminated.name} left instead.`
      : `${shielded.name} survived the round.`,
    receipts: [{
      id: `shield-save:${round.round}:${shielded.id}`,
      tier: "vote_record",
      label: `Round ${round.round} shield`,
      description: `${shielded.name} received a shield in round ${round.round}.`,
      factRefs: [
        `round:${round.round}:shield:${shielded.id}`,
        ...(eliminated ? [`round:${round.round}:eliminated:${eliminated.id}`] : []),
      ],
      ...(round.evidence?.length ? { eventRefs: sanitizedEventRefs(round.evidence) } : {}),
    }],
    confidence: "high",
    deepLink: resultsLink(round.round, "Open shield record"),
    posterDirection: "Shield graphic over one avatar while the eliminated agent fades behind it.",
    source: "round_shield_record",
    score: 91,
    narrativeOrder: 18 + round.round,
    thesisTags: ["public-reckoning", "survival-thread"],
    dedupeKey: `shield-save:${round.round}:${shielded.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function voteFlipCandidate(round: RoundSummary): HouseHighlightsCandidate[] {
  const exposed = round.exposeLeaders.find((entry) => entry.votes > 0)?.player ?? null;
  const eliminated = round.eliminated;
  if (!exposed || !eliminated || exposed.id === eliminated.id) return [];
  return [{
    id: `vote-flip:${round.round}:${eliminated.id}`,
    title: `The room looked at ${exposed.name}, then cut ${eliminated.name}`,
    category: "chaos",
    involvedAgents: uniquePlayers([exposed, eliminated]),
    houseHook: `The first danger signal pointed one way; the final vote went another.`,
    setup: `${exposed.name} led the exposed board in round ${round.round}.`,
    conflict: "Council still had to decide who actually paid for the round.",
    payoff: `${eliminated.name} was eliminated instead.`,
    receipts: [{
      id: `vote-flip:${round.round}:${eliminated.id}`,
      tier: "vote_record",
      label: "Exposure-to-elimination flip",
      description: `${exposed.name} led exposure pressure, but ${eliminated.name} was eliminated.`,
      factRefs: [
        `round:${round.round}:exposed:${exposed.id}`,
        `round:${round.round}:eliminated:${eliminated.id}`,
      ],
      ...(round.evidence?.length ? { eventRefs: sanitizedEventRefs(round.evidence) } : {}),
    }],
    confidence: "medium",
    deepLink: resultsLink(round.round, "Open vote record"),
    posterDirection: "Split vote graphic: exposed target on one side, eliminated target on the other.",
    source: "exposure_to_elimination_flip",
    score: 87,
    narrativeOrder: 22 + round.round,
    thesisTags: ["public-reckoning", "vote-flip"],
    dedupeKey: `vote-flip:${round.round}:${eliminated.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  }];
}

function playerSurvivalCandidate(summary: PlayerSummary): HouseHighlightsCandidate {
  const dangerRounds = summary.atRiskMoments.map((moment) => moment.round);
  const firstRound = Math.min(...dangerRounds);
  const player = summary.player;
  const ending = summary.status === "winner" ? "won" : "reached the final";
  return {
    id: `near-miss:run:${player.id}`,
    title: `${player.name} kept surviving the room's attention`,
    category: "unlikely_survival",
    involvedAgents: [player],
    houseHook: `${player.name} kept showing up in danger and still ${ending}.`,
    setup: `${player.name} appeared in public danger ${summary.atRiskMoments.length} times.`,
    conflict: "Every danger mark gave the room another chance to finish the job.",
    payoff: `${player.name} still ${ending}.`,
    receipts: [{
      id: `near-miss:run:${player.id}`,
      tier: "vote_record",
      label: "Survival record",
      description: `${player.name} had ${summary.atRiskMoments.length} public danger moment(s) and still ${ending}.`,
      factRefs: summary.atRiskMoments.map((moment) => `round:${moment.round}:risk:${moment.type}:${player.id}`),
    }],
    confidence: summary.atRiskMoments.length >= 3 ? "high" : "medium",
    deepLink: resultsLink(firstRound, "Open survival record"),
    posterDirection: "Repeated danger marks stacked behind a finalist avatar.",
    source: "player_survival_record",
    score: summary.status === "winner" ? 90 : 88,
    narrativeOrder: 26 + firstRound,
    thesisTags: ["public-reckoning", "survival-thread"],
    dedupeKey: `near-miss:run:${player.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}

function voteCohortCandidate(cohort: VoteCohort): HouseHighlightsCandidate {
  const names = formatNames(cohort.players);
  const rounds = cohort.roundsControlled.join(", ");
  return {
    id: `vote-cohort:${cohort.players.map((player) => player.id).sort().join("-")}`,
    title: `${names} kept finding the same target`,
    category: "loyalty",
    involvedAgents: cohort.players.map((player) => ({ id: player.id, name: player.name })),
    houseHook: `${names} moved like a voting bloc without needing The House to call it an alliance.`,
    setup: `Their public votes matched across round ${rounds}.`,
    conflict: "Repeated agreement can become power even when it is not a named pact.",
    payoff: `${cohort.sharedVotes.length} shared vote outcomes survived the receipt check.`,
    receipts: [
      {
        id: `vote-cohort:${cohort.firstObservedRound}:${cohort.lastObservedRound}`,
        tier: "derived_signal",
        label: "Shared vote pattern",
        description: cohort.note,
        factRefs: cohort.sharedVotes.map((vote) => `round:${vote.round}:${vote.basis}:${vote.target?.id ?? "none"}`),
      },
      {
        id: `vote-cohort-ledger:${cohort.firstObservedRound}:${cohort.lastObservedRound}`,
        tier: "vote_record",
        label: "Vote ledger",
        description: `Matched public vote outcomes from round ${cohort.firstObservedRound} to round ${cohort.lastObservedRound}.`,
        factRefs: cohort.sharedVotes.map((vote) => `round:${vote.round}:vote:${vote.target?.id ?? "none"}`),
      },
    ],
    confidence: cohort.confidence,
    deepLink: resultsLink(cohort.firstObservedRound, "Open vote pattern"),
    posterDirection: "Relation-line graphic connecting agents through repeated vote cards.",
    source: cohort.derivationMethod,
    score: 84,
    narrativeOrder: 16 + cohort.firstObservedRound,
    thesisTags: ["public-reckoning", "power-run"],
    dedupeKey: `vote-cohort:${cohort.players.map((player) => player.id).sort().join("-")}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}

function nearUnanimousVoteCandidate(vote: UnanimousVote): HouseHighlightsCandidate {
  const round = vote.round ?? null;
  return {
    id: `near-unanimous-vote:${round ?? "jury"}:${vote.voteType}:${vote.target.id}`,
    title: `${vote.target.name} had nowhere to hide in the vote`,
    category: "humiliation",
    involvedAgents: [vote.target],
    houseHook: `${vote.votes} of ${vote.totalVotes} votes landed on ${vote.target.name}.`,
    setup: "The room did not split its public pressure evenly.",
    conflict: `${vote.target.name} needed dissent that never really arrived.`,
    payoff: vote.unanimous
      ? `Every vote went to ${vote.target.name}.`
      : `Only one vote separated ${vote.target.name} from unanimity.`,
    receipts: [{
      id: `near-unanimous-vote:${round ?? "jury"}:${vote.target.id}`,
      tier: "vote_record",
      label: "Vote margin",
      description: `${vote.target.name} received ${vote.votes} of ${vote.totalVotes} ${vote.voteType} votes.`,
      factRefs: [`round:${round ?? "jury"}:${vote.voteType}:${vote.target.id}`],
    }],
    confidence: "high",
    deepLink: resultsLink(round, "Open vote margin"),
    posterDirection: "Vote pile-on graphic with one name repeated across the tally.",
    source: "near_unanimous_vote_record",
    score: 80,
    narrativeOrder: (round ?? 80) + 28,
    thesisTags: ["public-reckoning", "pressure-break"],
    dedupeKey: `near-unanimous-vote:${round ?? "jury"}:${vote.voteType}:${vote.target.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}
