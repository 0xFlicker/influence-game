import type {
  PostgameAnalysisProjection,
  PostgameTurningPoint,
} from "../postgame-analysis";
import {
  allianceCutCandidate,
  buildAllianceFormationCandidates,
  buildHighlightedEliminationDuplicates,
} from "./alliance-candidates";
import {
  buildJuryRelationshipCandidates,
  juryJudgmentCandidate,
} from "./jury-candidates";
import {
  buildNearUnanimousVoteCandidates,
  buildPlayerSurvivalCandidates,
  buildRoundFactCandidates,
  buildTurningPointCandidates,
  buildVoteCohortCandidates,
} from "./public-record-candidates";
import { validateCandidate } from "./selection";
import type { HouseHighlightsCandidate } from "./types";

export function buildHouseHighlightCandidates(
  analysis: PostgameAnalysisProjection,
): HouseHighlightsCandidate[] {
  const candidates: HouseHighlightsCandidate[] = [];
  const allianceCutPoints = allianceMemberCutPoints(analysis);

  candidates.push(...buildAllianceFormationCandidates(analysis));
  candidates.push(...allianceCutPoints.map((point) => allianceCutCandidate(point)));
  candidates.push(...buildTurningPointCandidates(analysis));
  candidates.push(...buildRoundFactCandidates(analysis));
  candidates.push(...buildPlayerSurvivalCandidates(analysis));
  candidates.push(...buildVoteCohortCandidates(analysis));
  candidates.push(...buildNearUnanimousVoteCandidates(analysis));
  candidates.push(...buildJuryRelationshipCandidates(analysis));
  candidates.push(...buildHighlightedEliminationDuplicates(analysis, allianceCutPoints));

  const jury = juryJudgmentCandidate(analysis);
  if (jury) candidates.push(jury);

  return candidates.map(validateCandidate);
}

function allianceMemberCutPoints(
  analysis: PostgameAnalysisProjection,
): PostgameTurningPoint[] {
  return analysis.turningPoints.filter((point) => point.type === "alliance_member_cut");
}
