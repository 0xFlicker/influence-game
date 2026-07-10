import type {
  HouseHighlightBackdropCategory,
  HouseHighlightReceiptTier,
  HouseHighlightShareFraming,
  HouseHighlightTruthOverlay,
  HouseHighlightVisualBrief,
  HouseHighlightVisualSlot,
  HouseHighlightVisualSlotKey,
  HouseHighlightVisualSlotSource,
  HouseHighlightVisualType,
  PlayerRef,
} from "./types";

const TEMPLATE_LABELS: Record<HouseHighlightVisualType, string> = {
  alliance_formation: "Alliance formation",
  alliance_rupture: "Alliance rupture",
  betrayal_vote: "Betrayal vote",
  vote_flip: "Vote flip",
  unlikely_survival: "Unlikely survival",
  shield_survival: "Shield survival",
  power_streak: "Power streak",
  council_slate: "Council slate",
  revenge_vote: "Revenge vote",
  jury_judgment: "Jury judgment",
  endgame_collapse: "Endgame collapse",
};

const BACKDROP_DESCRIPTIONS: Record<HouseHighlightBackdropCategory, string> = {
  none: "No generated or atmospheric plate.",
  empty_council_chamber: "Empty council room atmosphere with no agents, names, or vote text.",
  jury_wall: "Abstract jury wall atmosphere with no readable names or tallies.",
  abstract_vote_board: "Abstract vote-board texture with no readable ballots, names, or totals.",
  fractured_alliance_table: "Empty fractured-table atmosphere with no people or implied action.",
  spotlight_stage: "Empty spotlight-stage atmosphere with no agent pose or emotion.",
  surveillance_board_texture: "Abstract evidence-board texture with no readable names or labels.",
};

const SAFE_GENERATED_BACKDROPS = new Set<HouseHighlightBackdropCategory>([
  "empty_council_chamber",
  "jury_wall",
  "abstract_vote_board",
  "fractured_alliance_table",
  "spotlight_stage",
  "surveillance_board_texture",
]);

const RECEIPT_TIER_LABELS: Record<HouseHighlightReceiptTier, string> = {
  vote_record: "Vote record",
  alliance_receipt: "Alliance receipt",
  derived_signal: "Derived signal",
  public_quote: "Public quote",
  presentation_direction: "Presentation direction",
};

export function agentSlot(
  key: HouseHighlightVisualSlotKey,
  label: string,
  agents: readonly PlayerRef[],
  receiptIds: readonly string[] = [],
  source: HouseHighlightVisualSlotSource = "receipt",
): HouseHighlightVisualSlot {
  return {
    key,
    label,
    status: agents.length > 0 ? "filled" : "missing",
    source,
    agents: [...agents],
    receiptIds: [...receiptIds],
  };
}

export function valueSlot(
  key: HouseHighlightVisualSlotKey,
  label: string,
  value: string | number | null | undefined,
  receiptIds: readonly string[] = [],
  source: HouseHighlightVisualSlotSource = "canonical_fact",
): HouseHighlightVisualSlot {
  const text = value === null || value === undefined ? "" : String(value);
  return {
    key,
    label,
    status: text ? "filled" : "missing",
    source,
    value: text || undefined,
    receiptIds: [...receiptIds],
  };
}

export function receiptTypeSlot(
  receiptTiers: readonly HouseHighlightReceiptTier[],
  receiptIds: readonly string[] = [],
): HouseHighlightVisualSlot {
  const labels = uniqueStrings(receiptTiers.map((tier) => RECEIPT_TIER_LABELS[tier]));
  return valueSlot(
    "receipt_types",
    "Receipt types",
    labels.length > 0 ? labels.join(" + ") : null,
    receiptIds,
    "receipt",
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function visualBrief(params: {
  visualType: HouseHighlightVisualType;
  primaryAgents: readonly PlayerRef[];
  secondaryAgents?: readonly PlayerRef[];
  factualSlots: readonly HouseHighlightVisualSlot[];
  truthOverlays: readonly HouseHighlightTruthOverlay[];
  backdrop: HouseHighlightBackdropCategory;
  forbiddenInventions: readonly string[];
  warnings?: readonly string[];
  rejectedBackdropCategories?: readonly HouseHighlightBackdropCategory[];
  shareFraming?: readonly HouseHighlightShareFraming[];
}): HouseHighlightVisualBrief {
  return {
    visualType: params.visualType,
    templateLabel: TEMPLATE_LABELS[params.visualType],
    primaryAgents: [...params.primaryAgents],
    secondaryAgents: [...(params.secondaryAgents ?? [])],
    factualSlots: [...params.factualSlots],
    truthOverlays: [...params.truthOverlays],
    backdrop: {
      category: params.backdrop,
      generatedAllowed: SAFE_GENERATED_BACKDROPS.has(params.backdrop),
      description: BACKDROP_DESCRIPTIONS[params.backdrop],
    },
    shareFraming: [...(params.shareFraming ?? ["page_native", "square", "vertical", "wide"])],
    diagnostics: {
      forbiddenInventions: [...params.forbiddenInventions],
      warnings: [...(params.warnings ?? [])],
      rejectedBackdropCategories: [...(params.rejectedBackdropCategories ?? [])],
    },
  };
}
