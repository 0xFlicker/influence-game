import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  parseArtifact,
  type FinalReportArtifact,
  type JsonObject,
} from "@influence/prompt-lab-protocol";

export type PromptThreadReportArm = "baseline" | "candidate" | "control";
export type PromptThreadEvidenceLabel =
  | "required"
  | "useful"
  | "known_distractor"
  | "unscored";
export type PromptThreadSelectionReason =
  | "selected"
  | "policy_disabled"
  | "zero_overlap"
  | "ranked_out"
  | "budget_exhausted";

export interface PromptThreadReportCell {
  cellId: string;
  attemptOrdinal: number;
  arm: PromptThreadReportArm;
  repetition: number;
  turn: number;
  actorId: string;
  firstCall: boolean;
  controlReturnTurn: boolean;
  responseStatus: "completed";
  requestHash: string;
  commonPrefixChars: number;
  responseId: string | null;
  requestId: string | null;
  elapsedMs: number;
  requestedServiceTier: string;
  effectiveServiceTier: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costStatus: "actual" | "estimated" | "unavailable";
  selection: {
    protectedCount: number;
    hotCount: number;
    authorizedHistoryCount: number;
    selectedHistoryCount: number;
    envelopeChars: number;
    historyBudgetChars: number;
    protectedChars: number;
    hotChars: number;
    historyChars: number;
  };
  evidence: Array<{
    sourceId: string;
    label: PromptThreadEvidenceLabel;
    reason: PromptThreadSelectionReason;
  }>;
}

export interface PromptThreadRevealedDecision {
  pairToken: string;
  choice: "A" | "B" | "no_preference" | "insufficient_evidence";
  preferredArm: "baseline" | "candidate" | null;
  reasons?: {
    strategy?: string;
    coherence?: string;
    evidenceUse?: string;
    watchability?: string;
  };
}

export interface PromptThreadReportInput {
  runManifestHash: string;
  blindDecisionsHash: string;
  caseHash: string;
  evidenceCardHash: string;
  verdictScope: "full" | "cache_quality_only";
  expectedCalls: 28;
  cells: PromptThreadReportCell[];
  blindDecisions: PromptThreadRevealedDecision[];
  rateCardVersion: string;
  pricingSourceId: string;
  now?: Date;
}

export interface PromptThreadReportVerdicts {
  replayComparability: {
    status: "pass";
    expectedCalls: 28;
    completedCalls: 28;
    caseHash: string;
  };
  historySelection: {
    status: "improved" | "regressed" | "mixed" | "not_exercised" | "inconclusive";
    baseline: PromptThreadEvidenceTotals;
    candidate: PromptThreadEvidenceTotals;
    turns: PromptThreadHistoryTurnLedger[];
  };
  cacheAndCost: {
    status: "improved" | "regressed" | "mixed" | "inconclusive";
    costEvidenceStatus: "actual" | "estimated" | "unavailable" | "mixed";
    normalReturnCallsWithReuse: number;
    normalReturnCallCount: number;
    controlReductionObserved: boolean;
    baselineCostUsd: number;
    candidateCostUsd: number;
    rateCardVersion: string;
    pricingSourceId: string;
    attempts: PromptThreadAttemptLedger[];
  };
  blindPreference: {
    status: "candidate" | "production" | "mixed" | "no_preference" | "insufficient_evidence";
    candidate: number;
    production: number;
    noPreference: number;
    insufficientEvidence: number;
    decisions: PromptThreadRevealedDecision[];
  };
  limitations: {
    caseCount: 1;
    pairedRepetitions: 3;
    universalPromotionClaim: false;
  };
}

export interface PromptThreadEvidenceTotals {
  requiredSelected: number;
  requiredAvailable: number;
  usefulSelected: number;
  usefulAvailable: number;
  distractorSelected: number;
}

export interface PromptThreadScoredEvidence {
  label: PromptThreadEvidenceLabel;
  reason: PromptThreadSelectionReason;
}

interface PromptThreadHistoryTurnLedger {
  cellId: string;
  arm: "baseline" | "candidate";
  repetition: number;
  turn: number;
  actorId: string;
  variantLocalInput: boolean;
  lanes: {
    protected: number;
    hot: number;
    historyAuthorized: number;
    historySelected: number;
  };
  contextBudget: {
    envelopeChars: number;
    historyBudgetChars: number;
    protectedChars: number;
    hotChars: number;
    historyChars: number;
  };
  evidence: PromptThreadReportCell["evidence"];
}

interface PromptThreadAttemptLedger {
  cellId: string;
  attemptOrdinal: number;
  arm: PromptThreadReportArm;
  repetition: number;
  turn: number;
  actorId: string;
  firstCall: boolean;
  controlReturnTurn: boolean;
  requestHash: string;
  commonPrefixChars: number;
  responseId: string | null;
  requestId: string | null;
  elapsedMs: number;
  requestedServiceTier: string;
  effectiveServiceTier: string;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costStatus: PromptThreadReportCell["costStatus"];
}

export function buildPromptThreadFinalReport(
  input: PromptThreadReportInput,
): FinalReportArtifact {
  assertCompletePanel(input);
  const verdicts: PromptThreadReportVerdicts = {
    replayComparability: {
      status: "pass",
      expectedCalls: 28,
      completedCalls: 28,
      caseHash: input.caseHash,
    },
    historySelection: historyVerdict(input),
    cacheAndCost: cacheAndCostVerdict(input),
    blindPreference: blindPreferenceVerdict(input.blindDecisions),
    limitations: {
      caseCount: 1,
      pairedRepetitions: 3,
      universalPromotionClaim: false,
    },
  };
  const artifact: FinalReportArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "final_report",
    createdAt: (input.now ?? new Date()).toISOString(),
    runManifestHash: input.runManifestHash,
    blindDecisionsHash: input.blindDecisionsHash,
    verdicts: JSON.parse(JSON.stringify(verdicts)) as JsonObject,
  };
  parseArtifact(artifact);
  return artifact;
}

export function renderPromptThreadReportMarkdown(
  report: FinalReportArtifact,
): string {
  const verdicts = report.verdicts as unknown as PromptThreadReportVerdicts;
  return [
    "# Real-thread context evaluation",
    "",
    `- Replay comparability: **${verdicts.replayComparability.status}**`,
    `- History selection: **${verdicts.historySelection.status}**`,
    `- Cache and cost: **${verdicts.cacheAndCost.status}**`,
    `- Blind preference: **${verdicts.blindPreference.status}**`,
    "",
    "## Per-turn evidence",
    "",
    "| Arm | Rep | Turn | Actor | Local input | Lanes P/H/selected/authorized | History chars / budget | Approved evidence |",
    "|---|---:|---:|---|---|---|---|---|",
    ...verdicts.historySelection.turns.map((turn) => [
      `| ${turn.arm}`,
      turn.repetition,
      turn.turn,
      turn.actorId,
      turn.variantLocalInput ? "yes" : "no",
      `${turn.lanes.protected}/${turn.lanes.hot}/${turn.lanes.historySelected}/${turn.lanes.historyAuthorized}`,
      `${turn.contextBudget.historyChars}/${turn.contextBudget.historyBudgetChars}`,
      renderEvidenceLedger(turn.evidence),
    ].join(" | ") + " |"),
    "",
    "## Provider attempts and cost provenance",
    "",
    `Cost evidence: **${verdicts.cacheAndCost.costEvidenceStatus}**; rate card \`${verdicts.cacheAndCost.rateCardVersion}\` from \`${verdicts.cacheAndCost.pricingSourceId}\`.`,
    "",
    "| # / cell | Arm | Rep | Turn | First/control | Request / prefix chars | Input/cached/uncached | Output/reasoning | Tier requested/effective | Response/request IDs | Elapsed ms | Cost status / USD |",
    "|---|---|---:|---:|---|---|---|---|---|---|---:|---|",
    ...verdicts.cacheAndCost.attempts.map((attempt) => [
      `| ${attempt.attemptOrdinal} / ${attempt.cellId}`,
      attempt.arm,
      attempt.repetition,
      attempt.turn,
      `${attempt.firstCall ? "first" : "return"}/${attempt.controlReturnTurn ? "control" : "normal"}`,
      `${attempt.requestHash}/${attempt.commonPrefixChars}`,
      `${attempt.inputTokens}/${attempt.cachedInputTokens}/${attempt.uncachedInputTokens}`,
      `${attempt.outputTokens}/${attempt.reasoningTokens}`,
      `${attempt.requestedServiceTier}/${attempt.effectiveServiceTier}`,
      `${attempt.responseId ?? "n/a"}/${attempt.requestId ?? "n/a"}`,
      attempt.elapsedMs,
      `${attempt.costStatus}/${attempt.costUsd.toFixed(6)}`,
    ].join(" | ") + " |"),
    "",
    "## Revealed blind decisions",
    "",
    ...verdicts.blindPreference.decisions.map((decision) => (
      `- ${decision.pairToken}: ${decision.choice}; revealed preference ${decision.preferredArm ?? "none"}${renderDecisionReasons(decision)}`
    )),
    "",
    "## Scope",
    "",
    "One real thread, three paired repetitions, and one cache-control branch. This report does not support a universal promotion claim.",
    "",
    `Report fingerprint: \`${hashCanonicalJson(report)}\``,
  ].join("\n");
}

function renderDecisionReasons(decision: PromptThreadRevealedDecision): string {
  const reasons = Object.entries(decision.reasons ?? {});
  return reasons.length === 0
    ? ""
    : `; ${reasons.map(([category, reason]) => `${category}=${reason}`).join("; ")}`;
}

function renderEvidenceLedger(
  evidence: readonly PromptThreadReportCell["evidence"][number][],
): string {
  return evidence.length === 0
    ? "none"
    : evidence.map((item) => `${item.sourceId}:${item.label}:${item.reason}`).join("<br>");
}

function assertCompletePanel(input: PromptThreadReportInput): void {
  if (
    input.expectedCalls !== 28
    || input.cells.length !== 28
    || new Set(input.cells.map((cell) => cell.cellId)).size !== 28
  ) {
    throw new Error("Final report requires exactly 28 unique completed cells");
  }
  const primary = input.cells.filter((cell) => cell.arm !== "control");
  const controls = input.cells.filter((cell) => cell.arm === "control");
  if (primary.length !== 24 || controls.length !== 4) {
    throw new Error("Final report panel matrix is incomplete");
  }
  assertExpectedMatrix(input.cells);
  for (const cell of input.cells) {
    if (
      cell.responseStatus !== "completed"
      || cell.effectiveServiceTier !== cell.requestedServiceTier
      || !finiteNonNegative([
        cell.inputTokens,
        cell.cachedInputTokens,
        cell.outputTokens,
        cell.reasoningTokens,
        cell.costUsd,
        cell.attemptOrdinal,
        cell.commonPrefixChars,
        cell.elapsedMs,
        cell.selection.protectedCount,
        cell.selection.hotCount,
        cell.selection.authorizedHistoryCount,
        cell.selection.selectedHistoryCount,
        cell.selection.envelopeChars,
        cell.selection.historyBudgetChars,
        cell.selection.protectedChars,
        cell.selection.hotChars,
        cell.selection.historyChars,
      ])
    ) {
      throw new Error("Final report received incomplete or incomparable provider evidence");
    }
    if (cell.firstCall && cell.cachedInputTokens !== 0) {
      throw new Error("Final report rejects a contaminated first call");
    }
    if (cell.cachedInputTokens > cell.inputTokens) {
      throw new Error("Final report rejects impossible cached-token usage");
    }
  }
  if (input.blindDecisions.length !== 3) {
    throw new Error("Final report requires three locked blind decisions");
  }
  if (
    new Set(input.blindDecisions.map((decision) => decision.pairToken)).size !== 3
    || input.blindDecisions.some((decision) => (
      (decision.choice === "A" || decision.choice === "B")
        ? decision.preferredArm === null
        : decision.preferredArm !== null
    ))
  ) {
    throw new Error("Final report received inconsistent blind decisions");
  }
}

function assertExpectedMatrix(cells: readonly PromptThreadReportCell[]): void {
  const expected = new Set<string>();
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const arm of ["baseline", "candidate"] as const) {
      for (let turn = 1; turn <= 4; turn += 1) {
        expected.add(`${arm}:${repetition}:${turn}`);
      }
    }
  }
  for (let turn = 1; turn <= 4; turn += 1) {
    expected.add(`control:1:${turn}`);
  }
  const actual = new Set(
    cells.map((cell) => `${cell.arm}:${cell.repetition}:${cell.turn}`),
  );
  if (
    actual.size !== expected.size
    || [...expected].some((key) => !actual.has(key))
    || cells.some((cell) => (
      cell.firstCall !== (cell.turn <= 2)
      || cell.controlReturnTurn !== (cell.arm === "control" && cell.turn >= 3)
    ))
  ) {
    throw new Error("Final report panel schedule is incomplete or malformed");
  }
}

function historyVerdict(
  input: PromptThreadReportInput,
): PromptThreadReportVerdicts["historySelection"] {
  const baseline = evidenceTotals(input.cells, "baseline");
  const candidate = evidenceTotals(input.cells, "candidate");
  const turns = historyTurnLedger(input.cells);
  const scored = baseline.requiredAvailable
    + baseline.usefulAvailable
    + candidate.requiredAvailable
    + candidate.usefulAvailable;
  const allDisabled = input.cells
    .filter((cell) => cell.arm !== "control")
    .flatMap((cell) => cell.evidence)
    .every((item) => item.reason === "policy_disabled");
  if (
    input.verdictScope === "cache_quality_only"
    || scored === 0
    || allDisabled
  ) {
    return { status: "not_exercised", baseline, candidate, turns };
  }
  return {
    status: comparePromptThreadEvidenceTotals(baseline, candidate),
    baseline,
    candidate,
    turns,
  };
}

function historyTurnLedger(
  cells: readonly PromptThreadReportCell[],
): PromptThreadHistoryTurnLedger[] {
  return cells
    .filter((cell): cell is PromptThreadReportCell & {
      arm: "baseline" | "candidate";
    } => cell.arm !== "control")
    .map((cell) => ({
      cellId: cell.cellId,
      arm: cell.arm,
      repetition: cell.repetition,
      turn: cell.turn,
      actorId: cell.actorId,
      variantLocalInput: cell.turn > 1,
      lanes: {
        protected: cell.selection.protectedCount,
        hot: cell.selection.hotCount,
        historyAuthorized: cell.selection.authorizedHistoryCount,
        historySelected: cell.selection.selectedHistoryCount,
      },
      contextBudget: {
        envelopeChars: cell.selection.envelopeChars,
        historyBudgetChars: cell.selection.historyBudgetChars,
        protectedChars: cell.selection.protectedChars,
        hotChars: cell.selection.hotChars,
        historyChars: cell.selection.historyChars,
      },
      evidence: structuredClone(cell.evidence),
    }));
}

function evidenceTotals(
  cells: readonly PromptThreadReportCell[],
  arm: "baseline" | "candidate",
): PromptThreadEvidenceTotals {
  return summarizePromptThreadEvidence(
    cells.filter((cell) => cell.arm === arm).flatMap((cell) => cell.evidence),
  );
}

export function summarizePromptThreadEvidence(
  items: readonly PromptThreadScoredEvidence[],
): PromptThreadEvidenceTotals {
  const totals: PromptThreadEvidenceTotals = {
    requiredSelected: 0,
    requiredAvailable: 0,
    usefulSelected: 0,
    usefulAvailable: 0,
    distractorSelected: 0,
  };
  for (const item of items) {
    const selected = item.reason === "selected";
    if (item.label === "required") {
      totals.requiredAvailable += 1;
      if (selected) totals.requiredSelected += 1;
    } else if (item.label === "useful") {
      totals.usefulAvailable += 1;
      if (selected) totals.usefulSelected += 1;
    } else if (item.label === "known_distractor" && selected) {
      totals.distractorSelected += 1;
    }
  }
  return totals;
}

export function comparePromptThreadEvidenceTotals(
  baseline: PromptThreadEvidenceTotals,
  candidate: PromptThreadEvidenceTotals,
): "improved" | "regressed" | "mixed" {
  const candidateBetter =
    candidate.requiredSelected >= baseline.requiredSelected
    && candidate.usefulSelected >= baseline.usefulSelected
    && candidate.distractorSelected <= baseline.distractorSelected
    && (
      candidate.requiredSelected > baseline.requiredSelected
      || candidate.usefulSelected > baseline.usefulSelected
      || candidate.distractorSelected < baseline.distractorSelected
    );
  const candidateWorse =
    candidate.requiredSelected < baseline.requiredSelected
    || candidate.usefulSelected < baseline.usefulSelected
    || candidate.distractorSelected > baseline.distractorSelected;
  return candidateBetter
    ? "improved"
    : candidateWorse
      ? "regressed"
      : "mixed";
}

function cacheAndCostVerdict(
  input: PromptThreadReportInput,
): PromptThreadReportVerdicts["cacheAndCost"] {
  const primary = input.cells.filter((cell) => cell.arm !== "control");
  const normalReturns = primary.filter((cell) => !cell.firstCall);
  const normalReturnCallsWithReuse = normalReturns
    .filter((cell) => cell.cachedInputTokens > 0).length;
  const controls = input.cells.filter((cell) => cell.controlReturnTurn);
  const normalAverage = average(normalReturns.map((cell) => cell.cachedInputTokens));
  const controlAverage = average(controls.map((cell) => cell.cachedInputTokens));
  const controlReductionObserved = controls.length === 2 && controlAverage < normalAverage;
  const baselineCostUsd = sumCost(primary, "baseline");
  const candidateCostUsd = sumCost(primary, "candidate");
  const costEvidenceStatus = summarizeCostStatus(input.cells);
  const attempts = attemptLedger(input.cells);
  const cacheConclusive =
    normalReturnCallsWithReuse === normalReturns.length
    && controlReductionObserved
    && costEvidenceStatus !== "unavailable"
    && costEvidenceStatus !== "mixed";
  let status: PromptThreadReportVerdicts["cacheAndCost"]["status"];
  if (!cacheConclusive) {
    status = "inconclusive";
  } else if (candidateCostUsd < baselineCostUsd) {
    status = "improved";
  } else if (candidateCostUsd > baselineCostUsd) {
    status = "regressed";
  } else {
    status = "mixed";
  }
  return {
    status,
    costEvidenceStatus,
    normalReturnCallsWithReuse,
    normalReturnCallCount: normalReturns.length,
    controlReductionObserved,
    baselineCostUsd,
    candidateCostUsd,
    rateCardVersion: input.rateCardVersion,
    pricingSourceId: input.pricingSourceId,
    attempts,
  };
}

function summarizeCostStatus(
  cells: readonly PromptThreadReportCell[],
): PromptThreadReportVerdicts["cacheAndCost"]["costEvidenceStatus"] {
  const statuses = new Set(cells.map((cell) => cell.costStatus));
  if (statuses.has("unavailable")) return "unavailable";
  if (statuses.size !== 1) return "mixed";
  return statuses.has("actual") ? "actual" : "estimated";
}

function attemptLedger(
  cells: readonly PromptThreadReportCell[],
): PromptThreadAttemptLedger[] {
  return cells.map((cell) => ({
    cellId: cell.cellId,
    attemptOrdinal: cell.attemptOrdinal,
    arm: cell.arm,
    repetition: cell.repetition,
    turn: cell.turn,
    actorId: cell.actorId,
    firstCall: cell.firstCall,
    controlReturnTurn: cell.controlReturnTurn,
    requestHash: cell.requestHash,
    commonPrefixChars: cell.commonPrefixChars,
    responseId: cell.responseId,
    requestId: cell.requestId,
    elapsedMs: cell.elapsedMs,
    requestedServiceTier: cell.requestedServiceTier,
    effectiveServiceTier: cell.effectiveServiceTier,
    inputTokens: cell.inputTokens,
    cachedInputTokens: cell.cachedInputTokens,
    uncachedInputTokens: cell.inputTokens - cell.cachedInputTokens,
    outputTokens: cell.outputTokens,
    reasoningTokens: cell.reasoningTokens,
    costUsd: cell.costUsd,
    costStatus: cell.costStatus,
  }));
}

function blindPreferenceVerdict(
  decisions: readonly PromptThreadRevealedDecision[],
): PromptThreadReportVerdicts["blindPreference"] {
  const counts = {
    candidate: decisions.filter((decision) => decision.preferredArm === "candidate").length,
    production: decisions.filter((decision) => decision.preferredArm === "baseline").length,
    noPreference: decisions.filter((decision) => decision.choice === "no_preference").length,
    insufficientEvidence: decisions.filter((decision) => decision.choice === "insufficient_evidence").length,
  };
  const status = counts.candidate > 0 && counts.production === 0
    ? "candidate"
    : counts.production > 0 && counts.candidate === 0
      ? "production"
      : counts.candidate > 0 || counts.production > 0
        ? "mixed"
        : counts.insufficientEvidence > 0
          ? "insufficient_evidence"
          : "no_preference";
  return {
    status,
    ...counts,
    decisions: decisions.map((decision) => ({ ...decision })),
  };
}

function sumCost(
  cells: readonly PromptThreadReportCell[],
  arm: "baseline" | "candidate",
): number {
  return cells
    .filter((cell) => cell.arm === arm)
    .reduce((sum, cell) => sum + cell.costUsd, 0);
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteNonNegative(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value >= 0);
}
