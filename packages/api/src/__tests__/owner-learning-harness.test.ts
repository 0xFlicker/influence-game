import { describe, expect, test } from "bun:test";
import {
  ownerLearningIssuedEvidenceRefs,
  type OwnerLearningEvidenceProjection,
} from "../services/owner-learning-evidence.js";
import type { OwnerLearningCheckpoint } from "../services/owner-learning-contracts.js";
import {
  OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA,
  OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA,
  runOwnerLearningHarness,
} from "../services/owner-learning-harness.js";

describe("owner learning bounded harness", () => {
  test("emits explicitly typed enum and const leaves for strict provider schemas", () => {
    expect(untypedChoiceSchemaPaths(OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA)).toEqual([]);
    expect(untypedChoiceSchemaPaths(OWNER_LEARNING_FINAL_HARNESS_RESPONSE_SCHEMA)).toEqual([]);
  });

  test("completes a scan plus three targeted dives inside four logical calls", async () => {
    const evidence = harnessEvidence("evidence_rich", 3);
    const invocations: Array<{ stage: string; isDive: boolean }> = [];
    const result = await runOwnerLearningHarness({
      reviewId: "review-1",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        invocations.push({ stage: input.stage, isDive: input.isDive });
        if (input.ordinal === 1) {
          return {
            provisionalThemes: ["agenda control"],
            selectedMomentHandles: providerMomentHandles(input.request),
          };
        }
        if (input.ordinal < 4) {
          return {
            provisionalThemes: ["agenda control"],
            selectedMomentHandles: [],
            findings: [{
              evidenceHandles: [providerMomentBundleHandle(input.request)],
              observation: `Observed moment ${input.ordinal - 1}`,
              interpretation: "The agent waited for another player to set the target.",
            }],
          };
        }
        return {
          provisionalThemes: ["agenda control"],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The agent gives away voting initiative.",
            analysisTrack: "evidence_rich",
            recommendations: [{
              title: "Name the first target",
              disposition: "change",
              confidence: "medium",
              rationale: "The cited moments show repeated hesitation.",
              evidenceHandles: providerSummaryHandles(input.request).slice(0, 2),
            }],
            proposal: {
              field: "strategyStyle",
              before: "Build trust.",
              after: "Build trust, then name a preferred target and one fallback.",
            },
          },
        };
      },
    });

    expect(invocations).toEqual([
      { stage: "scanning_narratives", isDive: false },
      { stage: "investigating_moments", isDive: true },
      { stage: "investigating_moments", isDive: true },
      { stage: "investigating_moments", isDive: true },
    ]);
    expect(result.logicalCallsUsed).toBe(4);
    expect(result.divesUsed).toBe(3);
    expect(result.result.recommendations[0]!.id).toMatch(/^olrec_/);
    expect(result.result.recommendations[0]!.evidenceRefs).toEqual(
      ownerLearningIssuedEvidenceRefs(evidence.games)
        .filter((ref) => ref.coordinate === "game-summary")
        .slice(0, 2),
    );
    expect(result.checkpoint.selectedMomentIds).toEqual(
      evidence.games.map((game) => game.candidateMoments[0]!.id),
    );
    expect(JSON.stringify(result)).not.toContain("g1:m");
    expect(result.proposalFingerprint).toMatch(/^sha256:/);
  });

  test("carries all accumulated findings into the fourth logical call", async () => {
    const evidence = harnessEvidence("evidence_rich", 3);
    let finalTurnFindings: Array<{ observation: string }> = [];
    const result = await runOwnerLearningHarness({
      reviewId: "review-all-findings",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        const findingHandles = input.ordinal === 1
          ? providerSummaryHandles(input.request)
          : [providerMomentBundleHandle(input.request)];
        if (input.ordinal === 4) {
          finalTurnFindings = providerTurn(input.request).validatedFindings as Array<{ observation: string }>;
          return {
            provisionalThemes: ["initiative"],
            selectedMomentHandles: [],
            findings: [],
            finalResult: {
              diagnosis: "The current guidance remains sound.",
              analysisTrack: "evidence_rich",
              recommendations: [],
              noChange: { rationale: "The accumulated evidence does not justify a strategy change." },
            },
          };
        }
        return {
          provisionalThemes: ["initiative"],
          selectedMomentHandles: input.ordinal === 1 ? providerMomentHandles(input.request) : [],
          findings: Array.from({ length: 3 }, (_, findingIndex) => ({
            evidenceHandles: [findingHandles[findingIndex % findingHandles.length]!],
            observation: `call-${input.ordinal}-finding-${findingIndex}`,
            interpretation: `interpretation-${input.ordinal}-${findingIndex}`,
          })),
          finalResult: null,
        };
      },
    });

    expect(result.logicalCallsUsed).toBe(4);
    expect(finalTurnFindings.map((finding) => finding.observation)).toEqual([
      "call-1-finding-0",
      "call-1-finding-1",
      "call-1-finding-2",
      "call-2-finding-0",
      "call-2-finding-1",
      "call-2-finding-2",
      "call-3-finding-0",
      "call-3-finding-1",
      "call-3-finding-2",
    ]);
  });

  test("allows an honest no-change result on the first call", async () => {
    const evidence = harnessEvidence("evidence_rich", 1);
    const result = await runOwnerLearningHarness({
      reviewId: "review-no-change",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Stay flexible.",
      evidence,
      async invoke() {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The current guidance fits the observed play.",
            analysisTrack: "evidence_rich",
            recommendations: [],
            noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
          },
        };
      },
    });
    expect(result.logicalCallsUsed).toBe(1);
    expect(result.result.noChange).toBeDefined();
    expect(result.proposalFingerprint).toBeNull();
  });

  test("ignores Strategy Health proof metadata on evidence-rich recommendations", async () => {
    const evidence = harnessEvidence("evidence_rich", 2);
    const result = await runOwnerLearningHarness({
      reviewId: "review-evidence-rich-proof",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The agent needs a clearer contingency.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [{
              title: "Name the fallback",
              disposition: "change",
              confidence: "medium",
              rationale: "The cited game shows the plan becoming reactive.",
              keepGuidance: null,
              evidenceHandles: [providerSummaryHandles(input.request)[0]!],
              proof: {
                kind: "combined",
                rubricCategory: null,
                observedEvidence: "One game showed reactive voting.",
                strategicInterpretation: "The guidance needs a contingency.",
                proposedGuidance: "Name a fallback target.",
                exactGuidanceTarget: "Voting contingency",
              },
            }],
            proposal: {
              field: "strategyStyle",
              before: "Build trust.",
              after: "Build trust and name a fallback target.",
            },
            noChange: null,
          },
        };
      },
    });

    expect(result.result.recommendations[0]!.proof).toBeUndefined();
    expect(result.result.proposal?.after).toBe("Build trust and name a fallback target.");
  });

  test("rejects invented moments and evidence refs", async () => {
    const evidence = harnessEvidence("evidence_rich", 1);
    await expect(runOwnerLearningHarness({
      reviewId: "review-invented",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Stay flexible.",
      evidence,
      async invoke() {
        return { provisionalThemes: [], selectedMomentHandles: ["g1:m999"] };
      },
    })).rejects.toThrow("unknown moment handle");

    await expect(runOwnerLearningHarness({
      reviewId: "review-invented-ref",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Stay flexible.",
      evidence,
      async invoke() {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          findings: [{
            evidenceHandles: ["g1:m999"],
            observation: "Invented citation.",
            interpretation: "Must be rejected.",
          }],
          finalResult: null,
        };
      },
    })).rejects.toThrow("unknown evidence handle");

    await expect(runOwnerLearningHarness({
      reviewId: "review-summary-as-moment",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Stay flexible.",
      evidence,
      async invoke(input) {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [providerSummaryHandles(input.request)[0]!],
        };
      },
    })).rejects.toThrow("non-moment evidence handle");
  });

  test("enforces the Strategy Health Check proof contract", async () => {
    const evidence = harnessEvidence("strategy_health_check", 3);
    await expect(runOwnerLearningHarness({
      reviewId: "review-health",
      analysisTrack: "strategy_health_check",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The agent exited early in all selected games.",
            analysisTrack: "strategy_health_check",
            strategyHealthClassification: "guidance_gap",
            recommendations: [{
              title: "Clarify the vote plan",
              disposition: "change",
              confidence: "medium",
              rationale: "The guidance lacks a contingency.",
              evidenceHandles: providerSummaryHandles(input.request).slice(0, 2),
              proof: {
                kind: "prompt_guidance_defect",
                observedEvidence: "The selected games show early vulnerability.",
                strategicInterpretation: "The strategy does not prioritize a voting coalition.",
                proposedGuidance: "Add a first-round target and fallback.",
                exactGuidanceTarget: "Voting plan",
              },
            }],
            proposal: {
              field: "strategyStyle",
              before: "Build trust.",
              after: "Build trust and establish a first-round target plus fallback.",
            },
          },
        };
      },
    })).rejects.toThrow("rubricCategory");
  });

  test("resumes from the last validated dive without reprocessing it", async () => {
    const evidence = harnessEvidence("evidence_rich", 3);
    const checkpointHolder: { value: OwnerLearningCheckpoint | null } = { value: null };
    let invocations = 0;
    await expect(runOwnerLearningHarness({
      reviewId: "review-resume",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        invocations += 1;
        if (input.ordinal === 1) {
          return {
            provisionalThemes: ["voting initiative"],
            selectedMomentHandles: providerMomentHandles(input.request),
          };
        }
        if (input.ordinal === 2) {
          return {
            provisionalThemes: ["voting initiative"],
            selectedMomentHandles: [],
            findings: [{
              evidenceHandles: [providerMomentBundleHandle(input.request)],
              observation: "The agent waited for a target.",
              interpretation: "The agent ceded initiative.",
            }],
          };
        }
        throw new Error("provider failed during the second dive");
      },
      async onCheckpoint(value) { checkpointHolder.value = value; },
    })).rejects.toThrow("provider failed");
    expect(invocations).toBe(3);
    expect(checkpointHolder.value?.nextMomentCursor).toBe(1);
    const savedCheckpoint = checkpointHolder.value;
    if (!savedCheckpoint) throw new Error("expected a persisted checkpoint");

    const resumedMoment: { handle: string | null } = { handle: null };
    const resumed = await runOwnerLearningHarness({
      reviewId: "review-resume",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      checkpoint: savedCheckpoint,
      logicalCallCount: 3,
      diveCount: 2,
      async invoke(input) {
        resumedMoment.handle = providerMomentBundleHandle(input.request);
        return {
          provisionalThemes: ["voting initiative"],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The agent cedes voting initiative.",
            analysisTrack: "evidence_rich",
            recommendations: [],
            noChange: { rationale: "The current guidance already prioritizes initiative." },
          },
        };
      },
    });
    expect(resumedMoment.handle).toBe("g2:m1");
    expect(resumed.logicalCallsUsed).toBe(4);
    expect(resumed.divesUsed).toBe(3);
  });

  test("requires the fourth logical call to finish the review", async () => {
    const evidence = harnessEvidence("evidence_rich", 3);
    await expect(runOwnerLearningHarness({
      reviewId: "review-final-budget",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke(input) {
        const turn = providerTurn(input.request);
        expect(turn.currentStrategyStyle).toBe("Build trust.");
        if (input.ordinal === 1) {
          return {
            provisionalThemes: ["initiative"],
            selectedMomentHandles: providerMomentHandles(input.request),
          };
        }
        expect((turn.callBudget as { finalResultRequired: boolean }).finalResultRequired)
          .toBe(input.ordinal === 4);
        expect(turn.currentStrategyStyle).toBe("Build trust.");
        if (input.ordinal === 4) {
          expect((turn.evidence as { games: Array<{ game: string }> }).games.map((game) => game.game))
            .toEqual(["g1", "g2", "g3"]);
        }
        return { provisionalThemes: ["initiative"], selectedMomentHandles: [], finalResult: null };
      },
    })).rejects.toThrow("final logical call must contain a result");
  });

  test("rejects proposal and recommendation outcomes that cannot be applied coherently", async () => {
    const evidence = harnessEvidence("evidence_rich", 1);
    const common = {
      reviewId: "review-incoherent",
      analysisTrack: "evidence_rich" as const,
      currentStrategyStyle: "Build trust.",
      evidence,
    };
    await expect(runOwnerLearningHarness({
      ...common,
      async invoke() {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "A change is proposed without a change recommendation.",
            analysisTrack: "evidence_rich",
            recommendations: [],
            proposal: {
              field: "strategyStyle",
              before: "Build trust.",
              after: "Build trust and verify one commitment.",
            },
          },
        };
      },
    })).rejects.toThrow("requires a change recommendation");

    await expect(runOwnerLearningHarness({
      ...common,
      async invoke(input) {
        return {
          provisionalThemes: [],
          selectedMomentHandles: [],
          finalResult: {
            diagnosis: "The current guidance is sufficient.",
            analysisTrack: "evidence_rich",
            recommendations: [{
              title: "Contradict the no-change outcome",
              disposition: "change",
              confidence: "medium",
              rationale: "This must not survive validation.",
              evidenceHandles: [providerSummaryHandles(input.request)[0]!],
            }],
            noChange: { rationale: "Keep the current guidance." },
          },
        };
      },
    })).rejects.toThrow("cannot contain a change recommendation");
  });
});

function untypedChoiceSchemaPaths(value: unknown, path: string[] = []): string[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const ownPaths = ("enum" in record || "const" in record) && !("type" in record)
    ? [path.join(".")]
    : [];
  return Object.entries(record).reduce<string[]>(
    (paths, [key, child]) => [...paths, ...untypedChoiceSchemaPaths(child, [...path, key])],
    ownPaths,
  );
}

function providerTurn(request: Record<string, unknown>): Record<string, unknown> {
  return request.turn as Record<string, unknown>;
}

function providerMomentHandles(request: Record<string, unknown>): string[] {
  const evidence = providerTurn(request).evidence as {
    games: Array<{ moments: Array<{ handle: string }> }>;
  };
  return evidence.games.map((game) => game.moments[0]!.handle);
}

function providerSummaryHandles(request: Record<string, unknown>): string[] {
  const evidence = providerTurn(request).evidence as {
    games: Array<{ summaryHandle: string }>;
  };
  return evidence.games.map((game) => game.summaryHandle);
}

function providerMomentBundleHandle(request: Record<string, unknown>): string {
  const bundle = providerTurn(request).momentBundle as { moment: { handle: string } };
  return bundle.moment.handle;
}

function harnessEvidence(
  analysisTrack: OwnerLearningEvidenceProjection["analysisTrack"],
  gameCount: number,
): OwnerLearningEvidenceProjection {
  const games = Array.from({ length: gameCount }, (_, index) => {
    const gameId = `game-${index + 1}`;
    const sourceHash = `sha256:${gameId}`;
    return {
      gameId,
      gameEvidenceId: `evidence-${gameId}`,
      canonicalFacts: {
        game: { id: gameId, slug: gameId, completionAt: "2026-08-04T00:00:00.000Z", roundCount: 2, playerCount: 8 },
        reviewedPlayer: { id: `player-${index}`, placement: 8, status: "eliminated" as const, won: false, eliminatedRound: 2, readableSummary: "Eliminated in round two." },
        actionsByAgent: { votesCastByRound: [], councilVotesCast: [], powersUsed: [] },
        actionsAgainstAgent: { empowerVotesReceivedByRound: [], exposeVotesReceivedByRound: [], councilVotesReceived: [], timesNominated: [], shieldsReceived: [] },
        factAvailability: { overall: "available" as const, actionsByAgent: "available" as const, actionsAgainstAgent: "available" as const },
        diagnostics: [],
      },
      narrativeGroups: [],
      narrativeCoverage: "rich" as const,
      candidateMoments: [{
        id: `olm_${gameId}`,
        gameId,
        anchorKind: "canonical_event" as const,
        sourceCoordinate: "event:1:vote.cast",
        sourceHash,
        round: 1,
        phase: "VOTE",
      }],
      sourceHash,
      sourceCaptureVersion: "postgame-v1:transcript-v1:cognition-v1",
    };
  });
  return {
    analysisTrack,
    games,
    reviewInput: {
      instructions: "Review the evidence.",
      games: games.map((game) => ({
        gameId: game.gameId,
        canonicalFacts: game.canonicalFacts,
        candidateMomentIds: game.candidateMoments.map((moment) => moment.id),
        narrativeGroups: [],
        omittedNarrativeGroupCount: 0,
      })),
    },
  };
}
