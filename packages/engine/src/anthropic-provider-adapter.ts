import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming, MessageParam, ImageBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { compileAnthropicOutputSchema } from "./anthropic-output-schema";
import type { LlmProviderAdapter, ModelInvocation, ProviderNativeRequest, ProviderModelOutcome, ProviderRuntimeDescriptor } from "./model-invocation";
import { classifyProviderError, type ProviderAttemptAccountingFacts, type ProviderAttemptFailureOutcome } from "./provider-execution";

class AnthropicOutcomeError extends Error {
  constructor(readonly outcome: ProviderAttemptFailureOutcome, readonly nativeResponse: Message & { _request_id?: string | null }, readonly accounting: ProviderAttemptAccountingFacts) {
    super(outcome.message);
  }
  get requestId() { return this.nativeResponse._request_id ?? this.nativeResponse.id; }
}

export function anthropicAccounting(response: Message): ProviderAttemptAccountingFacts {
  const u = response.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0;
  const promptTokens = u.input_tokens + cacheRead + cacheWrite;
  // An unexpected tier cannot borrow the supported standard/5m rate card.
  const unsupported = (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0 || u.speed === "fast" || (u.inference_geo && u.inference_geo !== "global");
  return { usage: { promptTokens, cachedTokens: cacheRead, cacheWriteTokens: cacheWrite,
    completionTokens: u.output_tokens, totalTokens: promptTokens + u.output_tokens,
    ...(u.output_tokens_details && { reasoningTokens: u.output_tokens_details.thinking_tokens }) },
    effectiveServiceTier: unsupported ? "unsupported-anthropic-pricing" : u.service_tier ?? "standard" };
}

function imageBlock(url: string): ImageBlockParam {
  if (!url.startsWith("data:")) return { type: "image", source: { type: "url", url } };
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) throw new Error("Unsupported Anthropic image data URL");
  const mediaType = match[1];
  if (mediaType !== "image/jpeg" && mediaType !== "image/png" && mediaType !== "image/gif" && mediaType !== "image/webp") throw new Error("Unsupported image type");
  return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2]! } };
}

export class AnthropicProviderAdapter implements LlmProviderAdapter {
  readonly id = "anthropic";
  private readonly decoders = new WeakMap<ProviderNativeRequest, (text: string) => string>();
  constructor(private readonly client: Anthropic) {}

  validate(invocation: ModelInvocation, runtime: ProviderRuntimeDescriptor) {
    try { this.compile(invocation, runtime); return { compatible: true }; }
    catch (error) { return { compatible: false, reason: error instanceof Error ? error.message : String(error) }; }
  }

  compile(invocation: ModelInvocation, runtime: ProviderRuntimeDescriptor): ProviderNativeRequest {
    const native = runtime.modelCapabilities.anthropic;
    if (!native || native.apiVersion !== "2026-10-21") throw new Error("Anthropic route lacks audited native capabilities");
    const messages: MessageParam[] = [];
    const system: string[] = [];
    for (const message of invocation.messages) {
      if (message.toolCalls?.length || message.role === "tool" || message.toolCallId) throw new Error("Anthropic decision adapter does not accept tool history");
      if (message.images?.length && (message.role !== "user" || !runtime.modelCapabilities.supportsImageInput)) throw new Error("Images require a vision-capable user message");
      if (message.role === "system" || message.role === "developer") { if (message.content) system.push(message.content); continue; }
      if (message.role === "user") messages.push({ role: "user", content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...(message.images?.map(image => imageBlock(image.url)) ?? []),
      ] });
      else messages.push({ role: "assistant", content: message.content ?? "" });
    }
    if (!messages.length || messages.at(-1)?.role !== "user") throw new Error("Anthropic requires a final user turn; assistant prefilling is unsupported");
    const codec = invocation.result.kind === "structured" ? compileAnthropicOutputSchema(invocation.result.artifact.providerSchema) : undefined;
    const effort = runtime.reasoningPolicy === "action-policy" ? invocation.reasoning?.effort ?? "low" : runtime.reasoningPolicy;
    const body: MessageCreateParamsNonStreaming = {
      model: runtime.modelId, max_tokens: invocation.outputTokenLimit, messages, stream: false,
      ...(system.length && { system: system.join("\n\n") }),
      thinking: native.thinking === "adaptive" ? { type: "adaptive", display: "summarized" } : { type: "disabled" },
      output_config: { ...(native.thinking === "adaptive" && { effort }), ...(codec && { format: { type: "json_schema", schema: codec.schema } }) },
      service_tier: "standard_only",
      ...(invocation.promptCache && { cache_control: { type: "ephemeral", ttl: "5m" } }),
    };
    const request = { transport: "anthropic.messages", body };
    if (codec) this.decoders.set(request, codec.decode);
    return request;
  }

  async dispatch(request: ProviderNativeRequest, options: Parameters<LlmProviderAdapter["dispatch"]>[1]): Promise<ProviderModelOutcome> {
    const response = await this.client.messages.create(request.body as MessageCreateParamsNonStreaming, options);
    const accounting = response?.usage ? anthropicAccounting(response) : {};
    const fail = (kind: ProviderAttemptFailureOutcome["kind"], message: string, retryable = false): never => {
      throw new AnthropicOutcomeError({ kind, message, retryable }, response, accounting);
    };
    if (!response?.usage || !Array.isArray(response.content)) fail("malformed_output", "Anthropic response is missing content or usage");
    if (response.stop_reason === "refusal") fail("refusal", "Anthropic refused the request");
    if (response.stop_reason === "model_context_window_exceeded") fail("context_overflow", "Anthropic context window exceeded");
    if (response.stop_reason === "max_tokens") fail("undecodable_structured_output", "Anthropic output token limit reached", true);
    if (response.stop_reason !== "end_turn") fail("malformed_output", `Unexpected Anthropic stop reason: ${response.stop_reason}`);
    const texts = response.content.filter(block => block.type === "text").map(block => block.text);
    if (texts.length !== 1 || !texts[0]?.trim()) fail("empty_output", "Expected one complete Anthropic text response");
    if (response.content.some(block => !["text", "thinking", "redacted_thinking"].includes(block.type))) fail("malformed_output", "Unexpected Anthropic response block");
    let text = texts[0]!;
    try { text = this.decoders.get(request)?.(text) ?? text; }
    catch { fail("undecodable_structured_output", "Anthropic response failed exact schema decoding", true); }
    const parts = response.content.filter(block => block.type === "thinking").map(block => block.thinking).filter(Boolean);
    return { transport: request.transport, nativeResponse: response, responseId: response.id, requestId: response._request_id ?? response.id,
      text, toolCalls: [], stopReason: response.stop_reason ?? undefined, accounting, serviceTier: accounting.effectiveServiceTier,
      ...(parts.length && { reasoning: { summary: { mode: "auto", text: parts.join("\n\n"), parts } } }) };
  }

  classifyError(error: unknown, signal?: AbortSignal): ProviderAttemptFailureOutcome {
    if (error instanceof AnthropicOutcomeError) return error.outcome;
    if (error instanceof Anthropic.APIError && !signal?.aborted) {
      if (error.status === 402 || /credit balance|spend (?:limit|cap)|billing_error/i.test(error.message)) return { kind: "configuration", message: "Anthropic billing or spend limit prevents dispatch", retryable: false };
      if (error.status === 404) return { kind: "configuration", message: "Anthropic model is unavailable", retryable: false };
      if (error.status === 400 && /output_config|schema|thinking|effort/i.test(error.message)) return { kind: "configuration", message: error.message, retryable: false };
    }
    return classifyProviderError(error, signal);
  }
}
