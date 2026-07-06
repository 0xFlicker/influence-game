import type {
  PostgameAnalysisProjection,
  PostgameTurningPoint,
} from "../postgame-analysis";
import {
  playerFromCriteria,
  playersFromCriteria,
  sanitizedEventRefs,
  stringArray,
  uniquePlayers,
} from "./helpers";
import { resultsLink } from "./links";
import type { HouseHighlightsCandidate } from "./types";
import { agentSlot, receiptTypeSlot, valueSlot, visualBrief } from "./visual-briefs";

export function buildAllianceFormationCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  return analysis.allianceSummary.topNamedAlliances
    .filter((alliance) => alliance.huddleOutcomeCount > 0 || alliance.latestOutcome)
    .map((alliance, index) => {
      const members = alliance.memberNames.join(", ");
      const setup = `${alliance.name} formed around ${members}.`;
      const conflict = alliance.latestOutcome?.plan
        ? `Their recorded plan was: ${alliance.latestOutcome.plan}`
        : `The pact had to turn ${alliance.purpose.toLowerCase()} into public consequences.`;
      const payoff = alliance.latestOutcome?.leakOrBetrayalClaims.length
        ? `The House kept the leak claim on the board before the vote record caught up.`
        : `The alliance became the receipt that made the later turn legible.`;
      const receiptId = `alliance:${alliance.id}`;
      return {
        id: `alliance-formation:${alliance.id}`,
        title: `${alliance.name} made the pact visible`,
        category: "loyalty",
        involvedAgents: alliance.members.map((member) => ({ id: member.id, name: member.name })),
        houseHook: `${alliance.name} left receipts before the room turned.`,
        setup,
        conflict,
        payoff,
        receipts: [{
          id: receiptId,
          tier: "alliance_receipt",
          label: alliance.name,
          description: `Named alliance with ${alliance.huddleOutcomeCount} recorded huddle outcome(s).`,
          factRefs: [`alliance:${alliance.id}`],
        }],
        confidence: "medium",
        deepLink: resultsLink(alliance.createdRound, "Open alliance receipts", `alliance-${alliance.id}`),
        visualBrief: visualBrief({
          visualType: "alliance_formation",
          primaryAgents: alliance.members,
          factualSlots: [
            agentSlot("alliance_members", "Alliance members", alliance.members, [receiptId]),
            valueSlot("round", "Round", alliance.createdRound, [receiptId]),
            receiptTypeSlot(["alliance_receipt"], [receiptId]),
          ],
          truthOverlays: ["agent_identity", "alliance_line", "round_label", "receipt_badge", "proof_link"],
          backdrop: "fractured_alliance_table",
          forbiddenInventions: [
            "Do not show a physical secret meeting.",
            "Do not imply private emotion or loyalty beyond the alliance receipt.",
          ],
        }),
        source: "alliance_summary",
        score: 80 - index,
        narrativeOrder: 10 + index,
        thesisTags: ["alliance-collapse", "public-reckoning"],
        dedupeKey: `alliance:${alliance.id}:formation`,
        consequenceBearing: false,
        rejectionReasons: [],
      };
    });
}

export function allianceCutCandidate(point: PostgameTurningPoint): HouseHighlightsCandidate {
  const eliminated = playerFromCriteria(point, "eliminatedPlayerId")
    ?? point.players[0]
    ?? { id: "unknown", name: "Unknown" };
  const alliedVoters = playersFromCriteria(point, "alliedVoterIds");
  const visualVoters = alliedVoters.length > 0
    ? alliedVoters
    : point.players.filter((player) => player.id !== eliminated.id);
  const cutterNames = alliedVoters.length > 0
    ? alliedVoters.map((player) => player.name).join(", ")
    : visualVoters.map((player) => player.name).join(", ");
  const allianceIds = stringArray(point.criteria.allianceIds);
  const eliminationReceiptId = `round:${point.round}:eliminated:${eliminated.id}`;
  const allianceReceiptId = `alliance-cut:${point.round}:${eliminated.id}`;
  return {
    id: `alliance-cut:${point.round}:${eliminated.id}`,
    title: `${eliminated.name} was cut from inside the pact`,
    category: "betrayal",
    involvedAgents: uniquePlayers([eliminated, ...alliedVoters, ...point.players]),
    houseHook: `${cutterNames || "An ally"} helped bury ${eliminated.name}.`,
    setup: `${eliminated.name} shared a named alliance before the vote turned.`,
    conflict: `The pressure came from inside the alliance.`,
    payoff: point.description,
    receipts: [
      {
        id: eliminationReceiptId,
        tier: "vote_record",
        label: `Round ${point.round} elimination`,
        description: `${eliminated.name} was eliminated in round ${point.round}.`,
        factRefs: point.evidence.factRefs.filter((ref) => ref.startsWith("round:")),
        ...(point.evidence.eventRefs?.length ? { eventRefs: sanitizedEventRefs(point.evidence.eventRefs) } : {}),
      },
      {
        id: allianceReceiptId,
        tier: "alliance_receipt",
        label: "Alliance-member cut",
        description: point.description,
        factRefs: point.evidence.factRefs.filter((ref) => ref.startsWith("alliance:")).concat(allianceIds.map((id) => `alliance:${id}`)),
      },
    ],
    confidence: point.confidence,
    deepLink: resultsLink(point.round, "Open round result"),
    visualBrief: visualBrief({
      visualType: "betrayal_vote",
      primaryAgents: [eliminated],
      secondaryAgents: visualVoters,
      factualSlots: [
        agentSlot("eliminated_agent", "Eliminated agent", [eliminated], [eliminationReceiptId]),
        agentSlot("voters", "Allied voters", visualVoters, [allianceReceiptId]),
        valueSlot("round", "Round", point.round, [eliminationReceiptId]),
        valueSlot("vote_outcome", "Vote outcome", `${eliminated.name} eliminated`, [eliminationReceiptId]),
        receiptTypeSlot(["vote_record", "alliance_receipt"], [eliminationReceiptId, allianceReceiptId]),
      ],
      truthOverlays: ["agent_identity", "alliance_line", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
      backdrop: "abstract_vote_board",
      forbiddenInventions: [
        "Do not depict whispering, plotting, or a physical betrayal scene.",
        "Do not invent anger, guilt, surprise, or motive.",
      ],
    }),
    source: point.derivationMethod,
    score: 100,
    narrativeOrder: 20,
    thesisTags: ["alliance-collapse", "public-reckoning"],
    dedupeKey: `elimination:${point.round}:${eliminated.id}`,
    consequenceBearing: true,
    rejectionReasons: [],
  };
}

export function buildHighlightedEliminationDuplicates(
  analysis: PostgameAnalysisProjection,
  allianceCutPoints: readonly PostgameTurningPoint[],
): HouseHighlightsCandidate[] {
  const allianceCutKeys = new Set(allianceCutPoints.map((point) => {
    const eliminated = playerFromCriteria(point, "eliminatedPlayerId") ?? point.players[0];
    return eliminated ? `elimination:${point.round}:${eliminated.id}` : null;
  }).filter((key): key is string => Boolean(key)));

  return analysis.summary.highlightedEliminations
    .filter((elimination) => allianceCutKeys.has(`elimination:${elimination.round}:${elimination.player.id}`))
    .map((elimination) => {
      const receiptId = `highlighted-elimination:${elimination.round}:${elimination.player.id}`;
      return {
        id: `highlighted-elimination:${elimination.round}:${elimination.player.id}`,
        title: `${elimination.player.name} became the visible consequence`,
        category: "collapse" as const,
        involvedAgents: [elimination.player],
        houseHook: `${elimination.player.name}'s exit was already a highlight before the alliance receipt sharpened it.`,
        setup: `${elimination.player.name} entered round ${elimination.round} as a notable target.`,
        conflict: `The vote record made the room choose a side.`,
        payoff: `${elimination.player.name} was eliminated in round ${elimination.round}.`,
        receipts: [{
          id: receiptId,
          tier: "vote_record" as const,
          label: "Highlighted elimination",
          description: `Highlighted by deterministic postgame rules: ${elimination.highlightReasons.join(", ")}.`,
          factRefs: [`round:${elimination.round}:eliminated:${elimination.player.id}`],
        }],
        confidence: elimination.confidence,
        deepLink: resultsLink(elimination.round, "Open round result"),
        visualBrief: visualBrief({
          visualType: "council_slate",
          primaryAgents: [elimination.player],
          factualSlots: [
            agentSlot("eliminated_agent", "Eliminated agent", [elimination.player], [receiptId]),
            valueSlot("round", "Round", elimination.round, [receiptId]),
            valueSlot("vote_outcome", "Vote outcome", `${elimination.player.name} eliminated`, [receiptId]),
            receiptTypeSlot(["vote_record"], [receiptId]),
          ],
          truthOverlays: ["agent_identity", "round_label", "vote_marker", "receipt_badge", "outcome_caption", "proof_link"],
          backdrop: "abstract_vote_board",
          forbiddenInventions: [
            "Do not invent motive or private pressure.",
            "Do not render readable generated vote text.",
          ],
        }),
        source: elimination.derivationMethod,
        score: 65,
        narrativeOrder: 21,
        thesisTags: ["alliance-collapse", "public-reckoning"],
        dedupeKey: `elimination:${elimination.round}:${elimination.player.id}`,
        consequenceBearing: true,
        rejectionReasons: [],
      };
    });
}
