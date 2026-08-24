import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import type { LlmProviderRuntime } from "./llm-client";
import type {
  LlmProviderAdapter,
  ModelInvocation,
  ModelInvocationMessage,
  ModelInvocationTool,
  ProviderModelOutcome,
  ProviderNativeRequest,
  ProviderNormalizedToolCall,
  ProviderRuntimeDescriptor,
} from "./model-invocation";
import {
  classifyProviderError,
  classifyResponsesTerminalOutcome,
  type ProviderAttemptAccountingFacts,
  type ProviderAttemptRecord,
  type ProviderAttemptFailureOutcome,
  type ProviderCandidateValidation,
  type ProviderLogicalCallExecution,
  type ProviderManifestCallResult,
} from "./provider-execution";

interface AdapterBackedRuntime extends ProviderRuntimeDescriptor {
  adapter: LlmProviderAdapter;
}

export interface ExecuteModelInvocationOptions<TValue> {
  call: ProviderLogicalCallExecution;
  runtimes: readonly LlmProviderRuntime[];
  invocation: ModelInvocation | (() => ModelInvocation);
  maxAttempts: number;
  cancellationSignal?: AbortSignal;
  requestSignal?: AbortSignal;
  validate(outcome: ProviderModelOutcome): ProviderCandidateValidation<TValue>;
  onRetry?(record: ProviderAttemptRecord): Promise<void> | void;
}

/**
 * Execute one semantic invocation through the sealed manifest. Every entry
 * compiles and dispatches through its own adapter; no native request is reused
 * or rewritten for another provider.
 */
export async function executeModelInvocation<TValue>(
  options: ExecuteModelInvocationOptions<TValue>,
): Promise<ProviderManifestCallResult<TValue>> {
  const compiledByAttempt = new Map<string, ProviderNativeRequest>();
  return options.call.executeManifest<ProviderModelOutcome, TValue>({
    entries: options.runtimes.map((runtime) => {
      const adapterRuntime = runtime as AdapterBackedRuntime;
      const invocation = () =>
        typeof options.invocation === "function"
          ? options.invocation()
          : options.invocation;
      const compile = (attemptOrdinal: number): ProviderNativeRequest => {
        const semanticCall = invocation();
        const prepared = adapterRuntime.adapter.compile(
          semanticCall,
          adapterRuntime,
        );
        compiledByAttempt.set(`${runtime.catalogId}:${attemptOrdinal}`, prepared);
        return prepared;
      };
      return {
        catalogId: runtime.catalogId,
        compatibility: () =>
          adapterRuntime.adapter.validate(invocation(), adapterRuntime),
        preparedRequest: (attemptOrdinal) => {
          const prepared = compile(attemptOrdinal);
          return {
            transport: prepared.transport,
            providerProfileId: runtime.providerProfileId,
            catalogId: runtime.catalogId,
            model: runtime.modelId,
            body: prepared.body,
          };
        },
        maxAttempts: options.maxAttempts,
        dispatch: ({ attemptOrdinal, requestOptions }) => {
          const key = `${runtime.catalogId}:${attemptOrdinal}`;
          const prepared = compiledByAttempt.get(key) ?? compile(attemptOrdinal);
          compiledByAttempt.delete(key);
          return adapterRuntime.adapter.dispatch(prepared, {
            ...requestOptions,
            ...((requestOptions.signal || options.requestSignal) && {
              signal: requestOptions.signal && options.requestSignal
                ? AbortSignal.any([requestOptions.signal, options.requestSignal])
                : requestOptions.signal ?? options.requestSignal,
            }),
          });
        },
        validate: options.validate,
        classifyError: (error, signal) =>
          adapterRuntime.adapter.classifyError(error, signal),
        accounting: (outcome) => outcome.accounting,
        requestId: (outcome) => outcome.requestId,
        nativeResponse: (outcome) => outcome.nativeResponse,
        ...(options.onRetry && { onRetry: options.onRetry }),
      };
    }),
    ...(options.cancellationSignal && {
      cancellationSignal: options.cancellationSignal,
    }),
  });
}

abstract class OpenAICompatibleAdapter implements LlmProviderAdapter {
  abstract readonly id: string;

  constructor(protected readonly client: OpenAI) {}

  validate(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ) {
    if (
      invocation.result.kind === "tool" &&
      !runtime.modelCapabilities.supportsTools &&
      !(
        runtime.toolChoiceMode === "json_schema" &&
        runtime.modelCapabilities.supportsStructuredOutput &&
        invocation.result.tools.length === 1
      )
    ) {
      return { compatible: false, reason: "function tools are unsupported" };
    }
    if (
      invocation.result.kind === "structured" &&
      !runtime.modelCapabilities.supportsStructuredOutput
    ) {
      return { compatible: false, reason: "strict structured output is unsupported" };
    }
    return { compatible: true };
  }

  abstract compile(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderNativeRequest;

  abstract dispatch(
    request: ProviderNativeRequest,
    options: Parameters<LlmProviderAdapter["dispatch"]>[1],
  ): Promise<ProviderModelOutcome>;

  classifyError(
    error: unknown,
    signal?: AbortSignal,
  ): ProviderAttemptFailureOutcome {
    if (
      error instanceof ProviderNativeOutcomeError ||
      error instanceof ProviderNativeDecodeError
    ) return error.outcome;
    return classifyProviderError(error, signal);
  }
}

export class OpenAIProviderAdapter extends OpenAICompatibleAdapter {
  readonly id = "openai";

  compile(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderNativeRequest {
    return runtime.modelCapabilities.supportsOpenAIResponses
      ? {
          transport: "openai.responses",
          body: compileOpenAIResponsesRequest(invocation, runtime),
        }
      : {
          transport: "openai.chat_completions",
          body: compileChatCompletionsRequest(invocation, runtime),
        };
  }

  async dispatch(
    request: ProviderNativeRequest,
    options: Parameters<LlmProviderAdapter["dispatch"]>[1],
  ): Promise<ProviderModelOutcome> {
    if (request.transport === "openai.responses") {
      const response = await this.client.responses.create(
        request.body as ResponseCreateParamsNonStreaming,
        options,
      );
      const terminal = classifyResponsesTerminalOutcome(response);
      if (terminal) throw new ProviderNativeOutcomeError(terminal, response);
      const reasoning = asRecord(asRecord(request.body).reasoning);
      const requestedSummary = readString(reasoning.summary);
      try {
        return normalizeOpenAIResponse(
          response,
          requestedSummary === "auto" || requestedSummary === "concise" || requestedSummary === "detailed"
            ? requestedSummary
            : undefined,
        );
      } catch {
        throw new ProviderNativeDecodeError(response);
      }
    }
    const response = await this.client.chat.completions.create(
      request.body as ChatCompletionCreateParamsNonStreaming,
      options,
    );
    try {
      return normalizeChatCompletion(response, request.transport);
    } catch {
      throw new ProviderNativeDecodeError(response);
    }
  }

  override classifyError(
    error: unknown,
    signal?: AbortSignal,
  ): ProviderAttemptFailureOutcome {
    return super.classifyError(error, signal);
  }
}

export class KatanaProviderAdapter extends OpenAICompatibleAdapter {
  readonly id = "katana";

  compile(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderNativeRequest {
    return {
      transport: "katana.chat_completions",
      body: compileChatCompletionsRequest(invocation, runtime),
    };
  }

  async dispatch(
    request: ProviderNativeRequest,
    options: Parameters<LlmProviderAdapter["dispatch"]>[1],
  ): Promise<ProviderModelOutcome> {
    const response = await this.client.chat.completions.create(
      request.body as ChatCompletionCreateParamsNonStreaming,
      options,
    );
    try {
      return normalizeChatCompletion(response, request.transport);
    } catch {
      throw new ProviderNativeDecodeError(response);
    }
  }
}

export class OpenAICompatibleChatAdapter extends OpenAICompatibleAdapter {
  readonly id = "openai-compatible-chat";

  compile(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderNativeRequest {
    return {
      transport: `${runtime.providerProfileId}.chat_completions`,
      body: compileChatCompletionsRequest(invocation, runtime),
    };
  }

  async dispatch(
    request: ProviderNativeRequest,
    options: Parameters<LlmProviderAdapter["dispatch"]>[1],
  ): Promise<ProviderModelOutcome> {
    const response = await this.client.chat.completions.create(
      request.body as ChatCompletionCreateParamsNonStreaming,
      options,
    );
    try {
      return normalizeChatCompletion(response, request.transport);
    } catch {
      throw new ProviderNativeDecodeError(response);
    }
  }
}

class ProviderNativeOutcomeError extends Error {
  constructor(
    readonly outcome: ProviderAttemptFailureOutcome,
    readonly nativeResponse: unknown,
  ) {
    super(outcome.message);
    this.name = "ProviderNativeOutcomeError";
  }
}

class ProviderNativeDecodeError extends Error {
  readonly outcome: ProviderAttemptFailureOutcome = {
    kind: "undecodable_structured_output",
    message: "provider_native_response_decode_failed",
    retryable: false,
  };
  readonly accounting: ProviderAttemptAccountingFacts | undefined;
  readonly requestId: string | undefined;

  constructor(readonly nativeResponse: unknown) {
    super("provider_native_response_decode_failed");
    this.name = "ProviderNativeDecodeError";
    this.accounting = accountingFromResponse(nativeResponse);
    const record = asRecord(nativeResponse);
    this.requestId = readString(record._request_id) || readString(record.id);
  }
}

export function createProviderAdapter(
  providerProfileId: ProviderRuntimeDescriptor["providerProfileId"],
  client: OpenAI,
): LlmProviderAdapter {
  if (providerProfileId === "openai") return new OpenAIProviderAdapter(client);
  if (providerProfileId === "katana") return new KatanaProviderAdapter(client);
  return new OpenAICompatibleChatAdapter(client);
}

export function isLlmProviderAdapter(
  value: OpenAI | LlmProviderAdapter,
): value is LlmProviderAdapter {
  const candidate = value as Partial<LlmProviderAdapter>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.validate === "function" &&
    typeof candidate.compile === "function" &&
    typeof candidate.dispatch === "function" &&
    typeof candidate.classifyError === "function"
  );
}

export function compileOpenAIResponsesRequest(
  invocation: ModelInvocation,
  runtime: ProviderRuntimeDescriptor,
): ResponseCreateParamsNonStreaming {
  const instructions = invocation.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "")
    .filter(Boolean)
    .join("\n\n");
  const inputMessages = invocation.messages
    .filter((message) => message.role !== "system");
  const input = inputMessages.length === 1
      && inputMessages[0]?.role === "user"
      && typeof inputMessages[0].content === "string"
      && inputMessages[0].content.length > 0
    ? inputMessages[0].content
    : inputMessages.flatMap(responseInputItems);
  const reasoningEffort = requestedReasoningEffort(invocation, runtime, true);
  const summary = invocation.reasoning?.summary ?? runtime.openAIReasoningSummary;
  const body: Record<string, unknown> = {
    model: runtime.modelId,
    input,
    ...(instructions && { instructions }),
    max_output_tokens: invocation.outputTokenLimit,
    store: false,
    ...(runtime.openAIServiceTier && { service_tier: runtime.openAIServiceTier }),
    ...(invocation.promptCache && {
      prompt_cache_key: invocation.promptCache.key,
      ...(invocation.promptCache.ttl && runtime.modelCapabilities.supportsPromptCacheRetention && {
        prompt_cache_options: { ttl: invocation.promptCache.ttl },
      }),
    }),
    ...((reasoningEffort || summary) && {
      reasoning: {
        ...(reasoningEffort && { effort: reasoningEffort }),
        ...(summary && { summary }),
      },
    }),
  };

  if (
    invocation.temperature !== undefined &&
    runtime.modelCapabilities.supportsTemperature
  ) {
    body.temperature = invocation.temperature;
  }
  if (invocation.result.kind === "structured") {
    body.text = {
      format: {
        type: "json_schema",
        name: invocation.result.name,
        strict: invocation.result.strict,
        schema: invocation.result.schema,
      },
    };
  } else if (invocation.result.kind === "tool") {
    body.tools = invocation.result.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      ...(tool.description && { description: tool.description }),
      parameters: tool.parameters,
      strict: tool.strict ?? true,
    }));
    body.tool_choice = invocation.result.choice === "auto" ||
        invocation.result.choice === "required"
      ? invocation.result.choice
      : { type: "function", name: invocation.result.choice.name };
    if (invocation.result.allowParallel === false) {
      body.parallel_tool_calls = false;
    }
  }
  return body as unknown as ResponseCreateParamsNonStreaming;
}

export function compileChatCompletionsRequest(
  invocation: ModelInvocation,
  runtime: ProviderRuntimeDescriptor,
): ChatCompletionCreateParamsNonStreaming {
  const body: Record<string, unknown> = {
    model: runtime.modelId,
    messages: invocation.messages.map(chatMessage),
  };
  body[runtime.modelCapabilities.usesMaxCompletionTokens
    ? "max_completion_tokens"
    : "max_tokens"] = invocation.outputTokenLimit;
  if (
    invocation.temperature !== undefined &&
    runtime.modelCapabilities.supportsTemperature
  ) {
    body.temperature = invocation.temperature;
  }
  const hasTools = invocation.result.kind === "tool";
  const reasoningEffort = requestedReasoningEffort(
    invocation,
    runtime,
    !hasTools || runtime.modelCapabilities.supportsToolReasoningEffort,
  );
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  if (invocation.result.kind === "structured") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: invocation.result.name,
        strict: invocation.result.strict,
        schema: invocation.result.schema,
      },
    };
  } else if (invocation.result.kind === "tool") {
    const toolResult = invocation.result;
    const selectedToolName = typeof toolResult.choice === "object"
      ? toolResult.choice.name
      : undefined;
    const selectedTool = toolResult.choice === "auto" ||
        toolResult.choice === "required"
      ? toolResult.tools[0]
      : toolResult.tools.find((tool) => tool.name === selectedToolName);
    if (runtime.toolChoiceMode === "json_schema" && selectedTool) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: `${selectedTool.name}_arguments`,
          strict: selectedTool.strict ?? true,
          schema: selectedTool.parameters,
        },
      };
    } else {
      body.tools = invocation.result.tools.map(chatTool);
      body.tool_choice = runtime.toolChoiceMode === "required" ||
          runtime.toolChoiceMode === "auto"
        ? runtime.toolChoiceMode
        : invocation.result.choice === "auto" || invocation.result.choice === "required"
          ? invocation.result.choice
          : {
              type: "function",
              function: { name: invocation.result.choice.name },
            };
      if (
        invocation.result.allowParallel === false &&
        (runtime.providerProfileId === "openai" || runtime.providerProfileId === "katana")
      ) {
        body.parallel_tool_calls = false;
      }
    }
  }
  return body as unknown as ChatCompletionCreateParamsNonStreaming;
}

function requestedReasoningEffort(
  invocation: ModelInvocation,
  runtime: ProviderRuntimeDescriptor,
  permitted: boolean,
) {
  if (!permitted || !runtime.modelCapabilities.supportsReasoningEffort) {
    return undefined;
  }
  if (
    runtime.reasoningPolicy === "low" ||
    runtime.reasoningPolicy === "medium" ||
    runtime.reasoningPolicy === "high"
  ) {
    return runtime.reasoningPolicy;
  }
  return invocation.reasoning?.effort;
}

function chatTool(tool: ModelInvocationTool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description && { description: tool.description }),
      parameters: tool.parameters,
      ...(tool.strict !== undefined && { strict: tool.strict }),
    },
  };
}

function chatMessage(message: ModelInvocationMessage): ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "missing-tool-call-id",
      content: message.content ?? "",
    };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length && {
        tool_calls: message.toolCalls.map((call, index) => ({
          id: call.id ?? `call_${index}`,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      }),
    };
  }
  return {
    role: message.role,
    content: message.content ?? "",
    ...(message.name && { name: message.name }),
  };
}

function responseInputItems(message: ModelInvocationMessage): unknown[] {
  if (message.role === "tool") {
    return [{
      type: "function_call_output",
      call_id: message.toolCallId ?? "missing-tool-call-id",
      output: message.content ?? "",
    }];
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return [
      ...(message.content
        ? [{ role: "assistant", content: message.content }]
        : []),
      ...message.toolCalls.map((call, index) => ({
        type: "function_call",
        call_id: call.id ?? `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      })),
    ];
  }
  return [{ role: message.role, content: message.content ?? "" }];
}

export function normalizeOpenAIResponse(
  response: OpenAIResponse,
  requestedSummaryMode?: "auto" | "concise" | "detailed",
): ProviderModelOutcome {
  const output = Array.isArray(response.output) ? response.output : [];
  const textParts: string[] = [];
  const refusalParts: string[] = [];
  const toolCalls: ProviderNormalizedToolCall[] = [];
  const reasoningParts: string[] = [];
  const reasoningIds: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record.type === "function_call") {
      const callId = readString(record.call_id) || readString(record.id);
      toolCalls.push({
        ...(callId && { id: callId }),
        name: readString(record.name),
        arguments: readString(record.arguments),
      });
      continue;
    }
    if (record.type === "reasoning") {
      if (readString(record.id)) reasoningIds.push(readString(record.id));
      for (const part of Array.isArray(record.summary) ? record.summary : []) {
        const text = readString(asRecord(part).text);
        if (text) reasoningParts.push(text);
      }
      continue;
    }
    if (record.type !== "message") continue;
    for (const part of Array.isArray(record.content) ? record.content : []) {
      const partRecord = asRecord(part);
      const text = readString(partRecord.text);
      if (partRecord.type === "refusal") {
        const refusal = readString(partRecord.refusal) || text;
        if (refusal) refusalParts.push(refusal);
      } else if (text) {
        textParts.push(text);
      }
    }
  }
  const outputText = readString((response as unknown as Record<string, unknown>).output_text);
  if (outputText && textParts.length === 0) textParts.push(outputText);
  const summaryMode = reasoningParts.length > 0
    ? readReasoningSummaryMode(response) ?? requestedSummaryMode ?? "auto"
    : undefined;
  const accounting = accountingFromResponse(response);
  const requestId = readString((response as unknown as Record<string, unknown>)._request_id);
  return {
    transport: "openai.responses",
    nativeResponse: response,
    ...(readString(response.id) && { responseId: readString(response.id) }),
    ...(requestId && { requestId }),
    ...(textParts.length > 0 && { text: textParts.join("\n").trim() }),
    toolCalls,
    ...(refusalParts.length > 0 && { refusal: refusalParts.join("\n") }),
    ...(readString(response.status) && { status: readString(response.status) }),
    ...(readString(response.status) && { stopReason: readString(response.status) }),
    ...(reasoningParts.length > 0 && summaryMode && {
      reasoning: {
        summary: {
          mode: summaryMode,
          text: reasoningParts.join("\n\n"),
          parts: reasoningParts,
          ...(reasoningIds.length > 0 && { outputItemIds: reasoningIds }),
        },
      },
    }),
    ...(accounting && { accounting }),
    ...(readString((response as unknown as Record<string, unknown>).service_tier) && {
      serviceTier: readString((response as unknown as Record<string, unknown>).service_tier),
    }),
  };
}

export function normalizeChatCompletion(
  response: ChatCompletion,
  transport: string,
): ProviderModelOutcome {
  const choice = response.choices[0];
  const message = choice?.message;
  const messageRecord = asRecord(message);
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((call) => {
        const id = readString(call.id);
        const name = readString(call.function?.name);
        const args = readString(call.function?.arguments);
        const validEnvelope = call.type === "function" && id && name && args;
        return validEnvelope
          ? { id, name, arguments: args }
          : {
              ...(id && { id }),
              name: "",
              arguments: "",
            };
      })
    : [];
  const reasoningContent = readString(messageRecord.reasoning_content) ||
    readString(messageRecord.reasoning);
  const accounting = accountingFromResponse(response);
  const requestId = readString((response as unknown as Record<string, unknown>)._request_id);
  return {
    transport,
    nativeResponse: response,
    ...(readString(response.id) && { responseId: readString(response.id) }),
    ...(requestId && { requestId }),
    ...(typeof message?.content === "string" && message.content.trim() && {
      text: message.content.trim(),
    }),
    toolCalls,
    ...(readString(message?.refusal) && { refusal: readString(message?.refusal) }),
    ...(choice?.finish_reason && { stopReason: choice.finish_reason }),
    ...(reasoningContent && { reasoning: { content: reasoningContent } }),
    ...(accounting && { accounting }),
    ...(readString((response as unknown as Record<string, unknown>).service_tier) && {
      serviceTier: readString((response as unknown as Record<string, unknown>).service_tier),
    }),
  };
}

function accountingFromResponse(
  response: unknown,
): ProviderAttemptAccountingFacts | undefined {
  const record = asRecord(response);
  const usage = asRecord(record.usage);
  if (Object.keys(usage).length === 0) return undefined;
  const promptDetails = asRecord(
    usage.prompt_tokens_details ?? usage.input_tokens_details,
  );
  const completionDetails = asRecord(
    usage.completion_tokens_details ?? usage.output_tokens_details,
  );
  const promptTokens = numberField(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = numberField(
    usage.completion_tokens ?? usage.output_tokens,
  );
  const cachedTokens = numberField(promptDetails.cached_tokens);
  const cacheWriteTokens = numberField(promptDetails.cache_write_tokens);
  const reasoningTokens = numberField(completionDetails.reasoning_tokens);
  const totalTokens = numberField(usage.total_tokens);
  const router = asRecord(usage.imgnai ?? usage.routerBilling);
  const costMicrousd = numberField(router.cost_microusd ?? router.costMicrousd);
  const costUsd = finiteField(
    router.providerCostUsd ??
      router.provider_cost_usd ??
      router.cost_usd ??
      router.costUsd ??
      router.total_usd ??
      router.totalUsd,
  );
  const actualCostMicrousd = costMicrousd ??
    (costUsd !== undefined ? Math.round(costUsd * 1_000_000) : undefined);
  const nativeCredits = finiteField(
    router.credits_charged ?? router.creditsCharged ?? router.credits,
  );
  const nativeAmount = finiteField(router.amount);
  const nativeUnit = readString(router.unit);
  return {
    usage: {
      ...(promptTokens !== undefined && { promptTokens }),
      ...(cachedTokens !== undefined && { cachedTokens }),
      ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
      ...(reasoningTokens !== undefined && { reasoningTokens }),
      ...(totalTokens !== undefined && { totalTokens }),
    },
    ...(actualCostMicrousd !== undefined && {
      actualCostMicrousd,
      actualCostSource: "router_actual" as const,
    }),
    ...(nativeCredits !== undefined && {
      providerNativeUnit: "katana_credit",
      providerNativeAmount: String(nativeCredits),
    }),
    ...(nativeCredits === undefined && nativeAmount !== undefined && nativeUnit && {
      providerNativeUnit: nativeUnit,
      providerNativeAmount: String(nativeAmount),
    }),
    ...(readString(record.service_tier) && {
      effectiveServiceTier: readString(record.service_tier),
    }),
  };
}

function readReasoningSummaryMode(response: OpenAIResponse) {
  const record = asRecord(response);
  const effort = asRecord(record.reasoning).summary;
  return effort === "auto" || effort === "concise" || effort === "detailed"
    ? effort
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number | undefined {
  const number = finiteField(value);
  if (number === undefined || number < 0) return undefined;
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}

function finiteField(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}
