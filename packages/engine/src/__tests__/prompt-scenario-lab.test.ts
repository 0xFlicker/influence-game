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
import { ACCEPTED_SAGE_ROUND_2_SCENARIO } from "./fixtures/prompt-scenarios/sage-round-2";

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
  return {
    ...ACCEPTED_SAGE_ROUND_2_SCENARIO,
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

  it("replays the human-accepted Sage Round 2 chain through lobby and the next legal vote", async () => {
    const run = await runPromptScenarioChain(makeChainScenario());
    const { report, privatePack } = run;

    expect(report.canonicalElimination).toMatchObject({ committed: true });
    expect(report.canonicalElimination.survivorCount).toBe(10);
    expect(report.diary).toEqual({
      firstMessageAccepted: true,
      firstStrategyStatus: "accepted",
      followUpPresent: true,
      followUpStrategyStatus: "accepted",
    });
    expect(report.nextEligibleDecision).toMatchObject({
      action: "lobby",
      modelActionAccepted: true,
      strategyStatus: "no_change",
    });
    expect(report.choiceDecision).toMatchObject({
      action: "vote",
      modelActionAccepted: true,
      selectedTargetWasLiving: true,
      strategyStatus: "accepted",
    });
    expect(report.choiceDecision.legalChoiceCount).toBe(9);
    expect(report.finalStrategy).toEqual({
      lifecycle: "active",
      revision: privatePack.finalStrategy.revision,
      hasBaseline: true,
      deltaCount: 2,
      priorEpochRetained: false,
    });
    expect(privatePack.finalStrategy).toMatchObject({
      lifecycle: "active",
      baseline: expect.stringContaining("Treat Luna as a consequential"),
      deltas: [
        expect.stringContaining("Audit Riven"),
        expect.stringContaining("Treat Zara as the pivotal swing"),
      ],
    });
    expect(privatePack.canonicalEvents.some((event) => event.type === "player.eliminated")).toBe(true);
    expect(privatePack.canonicalEvents.filter((event) => event.type === "player.eliminated")).toHaveLength(2);
    expect(privatePack.providerRequests).toHaveLength(4);
    expect(privatePack.decisionTraces.map((trace) => trace.action)).toEqual(["diary", "diary", "lobby", "vote"]);
    expect(privatePack.nextLobbyResponse.message).toContain("living choices matter");
    expect(privatePack.nextVoteResponse.empowerTarget).toBe("1e846a8f-4df7-4cc4-a94e-c74452769080");
    expect(JSON.stringify(privatePack.providerRequests[2])).toContain("Audit Riven");
    expect(JSON.stringify(privatePack.providerRequests[3])).toContain("Treat Luna as a consequential");
    expect(JSON.stringify(privatePack.providerRequests[3])).toContain("Audit Riven");
    expect(JSON.stringify(privatePack.providerRequests[3])).toContain("Zara has my support for empower");
    expect(JSON.stringify(privatePack.providerRequests[3])).toContain("my provisional target is **Sage**");
    expect(JSON.stringify(privatePack.providerRequests[0])).toContain("Own Atlas as a provisional");
    expect(JSON.stringify(privatePack.providerRequests[1])).toContain("Treat Luna as a consequential");
    expect(privatePack.scenario.source).toMatchObject({
      acceptedAt: "2026-08-15",
      label: "Sage Round 2",
      game: {
        slug: "calm-cyan-frost",
        playerCount: 12,
        modelCatalogId: "openai:gpt-5.6-luna",
      },
      canonical: {
        eliminationSequence: 221,
        roundResultSequence: 223,
      },
    });

    const serializedReport = JSON.stringify(report);
    for (const privateText of [
      "Treat Luna as a consequential",
      "Audit Riven",
      "Treat Zara as the pivotal swing",
      makeChainScenario().actor.name,
      makeChainScenario().actor.id,
      makeChainScenario().source.game.id,
      makeChainScenario().source.decisions.firstDiary.decisionId,
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
    expect(run.privatePack.providerRequests).toHaveLength(4);
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
      nextLobby: {
        response: {
          ...scenario.nextLobby.response,
          strategyDelta: undefined,
          strategy: "NEXT_ACTION_REPAIR_SENTINEL: use the vote to establish the new coalition.",
        },
      },
    }));

    expect(run.report.diary).toMatchObject({
      firstStrategyStatus: "rejected",
      followUpPresent: false,
    });
    expect(run.report.nextEligibleDecision.strategyStatus).toBe("accepted");
    expect(run.privatePack.providerRequests).toHaveLength(3);
    expect(run.privatePack.nextLobbyStrategyResult).toMatchObject({
      status: "accepted",
      operation: "replace",
      state: { lifecycle: "active" },
    });
    expect(run.privatePack.finalStrategy.baseline).toContain("NEXT_ACTION_REPAIR_SENTINEL");
  });
});
