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
  tierToCatalogId,
} from "../model-catalog";

describe("model catalog", () => {
  it("maps legacy tiers to explicit OpenAI catalog entries", () => {
    expect(tierToCatalogId("budget")).toBe("openai:gpt-5-nano");
    expect(tierToCatalogId("standard")).toBe("openai:gpt-5-mini");
    expect(tierToCatalogId("premium")).toBe("openai:gpt-5.4-mini");
    expect(tierToCatalogId("unknown")).toBe("openai:gpt-5-nano");
  });

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

  it("formats model selection labels from catalog display names", () => {
    expect(formatGameModelSelectionLabel({
      catalogId: "katana:grok-4-3",
      reasoningPolicy: "medium",
    }, "budget")).toBe("xAI Grok 4.3 · Medium");
    expect(formatGameModelSelectionLabel(undefined, "premium")).toBe("OpenAI gpt-5.4-mini · Adaptive");
  });

  it("keeps back-burner Katana records out of game-ready options", () => {
    const gameReadyIds = gameReadyCatalogEntries().map((entry) => entry.id);

    expect(gameReadyIds).toContain("katana:grok-4-3");
    expect(gameReadyIds).not.toContain("katana:grok-4-20-multi-agent");
    expect(gameReadyIds).not.toContain("katana:q-naifu-a3b");
    expect(gameReadyIds).not.toContain("katana:glm-5-2");
    expect(MODEL_CATALOG.some((entry) => entry.modelId === "grok-build-0-1")).toBe(false);
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

  it("resolves explicit selection before tier fallback", () => {
    const resolved = resolveModelSelection(
      { catalogId: "katana:grok-4-3", reasoningPolicy: "low" },
      "premium",
    );

    expect(resolved.catalogId).toBe("katana:grok-4-3");
    expect(resolved.providerProfile.id).toBe("katana");
    expect(resolved.modelId).toBe("grok-4-3");
    expect(resolved.reasoningPolicy).toBe("low");
  });

  it("rejects unknown explicit catalog selections", () => {
    expect(() => resolveModelSelection(
      { catalogId: "katana:grok-4-33", reasoningPolicy: "high" },
      "budget",
    )).toThrow("Unknown model catalog entry: katana:grok-4-33");
  });

  it("infers capabilities for uncataloged provider models", () => {
    expect(inferModelCapabilities("grok-custom", "katana").supportsReasoningEffort).toBe(true);
    expect(inferModelCapabilities("gpt-5-mini", "openai").usesMaxCompletionTokens).toBe(true);
    expect(inferModelCapabilities("llama-local", "lm-studio").supportsReasoningEffort).toBe(false);
  });
});
