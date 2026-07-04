import type { PostgameDerivationConfidence } from "../postgame-analysis";
import { uniqueStrings } from "./helpers";
import type {
  HouseHighlightCategory,
  HouseHighlightDeepLink,
  HouseHighlightSceneCard,
  HouseHighlightsCandidate,
  HouseHighlightsCandidateDiagnostic,
  HouseHighlightsCut,
  HouseHighlightsProjection,
} from "./types";

const MAX_BETRAYAL_SCENES = 2;

const CONFIDENCE_SCORE: Record<PostgameDerivationConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function projectionForCut(params: {
  state: "main_cut" | "mini_highlight_pack";
  eligibility: { allianceReceiptCount: number };
  thesis: string | null;
  cut: HouseHighlightsCut;
  selectedScenes: HouseHighlightSceneCard[];
  candidates: readonly HouseHighlightsCandidate[];
  fallbackLinks: HouseHighlightDeepLink[];
  notes: HouseHighlightsProjection["diagnostics"]["notes"];
}): HouseHighlightsProjection {
  const selectedIds = new Set(params.selectedScenes.map((scene) => scene.id));
  const candidatesById = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));
  const selectedReason = params.state === "main_cut"
    ? "selected_for_main_cut"
    : "selected_for_mini_highlight_pack";
  return {
    schemaVersion: 1,
    state: params.state,
    eligibility: {
      status: "eligible",
      reason: null,
      allianceReceiptCount: params.eligibility.allianceReceiptCount,
    },
    thesis: params.thesis,
    cut: params.cut,
    scenes: params.selectedScenes,
    noCutReason: null,
    fallbackLinks: params.fallbackLinks,
    diagnostics: {
      selectedSceneIds: [...selectedIds],
      selectedCandidates: params.selectedScenes
        .map((scene) => candidatesById.get(scene.id))
        .filter((candidate): candidate is HouseHighlightsCandidate => Boolean(candidate))
        .map((candidate) => diagnosticForCandidate(candidate, true, selectedReason)),
      rejectedCandidates: params.candidates
        .filter((candidate) => !selectedIds.has(candidate.id) || candidate.rejectionReasons.length > 0)
        .map((candidate) => diagnosticForCandidate(
          selectedIds.has(candidate.id) || candidate.rejectionReasons.length > 0
            ? candidate
            : { ...candidate, rejectionReasons: ["not_in_final_edit"] },
          selectedIds.has(candidate.id),
        )),
      notes: params.notes,
    },
  };
}

export function validateCandidate(candidate: HouseHighlightsCandidate): HouseHighlightsCandidate {
  const reasons = [...candidate.rejectionReasons];
  if (CONFIDENCE_SCORE[candidate.confidence] < CONFIDENCE_SCORE.medium) {
    reasons.push("low_confidence");
  }
  if (!candidate.setup || !candidate.conflict || !candidate.payoff) {
    reasons.push("missing_setup_conflict_payoff");
  }
  if (candidate.receipts.length === 0) {
    reasons.push("missing_receipts");
  }
  if (candidate.category === "betrayal" && !candidate.receipts.some((receipt) => receipt.tier === "alliance_receipt")) {
    reasons.push("missing_alliance_receipt_for_label");
  }
  return { ...candidate, rejectionReasons: uniqueStrings(reasons) };
}

export function rejectDuplicateCandidates(
  candidates: readonly HouseHighlightsCandidate[],
): HouseHighlightsCandidate[] {
  const seen = new Map<string, HouseHighlightsCandidate>();
  return candidates.map((candidate) => {
    const existing = seen.get(candidate.dedupeKey);
    if (!existing) {
      seen.set(candidate.dedupeKey, candidate);
      return candidate;
    }
    if (candidate.score > existing.score) {
      existing.rejectionReasons.push("duplicate_story_beat");
      seen.set(candidate.dedupeKey, candidate);
      return candidate;
    }
    return {
      ...candidate,
      rejectionReasons: uniqueStrings([...candidate.rejectionReasons, "duplicate_story_beat"]),
    };
  });
}

export function chooseMainThesisGroup(
  candidates: readonly HouseHighlightsCandidate[],
): HouseHighlightsCandidate[] {
  const byTag = new Map<string, HouseHighlightsCandidate[]>();
  for (const candidate of candidates) {
    for (const tag of candidate.thesisTags) {
      const current = byTag.get(tag) ?? [];
      current.push(candidate);
      byTag.set(tag, current);
    }
  }
  return [...byTag.entries()]
    .sort((left, right) =>
      right[1].length - left[1].length ||
      sumScores(right[1]) - sumScores(left[1]) ||
      left[0].localeCompare(right[0])
    )[0]?.[1] ?? [];
}

export function supportsMainCut(candidates: readonly HouseHighlightsCandidate[]): boolean {
  const consequenceCount = candidates.filter((candidate) => candidate.consequenceBearing).length;
  const hasStoryAnchor = candidates.some((candidate) =>
    candidate.category === "betrayal"
    || candidate.category === "collapse"
    || candidate.category === "triumph"
    || candidate.category === "unlikely_survival"
    || candidate.category === "jury_judgment"
    || candidate.category === "revenge"
  );
  return consequenceCount >= 3 && hasStoryAnchor;
}

export function selectCandidatesForCut(
  candidates: readonly HouseHighlightsCandidate[],
  limit: number,
): HouseHighlightsCandidate[] {
  const selected: HouseHighlightsCandidate[] = [];
  const selectedIds = new Set<string>();
  const ordered = orderedCandidates(candidates);
  const categoryPriority: HouseHighlightCategory[] = [
    "betrayal",
    "triumph",
    "unlikely_survival",
    "jury_judgment",
    "revenge",
    "suspense",
    "chaos",
    "collapse",
    "humiliation",
    "loyalty",
    "irony",
  ];

  const tryAdd = (candidate: HouseHighlightsCandidate): boolean => {
    if (selected.length >= limit || selectedIds.has(candidate.id)) return false;
    if (
      candidate.category === "betrayal"
      && selected.filter((scene) => scene.category === "betrayal").length >= MAX_BETRAYAL_SCENES
    ) {
      candidate.rejectionReasons = uniqueStrings([...candidate.rejectionReasons, "betrayal_scene_cap"]);
      return false;
    }
    selected.push(candidate);
    selectedIds.add(candidate.id);
    return true;
  };

  for (const category of categoryPriority) {
    const candidate = ordered
      .filter((entry) => entry.category === category)
      .sort(compareByEditorialStrength)[0];
    if (candidate) tryAdd(candidate);
  }

  for (const candidate of [...ordered].sort(compareByEditorialStrength)) {
    tryAdd(candidate);
  }

  return orderedCandidates(selected);
}

export function sceneFromCandidate({
  source: _source,
  score: _score,
  narrativeOrder: _narrativeOrder,
  thesisTags: _thesisTags,
  dedupeKey: _dedupeKey,
  consequenceBearing: _consequenceBearing,
  rejectionReasons: _rejectionReasons,
  ...scene
}: HouseHighlightsCandidate): HouseHighlightSceneCard {
  return scene;
}

export function thesisForScenes(scenes: readonly HouseHighlightSceneCard[]): string {
  if (
    scenes.some((scene) => scene.category === "triumph")
    && scenes.some((scene) => scene.category === "jury_judgment")
  ) {
    return "This was the game where power hardened, then the jury made every cut count.";
  }
  if (
    scenes.some((scene) => scene.category === "unlikely_survival")
    && scenes.some((scene) => scene.category === "suspense")
  ) {
    return "This was the game where the room kept missing, until the endgame stopped forgiving mistakes.";
  }
  if (scenes.some((scene) => scene.category === "betrayal") && scenes.some((scene) => scene.category === "jury_judgment")) {
    return "This was the game where the pact collapsed, and the jury made it matter.";
  }
  if (scenes.some((scene) => scene.category === "betrayal")) {
    return "This was the game where the pact collapsed one vote too late.";
  }
  return "This was the game where the public record kept changing who looked safe.";
}

export function diagnosticForCandidate(
  candidate: HouseHighlightsCandidate,
  selected: boolean,
  selectedReason = "selected",
): HouseHighlightsCandidateDiagnostic {
  return {
    id: candidate.id,
    title: candidate.title,
    category: candidate.category,
    source: candidate.source,
    confidence: candidate.confidence,
    selected,
    score: candidate.score,
    receiptCount: candidate.receipts.length,
    reasons: selected ? [selectedReason] : uniqueStrings(candidate.rejectionReasons),
  };
}

function orderedCandidates(candidates: readonly HouseHighlightsCandidate[]): HouseHighlightsCandidate[] {
  return [...candidates]
    .sort((left, right) =>
      left.narrativeOrder - right.narrativeOrder ||
      right.score - left.score ||
      left.id.localeCompare(right.id)
    );
}

function compareByEditorialStrength(
  left: HouseHighlightsCandidate,
  right: HouseHighlightsCandidate,
): number {
  return right.score - left.score
    || CONFIDENCE_SCORE[right.confidence] - CONFIDENCE_SCORE[left.confidence]
    || left.narrativeOrder - right.narrativeOrder
    || left.id.localeCompare(right.id);
}

function sumScores(candidates: readonly HouseHighlightsCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.score, 0);
}
