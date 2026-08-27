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
  ProviderAcceptedValueIntegrityError,
  ProviderAttemptError,
  ProviderExecutionCoordinator,
  type ProviderAttemptRecord,
} from "../provider-execution";
import { createExactStructuredOutputArtifact } from "../structured-output";

const voteArtifact = createExactStructuredOutputArtifact<
  { target: string },
  { target: string }
>({
  action: "test.cast-vote.v1",
  name: "cast_vote",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["target"],
    properties: { target: { type: "string" } },
  },
  acceptedValueUsesProviderSchema: true,
  decodeProviderPayload: (value) => ({ status: "valid", value }),
  decodeAcceptedValue: (value) => ({
    status: "valid",
    value: value as { target: string },
  }),
});

const invocation: ModelInvocation<{ target: string }> = {
  messages: [
    { role: "system", content: "Play Influence." },
    { role: "user", content: "Choose one target." },
  ],
  result: {
    kind: "tool",
    artifact: voteArtifact,
    description: "Cast one legal vote.",
    choice: { name: "cast_vote" },
    allowParallel: false,
  },
  outputTokenLimit: 4_096,
  reasoning: { effort: "medium", summary: "auto" },
  temperature: 0.65,
  promptCache: { key: "influence:test", ttl: "30m" },
};

const targetArtifact = createExactStructuredOutputArtifact<
  { target: "Atlas" | "Blair" },
  { targetPlayerId: string }
>({
  action: "test.pick-target.v1",
  name: "pick_target",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["target"],
    properties: { target: { type: "string", enum: ["Atlas", "Blair"] } },
  },
  decodeProviderPayload: (payload) => ({
    status: "valid",
    value: { targetPlayerId: payload.target === "Atlas" ? "atlas-id" : "blair-id" },
  }),
  decodeAcceptedValue: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { status: "invalid", message: "Accepted target must be an object." };
    }
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 1
      || (record.targetPlayerId !== "atlas-id" && record.targetPlayerId !== "blair-id")
    ) {
      return { status: "invalid", message: "Accepted target must contain one legal player id." };
    }
    return { status: "valid", value: { targetPlayerId: record.targetPlayerId } };
  },
});

const structuredInvocation: ModelInvocation<{ targetPlayerId: string }> = {
  messages: [{ role: "user", content: "Pick Atlas or Blair." }],
  result: { kind: "structured", artifact: targetArtifact },
  outputTokenLimit: 256,
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

async function executeVoteInvocation(
  providerRuntime: LlmProviderRuntime,
  options?: {
    maxAttempts?: number;
    coordinator?: ProviderExecutionCoordinator;
  },
): Promise<{ target: string }> {
  const call = (options?.coordinator ?? new ProviderExecutionCoordinator({ wait: async () => {} }))
    .startCall({
      actor: { name: "Dax", role: "player" },
      action: voteArtifact.action,
      logicalCallOrdinal: 1,
    });
  const result = await executeModelInvocation({
    call,
    runtimes: [providerRuntime],
    invocation,
    maxAttempts: options?.maxAttempts ?? 1,
    validate: (_outcome, decoded) => decoded
      ? { status: "usable", value: decoded }
      : { status: "unusable", kind: "malformed_output", message: "missing decoded vote" },
  });
  return result.value;
}

async function rejectedProviderAttempt(
  promise: Promise<unknown>,
): Promise<ProviderAttemptError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderAttemptError);
    return error as ProviderAttemptError;
  }
  throw new Error("Expected provider attempt rejection");
}

describe("provider-native adapters", () => {
  it("decodes the same exact tool arguments through native tools and json_schema compatibility", async () => {
    const nativeClient = {
      chat: {
        completions: {
          create: async () => ({
            id: "chat_native",
            choices: [{
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_native",
                  type: "function",
                  function: { name: "cast_vote", arguments: '{"target":"Atlas"}' },
                }],
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;
    const jsonSchemaClient = {
      chat: {
        completions: {
          create: async () => ({
            id: "chat_json_schema",
            choices: [{
              finish_reason: "stop",
              message: { role: "assistant", content: '{"target":"Atlas"}' },
            }],
          }),
        },
      },
    } as unknown as OpenAI;
    const nativeRuntime = runtime("katana:grok-4-5", nativeClient);
    nativeRuntime.toolChoiceMode = "named";
    const jsonSchemaRuntime = runtime("katana:glm-5-2", jsonSchemaClient);
    jsonSchemaRuntime.toolChoiceMode = "json_schema";

    expect(await executeVoteInvocation(nativeRuntime)).toEqual({ target: "Atlas" });
    expect(await executeVoteInvocation(jsonSchemaRuntime)).toEqual({ target: "Atlas" });
  });

  it("rejects prose recovery and wrapper envelopes in json_schema compatibility", async () => {
    const cases = [
      ["plain text", "undecodable_structured_output"],
      ["```json\n{\"target\":\"Atlas\"}\n```", "undecodable_structured_output"],
      ["Before {\"target\":\"Atlas\"} after", "undecodable_structured_output"],
      ['{"arguments":{"target":"Atlas"}}', "malformed_output"],
      ['{"toolName":"cast_vote","target":"Atlas"}', "malformed_output"],
      ["{}", "malformed_output"],
      ['{"target":"Atlas","extra":true}', "malformed_output"],
    ] as const;

    for (const [content, expectedKind] of cases) {
      const client = {
        chat: {
          completions: {
            create: async () => ({
              id: "chat_invalid_json_schema",
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content },
              }],
            }),
          },
        },
      } as unknown as OpenAI;
      const providerRuntime = runtime("katana:glm-5-2", client);
      providerRuntime.toolChoiceMode = "json_schema";

      const error = await rejectedProviderAttempt(executeVoteInvocation(providerRuntime));
      expect(error.record.outcome.kind).toBe(expectedKind);
    }
  });

  it("keeps native tool envelope failures typed by decode stage", async () => {
    const cases: Array<{
      toolCalls: unknown[];
      expectedKind: "wrong_tool" | "undecodable_structured_output" | "malformed_output";
    }> = [
      { toolCalls: [], expectedKind: "wrong_tool" },
      {
        toolCalls: [{
          id: "wrong",
          type: "function",
          function: { name: "other_tool", arguments: '{"target":"Atlas"}' },
        }],
        expectedKind: "wrong_tool",
      },
      {
        toolCalls: [{
          id: "truncated",
          type: "function",
          function: { name: "cast_vote", arguments: '{"target":' },
        }],
        expectedKind: "undecodable_structured_output",
      },
      {
        toolCalls: [{
          id: "missing",
          type: "function",
          function: { name: "cast_vote", arguments: "{}" },
        }],
        expectedKind: "malformed_output",
      },
      {
        toolCalls: [{
          id: "extra",
          type: "function",
          function: { name: "cast_vote", arguments: '{"target":"Atlas","extra":true}' },
        }],
        expectedKind: "malformed_output",
      },
    ];

    for (const testCase of cases) {
      const client = {
        chat: {
          completions: {
            create: async () => ({
              id: "chat_invalid_native",
              choices: [{
                finish_reason: testCase.toolCalls.length > 0 ? "tool_calls" : "stop",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: testCase.toolCalls,
                },
              }],
            }),
          },
        },
      } as unknown as OpenAI;
      const providerRuntime = runtime("katana:grok-4-5", client);
      providerRuntime.toolChoiceMode = "named";

      const error = await rejectedProviderAttempt(executeVoteInvocation(providerRuntime));
      expect(error.record.outcome.kind).toBe(testCase.expectedKind);
    }
  });

  it("retries a malformed native envelope and accepts only the exact recovery", async () => {
    let attempt = 0;
    const records: ProviderAttemptRecord[] = [];
    const client = {
      chat: {
        completions: {
          create: async () => {
            attempt += 1;
            return {
              id: `chat_retry_${attempt}`,
              choices: [{
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: `call_${attempt}`,
                    type: "function",
                    function: {
                      name: "cast_vote",
                      arguments: attempt === 1
                        ? '{"target":"Atlas","extra":true}'
                        : '{"target":"Atlas"}',
                    },
                  }],
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    const providerRuntime = runtime("katana:grok-4-5", client);
    providerRuntime.toolChoiceMode = "named";
    const coordinator = new ProviderExecutionCoordinator({
      wait: async () => {},
      hooks: { onTerminal: (record) => { records.push(record); } },
    });

    expect(await executeVoteInvocation(providerRuntime, {
      maxAttempts: 2,
      coordinator,
    })).toEqual({ target: "Atlas" });
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
    expect(records[0]?.acceptedValue).toBeUndefined();
    expect(records[1]?.acceptedValue).toEqual({ target: "Atlas" });
  });

  it("rejects an inexact durable tool value without dispatching", async () => {
    let dispatches = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            dispatches += 1;
            throw new Error("dispatch must not run");
          },
        },
      },
    } as unknown as OpenAI;
    const providerRuntime = runtime("katana:grok-4-5", client);
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onReadAccepted: () => ({
          attemptOrdinal: 1,
          value: { target: "Atlas", extra: true },
        }),
      },
    });

    await expect(executeVoteInvocation(providerRuntime, { coordinator }))
      .rejects.toBeInstanceOf(ProviderAcceptedValueIntegrityError);
    expect(dispatches).toBe(0);
  });

  it("compiles and validates the same exact structured artifact across adapters", async () => {
    const client = {} as OpenAI;
    const openaiBody = compileOpenAIResponsesRequest(
      structuredInvocation,
      runtime("openai:gpt-5.6-luna", client),
    );
    const chatBody = compileChatCompletionsRequest(
      structuredInvocation,
      runtime("katana:glm-5-2", client),
    );
    expect(openaiBody).toMatchObject({
      text: {
        format: {
          type: "json_schema",
          name: targetArtifact.name,
          strict: true,
          schema: targetArtifact.schema,
        },
      },
    });
    expect(chatBody).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: targetArtifact.name,
          strict: true,
          schema: targetArtifact.schema,
        },
      },
    });

    const records: ProviderAttemptRecord[] = [];
    let attempt = 0;
    const provider = {
      chat: {
        completions: {
          create: async () => {
            attempt += 1;
            return {
              id: `chat_${attempt}`,
              choices: [{
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: attempt === 1
                    ? '{"target":"Atlas","extra":true}'
                    : '{"target":"Blair"}',
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    const call = new ProviderExecutionCoordinator({
      wait: async () => {},
      hooks: { onTerminal: (record) => { records.push(record); } },
    }).startCall({
      actor: { name: "House", role: "house" },
      action: targetArtifact.action,
      logicalCallOrdinal: 1,
    });
    const result = await executeModelInvocation({
      call,
      runtimes: [runtime("katana:glm-5-2", provider)],
      invocation: structuredInvocation,
      maxAttempts: 2,
      validate: (_outcome, decoded) => decoded
        ? { status: "usable", value: decoded }
        : { status: "unusable", kind: "malformed_output", message: "missing decoded value" },
    });

    expect(result.value).toEqual({ targetPlayerId: "blair-id" });
    expect(result.liveOutcome?.responseId).toBe("chat_2");
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "malformed_output",
      "usable",
    ]);
  });

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
