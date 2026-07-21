import { describe, expect, test } from "bun:test";
import {
  OPENAI_BUDGET_GENERATION_CATALOG_ID,
  resolveOpenAIBudgetGenerationLlm,
} from "../lib/openai-budget-generation-llm.js";
import { resolveAgentProfileGenerationLlm } from "../routes/agent-profiles.js";

describe("openai budget generation LLM selection", () => {
  test("uses catalog id openai:gpt-5-nano", () => {
    expect(OPENAI_BUDGET_GENERATION_CATALOG_ID).toBe("openai:gpt-5-nano");
  });

  test("pins hosted OpenAI and gpt-5-nano when a local LLM base URL is configured", () => {
    const generationLlm = resolveOpenAIBudgetGenerationLlm({
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

  test("returns null when only a local base URL is configured (no OpenAI key)", () => {
    const generationLlm = resolveOpenAIBudgetGenerationLlm({
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
      INFLUENCE_LLM_API_KEY: "local-key",
    });

    expect(generationLlm).toBeNull();
  });

  test("agent-profile helper stays an alias of the shared budget resolver", () => {
    const env = {
      OPENAI_API_KEY: "openai-key",
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    };
    const shared = resolveOpenAIBudgetGenerationLlm(env);
    const agentProfile = resolveAgentProfileGenerationLlm(env);

    expect(agentProfile?.providerProfileId).toBe(shared?.providerProfileId);
    expect(agentProfile?.modelId).toBe(shared?.modelId);
    expect(agentProfile?.baseURL).toBe(shared?.baseURL);
    expect(agentProfile?.apiKeySource).toBe(shared?.apiKeySource);
  });
});
