import { describe, expect, it } from "bun:test";
import type { JsonValue } from "@influence/prompt-lab-protocol";
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
  fingerprintProviderAttemptRequest,
  freezeProviderScenarioPack,
  type ProviderScenarioPrivateRun,
  type ProviderScenarioBlindReviewScores,
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

describe("R32 private paired-report writer", () => {
  it("rejects public paths and writes owner-only JSON under .local-uploads", async () => {
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
});

function diaryPack(answer = "I need Blair to vote with me.") {
  return freezeProviderScenarioPack({
    version: 1,
    scenarioId: "house-diary-substantive",
    comparisonKey: "r32-house-diary-substantive-v1",
    surface: "house_diary",
    semanticInput: {
      houseContext: { round: 2, alivePlayerIds: ["player-a", "player-b"] },
      fixedExchange: { question: "Who do you need?", answer },
      authority: {
        displayedQuestion: "presentation_only",
        contestantAnswer: "structured",
        houseDecision: "structured",
      },
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
    harnessRevision: "sha256:harness",
    targetRevision: "git:abc123",
    targetFileHashes: { "packages/engine/src/agent.ts": "sha256:agent" },
    config: CONFIG,
    packs: [pack],
    samples: [{
      scenarioId: pack.scenarioId,
      comparisonKey: pack.comparisonKey,
      semanticPackHash: pack.semanticPackHash,
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
      promptFingerprints: ["sha256:prompt"],
      structuredContractFingerprints: ["sha256:schema"],
      requestIds: ["req_public_coordinate"],
      responseIds: ["resp_public_coordinate"],
      attemptDispositions: ["accepted"],
      turns: [
        { label: "house_question", authority: "presentation_only", status: "accepted" },
        { label: "contestant_answer", authority: "structured", status: "accepted" },
      ],
      private: {
        semanticInput: pack.semanticInput,
        traces: [{
          prompt: "SECRET_PROMPT_SENTINEL",
          reasoning: "SECRET_REASONING_SENTINEL",
          raw: { answer: "SECRET_NATIVE_SENTINEL" },
          output: "SECRET_GENERATED_PROSE_SENTINEL",
        }],
        attempts: [{
          preparedRequest: { body: { messages: ["SECRET_PRIVATE_CONTEXT_SENTINEL"] } },
          rawResponse: { body: "SECRET_RAW_RESPONSE_SENTINEL" },
        }],
        presentation: {
          displayedQuestion: "SECRET_DISPLAYED_QUESTION_SENTINEL",
          contestantAnswer: "SECRET_CONTESTANT_ANSWER_SENTINEL",
        },
      },
    }],
  };
}

describe("provider scenario evaluation", () => {
  it("freezes the five causal seam situations without prose-driven downstream inputs", () => {
    const scenarios = createR32ProviderScenarios();
    expect(scenarios.map((scenario) => scenario.pack.scenarioId)).toEqual([
      "house-diary-substantive",
      "house-diary-evasive",
      "house-summary-ordinary",
      "house-summary-milestone",
      "judgment-question-answer",
    ]);
    expect(Object.fromEntries(scenarios.map((scenario) => [
      scenario.pack.scenarioId,
      scenario.pack.semanticPackHash,
    ]))).toEqual({
      "house-diary-substantive": "sha256:1cdd4d91d452971058e34b205b2a3d7f1dc368bee06337a8471ca281e10d8cc0",
      "house-diary-evasive": "sha256:f44b9a477a7b2bdbf88a3d53ece9fbac4246a3be2ea34784a60949ca9015fbd4",
      "house-summary-ordinary": "sha256:94fe9c02a4aaf4839c1c94ae0a0977f470fa85d88c710bd7a65c8f64262f728e",
      "house-summary-milestone": "sha256:c0350cf03d589d3bf834264fed015ec8036c007356d92913636b90b5d315d6bf",
      "judgment-question-answer": "sha256:bf15da00ea557e50379a3bbb2664b66d16543f1ccfd2a75222576d060b9323e7",
    });

    const semantic = Object.fromEntries(scenarios.map((scenario) => [
      scenario.pack.scenarioId,
      scenario.pack.semanticInput,
    ])) as Record<string, Record<string, unknown>>;
    expect(semantic["house-diary-substantive"]?.downstreamInputPolicy)
      .toBe("fixed_inputs_only_generated_prose_never_drives_later_calls");
    expect(semantic["house-summary-ordinary"]?.contestantContext).toBeNull();
    expect(semantic["house-summary-ordinary"]?.priorRenderedBeat).toBeNull();
    expect(semantic["house-summary-milestone"]?.priorRenderedBeat).toMatchObject({
      authority: "narrative_non_authoritative",
    });
    expect(semantic["judgment-question-answer"]).toMatchObject({
      jurorQuestionContext: { priorAnswerVisibility: "omitted" },
      displayWrappers: { authority: "presentation_only" },
      downstreamInputPolicy: "fixed_question_generated_juror_prose_does_not_drive_finalist_answer",
    });
    const jurorContext = semantic["judgment-question-answer"]?.jurorQuestionContext as {
      judgmentQuestionHistory: Array<Record<string, unknown>>;
    };
    expect(jurorContext.judgmentQuestionHistory[0]).not.toHaveProperty("answer");
  });

  it("preflights every bound provider setting before a run can construct a client", () => {
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
      reasoningPolicy: "low",
      toolChoiceMode: "named",
      serviceTier: "flex",
      reasoningSummary: "auto",
    });
    expect(() => parseR32ProviderEvaluationArgs(
      args.filter((argument) => !argument.startsWith("--catalog-id=")),
    )).toThrow("--catalog-id");
    expect(() => parseR32ProviderEvaluationArgs(
      args.map((argument) => argument === "--samples=1" ? "--samples=2" : argument),
    )).toThrow("--samples");
  });

  it("anchors artifacts and behavior hashes at the repository root", () => {
    expect(findRepoRoot(import.meta.dir)).toBe(resolve(import.meta.dir, "../../../.."));
  });

  it("hashes only the frozen typed semantic pack", () => {
    const first = diaryPack();
    const reordered = freezeProviderScenarioPack({
      comparisonKey: "r32-house-diary-substantive-v1",
      scenarioId: "house-diary-substantive",
      surface: "house_diary",
      semanticInput: {
        authority: {
          houseDecision: "structured",
          contestantAnswer: "structured",
          displayedQuestion: "presentation_only",
        },
        fixedExchange: { answer: "I need Blair to vote with me.", question: "Who do you need?" },
        houseContext: { alivePlayerIds: ["player-a", "player-b"], round: 2 },
      },
      version: 1,
    });

    expect(reordered.semanticPackHash).toBe(first.semanticPackHash);
    expect(diaryPack("I am finished talking.").semanticPackHash).not.toBe(first.semanticPackHash);

    const run = privateRun();
    run.stage = "after";
    run.samples[0]!.cacheIsolationNonce = "different-nonce";
    run.samples[0]!.private.traces = [{ prompt: "different raw prompt" }];
    expect(run.packs[0]!.semanticPackHash).toBe(first.semanticPackHash);
  });

  it("builds a whitelist-only public manifest", () => {
    const manifest = createProviderScenarioManifest(privateRun());
    const serialized = JSON.stringify(manifest);

    expect(manifest).toMatchObject({
      version: 1,
      stage: "before",
      config: CONFIG,
      samples: [{
        outcome: { status: "accepted" },
        accounting: { attempts: 2, accountingComplete: true },
        promptFingerprints: ["sha256:prompt"],
        structuredContractFingerprints: ["sha256:schema"],
      }],
    });
    for (const privateSentinel of [
      "SECRET_PROMPT_SENTINEL",
      "SECRET_REASONING_SENTINEL",
      "SECRET_NATIVE_SENTINEL",
      "SECRET_GENERATED_PROSE_SENTINEL",
      "SECRET_PRIVATE_CONTEXT_SENTINEL",
      "SECRET_RAW_RESPONSE_SENTINEL",
      "SECRET_DISPLAYED_QUESTION_SENTINEL",
      "SECRET_CONTESTANT_ANSWER_SENTINEL",
      "I need Blair to vote with me.",
      "nonce-private",
    ]) {
      expect(serialized).not.toContain(privateSentinel);
    }
  });

  it("fingerprints prompt-bearing and structured-contract request fields separately", () => {
    const request = {
      providerProfileId: "openai",
      modelId: "gpt-5.6-luna",
      body: {
        model: "gpt-5.6-luna",
        messages: [{ role: "user", content: "private prompt" }],
        tools: [{ type: "function", function: { name: "choose", parameters: { type: "object" } } }],
        tool_choice: { type: "function", function: { name: "choose" } },
        max_completion_tokens: 200,
        temperature: 0.8,
      },
    } satisfies JsonValue;
    const changedResponseOnly = structuredClone(request);
    changedResponseOnly.body.temperature = 0.1;

    expect(fingerprintProviderAttemptRequest(request)).toEqual({
      prompt: expect.stringMatching(/^sha256:/),
      structuredContract: expect.stringMatching(/^sha256:/),
    });
    expect(fingerprintProviderAttemptRequest(changedResponseOnly)).toEqual(
      fingerprintProviderAttemptRequest(request),
    );
    expect(fingerprintProviderAttemptRequest({
      body: { messages: request.body.messages, max_completion_tokens: 50 },
    })).toEqual({
      prompt: expect.stringMatching(/^sha256:/),
      structuredContract: null,
    });
  });

  it("rejects incomplete or unattributable run configuration before execution", () => {
    expect(assertProviderScenarioRunConfig(CONFIG, [diaryPack()])).toEqual(CONFIG);
    expect(() => assertProviderScenarioRunConfig({ ...CONFIG, catalogId: "" }, [diaryPack()]))
      .toThrow("catalogId");
    expect(() => assertProviderScenarioRunConfig({ ...CONFIG, sampleCount: 2 }, [diaryPack()]))
      .toThrow("sampleCount");
    expect(() => assertProviderScenarioRunConfig(CONFIG, [])).toThrow("frozen provider scenario pack");
  });

  it("requires semantic and provider configuration parity but allows contract drift", () => {
    const before = createProviderScenarioManifest(privateRun());
    const candidateRun = privateRun();
    candidateRun.stage = "after";
    candidateRun.samples[0]!.promptFingerprints = ["sha256:changed-prompt"];
    candidateRun.samples[0]!.structuredContractFingerprints = ["sha256:changed-contract"];
    const after = createProviderScenarioManifest(candidateRun);

    expect(compareProviderScenarioRuns(before, after)).toMatchObject({
      comparable: true,
      differences: [],
    });

    expect(compareProviderScenarioRuns(before, {
      ...after,
      config: { ...after.config, serviceTier: "priority" },
    })).toMatchObject({
      comparable: false,
      differences: ["config.serviceTier"],
    });
  });

  it("builds a prose-free per-sample paired report and refuses drift", () => {
    const before = createProviderScenarioManifest(privateRun());
    const candidateRun = privateRun();
    candidateRun.stage = "after";
    candidateRun.runId = "r32-after-test";
    candidateRun.samples[0]!.promptFingerprints = ["sha256:changed-prompt"];
    candidateRun.samples[0]!.structuredContractFingerprints = ["sha256:changed-contract"];
    const after = createProviderScenarioManifest(candidateRun);

    const report = createProviderScenarioPairedReport(before, after);
    expect(report).toMatchObject({
      comparable: true,
      beforeRunId: "r32-before-test",
      afterRunId: "r32-after-test",
      operations: {
        before: { samples: 1, acceptedSamples: 1, attempts: 2, totalTokens: 110 },
        after: { samples: 1, acceptedSamples: 1, attempts: 2, totalTokens: 110 },
      },
      samples: [{
        scenarioId: "house-diary-substantive",
        sampleOrdinal: 1,
        promptChanged: true,
        structuredContractChanged: true,
      }],
      presentationReview: { status: "pending_blind_review" },
    });
    expect(JSON.stringify(report)).not.toContain("SECRET_");
    expect(() => createProviderScenarioPairedReport(before, {
      ...after,
      config: { ...after.config, serviceTier: "priority" },
    })).toThrow("incomparable");
  });

  it("shuffles revision-blind presentations and joins complete scores only through the private key", () => {
    const beforeRun = privateRun();
    const afterRun = privateRun();
    afterRun.stage = "after";
    afterRun.runId = "r32-after-test";
    afterRun.samples[0]!.private.presentation = {
      displayedQuestion: "AFTER_DISPLAYED_QUESTION_SENTINEL",
      contestantAnswer: "AFTER_CONTESTANT_ANSWER_SENTINEL",
    };
    const artifacts = createProviderScenarioBlindReviewArtifacts(
      beforeRun,
      afterRun,
      "fixed-test-seed",
    );
    const serializedBundle = JSON.stringify(artifacts.bundle);
    expect(serializedBundle).toContain("SECRET_DISPLAYED_QUESTION_SENTINEL");
    expect(serializedBundle).toContain("AFTER_DISPLAYED_QUESTION_SENTINEL");
    expect(serializedBundle).not.toContain("r32-before-test");
    expect(serializedBundle).not.toContain("r32-after-test");
    expect(serializedBundle).not.toContain('"stage"');
    expect(serializedBundle).not.toContain('"scenarioId"');
    expect(JSON.stringify(artifacts.key)).not.toContain("QUESTION_SENTINEL");

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
        note: "B is more specific and follows the answer.",
      }],
    } satisfies ProviderScenarioBlindReviewScores;
    const review = completeProviderScenarioBlindReview(
      artifacts.bundle,
      artifacts.key,
      scores,
      "producer-reviewer",
      "2026-08-27T12:00:00.000Z",
    );
    expect(review.summary).toMatchObject({
      status: "completed_blind_review",
      pairsReviewed: 1,
      reviewerLabel: "producer-reviewer",
    });
    expect(review.summary.preferences.before + review.summary.preferences.after)
      .toBe(1);

    const paired = createProviderScenarioPairedReport(
      createProviderScenarioManifest(beforeRun),
      createProviderScenarioManifest(afterRun),
    );
    expect(attachProviderScenarioBlindReview(paired, review).presentationReview)
      .toEqual(review.summary);
    const malformedScores = structuredClone(scores) as ProviderScenarioBlindReviewScores;
    malformedScores.scorecards[0]!.scores.A = { question_specificity: 3 };
    expect(() => completeProviderScenarioBlindReview(
      artifacts.bundle,
      artifacts.key,
      malformedScores,
      "producer-reviewer",
      "2026-08-27T12:00:00.000Z",
    )).toThrow("wrong criteria");
  });
});
