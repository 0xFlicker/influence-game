import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import {
  createFlexProcessingFetch,
  type FlexProcessingObserver,
  type FlexTransportTerminalOutcome,
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
import { sha256StableJson } from "./stable-hash.js";
import { OwnerLearningOutputValidationError } from "./owner-learning-failures.js";

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
  onResponseObserved?: (observation: OwnerLearningProviderResponseObservation) => Promise<void>;
  signal?: AbortSignal;
}

export interface OwnerLearningProviderResponseObservation {
  responseObservedAt: string;
  responseSha256: string;
  responseEvidence: unknown;
  providerResponseId: string | null;
  redactionCredentialValues?: readonly string[];
}

export interface OwnerLearningProviderResponse {
  /** Test providers may supply a decoded value; production decodes outputText in output_validation. */
  output?: unknown;
  outputText?: string | null;
  effectiveTier: string;
  providerResponseId: string | null;
  responseObservedAt?: string;
  responseSha256?: string;
  requestEvidence?: unknown;
  responseEvidence?: unknown;
  /** Transient values used only by the durable evidence sanitizer. */
  redactionCredentialValues?: readonly string[];
  tokenReceipt: OwnerLearningTokenReceipt;
  costReceipt: OwnerLearningCallCostReceipt;
}

export interface OwnerLearningProvider {
  invoke(request: OwnerLearningProviderRequest): Promise<OwnerLearningProviderResponse>;
}

export type OwnerLearningRecoveredProviderOutcome =
  | { kind: "response"; response: OwnerLearningProviderResponse }
  | { kind: "error"; error: OwnerLearningProviderError };

export interface OwnerLearningProviderDiagnostic {
  reviewId?: string;
  callOrdinal?: number;
  model: string;
  requestedTier: "flex";
  status?: number;
}

export class OwnerLearningProviderError extends Error {
  readonly internalCode: string;

  constructor(
    readonly code: OwnerLearningSafeFailureCode,
    readonly retryable: boolean,
    readonly tokenReceipt?: OwnerLearningTokenReceipt,
    readonly costReceipt?: OwnerLearningCallCostReceipt,
    readonly effectiveTier?: string,
    readonly capture?: Partial<Pick<OwnerLearningProviderResponse,
      | "providerResponseId"
      | "responseObservedAt"
      | "responseSha256"
      | "requestEvidence"
      | "responseEvidence"
      | "redactionCredentialValues"
    >>,
    options?: { cause?: unknown; internalCode?: string },
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OwnerLearningProviderError";
    this.internalCode = options?.internalCode ?? code;
  }
}

export class OwnerLearningAttemptPersistenceError extends Error {
  constructor(
    readonly capture: NonNullable<OwnerLearningProviderError["capture"]>,
    cause: unknown,
    readonly terminalOutcome?: FlexTransportTerminalOutcome,
  ) {
    super("Owner learning provider attempt evidence could not be staged", { cause });
    this.name = "OwnerLearningAttemptPersistenceError";
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
      const providerRequest = buildOwnerLearningProviderRequest(request);
      const requestEvidence = providerRequest;
      let responseCapture: { observedAt: string; evidence: unknown; sha256: string } | null = null;
      let attemptPersistenceError: OwnerLearningAttemptPersistenceError | undefined;
      let providerTransportError: OwnerLearningProviderError | undefined;
      let lastTerminalAttemptedTier: "flex" | "auto" | undefined;
      const evidenceFetch: ProviderFetch = async (input, init) => {
        const response = await (options.fetch ?? fetch)(input, init);
        const observedAt = (options.now?.() ?? new Date()).toISOString();
        const responseMetadata = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        };
        let body: string;
        try {
          body = await response.clone().text();
        } catch (error) {
          const evidence = {
            ...responseMetadata,
            bodyReadError: providerErrorEvidence(error),
          };
          responseCapture = {
            observedAt,
            evidence,
            sha256: sha256StableJson(evidence),
          };
          try {
            await request.onResponseObserved?.({
              responseObservedAt: responseCapture.observedAt,
              responseSha256: responseCapture.sha256,
              responseEvidence: evidence,
              providerResponseId: null,
              redactionCredentialValues: [options.apiKey],
            });
          } catch (persistenceError) {
            attemptPersistenceError = new OwnerLearningAttemptPersistenceError(
              providerCapture(requestEvidence, responseCapture, [options.apiKey]),
              persistenceError,
            );
            throw attemptPersistenceError;
          }
          providerTransportError = new OwnerLearningProviderError(
            "provider_error",
            true,
            undefined,
            undefined,
            undefined,
            providerCapture(requestEvidence, responseCapture, [options.apiKey]),
            { cause: error, internalCode: "response_body_read_failed" },
          );
          throw providerTransportError;
        }
        const evidence = { ...responseMetadata, body };
        responseCapture = {
          observedAt,
          evidence,
          sha256: sha256StableJson(evidence),
        };
        try {
          await request.onResponseObserved?.({
            responseObservedAt: responseCapture.observedAt,
            responseSha256: responseCapture.sha256,
            responseEvidence: evidence,
            providerResponseId: providerResponseIdFromBody(body),
            redactionCredentialValues: [options.apiKey],
          });
        } catch (error) {
          attemptPersistenceError = new OwnerLearningAttemptPersistenceError(
            providerCapture(requestEvidence, responseCapture, [options.apiKey]),
            error,
          );
          throw attemptPersistenceError;
        }
        return response;
      };
      const durableObserver: FlexProcessingObserver = {
        async onDispatchIntent(event) {
          try {
            await request.observer.onDispatchIntent(event);
          } catch (error) {
            attemptPersistenceError = new OwnerLearningAttemptPersistenceError(
              providerCapture(requestEvidence, responseCapture, [options.apiKey]),
              error,
            );
            throw attemptPersistenceError;
          }
        },
        async onTerminalOutcome(event) {
          lastTerminalAttemptedTier = event.attemptedTier;
          try {
            await request.observer.onTerminalOutcome(event);
          } catch (error) {
            attemptPersistenceError = new OwnerLearningAttemptPersistenceError(
              providerCapture(requestEvidence, responseCapture, [options.apiKey]),
              error,
              event,
            );
            throw attemptPersistenceError;
          }
        },
      };
      const flexFetch = createFlexProcessingFetch(
        evidenceFetch,
        options.wait,
        {
          observer: durableObserver,
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
        response = await client.responses.create(providerRequest, {
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        if (attemptPersistenceError !== undefined) throw attemptPersistenceError;
        if (providerTransportError !== undefined) throw providerTransportError;
        if (isAbortError(error)) throw error;
        const diagnostic = ownerLearningProviderDiagnostic(error, request.diagnosticContext);
        (options.onProviderError ?? logOwnerLearningProviderError)(diagnostic);
        const status = numberValue(asRecord(error)?.status);
        if (status === 429) {
          throw new OwnerLearningProviderError(
            "provider_capacity_exhausted",
            lastTerminalAttemptedTier !== "auto",
            undefined,
            undefined,
            undefined,
            providerCapture(requestEvidence, responseCapture, [options.apiKey]),
            { cause: error },
          );
        }
        if (isProviderTimeoutError(error)) {
          throw new OwnerLearningProviderError(
            "provider_timeout",
            true,
            undefined,
            undefined,
            undefined,
            providerCapture(requestEvidence, responseCapture, [options.apiKey]),
            { cause: error },
          );
        }
        throw new OwnerLearningProviderError(
          "provider_error",
          status == null || status >= 500,
          undefined,
          undefined,
          undefined,
          providerCapture(requestEvidence, responseCapture, [options.apiKey]),
          { cause: error },
        );
      }
      return parseProviderResponse(
        response,
        options.now?.() ?? new Date(),
        requestEvidence,
        responseCapture,
        [options.apiKey],
      );
    },
  };
}

function providerResponseIdFromBody(body: string): string | null {
  try {
    return stringValue(asRecord(JSON.parse(body))?.id) ?? null;
  } catch {
    return null;
  }
}

export function decodeOwnerLearningProviderOutput(response: OwnerLearningProviderResponse): unknown {
  if (response.output !== undefined) return response.output;
  if (!response.outputText) {
    throw new OwnerLearningOutputValidationError(
      "invalid_result_contract",
      "Owner learning provider response did not contain output text",
    );
  }
  try {
    return JSON.parse(response.outputText);
  } catch (error) {
    throw new OwnerLearningOutputValidationError(
      "invalid_result_contract",
      "Owner learning provider response was not valid JSON",
      undefined,
      { cause: error },
    );
  }
}

export function recoverOwnerLearningProviderResponse(
  observation: OwnerLearningProviderResponseObservation,
  requestEvidence: unknown,
  transport?: { attemptedTier?: "flex" | "auto" },
): OwnerLearningRecoveredProviderOutcome | null {
  const envelope = asRecord(observation.responseEvidence);
  const status = integerValue(envelope?.status);
  const body = stringValue(envelope?.body);
  if (status == null) return null;
  if (envelope?.bodyReadError !== undefined) {
    return {
      kind: "error",
      error: new OwnerLearningProviderError(
        "provider_error",
        true,
        undefined,
        undefined,
        undefined,
        providerCapture(
          requestEvidence,
          {
            observedAt: observation.responseObservedAt,
            evidence: observation.responseEvidence,
            sha256: observation.responseSha256,
          },
          observation.redactionCredentialValues ?? [],
        ),
        {
          cause: new Error("Owner learning provider response body could not be read"),
          internalCode: "response_body_read_failed",
        },
      ),
    };
  }
  if (status < 200 || status >= 300) {
    const code: OwnerLearningSafeFailureCode = status === 408
      ? "provider_timeout"
      : status === 429 ? "provider_capacity_exhausted" : "provider_error";
    const retryable = status === 408
      || status >= 500
      || (status === 429 && transport?.attemptedTier !== "auto");
    return {
      kind: "error",
      error: new OwnerLearningProviderError(
        code,
        retryable,
        undefined,
        undefined,
        undefined,
        providerCapture(
          requestEvidence,
          {
            observedAt: observation.responseObservedAt,
            evidence: observation.responseEvidence,
            sha256: observation.responseSha256,
          },
          observation.redactionCredentialValues ?? [],
        ),
        {
          cause: new Error(`Owner learning provider returned HTTP ${status}`),
          internalCode: `provider_http_${status}`,
        },
      ),
    };
  }
  if (body == null) {
    return {
      kind: "error",
      error: new OwnerLearningProviderError(
        "provider_error",
        true,
        undefined,
        undefined,
        undefined,
        providerCapture(
          requestEvidence,
          {
            observedAt: observation.responseObservedAt,
            evidence: observation.responseEvidence,
            sha256: observation.responseSha256,
          },
          observation.redactionCredentialValues ?? [],
        ),
        {
          cause: new Error("Owner learning provider response body was unavailable"),
          internalCode: "provider_response_body_unavailable",
        },
      ),
    };
  }
  try {
    const parsed = JSON.parse(body);
    try {
      return {
        kind: "response",
        response: parseProviderResponse(
          parsed,
          new Date(observation.responseObservedAt),
          requestEvidence,
          {
            observedAt: observation.responseObservedAt,
            evidence: observation.responseEvidence,
            sha256: observation.responseSha256,
          },
          [],
        ),
      };
    } catch (error) {
      return error instanceof OwnerLearningProviderError
        ? { kind: "error", error }
        : null;
    }
  } catch (error) {
    return {
      kind: "error",
      error: new OwnerLearningProviderError(
        "provider_error",
        true,
        undefined,
        undefined,
        undefined,
        providerCapture(
          requestEvidence,
          {
            observedAt: observation.responseObservedAt,
            evidence: observation.responseEvidence,
            sha256: observation.responseSha256,
          },
          observation.redactionCredentialValues ?? [],
        ),
        { cause: error, internalCode: "malformed_provider_response" },
      ),
    };
  }
}

function providerErrorEvidence(error: unknown, seen = new Set<unknown>()): unknown {
  if (!(error instanceof Error)) return { name: typeof error, message: String(error) };
  if (seen.has(error)) return { name: error.name, message: "[Circular error cause]" };
  seen.add(error);
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    ...(error.stack && { stack: error.stack }),
    ...(error.cause !== undefined && { cause: providerErrorEvidence(error.cause, seen) }),
  };
}

function ownerLearningProviderDiagnostic(
  error: unknown,
  context: OwnerLearningProviderRequest["diagnosticContext"],
): OwnerLearningProviderDiagnostic {
  const record = asRecord(error) ?? {};
  const reviewId = stringValue(context?.reviewId);
  const callOrdinal = integerValue(context?.callOrdinal);
  const status = httpStatusValue(record.status);
  return {
    ...(reviewId !== undefined ? { reviewId } : {}),
    ...(callOrdinal !== undefined ? { callOrdinal } : {}),
    model: OWNER_LEARNING_MODEL_ID,
    requestedTier: "flex",
    ...(status !== undefined ? { status } : {}),
  };
}

function logOwnerLearningProviderError(diagnostic: OwnerLearningProviderDiagnostic): void {
  console.error("[owner-learning] provider request rejected", JSON.stringify(diagnostic));
}

export function buildOwnerLearningProviderRequest(
  request: Pick<OwnerLearningProviderRequest, "input" | "responseSchema">,
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
  requestEvidence: unknown,
  responseCapture: { observedAt: string; evidence: unknown; sha256: string } | null,
  redactionCredentialValues: readonly string[],
): OwnerLearningProviderResponse {
  const response = asRecord(value);
  const observedAt = responseCapture?.observedAt ?? now.toISOString();
  const responseEvidence = responseCapture?.evidence ?? value;
  const responseSha256 = responseCapture?.sha256 ?? sha256StableJson(responseEvidence);
  if (!response) {
    return {
      outputText: null,
      effectiveTier: "unknown",
      providerResponseId: null,
      responseObservedAt: observedAt,
      responseSha256,
      requestEvidence,
      responseEvidence,
      redactionCredentialValues,
      tokenReceipt: {},
      costReceipt: { costSource: "unavailable" },
    };
  }
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
      providerCapture(requestEvidence, responseCapture, redactionCredentialValues, response),
    );
  }
  if (response.status !== "completed") {
    throw new OwnerLearningProviderError(
      "provider_error",
      true,
      tokenReceipt,
      costReceipt,
      effectiveTier,
      providerCapture(requestEvidence, responseCapture, redactionCredentialValues, response),
    );
  }
  const outputText = extractOutputText(response);
  return {
    outputText,
    effectiveTier,
    providerResponseId: stringValue(response.id) ?? null,
    responseObservedAt: observedAt,
    responseSha256,
    requestEvidence,
    responseEvidence,
    redactionCredentialValues,
    tokenReceipt,
    costReceipt,
  };
}

function providerCapture(
  requestEvidence: unknown,
  responseCapture: { observedAt: string; evidence: unknown; sha256: string } | null,
  redactionCredentialValues: readonly string[],
  response?: Record<string, unknown>,
): NonNullable<OwnerLearningProviderError["capture"]> {
  const capturedBody = stringValue(asRecord(responseCapture?.evidence)?.body);
  return {
    requestEvidence,
    ...(responseCapture && {
      responseObservedAt: responseCapture.observedAt,
      responseEvidence: responseCapture.evidence,
      responseSha256: responseCapture.sha256,
    }),
    providerResponseId: stringValue(response?.id)
      ?? (capturedBody === undefined ? null : providerResponseIdFromBody(capturedBody)),
    redactionCredentialValues,
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function httpStatusValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number != null && Number.isSafeInteger(number) && number >= 100 && number <= 599
    ? number
    : undefined;
}

function integerValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number != null && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}
