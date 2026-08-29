import { describe, expect, it } from "bun:test";
import { createAgentCast } from "../agent";
import { GameRunner } from "../game-runner";
import { LLMHouseInterviewer } from "../house-interviewer";
import { createLlmClientFromEnv } from "../llm-client";
import { DEFAULT_MODEL_ID } from "../model-defaults";
import { Phase } from "../types";
import { TEST_GAME_CONFIG, printTranscript } from "./full-game-test-support";

const GAME_TIMEOUT_MS = 90 * 60 * 1000;

function requiredProvider() {
  const provider = createLlmClientFromEnv();
  if (!provider) {
    throw new Error(
      "Live-provider full-game tests require OPENAI_API_KEY or INFLUENCE_LLM_BASE_URL.",
    );
  }
  return provider;
}

describe("Full Influence Game (live provider)", () => {
  it(
    "runs a complete game with 6 LLM agents",
    async () => {
      const llmConfig = requiredProvider();
      const model = process.env.INFLUENCE_TEST_MODEL ?? DEFAULT_MODEL_ID;
      const agents = createAgentCast(
        llmConfig.client,
        model,
        undefined,
        { toolChoiceMode: llmConfig.toolChoiceMode },
      ).slice(0, 6);
      const runner = new GameRunner(
        agents,
        TEST_GAME_CONFIG,
        new LLMHouseInterviewer(llmConfig.client, model),
      );
      const result = await runner.run();
      printTranscript(runner.transcriptLog);

      expect(result.rounds).toBeGreaterThan(0);
      expect(result.rounds).toBeLessThanOrEqual(TEST_GAME_CONFIG.maxRounds);
      expect(result.transcript.length).toBeGreaterThan(0);
      expect(
        !!result.winner || result.rounds === TEST_GAME_CONFIG.maxRounds,
      ).toBe(true);
      const phases = result.transcript.map((entry) => entry.phase);
      expect(phases).toContain(Phase.INTRODUCTION);
      expect(phases).toContain(Phase.LOBBY);
      expect(phases).toContain(Phase.VOTE);
    },
    GAME_TIMEOUT_MS,
  );

  it.skip(
    "runs a complete game with the default full cast",
    async () => {
      const llmConfig = requiredProvider();
      const model = process.env.INFLUENCE_TEST_MODEL ?? DEFAULT_MODEL_ID;
      const runner = new GameRunner(
        createAgentCast(llmConfig.client, model),
        TEST_GAME_CONFIG,
        new LLMHouseInterviewer(llmConfig.client, model),
      );
      const result = await runner.run();
      printTranscript(runner.transcriptLog);
      expect(result.rounds).toBeGreaterThan(0);
      expect(result.transcript.length).toBeGreaterThan(0);
    },
    GAME_TIMEOUT_MS,
  );
});
