import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import { Phase } from "../types";
import { createUUID } from "../game-state";
import { TEST_GAME_CONFIG, printTranscript } from "./full-game-test-support";

describe("Full game with scripted mock agents", () => {
  it("completes a full game loop without LLM calls", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_GAME_CONFIG);
    const result = await runner.run();

    printTranscript(runner.transcriptLog);

    expect(result.rounds).toBeGreaterThan(0);
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(
      result.winner !== undefined || result.rounds === TEST_GAME_CONFIG.maxRounds,
    ).toBe(true);

    const phases = new Set(result.transcript.map((entry) => entry.phase));
    expect(phases.has(Phase.INTRODUCTION)).toBe(true);
    expect(phases.has(Phase.VOTE)).toBe(true);
    expect(phases.has(Phase.DIARY_ROOM)).toBe(true);

    const diaryEntries = result.transcript.filter((entry) => entry.scope === "diary");
    expect(diaryEntries.filter((entry) => entry.from.startsWith("House")).length)
      .toBeGreaterThan(0);
    expect(diaryEntries.filter((entry) => !entry.from.startsWith("House")).length)
      .toBeGreaterThan(0);

    expect(runner.diaryLog.length).toBeGreaterThan(0);
    for (const entry of runner.diaryLog) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });
});
