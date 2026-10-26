import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { XaiProviderAdapter, executeModelInvocation } from "../provider-adapters";
import { createLlmClientFromEnv, createLlmProviderRuntimesFromEnv } from "../llm-client";
import { modelCatalogEntryById, resolveProviderManifest } from "../model-catalog";
import { NATIVE_GROK_SELECTIONS, assertCurrentGrokSelection } from "../grok-routing";
import { actorProviderManifest, assertModelEntitlement, gameModelPolicy, sealGameModelRouting } from "../game-model-routing";
import { createExactStructuredOutputArtifact } from "../structured-output";
import { ProviderExecutionCoordinator, type ProviderAttemptRecord } from "../provider-execution";
import { estimateRouteCost, modelRateCard } from "../model-route-metadata";
import type { ModelInvocation, ProviderRuntimeDescriptor } from "../model-invocation";
import { Phase } from "../types";

const model = modelCatalogEntryById("xai:grok-4.3")!;
const runtime: ProviderRuntimeDescriptor = { catalogId: model.id, providerProfileId: "xai", modelId: model.modelId,
  modelCapabilities: model.capabilities, allowedReasoningEfforts: model.allowedReasoningEfforts, reasoningPolicy: "low" };
const artifact = createExactStructuredOutputArtifact<{ target: string }, { target: string }>({ action: "xai-test", name: "choice",
  schema: { type: "object", properties: { target: { type: "string", enum: ["a", "b"] } }, required: ["target"], additionalProperties: false },
  acceptedValueUsesProviderSchema: true,
  decodeProviderPayload: value => ({ status: "valid", value }),
  decodeAcceptedValue: value => ({ status: "valid", value: value as { target: string } }),
});
const invocation: ModelInvocation<{ target: string }> = { messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Choose" }],
  result: { kind: "structured", artifact }, outputTokenLimit: 2048,
  reasoning: { effort: "medium", summary: "auto" }, temperature: 0.7, promptCache: { key: "game", ttl: "30m" } };
const response = (text = '{"target":"a"}', overrides: Record<string, unknown> = {}) => ({ id: "resp_test", status: "completed",
  output: [{ type: "reasoning", id: "reason_test", encrypted_content: "opaque-private-evidence", summary: [] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 900 }, output_tokens: 70,
    output_tokens_details: { reasoning_tokens: 50 }, total_tokens: 1070, cost_in_usd_ticks: 4_800_000 }, ...overrides });
function adapterFor(body: unknown, onRequest?: (body: Record<string, unknown>) => void) {
  return new XaiProviderAdapter(new OpenAI({ apiKey: "fixture", baseURL: "https://api.x.ai/v1", maxRetries: 0,
    fetch: async (_url, init) => {
      onRequest?.(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    } }));
}

describe("native xAI", () => {
  test("uses isolated credentials, no hidden retries or OpenAI Flex, and audited models only", () => {
    const config = createLlmClientFromEnv({ XAI_API_KEY: "fixture", OPENAI_BASE_URL: "https://wrong.invalid", INFLUENCE_LLM_BASE_URL: "https://wrong.invalid", OPENAI_API_KEY: "other" }, { providerProfileId: "xai", maxRetries: 7 })!;
    expect(config.client.baseURL).toBe("https://api.x.ai/v1");
    expect(config.client.maxRetries).toBe(0);
    expect(config.flexProcessingEnabled).toBe(false);
    expect(config.openAIServiceTier).toBeUndefined();
    expect(createLlmClientFromEnv({ OPENAI_API_KEY: "other" }, { providerProfileId: "xai" })).toBeNull();
    expect(modelCatalogEntryById("xai:unknown-text-model")).toBeUndefined();
    expect(modelCatalogEntryById("xai:grok-imagine-image-2.0")).toBeUndefined();
    expect(createLlmProviderRuntimesFromEnv(resolveProviderManifest([{ catalogId: model.id }]), { XAI_API_KEY: "fixture" })?.[0]?.adapter.id).toBe("xai");
  });

  test("keeps instruction order, exact schema, usage and encrypted evidence without server storage", async () => {
    const requests: Record<string, unknown>[] = [];
    const adapter = adapterFor(response(), body => requests.push(body));
    const request = adapter.compile({ ...invocation, messages: [...invocation.messages, { role: "system", content: "Retry guidance" }] }, runtime);
    const outcome = await adapter.dispatch(request, { maxRetries: 0, headers: {} });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "grok-4.3", store: false, max_output_tokens: 2048,
      reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"],
      input: [{ role: "system", content: "Rules" }, { role: "user", content: "Choose" }, { role: "system", content: "Retry guidance" }],
      text: { format: { type: "json_schema", strict: true, schema: artifact.providerSchema } } });
    for (const key of ["service_tier", "prompt_cache_key", "prompt_cache_options", "tools", "previous_response_id", "temperature"]) expect(requests[0]).not.toHaveProperty(key);
    expect(requests[0]).not.toHaveProperty("reasoning.summary");
    expect(outcome.transport).toBe("xai.responses");
    expect(outcome.accounting).toMatchObject({ usage: { promptTokens: 1000, cachedTokens: 900, completionTokens: 70, reasoningTokens: 50, totalTokens: 1070 },
      actualCostMicrousd: 480, actualCostSource: "provider_actual", providerNativeUnit: "xai_usd_ticks", providerNativeAmount: "4800000" });
    expect(JSON.stringify(outcome.nativeResponse)).toContain("opaque-private-evidence");
    expect(outcome.reasoning).toBeUndefined();
    expect(outcome.text).toBe('{"target":"a"}');
  });

  test("rejects tool history and preserves image inputs at their original position", () => {
    const adapter = adapterFor(response());
    expect(adapter.validate({ ...invocation, messages: [{ role: "tool", content: "unsafe" }] }, runtime).compatible).toBe(false);
    const request = adapter.compile({ ...invocation, messages: [{ role: "user", content: "Inspect", images: [{ url: "https://assets.example/a.png", detail: "high" }] }] }, runtime);
    expect(request.body).toMatchObject({ input: [{ role: "user", content: [{ type: "input_text", text: "Inspect" }, { type: "input_image", image_url: "https://assets.example/a.png", detail: "high" }] }] });
  });

  for (const malformed of ["hello", "{", "{}", '{"target":"c"}', '{"target":"a","extra":1}', '{} {}', '```json\n{"target":\n```']) {
    test(`rejects malformed decision ${malformed} within the attempt boundary`, async () => {
      const records: ProviderAttemptRecord[] = [];
      const adapter = adapterFor(response(malformed));
      const coordinator = new ProviderExecutionCoordinator({ wait: async () => {}, hooks: { onTerminal: async record => { records.push(record); } } });
      const call = coordinator.startCall({ actor: { name: "test", role: "player" }, action: artifact.action,
        semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 } });
      await expect(executeModelInvocation({ call, runtimes: [{ ...runtime, adapter, position: 0, role: "primary" }], invocation,
        maxAttempts: 2, validate: (_outcome, decoded) => decoded ? { status: "usable", value: decoded } : { status: "unusable", kind: "malformed_output", message: "missing" } })).rejects.toThrow();
      expect(records.length).toBeGreaterThan(0);
      expect(records.every(record => record.accounting?.actualCostMicrousd === 480)).toBe(true);
    });
  }

  test("truncation and provider failures retain native billing", async () => {
    for (const status of ["incomplete", "failed"]) {
      const adapter = adapterFor(response('{"target":"a"}', { status, incomplete_details: { reason: "max_output_tokens" }, error: status === "failed" ? { code: "server_error", message: "unavailable" } : null }));
      try { await adapter.dispatch(adapter.compile(invocation, runtime), { headers: {}, maxRetries: 0 }); throw new Error("unexpected acceptance"); }
      catch (error) { expect(error).toHaveProperty("accounting.actualCostMicrousd", 480); expect(error).toHaveProperty("nativeResponse.id", "resp_test"); }
    }
  });

  test("same-generation policy rejects obsolete writes but frozen Katana authority remains readable", () => {
    for (const [old, current] of Object.entries(NATIVE_GROK_SELECTIONS)) {
      expect(() => assertCurrentGrokSelection(old)).toThrow(current);
      expect(() => assertModelEntitlement({ catalogId: current }, true)).not.toThrow();
      expect(() => assertModelEntitlement({ catalogId: current }, false)).toThrow("admins");
      const routes = resolveProviderManifest([{ catalogId: old }]);
      const frozen = { modelRouting: { version: 1, defaultManifest: [{ catalogId: old }], houseManifest: [{ catalogId: old }], overrides: {}, excludedCatalogIds: [], contestants: { a: [{ catalogId: old }] }, frozenRoutes: { default: routes, house: routes, contestants: { a: routes } } } };
      expect(actorProviderManifest(frozen, { id: "a", role: "player" })[0]?.catalogId).toBe(old);
      expect(() => sealGameModelRouting(gameModelPolicy({ providerManifest: [{ catalogId: old }] }), [])).toThrow(current);
    }
    expect(() => assertCurrentGrokSelection("katana:grok-future")).toThrow("audited");
  });

  test("prices cached input once and selects long-context tier at exactly 200K prompt tokens", () => {
    const card = modelRateCard("xai:grok-4.6")!;
    expect(estimateRouteCost({ promptTokens: 1000, cachedTokens: 900, completionTokens: 70, reasoningTokens: 50 }, card)).toBeCloseTo(0.00107, 8);
    expect(estimateRouteCost({ promptTokens: 199999, completionTokens: 1 }, card)).toBeCloseTo(0.400004, 8);
    expect(estimateRouteCost({ promptTokens: 200000, completionTokens: 1 }, card)).toBeCloseTo(0.800012, 8);
    expect(modelRateCard("xai:grok-4.6", "priority")).toBeNull();
    expect(modelRateCard("xai:grok-4.7")).toBeNull();
  });
});
