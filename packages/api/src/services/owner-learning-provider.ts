import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import {
  createFlexProcessingFetch,
  type FlexProcessingObserver,
} from "@influence/engine";
import type {
  OwnerLearningCallCostReceipt,
  OwnerLearningSafeFailureCode,
  OwnerLearningTokenReceipt,
} from "./owner-learning-contracts.js";
import { OWNER_LEARNING_INPUT_TOKEN_LIMIT } from "./owner-learning-evidence.js";
import {
  OWNER_LEARNING_PROVIDER_INSTRUCTIONS,
  estimateOwnerLearningProviderCallTokens,
} from "./owner-learning-provider-context.js";
import {
  OWNER_LEARNING_MODEL_ID,
} from "./owner-learning-review.js";
import { priceOwnerLearningTokenReceipt } from "./provider-cost-accounting.js";
import { stableJson } from "./stable-hash.js";

export const OWNER_LEARNING_MAX_OUTPUT_TOKENS = 8_000;

type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ProviderWait = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface OwnerLearningProviderRequest {
  input: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  diagnosticContext?: {
    reviewId: string;
    callOrdinal: number;
  };
  observer: FlexProcessingObserver;
  resumeTransport: {
    flex429Count: number;
    nextTransportOrdinal: number;
    nextTier: "flex" | "auto";
    initialBackoffMs: number;
  };
  signal?: AbortSignal;
}

export interface OwnerLearningProviderResponse {
  output: unknown;
  effectiveTier: string;
  providerResponseId: string | null;
  tokenReceipt: OwnerLearningTokenReceipt;
  costReceipt: OwnerLearningCallCostReceipt;
}

export interface OwnerLearningProvider {
  invoke(request: OwnerLearningProviderRequest): Promise<OwnerLearningProviderResponse>;
}

export interface OwnerLearningProviderDiagnostic {
  reviewId?: string;
  callOrdinal?: number;
  model: string;
  requestedTier: "flex";
  status?: number;
  requestId?: string;
  type?: string;
  code?: string;
  param?: string;
  message: string;
}

export class OwnerLearningProviderError extends Error {
  constructor(
    readonly code: OwnerLearningSafeFailureCode,
    readonly retryable: boolean,
    readonly tokenReceipt?: OwnerLearningTokenReceipt,
    readonly costReceipt?: OwnerLearningCallCostReceipt,
    readonly effectiveTier?: string,
  ) {
    super(code);
    this.name = "OwnerLearningProviderError";
  }
}

export function createOwnerLearningOpenAIProvider(options: {
  apiKey: string;
  fetch?: ProviderFetch;
  wait?: ProviderWait;
  now?: () => Date;
  onProviderError?: (diagnostic: OwnerLearningProviderDiagnostic) => void;
}): OwnerLearningProvider {
  return {
    async invoke(request) {
      if (
        estimateOwnerLearningProviderCallTokens(request.input, request.responseSchema)
          > OWNER_LEARNING_INPUT_TOKEN_LIMIT
      ) {
        throw new Error("Owner learning provider request violated the internal input budget invariant");
      }
      const flexFetch = createFlexProcessingFetch(
        options.fetch ?? fetch,
        options.wait,
        {
          observer: request.observer,
          resume: request.resumeTransport,
        },
      );
      const client = new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
        fetch: flexFetch as typeof fetch,
      });
      let response: unknown;
      try {
        response = await client.responses.create(buildProviderRequest(request), {
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        const diagnostic = ownerLearningProviderDiagnostic(error, request.diagnosticContext);
        (options.onProviderError ?? logOwnerLearningProviderError)(diagnostic);
        const status = numberValue(asRecord(error)?.status);
        if (status === 429) {
          throw new OwnerLearningProviderError("provider_capacity_exhausted", true);
        }
        if (isProviderTimeoutError(error)) {
          throw new OwnerLearningProviderError("provider_timeout", true);
        }
        throw new OwnerLearningProviderError(
          status != null && status >= 500 ? "provider_error" : "provider_error",
          true,
        );
      }
      return parseProviderResponse(response, options.now?.() ?? new Date());
    },
  };
}

function ownerLearningProviderDiagnostic(
  error: unknown,
  context: OwnerLearningProviderRequest["diagnosticContext"],
): OwnerLearningProviderDiagnostic {
  const record = asRecord(error) ?? {};
  const errorPayload = asRecord(record.error) ?? {};
  const nestedError = asRecord(errorPayload.error) ?? errorPayload;
  const message = stringValue(nestedError.message)
    ?? (error instanceof Error ? error.message : "OpenAI request failed");
  const status = numberValue(record.status);
  const requestId = firstString(record.requestID, record.request_id, nestedError.request_id);
  const type = firstString(record.type, nestedError.type);
  const code = firstString(record.code, nestedError.code);
  const param = firstString(record.param, nestedError.param);
  return {
    ...(context?.reviewId ? { reviewId: context.reviewId } : {}),
    ...(context?.callOrdinal != null ? { callOrdinal: context.callOrdinal } : {}),
    model: OWNER_LEARNING_MODEL_ID,
    requestedTier: "flex",
    ...(status !== undefined ? { status } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(param !== undefined ? { param } : {}),
    message: message.replaceAll(/\s+/g, " ").trim().slice(0, 1_000),
  };
}

function logOwnerLearningProviderError(diagnostic: OwnerLearningProviderDiagnostic): void {
  console.error("[owner-learning] provider request rejected", JSON.stringify(diagnostic));
}

function buildProviderRequest(
  request: OwnerLearningProviderRequest,
): ResponseCreateParamsNonStreaming {
  return {
    model: OWNER_LEARNING_MODEL_ID,
    instructions: OWNER_LEARNING_PROVIDER_INSTRUCTIONS,
    input: `<owner_learning_data>\n${stableJson(request.input)}\n</owner_learning_data>`,
    reasoning: { effort: "low" },
    max_output_tokens: OWNER_LEARNING_MAX_OUTPUT_TOKENS,
    store: false,
    service_tier: "flex",
    text: {
      format: {
        type: "json_schema",
        name: "owner_learning_turn",
        strict: true,
        schema: request.responseSchema,
      },
    },
  } as ResponseCreateParamsNonStreaming;
}

function isProviderTimeoutError(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return true;
  const record = asRecord(error);
  if (record?.name === "APIConnectionTimeoutError") return true;
  const cause = record?.cause;
  return cause instanceof OpenAI.APIConnectionTimeoutError
    || asRecord(cause)?.name === "APIConnectionTimeoutError";
}

function parseProviderResponse(
  value: unknown,
  now: Date,
): OwnerLearningProviderResponse {
  const response = asRecord(value);
  if (!response) throw new OwnerLearningProviderError("invalid_structured_output", true);
  const effectiveTier = stringValue(response.service_tier) ?? "unknown";
  const tokenReceipt = parseTokenReceipt(response.usage);
  const costReceipt = priceOwnerLearningTokenReceipt({
    effectiveTier,
    tokenReceipt,
    now,
  });
  const incomplete = asRecord(response.incomplete_details);
  if (response.status === "incomplete" && incomplete?.reason === "max_output_tokens") {
    throw new OwnerLearningProviderError(
      "output_budget_exhausted",
      true,
      tokenReceipt,
      costReceipt,
      effectiveTier,
    );
  }
  if (response.status !== "completed") {
    throw new OwnerLearningProviderError(
      "provider_error",
      true,
      tokenReceipt,
      costReceipt,
      effectiveTier,
    );
  }
  const outputText = extractOutputText(response);
  if (!outputText) {
    throw new OwnerLearningProviderError(
      "invalid_structured_output",
      true,
      tokenReceipt,
      costReceipt,
      effectiveTier,
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw new OwnerLearningProviderError(
      "invalid_structured_output",
      true,
      tokenReceipt,
      costReceipt,
      effectiveTier,
    );
  }
  return {
    output,
    effectiveTier,
    providerResponseId: stringValue(response.id) ?? null,
    tokenReceipt,
    costReceipt,
  };
}

function parseTokenReceipt(value: unknown): OwnerLearningTokenReceipt {
  const usage = asRecord(value) ?? {};
  const inputDetails = asRecord(usage.input_tokens_details) ?? {};
  const outputDetails = asRecord(usage.output_tokens_details) ?? {};
  return {
    ...(integerValue(usage.input_tokens) !== undefined
      ? { inputTokens: integerValue(usage.input_tokens) }
      : {}),
    ...(integerValue(inputDetails.cached_tokens) !== undefined
      ? { cachedInputTokens: integerValue(inputDetails.cached_tokens) }
      : {}),
    ...(integerValue(usage.output_tokens) !== undefined
      ? { totalOutputTokens: integerValue(usage.output_tokens) }
      : {}),
    ...(integerValue(outputDetails.reasoning_tokens) !== undefined
      ? { reasoningTokens: integerValue(outputDetails.reasoning_tokens) }
      : {}),
  };
}

function extractOutputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    const message = asRecord(item);
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      const content = asRecord(part);
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(stringValue).find((value) => value !== undefined);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number != null && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}
