import type { PostgameAnalysisProjection } from "../postgame-analysis";
import {
  finalistVotedToEliminate,
  sanitizedEventRefs,
  uniquePlayers,
} from "./helpers";
import { resultsLink } from "./links";
import type {
  HouseHighlightsCandidate,
  JuryVoteEntry,
  PlayerRef,
} from "./types";
import { agentSlot, receiptTypeSlot, valueSlot, visualBrief } from "./visual-briefs";

export function buildJuryRelationshipCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  const candidates: HouseHighlightsCandidate[] = [];
  for (const vote of analysis.jury.perJurorVotes) {
    const payback = juryPaybackCandidate(vote, analysis);
    if (payback) candidates.push(payback);
    const forgiveness = juryForgivenessCandidate(vote);
    if (forgiveness) candidates.push(forgiveness);
  }
  return candidates;
}

export function juryJudgmentCandidate(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate | null {
  const finalVote = analysis.summary.finalVote;
  if (finalVote.status !== "available" || !finalVote.winner || finalVote.margin === null) {
    return null;
  }
  if (finalVote.margin > 1 && !analysis.turningPoints.some((point) => point.type === "jury_split")) {
    return null;
  }
  const runnerUp = finalVote.runnerUp;
  const finalVoteLabel = finalVote.voteCounts.map((entry) => entry.votes).sort((left, right) => right - left).join("-");
  const receiptId = "jury:final-vote";
  return {
    id: "jury-judgment:final-vote",
    title: "The jury made the damage permanent",
    category: "jury_judgment",
    involvedAgents: uniquePlayers([finalVote.winner, runnerUp].filter((player): player is PlayerRef => Boolean(player))),
    houseHook: `The final vote landed ${finalVoteLabel}, close enough for every ballot to matter.`,
    setup: "By the end, the social record had to survive the jury.",
    conflict: runnerUp
      ? `${finalVote.winner.name} and ${runnerUp.name} split the room into a final judgment.`
      : `${finalVote.winner.name} faced a jury with little room for error.`,
    payoff: `${finalVote.winner.name} won by ${finalVote.margin === 1 ? "one vote" : `${finalVote.margin} votes`}.`,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Final jury vote",
      description: `Final vote: ${finalVoteLabel}.`,
      factRefs: ["jury:final-vote"],
      ...(analysis.jury.evidence?.length ? { eventRefs: sanitizedEventRefs(analysis.jury.evidence) } : {}),
    }],
    confidence: finalVote.margin <= 1 ? "high" : "medium",
    deepLink: resultsLink(null, "Open jury result"),
    visualBrief: visualBrief({
      visualType: "jury_judgment",
      primaryAgents: [finalVote.winner],
      secondaryAgents: runnerUp ? [runnerUp] : [],
      factualSlots: [
        agentSlot("finalists", "Finalists", [finalVote.winner, runnerUp].filter((player): player is PlayerRef => Boolean(player)), [receiptId]),
        valueSlot("vote_outcome", "Final vote", finalVoteLabel, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "jury_tally", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "jury_wall",
      forbiddenInventions: [
        "Do not invent juror expressions or physical deliberation.",
        "Do not put vote counts inside generated imagery.",
      ],
    }),
    source: "jury_final_vote",
    score: 90,
    narrativeOrder: 30,
    thesisTags: ["alliance-collapse", "public-reckoning"],
    dedupeKey: "jury:final-vote",
    consequenceBearing: true,
    rejectionReasons: [],
  };
}

function juryPaybackCandidate(
  vote: JuryVoteEntry,
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate | null {
  const punished = analysis.jury.finalists.find((finalist) =>
    finalist.id !== vote.finalist.id && finalistVotedToEliminate(analysis, finalist.id, vote.juror.id)
  );
  if (!punished || vote.jurorEliminatedRound === null) return null;
  const receiptId = `jury-payback:${vote.juror.id}:${punished.id}`;
  return {
    id: receiptId,
    title: `${vote.juror.name} made ${punished.name} pay later`,
    category: "revenge",
    involvedAgents: uniquePlayers([vote.juror, punished, vote.finalist]),
    houseHook: `${punished.name} helped end ${vote.juror.name}'s game, then lost their jury vote.`,
    setup: `${punished.name} had voted against ${vote.juror.name}.`,
    conflict: `At the end, ${vote.juror.name} still controlled one piece of the verdict.`,
    payoff: `${vote.juror.name} voted for ${vote.finalist.name} instead.`,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Jury payback record",
      description: `${vote.juror.name} did not vote for the finalist who helped eliminate them.`,
      factRefs: [
        `round:${vote.jurorEliminatedRound}:eliminated:${vote.juror.id}`,
        `jury:vote:${vote.juror.id}:${vote.finalist.id}`,
      ],
      ...(vote.evidence?.length ? { eventRefs: sanitizedEventRefs(vote.evidence) } : {}),
    }],
    confidence: "medium",
    deepLink: resultsLink(null, "Open jury result"),
    visualBrief: visualBrief({
      visualType: "revenge_vote",
      primaryAgents: [vote.juror],
      secondaryAgents: [punished, vote.finalist],
      factualSlots: [
        agentSlot("jurors", "Juror", [vote.juror], [receiptId]),
        agentSlot("finalists", "Finalists involved", [punished, vote.finalist], [receiptId]),
        valueSlot("round", "Juror eliminated round", vote.jurorEliminatedRound, [receiptId]),
        valueSlot("vote_outcome", "Jury vote outcome", `${vote.juror.name} voted for ${vote.finalist.name}`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "jury_tally", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "jury_wall",
      forbiddenInventions: [
        "Do not invent payback as private motive beyond the public vote pattern.",
        "Do not depict juror emotion or confrontation.",
      ],
    }),
    source: "jury_vote_payback",
    score: 93,
    narrativeOrder: 82,
    thesisTags: ["public-reckoning", "jury-payback"],
    dedupeKey: `jury-relationship:${vote.juror.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}

function juryForgivenessCandidate(vote: JuryVoteEntry): HouseHighlightsCandidate | null {
  if (!vote.votedForFinalistWhoVotedToEliminateThem || vote.jurorEliminatedRound === null) return null;
  const receiptId = `jury-forgiveness:${vote.juror.id}:${vote.finalist.id}`;
  return {
    id: receiptId,
    title: `${vote.juror.name} still gave ${vote.finalist.name} the final vote`,
    category: "irony",
    involvedAgents: uniquePlayers([vote.juror, vote.finalist]),
    houseHook: `${vote.finalist.name} helped end ${vote.juror.name}'s game and still got the ballot.`,
    setup: `${vote.finalist.name} had voted against ${vote.juror.name}.`,
    conflict: `The jury vote forced ${vote.juror.name} to choose between memory and the final pitch.`,
    payoff: `${vote.juror.name} voted for ${vote.finalist.name} anyway.`,
    receipts: [{
      id: receiptId,
      tier: "vote_record",
      label: "Jury vote record",
      description: `${vote.juror.name} voted for a finalist who had helped eliminate them.`,
      factRefs: [
        `round:${vote.jurorEliminatedRound}:eliminated:${vote.juror.id}`,
        `jury:vote:${vote.juror.id}:${vote.finalist.id}`,
      ],
      ...(vote.evidence?.length ? { eventRefs: sanitizedEventRefs(vote.evidence) } : {}),
    }],
    confidence: "medium",
    deepLink: resultsLink(null, "Open jury result"),
    visualBrief: visualBrief({
      visualType: "jury_judgment",
      primaryAgents: [vote.juror],
      secondaryAgents: [vote.finalist],
      factualSlots: [
        agentSlot("jurors", "Juror", [vote.juror], [receiptId]),
        agentSlot("finalists", "Finalist", [vote.finalist], [receiptId]),
        valueSlot("round", "Juror eliminated round", vote.jurorEliminatedRound, [receiptId]),
        valueSlot("vote_outcome", "Jury vote outcome", `${vote.juror.name} voted for ${vote.finalist.name}`, [receiptId]),
        receiptTypeSlot(["vote_record"], [receiptId]),
      ],
      truthOverlays: ["agent_identity", "jury_tally", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "jury_wall",
      forbiddenInventions: [
        "Do not invent forgiveness as an emotional state.",
        "Do not render fake handwritten ballots or readable generated text.",
      ],
    }),
    source: "jury_vote_forgiveness",
    score: 81,
    narrativeOrder: 84,
    thesisTags: ["public-reckoning", "jury-payback"],
    dedupeKey: `jury-relationship:${vote.juror.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}
