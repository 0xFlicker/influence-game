import { describe, expect, it } from "bun:test";
import {
  buildPromptThreadFinalReport,
  renderPromptThreadReportMarkdown,
  type PromptThreadReportCell,
  type PromptThreadReportInput,
} from "../prompt-thread-report";

function cells(options: {
  candidateRequiredSelected?: boolean;
  returnCache?: number;
  controlCache?: number;
  firstCache?: number;
} = {}): PromptThreadReportCell[] {
  const values: PromptThreadReportCell[] = [];
  let ordinal = 0;
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const arm of ["baseline", "candidate"] as const) {
      for (let turn = 1; turn <= 4; turn += 1) {
        ordinal += 1;
        values.push(cell({
          ordinal,
          arm,
          repetition,
          turn,
          cached: turn <= 2 ? options.firstCache ?? 0 : options.returnCache ?? 100,
          selected: arm === "baseline" || options.candidateRequiredSelected !== false,
        }));
      }
    }
  }
  for (let turn = 1; turn <= 4; turn += 1) {
    ordinal += 1;
    values.push(cell({
      ordinal,
      arm: "control",
      repetition: 1,
      turn,
      cached: turn <= 2 ? 0 : options.controlCache ?? 10,
      selected: false,
    }));
  }
  return values;
}

function cell(input: {
  ordinal: number;
  arm: "baseline" | "candidate" | "control";
  repetition: number;
  turn: number;
  cached: number;
  selected: boolean;
}): PromptThreadReportCell {
  return {
    cellId: `cell-${input.ordinal}`,
    attemptOrdinal: input.ordinal,
    arm: input.arm,
    repetition: input.repetition,
    turn: input.turn,
    actorId: input.turn % 2 ? "finn" : "lyra",
    firstCall: input.turn <= 2,
    controlReturnTurn: input.arm === "control" && input.turn >= 3,
    responseStatus: "completed",
    requestHash: `sha256:request-${input.ordinal}`,
    commonPrefixChars: input.turn <= 2 ? 0 : 8_000,
    responseId: `response-${input.ordinal}`,
    requestId: null,
    elapsedMs: 500,
    requestedServiceTier: "flex",
    effectiveServiceTier: "flex",
    inputTokens: 2_000,
    cachedInputTokens: input.cached,
    outputTokens: 100,
    reasoningTokens: 10,
    costUsd: input.arm === "candidate" ? 0.0001 : 0.0002,
    costStatus: "estimated",
    selection: {
      protectedCount: 4,
      hotCount: input.turn - 1,
      authorizedHistoryCount: 8,
      selectedHistoryCount: input.selected ? 1 : 0,
      envelopeChars: 10_000,
      historyBudgetChars: 2_000,
      protectedChars: 3_000,
      hotChars: 1_000,
      historyChars: input.selected ? 500 : 0,
    },
    evidence: input.arm === "control"
      ? []
      : [{
          sourceId: "history:required",
          label: "required",
          reason: input.selected ? "selected" : "ranked_out",
        }],
  };
}

function reportInput(overrides: Partial<PromptThreadReportInput> = {}): PromptThreadReportInput {
  return {
    runManifestHash: `sha256:${"1".repeat(64)}`,
    blindDecisionsHash: `sha256:${"2".repeat(64)}`,
    caseHash: `sha256:${"3".repeat(64)}`,
    evidenceCardHash: `sha256:${"4".repeat(64)}`,
    verdictScope: "full",
    expectedCalls: 28,
    cells: cells(),
    blindDecisions: [
      { pairToken: "one", choice: "B", preferredArm: "candidate" },
      { pairToken: "two", choice: "A", preferredArm: "candidate" },
      { pairToken: "three", choice: "no_preference", preferredArm: null },
    ],
    rateCardVersion: "2026-07-28",
    pricingSourceId: "engine:model-pricing",
    now: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("prompt-thread report", () => {
  it("keeps four verdicts independent and scopes blind preference to this case", () => {
    const report = buildPromptThreadFinalReport(reportInput());
    const markdown = renderPromptThreadReportMarkdown(report);
    expect(report.verdicts).toMatchObject({
      replayComparability: { status: "pass" },
      historySelection: { status: "mixed" },
      cacheAndCost: { status: "improved" },
      blindPreference: { status: "candidate", candidate: 2, noPreference: 1 },
      limitations: { caseCount: 1, universalPromotionClaim: false },
    });
    expect(report.verdicts.historySelection).toMatchObject({
      turns: expect.arrayContaining([
        expect.objectContaining({
          arm: "baseline",
          turn: 1,
          variantLocalInput: false,
          lanes: { protected: 4, hot: 0, historySelected: 1, historyAuthorized: 8 },
        }),
        expect.objectContaining({
          arm: "candidate",
          turn: 2,
          variantLocalInput: true,
        }),
      ]),
    });
    expect(report.verdicts.cacheAndCost).toMatchObject({
      costEvidenceStatus: "estimated",
      attempts: expect.arrayContaining([
        expect.objectContaining({
          arm: "candidate",
          uncachedInputTokens: 1_900,
          costStatus: "estimated",
        }),
      ]),
    });
    expect(report.verdicts.blindPreference).toMatchObject({
      decisions: expect.arrayContaining([
        { pairToken: "one", choice: "B", preferredArm: "candidate" },
      ]),
    });
    expect(markdown).toContain(
      "does not support a universal promotion claim",
    );
    expect(markdown).toContain("## Per-turn evidence");
    expect(markdown).toContain("## Provider attempts and cost provenance");
    expect(markdown).toContain("## Revealed blind decisions");
  });

  it("does not call a cheaper candidate improved when it omits required evidence", () => {
    const report = buildPromptThreadFinalReport(reportInput({
      cells: cells({ candidateRequiredSelected: false }),
    }));
    expect(report.verdicts.historySelection).toMatchObject({ status: "regressed" });
    expect(report.verdicts.cacheAndCost).toMatchObject({ status: "improved" });
  });

  it("marks zero-history and failed cache controls honestly", () => {
    const noHistory = cells();
    for (const value of noHistory) {
      value.evidence = value.evidence.map((item) => ({
        ...item,
        reason: "policy_disabled",
      }));
    }
    const report = buildPromptThreadFinalReport(reportInput({
      verdictScope: "cache_quality_only",
      cells: noHistory.map((value) => (
        value.controlReturnTurn ? { ...value, cachedInputTokens: 100 } : value
      )),
    }));
    expect(report.verdicts.historySelection).toMatchObject({ status: "not_exercised" });
    expect(report.verdicts.cacheAndCost).toMatchObject({ status: "inconclusive" });
  });

  it("rejects contamination, tier drift, missing cells, and incomplete blind review", () => {
    const contaminated = cells();
    contaminated[0]!.cachedInputTokens = 1;
    expect(() => buildPromptThreadFinalReport(reportInput({ cells: contaminated })))
      .toThrow("contaminated");
    const tierDrift = cells();
    tierDrift[2]!.effectiveServiceTier = "auto";
    expect(() => buildPromptThreadFinalReport(reportInput({ cells: tierDrift })))
      .toThrow("incomparable");
    expect(() => buildPromptThreadFinalReport(reportInput({ cells: cells().slice(1) })))
      .toThrow("28");
    expect(() => buildPromptThreadFinalReport(reportInput({ blindDecisions: [] })))
      .toThrow("three");
  });
});
