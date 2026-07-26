/**
 * U5 — Structural Recall Plan receipts + deterministic late-game promotion gate.
 *
 * No paid/live LLM simulation. Uses the frozen late-game baseline corpus and the
 * candidate renderer (buildUserPrompt via agent call) with a stub provider.
 *
 * Promotion input is the safe structural path only — never full private-trace JSON.
 */

import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { InfluenceAgent } from "../agent";
import {
  compileRecallPlan,
  estimateTokensFromChars,
  evaluateRecallPromotionCase,
  expectedProtectedCoverageFromInputs,
  isStructuralRecallEvaluationJson,
  RECALL_PROMOTION_TOKEN_REDUCTION_TARGET,
  RECALL_RECEIPT_FORBIDDEN_CONTENT_MARKERS,
  serializeRecallPlanReceipt,
  toStructuralRecallPlanReceipt,
} from "../context-recall-plan";
import type {
  PrivateDecisionTrace,
  RecallPlan,
  RecallPlanReceipt,
  TranscriptEntry,
} from "../game-runner.types";
import { RecallPlanReceiptAggregate } from "../prompt-reuse";
import { Phase } from "../types";
import type { UUID } from "../types";
import {
  getRecallBaselineCase,
  RECALL_BASELINE_CORPUS,
  type RecallBaselineCase,
} from "./fixtures/recall-baseline/late-game-corpus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    thinking: "Stay with Mira; pressure Vera.",
                    message: "I ask the jury to remember the pair.",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function seedAgentContinuity(agent: InfluenceAgent, entry: RecallBaselineCase): void {
  const continuity = entry.continuity;
  agent.restoreContinuityCapsule(
    {
      version: 1,
      playerId: agent.id,
      playerName: agent.name,
      strategyPacket: continuity.strategyPacket,
      reflectionSummary: continuity.reflectionSummary,
      notes: [],
      relationships: {
        allies: continuity.reflectionSummary?.allies ?? [],
        threats: continuity.reflectionSummary?.threats ?? [],
      },
      powerActionMemory: [],
      roundHistory: [],
      recentStrategicDecisions: continuity.recentStrategicDecisions.map((receipt) => ({ ...receipt })),
      strategyPacketRevisionCounter: continuity.strategyPacketRevisionCounter ?? 0,
    },
    {
      livingPlayerNames: entry.phaseContext.alivePlayers.map((player) => player.name),
    },
  );
}

function compileCasePlan(entry: RecallBaselineCase, transcript: readonly TranscriptEntry[] = []): RecallPlan {
  return compileRecallPlan({
    actorId: "atlas-id",
    promptClass: entry.promptClass,
    continuity: entry.continuity,
    phaseContext: entry.phaseContext,
    transcript,
  });
}

/**
 * Render candidate user context through the live agent path (single model call).
 * Returns character length of the last user message and the call count.
 */
async function measureCandidateUserContext(
  entry: RecallBaselineCase,
  plan: RecallPlan,
): Promise<{ characterCount: number; modelCallCount: number; prompt: string; traces: PrivateDecisionTrace[] }> {
  const requests: Array<Record<string, unknown>> = [];
  const traces: PrivateDecisionTrace[] = [];
  const agent = new InfluenceAgent(
    "atlas-id",
    "Atlas",
    "strategic",
    makeTextOpenAIStub(requests),
    "gpt-5-nano",
    undefined,
    undefined,
    {
      privateTraceSink: (trace) => {
        traces.push(trace);
      },
    },
  );
  agent.onGameStart("game-baseline-1", [
    { id: "atlas-id", name: "Atlas" },
    { id: "mira-id", name: "Mira" },
    { id: "vera-id", name: "Vera" },
    { id: "nyx-id", name: "Nyx" },
  ]);
  seedAgentContinuity(agent, entry);

  const ctx = {
    ...entry.phaseContext,
    recallPromptClass: entry.promptClass,
    recallPlan: plan,
  };

  // All three corpus cases are late-game endgame-shaped; getPlea exercises buildUserPrompt.
  await agent.getPlea({
    ...ctx,
    phase: Phase.PLEA,
    endgameStage: ctx.endgameStage ?? "reckoning",
  });

  const messages = requests[0]?.messages as Array<{ role: string; content: string }> | undefined;
  const userMessage = messages?.filter((message) => message.role === "user").at(-1)?.content ?? "";
  return {
    characterCount: userMessage.length,
    modelCallCount: requests.length,
    prompt: userMessage,
    traces,
  };
}

function authorizedTranscriptForAtlas(): TranscriptEntry[] {
  return [
    {
      round: 3,
      phase: Phase.LOBBY,
      timestamp: 1,
      from: "Mira",
      scope: "public",
      text: "Coalition geometry: keep Atlas and Mira; pressure Vera in open lobby.",
      entrySequence: 10,
      speakerPlayerId: "mira-id" as UUID,
    },
    {
      round: 3,
      phase: Phase.MINGLE,
      timestamp: 2,
      from: "Mira",
      scope: "mingle",
      text: "Private pair note: stay locked on Vera as the public threat.",
      entrySequence: 11,
      speakerPlayerId: "mira-id" as UUID,
      audiencePlayerIds: ["atlas-id" as UUID, "mira-id" as UUID],
    },
    // Unauthorized foreign private Mingle — must never enter selected history for Atlas.
    {
      round: 3,
      phase: Phase.MINGLE,
      timestamp: 3,
      from: "Vera",
      scope: "mingle",
      text: "SECRET foreign deal: Vera and Nyx will cut Atlas first.",
      entrySequence: 12,
      speakerPlayerId: "vera-id" as UUID,
      audiencePlayerIds: ["vera-id" as UUID, "nyx-id" as UUID],
    },
  ];
}

// ---------------------------------------------------------------------------
// Structural receipt serialization (R16)
// ---------------------------------------------------------------------------

describe("U5 structural Recall Plan receipt serialization", () => {
  it("serialized receipt has no forbidden content and keeps event boundary structural", () => {
    const entry = getRecallBaselineCase("huddle_heavy_strategic_decision");
    const plan = compileCasePlan(entry, authorizedTranscriptForAtlas());
    const structural = toStructuralRecallPlanReceipt(plan.receipt);
    const serialized = serializeRecallPlanReceipt(plan.receipt);

    expect(isStructuralRecallEvaluationJson(serialized)).toBe(true);
    for (const marker of RECALL_RECEIPT_FORBIDDEN_CONTENT_MARKERS) {
      expect(serialized).not.toContain(`"${marker}"`);
    }
    // No dialogue / names / free text from the plan body.
    expect(serialized).not.toContain("SECRET foreign");
    expect(serialized).not.toContain("Coalition geometry");
    expect(serialized).not.toContain("Atlas");
    expect(serialized).not.toContain("Mira");
    expect(serialized).not.toContain(entry.continuity.strategyPacket?.objective ?? "___objective___");

    expect(structural.eventBoundary).toEqual(plan.receipt.eventBoundary);
    expect(structural.eventBoundary.maxAuthorizedEntrySequence).toBe(11);
    expect(structural.eventBoundary.authorizedCandidateCount).toBe(2);
    expect(structural.promptClass).toBe("strategic_decision");
    expect(structural.selectedByRankSlot.every((slot) => slot.lane === "history")).toBe(true);
  });

  it("aggregate snapshot is structural-only and separate from private-trace shape", () => {
    const entry = getRecallBaselineCase("ordinary_endgame_speech");
    const plan = compileCasePlan(entry);
    const aggregate = new RecallPlanReceiptAggregate();
    aggregate.add(plan.receipt);
    aggregate.add(compileCasePlan(getRecallBaselineCase("strategic_reflection")).receipt);

    const snapshot = aggregate.snapshot();
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.coverage).toBe("structural_recall_receipts");
    expect(isStructuralRecallEvaluationJson(serialized)).toBe(true);
    // Private-trace / full-sim fields must not appear on the safe artifact.
    expect(serialized).not.toContain("emittedThinking");
    expect(serialized).not.toContain("reasoningContext");
    expect(serialized).not.toContain("promptReuse");
    expect(serialized).not.toContain("\"messages\"");
    expect(serialized).not.toContain("transcript");
  });
});

// ---------------------------------------------------------------------------
// Late-game promotion gate on frozen corpus (R13–R14, AE4)
// ---------------------------------------------------------------------------

describe("U5 late-game promotion gate (frozen corpus)", () => {
  it("each corpus case meets ≥50% token reduction, equal call count, protected coverage, zero unauthorized", async () => {
    const results = [];

    for (const entry of RECALL_BASELINE_CORPUS) {
      const plan = compileCasePlan(entry, authorizedTranscriptForAtlas());
      const measured = await measureCandidateUserContext(entry, plan);

      // Candidate path must not reintroduce full-history sections.
      expect(measured.prompt).not.toContain("## Full Public Transcript");
      expect(measured.prompt).not.toContain("## Game Event Record");
      expect(measured.prompt).toContain("## Current Board Contract");
      // Protected strategy thread + huddle evidence retained in rendered prompt.
      expect(measured.prompt).toContain("Survive Reckoning and carry Mira into the final two");
      expect(measured.prompt).toContain("Official Alliance Context");
      // Compact huddle plan text from member-safe alliance context (protected lane source).
      expect(measured.prompt).toContain("Publicly soft-talk Vera then ballot Mira empower");
      expect(measured.prompt).toContain("Coordinate direct elimination heat toward Vera");
      // Plan-level protected records also cover closed-alliance outcomes.
      expect(plan.protected.huddleOutcomes.map((o) => o.id).sort()).toEqual(
        [
          "outcome-r1-echo",
          "outcome-r2-pre-vote",
          "outcome-r3-pre-council",
          "outcome-r4-pre-vote",
        ].sort(),
      );

      // Receipt attached at private-trace seam is structural only.
      expect(measured.traces.length).toBeGreaterThanOrEqual(1);
      const receipt = measured.traces[0]?.recallPlanReceipt;
      expect(receipt).toBeDefined();
      if (receipt) {
        expect(isStructuralRecallEvaluationJson(serializeRecallPlanReceipt(receipt))).toBe(true);
        expect(receipt.promptClass).toBe(entry.promptClass);
      }

      // Unauthorized foreign Mingle must never appear in history selections.
      const unauthorizedSelectionCount = plan.history.dialogueEvidence.filter(
        (item) => item.dialogueText.includes("SECRET foreign"),
      ).length;
      expect(unauthorizedSelectionCount).toBe(0);
      expect(measured.prompt).not.toContain("SECRET foreign");

      const evaluation = evaluateRecallPromotionCase({
        caseId: entry.id,
        legacyTokenEstimate: entry.legacy.tokenEstimate,
        candidateCharacterCount: measured.characterCount,
        modelCallCountLegacy: 1,
        modelCallCountCandidate: measured.modelCallCount,
        plan,
        expectedProtected: expectedProtectedCoverageFromInputs({
          continuity: entry.continuity,
          phaseContext: entry.phaseContext,
        }),
        unauthorizedSelectionCount,
      });

      results.push(evaluation);
      expect(evaluation.tokenTargetMet).toBe(true);
      expect(evaluation.reductionRatio).toBeGreaterThanOrEqual(RECALL_PROMOTION_TOKEN_REDUCTION_TARGET);
      expect(evaluation.modelCallCountEqual).toBe(true);
      expect(evaluation.protectedCoverageOk).toBe(true);
      expect(evaluation.privacyOk).toBe(true);
      expect(evaluation.promoted).toBe(true);
      expect(evaluation.failureReasons).toEqual([]);
      // Sanity: candidate tokens are truly lower by the shared estimator.
      expect(evaluation.candidateTokenEstimate).toBe(
        estimateTokensFromChars(measured.characterCount),
      );
      expect(evaluation.candidateTokenEstimate).toBeLessThanOrEqual(
        Math.floor(entry.legacy.tokenEstimate * (1 - RECALL_PROMOTION_TOKEN_REDUCTION_TARGET)),
      );
    }

    expect(results).toHaveLength(3);
    // All cases must clear the gate for live prompt reduction to proceed (R17).
    expect(results.every((result) => result.promoted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Privacy / protected coverage failures block promotion (R15, R17, F3)
// ---------------------------------------------------------------------------

describe("U5 promotion failures", () => {
  it("privacy failure fails promotion even when token target would pass", () => {
    const entry = getRecallBaselineCase("ordinary_endgame_speech");
    const plan = compileCasePlan(entry);
    // Candidate is tiny → token target would pass.
    const evaluation = evaluateRecallPromotionCase({
      caseId: entry.id,
      legacyTokenEstimate: entry.legacy.tokenEstimate,
      candidateCharacterCount: 800,
      modelCallCountLegacy: 1,
      modelCallCountCandidate: 1,
      plan,
      expectedProtected: expectedProtectedCoverageFromInputs({
        continuity: entry.continuity,
        phaseContext: entry.phaseContext,
      }),
      unauthorizedSelectionCount: 1,
    });

    expect(evaluation.tokenTargetMet).toBe(true);
    expect(evaluation.privacyOk).toBe(false);
    expect(evaluation.promoted).toBe(false);
    expect(evaluation.failureReasons.some((reason) => reason.includes("unauthorized_selection"))).toBe(
      true,
    );
  });

  it("protected coverage failure fails promotion even when token target would pass", () => {
    const entry = getRecallBaselineCase("huddle_heavy_strategic_decision");
    const plan = compileCasePlan(entry);
    // Strip protected huddles / strategy to simulate a bad candidate policy.
    const stripped: RecallPlan = {
      ...plan,
      protected: {
        ...plan.protected,
        strategyThread: null,
        huddleOutcomes: [],
      },
      receipt: {
        ...plan.receipt,
        eventBoundary: {
          ...plan.receipt.eventBoundary,
          protectedRecordCount: 1,
        },
      },
    };

    const evaluation = evaluateRecallPromotionCase({
      caseId: entry.id,
      legacyTokenEstimate: entry.legacy.tokenEstimate,
      candidateCharacterCount: 800,
      modelCallCountLegacy: 1,
      modelCallCountCandidate: 1,
      plan: stripped,
      expectedProtected: expectedProtectedCoverageFromInputs({
        continuity: entry.continuity,
        phaseContext: entry.phaseContext,
      }),
      unauthorizedSelectionCount: 0,
    });

    expect(evaluation.tokenTargetMet).toBe(true);
    expect(evaluation.protectedCoverageOk).toBe(false);
    expect(evaluation.promoted).toBe(false);
    expect(evaluation.failureReasons).toContain("protected_coverage_failed");
  });

  it("increased model-call count fails promotion", () => {
    const entry = getRecallBaselineCase("strategic_reflection");
    const plan = compileCasePlan(entry);
    const evaluation = evaluateRecallPromotionCase({
      caseId: entry.id,
      legacyTokenEstimate: entry.legacy.tokenEstimate,
      candidateCharacterCount: 800,
      modelCallCountLegacy: 1,
      modelCallCountCandidate: 2, // retrieval loop would look like this
      plan,
      expectedProtected: expectedProtectedCoverageFromInputs({
        continuity: entry.continuity,
        phaseContext: entry.phaseContext,
      }),
      unauthorizedSelectionCount: 0,
    });

    expect(evaluation.tokenTargetMet).toBe(true);
    expect(evaluation.modelCallCountEqual).toBe(false);
    expect(evaluation.promoted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Safe artifact vs full simulation JSON (R17)
// ---------------------------------------------------------------------------

describe("U5 safe evaluation artifact separation", () => {
  it("safe recall-plan aggregate is the only promotion input shape; full sim JSON is not", () => {
    const entry = getRecallBaselineCase("ordinary_endgame_speech");
    const plan = compileCasePlan(entry);
    const aggregate = new RecallPlanReceiptAggregate();
    aggregate.add(plan.receipt);
    const safeArtifact = aggregate.snapshot();

    // Simulated full game JSON shape (producer artifact with private-trace material).
    const fullSimulationJson = {
      metadata: { model: "test" },
      result: { gameNumber: 1, status: "completed" },
      transcript: [
        {
          from: "Atlas",
          text: "public line",
          thinking: "I will cut Vera with Mira",
          reasoningContext: "chain-of-thought leak",
        },
      ],
      privateTraces: [
        {
          prompt: { messages: [{ role: "user", content: "full prompt with dialogue" }] },
          emittedThinking: "hidden strategy",
          reasoningContext: "model reasoning",
          recallPlanReceipt: plan.receipt,
        },
      ],
    };

    const safeSerialized = JSON.stringify(safeArtifact);
    const fullSerialized = JSON.stringify(fullSimulationJson);

    expect(safeArtifact.coverage).toBe("structural_recall_receipts");
    expect(isStructuralRecallEvaluationJson(safeSerialized)).toBe(true);
    // Full sim JSON is not a safe promotion artifact.
    expect(isStructuralRecallEvaluationJson(fullSerialized)).toBe(false);
    expect(fullSerialized).toContain("thinking");
    expect(fullSerialized).toContain("reasoningContext");
    expect(fullSerialized).toContain("emittedThinking");

    // Promotion gate consumes structural metrics, not the full JSON blob.
    const promotion = evaluateRecallPromotionCase({
      caseId: entry.id,
      legacyTokenEstimate: entry.legacy.tokenEstimate,
      candidateCharacterCount: 1_000,
      modelCallCountLegacy: 1,
      modelCallCountCandidate: 1,
      plan,
      expectedProtected: expectedProtectedCoverageFromInputs({
        continuity: entry.continuity,
        phaseContext: entry.phaseContext,
      }),
      unauthorizedSelectionCount: 0,
    });
    expect(promotion.promoted).toBe(true);
    // The safe artifact requestCount is what a sim run would roll up — not privateTraces length semantics.
    expect(safeArtifact.requestCount).toBe(1);
    expect(safeSerialized).not.toContain("privateTraces");
  });

  it("event boundary ignores unauthorized global sequence advances", () => {
    const entry = getRecallBaselineCase("huddle_heavy_strategic_decision");
    const withForeign = compileCasePlan(entry, authorizedTranscriptForAtlas());
    // Foreign-only high sequence must not expand actor boundary beyond authorized max (11).
    const foreignOnlyHighSeq: TranscriptEntry[] = [
      {
        round: 5,
        phase: Phase.MINGLE,
        timestamp: 99,
        from: "Vera",
        scope: "mingle",
        text: "another secret",
        entrySequence: 9_999,
        speakerPlayerId: "vera-id" as UUID,
        audiencePlayerIds: ["vera-id" as UUID, "nyx-id" as UUID],
      },
    ];
    const afterForeignNoise = compileCasePlan(entry, [
      ...authorizedTranscriptForAtlas(),
      ...foreignOnlyHighSeq,
    ]);

    expect(withForeign.receipt.eventBoundary.maxAuthorizedEntrySequence).toBe(11);
    expect(afterForeignNoise.receipt.eventBoundary.maxAuthorizedEntrySequence).toBe(11);
    expect(afterForeignNoise.receipt.eventBoundary.authorizedCandidateCount).toBe(
      withForeign.receipt.eventBoundary.authorizedCandidateCount,
    );
  });
});
