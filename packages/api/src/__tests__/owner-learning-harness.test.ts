import { describe, expect, test } from "bun:test";
import {
  ownerLearningIssuedEvidenceRefs,
  type OwnerLearningEvidenceProjection,
} from "../services/owner-learning-evidence.js";
import type { OwnerLearningCheckpoint } from "../services/owner-learning-contracts.js";
import { runOwnerLearningHarness } from "../services/owner-learning-harness.js";

describe("owner learning bounded harness", () => {
  test("completes a scan plus three targeted dives inside four logical calls", async () => {
    const evidence = harnessEvidence("evidence_rich", 3);
    const refs = ownerLearningIssuedEvidenceRefs(evidence.games);
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
            selectedMomentIds: evidence.games.map((game) => game.candidateMoments[0]!.id),
          };
        }
        if (input.ordinal < 4) {
          return {
            provisionalThemes: ["agenda control"],
            selectedMomentIds: [],
            findings: [{
              evidenceRefs: [refs[input.ordinal - 1]!],
              observation: `Observed moment ${input.ordinal - 1}`,
              interpretation: "The agent waited for another player to set the target.",
            }],
          };
        }
        return {
          provisionalThemes: ["agenda control"],
          selectedMomentIds: [],
          finalResult: {
            diagnosis: "The agent gives away voting initiative.",
            analysisTrack: "evidence_rich",
            recommendations: [{
              title: "Name the first target",
              disposition: "change",
              confidence: "medium",
              rationale: "The cited moments show repeated hesitation.",
              evidenceRefs: refs.slice(0, 2),
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
    expect(result.proposalFingerprint).toMatch(/^sha256:/);
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
          selectedMomentIds: [],
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

  test("rejects invented moments and evidence refs", async () => {
    const evidence = harnessEvidence("evidence_rich", 1);
    await expect(runOwnerLearningHarness({
      reviewId: "review-invented",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Stay flexible.",
      evidence,
      async invoke() {
        return { provisionalThemes: [], selectedMomentIds: ["olm_invented"] };
      },
    })).rejects.toThrow("unknown moment ID");
  });

  test("enforces the Strategy Health Check proof contract", async () => {
    const evidence = harnessEvidence("strategy_health_check", 3);
    const refs = ownerLearningIssuedEvidenceRefs(evidence.games);
    await expect(runOwnerLearningHarness({
      reviewId: "review-health",
      analysisTrack: "strategy_health_check",
      currentStrategyStyle: "Build trust.",
      evidence,
      async invoke() {
        return {
          provisionalThemes: [],
          selectedMomentIds: [],
          finalResult: {
            diagnosis: "The agent exited early in all selected games.",
            analysisTrack: "strategy_health_check",
            strategyHealthClassification: "guidance_gap",
            recommendations: [{
              title: "Clarify the vote plan",
              disposition: "change",
              confidence: "medium",
              rationale: "The guidance lacks a contingency.",
              evidenceRefs: refs.slice(0, 2),
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
    const refs = ownerLearningIssuedEvidenceRefs(evidence.games);
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
            selectedMomentIds: evidence.games.map((game) => game.candidateMoments[0]!.id),
          };
        }
        if (input.ordinal === 2) {
          return {
            provisionalThemes: ["voting initiative"],
            selectedMomentIds: [],
            findings: [{
              evidenceRefs: [refs[1]!],
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

    const resumedMoment: { id: string | null } = { id: null };
    const resumed = await runOwnerLearningHarness({
      reviewId: "review-resume",
      analysisTrack: "evidence_rich",
      currentStrategyStyle: "Build trust.",
      evidence,
      checkpoint: savedCheckpoint,
      logicalCallCount: 3,
      diveCount: 2,
      async invoke(input) {
        resumedMoment.id = (input.request.momentBundle as { moment: { id: string } }).moment.id;
        return {
          provisionalThemes: ["voting initiative"],
          selectedMomentIds: [],
          finalResult: {
            diagnosis: "The agent cedes voting initiative.",
            analysisTrack: "evidence_rich",
            recommendations: [],
            noChange: { rationale: "The current guidance already prioritizes initiative." },
          },
        };
      },
    });
    expect(resumedMoment.id).toBe(evidence.games[1]!.candidateMoments[0]!.id);
    expect(resumed.logicalCallsUsed).toBe(4);
    expect(resumed.divesUsed).toBe(3);
  });
});

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
