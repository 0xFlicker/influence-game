import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProviderAdapter } from "../anthropic-provider-adapter";
import { compileAnthropicOutputSchema } from "../anthropic-output-schema";
import { createExactStructuredOutputArtifact } from "../structured-output";
import { createLlmClientFromEnv, createLlmProviderRuntimesFromEnv } from "../llm-client";
import { modelCatalogEntryById, resolveProviderManifest } from "../model-catalog";
import { assertModelEntitlement } from "../game-model-routing";
import { estimateRouteCost, modelRateCard } from "../model-route-metadata";
import type { ModelInvocation, ProviderRuntimeDescriptor } from "../model-invocation";
import { completedCurrentWerewolfFixture } from "../fixtures/werewolf-results";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { retrospectiveSpeechArtifact } from "../retrospective";
import { contextSummaryArtifact } from "../context-adaptation";

const schema = { type: "object", properties: { target: { type: "string", enum: ["a", "b"] },
  priority: { type: "integer", minimum: 1, maximum: 100 },
  text: { type: ["string", "null"], minLength: 1 } }, required: ["target", "priority", "text"], additionalProperties: false };
const artifact = createExactStructuredOutputArtifact({ action: "anthropic-test", name: "choice", schema,
  decodeProviderPayload: value => ({ status: "valid", value }), decodeAcceptedValue: value => ({ status: "valid", value }) });
const model = modelCatalogEntryById("anthropic:claude-haiku-5-5")!;
const runtime: ProviderRuntimeDescriptor = { catalogId: model.id, providerProfileId: "anthropic", modelId: model.modelId,
  modelCapabilities: model.capabilities, reasoningPolicy: "low" };
const invocation: ModelInvocation = { messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Choose" }],
  result: { kind: "structured", artifact }, outputTokenLimit: 2048, temperature: 0.7, promptCache: { key: "game", ttl: "30m" } };
const response = (overrides: Record<string, unknown> = {}) => ({ id: "msg_test", type: "message", role: "assistant", model: model.modelId,
  content: [{ type: "thinking", thinking: "A short summary", signature: "opaque-signature" },
    { type: "text", text: '{"target":"a","priority":50,"text":""}' }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 200,
    output_tokens: 70, output_tokens_details: { thinking_tokens: 50 }, service_tier: "standard" }, ...overrides });

describe("native Anthropic", () => {
  test("binds native credentials independently of OpenAI endpoints and permits free Haiku", () => {
    const config = createLlmClientFromEnv({ ANTHROPIC_API_KEY: "fixture", OPENAI_BASE_URL: "http://wrong.invalid" }, { providerProfileId: "anthropic" })!;
    expect(config.client).toBeInstanceOf(Anthropic);
    expect(config.client.baseURL).toBe("https://api.anthropic.com");
    expect(config.client.maxRetries).toBe(0);
    expect(createLlmClientFromEnv({ OPENAI_API_KEY: "other" }, { providerProfileId: "anthropic" })).toBeNull();
    expect(() => assertModelEntitlement({ catalogId: model.id }, false)).not.toThrow();
    expect(model.evaluationStatus).toBe("game-ready");
    expect(modelCatalogEntryById("anthropic:claude-sonnet-5-5")?.evaluationStatus).toBe("evaluation-candidate");
    expect(() => assertModelEntitlement({ catalogId: "anthropic:claude-sonnet-5-5" }, false)).toThrow();
    const routes = createLlmProviderRuntimesFromEnv(resolveProviderManifest([{ catalogId: model.id }]), { ANTHROPIC_API_KEY: "fixture" });
    expect(routes?.[0]?.adapter.id).toBe("anthropic");
  });

  test("compiles exact native requests and preserves usage and private reasoning", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = new Anthropic({ apiKey: "fixture", maxRetries: 0, fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(response()), { headers: { "content-type": "application/json", "request-id": "req_test" } });
    } });
    const adapter = new AnthropicProviderAdapter(client);
    const request = adapter.compile(invocation, runtime);
    const outcome = await adapter.dispatch(request, { maxRetries: 0, headers: {} });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: model.modelId, max_tokens: 2048, system: "Rules",
      thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low", format: { type: "json_schema" } },
      cache_control: { type: "ephemeral", ttl: "5m" } });
    expect(requests[0]).not.toHaveProperty("temperature");
    expect(requests[0]).not.toHaveProperty("prompt_cache_key");
    expect(outcome.accounting?.usage).toEqual({ promptTokens: 1200, cachedTokens: 900, cacheWriteTokens: 200, completionTokens: 70, totalTokens: 1270, reasoningTokens: 50 });
    expect(outcome.reasoning?.summary?.text).toBe("A short summary");
    expect(JSON.stringify(outcome.nativeResponse)).toContain("opaque-signature");
    expect(JSON.parse(outcome.text!)).toEqual({ target: "a", priority: 50, text: null });
  });

  for (const [reason, kind] of [["refusal", "refusal"], ["max_tokens", "undecodable_structured_output"], ["model_context_window_exceeded", "context_overflow"], ["tool_use", "malformed_output"]] as const) {
    test(`rejects ${reason} while retaining billable usage`, async () => {
      const adapter = new AnthropicProviderAdapter(new Anthropic({ apiKey: "fixture", fetch: async () => new Response(JSON.stringify(response({ stop_reason: reason })), { headers: { "content-type": "application/json" } }) }));
      try { await adapter.dispatch(adapter.compile(invocation, runtime), { maxRetries: 0, headers: {} }); throw new Error("accepted invalid outcome"); }
      catch (error) {
        expect(adapter.classifyError(error).kind).toBe(kind);
        expect(error).toHaveProperty("accounting.usage.completionTokens", 70);
        expect(error).toHaveProperty("nativeResponse.id", "msg_test");
      }
    });
  }

  test("native schema preserves nullable, bounded integer and case-sensitive enum constraints", () => {
    const codec = compileAnthropicOutputSchema(schema);
    expect(JSON.parse(codec.decode('```json\n{"target":"a","priority":1,"text":"hi"}\n```'))).toEqual({ target: "a", priority: 1, text: "hi" });
    expect(JSON.parse(codec.decode('{"target":"a","priority":1,"text":""}'))).toEqual({target:"a",priority:1,text:null});
    for (const bad of ['hello', '{', '{}', '{"target":"A","priority":1,"text":""}', '{"target":"a","priority":101,"text":""}', '{"target":"a","priority":1,"text":null}', '{"target":"a","priority":1,"text":"","extra":1}', '{} {}']) expect(() => codec.decode(bad)).toThrow();
    const nullableEnum = compileAnthropicOutputSchema({ type: ["string", "null"], enum: ["a", null] });
    expect(nullableEnum.schema).toMatchObject({type: "string", enum: ["a", ""]});
    expect(compileAnthropicOutputSchema({type: ["integer", "null"], enum: [null]}).schema).toMatchObject({type: "string", enum: [""]});
  });

  test("audits real Werewolf v11, retrospective, and compaction contracts", async () => {
    const events = await completedCurrentWerewolfFixture("anthropic-contract-audit", 11, { playerCount: 6, wolves: 1, seer: true, doctor: true });
    const actions = new Set<string>();
    for (const event of events) {
      if (event.type !== "werewolf.action_accepted") continue;
      actions.add(event.payload.action);
      const contract = werewolfDecisionArtifact(event.payload);
      expect(() => compileAnthropicOutputSchema(contract.providerSchema)).not.toThrow();
    }
    for (const action of ["introduce", "speaking_priority", "conversation", "public_vote", "protect", "investigate", "pack_propose"]) expect(actions.has(action)).toBe(true);
    for (const contract of [retrospectiveSpeechArtifact, contextSummaryArtifact(500)]) {
      expect(() => compileAnthropicOutputSchema(contract.providerSchema)).not.toThrow();
    }
    const bounded = compileAnthropicOutputSchema(contextSummaryArtifact(3).providerSchema);
    expect(JSON.parse(bounded.decode('{"summary":"a\\nb"}'))).toEqual({summary: "a\nb"});
    expect(() => bounded.decode('{"summary":"abcd"}')).toThrow();
  });

  test("bounded arrays have a lossless closed native representation", () => {
    const codec = compileAnthropicOutputSchema({ type: "object", properties: { targets: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", enum: ["a", "b"] } } }, required: ["targets"], additionalProperties: false });
    expect(JSON.parse(codec.decode('{"targets":{"item_1":"b","item_2":"a"}}'))).toEqual({ targets: ["b", "a"] });
    for (const bad of ['{"targets":["a","b"]}', '{"targets":{"item_1":"a"}}', '{"targets":{"item_1":"a","item_2":"b","item_3":"a"}}']) expect(() => codec.decode(bad)).toThrow();
    expect(() => compileAnthropicOutputSchema({ type: "integer", minimum: 0 })).toThrow("exact encoding");
    expect(() => compileAnthropicOutputSchema({ type: "array", maxItems: 2, items: { type: "string" }, const: ["a"] })).toThrow("whole-array");
  });

  test("prices each request including cached input at the exact 100K boundary", () => {
    const card = modelRateCard(model.id)!;
    expect(modelRateCard(model.id, "standard_only")?.rates).toEqual(card.rates);
    expect(modelRateCard(model.id, "standard_only")?.serviceTier).toBe("standard");
    expect(estimateRouteCost({ promptTokens: 100000, completionTokens: 1000, cachedTokens: 0 }, card)).toBeCloseTo(0.0105);
    expect(estimateRouteCost({ promptTokens: 100001, completionTokens: 1000, cachedTokens: 100000 }, card)).toBeCloseTo(0.0075005);
    expect(estimateRouteCost({ promptTokens: 99999, completionTokens: 1, reasoningTokens: 1 }, card)).toBeCloseTo(0.0100004);
    expect(modelRateCard(model.id, "priority")).toBeNull();
    expect(modelRateCard("katana:claude-haiku-4-5")?.rates.inputPer1M).toBe(1.1);
  });
});
