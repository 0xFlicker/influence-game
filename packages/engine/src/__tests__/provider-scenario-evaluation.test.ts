import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  attachProviderScenarioBlindReview,
  assertProviderScenarioRunConfig,
  compareProviderScenarioRuns,
  completeProviderScenarioBlindReview,
  createProviderScenarioBlindReviewArtifacts,
  createProviderScenarioManifest,
  createProviderScenarioPairedReport,
  freezeProviderScenarioPack,
  type ProviderScenarioBlindReviewScores,
  type ProviderScenarioPrivateRun,
} from "../provider-scenario-evaluation";
import {
  createR32ProviderScenarios,
  findRepoRoot,
  parseR32ProviderEvaluationArgs,
} from "../scripts/evaluate-r32-provider-surfaces";
import {
  assertPrivateOutput,
  writePrivateJson,
} from "../scripts/compare-r32-provider-surfaces";

const CONFIG = {
  providerProfileId: "openai",
  catalogId: "openai:gpt-5.6-luna",
  modelId: "gpt-5.6-luna",
  serviceTier: "flex",
  reasoningPolicy: "low",
  toolChoiceMode: "named",
  reasoningSummary: "auto",
  sampleCount: 3,
} as const;

function diaryPack() {
  return freezeProviderScenarioPack({
    version: 1,
    scenarioId: "house-diary-substantive",
    comparisonKey: "r32-house-diary-substantive-v1",
    surface: "house_diary",
    semanticInput: {
      houseContext: { round: 2, alivePlayerIds: ["player-a", "player-b"] },
      fixedExchange: { question: "Who do you need?", answer: "I need Blair." },
    },
  });
}

function privateRun(): ProviderScenarioPrivateRun {
  const pack = diaryPack();
  return {
    version: 1,
    stage: "before",
    runId: "r32-before-test",
    createdAt: "2026-08-26T18:00:00.000Z",
    harnessRevision: "files:test",
    targetRevision: "git:abc123",
    targetFileHashes: { "packages/engine/src/agent.ts": "sha256:agent" },
    config: CONFIG,
    packs: [pack],
    samples: [{
      scenarioId: pack.scenarioId,
      comparisonKey: pack.comparisonKey,
      sampleOrdinal: 1,
      cacheIsolationNonce: "nonce-private",
      outcome: {
        status: "accepted",
        acceptedStructuredTurns: 2,
        exhaustedStructuredTurns: 0,
        fallbackTurns: 0,
      },
      accounting: {
        attempts: 2,
        latencyMs: 210,
        promptTokens: 80,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 20,
        reasoningTokens: 10,
        totalTokens: 110,
        actualCostMicrousd: 45,
        estimatedCostMicrousd: null,
        costStatus: "actual",
        pricingSourceId: "provider_actual",
        accountingComplete: true,
      },
      requestIds: ["req_public_coordinate"],
      responseIds: ["resp_public_coordinate"],
      attemptDispositions: ["accepted"],
      turns: [
        { label: "house_question", authority: "presentation_only", status: "accepted" },
        { label: "contestant_answer", authority: "structured", status: "accepted" },
      ],
      private: {
        semanticInput: pack.semanticInput,
        traces: [{ prompt: "SECRET_PROMPT_SENTINEL" }],
        attempts: [{ preparedRequest: { body: "SECRET_REQUEST_SENTINEL" } }],
        presentation: { displayedQuestion: "SECRET_PRESENTATION_SENTINEL" },
      },
    }],
  };
}

describe("R32 provider samples", () => {
  it("keeps private artifacts under .local-uploads with owner-only permissions", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "r32-private-report-"));
    const outputPath = join(repoRoot, ".local-uploads", "paired.json");
    try {
      expect(() => assertPrivateOutput(repoRoot, join(repoRoot, "docs", "paired.json")))
        .toThrow("must stay under .local-uploads");
      assertPrivateOutput(repoRoot, outputPath);
      await writePrivateJson(outputPath, { private: true });
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual({ private: true });
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("defines diary, authored-summary, long-form, and Judgment controls without proof fields", () => {
    const scenarios = createR32ProviderScenarios();
    expect(scenarios.map((scenario) => scenario.pack.scenarioId)).toEqual([
      "house-diary-substantive",
      "house-diary-evasive",
      "house-summary-ordinary",
      "house-summary-milestone",
      "house-long-form",
      "judgment-question-answer",
    ]);
    const serialized = JSON.stringify(scenarios.map((scenario) => scenario.pack));
    expect(serialized).not.toMatch(/semanticPackHash|promptFingerprint|sourceAlias|sourceValuesByAlias|factReadAllowed/);
    const packs = Object.fromEntries(scenarios.map((scenario) => [
      scenario.pack.scenarioId,
      scenario.pack.semanticInput,
    ])) as Record<string, Record<string, unknown>>;
    expect(packs["house-summary-ordinary"]?.contestantContext).toBeNull();
    expect(packs["house-summary-milestone"]?.continuity).toMatchObject({
      privateNarrativeNotebook: expect.any(String),
    });
    expect(packs["judgment-question-answer"]).toMatchObject({
      jurorQuestionContext: { priorAnswerVisibility: "omitted" },
      downstreamInputPolicy: "fixed_question_generated_juror_prose_does_not_drive_finalist_answer",
    });
  });

  it("preflights every paid-provider setting before constructing a client", () => {
    const args = [
      "--stage=before",
      "--catalog-id=openai:gpt-5.6-luna",
      "--reasoning-policy=low",
      "--tool-choice-mode=named",
      "--service-tier=flex",
      "--reasoning-summary=auto",
      "--samples=1",
      "--output-dir=.local-uploads/r32-provider-surfaces/test",
    ];
    expect(parseR32ProviderEvaluationArgs(args)).toMatchObject({
      stage: "before",
      sampleCount: 1,
      catalogId: "openai:gpt-5.6-luna",
    });
    expect(() => parseR32ProviderEvaluationArgs(
      args.filter((argument) => !argument.startsWith("--catalog-id=")),
    )).toThrow("--catalog-id");
    expect(() => parseR32ProviderEvaluationArgs(
      args.map((argument) => argument === "--samples=1" ? "--samples=2" : argument),
    )).toThrow("--samples");
  });

  it("anchors artifacts at the repository root", () => {
    expect(findRepoRoot(import.meta.dir)).toBe(resolve(import.meta.dir, "../../../.."));
  });

  it("freezes scenario input without generating semantic hashes", () => {
    const pack = diaryPack();
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.semanticInput)).toBe(true);
    expect(pack).not.toHaveProperty("semanticPackHash");
  });

  it("builds a whitelist-only telemetry manifest", () => {
    const manifest = createProviderScenarioManifest(privateRun());
    const serialized = JSON.stringify(manifest);
    expect(manifest).toMatchObject({ version: 1, stage: "before" });
    expect(manifest.samples[0]).toMatchObject({
      outcome: { status: "accepted" },
      accounting: { attempts: 2, totalTokens: 110 },
    });
    expect(manifest.samples[0]?.turns[0]).toMatchObject({
      label: "house_question",
      status: "accepted",
    });
    expect(serialized).not.toMatch(/semanticPackHash|promptFingerprint|structuredContractFingerprint/);
    for (const sentinel of [
      "SECRET_PROMPT_SENTINEL",
      "SECRET_REQUEST_SENTINEL",
      "SECRET_PRESENTATION_SENTINEL",
      "I need Blair.",
      "nonce-private",
    ]) expect(serialized).not.toContain(sentinel);
  });

  it("rejects incomplete run configuration and scenario drift", () => {
    expect(assertProviderScenarioRunConfig(CONFIG, [diaryPack()])).toEqual(CONFIG);
    expect(() => assertProviderScenarioRunConfig({ ...CONFIG, catalogId: "" }, [diaryPack()]))
      .toThrow("catalogId");
    expect(() => assertProviderScenarioRunConfig({ ...CONFIG, sampleCount: 2 }, [diaryPack()]))
      .toThrow("sampleCount");
    expect(() => assertProviderScenarioRunConfig(CONFIG, [])).toThrow("scenario pack");

    const before = createProviderScenarioManifest(privateRun());
    const afterRun = privateRun();
    afterRun.stage = "after";
    afterRun.runId = "r32-after-test";
    const after = createProviderScenarioManifest(afterRun);
    expect(compareProviderScenarioRuns(before, after)).toEqual({ comparable: true, differences: [] });
    expect(compareProviderScenarioRuns(before, {
      ...after,
      config: { ...after.config, serviceTier: "priority" },
    })).toEqual({ comparable: false, differences: ["config.serviceTier"] });
  });

  it("pairs operational metrics and supports a separate blind qualitative review", () => {
    const beforeRun = privateRun();
    const afterRun = privateRun();
    afterRun.stage = "after";
    afterRun.runId = "r32-after-test";
    afterRun.samples[0]!.private.presentation = { displayedQuestion: "AFTER_PRESENTATION" };

    const paired = createProviderScenarioPairedReport(
      createProviderScenarioManifest(beforeRun),
      createProviderScenarioManifest(afterRun),
    );
    expect(paired).toMatchObject({
      operations: {
        before: { attempts: 2, totalTokens: 110 },
        after: { attempts: 2, totalTokens: 110 },
      },
      samples: [{ scenarioId: "house-diary-substantive", sampleOrdinal: 1 }],
    });

    const artifacts = createProviderScenarioBlindReviewArtifacts(beforeRun, afterRun, "fixed-seed");
    const pair = artifacts.bundle.pairs[0]!;
    const scores = {
      version: 1,
      reviewBatchId: artifacts.bundle.reviewBatchId,
      scorecards: [{
        reviewPairId: pair.reviewPairId,
        preference: "B",
        scores: {
          A: { question_specificity: 3, follow_up_relevance: 2 },
          B: { question_specificity: 5, follow_up_relevance: 4 },
        },
        note: "B is more specific.",
      }],
    } satisfies ProviderScenarioBlindReviewScores;
    const review = completeProviderScenarioBlindReview(
      artifacts.bundle,
      artifacts.key,
      scores,
      "producer-reviewer",
      "2026-08-27T12:00:00.000Z",
    );
    expect(review.summary).toMatchObject({ status: "completed_blind_review", pairsReviewed: 1 });
    expect(attachProviderScenarioBlindReview(paired, review).presentationReview)
      .toEqual(review.summary);
  });
});
