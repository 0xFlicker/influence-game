import { describe, expect, it } from "bun:test";
import {
  comparePromptScenarioReports,
  runPromptScenario,
  runPromptScenarioChain,
  type PromptScenario,
  type PromptScenarioChain,
} from "../prompt-scenario-lab";
import { Phase } from "../types";
import { getRecallBaselineCase } from "./fixtures/recall-baseline/late-game-corpus";

function makeScenario(overrides: Partial<PromptScenario> = {}): PromptScenario {
  const baseline = getRecallBaselineCase("huddle_heavy_strategic_decision");
  return {
    reportKey: "a4eaf2046f4f4a23a3a2b10b",
    comparisonKey: "e4f8f540f23a4d0e9cdd83ab",
    actor: { id: "atlas-id", name: "Atlas", personality: "strategic" },
    model: "gpt-5-nano",
    fullRoster: baseline.phaseContext.alivePlayers,
    promptClass: "strategic_decision",
    phaseContext: { ...baseline.phaseContext, phase: Phase.VOTE },
    continuity: baseline.continuity,
    transcript: [
      {
        round: 4,
        phase: Phase.LOBBY,
        timestamp: 1,
        from: "Mira",
        scope: "public",
        text: "Atlas and Mira still need a commitment before the vote.",
        entrySequence: 20,
        speakerPlayerId: "mira-id",
      },
      {
        round: 4,
        phase: Phase.MINGLE,
        timestamp: 2,
        from: "Vera",
        scope: "mingle",
        text: "SECRET foreign deal: Vera and Nyx cut Atlas.",
        entrySequence: 21,
        speakerPlayerId: "vera-id",
        audiencePlayerIds: ["vera-id", "nyx-id"],
      },
    ],
    action: {
      kind: "vote",
      response: { empower: "Mira", thinking: "Keep the known pair in the chooser seat." },
    },
    ...overrides,
  };
}

function makeChainScenario(overrides: Partial<PromptScenarioChain> = {}): PromptScenarioChain {
  const scenario = makeScenario();
  const eliminated = scenario.fullRoster.find((player) =>
    player.id !== scenario.actor.id && player.name === "Vera"
  ) ?? scenario.fullRoster.find((player) => player.id !== scenario.actor.id);
  if (!eliminated) throw new Error("Expected a non-actor player to eliminate");
  const nextTarget = scenario.fullRoster.find((player) =>
    player.id !== scenario.actor.id && player.id !== eliminated.id
  );
  if (!nextTarget) throw new Error("Expected a living next-vote target");
  return {
    reportKey: "f4eaf2046f4f4a23a3a2b10b",
    comparisonKey: "14f8f540f23a4d0e9cdd83ab",
    actor: scenario.actor,
    model: scenario.model,
    fullRoster: scenario.fullRoster,
    phaseContext: scenario.phaseContext,
    continuity: scenario.continuity,
    transcript: scenario.transcript,
    eliminatedPlayerId: eliminated.id,
    diary: {
      firstQuestion: "What changed after that eviction?",
      firstResponse: {
        message: "I need to rebuild around the living field.",
        thinking: "The old target left, so the coalition map must change.",
        strategy: "NEW_BASELINE_SENTINEL: keep Mira close and test Nyx before committing.",
      },
      followUp: {
        question: "What is your first concrete test?",
        response: {
          message: "I will ask Mira for a specific vote promise.",
          thinking: "A concrete promise distinguishes warmth from alignment.",
          strategyDelta: "FOLLOW_UP_DELTA_SENTINEL: ask Mira for one named vote promise.",
        },
      },
    },
    nextVote: {
      response: {
        empower: nextTarget.name,
        thinking: "Use the vote to reward the clearest surviving partner.",
        strategyDelta: "NEXT_VOTE_DELTA_SENTINEL: compare the promise with the revealed vote.",
      },
    },
    ...overrides,
  };
}

describe("prompt scenario lab", () => {
  it("replays a real public action path and emits only structural diagnostics", async () => {
    const report = await runPromptScenario(makeScenario());
    const serialized = JSON.stringify(report);

    expect(report.action).toBe("vote");
    expect(report.renderedPrompt.characters).toBeGreaterThan(0);
    expect(report.renderedPrompt.rendererOverheadCharacters).toBeGreaterThan(0);
    expect(report.recallPlanReceipt.eventBoundary.authorizedCandidateCount).toBe(1);
    expect(report.requestFingerprint?.requestShape).toBe("chat_completions");
    expect(report.scenarioKey).toMatch(/^[a-f0-9]{24}$/);
    expect(serialized).not.toContain("atlas-id");
    expect(serialized).not.toContain("Atlas");
    expect(serialized).not.toContain("SECRET foreign");
  });

  it("compares two replay reports without returning prompt content", async () => {
    const baseline = await runPromptScenario(makeScenario());
    const candidate = await runPromptScenario(makeScenario({ reportKey: "b4eaf2046f4f4a23a3a2b10b" }));
    const comparison = comparePromptScenarioReports(baseline, candidate);

    expect(comparison.renderedPrompt.tokenEstimateDelta).toBe(0);
    expect(comparison.renderedPrompt.rendererOverheadCharactersDelta).toBe(0);
    expect(comparison.recall.historySelectionDelta).toBe(0);
    expect(comparison.recall.protectedOverflowChanged).toBe(false);
    expect(JSON.stringify(comparison)).not.toContain("SECRET foreign");
  });

  it("keeps a foreign private transcript row out of the captured request fingerprint", async () => {
    const withForeign = await runPromptScenario(makeScenario());
    const withoutForeign = await runPromptScenario(makeScenario({
      reportKey: "d4eaf2046f4f4a23a3a2b10b",
      transcript: makeScenario().transcript.slice(0, 1),
    }));

    expect(withForeign.requestFingerprint).toEqual(withoutForeign.requestFingerprint);
    expect(withForeign.renderedPrompt).toEqual(withoutForeign.renderedPrompt);
  });

  it("can exercise an ordinary public plea without historical archive", async () => {
    const baseline = getRecallBaselineCase("ordinary_endgame_speech");
    const report = await runPromptScenario(makeScenario({
      reportKey: "c4eaf2046f4f4a23a3a2b10b",
      promptClass: "ordinary_speech",
      phaseContext: { ...baseline.phaseContext, phase: Phase.PLEA },
      continuity: baseline.continuity,
      transcript: [],
      action: {
        kind: "plea",
        response: { message: "I kept my commitments and earned another day." },
      },
    }));

    expect(report.action).toBe("plea");
    expect(report.recallPlanReceipt.promptClass).toBe("ordinary_speech");
    expect(report.recallPlanReceipt.selectedLaneCounts.history).toBe(0);
  });

  it("runs canonical eviction, diary replacement, optional refinement, and the next legal decision", async () => {
    const run = await runPromptScenarioChain(makeChainScenario());
    const { report, privatePack } = run;

    expect(report.canonicalElimination).toMatchObject({ committed: true });
    expect(report.diary).toEqual({
      firstMessageAccepted: true,
      firstStrategyStatus: "accepted",
      followUpPresent: true,
      followUpStrategyStatus: "accepted",
    });
    expect(report.nextDecision).toMatchObject({
      modelActionAccepted: true,
      selectedTargetWasLiving: true,
      strategyStatus: "accepted",
    });
    expect(report.nextDecision.legalChoiceCount).toBeGreaterThanOrEqual(2);
    expect(report.finalStrategy).toEqual({
      lifecycle: "active",
      revision: privatePack.finalStrategy.revision,
      hasBaseline: true,
      deltaCount: 2,
      priorEpochRetained: false,
    });
    expect(privatePack.finalStrategy).toMatchObject({
      lifecycle: "active",
      baseline: expect.stringContaining("NEW_BASELINE_SENTINEL"),
      deltas: [
        expect.stringContaining("FOLLOW_UP_DELTA_SENTINEL"),
        expect.stringContaining("NEXT_VOTE_DELTA_SENTINEL"),
      ],
    });
    expect(privatePack.canonicalEvents.some((event) => event.type === "player.eliminated")).toBe(true);
    expect(privatePack.providerRequests).toHaveLength(3);
    expect(privatePack.decisionTraces.map((trace) => trace.action)).toEqual(["diary", "diary", "vote"]);
    expect(JSON.stringify(privatePack.providerRequests[2])).toContain("FOLLOW_UP_DELTA_SENTINEL");
    expect(JSON.stringify(privatePack.providerRequests[2])).toContain("NEW_BASELINE_SENTINEL");

    const serializedReport = JSON.stringify(report);
    for (const privateText of [
      "NEW_BASELINE_SENTINEL",
      "FOLLOW_UP_DELTA_SENTINEL",
      "NEXT_VOTE_DELTA_SENTINEL",
      makeChainScenario().actor.name,
      makeChainScenario().actor.id,
    ]) {
      expect(serializedReport).not.toContain(privateText);
    }
  });

  it("repairs a missing first strategy through an optional follow-up without retrying", async () => {
    const scenario = makeChainScenario();
    const run = await runPromptScenarioChain(makeChainScenario({
      diary: {
        ...scenario.diary,
        firstResponse: {
          message: "The eviction changed my read, but I am still sorting it out.",
          thinking: "The visible answer remains valid even without a strategy field.",
        },
        followUp: {
          question: "So what is the repaired plan?",
          response: {
            message: "I will rebuild around Mira and test Nyx.",
            thinking: "This is the repair opportunity.",
            strategy: "FOLLOW_UP_REPAIR_SENTINEL: rebuild around Mira and test Nyx.",
          },
        },
      },
    }));

    expect(run.report.diary).toEqual({
      firstMessageAccepted: true,
      firstStrategyStatus: "rejected",
      followUpPresent: true,
      followUpStrategyStatus: "accepted",
    });
    expect(run.privatePack.firstStrategyResult).toMatchObject({
      status: "rejected",
      reason: "required_value_missing",
      state: { lifecycle: "repair_required" },
    });
    expect(run.privatePack.followUpStrategyResult).toMatchObject({
      status: "accepted",
      operation: "replace",
      state: { lifecycle: "active" },
    });
    expect(run.privatePack.providerRequests).toHaveLength(3);
    expect(run.privatePack.finalStrategy.baseline).toContain("FOLLOW_UP_REPAIR_SENTINEL");
  });

  it("repairs on the next eligible action when the optional follow-up does not occur", async () => {
    const scenario = makeChainScenario();
    const run = await runPromptScenarioChain(makeChainScenario({
      diary: {
        firstQuestion: scenario.diary.firstQuestion,
        firstResponse: {
          message: "I need another beat before I can state the new plan.",
          thinking: "The diary closes without a follow-up.",
        },
      },
      nextVote: {
        response: {
          ...scenario.nextVote.response,
          strategyDelta: undefined,
          strategy: "NEXT_ACTION_REPAIR_SENTINEL: use the vote to establish the new coalition.",
        },
      },
    }));

    expect(run.report.diary).toMatchObject({
      firstStrategyStatus: "rejected",
      followUpPresent: false,
    });
    expect(run.report.nextDecision.strategyStatus).toBe("accepted");
    expect(run.privatePack.providerRequests).toHaveLength(2);
    expect(run.privatePack.nextVoteStrategyResult).toMatchObject({
      status: "accepted",
      operation: "replace",
      state: { lifecycle: "active" },
    });
    expect(run.privatePack.finalStrategy.baseline).toContain("NEXT_ACTION_REPAIR_SENTINEL");
  });
});
