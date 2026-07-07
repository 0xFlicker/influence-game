import type {
  PostgameAnalysisEvidenceRef,
  PostgameAnalysisProjection,
  PostgameDerivationConfidence,
} from "../postgame-analysis";

export type PlayerRef = { id: string; name: string; avatarUrl?: string | null };

export type HouseHighlightsState =
  | "main_cut"
  | "mini_highlight_pack"
  | "no_cut"
  | "unsupported_ineligible";

export type HouseHighlightCategory =
  | "betrayal"
  | "suspense"
  | "irony"
  | "revenge"
  | "loyalty"
  | "chaos"
  | "collapse"
  | "triumph"
  | "humiliation"
  | "jury_judgment"
  | "unlikely_survival";

export type HouseHighlightReceiptTier =
  | "vote_record"
  | "alliance_receipt"
  | "derived_signal"
  | "public_quote"
  | "presentation_direction";

export interface HouseHighlightReceipt {
  id: string;
  tier: HouseHighlightReceiptTier;
  label: string;
  description: string;
  factRefs: string[];
  eventRefs?: PostgameAnalysisEvidenceRef[];
}

export interface HouseHighlightDeepLink {
  surface: "results" | "replay";
  label: string;
  round: number | null;
  anchor: string;
}

export type HouseHighlightVisualType =
  | "alliance_formation"
  | "alliance_rupture"
  | "betrayal_vote"
  | "vote_flip"
  | "unlikely_survival"
  | "shield_survival"
  | "power_streak"
  | "council_slate"
  | "revenge_vote"
  | "jury_judgment"
  | "endgame_collapse";

export type HouseHighlightVisualSlotKey =
  | "primary_agent"
  | "exposed_agent"
  | "targeted_agent"
  | "eliminated_agent"
  | "surviving_agent"
  | "protected_agent"
  | "voters"
  | "alliance_members"
  | "finalists"
  | "jurors"
  | "round"
  | "vote_outcome"
  | "receipt_types";

export type HouseHighlightVisualSlotSource =
  | "receipt"
  | "canonical_fact"
  | "scene_context";

export interface HouseHighlightVisualSlot {
  key: HouseHighlightVisualSlotKey;
  label: string;
  status: "filled" | "missing";
  source: HouseHighlightVisualSlotSource;
  agents?: PlayerRef[];
  value?: string;
  receiptIds: string[];
}

export type HouseHighlightTruthOverlay =
  | "agent_identity"
  | "round_label"
  | "vote_marker"
  | "alliance_line"
  | "receipt_badge"
  | "outcome_caption"
  | "proof_link"
  | "shield_marker"
  | "jury_tally"
  | "power_tally";

export type HouseHighlightBackdropCategory =
  | "none"
  | "empty_council_chamber"
  | "jury_wall"
  | "abstract_vote_board"
  | "fractured_alliance_table"
  | "spotlight_stage"
  | "surveillance_board_texture";

export interface HouseHighlightVisualBackdrop {
  category: HouseHighlightBackdropCategory;
  generatedAllowed: boolean;
  description: string;
}

export type HouseHighlightShareFraming = "page_native" | "square" | "vertical" | "wide";

export interface HouseHighlightVisualBriefDiagnostics {
  forbiddenInventions: string[];
  warnings: string[];
  rejectedBackdropCategories: HouseHighlightBackdropCategory[];
}

export interface HouseHighlightVisualBrief {
  visualType: HouseHighlightVisualType;
  templateLabel: string;
  primaryAgents: PlayerRef[];
  secondaryAgents: PlayerRef[];
  factualSlots: HouseHighlightVisualSlot[];
  truthOverlays: HouseHighlightTruthOverlay[];
  backdrop: HouseHighlightVisualBackdrop;
  shareFraming: HouseHighlightShareFraming[];
  diagnostics: HouseHighlightVisualBriefDiagnostics;
}

export type HouseHighlightVisualCardTemplate =
  | "hero_vote_action"
  | "generic_scene";

export type HouseHighlightVisualCardFactKind =
  | "vote_action"
  | "alliance_membership"
  | "elimination"
  | "protection"
  | "survival"
  | "jury_outcome"
  | "round_context"
  | "outcome";

export interface HouseHighlightVisualCardFact {
  id: string;
  kind: HouseHighlightVisualCardFactKind;
  text: string;
  agentIds: string[];
  receiptIds: string[];
}

export interface HouseHighlightVisualCard {
  template: HouseHighlightVisualCardTemplate;
  title: string;
  eyebrow: string;
  altText: string;
  primaryAgents: PlayerRef[];
  secondaryAgents: PlayerRef[];
  roundLabel: string | null;
  outcome: string;
  factLines: HouseHighlightVisualCardFact[];
  backdrop: HouseHighlightVisualBackdrop;
  shareFraming: HouseHighlightShareFraming[];
}

export interface HouseHighlightSceneCard {
  id: string;
  title: string;
  category: HouseHighlightCategory;
  involvedAgents: PlayerRef[];
  houseHook: string;
  setup: string;
  conflict: string;
  payoff: string;
  receipts: HouseHighlightReceipt[];
  confidence: PostgameDerivationConfidence;
  deepLink: HouseHighlightDeepLink;
  visualBrief: HouseHighlightVisualBrief;
}

export interface HouseHighlightsCut {
  kind: "main" | "mini_pack";
  title: string;
  thesis: string | null;
  shareCaption: string;
  scenes: HouseHighlightSceneCard[];
}

export interface HouseHighlightsCandidateDiagnostic {
  id: string;
  title: string;
  category: HouseHighlightCategory;
  source: string;
  confidence: PostgameDerivationConfidence;
  selected: boolean;
  score: number;
  receiptCount: number;
  reasons: string[];
  visualBrief: Pick<HouseHighlightVisualBrief, "visualType" | "templateLabel" | "factualSlots" | "backdrop" | "diagnostics">;
}

export interface HouseHighlightsProjection {
  schemaVersion: 2;
  state: HouseHighlightsState;
  eligibility: {
    status: "eligible" | "unsupported";
    reason: string | null;
    allianceReceiptCount: number;
  };
  thesis: string | null;
  cut: HouseHighlightsCut | null;
  scenes: HouseHighlightSceneCard[];
  noCutReason: string | null;
  fallbackLinks: HouseHighlightDeepLink[];
  diagnostics: {
    selectedSceneIds: string[];
    selectedCandidates: HouseHighlightsCandidateDiagnostic[];
    rejectedCandidates: HouseHighlightsCandidateDiagnostic[];
    notes: Array<{ code: string; severity: "info" | "warning"; message: string }>;
  };
}

export interface BuildHouseHighlightsOptions {
  analysis: PostgameAnalysisProjection;
}

export interface HouseHighlightsCandidate extends HouseHighlightSceneCard {
  source: string;
  score: number;
  narrativeOrder: number;
  thesisTags: string[];
  dedupeKey: string;
  consequenceBearing: boolean;
  rejectionReasons: string[];
}

export type RoundSummary = PostgameAnalysisProjection["roundSummaries"][number];
export type VoteCohort = PostgameAnalysisProjection["derivedVoteCohorts"][number];
export type UnanimousVote = PostgameAnalysisProjection["summary"]["unanimousOrNearUnanimousVotes"][number];
export type JuryVoteEntry = PostgameAnalysisProjection["jury"]["perJurorVotes"][number];
export type PlayerSummary = PostgameAnalysisProjection["playerSummaries"][number];
