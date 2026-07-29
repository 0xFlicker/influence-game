import { describe, expect, it } from "bun:test";
import {
  comparePromptScenarioReports,
  runPromptScenario,
  type PromptScenario,
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
});
