import type {
  PostgameAnalysisEvidenceRef,
  PostgameAnalysisProjection,
  PostgameDerivationConfidence,
} from "../postgame-analysis";

export type PlayerRef = { id: string; name: string };

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
  posterDirection: string;
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
}

export interface HouseHighlightsProjection {
  schemaVersion: 1;
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
