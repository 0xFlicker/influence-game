import { describe, expect, test } from "bun:test";
import {
  resolveAgentProfileGenerationLlm,
  resolveGeneratedAgentGender,
} from "../routes/agent-profiles.js";

describe("agent profile generation LLM selection", () => {
  test("pins hosted OpenAI and gpt-5-nano when a local LLM base URL is configured", () => {
    const generationLlm = resolveAgentProfileGenerationLlm({
      OPENAI_API_KEY: "openai-key",
      INFLUENCE_LLM_API_KEY: "local-key",
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    });

    expect(generationLlm).not.toBeNull();
    expect(generationLlm?.providerProfileId).toBe("openai");
    expect(generationLlm?.baseURL).toBeUndefined();
    expect(generationLlm?.apiKeySource).toBe("OPENAI_API_KEY");
    expect(generationLlm?.modelId).toBe("gpt-5-nano");
  });
});

describe("generated agent gender", () => {
  test("uses the structured gender returned by the model", () => {
    expect(resolveGeneratedAgentGender({
      gender: "non-binary",
      personality: "They are a patient negotiator.",
    })).toBe("non-binary");
  });

  test("keeps a player-selected gender even if model output conflicts", () => {
    expect(resolveGeneratedAgentGender({
      gender: "male",
      personality: "He is a patient negotiator.",
    }, "female")).toBe("female");
  });

  test("recovers gender from pronouns when a provider ignores the structured field", () => {
    expect(resolveGeneratedAgentGender({
      personality: "She speaks with a measured cadence and trusts her instincts.",
      strategyStyle: "She builds durable coalitions.",
    })).toBe("female");
    expect(resolveGeneratedAgentGender({
      backstory: "He learned diplomacy from his grandfather.",
      personality: "His humor disarms rivals.",
    })).toBe("male");
  });
});
