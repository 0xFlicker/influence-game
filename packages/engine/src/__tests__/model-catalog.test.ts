import { describe, expect, it } from "bun:test";
import { normalizeModelPreference } from "../game-model-routing";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_CATALOG_ID,
  MODEL_CATALOG,
  PROVIDER_PROFILES,
  MAX_PROVIDER_MANIFEST_ENTRIES,
  MAX_PROVIDER_ENTRY_CALLS_PER_GAME,
  formatGameModelSelectionLabel,
  gameReadyCatalogEntries,
  inferModelCapabilities,
  modelCatalogEntryById,
  normalizeGameModelSelection,
  normalizeProviderManifest,
  normalizeReasoningPolicy,
  resolveModelSelection,
  resolveProviderManifest,
  resolveProviderManifestFromGameConfig,
} from "../model-catalog";

describe("model catalog", () => {
  it("resolves Sol pricing and its documented Responses capabilities", () => {
    const entry = modelCatalogEntryById("openai:gpt-6.1-sol")!;
    expect(entry.capabilityEvidence).toBe("documented");
    expect(entry.metadata.rateCard).toMatchObject({ version: "2026-10-23", rates: { inputPer1M: 2, outputPer1M: 10 } });
    expect(entry.capabilities).toMatchObject({ supportsImageInput: true, supportsOpenAIResponses: true,
      supportsStructuredOutput: true, supportsTools: true, supportsReasoningEffort: true, supportsToolReasoningEffort: false });
    expect(resolveProviderManifest([{ catalogId: entry.id, reasoningPolicy: "high" }])[0]!.modelId).toBe("gpt-6.1-sol");
  });

  it("rejects non-decision models in discovery, exact preferences, primaries and fallbacks", () => {
    const modelIds = ["gpt-image-2", "gpt-image-1-mini", "gpt-image-1.5", "chatgpt-image-latest", "gpt-image-1",
      "gpt-image-2-2026-04-21", "gpt-image-2.5-sunburst", "sora-2", "gpt-4o-mini-transcribe",
      "omni-moderation-latest", "text-embedding-3-small", "gpt-realtime-2.1", "gpt-live-1", "tts-1"];
    for (const provider of ["openai", "custom-openai-compatible", "katana"]) {
      for (const modelId of modelIds) {
        const catalogId = `${provider}:${modelId}`;
        expect(modelCatalogEntryById(catalogId)).toBeUndefined();
        expect(() => normalizeModelPreference({ catalogId })).toThrow();
        expect(() => normalizeProviderManifest([{ catalogId }])).toThrow();
        expect(() => normalizeProviderManifest([{ catalogId: "openai:gpt-6-luna" }, { catalogId, maxCallsPerGame: 2 }])).toThrow();
      }
    }
    expect(modelCatalogEntryById("custom-openai-compatible:openai/gpt-image-2")).toBeUndefined();
    for (const catalogId of ["openai:gpt-6-luna", "openai:gpt-6.1-sol", "katana:kimi-k3"]) {
      expect(modelCatalogEntryById(catalogId)?.capabilities.supportsImageInput).toBe(true);
      expect(() => normalizeModelPreference({ catalogId })).not.toThrow();
    }
  });

  it("resolves audited Kimi metadata without generic inferred or unknown-price notes", () => {
    const entry = modelCatalogEntryById("katana:kimi-k3")!;
    expect(entry.capabilityEvidence).toBe("documented");
    expect(entry.metadata.documented).toMatchObject({ inputImages: true, strictSchema: true });
    expect(entry.capabilities.supportsImageInput).toBe(entry.metadata.documented!.inputImages);
    expect(entry.capabilities.supportsStructuredOutput).toBe(entry.metadata.documented!.strictSchema);
    expect(inferModelCapabilities("kimi-k3", "katana")).toEqual(entry.capabilities);
    expect(entry.metadata.rateCard?.rates.inputPer1M).toBeCloseTo(0.24378);
    expect(entry.metadata.rateCard?.rates.outputPer1M).toBe(11.016);
    expect(entry.notes).toBeUndefined();
  });

  it("exports the same resolved records used by lookup and runtime capability inference", () => {
    for (const entry of MODEL_CATALOG) {
      expect(modelCatalogEntryById(entry.id)).toBe(entry);
      expect(inferModelCapabilities(entry.modelId, entry.providerProfileId)).toEqual(entry.capabilities);
      if (entry.metadata.documented) {
        expect(entry.capabilities.supportsImageInput).toBe(entry.metadata.documented.inputImages);
        expect(entry.capabilities.supportsStructuredOutput).toBe(entry.metadata.documented.strictSchema);
      }
    }
    const unknown = modelCatalogEntryById("katana:unlisted-example")!;
    expect(unknown.capabilityEvidence).toBe("inferred");
    expect(unknown.metadata.rateCard).toBeNull();
    expect(unknown.metadata.documented).toBeNull();
    expect(unknown.notes).toBeUndefined();
  });

  it("resolves GPT-6 Luna as an image-capable reasoning model for primary and fallback slots", () => {
    const entry = modelCatalogEntryById("openai:gpt-6-luna")!;
    expect(gameReadyCatalogEntries()).toContain(entry);
    expect(inferModelCapabilities("gpt-6-luna")).toMatchObject({
      supportsImageInput: true,
      supportsOpenAIResponses: true,
      supportsStructuredOutput: true,
      supportsTools: true,
      supportsReasoningEffort: true,
      supportsToolReasoningEffort: false,
      supportsTemperature: false,
      supportsPromptCacheRetention: true,
    });
    for (const manifest of [
      [{ catalogId: entry.id, reasoningPolicy: "high" }],
      [{ catalogId: "openai:gpt-5.6-luna" }, { catalogId: entry.id, maxCallsPerGame: 3 }],
    ]) {
      expect(resolveProviderManifest(manifest).every(slot => slot.model.capabilities.supportsImageInput)).toBe(true);
    }
    const unlisted = modelCatalogEntryById("openai:gpt-6-unlisted")!;
    expect(inferModelCapabilities("gpt-6-unlisted")).toEqual(unlisted.capabilities);
    expect(unlisted.capabilityEvidence).toBe("inferred");
    expect(unlisted.metadata.documented).toBeNull();
  });

  it("resolves the GPT-6 Luna default through hosted Responses with strict tools", () => {
    expect(DEFAULT_MODEL_ID).toBe("gpt-6-luna");
    expect(DEFAULT_MODEL_CATALOG_ID).toBe("openai:gpt-6-luna");
    const selection = resolveModelSelection({ catalogId: DEFAULT_MODEL_CATALOG_ID });
    expect(selection.modelId).toBe("gpt-6-luna");
    const entry = modelCatalogEntryById(DEFAULT_MODEL_CATALOG_ID);
    expect(entry?.evaluationStatus).toBe("game-ready");
    expect(entry?.defaultReasoningPolicy).toBe("action-policy");
    expect(entry?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(entry?.capabilities).toMatchObject({
      supportsOpenAIResponses: true,
      supportsReasoningEffort: true,
      supportsStructuredOutput: true,
      supportsTools: true,
      supportsTemperature: false,
      supportsPromptCacheRetention: true,
    });
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

  it("offers the approved Katana fallback models as game-ready choices", () => {
    const grok = modelCatalogEntryById("katana:grok-4-5");
    const glm = modelCatalogEntryById("katana:glm-5-2");
    const gameReadyIds = gameReadyCatalogEntries().map((entry) => entry.id);

    expect(grok?.displayName).toBe("xAI Grok 4.5");
    expect(grok?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(glm?.displayName).toBe("Katana GLM 5.2");
    expect(glm?.allowedReasoningEfforts).toEqual([]);
    expect(gameReadyIds).toContain("katana:grok-4-5");
    expect(gameReadyIds).toContain("katana:glm-5-2");
  });

  it("lists Meta Muse text models as game-ready with auto tool choice", () => {
    for (const [catalogId, modelId] of [
      ["meta-muse:muse-spark-1.3", "muse-spark-1.3"],
      ["meta-muse:muse-spark-1.3-contributor", "muse-spark-1.3-contributor"],
      ["meta-muse:muse-wonder-1.0", "muse-wonder-1.0"],
    ] as const) {
      const entry = modelCatalogEntryById(catalogId);
      expect(entry?.providerProfileId).toBe("meta-muse");
      expect(entry?.modelId).toBe(modelId);
      expect(entry?.evaluationStatus).toBe("game-ready");
      expect(entry?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
      expect(entry?.capabilities.supportsStructuredOutput).toBe(true);
      expect(entry?.capabilities.supportsTools).toBe(true);
      expect(entry?.capabilities.supportsReasoningEffort).toBe(true);
      expect(entry?.capabilities.supportsOpenAIResponses).toBe(false);
      expect(entry?.capabilities.supportsImageInput).toBe(true);
    }
    const profile = PROVIDER_PROFILES["meta-muse"];
    expect(profile.baseURL).toBe("https://api.meta.ai/v1");
    // Non-text Meta models never become game LLMs through dynamic inference.
    expect(modelCatalogEntryById("meta-muse:muse-image-1.0")).toBeUndefined();
    expect(modelCatalogEntryById("meta-muse:sam-3.1")).toBeUndefined();
    expect(modelCatalogEntryById("meta-muse:muse-voice-transcribe-1.0")).toBeUndefined();
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
    expect(gameReadyIds).toContain("katana:glm-5-2");
    expect(MODEL_CATALOG.some((entry) => entry.modelId === "grok-build-0-1")).toBe(false);
    expect(qNaifu?.evaluationStatus).toBe("disabled");
    expect(qNaifu?.capabilities.supportsStructuredOutput).toBe(true);
    expect(qNaifu?.capabilities.supportsTools).toBe(false);
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

  it("normalizes and resolves an ordered provider manifest", () => {
    const manifest = normalizeProviderManifest([
      { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      { catalogId: "katana:grok-4-5", reasoningPolicy: "medium", maxCallsPerGame: 12 },
      { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy", maxCallsPerGame: 24 },
    ]);

    expect(manifest).toEqual([
      { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      { catalogId: "katana:grok-4-5", reasoningPolicy: "medium", maxCallsPerGame: 12 },
      { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy", maxCallsPerGame: 24 },
    ]);
    const resolved = resolveProviderManifest(manifest);
    expect(resolved.map((entry) => entry.modelId)).toEqual([
      "gpt-5.6-luna",
      "grok-4-5",
      "glm-5-2",
    ]);
  });

  it("rejects empty, duplicate, oversized, incompatible, and unbounded manifests", () => {
    expect(() => normalizeProviderManifest([])).toThrow("at least one entry");
    expect(() => normalizeProviderManifest([
      { catalogId: "openai:gpt-5.6-luna" },
      { catalogId: "openai:gpt-5.6-luna", maxCallsPerGame: 1 },
    ])).toThrow("duplicate");
    expect(() => normalizeProviderManifest(
      Array.from({ length: MAX_PROVIDER_MANIFEST_ENTRIES + 1 }, (_, index) => ({
        catalogId: `katana:test-model-${index}`,
        ...(index > 0 && { maxCallsPerGame: 1 }),
      })),
    )).toThrow(`at most ${MAX_PROVIDER_MANIFEST_ENTRIES}`);
    expect(normalizeProviderManifest([{ catalogId: "katana:q-naifu-a3b" }])[0]?.catalogId).toBe("katana:q-naifu-a3b");
    expect(() => normalizeProviderManifest([
      { catalogId: "katana:glm-5-2", reasoningPolicy: "high" },
    ])).toThrow("does not support high reasoning");
    expect(() => normalizeProviderManifest([
      { catalogId: "openai:gpt-5.6-luna" },
      { catalogId: "katana:grok-4-5" },
    ])).toThrow("maxCallsPerGame");
    expect(() => normalizeProviderManifest([
      { catalogId: "openai:gpt-5.6-luna" },
      { catalogId: "katana:grok-4-5", maxCallsPerGame: MAX_PROVIDER_ENTRY_CALLS_PER_GAME + 1 },
    ])).toThrow(`at most ${MAX_PROVIDER_ENTRY_CALLS_PER_GAME}`);
  });

  it("treats the sealed manifest as authority while retaining stored-game restoration", () => {
    expect(() => resolveProviderManifestFromGameConfig({
      providerManifest: [{ catalogId: "katana:grok-4-5" }],
      modelSelection: { catalogId: "openai:gpt-5.6-luna" },
    })).toThrow("does not match its legacy primary projection");
    expect(resolveProviderManifestFromGameConfig({
      providerManifest: [{ catalogId: "katana:grok-4-5" }],
      modelSelection: { catalogId: "katana:grok-4-5" },
    })[0]?.catalogId).toBe("katana:grok-4-5");
    expect(resolveProviderManifestFromGameConfig({
      modelSelection: { catalogId: "openai:gpt-5.6-luna" },
    })[0]?.catalogId).toBe("openai:gpt-5.6-luna");
  });

  it("supports dynamic OpenAI-compatible text model catalog entries", () => {
    const openAI = resolveModelSelection(
      { catalogId: "openai:gpt-5.7-test", reasoningPolicy: "medium" },
    );
    expect(openAI.providerProfile.id).toBe("openai");
    expect(openAI.modelId).toBe("gpt-5.7-test");
    expect(openAI.reasoningPolicy).toBe("medium");

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

    expect(normalizeProviderManifest([
      { catalogId: "openai:gpt-5.7-test" },
      { catalogId: "katana:deepseek-v3", maxCallsPerGame: 3 },
    ])).toEqual([
      { catalogId: "openai:gpt-5.7-test", reasoningPolicy: "action-policy" },
      {
        catalogId: "katana:deepseek-v3",
        reasoningPolicy: "action-policy",
        maxCallsPerGame: 3,
      },
    ]);
  });

  it("infers capabilities for uncataloged provider models", () => {
    expect(inferModelCapabilities("grok-custom", "katana").supportsReasoningEffort).toBe(true);
    expect(inferModelCapabilities("gpt-5-mini", "openai").usesMaxCompletionTokens).toBe(true);
    expect(inferModelCapabilities("llama-local", "lm-studio").supportsReasoningEffort).toBe(false);
  });
});
