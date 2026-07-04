import type { PostgameAnalysisProjection } from "../postgame-analysis";
import { buildHouseHighlightCandidates } from "./candidates";
import { fallbackProofLinks } from "./links";
import {
  chooseMainThesisGroup,
  diagnosticForCandidate,
  projectionForCut,
  rejectDuplicateCandidates,
  sceneFromCandidate,
  selectCandidatesForCut,
  supportsMainCut,
  thesisForScenes,
} from "./selection";
import type {
  BuildHouseHighlightsOptions,
  HouseHighlightsProjection,
} from "./types";

export function buildHouseHighlightsProjection(
  options: BuildHouseHighlightsOptions,
): HouseHighlightsProjection {
  const analysis = options.analysis;
  const allianceReceiptCount = countAllianceReceipts(analysis);
  const fallbackLinks = fallbackProofLinks(analysis);

  if (allianceReceiptCount === 0) {
    return {
      schemaVersion: 1,
      state: "unsupported_ineligible",
      eligibility: {
        status: "unsupported",
        reason: "missing_alliance_receipts",
        allianceReceiptCount,
      },
      thesis: null,
      cut: null,
      scenes: [],
      noCutReason: "missing_alliance_receipts",
      fallbackLinks,
      diagnostics: {
        selectedSceneIds: [],
        selectedCandidates: [],
        rejectedCandidates: [],
        notes: [{
          code: "missing_alliance_receipts",
          severity: "info",
          message: "House Highlights V1 requires named-alliance receipts before publishing an artifact.",
        }],
      },
    };
  }

  const candidates = rejectDuplicateCandidates(buildHouseHighlightCandidates(analysis));
  const eligibleCandidates = candidates.filter((candidate) => candidate.rejectionReasons.length === 0);
  const mainGroup = chooseMainThesisGroup(eligibleCandidates);

  if (supportsMainCut(mainGroup)) {
    const selectedCandidates = selectCandidatesForCut(
      mainGroup.filter((candidate) => candidate.consequenceBearing),
      5,
    );
    if (selectedCandidates.length >= 3) {
      const scenes = selectedCandidates.map(sceneFromCandidate);
      const thesis = thesisForScenes(scenes);
      return projectionForCut({
        state: "main_cut",
        eligibility: { allianceReceiptCount },
        thesis,
        cut: {
          kind: "main",
          title: "House Cut",
          thesis,
          shareCaption: thesis,
          scenes,
        },
        selectedScenes: scenes,
        candidates,
        fallbackLinks,
        notes: [],
      });
    }
  }

  const standaloneCandidates = eligibleCandidates.filter((candidate) => candidate.consequenceBearing);
  if (standaloneCandidates.length >= 2) {
    const scenes = selectCandidatesForCut(standaloneCandidates, 3).map(sceneFromCandidate);
    return projectionForCut({
      state: "mini_highlight_pack",
      eligibility: { allianceReceiptCount },
      thesis: null,
      cut: {
        kind: "mini_pack",
        title: "House Highlight Pack",
        thesis: null,
        shareCaption: scenes.map((scene) => scene.houseHook).join(" "),
        scenes,
      },
      selectedScenes: scenes,
      candidates,
      fallbackLinks,
      notes: [{
        code: "main_cut_rejected",
        severity: "info",
        message: "No single thesis had three medium-or-better scenes, so the artifact uses mini-highlights.",
      }],
    });
  }

  const diagnosedCandidates = candidates.map((candidate) =>
    candidate.rejectionReasons.length > 0
      ? candidate
      : { ...candidate, rejectionReasons: ["insufficient_scene_evidence"] }
  );
  return {
    schemaVersion: 1,
    state: "no_cut",
    eligibility: {
      status: "eligible",
      reason: null,
      allianceReceiptCount,
    },
    thesis: null,
    cut: null,
    scenes: [],
    noCutReason: "insufficient_scene_evidence",
    fallbackLinks,
    diagnostics: {
      selectedSceneIds: [],
      selectedCandidates: [],
      rejectedCandidates: diagnosedCandidates.map((candidate) => diagnosticForCandidate(candidate, false)),
      notes: [{
        code: "insufficient_scene_evidence",
        severity: "info",
        message: "The House found alliance receipts, but not enough legible scenes to publish a cut.",
      }],
    },
  };
}

function countAllianceReceipts(analysis: PostgameAnalysisProjection): number {
  return analysis.allianceSummary.proposalCount
    + analysis.allianceSummary.topNamedAlliances.length
    + analysis.allianceSummary.huddleCount
    + analysis.turningPoints.filter((point) => point.type === "alliance_member_cut").length;
}
