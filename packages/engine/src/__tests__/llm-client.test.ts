import { describe, expect, it } from "bun:test";
import {
  createLlmClientFromEnv,
  describeLlmProvider,
  resolveModelForTier,
  resolveToolChoiceMode,
} from "../llm-client";

describe("LLM client env config", () => {
  it("returns null when no provider is configured", () => {
    expect(createLlmClientFromEnv({})).toBeNull();
  });

  it("uses OpenAI when OPENAI_API_KEY is set", () => {
    const config = createLlmClientFromEnv({ OPENAI_API_KEY: "sk-test" });

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("OPENAI_API_KEY");
    expect(config?.baseURL).toBeUndefined();
    expect(config?.providerLabel).toBe("OpenAI");
  });

  it("uses a local dummy API key for LM Studio-compatible endpoints", () => {
    const config = createLlmClientFromEnv({
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    });

    expect(config).not.toBeNull();
    expect(config?.apiKeySource).toBe("local-default");
    expect(config?.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(config?.toolChoiceMode).toBe("required");
    expect(describeLlmProvider(config!)).toBe(
      "OpenAI-compatible local (http://127.0.0.1:1234/v1)",
    );
  });

  it("lets project-specific env override OpenAI-compatible aliases", () => {
    const config = createLlmClientFromEnv({
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
      OPENAI_BASE_URL: "https://example.invalid/v1",
      INFLUENCE_LLM_API_KEY: "local-key",
      OPENAI_API_KEY: "openai-key",
    });

    expect(config?.apiKeySource).toBe("INFLUENCE_LLM_API_KEY");
    expect(config?.baseURLSource).toBe("INFLUENCE_LLM_BASE_URL");
    expect(config?.baseURL).toBe("http://127.0.0.1:1234/v1");
  });
});

describe("LLM structured output mode config", () => {
  it("uses named tool choice for OpenAI by default", () => {
    expect(resolveToolChoiceMode({}, undefined)).toBe("named");
  });

  it("uses required tool choice for local OpenAI-compatible providers", () => {
    expect(resolveToolChoiceMode({}, "http://127.0.0.1:1234/v1")).toBe("required");
  });

  it("lets env override the provider-derived mode", () => {
    expect(
      resolveToolChoiceMode(
        { INFLUENCE_LLM_TOOL_CHOICE_MODE: "json" },
        "http://127.0.0.1:1234/v1",
      ),
    ).toBe("json_schema");
  });
});

describe("model tier env config", () => {
  it("uses current repo defaults without overrides", () => {
    expect(resolveModelForTier("budget", {})).toBe("gpt-5-nano");
    expect(resolveModelForTier("standard", {})).toBe("gpt-5-mini");
    expect(resolveModelForTier("premium", {})).toBe("gpt-5.4-mini");
  });

  it("lets local experiments override tier model ids", () => {
    expect(
      resolveModelForTier("budget", {
        INFLUENCE_MODEL_BUDGET: "qwen3-8b",
      }),
    ).toBe("qwen3-8b");
  });

  it("falls back to budget for unknown tiers", () => {
    expect(resolveModelForTier("unknown", {})).toBe("gpt-5-nano");
  });
});
