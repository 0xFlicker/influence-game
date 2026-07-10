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
import { agentSlot, receiptTypeSlot, valueSlot, visualBrief } from "./visual-briefs";

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
    deepLink: resultsLink(point.round, "Open power details"),
    visualBrief: visualBrief({
      visualType: "power_streak",
      primaryAgents: [player],
      factualSlots: [
        agentSlot("primary_agent", "Power holder", [player], [candidateId]),
        valueSlot("round", "Round", roundLabel, [candidateId]),
        valueSlot("vote_outcome", "Power record", point.description, [candidateId], "receipt"),
        receiptTypeSlot(["vote_record"], [candidateId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "power_tally", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "spotlight_stage",
      forbiddenInventions: [
        "Do not depict the agent taking a physical crown or stage action.",
        "Do not invent vote totals not present in the public facts.",
      ],
    }),
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
  const receiptId = `threat-removed:${point.round}:${player.id}`;
  return [{
    id: receiptId,
    title: `${player.name} stopped being a future problem`,
    category: "collapse",
    involvedAgents: [player],
    houseHook: `${player.name}'s exit mattered before the final vote ever arrived.`,
    setup: `${player.name} carried visible pressure in the postgame record.`,
    conflict: "The public vote finally turned that pressure into an exit.",
    payoff: point.description,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: `Round ${point.round} elimination`,
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open round result"),
    visualBrief: visualBrief({
      visualType: "council_slate",
      primaryAgents: [player],
      factualSlots: [
        agentSlot("eliminated_agent", "Eliminated agent", [player], [receiptId]),
        valueSlot("round", "Round", point.round, [receiptId]),
        valueSlot("vote_outcome", "Vote outcome", point.description, [receiptId], "receipt"),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "abstract_vote_board",
      forbiddenInventions: [
        "Do not invent private motive for the elimination.",
        "Do not render generated vote totals or names.",
      ],
    }),
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
  const receiptId = `endgame-pivot:${point.round}:${player.id}`;
  return [{
    id: receiptId,
    title: `${player.name} fell when the game changed shape`,
    category: "suspense",
    involvedAgents: [player],
    houseHook: `${player.name}'s exit marked the point where ordinary votes were gone.`,
    setup: "The game had moved into its endgame rules.",
    conflict: `${player.name} had to survive a smaller room with fewer places to hide.`,
    payoff: point.description,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Endgame vote record",
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open endgame result"),
    visualBrief: visualBrief({
      visualType: "endgame_collapse",
      primaryAgents: [player],
      factualSlots: [
        agentSlot("eliminated_agent", "Eliminated agent", [player], [receiptId]),
        valueSlot("round", "Round", point.round, [receiptId]),
        valueSlot("vote_outcome", "Endgame outcome", point.description, [receiptId], "receipt"),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "empty_council_chamber",
      forbiddenInventions: [
        "Do not invent who remained unless the scene provides those facts.",
        "Do not depict a physical collapse or punishment.",
      ],
    }),
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
  const receiptId = `near-miss:${point.round}:${player.id}`;
  return [{
    id: receiptId,
    title: `${player.name} survived the vote's crosshairs`,
    category: "unlikely_survival",
    involvedAgents: [player],
    houseHook: `${player.name} was close enough to the edge for the record to remember it.`,
    setup: `${player.name} appeared on the Council slate.`,
    conflict: "The vote had to choose who actually left.",
    payoff: point.description,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Council survival record",
      description: point.description,
      factRefs: point.evidence.factRefs,
      ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
    }],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open survival details"),
    visualBrief: visualBrief({
      visualType: "unlikely_survival",
      primaryAgents: [player],
      factualSlots: [
        agentSlot("surviving_agent", "Surviving agent", [player], [receiptId]),
        valueSlot("round", "Round", point.round, [receiptId]),
        valueSlot("vote_outcome", "Survival outcome", point.description, [receiptId], "receipt"),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "abstract_vote_board",
      forbiddenInventions: [
        "Do not imply fear or relief.",
        "Do not invent the alternate eliminated agent unless the scene proves it.",
      ],
    }),
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
  const receiptId = `shield-save:${round.round}:${shielded.id}`;
  return [{
    id: receiptId,
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
      id: receiptId,
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
    deepLink: resultsLink(round.round, "Open shield details"),
    visualBrief: visualBrief({
      visualType: "shield_survival",
      primaryAgents: [shielded],
      secondaryAgents: uniquePlayers([
        ...(round.empowered ? [round.empowered] : []),
        ...(eliminated ? [eliminated] : []),
      ]),
      factualSlots: [
        agentSlot("protected_agent", "Protected agent", [shielded], [receiptId]),
        ...(eliminated ? [agentSlot("eliminated_agent", "Eliminated agent", [eliminated], [receiptId])] : []),
        valueSlot("round", "Round", round.round, [receiptId]),
        valueSlot("vote_outcome", "Shield outcome", eliminated ? `${eliminated.name} eliminated` : `${shielded.name} survived`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "shield_marker", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "spotlight_stage",
      forbiddenInventions: [
        "Do not depict a physical rescue.",
        "Do not invent injury, fear, heroism, or facial expression.",
      ],
    }),
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
  const receiptId = `vote-flip:${round.round}:${eliminated.id}`;
  return [{
    id: receiptId,
    title: `The room looked at ${exposed.name}, then cut ${eliminated.name}`,
    category: "chaos",
    involvedAgents: uniquePlayers([exposed, eliminated]),
    houseHook: `The first danger signal pointed one way; the final vote went another.`,
    setup: `${exposed.name} led the exposed board in round ${round.round}.`,
    conflict: "Council still had to decide who actually paid for the round.",
    payoff: `${eliminated.name} was eliminated instead.`,
    receipts: [{
      id: receiptId,
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
    deepLink: resultsLink(round.round, "Open vote details"),
    visualBrief: visualBrief({
      visualType: "vote_flip",
      primaryAgents: [eliminated],
      secondaryAgents: [exposed],
      factualSlots: [
        agentSlot("exposed_agent", "Initial exposed agent", [exposed], [receiptId]),
        agentSlot("eliminated_agent", "Eliminated agent", [eliminated], [receiptId]),
        valueSlot("round", "Round", round.round, [receiptId]),
        valueSlot("vote_outcome", "Final outcome", `${eliminated.name} eliminated`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "abstract_vote_board",
      forbiddenInventions: [
        "Do not imply the room lied unless a receipt says so.",
        "Do not create generated ballots or vote totals.",
      ],
    }),
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
  const receiptId = `near-miss:run:${player.id}`;
  return {
    id: receiptId,
    title: `${player.name} kept surviving the room's attention`,
    category: "unlikely_survival",
    involvedAgents: [player],
    houseHook: `${player.name} kept showing up in danger and still ${ending}.`,
    setup: `${player.name} appeared in public danger ${summary.atRiskMoments.length} times.`,
    conflict: "Every danger mark gave the room another chance to finish the job.",
    payoff: `${player.name} still ${ending}.`,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Survival record",
      description: `${player.name} had ${summary.atRiskMoments.length} public danger moment(s) and still ${ending}.`,
      factRefs: summary.atRiskMoments.map((moment) => `round:${moment.round}:risk:${moment.type}:${player.id}`),
    }],
    confidence: summary.atRiskMoments.length >= 3 ? "high" : "medium",
    deepLink: resultsLink(firstRound, "Open survival details"),
    visualBrief: visualBrief({
      visualType: "unlikely_survival",
      primaryAgents: [player],
      factualSlots: [
        agentSlot("surviving_agent", "Surviving agent", [player], [receiptId]),
        valueSlot("round", "First danger round", firstRound, [receiptId]),
        valueSlot("vote_outcome", "Survival outcome", `${player.name} ${ending}`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "surveillance_board_texture",
      forbiddenInventions: [
        "Do not invent a chase, escape, or emotional state.",
        "Do not imply every danger mark was an alliance action.",
      ],
    }),
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
  const receiptIds = [
    `vote-cohort:${cohort.firstObservedRound}:${cohort.lastObservedRound}`,
    `vote-cohort-ledger:${cohort.firstObservedRound}:${cohort.lastObservedRound}`,
  ] as const;
  return {
    id: `vote-cohort:${cohort.players.map((player) => player.id).sort().join("-")}`,
    title: `${names} kept finding the same target`,
    category: "loyalty",
    involvedAgents: cohort.players.map((player) => ({ id: player.id, name: player.name })),
    houseHook: `${names} moved like a voting bloc without needing The House to call it an alliance.`,
    setup: `Their public votes matched across round ${rounds}.`,
    conflict: "Repeated agreement can become power even when it is not a named pact.",
    payoff: `${cohort.sharedVotes.length} shared vote outcomes held up in the public record.`,
    receipts: [
      {
        id: receiptIds[0],
        tier: "derived_signal",
        label: "Shared vote pattern",
        description: cohort.note,
        factRefs: cohort.sharedVotes.map((vote) => `round:${vote.round}:${vote.basis}:${vote.target?.id ?? "none"}`),
      },
      {
        id: receiptIds[1],
        tier: "vote_record",
        label: "Vote ledger",
        description: `Matched public vote outcomes from round ${cohort.firstObservedRound} to round ${cohort.lastObservedRound}.`,
        factRefs: cohort.sharedVotes.map((vote) => `round:${vote.round}:vote:${vote.target?.id ?? "none"}`),
      },
    ],
    confidence: cohort.confidence,
    deepLink: resultsLink(cohort.firstObservedRound, "Open voting pattern"),
    visualBrief: visualBrief({
      visualType: "council_slate",
      primaryAgents: cohort.players,
      factualSlots: [
        agentSlot("voters", "Repeat voters", cohort.players, receiptIds),
        valueSlot("round", "Observed rounds", rounds, receiptIds),
        valueSlot("vote_outcome", "Shared vote outcomes", `${cohort.sharedVotes.length} shared vote outcomes`, receiptIds, "receipt"),
        receiptTypeSlot(["derived_signal", "vote_record"], receiptIds),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "surveillance_board_texture",
      forbiddenInventions: [
        "Do not draw an alliance line without an alliance receipt.",
        "Do not imply friendship, loyalty, or coordination beyond shared public votes.",
      ],
      rejectedBackdropCategories: ["fractured_alliance_table"],
    }),
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
  const receiptId = `near-unanimous-vote:${round ?? "jury"}:${vote.target.id}`;
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
      id: receiptId,
      tier: "vote_record",
      label: "Vote margin",
      description: `${vote.target.name} received ${vote.votes} of ${vote.totalVotes} ${vote.voteType} votes.`,
      factRefs: [`round:${round ?? "jury"}:${vote.voteType}:${vote.target.id}`],
    }],
    confidence: "high",
    deepLink: resultsLink(round, "Open vote margin"),
    visualBrief: visualBrief({
      visualType: "council_slate",
      primaryAgents: [vote.target],
      factualSlots: [
        agentSlot("targeted_agent", "Targeted agent", [vote.target], [receiptId]),
        valueSlot("round", "Round", round ?? "jury", [receiptId]),
        valueSlot("vote_outcome", "Vote outcome", `${vote.votes} of ${vote.totalVotes} ${vote.voteType} votes`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "abstract_vote_board",
      forbiddenInventions: [
        "Do not render generated vote text or repeated names.",
        "Do not imply private humiliation beyond the public vote margin.",
      ],
    }),
    source: "near_unanimous_vote_record",
    score: 80,
    narrativeOrder: (round ?? 80) + 28,
    thesisTags: ["public-reckoning", "pressure-break"],
    dedupeKey: `near-unanimous-vote:${round ?? "jury"}:${vote.voteType}:${vote.target.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}
