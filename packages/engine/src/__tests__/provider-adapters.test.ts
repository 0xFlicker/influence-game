import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import type { LlmProviderRuntime } from "../llm-client";
import {
  compileChatCompletionsRequest,
  compileOpenAIResponsesRequest,
  createProviderAdapter,
  executeModelInvocation,
} from "../provider-adapters";
import type { ModelInvocation } from "../model-invocation";
import { modelCatalogEntryById } from "../model-catalog";
import {
  ProviderExecutionCoordinator,
  type ProviderAttemptRecord,
} from "../provider-execution";

const invocation: ModelInvocation = {
  messages: [
    { role: "system", content: "Play Influence." },
    { role: "user", content: "Choose one target." },
  ],
  result: {
    kind: "tool",
    tools: [{
      name: "cast_vote",
      description: "Cast one legal vote.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["target"],
        properties: { target: { type: "string" } },
      },
    }],
    choice: { name: "cast_vote" },
    allowParallel: false,
  },
  outputTokenLimit: 4_096,
  reasoning: { effort: "medium", summary: "auto" },
  temperature: 0.65,
  promptCache: { key: "influence:test", ttl: "30m" },
};

function runtime(
  catalogId: "openai:gpt-5.6-luna" | "katana:grok-4-5" | "katana:glm-5-2",
  client: OpenAI,
  position = 0,
): LlmProviderRuntime {
  const model = modelCatalogEntryById(catalogId);
  if (!model) throw new Error(`Missing ${catalogId}`);
  return {
    adapter: createProviderAdapter(model.providerProfileId, client),
    catalogId,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    modelCapabilities: model.capabilities,
    reasoningPolicy: "medium",
    toolChoiceMode: model.preferredToolChoiceMode ?? "named",
    ...(model.providerProfileId === "openai" && {
      openAIReasoningSummary: "auto" as const,
      openAIServiceTier: "flex" as const,
    }),
    position,
    role: position === 0 ? "primary" : "fallback",
    ...(position > 0 && { maxCallsPerGame: 20 }),
  };
}

describe("provider-native adapters", () => {
  it("compiles the identical OpenAI Responses request regardless of fallback presence", () => {
    const client = {} as OpenAI;
    const openai = runtime("openai:gpt-5.6-luna", client);

    const alone = compileOpenAIResponsesRequest(invocation, openai);
    const withFallbacks = compileOpenAIResponsesRequest(invocation, openai);

    expect(withFallbacks).toEqual(alone);
    expect(withFallbacks).toMatchObject({
      model: "gpt-5.6-luna",
      input: "Choose one target.",
      store: false,
      service_tier: "flex",
      reasoning: { effort: "medium", summary: "auto" },
      max_output_tokens: 4_096,
    });
    expect(withFallbacks).toHaveProperty("tools");
    expect(withFallbacks).not.toHaveProperty("reasoning_effort");
  });

  it("preserves Grok options while GLM omits only unsupported options", () => {
    const client = {} as OpenAI;
    const grok = runtime("katana:grok-4-5", client);
    const glm = runtime("katana:glm-5-2", client);

    const grokBody = compileChatCompletionsRequest(invocation, grok);
    const glmBody = compileChatCompletionsRequest(invocation, glm);

    expect(grokBody).toMatchObject({
      model: "grok-4-5",
      max_tokens: 4_096,
      temperature: 0.65,
      reasoning_effort: "medium",
      parallel_tool_calls: false,
    });
    expect(grokBody).toHaveProperty("tools");
    expect(glmBody).toMatchObject({
      model: "glm-5-2",
      max_tokens: 4_096,
      temperature: 0.65,
      parallel_tool_calls: false,
    });
    expect(glmBody).not.toHaveProperty("reasoning_effort");
    expect(glmBody).toHaveProperty("tools");
  });

  it("does not change a Katana primary request when an OpenAI fallback is present", () => {
    const client = {} as OpenAI;
    const katana = runtime("katana:grok-4-5", client);

    const alone = compileChatCompletionsRequest(invocation, katana);
    const withOpenAIFallback = compileChatCompletionsRequest(invocation, katana);

    expect(withOpenAIFallback).toEqual(alone);
  });

  it("skips an incompatible entry without dispatching or degrading the invocation", async () => {
    let incompatibleDispatches = 0;
    const katanaRequests: unknown[] = [];
    const incompatibleClient = {
      responses: { create: async () => { incompatibleDispatches += 1; } },
    } as unknown as OpenAI;
    const katanaClient = {
      chat: {
        completions: {
          create: async (body: unknown) => {
            katanaRequests.push(body);
            return {
              id: "chat_ok",
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "cast_vote", arguments: '{"target":"Atlas"}' },
                  }],
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    const incompatible = runtime("openai:gpt-5.6-luna", incompatibleClient);
    incompatible.modelCapabilities = {
      ...incompatible.modelCapabilities,
      supportsTools: false,
      supportsStructuredOutput: false,
    };
    const call = new ProviderExecutionCoordinator().startCall({
      actor: { name: "Dax", role: "player" },
      action: "vote",
      logicalCallOrdinal: 1,
    });

    const result = await executeModelInvocation({
      call,
      runtimes: [incompatible, runtime("katana:grok-4-5", katanaClient, 1)],
      invocation,
      maxAttempts: 1,
      validate: (outcome) => ({ status: "usable", value: outcome }),
    });

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(incompatibleDispatches).toBe(0);
    expect(katanaRequests).toHaveLength(1);
    expect(katanaRequests[0]).toMatchObject({
      model: "grok-4-5",
      reasoning_effort: "medium",
      temperature: 0.65,
    });
  });

  it("falls from OpenAI Responses to an independently compiled Katana chat request", async () => {
    const openaiRequests: unknown[] = [];
    const katanaRequests: unknown[] = [];
    const openaiClient = {
      responses: {
        create: async (body: unknown) => {
          openaiRequests.push(body);
          return {
            id: "resp_refused",
            object: "response",
            status: "failed",
            output: [],
            error: { code: "invalid_prompt", message: "rejected" },
          };
        },
      },
    } as unknown as OpenAI;
    const katanaClient = {
      chat: {
        completions: {
          create: async (body: unknown) => {
            katanaRequests.push(body);
            return {
              id: "chat_ok",
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "cast_vote",
                      arguments: '{"target":"Atlas"}',
                    },
                  }],
                },
              }],
              _request_id: "req_katana_1",
              usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                completion_tokens_details: { reasoning_tokens: 2 },
                imgnai: { cost_usd: 0.0025, amount: 7, unit: "credit" },
              },
            };
          },
        },
      },
    } as unknown as OpenAI;
    const records: ProviderAttemptRecord[] = [];
    const coordinator = new ProviderExecutionCoordinator({
      wait: async () => {},
      hooks: { onTerminal: (record) => { records.push(record); } },
    });
    const call = coordinator.startCall({
      actor: { name: "Dax", role: "player" },
      action: "vote",
      logicalCallOrdinal: 1,
    });

    const result = await executeModelInvocation({
      call,
      runtimes: [
        runtime("openai:gpt-5.6-luna", openaiClient),
        runtime("katana:grok-4-5", katanaClient, 1),
      ],
      invocation,
      maxAttempts: 1,
      validate: (outcome) => outcome.toolCalls[0]?.name === "cast_vote"
        ? { status: "usable", value: outcome }
        : {
            status: "unusable",
            kind: "wrong_tool",
            message: "missing cast_vote",
            retryable: false,
          },
    });

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(openaiRequests).toHaveLength(1);
    expect(openaiRequests[0]).toHaveProperty("max_output_tokens", 4_096);
    expect(katanaRequests).toHaveLength(1);
    expect(katanaRequests[0]).toHaveProperty("max_tokens", 4_096);
    expect(katanaRequests[0]).toHaveProperty("reasoning_effort", "medium");
    expect(records.map((record) => [
      record.attemptOrdinal,
      record.preparedRequest.transport,
      record.disposition,
    ])).toEqual([
      [1, "openai.responses", "exhausted"],
      [2, "katana.chat_completions", "accepted"],
    ]);
    expect(result.value).toMatchObject({
      requestId: "req_katana_1",
      accounting: {
        usage: { totalTokens: 14, reasoningTokens: 2 },
        actualCostMicrousd: 2500,
        actualCostSource: "router_actual",
        providerNativeUnit: "credit",
        providerNativeAmount: "7",
      },
    });
    expect(records[0]?.rawResponse?.body).toMatchObject({
      id: "resp_refused",
      error: { code: "invalid_prompt" },
    });
  });

  it("creates a fresh request deadline for each manifest dispatch", async () => {
    const seenSignals: Array<AbortSignal | undefined> = [];
    const primaryClient = {
      responses: {
        create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
          seenSignals.push(options?.signal);
          if (options?.signal?.aborted) {
            throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
          }
          throw Object.assign(new Error("Request timed out."), { name: "APITimeoutError" });
        },
      },
    } as unknown as OpenAI;
    const fallbackClient = {
      chat: {
        completions: {
          create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
            seenSignals.push(options?.signal);
            if (options?.signal?.aborted) {
              throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
            }
            return {
              id: "chat_ok",
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "cast_vote", arguments: '{"target":"Atlas"}' },
                  }],
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    let deadlineOrdinal = 0;
    const call = new ProviderExecutionCoordinator({ wait: async () => {} }).startCall({
      actor: { name: "Dax", role: "player" },
      action: "vote",
      logicalCallOrdinal: 2,
    });

    const result = await executeModelInvocation({
      call,
      runtimes: [
        runtime("openai:gpt-5.6-luna", primaryClient),
        runtime("katana:grok-4-5", fallbackClient, 1),
      ],
      invocation,
      maxAttempts: 1,
      requestSignalFactory: () => {
        deadlineOrdinal += 1;
        return deadlineOrdinal === 1
          ? AbortSignal.abort(new DOMException("Timed out", "AbortError"))
          : new AbortController().signal;
      },
      validate: (outcome) => outcome.toolCalls[0]?.name === "cast_vote"
        ? { status: "usable", value: outcome }
        : { status: "unusable", kind: "wrong_tool", message: "missing vote", retryable: false },
    });

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[0]?.aborted).toBeTrue();
    expect(seenSignals[1]?.aborted).toBeFalse();
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
  });
});
