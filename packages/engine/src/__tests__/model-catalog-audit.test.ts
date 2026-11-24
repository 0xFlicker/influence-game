import { expect, test } from "bun:test";
import inventory from "./fixtures/model-inventory-2026-10-23.json";
import { MODEL_CATALOG, modelCatalogEntryById, normalizeProviderManifest } from "../model-catalog";
import { providerModelFacts } from "../provider-model-facts";
import { estimateRouteCost, modelRateCard } from "../model-route-metadata";
import { MODEL_PRICING } from "../token-tracker";

test("new native models have documented schema capabilities and provider-specific Standard rates", () => {
  for (const [id, input, cached, output] of [
    ["openai:gpt-6.2-sol", 2, 0.1, 10],
    ["openai:gpt-6.2-astra", 8, 0.4, 40],
    ["xai:grok-4.7", 2, 0.5, 6],
    ["anthropic:claude-fable-5-2", 8, 0.2, 40],
  ] as const) {
    const entry = MODEL_CATALOG.find(model => model.id === id);
    expect(entry).toMatchObject({
      evaluationStatus: "evaluation-candidate",
      capabilityEvidence: "documented",
      capabilities: { supportsImageInput: true, supportsStructuredOutput: true },
      metadata: { documented: { checkedAt: "2026-11-24" } },
    });
    expect(modelRateCard(id)?.rates).toMatchObject({ inputPer1M: input, cachedInputPer1M: cached, outputPer1M: output });
    expect(modelRateCard(id, "flex")).toBeNull();
    expect(normalizeProviderManifest([{ catalogId: id }])[0]?.catalogId).toBe(id);
  }
  expect(modelRateCard("openai:gpt-6.2-sol")?.rates.tiers?.[0]).toMatchObject({
    minPromptTokens: 272_001, inputPer1M: 4, outputPer1M: 15, cachedInputPer1M: 0.2, cacheWriteInputPer1M: 5,
  });
  expect(modelRateCard("xai:grok-4.7")?.rates.tiers?.[0]).toMatchObject({
    minPromptTokens: 200_001, inputPer1M: 4, outputPer1M: 12, cachedInputPer1M: 1,
  });
});

test("scheduled retirement is catalog metadata and preserves the exact priced model", () => {
  for (const [id, date, replacementModelId] of [
    ["openai:gpt-5-nano-2025-08-07", "2026-12-11", "gpt-6-luna"],
    ["openai:gpt-5.4-nano", "2027-04-01", "gpt-6-luna"],
    ["anthropic:claude-sonnet-4-5-20250929", "2026-11-30", "claude-sonnet-5-5"],
    ["anthropic:claude-opus-4-5-20251101", "2027-01-22", "claude-opus-5-5"],
  ] as const) {
    expect(modelCatalogEntryById(id)?.metadata).toMatchObject({
      documented: { retired: false, deprecation: { retirementDate: date, replacementModelId } },
      rateCard: { catalogId: id },
    });
  }
  expect(providerModelFacts("openai", "gpt-5.6-sol")?.deprecation).toBeUndefined();
  expect(providerModelFacts("anthropic", "claude-haiku-4-5-20251001")?.deprecation).toBeUndefined();
});

test("Terra uses documented Responses capabilities and its own Standard and Flex rates", () => {
  const model = modelCatalogEntryById("openai:gpt-6.1-terra");
  expect(model?.capabilityEvidence).toBe("documented");
  expect(model?.evaluationStatus).toBe("evaluation-candidate");
  expect(model?.capabilities).toMatchObject({ supportsOpenAIResponses: true, supportsStructuredOutput: true, supportsImageInput: true, supportsTemperature: false });
  expect(model?.allowedReasoningEfforts).toEqual(["low", "medium", "high"]);
  expect(model?.metadata.rateCard).toMatchObject({ version: "2026-10-26", rates: {
    inputPer1M: 1, outputPer1M: 5, cachedInputPer1M: .05, cacheWriteInputPer1M: 1.25,
    tiers: [{ minPromptTokens: 272001, inputPer1M: 2, outputPer1M: 7.5, cachedInputPer1M: .1, cacheWriteInputPer1M: 2.5 }],
  } });
  expect(modelRateCard("openai:gpt-6.1-terra", "flex")?.rates).toEqual({
    inputPer1M: .5, outputPer1M: 2.5, cachedInputPer1M: .025, cacheWriteInputPer1M: .625,
    tiers: [{ minPromptTokens: 272001, inputPer1M: 1, outputPer1M: 3.75, cachedInputPer1M: .05, cacheWriteInputPer1M: 1.25 }],
  });
  expect(modelRateCard("openai:gpt-6.1-sol")?.version).toBe("2026-10-23");
  expect(() => normalizeProviderManifest([{ catalogId: "openai:gpt-6.1-terra" }])).not.toThrow();
});

test("every hosted model in the audit has documented facts and a price, or is excluded from gameplay", () => {
  for (const [provider, ids] of Object.entries(inventory)) {
    for (const id of ids) {
      const catalogId = `${provider}:${id}`;
      const model = modelCatalogEntryById(catalogId);
      if (!model) {
        expect(() => normalizeProviderManifest([{ catalogId }])).toThrow();
        continue;
      }
      expect(model.capabilityEvidence).toBe("documented");
      expect(model.metadata.rateCard).not.toBeNull();
      expect(model.capabilities).toEqual(providerModelFacts(provider, id)!.capabilities);
      if (!model.capabilities.supportsStructuredOutput) expect(() => normalizeProviderManifest([{ catalogId }])).toThrow("incompatible");
    }
  }
});

test("documented snapshots share exact facts; fabricated dates never acquire a price", () => {
  for (const [id, alias] of [["gpt-5-mini", "gpt-5-mini-2025-08-07"], ["gpt-5.4", "gpt-5.4-2026-03-05"], ["gpt-4.1", "gpt-4.1-2025-04-14"]]) {
    expect(modelRateCard(`openai:${alias}`)?.rates).toEqual(modelRateCard(`openai:${id}`)?.rates);
    expect(modelCatalogEntryById(`openai:${alias}`)?.capabilities).toEqual(modelCatalogEntryById(`openai:${id}`)?.capabilities);
  }
  expect(modelRateCard("openai:gpt-5-mini-2099-01-01")).toBeNull();
  expect(modelRateCard("custom-openai-compatible:gpt-6-astra")).toBeNull();
  expect(modelRateCard("openai:gpt-6.1-sol", "priority")).toBeNull();
  expect(modelRateCard("openai:gpt-6.1-sol", "future-tier")).toBeNull();
  expect(modelRateCard("openai:gpt-5.5-pro", "flex")).toBeNull();
  expect(MODEL_PRICING["gpt-6-astra"]?.inputPer1M).toBe(10);
  expect(modelRateCard("katana:gpt-6-astra")?.rates.inputPer1M).toBeCloseTo(10.2, 10);
});

test("known input, tool, sampling and reasoning restrictions supersede family guesses", () => {
  expect(modelCatalogEntryById("openai:gpt-5-nano")?.capabilities.supportsImageInput).toBe(true);
  expect(modelCatalogEntryById("openai:o3-mini")?.capabilities.supportsImageInput).toBe(false);
  expect(modelCatalogEntryById("openai:chat-latest")?.capabilities.supportsReasoningEffort).toBe(false);
  expect(modelCatalogEntryById("openai:gpt-5-pro")?.allowedReasoningEfforts).toEqual(["high"]);
  expect(modelCatalogEntryById("openai:gpt-5.5-pro")?.allowedReasoningEfforts).toEqual(["medium", "high"]);
  expect(modelCatalogEntryById("katana:kimi-k3")?.capabilities).toMatchObject({ supportsTemperature: false, supportsReasoningEffort: true });
  expect(modelCatalogEntryById("katana:glm-5-3-flash-private")?.capabilities).toMatchObject({ supportsReasoningEffort: true, usesMaxCompletionTokens: true });
  expect(modelCatalogEntryById("katana:grok-4-20-multi-agent")?.capabilities.supportsTools).toBe(false);
  expect(modelCatalogEntryById("meta-muse:muse-spark-1.2-contributor")?.metadata.rateCard?.rates).toMatchObject({ inputPer1M: .1, outputPer1M: .2 });
  for (const id of ["openai:gpt-4o-2024-05-13", "openai:gpt-5.4-pro", "openai:o3-deep-research", "katana:qwen3-coder-480b-a35b-private"]) {
    expect(() => normalizeProviderManifest([{ catalogId: id }])).toThrow("incompatible");
  }
});

test("Muse Ember long-context tier applies in full only above 200K input tokens", () => {
  const card = modelRateCard("meta-muse:muse-ember-1.0")!;
  expect(card.version).toBe("2026-11-09");
  const usage = { cachedTokens: 10_000, completionTokens: 10_000, reasoningTokens: 0 };
  // 190K uncached + 10K cached input, 10K output at base rates.
  expect(estimateRouteCost({ ...usage, promptTokens: 200_000 }, card)).toBeCloseTo(0.02404, 10);
  // One more input token bills the whole request at long-context rates.
  expect(estimateRouteCost({ ...usage, promptTokens: 200_001 }, card)).toBeCloseTo(0.0721203, 10);
  expect(providerModelFacts("meta-muse", "muse-ember-1.0-contributor")).toBeUndefined();
});

test("Katana's probed evaluation models have dated provider facts and route-specific rates", () => {
  const id = "katana:glm-5-3-flash";
  const entry = MODEL_CATALOG.find(model => model.id === id);
  expect(entry).toMatchObject({
    evaluationStatus: "evaluation-candidate",
    capabilityEvidence: "documented",
    capabilities: {
      supportsImageInput: true, supportsStructuredOutput: true,
      supportsReasoningEffort: true, usesMaxCompletionTokens: false,
    },
    metadata: { documented: { contextTokens: 1048576, outputTokens: 131072, checkedAt: "2026-11-22" } },
  });
  expect(normalizeProviderManifest([{ catalogId: id }])[0]?.catalogId).toBe(id);
  const card = modelRateCard(id)!;
  expect(card).toMatchObject({
    version: "2026-11-22", minimumUsd: 0.00052, roundingUsd: 0.00052,
    rates: { inputPer1M: 0.041097, cachedInputPer1M: 0.0309, outputPer1M: 0.080752 },
  });
  expect(estimateRouteCost({ promptTokens: 10, completionTokens: 10 }, card)).toBeCloseTo(0.00052, 10);
  expect(estimateRouteCost({ promptTokens: 30_000 }, card)).toBeCloseTo(0.00156, 10);
  expect(modelRateCard("katana:gemini-4-hydrogen")?.rates.cacheWriteInputPer1M).toBeCloseTo(0.0858333333333333, 10);
  expect(modelRateCard("katana:glm-5-2")?.version).toBe("2026-11-22");
  expect(modelRateCard("katana:glm-5-3-flash-private")?.version).toBe("2026-10-23");
});

test("published cached-token discounts are retained instead of charging the uncached rate", () => {
  expect(modelRateCard("openai:gpt-4.1")?.rates.cachedInputPer1M).toBe(.5);
  expect(modelRateCard("openai:gpt-4.1-mini")?.rates.cachedInputPer1M).toBe(.1);
  expect(modelRateCard("openai:o4-mini", "flex")?.rates.cachedInputPer1M).toBe(.1375);
});
