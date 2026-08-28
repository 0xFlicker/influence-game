/** Local before/after provider samples for R32. Generated prose stays private. */

import { createHash } from "node:crypto";
import type { JsonValue } from "@influence/prompt-lab-protocol";

export type ProviderScenarioStage = "before" | "after";
export type ProviderScenarioSurface =
  | "house_diary"
  | "house_summary"
  | "judgment_question_answer";

export interface FrozenProviderScenarioPackInput {
  version: 1;
  scenarioId: string;
  comparisonKey: string;
  surface: ProviderScenarioSurface;
  semanticInput: JsonValue;
}

export type FrozenProviderScenarioPack = Readonly<FrozenProviderScenarioPackInput>;

export interface ProviderScenarioRunConfig {
  providerProfileId: string;
  catalogId: string;
  modelId: string;
  serviceTier: string;
  reasoningPolicy: string;
  toolChoiceMode: string;
  reasoningSummary: string;
  sampleCount: 1 | 3;
}

export interface ProviderScenarioRunConfigInput extends Omit<ProviderScenarioRunConfig, "sampleCount"> {
  sampleCount: number;
}

export interface ProviderScenarioSampleOutcome {
  status: "accepted" | "exhausted" | "failed";
  acceptedStructuredTurns: number;
  exhaustedStructuredTurns: number;
  fallbackTurns: number;
}

export interface ProviderScenarioSampleAccounting {
  attempts: number;
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  actualCostMicrousd: number | null;
  estimatedCostMicrousd: number | null;
  costStatus: "actual" | "estimated" | "unavailable";
  pricingSourceId: string | null;
  accountingComplete: boolean;
}

export interface ProviderScenarioTurnTelemetry {
  label: string;
  authority: "presentation_only" | "structured";
  status: "accepted" | "exhausted" | "fallback" | "failed" | "skipped";
}

export interface ProviderScenarioPrivateSample {
  scenarioId: string;
  comparisonKey: string;
  sampleOrdinal: number;
  cacheIsolationNonce: string;
  outcome: ProviderScenarioSampleOutcome;
  accounting: ProviderScenarioSampleAccounting;
  requestIds: string[];
  responseIds: string[];
  attemptDispositions: string[];
  turns: ProviderScenarioTurnTelemetry[];
  private: {
    semanticInput: JsonValue;
    traces: unknown[];
    attempts: unknown[];
    presentation: unknown;
  };
}

export interface ProviderScenarioPrivateRun {
  version: 1;
  stage: ProviderScenarioStage;
  runId: string;
  createdAt: string;
  harnessRevision: string;
  targetRevision: string;
  targetFileHashes: Record<string, string>;
  config: ProviderScenarioRunConfig;
  packs: FrozenProviderScenarioPack[];
  samples: ProviderScenarioPrivateSample[];
}

export interface ProviderScenarioPublicSample {
  scenarioId: string;
  comparisonKey: string;
  sampleOrdinal: number;
  outcome: ProviderScenarioSampleOutcome;
  accounting: ProviderScenarioSampleAccounting;
  requestIds: string[];
  responseIds: string[];
  attemptDispositions: string[];
  turns: ProviderScenarioTurnTelemetry[];
}

export interface ProviderScenarioManifest {
  version: 1;
  stage: ProviderScenarioStage;
  runId: string;
  createdAt: string;
  harnessRevision: string;
  targetRevision: string;
  targetFileHashes: Record<string, string>;
  config: ProviderScenarioRunConfig;
  packs: Array<Pick<
    FrozenProviderScenarioPack,
    "scenarioId" | "comparisonKey" | "surface"
  >>;
  samples: ProviderScenarioPublicSample[];
}

function requireNonEmpty(label: string, value: string): void {
  if (!value.trim()) throw new Error(`Provider scenario ${label} must be non-empty.`);
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function freezeProviderScenarioPack(
  input: FrozenProviderScenarioPackInput,
): FrozenProviderScenarioPack {
  requireNonEmpty("scenarioId", input.scenarioId);
  requireNonEmpty("comparisonKey", input.comparisonKey);
  const semanticInput = deepFreezeJson(structuredClone(input.semanticInput));
  const identity = {
    version: input.version,
    scenarioId: input.scenarioId,
    comparisonKey: input.comparisonKey,
    surface: input.surface,
    semanticInput,
  } satisfies FrozenProviderScenarioPackInput;
  return Object.freeze(identity);
}

export function assertProviderScenarioRunConfig(
  config: ProviderScenarioRunConfigInput,
  packs: readonly FrozenProviderScenarioPack[],
): ProviderScenarioRunConfig {
  for (const key of [
    "providerProfileId",
    "catalogId",
    "modelId",
    "serviceTier",
    "reasoningPolicy",
    "toolChoiceMode",
    "reasoningSummary",
  ] as const) {
    requireNonEmpty(`config.${key}`, config[key]);
  }
  if (config.sampleCount !== 1 && config.sampleCount !== 3) {
    throw new Error("Provider scenario config.sampleCount must be 1 (smoke) or 3 (comparison).");
  }
  if (packs.length === 0) throw new Error("At least one frozen provider scenario pack is required.");
  const scenarioIds = new Set<string>();
  const comparisonKeys = new Set<string>();
  for (const pack of packs) {
    if (scenarioIds.has(pack.scenarioId)) throw new Error(`Duplicate scenarioId: ${pack.scenarioId}`);
    if (comparisonKeys.has(pack.comparisonKey)) {
      throw new Error(`Duplicate comparisonKey: ${pack.comparisonKey}`);
    }
    scenarioIds.add(pack.scenarioId);
    comparisonKeys.add(pack.comparisonKey);
  }
  return { ...config, sampleCount: config.sampleCount };
}

/** Build the only shareable view by copying an explicit field whitelist. */
export function createProviderScenarioManifest(
  run: ProviderScenarioPrivateRun,
): ProviderScenarioManifest {
  assertProviderScenarioRunConfig(run.config, run.packs);
  return {
    version: 1,
    stage: run.stage,
    runId: run.runId,
    createdAt: run.createdAt,
    harnessRevision: run.harnessRevision,
    targetRevision: run.targetRevision,
    targetFileHashes: { ...run.targetFileHashes },
    config: { ...run.config },
    packs: run.packs.map((pack) => ({
      scenarioId: pack.scenarioId,
      comparisonKey: pack.comparisonKey,
      surface: pack.surface,
    })),
    samples: run.samples.map((sample) => ({
      scenarioId: sample.scenarioId,
      comparisonKey: sample.comparisonKey,
      sampleOrdinal: sample.sampleOrdinal,
      outcome: { ...sample.outcome },
      accounting: { ...sample.accounting },
      requestIds: [...sample.requestIds],
      responseIds: [...sample.responseIds],
      attemptDispositions: [...sample.attemptDispositions],
      turns: sample.turns.map((turn) => ({ ...turn })),
    })),
  };
}

const COMPARABLE_CONFIG_KEYS = [
  "providerProfileId",
  "catalogId",
  "modelId",
  "serviceTier",
  "reasoningPolicy",
  "toolChoiceMode",
  "reasoningSummary",
  "sampleCount",
] as const satisfies ReadonlyArray<keyof ProviderScenarioRunConfig>;

export interface ProviderScenarioRunComparison {
  comparable: boolean;
  differences: string[];
}

export interface ProviderScenarioOperationsSummary {
  samples: number;
  acceptedSamples: number;
  exhaustedSamples: number;
  failedSamples: number;
  firstAttemptAcceptedSamples: number;
  retryScheduledAttempts: number;
  fallbackTurns: number;
  attempts: number;
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  knownEstimatedCostMicrousd: number;
  unavailableCostSamples: number;
}

export interface ProviderScenarioPairedSample {
  scenarioId: string;
  comparisonKey: string;
  sampleOrdinal: number;
  before: Omit<ProviderScenarioPublicSample, "scenarioId" | "comparisonKey" | "sampleOrdinal">;
  after: Omit<ProviderScenarioPublicSample, "scenarioId" | "comparisonKey" | "sampleOrdinal">;
}

export interface ProviderScenarioPairedReport {
  version: 1;
  comparable: true;
  beforeRunId: string;
  afterRunId: string;
  config: ProviderScenarioRunConfig;
  packs: ProviderScenarioManifest["packs"];
  operations: {
    before: ProviderScenarioOperationsSummary;
    after: ProviderScenarioOperationsSummary;
  };
  samples: ProviderScenarioPairedSample[];
  presentationReview:
    | {
        status: "pending_blind_review";
        note: string;
      }
    | ProviderScenarioBlindReviewSummary;
}

export type ProviderScenarioBlindSlot = "A" | "B";
export type ProviderScenarioBlindPreference = ProviderScenarioBlindSlot | "tie";
export type ProviderScenarioBlindScore = 1 | 2 | 3 | 4 | 5;

export interface ProviderScenarioBlindReviewPair {
  reviewPairId: string;
  surface: ProviderScenarioSurface;
  semanticInput: JsonValue;
  samples: [
    { slot: "A"; presentation: unknown },
    { slot: "B"; presentation: unknown },
  ];
}

export interface ProviderScenarioBlindReviewBundle {
  version: 1;
  reviewBatchId: string;
  pairs: ProviderScenarioBlindReviewPair[];
}

export interface ProviderScenarioBlindReviewKeyEntry {
  reviewPairId: string;
  scenarioId: string;
  comparisonKey: string;
  sampleOrdinal: number;
  stageBySlot: Record<ProviderScenarioBlindSlot, ProviderScenarioStage>;
}

export interface ProviderScenarioBlindReviewKey {
  version: 1;
  reviewBatchId: string;
  beforeRunId: string;
  afterRunId: string;
  entries: ProviderScenarioBlindReviewKeyEntry[];
}

export interface ProviderScenarioBlindReviewScorecard {
  reviewPairId: string;
  preference: ProviderScenarioBlindPreference;
  scores: Record<ProviderScenarioBlindSlot, Record<string, ProviderScenarioBlindScore>>;
  note: string;
}

export interface ProviderScenarioBlindReviewScores {
  version: 1;
  reviewBatchId: string;
  scorecards: ProviderScenarioBlindReviewScorecard[];
}

export interface ProviderScenarioBlindReviewSummary {
  status: "completed_blind_review";
  reviewBatchId: string;
  beforeRunId: string;
  afterRunId: string;
  reviewerLabel: string;
  reviewedAt: string;
  pairsReviewed: number;
  preferences: { before: number; after: number; tie: number };
  criterionMeans: Record<ProviderScenarioStage, Record<string, number>>;
}

export interface ProviderScenarioBlindReviewResult {
  summary: ProviderScenarioBlindReviewSummary;
  rows: Array<{
    reviewPairId: string;
    scenarioId: string;
    sampleOrdinal: number;
    preference: ProviderScenarioStage | "tie";
    scores: Record<ProviderScenarioStage, Record<string, ProviderScenarioBlindScore>>;
    note: string;
  }>;
}

export interface ProviderScenarioBlindReviewArtifacts {
  bundle: ProviderScenarioBlindReviewBundle;
  key: ProviderScenarioBlindReviewKey;
}

const BLIND_REVIEW_CRITERIA = {
  house_diary: ["question_specificity", "follow_up_relevance"],
  house_summary: ["legibility", "arc_continuity"],
  judgment_question_answer: [
    "question_specificity",
    "question_novelty",
    "answer_responsiveness",
  ],
} as const satisfies Record<ProviderScenarioSurface, readonly string[]>;

/** Checks run configuration and named scenario coverage before pairing samples. */
export function compareProviderScenarioRuns(
  before: ProviderScenarioManifest,
  after: ProviderScenarioManifest,
): ProviderScenarioRunComparison {
  const differences: string[] = [];
  for (const key of COMPARABLE_CONFIG_KEYS) {
    if (before.config[key] !== after.config[key]) differences.push(`config.${key}`);
  }
  const packIdentity = (manifest: ProviderScenarioManifest) => manifest.packs
    .map(({ scenarioId, comparisonKey, surface }) => ({
      scenarioId,
      comparisonKey,
      surface,
    }))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  if (JSON.stringify(packIdentity(before)) !== JSON.stringify(packIdentity(after))) {
    differences.push("scenarioPacks");
  }
  return { comparable: differences.length === 0, differences };
}

function operationsSummary(
  samples: readonly ProviderScenarioPublicSample[],
): ProviderScenarioOperationsSummary {
  const sum = (select: (sample: ProviderScenarioPublicSample) => number): number =>
    samples.reduce((total, sample) => total + select(sample), 0);
  return {
    samples: samples.length,
    acceptedSamples: samples.filter((sample) => sample.outcome.status === "accepted").length,
    exhaustedSamples: samples.filter((sample) => sample.outcome.status === "exhausted").length,
    failedSamples: samples.filter((sample) => sample.outcome.status === "failed").length,
    firstAttemptAcceptedSamples: samples.filter((sample) =>
      sample.attemptDispositions[0] === "accepted",
    ).length,
    retryScheduledAttempts: sum((sample) =>
      sample.attemptDispositions.filter((disposition) => disposition === "retry_scheduled").length,
    ),
    fallbackTurns: sum((sample) => sample.outcome.fallbackTurns),
    attempts: sum((sample) => sample.accounting.attempts),
    latencyMs: sum((sample) => sample.accounting.latencyMs),
    promptTokens: sum((sample) => sample.accounting.promptTokens),
    cachedTokens: sum((sample) => sample.accounting.cachedTokens),
    cacheWriteTokens: sum((sample) => sample.accounting.cacheWriteTokens),
    completionTokens: sum((sample) => sample.accounting.completionTokens),
    reasoningTokens: sum((sample) => sample.accounting.reasoningTokens),
    totalTokens: sum((sample) => sample.accounting.totalTokens),
    knownEstimatedCostMicrousd: sum((sample) => sample.accounting.estimatedCostMicrousd ?? 0),
    unavailableCostSamples: samples.filter((sample) => sample.accounting.costStatus === "unavailable").length,
  };
}

function pairedSampleKey(sample: ProviderScenarioPublicSample): string {
  return `${sample.comparisonKey}::${sample.sampleOrdinal}`;
}

function pairedSampleSide(
  sample: ProviderScenarioPublicSample,
): ProviderScenarioPairedSample["before"] {
  return {
    outcome: { ...sample.outcome },
    accounting: { ...sample.accounting },
    requestIds: [...sample.requestIds],
    responseIds: [...sample.responseIds],
    attemptDispositions: [...sample.attemptDispositions],
    turns: sample.turns.map((turn) => ({ ...turn })),
  };
}

/**
 * Builds a prose-free structural/operations pair. Presentation samples remain
 * in the producer-private runs for a separately shuffled blind review.
 */
export function createProviderScenarioPairedReport(
  before: ProviderScenarioManifest,
  after: ProviderScenarioManifest,
): ProviderScenarioPairedReport {
  if (before.stage !== "before" || after.stage !== "after") {
    throw new Error("Provider scenario paired report requires before then after manifests.");
  }
  const comparison = compareProviderScenarioRuns(before, after);
  if (!comparison.comparable) {
    throw new Error(`Provider scenario runs are incomparable: ${comparison.differences.join(", ")}`);
  }
  const beforeByKey = new Map(before.samples.map((sample) => [pairedSampleKey(sample), sample]));
  const afterByKey = new Map(after.samples.map((sample) => [pairedSampleKey(sample), sample]));
  if (beforeByKey.size !== before.samples.length || afterByKey.size !== after.samples.length) {
    throw new Error("Provider scenario manifests contain duplicate sample coordinates.");
  }
  if (beforeByKey.size !== afterByKey.size) {
    throw new Error("Provider scenario manifests contain different sample coordinates.");
  }
  const samples = [...beforeByKey.entries()]
    .map(([key, beforeSample]) => {
      const afterSample = afterByKey.get(key);
      if (!afterSample) {
        throw new Error(`Provider scenario sample coordinate is missing or drifted: ${key}`);
      }
      return {
        scenarioId: beforeSample.scenarioId,
        comparisonKey: beforeSample.comparisonKey,
        sampleOrdinal: beforeSample.sampleOrdinal,
        before: pairedSampleSide(beforeSample),
        after: pairedSampleSide(afterSample),
      } satisfies ProviderScenarioPairedSample;
    })
    .sort((left, right) =>
      left.scenarioId.localeCompare(right.scenarioId)
      || left.sampleOrdinal - right.sampleOrdinal,
    );
  return {
    version: 1,
    comparable: true,
    beforeRunId: before.runId,
    afterRunId: after.runId,
    config: { ...before.config },
    packs: before.packs.map((pack) => ({ ...pack })),
    operations: {
      before: operationsSummary(before.samples),
      after: operationsSummary(after.samples),
    },
    samples,
    presentationReview: {
      status: "pending_blind_review",
      note: "Generated prose and deterministic viewer copy are reviewed only from a shuffled producer-private bundle; this report never parses them into facts.",
    },
  };
}

function privateSampleKey(sample: ProviderScenarioPrivateSample): string {
  return `${sample.comparisonKey}::${sample.sampleOrdinal}`;
}

function blindDigest(seed: string, coordinate: string): string {
  return createHash("sha256").update(JSON.stringify({ seed, coordinate })).digest("hex");
}

/**
 * Creates a reviewer-visible bundle with no revision labels and a separate
 * producer-private join key. Presentation text stays evidence for quality only.
 */
export function createProviderScenarioBlindReviewArtifacts(
  before: ProviderScenarioPrivateRun,
  after: ProviderScenarioPrivateRun,
  seed: string,
): ProviderScenarioBlindReviewArtifacts {
  requireNonEmpty("blind review seed", seed);
  if (before.stage !== "before" || after.stage !== "after") {
    throw new Error("Provider scenario blind review requires before then after private runs.");
  }
  const comparison = compareProviderScenarioRuns(
    createProviderScenarioManifest(before),
    createProviderScenarioManifest(after),
  );
  if (!comparison.comparable) {
    throw new Error(`Provider scenario runs are incomparable: ${comparison.differences.join(", ")}`);
  }
  const beforeByKey = new Map(before.samples.map((sample) => [privateSampleKey(sample), sample]));
  const afterByKey = new Map(after.samples.map((sample) => [privateSampleKey(sample), sample]));
  if (
    beforeByKey.size !== before.samples.length
    || afterByKey.size !== after.samples.length
    || beforeByKey.size !== afterByKey.size
  ) {
    throw new Error("Provider scenario private runs contain duplicate or different sample coordinates.");
  }
  const packsByScenario = new Map(before.packs.map((pack) => [pack.scenarioId, pack]));
  const rows = [...beforeByKey.entries()].map(([coordinate, beforeSample]) => {
    const afterSample = afterByKey.get(coordinate);
    const pack = packsByScenario.get(beforeSample.scenarioId);
    if (!afterSample || !pack) {
      throw new Error(`Provider scenario blind sample is missing or drifted: ${coordinate}`);
    }
    const reviewPairId = blindDigest(seed, `pair:${coordinate}`).slice(0, 26);
    const beforeFirst = blindDigest(seed, `slot:${coordinate}`).at(-1)!.charCodeAt(0) % 2 === 0;
    const stageBySlot: ProviderScenarioBlindReviewKeyEntry["stageBySlot"] = beforeFirst
      ? { A: "before", B: "after" }
      : { A: "after", B: "before" };
    const presentationByStage = {
      before: structuredClone(beforeSample.private.presentation),
      after: structuredClone(afterSample.private.presentation),
    };
    return {
      order: blindDigest(seed, `order:${coordinate}`),
      pair: {
        reviewPairId,
        surface: pack.surface,
        semanticInput: structuredClone(pack.semanticInput),
        samples: [
          { slot: "A" as const, presentation: presentationByStage[stageBySlot.A] },
          { slot: "B" as const, presentation: presentationByStage[stageBySlot.B] },
        ] satisfies ProviderScenarioBlindReviewPair["samples"],
      },
      key: {
        reviewPairId,
        scenarioId: beforeSample.scenarioId,
        comparisonKey: beforeSample.comparisonKey,
        sampleOrdinal: beforeSample.sampleOrdinal,
        stageBySlot,
      },
    };
  }).sort((left, right) => left.order.localeCompare(right.order));
  const reviewBatchId = blindDigest(
    seed,
    `batch:${before.runId}:${after.runId}`,
  ).slice(0, 26);
  return {
    bundle: {
      version: 1,
      reviewBatchId,
      pairs: rows.map((row) => row.pair),
    },
    key: {
      version: 1,
      reviewBatchId,
      beforeRunId: before.runId,
      afterRunId: after.runId,
      entries: rows.map((row) => row.key),
    },
  };
}

function scorecardFor(
  scoreByPairId: ReadonlyMap<string, ProviderScenarioBlindReviewScorecard>,
  pair: ProviderScenarioBlindReviewPair,
): ProviderScenarioBlindReviewScorecard {
  const scorecard = scoreByPairId.get(pair.reviewPairId);
  if (!scorecard) throw new Error(`Missing blind review scorecard for ${pair.reviewPairId}.`);
  const expectedCriteria = BLIND_REVIEW_CRITERIA[pair.surface];
  for (const slot of ["A", "B"] as const) {
    const scoreKeys = Object.keys(scorecard.scores[slot] ?? {}).sort();
    if (JSON.stringify(scoreKeys) !== JSON.stringify([...expectedCriteria].sort())) {
      throw new Error(`Blind review scorecard ${pair.reviewPairId} has wrong criteria for ${pair.surface}.`);
    }
    for (const score of Object.values(scorecard.scores[slot])) {
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new Error(`Blind review scorecard ${pair.reviewPairId} has a score outside 1-5.`);
      }
    }
  }
  if (
    scorecard.preference !== "A"
    && scorecard.preference !== "B"
    && scorecard.preference !== "tie"
  ) {
    throw new Error(`Blind review scorecard ${pair.reviewPairId} has an invalid preference.`);
  }
  return scorecard;
}

/** Join a complete blinded score set through the separate private key. */
export function completeProviderScenarioBlindReview(
  bundle: ProviderScenarioBlindReviewBundle,
  key: ProviderScenarioBlindReviewKey,
  scores: ProviderScenarioBlindReviewScores,
  reviewerLabel: string,
  reviewedAt: string,
): ProviderScenarioBlindReviewResult {
  requireNonEmpty("blind reviewer label", reviewerLabel);
  requireNonEmpty("blind reviewedAt", reviewedAt);
  if (
    bundle.reviewBatchId !== key.reviewBatchId
    || bundle.reviewBatchId !== scores.reviewBatchId
  ) {
    throw new Error("Blind review bundle, key, and scores do not share one review batch.");
  }
  const keyByPairId = new Map(key.entries.map((entry) => [entry.reviewPairId, entry]));
  const scoreByPairId = new Map(scores.scorecards.map((score) => [score.reviewPairId, score]));
  if (
    keyByPairId.size !== key.entries.length
    || scoreByPairId.size !== scores.scorecards.length
    || bundle.pairs.length !== key.entries.length
    || bundle.pairs.length !== scores.scorecards.length
  ) {
    throw new Error("Blind review bundle, key, or scores contain duplicate or incomplete pair coverage.");
  }
  const criterionTotals: Record<ProviderScenarioStage, Record<string, { total: number; count: number }>> = {
    before: {},
    after: {},
  };
  const preferences = { before: 0, after: 0, tie: 0 };
  const rows = bundle.pairs.map((pair) => {
    const keyEntry = keyByPairId.get(pair.reviewPairId);
    if (!keyEntry) throw new Error(`Missing blind review key for ${pair.reviewPairId}.`);
    const scorecard = scorecardFor(scoreByPairId, pair);
    const scoresByStage = { before: {}, after: {} } as Record<
      ProviderScenarioStage,
      Record<string, ProviderScenarioBlindScore>
    >;
    for (const slot of ["A", "B"] as const) {
      const stage = keyEntry.stageBySlot[slot];
      scoresByStage[stage] = { ...scorecard.scores[slot] };
      for (const [criterion, score] of Object.entries(scorecard.scores[slot])) {
        const total = criterionTotals[stage][criterion] ?? { total: 0, count: 0 };
        total.total += score;
        total.count += 1;
        criterionTotals[stage][criterion] = total;
      }
    }
    const preference: ProviderScenarioStage | "tie" = scorecard.preference === "tie"
      ? "tie"
      : keyEntry.stageBySlot[scorecard.preference];
    preferences[preference] += 1;
    return {
      reviewPairId: pair.reviewPairId,
      scenarioId: keyEntry.scenarioId,
      sampleOrdinal: keyEntry.sampleOrdinal,
      preference,
      scores: scoresByStage,
      note: scorecard.note,
    };
  });
  const criterionMeans = Object.fromEntries(
    (["before", "after"] as const).map((stage) => [
      stage,
      Object.fromEntries(Object.entries(criterionTotals[stage]).map(
        ([criterion, total]) => [criterion, Number((total.total / total.count).toFixed(2))],
      )),
    ]),
  ) as ProviderScenarioBlindReviewSummary["criterionMeans"];
  return {
    summary: {
      status: "completed_blind_review",
      reviewBatchId: bundle.reviewBatchId,
      beforeRunId: key.beforeRunId,
      afterRunId: key.afterRunId,
      reviewerLabel,
      reviewedAt,
      pairsReviewed: rows.length,
      preferences,
      criterionMeans,
    },
    rows,
  };
}

export function attachProviderScenarioBlindReview(
  report: ProviderScenarioPairedReport,
  review: ProviderScenarioBlindReviewResult,
): ProviderScenarioPairedReport {
  if (
    review.summary.beforeRunId !== report.beforeRunId
    || review.summary.afterRunId !== report.afterRunId
    || review.summary.pairsReviewed !== report.samples.length
  ) {
    throw new Error("Blind presentation review does not cover the paired provider report.");
  }
  return {
    ...structuredClone(report),
    presentationReview: structuredClone(review.summary),
  };
}
