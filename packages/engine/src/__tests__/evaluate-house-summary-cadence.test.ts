import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import type {
  HouseSelectiveSummaryContext,
  HouseSummaryAttemptResult,
} from "../game-runner.types";
import { LLMHouseInterviewer, TemplateHouseInterviewer } from "../house-interviewer";
import {
  attestSavedReport,
  buildRoundOnlyBaselineRequest,
  captureBaselineFixture,
  continuityEvidence,
  evaluatePhase,
  maximumSummaryJaccardPair,
  repetitionEvidence,
  reviewedQualitySignalsPass,
  runCandidateFixture,
} from "../scripts/evaluate-house-summary-cadence";

const FIXTURE_GAME_ID = "00000000-0000-4000-8000-000000000201";

class RunnerRejectedHouse extends TemplateHouseInterviewer {
  override async generateHouseSummary(
    context: HouseSelectiveSummaryContext,
  ): Promise<HouseSummaryAttemptResult> {
    if (context.frontier.boundary.actorCoordinate !== "format_pick") {
      return super.generateHouseSummary(context);
    }
    const primary = context.frontier.catalog[0];
    if (!primary) throw new Error("Expected a material format_pick frontier.");
    return {
      status: "emitted",
      summary: "FORMAT LOCKED: forged publication claim",
      sourceAliases: [primary.alias],
      sources: [primary.source],
      openQuestions: [],
      threadIds: [],
      boundary: context.frontier.boundary,
      providerCalls: 1,
      factCalls: 0,
      requestedCategories: [],
      returnedBytes: 0,
      usage: [],
    };
  }
}

function savedFullReport(manualSignals: {
  canonicalContradictionsDetected: boolean | null;
  repetitiveOrLowValueOrdinaryBeatsDetected: boolean | null;
  milestoneRegressionDetected: boolean | null;
  pacingHarmDetected: boolean | null;
}) {
  return {
    scope: "full_cadence",
    verdict: {
      automaticFullGatePassed: true,
      fullGatePassed: false,
      qualitySignals: {
        unsupportedAliasesDetected: false,
        continuityBreaksDetected: false,
        ...manualSignals,
        qualityReviewed: false,
        reviewer: null,
        reviewedAt: null,
      },
    },
  };
}

describe("House summary cadence evaluator fixture", () => {
  it("keeps baseline narration-free and holds canonical authority constant", async () => {
    const baseline = await captureBaselineFixture(FIXTURE_GAME_ID);
    const candidate = await runCandidateFixture(FIXTURE_GAME_ID, new TemplateHouseInterviewer());

    expect(baseline.contexts.length).toBeGreaterThan(0);
    expect(baseline.contexts.flatMap((context) => context.evidence.recentTranscript).some(
      (entry) => entry.dialogueKind === "house_summary",
    )).toBe(false);
    expect(candidate.attempts.length).toBeGreaterThan(baseline.contexts.length);
    expect(candidate.authorityFingerprint).toBe(baseline.authorityFingerprint);
    expect(baseline.contexts.every((context) => context.gameId === FIXTURE_GAME_ID)).toBe(true);
    expect(candidate.attempts.every((attempt) => attempt.context.frontier.boundary.gameId === FIXTURE_GAME_ID))
      .toBe(true);
    expect(candidate.receipts.filter((receipt) => receipt.status === "preflight_skipped").every(
      (receipt) => receipt.providerCalls === 0,
    )).toBe(true);

    const phases = candidate.attempts.map((attempt) => evaluatePhase(
      attempt,
      candidate.receipts.find((receipt) => receipt.boundaryId === attempt.result.boundary.id) ?? null,
    ));
    expect(phases.every((phase) => phase.selectedSourcesSupported && phase.freshBoundarySupport)).toBe(true);
    expect(phases.find((phase) => phase.context.frontier.boundary.actorCoordinate === "introduction")?.specific)
      .toBe(true);
    expect(phases.find((phase) => phase.context.frontier.boundary.actorCoordinate === "lobby")?.specific)
      .toBe(false);
    expect(continuityEvidence(phases)).toMatchObject({
      continuityBreaksDetected: false,
      continuityCoverageRate: 1,
    });
    expect(repetitionEvidence(phases).automaticRepetitionDetected).toBe(true);
  });

  it("uses canonical game identity to isolate repeated evaluator prompt prefixes", async () => {
    const firstGameId = "00000000-0000-4000-8000-000000000301";
    const secondGameId = "00000000-0000-4000-8000-000000000302";
    const first = await captureBaselineFixture(firstGameId);
    const second = await captureBaselineFixture(secondGameId);
    const house = new LLMHouseInterviewer({} as OpenAI, "gpt-5.6-luna");
    const instruction = "Generate a concise, watchable 3-5 sentence House MC summary for the audience.";
    const firstPrompt = house.renderGameplaySummaryPrompt(first.contexts[0]!, instruction);
    const secondPrompt = house.renderGameplaySummaryPrompt(second.contexts[0]!, instruction);

    expect(firstPrompt).toContain(`Game: ${firstGameId}`);
    expect(secondPrompt).toContain(`Game: ${secondGameId}`);
    expect(firstPrompt).not.toBe(secondPrompt);
    expect(firstPrompt).not.toContain("00000000-0000-4000-8000-000000000100");
    expect(secondPrompt).not.toContain("00000000-0000-4000-8000-000000000100");
  });

  it("replays the exact removed-production round-only request shape", () => {
    expect(buildRoundOnlyBaselineRequest("captured round-only prompt")).toEqual({
      model: "gpt-5.6-luna",
      messages: [
        {
          role: "system",
          content: "You are the House MC — omniscient, dramatic reality TV narrator. Return JSON only.",
        },
        { role: "user", content: "captured round-only prompt" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "house_mc_summary",
          schema: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      max_completion_tokens: 5_600,
      reasoning_effort: "low",
    });
  });

  it("requires claim-level support instead of accepting a selected player's name", async () => {
    const candidate = await runCandidateFixture(FIXTURE_GAME_ID, new TemplateHouseInterviewer());
    const attempt = candidate.attempts.find(
      (item) => item.context.frontier.boundary.actorCoordinate === "format_pick",
    );
    if (!attempt || attempt.result.status !== "emitted") throw new Error("Expected an emitted format_pick fixture beat.");
    const emittedResult = attempt.result;
    const receipt = candidate.receipts.find(
      (item) => item.boundaryId === emittedResult.boundary.id,
    ) ?? null;
    const evaluateSummary = (summary: string) => evaluatePhase({
      context: attempt.context,
      result: { ...emittedResult, summary },
    }, receipt);

    expect(evaluateSummary("Ada remains under pressure.").phaseSpecific).toBe(false);
    expect(evaluateSummary("Ada faces a consequential choice.").phaseSpecific).toBe(false);
    expect(evaluateSummary("Ada rejected Vote Bomb in public.").phaseSpecific).toBe(false);
    expect(evaluateSummary("Ada locked Vote Bomb, putting every promise under pressure.").phaseSpecific).toBe(true);
    expect(evaluateSummary("Ada chooses Vote Bomb, putting every promise under pressure.").phaseSpecific).toBe(true);
  });

  it("accepts exact alive-count projection claims without reopening name-only support", async () => {
    const candidate = await runCandidateFixture(FIXTURE_GAME_ID, new TemplateHouseInterviewer());
    const attempt = candidate.attempts.find((item) => (
      item.context.frontier.boundary.actorCoordinate === "format_mingle"
      && item.context.frontier.boundary.round === 2
    ));
    if (!attempt || attempt.result.status !== "emitted") throw new Error("Expected an emitted round-two format_mingle beat.");
    const emittedResult = attempt.result;
    const receipt = candidate.receipts.find((item) => item.boundaryId === emittedResult.boundary.id) ?? null;
    const evaluateSummary = (summary: string) => evaluatePhase({
      context: attempt.context,
      result: { ...emittedResult, summary },
    }, receipt);

    expect(evaluateSummary("Blair’s Vote Bomb is locked in; five players remain in the game.").phaseSpecific)
      .toBe(true);
    expect(evaluateSummary("Blair’s Vote Bomb is locked in; all five players are still in.").phaseSpecific)
      .toBe(true);
    expect(evaluateSummary("Blair remains under pressure.").phaseSpecific).toBe(false);
    expect(evaluateSummary("Five relationships remain unsettled.").phaseSpecific).toBe(false);
  });

  it("supports a sourced two-finalist closing synthesis but rejects a generic collective claim", async () => {
    const candidate = await runCandidateFixture(FIXTURE_GAME_ID, new TemplateHouseInterviewer());
    const attempt = candidate.attempts.find(
      (item) => item.context.frontier.boundary.actorCoordinate === "judgment_closing",
    );
    if (!attempt || attempt.result.status !== "emitted") throw new Error("Expected an emitted judgment_closing beat.");
    const selectedFacts = attempt.context.frontier.factStore.audience_dialogue_quotes;
    expect(selectedFacts).toHaveLength(2);
    const result = {
      ...attempt.result,
      sourceAliases: selectedFacts.map((fact) => fact.alias),
      sources: selectedFacts.map((fact) => fact.source),
    };
    const receipt = candidate.receipts.find((item) => item.boundaryId === result.boundary.id) ?? null;
    const evaluateSummary = (summary: string) => evaluatePhase({
      context: attempt.context,
      result: { ...result, summary },
    }, receipt);

    expect(evaluateSummary(
      "Both finalists deliver the same closing pitch: strategic play paired with honesty and attention to relationships.",
    ).phaseSpecific).toBe(true);
    expect(evaluateSummary("Both finalists spoke.").phaseSpecific).toBe(false);
  });

  it("reconciles a delegate emission to the runner's rejected publication receipt", async () => {
    const candidate = await runCandidateFixture(FIXTURE_GAME_ID, new RunnerRejectedHouse());
    const attempt = candidate.attempts.find(
      (item) => item.context.frontier.boundary.actorCoordinate === "format_pick",
    );
    const receipt = candidate.receipts.find(
      (item) => item.actorCoordinate === "format_pick",
    );

    expect(receipt).toMatchObject({ status: "failed", providerCalls: 1 });
    expect(attempt?.result).toMatchObject({
      status: "failed",
      reason: "runtime_publication_failed",
      providerCalls: 1,
    });
    expect(attempt?.result).not.toHaveProperty("summary");
  });

  it("reports the exact coordinate and prose pair at maximum word overlap", () => {
    const firstSummary = "Ada now controls the format, choosing between a vote bomb and a save-or-eliminate twist.";
    const secondSummary = "Blair now controls the format menu, choosing between a vote bomb and a save-or-eliminate twist.";
    const maximum = maximumSummaryJaccardPair([
      {
        actorCoordinate: "format_menu",
        boundaryId: "house-beat/v1:1:format_menu:10:20",
        round: 1,
        summary: firstSummary,
      },
      {
        actorCoordinate: "format_menu",
        boundaryId: "house-beat/v1:2:format_menu:30:70",
        round: 2,
        summary: secondSummary,
      },
      {
        actorCoordinate: "judgment_jury_vote",
        boundaryId: "house-beat/v1:4:judgment_jury_vote:80:190",
        round: 4,
        summary: "The jury crowns Cleo after a decisive final vote.",
      },
    ]);

    expect(maximum).toMatchObject({
      left: { actorCoordinate: "format_menu", round: 1, summary: firstSummary },
      right: { actorCoordinate: "format_menu", round: 2, summary: secondSummary },
    });
    expect(maximum?.score).toBeGreaterThanOrEqual(0.82);
  });

  it("keeps every manual quality signal fail-closed", () => {
    const pending = {
      unsupportedAliasesDetected: false,
      canonicalContradictionsDetected: null,
      continuityBreaksDetected: false,
      repetitiveOrLowValueOrdinaryBeatsDetected: null,
      milestoneRegressionDetected: null,
      pacingHarmDetected: null,
      qualityReviewed: false,
      reviewer: null,
      reviewedAt: null,
    } as const;
    expect(reviewedQualitySignalsPass(pending)).toBe(false);
    expect(reviewedQualitySignalsPass({
      ...pending,
      canonicalContradictionsDetected: false,
      repetitiveOrLowValueOrdinaryBeatsDetected: false,
      milestoneRegressionDetected: false,
      pacingHarmDetected: false,
      qualityReviewed: true,
      reviewer: "producer",
      reviewedAt: "2026-08-20T00:00:00.000Z",
    })).toBe(true);
    expect(reviewedQualitySignalsPass({
      ...pending,
      canonicalContradictionsDetected: true,
      repetitiveOrLowValueOrdinaryBeatsDetected: false,
      milestoneRegressionDetected: false,
      pacingHarmDetected: false,
      qualityReviewed: true,
      reviewer: "producer",
      reviewedAt: "2026-08-20T00:00:00.000Z",
    })).toBe(false);
  });

  it("never manufactures an all-clear offline quality attestation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "house-summary-attestation-"));
    const pendingPath = join(directory, "pending.json");
    const adversePath = join(directory, "adverse.json");
    const adverseOutputPath = join(directory, "adverse-attested.json");
    const clearPath = join(directory, "clear.json");
    const clearOutputPath = join(directory, "clear-attested.json");
    const reviewedAt = "2026-08-20T00:00:00.000Z";
    try {
      await Bun.write(pendingPath, JSON.stringify(savedFullReport({
        canonicalContradictionsDetected: null,
        repetitiveOrLowValueOrdinaryBeatsDetected: null,
        milestoneRegressionDetected: null,
        pacingHarmDetected: null,
      })));
      await expect(attestSavedReport(pendingPath, null, {
        qualityReviewed: true,
        reviewer: "producer",
        reviewedAt,
        emitStdout: false,
      })).rejects.toThrow("pending values cannot be attested");

      await Bun.write(adversePath, JSON.stringify(savedFullReport({
        canonicalContradictionsDetected: true,
        repetitiveOrLowValueOrdinaryBeatsDetected: false,
        milestoneRegressionDetected: false,
        pacingHarmDetected: false,
      })));
      expect(await attestSavedReport(adversePath, adverseOutputPath, {
        qualityReviewed: true,
        reviewer: "producer",
        reviewedAt,
        emitStdout: false,
      })).toBe(false);
      expect(await Bun.file(adverseOutputPath).json()).toMatchObject({
        verdict: {
          fullGatePassed: false,
          qualitySignals: {
            canonicalContradictionsDetected: true,
            qualityReviewed: true,
            reviewer: "producer",
            reviewedAt,
          },
        },
      });

      await Bun.write(clearPath, JSON.stringify(savedFullReport({
        canonicalContradictionsDetected: false,
        repetitiveOrLowValueOrdinaryBeatsDetected: false,
        milestoneRegressionDetected: false,
        pacingHarmDetected: false,
      })));
      expect(await attestSavedReport(clearPath, clearOutputPath, {
        qualityReviewed: true,
        reviewer: "producer",
        reviewedAt,
        emitStdout: false,
      })).toBe(true);
      expect(await Bun.file(clearOutputPath).json()).toMatchObject({
        verdict: {
          fullGatePassed: true,
          qualitySignals: {
            canonicalContradictionsDetected: false,
            qualityReviewed: true,
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
