import { describe, expect, test } from "bun:test";
import { actorProviderManifest, assertModelEntitlement, contestantManifest, FREE_MODEL_CATALOG_IDS, gameModelPolicy, normalizeGameModelRouting, normalizeModelPreference, sealGameModelRouting } from "../game-model-routing";
import { estimateCost } from "../token-tracker";
import { estimateRouteCost, modelRateCard } from "../model-route-metadata";
import { previewModelRoster } from "../mixed-model-simulate";
import { summarizeModelRouting } from "../model-routing-report";
import { modelCatalogEntryById } from "../model-catalog";

const policy = () => normalizeGameModelRouting({ version: 1, defaultManifest: [{ catalogId: "openai:gpt-6-luna" }, { catalogId: "katana:deepseek-v4-flash", maxCallsPerGame: 5 }],
  houseManifest: [{ catalogId: "meta-muse:muse-spark-1.3-contributor" }, { catalogId: "katana:deepseek-v4-flash", maxCallsPerGame: 2 }], overrides: {}, excludedCatalogIds: [] });

describe("frozen game model routing", () => {
  test("explicit preferences retain the game default first with a bounded shared allowance", () => {
    const routing = { ...policy(), defaultModelMaxFallbackCalls: 7 };
    const preferred = { catalogId: "katana:glm-5-3-flash-private" };
    expect(contestantManifest(routing, preferred)).toEqual([
      expect.objectContaining(preferred),
      { ...routing.defaultManifest[0]!, maxCallsPerGame: 7 },
      routing.defaultManifest[1]!,
    ]);
    expect(contestantManifest(routing, "default")).toEqual(routing.defaultManifest);
    expect(contestantManifest(routing, routing.defaultManifest[0]!)).toEqual(routing.defaultManifest);
    for (const value of [0, -1, 1.5, 10001, "7"]) {
      expect(() => normalizeGameModelRouting({ ...routing, defaultModelMaxFallbackCalls: value })).toThrow("fallback calls");
    }
  });
  test("free selections are exactly the four agreed routes plus Default; experimental admin models stay strict", () => {
    for (const catalogId of FREE_MODEL_CATALOG_IDS) expect(() => assertModelEntitlement(normalizeModelPreference({ catalogId }), false)).not.toThrow();
    expect(() => assertModelEntitlement("default", false)).not.toThrow();
    const experimental = normalizeModelPreference({ catalogId: "meta-muse:future-text-model" });
    expect(() => assertModelEntitlement(experimental, false)).toThrow("admins");
    expect(() => assertModelEntitlement(experimental, true)).not.toThrow();
    expect(() => normalizeModelPreference({ catalogId: "https://attacker.example:model" })).toThrow();
    expect(() => normalizeModelPreference({ catalogId: "meta-muse:muse-image-1.0" })).toThrow();
  });
  test("explicit Default override beats the enrollment, absent override inherits, and House is independent", () => {
    const routing = policy(); routing.overrides.a = "default";
    const preference = { catalogId: "katana:glm-5-3-flash-private" };
    const sealed = sealGameModelRouting(routing, [{ id: "a", preference }, { id: "b", preference }]);
    preference.catalogId = "openai:changed-after-enrollment";
    const config = { modelRouting: sealed };
    expect(actorProviderManifest(config, { id: "a", role: "player" })[0]!.catalogId).toBe("openai:gpt-6-luna");
    expect(actorProviderManifest(config, { id: "b", role: "juror" })[0]!.catalogId).toBe("katana:glm-5-3-flash-private");
    expect(actorProviderManifest(config, { role: "house" })[0]!.catalogId).toBe("meta-muse:muse-spark-1.3-contributor");
    expect(() => actorProviderManifest(config, { id: "outsider", role: "player" })).toThrow("Corrupt");
    expect(() => sealGameModelRouting(sealed, [])).toThrow("already sealed");
  });
  test("eight provider-qualified models remain distinct through serialization and resume", () => {
    const ids = [...FREE_MODEL_CATALOG_IDS, "openai:gpt-5-mini", "katana:grok-4-6", "katana:q-naifu-a3b", "custom-openai-compatible:experimental"];
    const sealed = sealGameModelRouting(policy(), ids.map((catalogId, i) => ({ id: `seat-${i}`, preference: { catalogId } })));
    const config = JSON.parse(JSON.stringify({ modelRouting: sealed }));
    ids.forEach((catalogId, i) => expect(actorProviderManifest(config, { id: `seat-${i}`, role: "player" })[0]!.catalogId).toBe(catalogId));
    expect(config.modelRouting.contestants["seat-2"].map((entry: { catalogId: string }) => entry.catalogId)).toEqual(["katana:deepseek-v4-flash", "openai:gpt-6-luna"]);
    expect(config.modelRouting.houseManifest[1].maxCallsPerGame).toBe(2);
  });
  test("exclusions and known input limitations reject primaries, skip incompatible fallbacks, and permit empty recovery", () => {
    expect(() => normalizeGameModelRouting({ ...policy(), excludedCatalogIds: ["katana:deepseek-v4-flash"] })).toThrow("excluded");
    expect(() => contestantManifest(policy(), { catalogId: "katana:deepseek-v4-flash" }, true)).toThrow("image context");
    expect(contestantManifest(policy(), "default", true)).toHaveLength(1);
    expect(() => contestantManifest(policy(), { catalogId: "katana:gpt-6-luna" })).toThrow("Flex");
    expect(() => sealGameModelRouting({ ...policy(), overrides: { ghost: "default" } }, [])).toThrow("missing cast");
    expect(gameModelPolicy({ providerManifest: [{ catalogId: "openai:gpt-5-mini" }] }).houseManifest).toHaveLength(1);
  });
  test("offline simulation uses the production resolver and rejects seat-count mismatch", () => {
    const roster = { policy: policy(), seats: [{ id: "one", preference: "default" as const }] };
    expect(() => previewModelRoster(roster, 8)).toThrow("exactly 8");
    expect(previewModelRoster(roster, 1).policy.contestants?.one?.[0]!.catalogId).toBe("openai:gpt-6-luna");
  });
  test("catalog capability changes cannot rewrite or prevent reading a sealed game", () => {
    const config = JSON.parse(JSON.stringify({ modelRouting: sealGameModelRouting(policy(), [{ id: "seat", preference: "default" }]) }));
    const capabilities = modelCatalogEntryById("openai:gpt-6-luna")!.capabilities;
    const original = capabilities.supportsStructuredOutput;
    try {
      capabilities.supportsStructuredOutput = false;
      expect(gameModelPolicy(config)).toEqual(config.modelRouting);
      expect(actorProviderManifest(config, { id: "seat", role: "player" })[0]!.model.capabilities.supportsStructuredOutput).toBeTrue();
      expect(() => policy()).toThrow("incompatible");
    } finally { capabilities.supportsStructuredOutput = original; }
  });
});

test("unknown pricing is not Luna pricing, provider identity matters, and Katana minimum/tier charges are applied", () => {
  const usage = { promptTokens: 100, cachedTokens: 0, completionTokens: 10, reasoningTokens: 0, totalTokens: 110, callCount: 1, emptyResponses: 0 };
  expect(estimateCost(usage, "unpriced-future-model")).toBeNull();
  expect(modelRateCard("custom-openai-compatible:gpt-6-luna")).toBeNull();
  expect(estimateRouteCost(usage, modelRateCard("katana:deepseek-v4-flash")!)).toBeCloseTo(0.00052, 8);
  expect(modelRateCard("katana:grok-4-6")!.rates.tiers?.[0]?.minPromptTokens).toBe(200000);
  expect(modelRateCard("openai:gpt-6-luna", "flex")!.rates.outputPer1M).toBe(0.25);
});

test("Sol accounting uses published cache and long-context rates for each service tier", () => {
  for (const [serviceTier, scale] of [["default", 1], ["flex", 0.5]] as const) {
    const card = modelRateCard("openai:gpt-6.1-sol", serviceTier)!;
    expect(card.rates).toMatchObject({ inputPer1M: 2 * scale, cachedInputPer1M: 0.1 * scale,
      cacheWriteInputPer1M: 2.5 * scale, outputPer1M: 10 * scale });
    for (const promptTokens of [272_000, 272_001]) {
      const long = promptTokens > 272_000;
      const expected = (((promptTokens - 30_000) * 2 + 20_000 * 0.1 + 10_000 * 2.5) * (long ? 2 : 1)
        + 1000 * 10 * (long ? 1.5 : 1)) * scale / 1_000_000;
      expect(estimateRouteCost({ promptTokens, cachedTokens: 20_000, cacheWriteTokens: 10_000,
        completionTokens: 1000, totalTokens: promptTokens + 1000 }, card)).toBeCloseTo(expected, 10);
    }
  }
  expect(modelRateCard("katana:gpt-6.1-sol")).toBeNull();
});

test("preferred-route share excludes failed attempts and zero denominators are explicit", () => {
  const report = summarizeModelRouting([
    { actorId: "a", preferredCatalogId: "preferred", actualCatalogId: "preferred", accepted: false, failure: "refusal" },
    { actorId: "a", preferredCatalogId: "preferred", actualCatalogId: "fallback", accepted: true },
    { actorId: "house", preferredCatalogId: "house-model", actualCatalogId: "house-model", accepted: false },
  ]);
  expect(report[0]).toMatchObject({ accepted: 1, preferredRouteShare: 0, failedAttempts: 1 });
  expect(report[1]).toMatchObject({ preferredRouteShare: null, preferredRouteShareLabel: "No accepted model decisions" });
});
