import type {
  AdminHouseHighlightVisualBrief,
  HouseHighlightBackdropCategory,
  HouseHighlightPlayerRef,
  HouseHighlightVisualBrief,
  HouseHighlightVisualType,
} from "../lib/api";

export function houseHighlightVisualBriefFixture(params: {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents?: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightBackdropCategory;
}): HouseHighlightVisualBrief {
  const receiptIds = ["fixture-receipt"];
  return {
    visualType: params.visualType,
    templateLabel: params.templateLabel,
    primaryAgents: params.primaryAgents,
    secondaryAgents: params.secondaryAgents ?? [],
    factualSlots: [
      {
        key: "primary_agent",
        label: "Primary agent",
        status: "filled",
        source: "receipt",
        agents: params.primaryAgents,
        receiptIds,
      },
      {
        key: "receipt_types",
        label: "Receipt types",
        status: "filled",
        source: "receipt",
        value: "Vote record",
        receiptIds,
      },
    ],
    truthOverlays: ["agent_identity", "receipt_badge", "proof_link"],
    backdrop: {
      category: params.backdrop,
      generatedAllowed: params.backdrop !== "none",
      description: `${params.templateLabel} fixture backdrop.`,
    },
    shareFraming: ["page_native", "square", "vertical", "wide"],
  };
}

export function adminHouseHighlightVisualBriefFixture(params: {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents?: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightBackdropCategory;
  forbiddenInventions?: string[];
  rejectedBackdropCategories?: HouseHighlightBackdropCategory[];
}): AdminHouseHighlightVisualBrief {
  return {
    ...houseHighlightVisualBriefFixture(params),
    diagnostics: {
      forbiddenInventions: params.forbiddenInventions ?? [],
      warnings: [],
      rejectedBackdropCategories: params.rejectedBackdropCategories ?? [],
    },
  };
}

export function candidateVisualBriefFixture(params: {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents?: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightBackdropCategory;
  forbiddenInventions?: string[];
  rejectedBackdropCategories?: HouseHighlightBackdropCategory[];
}) {
  const brief = adminHouseHighlightVisualBriefFixture(params);
  return {
    visualType: brief.visualType,
    templateLabel: brief.templateLabel,
    factualSlots: brief.factualSlots,
    backdrop: brief.backdrop,
    diagnostics: brief.diagnostics,
  };
}
