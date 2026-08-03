import { describe, expect, it } from "bun:test";
import {
  MODEL_CATALOG,
  formatGameModelSelectionLabel,
  gameReadyCatalogEntries,
  inferModelCapabilities,
  modelCatalogEntryById,
  normalizeGameModelSelection,
  normalizeReasoningPolicy,
  resolveModelSelection,
} from "../model-catalog";

describe("model catalog", () => {
  it("marks grok-4-3 as the active Katana game-ready model", () => {
    const entry = modelCatalogEntryById("katana:grok-4-3");

    expect(entry?.providerProfileId).toBe("katana");
    expect(entry?.modelId).toBe("grok-4-3");
    expect(entry?.evaluationStatus).toBe("game-ready");
    expect(entry?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(entry?.capabilities.supportsReasoningEffort).toBe(true);
    expect(entry?.capabilities.usesMaxCompletionTokens).toBe(false);
    expect(entry?.capabilities.supportsOpenAIResponses).toBe(false);
  });

  it("lists openai:gpt-5.4-nano as game-ready with GPT-5.4 capabilities", () => {
    const entry = modelCatalogEntryById("openai:gpt-5.4-nano");
    const gameReadyIds = gameReadyCatalogEntries().map((item) => item.id);

    expect(entry?.providerProfileId).toBe("openai");
    expect(entry?.modelId).toBe("gpt-5.4-nano");
    expect(entry?.evaluationStatus).toBe("game-ready");
    expect(entry?.capabilities.supportsReasoningEffort).toBe(true);
    expect(entry?.capabilities.supportsToolReasoningEffort).toBe(false);
    expect(entry?.capabilities.supportsOpenAIResponses).toBe(true);
    expect(gameReadyIds).toContain("openai:gpt-5.4-nano");
  });

  it("lists openai:gpt-5.6-luna as game-ready with GPT-5.4-class capabilities", () => {
    const entry = modelCatalogEntryById("openai:gpt-5.6-luna");
    const gameReadyIds = gameReadyCatalogEntries().map((item) => item.id);

    expect(entry?.providerProfileId).toBe("openai");
    expect(entry?.modelId).toBe("gpt-5.6-luna");
    expect(entry?.displayName).toBe("OpenAI gpt-5.6-luna");
    expect(entry?.evaluationStatus).toBe("game-ready");
    expect(entry?.capabilities.supportsReasoningEffort).toBe(true);
    expect(entry?.capabilities.supportsToolReasoningEffort).toBe(false);
    expect(entry?.capabilities.usesMaxCompletionTokens).toBe(true);
    expect(entry?.capabilities.supportsOpenAIResponses).toBe(true);
    expect(entry?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(gameReadyIds).toContain("openai:gpt-5.6-luna");
  });

  it("formats model selection labels from catalog display names", () => {
    expect(formatGameModelSelectionLabel({
      catalogId: "katana:grok-4-3",
      reasoningPolicy: "medium",
    })).toBe("xAI Grok 4.3 · Medium");
  });

  it("rejects a missing game model selection", () => {
    expect(() => resolveModelSelection(undefined)).toThrow("Game model selection is required");
  });

  it("marks q-naifu-a3b disabled after failed API-backed Katana evaluation", () => {
    const gameReadyIds = gameReadyCatalogEntries().map((entry) => entry.id);
    const qNaifu = modelCatalogEntryById("katana:q-naifu-a3b");

    expect(gameReadyIds).toContain("katana:grok-4-3");
    expect(gameReadyIds).not.toContain("katana:q-naifu-a3b");
    expect(gameReadyIds).not.toContain("katana:grok-4-20-multi-agent");
    expect(gameReadyIds).not.toContain("katana:glm-5-2");
    expect(MODEL_CATALOG.some((entry) => entry.modelId === "grok-build-0-1")).toBe(false);
    expect(qNaifu?.evaluationStatus).toBe("disabled");
    expect(qNaifu?.capabilities.supportsStructuredOutput).toBe(true);
    expect(qNaifu?.capabilities.supportsTools).toBe(false);
    expect(qNaifu?.preferredToolChoiceMode).toBe("json_schema");
  });

  it("normalizes game model selection and reasoning policies", () => {
    expect(normalizeReasoningPolicy("auto")).toBe("action-policy");
    expect(normalizeReasoningPolicy("medium")).toBe("medium");
    expect(normalizeReasoningPolicy("none")).toBeNull();
    expect(normalizeGameModelSelection({
      catalogId: "katana:grok-4-3",
      reasoningPolicy: "high",
    })).toEqual({
      catalogId: "katana:grok-4-3",
      reasoningPolicy: "high",
    });
  });

  it("resolves an explicit selection", () => {
    const resolved = resolveModelSelection(
      { catalogId: "katana:grok-4-3", reasoningPolicy: "low" },
    );

    expect(resolved.catalogId).toBe("katana:grok-4-3");
    expect(resolved.providerProfile.id).toBe("katana");
    expect(resolved.modelId).toBe("grok-4-3");
    expect(resolved.reasoningPolicy).toBe("low");
  });

  it("supports dynamic OpenAI-compatible text model catalog entries", () => {
    const katana = resolveModelSelection(
      { catalogId: "katana:grok-4-33", reasoningPolicy: "high" },
    );
    expect(katana.providerProfile.id).toBe("katana");
    expect(katana.modelId).toBe("grok-4-33");
    expect(katana.reasoningPolicy).toBe("high");

    const lmStudio = resolveModelSelection(
      { catalogId: "lm-studio:google/gemma-4-26b-a4b-qat" },
    );
    expect(lmStudio.providerProfile.id).toBe("lm-studio");
    expect(lmStudio.modelId).toBe("google/gemma-4-26b-a4b-qat");
    expect(lmStudio.model.capabilities.supportsOpenAIResponses).toBe(false);
  });

  it("infers capabilities for uncataloged provider models", () => {
    expect(inferModelCapabilities("grok-custom", "katana").supportsReasoningEffort).toBe(true);
    expect(inferModelCapabilities("gpt-5-mini", "openai").usesMaxCompletionTokens).toBe(true);
    expect(inferModelCapabilities("llama-local", "lm-studio").supportsReasoningEffort).toBe(false);
  });
});
