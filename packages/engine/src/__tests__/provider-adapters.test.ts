import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import type { LlmProviderRuntime } from "../llm-client";
import {
  compileChatCompletionsRequest,
  compileMetaMuseResponsesRequest,
  compileOpenAIResponsesRequest,
  createProviderAdapter,
  executeModelInvocation,
  normalizeOpenAIResponse,
} from "../provider-adapters";
import type { ModelInvocation } from "../model-invocation";
import { modelCatalogEntryById } from "../model-catalog";
import { Phase } from "../types";
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
  result: { kind: "structured", artifact: voteArtifact },
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
  catalogId: "openai:gpt-5.6-luna" | "openai:gpt-6-luna" | "katana:grok-4-5" | "katana:grok-4-6" | "katana:glm-5-2" | "meta-muse:muse-spark-1.3-contributor",
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
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
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
  it("repairs the exact rejected draft without changing the frozen context source", async () => {
    const repairArtifact = createExactStructuredOutputArtifact<{ text: string }, { text: string }>({
      action: "test.repair-text.v1", name: "repair_text",
      schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", maxLength: 3 } } },
      acceptedValueUsesProviderSchema: true,
      decodeProviderPayload: value => ({ status: "valid", value }),
      decodeAcceptedValue: value => ({ status: "valid", value: value as { text: string } }),
    });
    const requestBodies: unknown[] = [];
    let attempt = 0;
    const client = { chat: { completions: { create: async (body: unknown) => {
      requestBodies.push(body);
      const text = ++attempt === 1 ? "oversized draft" : "ok";
      return { id: `repair-${attempt}`, choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ text }) } }] };
    } } } } as unknown as OpenAI;
    const providerRuntime = runtime("katana:grok-4-5", client);
    const result = await executeModelInvocation({
      call: new ProviderExecutionCoordinator({ wait: async () => {} }).startCall({ actor: { name: "Dax", role: "player" }, action: repairArtifact.action,
        semantic: { version: 1, kind: "phase_call", phase: Phase.MINGLE, round: 0, canonicalEventSequence: 0, callSlot: 1 } }),
      runtimes: [providerRuntime], maxAttempts: 2,
      invocation: { contextSpans: [{ text: "Frozen history ".repeat(20), format: "text" }],
        messages: [{ role: "user", content: "Say something brief. " + "Frozen history ".repeat(20) }], result: { kind: "structured", artifact: repairArtifact }, outputTokenLimit: 256 },
      validate: (_outcome, value) => value ? { status: "usable", value } : { status: "unusable", kind: "malformed_output", message: "missing" },
    });
    expect(result.value).toEqual({ text: "ok" });
    expect(requestBodies).toHaveLength(2);
    const messages = (requestBodies[1] as { messages: { content: string }[] }).messages;
    expect(messages.at(-1)?.content).toContain('"oversized draft"');
    expect(messages.at(-1)?.content).toContain("measured 15 unicode_code_points, allowed 3 (over by 12)");
    expect(messages.at(-1)?.content).toContain("preserving its intent");
  });

  it("keeps local requests concurrent and uses the local deadline instead of a hosted action deadline", async () => {
    const signals: AbortSignal[] = [];
    const releases: (() => void)[] = [];
    const client = { chat: { completions: { create: async (_body: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      await new Promise<void>(resolve => releases.push(resolve));
      return { id: "local", choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"target":"Atlas"}' } }] };
    } } } } as unknown as OpenAI;
    const local: LlmProviderRuntime = { ...runtime("katana:grok-4-5", client),
      adapter: createProviderAdapter("lm-studio", client), providerProfileId: "lm-studio", catalogId: "lm-studio:test",
      localRequestTimeoutMs: 60_000,
    };
    const run = (slot: number) => executeModelInvocation({
      call: new ProviderExecutionCoordinator().startCall({ actor: { name: "Dax", role: "player" }, action: voteArtifact.action,
        semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: slot } }),
      runtimes: [local], invocation, maxAttempts: 1,
      requestSignalFactory: () => { throw new Error("Hosted two-minute deadline must not apply to LM Studio"); },
      validate: (_outcome, value) => value ? { status: "usable", value } : { status: "unusable", kind: "malformed_output", message: "missing" },
    });
    const results = Promise.all([run(1), run(2)]);
    for (let i = 0; i < 100 && releases.length < 2; i++) await Bun.sleep(1);
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    for (const release of releases) release();
    expect((await results).map(result => result.value)).toEqual([{ target: "Atlas" }, { target: "Atlas" }]);
  });

  it.each(["timeout", "cancel"] as const)("local requests still honor %s", async mode => {
    const controller = new AbortController();
    const client = { chat: { completions: { create: async (_body: unknown, options: { signal: AbortSignal }) => {
      const pending = new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      if (mode === "cancel") controller.abort(new DOMException("Worker stopped", "AbortError"));
      return pending;
    } } } } as unknown as OpenAI;
    const local: LlmProviderRuntime = { ...runtime("katana:grok-4-5", client), adapter: createProviderAdapter("lm-studio", client),
      providerProfileId: "lm-studio", catalogId: "lm-studio:test", localRequestTimeoutMs: mode === "timeout" ? 5 : 60_000 };
    const call = new ProviderExecutionCoordinator().startCall({ actor: { name: "Dax", role: "player" }, action: voteArtifact.action,
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 } });
    await expect(executeModelInvocation({ call, runtimes: [local], invocation, maxAttempts: 1, cancellationSignal: controller.signal,
      validate: () => ({ status: "unusable", kind: "malformed_output", message: "unexpected response" }),
    })).rejects.toMatchObject({ outcome: { kind: mode === "timeout" ? "transport_timeout" : "cancellation" } });
  });
  it("decodes the same exact JSON response on Grok and GLM", async () => {
    const grokClient = {
      chat: {
        completions: {
          create: async () => ({
            id: "chat_native",
            choices: [{
              finish_reason: "stop",
              message: { role: "assistant", content: '{"target":"Atlas"}' },
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
    const grokRuntime = runtime("katana:grok-4-5", grokClient);
    const jsonSchemaRuntime = runtime("katana:glm-5-2", jsonSchemaClient);

    expect(await executeVoteInvocation(grokRuntime)).toEqual({ target: "Atlas" });
    expect(await executeVoteInvocation(jsonSchemaRuntime)).toEqual({ target: "Atlas" });
  });

  it("rejects prose recovery and wrapper envelopes in native JSON-schema responses", async () => {
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

      const error = await rejectedProviderAttempt(executeVoteInvocation(providerRuntime));
      expect(error.record.outcome.kind).toBe(expectedKind);
    }
  });

  it("rejects native tool replies instead of treating their arguments as JSON responses", async () => {
    const client = { chat: { completions: { create: async () => ({
      choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "unexpected", type: "function", function: { name: "cast_vote", arguments: '{"target":"Atlas"}' } }] } }],
    }) } } } as unknown as OpenAI;
    const error = await rejectedProviderAttempt(executeVoteInvocation(runtime("katana:grok-4-5", client)));
    expect(error.record.outcome.kind).toBe("malformed_output");
    expect(error.record.acceptedValue).toBeUndefined();
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
                finish_reason: "stop",
                message: { role: "assistant", content: attempt === 1
                        ? '{"target":"Atlas","extra":true}'
                        : '{"target":"Atlas"}' },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    const providerRuntime = runtime("katana:grok-4-5", client);
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

  it("rejects an inexact durable decision value without dispatching", async () => {
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
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
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

  it.each(["openai:gpt-6-luna", "openai:gpt-5.6-luna"] as const)("compiles %s Responses reasoning with strict JSON schemas and caching", (catalogId) => {
    const client = {} as OpenAI;
    const openai = runtime(catalogId, client);

    const alone = compileOpenAIResponsesRequest(invocation, openai);
    const withFallbacks = compileOpenAIResponsesRequest(invocation, openai);

    expect(withFallbacks).toEqual(alone);
    expect(withFallbacks).toMatchObject({
      model: catalogId.slice("openai:".length),
      input: "Choose one target.",
      store: false,
      service_tier: "flex",
      reasoning: { effort: "medium", summary: "auto" },
      max_output_tokens: 4_096,
      prompt_cache_options: { ttl: "30m" },
    });
    expect(withFallbacks).not.toHaveProperty("tools");
    expect(withFallbacks).not.toHaveProperty("reasoning_effort");
    expect(withFallbacks).not.toHaveProperty("temperature");
    expect(withFallbacks.text?.format).toMatchObject({ type: "json_schema", name: "cast_vote", strict: true });
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
    });
    expect(grokBody).not.toHaveProperty("tools");
    expect(grokBody.response_format).toMatchObject({type: "json_schema"});
    expect(glmBody).toMatchObject({
      model: "glm-5-2",
      max_tokens: 4_096,
      temperature: 0.65,
    });
    expect(glmBody).not.toHaveProperty("reasoning_effort");
    expect(glmBody).not.toHaveProperty("tools");
    expect(glmBody.response_format).toMatchObject({type: "json_schema"});
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
                finish_reason: "stop",
                message: { role: "assistant", content: '{"target":"Atlas"}' },
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
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
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
                finish_reason: "stop",
                message: { role: "assistant", content: '{"target":"Atlas"}' },
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
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
    });

    const result = await executeModelInvocation({
      call,
      runtimes: [
        runtime("openai:gpt-5.6-luna", openaiClient),
        runtime("katana:grok-4-5", katanaClient, 1),
      ],
      invocation,
      maxAttempts: 1,
      validate: (outcome, decoded) => decoded?.target === "Atlas"
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
                finish_reason: "stop",
                message: { role: "assistant", content: '{"target":"Atlas"}' },
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
      semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 2 },
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
      validate: (outcome, decoded) => decoded?.target === "Atlas"
        ? { status: "usable", value: outcome }
        : { status: "unusable", kind: "wrong_tool", message: "missing vote", retryable: false },
    });

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[0]?.aborted).toBeTrue();
    expect(seenSignals[1]?.aborted).toBeFalse();
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
  });

  it("retries an embedded Katana provider error instead of decoding it as a missing tool call", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls++;
            if (calls === 1) return {
              id: "chat_embedded_error", object: "chat.completion", model: "grok-4-5",
              choices: [{ finish_reason: "error", error: { code: 502, message: "Internal error during token parsing", metadata: { error_type: "provider_unavailable" } },
                message: { role: "assistant", content: null, reasoning: "I will submit the tool call." } }],
            };
            return {
              id: "chat_recovered", object: "chat.completion", model: "grok-4-5",
              choices: [{
                finish_reason: "stop",
                message: { role: "assistant", content: '{"target":"Atlas"}' },
              }],
              usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
            };
          },
        },
      },
    } as unknown as OpenAI;
    const katana = runtime("katana:grok-4-5", client);
    expect(await executeVoteInvocation(katana, { maxAttempts: 2 })).toEqual({ target: "Atlas" });
    expect(calls).toBe(2);
  });

  it("compiles Meta Muse decisions to Responses with enforced JSON Schema", () => {
    const meta = runtime("meta-muse:muse-spark-1.3-contributor", {} as OpenAI);
    const body = compileMetaMuseResponsesRequest(invocation, meta) as unknown as Record<string, unknown>;

    expect(body.model).toBe("muse-spark-1.3-contributor");
    expect(body.tool_choice).toBeUndefined();
    expect(body.store).toBe(false);
    expect(body.service_tier).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.text).toMatchObject({format: {type: "json_schema", name: "cast_vote", strict: true}});
    const request = meta.adapter.compile(invocation, meta);
    expect(request.transport).toBe("meta-muse.responses");
  });

  it("compiles Meta Muse structured invocations to strict json_schema text format", () => {
    const meta = runtime("meta-muse:muse-spark-1.3-contributor", {} as OpenAI);
    const body = compileMetaMuseResponsesRequest(structuredInvocation, meta) as unknown as Record<string, unknown>;

    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "pick_target",
        strict: true,
        schema: targetArtifact.schema,
      },
    });
    expect(body.tool_choice).toBeUndefined();
    // The 256-token fixture cap is floored so Meta reasoning tokens cannot
    // starve visible structured output.
    expect(body.max_output_tokens).toBe(2_048);
  });

  it("keeps larger Meta Muse output limits unchanged", () => {
    const meta = runtime("meta-muse:muse-spark-1.3-contributor", {} as OpenAI);
    const body = compileMetaMuseResponsesRequest(invocation, meta) as unknown as Record<string, unknown>;
    expect(body.max_output_tokens).toBe(4_096);
  });

  it("decodes Muse JSON responses and rejects prose", async () => {
    const toolClient = {
      responses: {
        create: async () => ({
          id: "resp_meta_tool",
          status: "completed",
          output: [
            { type: "reasoning", id: "rs_meta", summary: [] },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"target":"Atlas"}' }] },
          ],
          usage: { input_tokens: 532, input_tokens_details: { cached_tokens: 10 }, output_tokens: 102, output_tokens_details: { reasoning_tokens: 32 }, total_tokens: 634 },
        }),
      },
    } as unknown as OpenAI;
    const meta = runtime("meta-muse:muse-spark-1.3-contributor", toolClient);
    expect(await executeVoteInvocation(meta)).toEqual({ target: "Atlas" });

    const outcome = normalizeOpenAIResponse({
      id: "resp_meta_tool",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"target":"Atlas"}' }] }],
    } as never, undefined, "meta-muse.responses");
    expect(outcome.transport).toBe("meta-muse.responses");
    expect(outcome.toolCalls).toEqual([]);
    expect(outcome.text).toBe('{"target":"Atlas"}');

    const proseClient = {
      responses: {
        create: async () => ({
          id: "resp_meta_prose",
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "I vote for Atlas." }] }],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      },
    } as unknown as OpenAI;
    const proseMeta = runtime("meta-muse:muse-spark-1.3-contributor", proseClient);
    const error = await rejectedProviderAttempt(executeVoteInvocation(proseMeta));
    expect(error.outcome.kind).toBe("undecodable_structured_output");
  });
});


describe("nullable normalization across native transports", () => {
  it.each(["responses-structured", "chat-structured"])(
    "normalizes within the attempt and preserves native evidence for %s", async (mode) => {
      const artifact = createExactStructuredOutputArtifact<{ target: string | null }, { target: string | null }>({
        action: "test.null-target.v1", name: "null_target",
        schema: { type: "object", additionalProperties: false, required: ["target"], properties: {
          target: { type: ["string", "null"], enum: ["Atlas", null] },
        } },
        acceptedValueUsesProviderSchema: true,
        decodeProviderPayload: (value) => ({ status: "valid", value }),
        decodeAcceptedValue: (value) => ({ status: "valid", value: value as { target: string | null } }),
      });
      const isResponses = mode.startsWith("responses");
      const raw = '{"target":"null"}';
      const native = isResponses ? {
        id: "resp_null", object: "response", status: "completed",
        output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: raw, annotations: [] }] }],
      } : {
        id: "chat_null", choices: [{ finish_reason: "stop", message: {
          role: "assistant", content: raw,
        } }],
      };
      const before = structuredClone(native);
      const client = {
        responses: { create: async () => native },
        chat: { completions: { create: async () => native } },
      } as unknown as OpenAI;
      const provider = runtime(isResponses ? "openai:gpt-5.6-luna" : "katana:grok-4-5", client);
      const records: ProviderAttemptRecord[] = [];
      const call = new ProviderExecutionCoordinator({ wait: async () => {}, hooks: {
        onTerminal: (record) => { records.push(record); },
      } }).startCall({
        actor: { name: "Atlas", role: "player" }, action: artifact.action,
        semantic: { version: 1, kind: "phase_call", phase: Phase.MINGLE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
      });
      const result = await executeModelInvocation({
        call, runtimes: [provider], maxAttempts: 1,
        invocation: { messages: [{ role: "user", content: "Choose no target." }], outputTokenLimit: 256,
          result: { kind: "structured", artifact },
        },
        validate: (_outcome, decoded) => decoded?.target === null
          ? { status: "usable", value: decoded }
          : { status: "unusable", kind: "malformed_output", message: "target must be absent" },
      });
      expect(result.value).toEqual({ target: null });
      expect(records.map((record) => record.outcome.kind)).toEqual(["usable"]);
      expect(result.liveOutcome?.nativeResponse).toEqual(before);
      expect(native).toEqual(before);
    },
  );
});

describe("vision invocation contracts", () => {
  const image = { url: "https://assets.example.test/scene.png", detail: "high" as const };
  const visual: ModelInvocation = {
    messages: [{ role: "system", content: "Play Influence." }, { role: "user", content: "Read your room.", images: [image] }],
    result: { kind: "text" }, outputTokenLimit: 100,
  };
  const client = {} as OpenAI;

  it("routes GPT-6 Luna image decisions through Responses with reasoning and strict JSON schemas", () => {
    const provider = runtime("openai:gpt-6-luna", client);
    provider.reasoningPolicy = "high";
    const invocation: ModelInvocation = {
      ...visual,
      result: { kind: "structured", artifact: targetArtifact },
      reasoning: { effort: "high" },
      temperature: 0.7,
      promptCache: { key: "luna-visual", ttl: "30m" },
    };
    expect(provider.adapter.validate(invocation, provider).compatible).toBe(true);
    const request = provider.adapter.compile(invocation, provider);
    expect(request.transport).toBe("openai.responses");
    expect(request.body).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "high" },
      prompt_cache_options: { ttl: "30m" },
      text: { format: { type: "json_schema", name: targetArtifact.name, strict: true } },
      input: [{ role: "user", content: [
        { type: "input_text", text: "Read your room." },
        { type: "input_image", image_url: image.url, detail: "high" },
      ] }],
    });
    expect(request.body).not.toHaveProperty("temperature");
  });

  it("keeps the image in single-user Responses inputs and translates Katana attachments", () => {
    const openai = runtime("openai:gpt-5.6-luna", client);
    expect(compileOpenAIResponsesRequest(visual, openai).input).toEqual([
      { role: "user", content: [
        { type: "input_text", text: "Read your room." },
        { type: "input_image", image_url: image.url, detail: "high" },
      ] },
    ]);
    const katana = runtime("katana:grok-4-6", client);
    expect(compileChatCompletionsRequest(visual, katana).messages[1]).toEqual({
      role: "user", content: [
        { type: "text", text: "Read your room." },
        { type: "image_url", image_url: image },
      ],
    });
  });

  it("rejects unsupported vision instead of silently dropping image context", () => {
    const unsupported = runtime("katana:grok-4-5", client);
    expect(unsupported.adapter.validate(visual, unsupported).compatible).toBe(false);
    expect(() => compileChatCompletionsRequest(visual, unsupported)).toThrow("image inputs are unsupported");
  });

  it("rejects image attachments on instruction roles and invalid image URLs", () => {
    const openai = runtime("openai:gpt-5.6-luna", client);
    for (const role of ["system", "developer", "assistant", "tool"] as const) {
      expect(() => compileOpenAIResponsesRequest({ ...visual, messages: [{ role, content: "test", images: [image] }] }, openai))
        .toThrow("image inputs require a user message");
    }
    expect(() => compileOpenAIResponsesRequest({ ...visual, messages: [{ role: "user", content: "test", images: [{ ...image, url: "file:///etc/passwd" }] }] }, openai))
      .toThrow("invalid image input");
  });
});
