import type {
  AdminHouseHighlightVisualBrief,
  HouseHighlightBackdropCategory,
  HouseHighlightPlayerRef,
  HouseHighlightVisualBrief,
  HouseHighlightVisualCard,
  HouseHighlightVisualCardTemplate,
  HouseHighlightVisualType,
} from "../lib/api";

export function houseHighlightVisualBriefFixture(params: {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents?: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightBackdropCategory;
}): HouseHighlightVisualBrief {
  return {
    visualType: params.visualType,
    templateLabel: params.templateLabel,
    primaryAgents: params.primaryAgents,
    secondaryAgents: params.secondaryAgents ?? [],
    backdrop: {
      category: params.backdrop,
      generatedAllowed: params.backdrop !== "none",
      description: `${params.templateLabel} fixture backdrop.`,
    },
    shareFraming: ["page_native", "square", "vertical", "wide"],
  };
}

export function houseHighlightVisualCardFixture(params: {
  template?: HouseHighlightVisualCardTemplate;
  title: string;
  eyebrow: string;
  primaryAgents: HouseHighlightPlayerRef[];
  secondaryAgents?: HouseHighlightPlayerRef[];
  backdrop: HouseHighlightBackdropCategory;
  facts?: string[];
}): HouseHighlightVisualCard {
  const facts = params.facts ?? [`${params.primaryAgents[0]?.name ?? "A player"} shaped this scene.`];
  return {
    template: params.template ?? "generic_scene",
    title: params.title,
    eyebrow: params.eyebrow,
    altText: `${params.title}. ${facts.join(" ")}`,
    primaryAgents: params.primaryAgents,
    secondaryAgents: params.secondaryAgents ?? [],
    roundLabel: "Round 1",
    outcome: facts[0] ?? params.title,
    factLines: facts.map((text, index) => ({
      id: `fixture-card-fact:${index}`,
      kind: index === 0 ? "outcome" : "round_context",
      text,
      agentIds: params.primaryAgents.map((agent) => agent.id),
      receiptIds: ["fixture-receipt"],
    })),
    backdrop: {
      category: params.backdrop,
      generatedAllowed: params.backdrop !== "none",
      description: `${params.eyebrow} fixture card backdrop.`,
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
  const receiptIds = ["fixture-receipt"];
  return {
    ...houseHighlightVisualBriefFixture(params),
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
