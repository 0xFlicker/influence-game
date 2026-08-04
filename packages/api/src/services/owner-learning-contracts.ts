import { sha256StableJson } from "./stable-hash.js";

export const OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION = "owner-learning-eligibility-v1";
export const OWNER_LEARNING_EVIDENCE_VERSION = "owner-learning-evidence-v1";
export const OWNER_LEARNING_REVIEWER_VERSION = "owner-learning-reviewer-v1";
export const OWNER_LEARNING_PROMPT_VERSION = "owner-learning-prompt-v1";
export const OWNER_LEARNING_SCHEMA_VERSION = "owner-learning-result-v1";
export const OWNER_LEARNING_PROVIDER_POLICY_VERSION = "owner-learning-luna-flex-v1";

export const OWNER_LEARNING_MAX_GAMES = 3;
export const OWNER_LEARNING_MAX_RECOMMENDATIONS = 3;
export const OWNER_LEARNING_MAX_LOGICAL_CALLS = 4;
export const OWNER_LEARNING_MAX_DIVES = 3;
export const OWNER_LEARNING_MAX_IDEMPOTENCY_KEY_CHARS = 200;

export type OwnerLearningAnalysisTrack =
  | "awaiting_evidence"
  | "evidence_rich"
  | "strategy_health_check";

export type OwnerLearningAnalysisStatus =
  | "queued"
  | "running"
  | "ready"
  | "no_change"
  | "failed";

export type OwnerLearningStage =
  | "evidence_ready"
  | "scanning_narratives"
  | "investigating_moments"
  | "drafting_recommendations"
  | "complete";

export type OwnerLearningResolution =
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded";

export type OwnerLearningCapacitySubstatus =
  | "waiting_for_capacity"
  | "using_standard_capacity";

export type OwnerLearningSafeFailureCode =
  | "provider_capacity_exhausted"
  | "provider_timeout"
  | "provider_error"
  | "invalid_structured_output"
  | "tier_mismatch"
  | "input_budget_exceeded"
  | "output_budget_exhausted"
  | "logical_call_budget_exhausted"
  | "evidence_unavailable"
  | "worker_interrupted";

export type OwnerLearningCallState =
  | "reserved"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "ambiguous";

export type OwnerLearningCostSource = "actual" | "estimated" | "unavailable";
export type OwnerLearningCapacityPath = "flex" | "standard_fallback";

export type OwnerLearningApplyDisposition =
  | "not_ready"
  | "awaiting_owner"
  | "available"
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded"
  | "unavailable";

export interface OwnerLearningEvidenceRef {
  kind: "canonical_event" | "decision" | "dialogue" | "cognition" | "game_summary";
  gameId: string;
  coordinate: string;
  sourceHash: string;
  sourceVersion: string;
}

export type OwnerLearningRecommendationDisposition =
  | "change"
  | "keep"
  | "gather_more_evidence";

export type OwnerLearningConfidence = "low" | "medium" | "high";

export type OwnerLearningProofKind =
  | "observed_pattern"
  | "prompt_guidance_defect"
  | "combined";

export type OwnerLearningGuidanceRubricCategory =
  | "ambiguous_priority"
  | "conflicting_instructions"
  | "missing_contingency"
  | "non_actionable_guidance"
  | "missing_social_plan"
  | "missing_vote_plan";

export interface OwnerLearningRecommendationProof {
  kind: OwnerLearningProofKind;
  rubricCategory?: OwnerLearningGuidanceRubricCategory;
  observedEvidence: string;
  strategicInterpretation: string;
  proposedGuidance: string;
  exactGuidanceTarget: string;
}

export interface OwnerLearningRecommendation {
  id?: string;
  title: string;
  disposition: OwnerLearningRecommendationDisposition;
  confidence: OwnerLearningConfidence;
  rationale: string;
  keepGuidance?: string;
  evidenceRefs: OwnerLearningEvidenceRef[];
  proof?: OwnerLearningRecommendationProof;
}

export interface OwnerLearningStrategyProposal {
  field: "strategyStyle";
  before: string;
  after: string;
}

export interface OwnerLearningReviewResult {
  diagnosis: string;
  analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  strategyHealthClassification?: "guidance_gap" | "execution_gap" | "no_clear_strategy_defect";
  recommendations: OwnerLearningRecommendation[];
  proposal?: OwnerLearningStrategyProposal;
  noChange?: { rationale: string };
}

export interface OwnerLearningTransportReceiptEntry {
  ordinal: number;
  dispatchIntentAt: string;
  attemptedTier: "flex" | "auto";
  terminalHttpStatus?: number;
  terminalOutcomeAt?: string;
  latencyMs?: number;
  providerRequestId?: string;
  backoffMs?: number;
}

export interface OwnerLearningTokenReceipt {
  inputTokens?: number;
  cachedInputTokens?: number;
  totalOutputTokens?: number;
  reasoningTokens?: number;
}

export interface OwnerLearningCallCostReceipt {
  costSource: OwnerLearningCostSource;
  actualCostMicrousd?: number;
  estimatedCostMicrousd?: number;
  pricingSourceId?: string;
  rateCardVersion?: string;
  pricedAt?: string;
}

export interface OwnerLearningCheckpoint {
  version: 1;
  selectedMomentIds: string[];
  nextMomentCursor: number;
  provisionalThemes: string[];
  validatedFindings: Array<{
    evidenceRefs: OwnerLearningEvidenceRef[];
    observation: string;
    interpretation: string;
  }>;
  lastCompletedStage: OwnerLearningStage;
  promptHash: string;
  schemaHash: string;
}

export interface OwnerLearningReviewDTO {
  id: string;
  agentProfileId: string;
  reviewedRevisionId: string;
  selectedGameIds: string[];
  analysisTrack: OwnerLearningAnalysisTrack;
  analysisStatus: OwnerLearningAnalysisStatus;
  stage: OwnerLearningStage;
  capacitySubstatus: OwnerLearningCapacitySubstatus | null;
  resolution: OwnerLearningResolution | null;
  result: OwnerLearningReviewResult | null;
  proposalFingerprint: string | null;
  safeFailureCode: OwnerLearningSafeFailureCode | null;
  retryable: boolean;
  logicalCallCount: number;
  diveCount: number;
  applyDisposition: OwnerLearningApplyDisposition;
  evidence: {
    games: Array<{
      gameId: string;
      position: number;
      canonicalFacts: unknown;
      candidateMoments: Array<Record<string, unknown>>;
      sourceCaptureVersion: string;
      sourceHash: string;
    }>;
  };
  application: {
    sourceRecommendationIds: string[];
    priorRevisionId: string;
    resultingRevisionId: string;
    priorStrategyStyle: string;
    resultingStrategyStyle: string;
    mutationReceipt: Record<string, unknown>;
    appliedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export function parseOwnerLearningStartIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Owner learning idempotency key must be a string");
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > OWNER_LEARNING_MAX_IDEMPOTENCY_KEY_CHARS) {
    throw new Error(
      `Owner learning idempotency key must contain 1-${OWNER_LEARNING_MAX_IDEMPOTENCY_KEY_CHARS} characters`,
    );
  }
  return normalized;
}

export function parseOwnerLearningGameIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > OWNER_LEARNING_MAX_GAMES) {
    throw new Error("Owner learning review requires one to three game IDs");
  }
  const ids = value.map((entry, index) => boundedString(entry, `gameIds[${index}]`, 200));
  if (new Set(ids).size !== ids.length) {
    throw new Error("Owner learning game IDs must be distinct");
  }
  return ids;
}

export function parseOwnerLearningReviewResult(value: unknown): OwnerLearningReviewResult {
  const input = objectValue(value, "review result");
  const analysisTrack = enumValue(
    input.analysisTrack,
    "analysisTrack",
    ["evidence_rich", "strategy_health_check"] as const,
  );
  if (!Array.isArray(input.recommendations) || input.recommendations.length > OWNER_LEARNING_MAX_RECOMMENDATIONS) {
    throw new Error("recommendations must contain at most three entries");
  }

  const recommendations = input.recommendations.map((entry, index) =>
    parseRecommendation(entry, index, analysisTrack)
  );
  const proposal = input.proposal === undefined
    ? undefined
    : parseProposal(input.proposal);
  const noChange = input.noChange === undefined
    ? undefined
    : { rationale: boundedString(objectValue(input.noChange, "noChange").rationale, "noChange.rationale", 1_200) };
  if ((proposal == null) === (noChange == null)) {
    throw new Error("review result must contain exactly one proposal or noChange outcome");
  }

  const strategyHealthClassification = input.strategyHealthClassification === undefined
    ? undefined
    : enumValue(
      input.strategyHealthClassification,
      "strategyHealthClassification",
      ["guidance_gap", "execution_gap", "no_clear_strategy_defect"] as const,
    );
  if (analysisTrack === "strategy_health_check" && strategyHealthClassification === undefined) {
    // A change-ready proof can establish the classification implicitly while
    // the provider schema migrates; final harness validation supplies it.
    if (recommendations.length === 0) {
      throw new Error("strategyHealthClassification is required for Strategy Health Check");
    }
  }

  return {
    diagnosis: boundedString(input.diagnosis, "diagnosis", 1_200),
    analysisTrack,
    strategyHealthClassification,
    recommendations,
    proposal,
    noChange,
  };
}

export function fingerprintOwnerLearningValue(value: unknown): string {
  return sha256StableJson(value);
}

export function fingerprintOwnerLearningRequest(
  request: Record<string, unknown>,
): string {
  const semanticRequest = { ...request };
  delete semanticRequest.serviceTier;
  delete semanticRequest.service_tier;
  delete semanticRequest.transportHeaders;
  delete semanticRequest.transport_headers;
  return sha256StableJson(semanticRequest);
}

export function deriveOwnerLearningApplyDisposition(input: {
  analysisStatus: OwnerLearningAnalysisStatus;
  resolution: OwnerLearningResolution | null;
  hasProposal: boolean;
  hasApplication: boolean;
  reviewedRevisionIsCurrent: boolean;
}): OwnerLearningApplyDisposition {
  if (input.hasApplication || input.resolution === "applied") return "applied";
  if (input.resolution != null) return input.resolution;
  if (input.analysisStatus === "failed") return "failed";
  if (input.analysisStatus === "no_change") return "no_change";
  if (input.analysisStatus !== "ready") return "not_ready";
  if (!input.hasProposal) return "unavailable";
  if (!input.reviewedRevisionIsCurrent) return "unavailable";
  return "available";
}

function parseRecommendation(
  value: unknown,
  index: number,
  analysisTrack: OwnerLearningReviewResult["analysisTrack"],
): OwnerLearningRecommendation {
  const input = objectValue(value, `recommendations[${index}]`);
  const evidenceRefs = parseEvidenceRefs(input.evidenceRefs, `recommendations[${index}].evidenceRefs`);
  const proof = input.proof === undefined ? undefined : parseProof(input.proof, index, evidenceRefs);
  if (analysisTrack === "strategy_health_check" && proof === undefined) {
    throw new Error(`recommendations[${index}].proof is required for Strategy Health Check`);
  }
  return {
    id: input.id === undefined ? undefined : boundedString(input.id, `recommendations[${index}].id`, 200),
    title: boundedString(input.title, `recommendations[${index}].title`, 160),
    disposition: enumValue(
      input.disposition,
      `recommendations[${index}].disposition`,
      ["change", "keep", "gather_more_evidence"] as const,
    ),
    confidence: enumValue(
      input.confidence,
      `recommendations[${index}].confidence`,
      ["low", "medium", "high"] as const,
    ),
    rationale: boundedString(input.rationale, `recommendations[${index}].rationale`, 1_200),
    keepGuidance: input.keepGuidance === undefined
      ? undefined
      : boundedString(input.keepGuidance, `recommendations[${index}].keepGuidance`, 800),
    evidenceRefs,
    proof,
  };
}

function parseProof(
  value: unknown,
  index: number,
  evidenceRefs: OwnerLearningEvidenceRef[],
): OwnerLearningRecommendationProof {
  const input = objectValue(value, `recommendations[${index}].proof`);
  const kind = enumValue(
    input.kind,
    `recommendations[${index}].proof.kind`,
    ["observed_pattern", "prompt_guidance_defect", "combined"] as const,
  );
  const rubricCategory = input.rubricCategory === undefined
    ? undefined
    : enumValue(
      input.rubricCategory,
      `recommendations[${index}].proof.rubricCategory`,
      [
        "ambiguous_priority",
        "conflicting_instructions",
        "missing_contingency",
        "non_actionable_guidance",
        "missing_social_plan",
        "missing_vote_plan",
      ] as const,
    );
  if ((kind === "prompt_guidance_defect" || kind === "combined") && rubricCategory === undefined) {
    throw new Error(`recommendations[${index}].proof.rubricCategory is required`);
  }
  if (kind === "observed_pattern" || kind === "combined") {
    const gameCount = new Set(evidenceRefs.map((ref) => ref.gameId)).size;
    if (gameCount < 2) {
      throw new Error(`recommendations[${index}].proof observed pattern requires two games`);
    }
  }
  return {
    kind,
    rubricCategory,
    observedEvidence: boundedString(input.observedEvidence, "observedEvidence", 800),
    strategicInterpretation: boundedString(input.strategicInterpretation, "strategicInterpretation", 800),
    proposedGuidance: boundedString(input.proposedGuidance, "proposedGuidance", 800),
    exactGuidanceTarget: boundedString(input.exactGuidanceTarget, "exactGuidanceTarget", 400),
  };
}

function parseEvidenceRefs(value: unknown, label: string): OwnerLearningEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error(`${label} must contain 1-24 typed references`);
  }
  return value.map((entry, index) => {
    const input = objectValue(entry, `${label}[${index}]`);
    return {
      kind: enumValue(
        input.kind,
        `${label}[${index}].kind`,
        ["canonical_event", "decision", "dialogue", "cognition", "game_summary"] as const,
      ),
      gameId: boundedString(input.gameId, `${label}[${index}].gameId`, 200),
      coordinate: boundedString(input.coordinate, `${label}[${index}].coordinate`, 500),
      sourceHash: boundedString(input.sourceHash, `${label}[${index}].sourceHash`, 200),
      sourceVersion: boundedString(input.sourceVersion, `${label}[${index}].sourceVersion`, 100),
    };
  });
}

function parseProposal(value: unknown): OwnerLearningStrategyProposal {
  const input = objectValue(value, "proposal");
  if (input.field !== "strategyStyle") {
    throw new Error("owner learning proposal may target only strategyStyle");
  }
  const before = boundedString(input.before, "proposal.before", 2_000, true);
  const after = boundedString(input.after, "proposal.after", 2_000, true);
  if (before.trim() === after.trim()) {
    throw new Error("owner learning proposal must change strategyStyle");
  }
  return { field: "strategyStyle", before, after };
}

function boundedString(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if ((!allowEmpty && value.trim().length === 0) || value.length > max) {
    throw new Error(`${label} must contain ${allowEmpty ? "0" : "1"}-${max} characters`);
  }
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}
