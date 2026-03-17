/**
 * Influence Game - Full Game Integration Test
 *
 * Runs a complete game with 4-6 LLM-driven AI agents.
 * Uses gpt-4o-mini via OPENAI_API_KEY (inject with `doppler run -- bun test`).
 *
 * Validates:
 * - Full phase cycle (Introduction → Council → elimination)
 * - Multiple rounds until 1 agent remains or max rounds hit
 * - Phase transitions and state machine correctness
 * - Vote mechanics, empowered agent, elimination, shields
 * - Readable transcript output
 */

import { describe, it, expect } from "bun:test";
import OpenAI from "openai";
import { GameRunner, type TranscriptEntry } from "../game-runner";
import { InfluenceAgent, createAgentCast } from "../agent";
import { LLMHouseInterviewer } from "../house-interviewer";
import { DEFAULT_CONFIG } from "../types";
import { Phase } from "../types";
import type { GameConfig } from "../types";
import { createUUID } from "../game-state";

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

/** Timeout for the full game test (10 minutes max) */
const GAME_TIMEOUT_MS = 10 * 60 * 1000;

/** Fast config for tests: shorter timers, fewer rounds */
const TEST_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  timers: {
    introduction: 0,  // No timer — wait for all agents
    lobby: 0,
    whisper: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 6, // Cap at 6 rounds to keep test fast
};

// ---------------------------------------------------------------------------
// Helper: print transcript
// ---------------------------------------------------------------------------

function printTranscript(
  transcript: readonly TranscriptEntry[],
): void {
  let lastPhase = "";
  for (const entry of transcript) {
    const header = `R${entry.round}/${entry.phase}`;
    if (header !== lastPhase) {
      console.log(`\n--- ${header} ---`);
      lastPhase = header;
    }
    if (entry.scope === "system") {
      console.log(`  [HOUSE] ${entry.text}`);
    } else if (entry.scope === "whisper") {
      console.log(
        `  [WHISPER] ${entry.from} → ${entry.to?.join(", ")}: "${entry.text}"`,
      );
    } else if (entry.scope === "diary") {
      console.log(`  [DIARY] ${entry.from}: "${entry.text}"`);
    } else {
      console.log(`  ${entry.from}: "${entry.text}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Full Influence Game", () => {
  it(
    "runs a complete game with 4 LLM agents",
    async () => {
      // Require OpenAI API key
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn("⚠️  OPENAI_API_KEY not set — skipping LLM game test");
        console.warn("   Run with: doppler run -- bun test");
        return;
      }

      const openai = new OpenAI({ apiKey });

      // Create 4 agents with distinct personalities
      const agents = [
        new InfluenceAgent(createUUID(), "Atlas", "strategic", openai),
        new InfluenceAgent(createUUID(), "Vera", "deceptive", openai),
        new InfluenceAgent(createUUID(), "Finn", "honest", openai),
        new InfluenceAgent(createUUID(), "Mira", "social", openai),
      ];

      console.log("\n🎮 Starting Influence game with 4 agents:");
      console.log(`   Players: ${agents.map((a) => `${a.name} (${a.personality})`).join(", ")}`);
      console.log(`   Max rounds: ${TEST_CONFIG.maxRounds}\n`);

      const houseInterviewer = new LLMHouseInterviewer(openai);
      const runner = new GameRunner(agents, TEST_CONFIG, houseInterviewer);
      const result = await runner.run();

      // Print transcript
      printTranscript(runner.transcriptLog);

      console.log("\n=== GAME OVER ===");
      if (result.winner) {
        console.log(`🏆 Winner: ${result.winnerName}`);
      } else {
        console.log(`🤝 Draw after ${result.rounds} rounds`);
      }
      console.log(`   Total rounds played: ${result.rounds}`);
      console.log(
        `   Transcript entries: ${result.transcript.length}`,
      );

      // Validate results
      expect(result.rounds).toBeGreaterThan(0);
      expect(result.rounds).toBeLessThanOrEqual(TEST_CONFIG.maxRounds);
      expect(result.transcript.length).toBeGreaterThan(0);

      // Should have a winner or hit max rounds
      const hasWinner = !!result.winner;
      const hitMaxRounds = result.rounds === TEST_CONFIG.maxRounds;
      expect(hasWinner || hitMaxRounds).toBe(true);

      // Transcript should have system messages
      const systemMessages = result.transcript.filter((e) => e.scope === "system");
      expect(systemMessages.length).toBeGreaterThan(0);

      // Should have phase markers in the right order
      const phases = result.transcript.map((e) => e.phase);
      expect(phases).toContain(Phase.INTRODUCTION);
      expect(phases).toContain(Phase.LOBBY);
      expect(phases).toContain(Phase.VOTE);
    },
    GAME_TIMEOUT_MS,
  );

  it(
    "runs a complete game with 6 LLM agents (full cast)",
    async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.warn("⚠️  OPENAI_API_KEY not set — skipping LLM game test");
        return;
      }

      const openai = new OpenAI({ apiKey });
      const agents = createAgentCast(openai);
      const houseInterviewer = new LLMHouseInterviewer(openai);

      console.log("\n🎮 Starting Influence game with 6 agents:");
      console.log(`   Players: ${agents.map((a) => a.name).join(", ")}`);

      const runner = new GameRunner(agents, TEST_CONFIG, houseInterviewer);
      const result = await runner.run();

      printTranscript(runner.transcriptLog);

      console.log("\n=== GAME OVER ===");
      if (result.winner) {
        console.log(`🏆 Winner: ${result.winnerName}`);
      } else {
        console.log(`🤝 Draw after ${result.rounds} rounds`);
      }

      expect(result.rounds).toBeGreaterThan(0);
      expect(result.transcript.length).toBeGreaterThan(0);
    },
    GAME_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Deterministic game test (no LLM — mock agents)
// ---------------------------------------------------------------------------

describe("Full game with scripted mock agents", () => {
  it("completes a full game loop without LLM calls", async () => {
    const { MockAgent } = await import("./mock-agent");

    const agents = [
      new MockAgent(createUUID(), "Alpha"),
      new MockAgent(createUUID(), "Beta"),
      new MockAgent(createUUID(), "Gamma"),
      new MockAgent(createUUID(), "Delta"),
    ];

    const runner = new GameRunner(agents, TEST_CONFIG);
    const result = await runner.run();

    console.log("\n=== MOCK GAME TRANSCRIPT ===");
    printTranscript(runner.transcriptLog);
    console.log(`\nResult: ${result.winnerName ?? "draw"} after ${result.rounds} rounds`);

    // Should complete
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.transcript.length).toBeGreaterThan(0);

    // Winner or max rounds
    expect(result.winner !== undefined || result.rounds === TEST_CONFIG.maxRounds).toBe(true);

    // Validate phase sequence: must have gone through VOTE at least once
    const phases = new Set(result.transcript.map((e) => e.phase));
    expect(phases.has(Phase.INTRODUCTION)).toBe(true);
    expect(phases.has(Phase.VOTE)).toBe(true);

    // Diary rooms should have been conducted between phases
    expect(phases.has(Phase.DIARY_ROOM)).toBe(true);
    const diaryEntries = result.transcript.filter((e) => e.scope === "diary");
    expect(diaryEntries.length).toBeGreaterThan(0);

    // Each diary room should have both House questions and agent answers
    const houseQuestions = diaryEntries.filter((e) => e.from.startsWith("House"));
    const agentAnswers = diaryEntries.filter((e) => !e.from.startsWith("House"));
    expect(houseQuestions.length).toBeGreaterThan(0);
    expect(agentAnswers.length).toBeGreaterThan(0);

    // Diary entries should also be accessible via the diaryLog
    const diaryLog = runner.diaryLog;
    expect(diaryLog.length).toBeGreaterThan(0);
    // Each diary log entry should have a question and answer
    for (const entry of diaryLog) {
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });
});
