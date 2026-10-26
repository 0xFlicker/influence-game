import { expect, test } from "bun:test";
import inventory from "./fixtures/model-inventory-2026-10-23.json";
import { modelCatalogEntryById, normalizeProviderManifest } from "../model-catalog";
import { providerModelFacts } from "../provider-model-facts";
import { modelRateCard } from "../model-route-metadata";
import { MODEL_PRICING } from "../token-tracker";

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

test("published cached-token discounts are retained instead of charging the uncached rate", () => {
  expect(modelRateCard("openai:gpt-4.1")?.rates.cachedInputPer1M).toBe(.5);
  expect(modelRateCard("openai:gpt-4.1-mini")?.rates.cachedInputPer1M).toBe(.1);
  expect(modelRateCard("openai:o4-mini", "flex")?.rates.cachedInputPer1M).toBe(.1375);
});
