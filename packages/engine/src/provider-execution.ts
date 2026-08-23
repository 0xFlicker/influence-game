import { randomUUID } from "crypto";
import type { ProviderProfileId } from "./model-catalog";
import type { Phase, UUID } from "./types";

export const PROVIDER_ATTEMPT_HEADER = "x-influence-provider-attempt-id";
const INTERNAL_TRANSPORT_HEADERS = new Set([
  PROVIDER_ATTEMPT_HEADER,
  "x-influence-no-flex-transport-retry",
]);

const CREDENTIAL_FIELD =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|secret)$/i;
const CREDENTIAL_FIELD_SUFFIX =
  /(?:^|[-_])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|client[-_]?secret|password|secret)$/i;
const CREDENTIAL_QUERY_PARAM =
  /^(?:api[-_]?key|access[-_]?token|token|key|secret|signature|sig)$/i;

export type ProviderAttemptFailureKind =
  | "refusal"
  | "rate_limit"
  | "service_error"
  | "transport_timeout"
  | "transport_error"
  | "authentication"
  | "configuration"
  | "cancellation"
  | "empty_output"
  | "malformed_output"
  | "wrong_tool"
  | "undecodable_structured_output";

export interface ProviderLogicalCallCoordinate {
  gameId?: UUID;
  ownerEpoch?: string;
  actor: {
    id?: UUID;
    name: string;
    role: "player" | "juror" | "house" | "system" | "producer";
  };
  action: string;
  phase?: Phase;
  round?: number;
  /** Phase-owned ordinal for calls sharing the same actor/action boundary. */
  logicalCallOrdinal: number;
}

export function pairProviderLogicalCallOrdinals(
  leftOrdinal: number,
  rightOrdinal: number,
): number {
  if (
    !Number.isSafeInteger(leftOrdinal) ||
    leftOrdinal < 1 ||
    !Number.isSafeInteger(rightOrdinal) ||
    rightOrdinal < 1
  ) {
    throw new Error("Provider logical-call ordinals must be positive safe integers");
  }

  const leftIndex = leftOrdinal - 1;
  const rightIndex = rightOrdinal - 1;
  const diagonal = leftIndex + rightIndex;
  const paired = (diagonal * (diagonal + 1)) / 2 + rightIndex + 1;
  if (!Number.isSafeInteger(paired)) {
    throw new Error("Provider logical-call coordinate exceeds safe integer range");
  }
  return paired;
}

export interface ProviderPreparedRequest {
  requestShape: "chat_completions" | "responses";
  providerProfileId: ProviderProfileId;
  catalogId?: string;
  model: string;
  body: unknown;
  headers?: Headers | Record<string, string>;
  /** Credential values are redacted wherever a provider reflects them. */
  credentialValues?: readonly string[];
}

export interface SanitizedProviderRequestEvidence {
  requestShape: ProviderPreparedRequest["requestShape"];
  providerProfileId: ProviderProfileId;
  catalogId?: string;
  model: string;
  url?: string;
  headers?: Record<string, string>;
  body: unknown;
}

export interface SanitizedProviderResponseEvidence {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface ProviderAttemptUsableOutcome {
  kind: "usable";
}

export interface ProviderAttemptFailureOutcome {
  kind: ProviderAttemptFailureKind;
  message: string;
  retryable: boolean;
}

export type ProviderAttemptOutcome =
  ProviderAttemptUsableOutcome | ProviderAttemptFailureOutcome;

export interface ProviderAttemptIntent {
  coordinate: ProviderLogicalCallCoordinate;
  attemptOrdinal: number;
  attemptId: string;
  preparedRequest: SanitizedProviderRequestEvidence;
  startedAt: string;
}

export interface ProviderAttemptRecord extends ProviderAttemptIntent {
  completedAt: string;
  latencyMs: number;
  outcome: ProviderAttemptOutcome;
  requestId?: string;
  rawResponse?: SanitizedProviderResponseEvidence;
}

export interface ProviderExecutionHooks {
  /** Future durable authority hook. Throwing prevents the network dispatch. */
  onReserve?(intent: ProviderAttemptIntent): Promise<void> | void;
  /** Future durable terminal journal hook. */
  onTerminal?(record: ProviderAttemptRecord): Promise<void> | void;
}

export type ProviderCandidateValidation<T> =
  | { status: "usable"; value: T }
  | {
      status: "unusable";
      kind: ProviderAttemptFailureKind;
      message: string;
      retryable?: boolean;
    };

export interface ProviderDispatchRequestOptions {
  signal?: AbortSignal;
  maxRetries: 0;
  headers: Record<string, string>;
}

export interface ExecuteProviderCallOptions<TResponse, TValue> {
  preparedRequest:
    | ProviderPreparedRequest
    | ((attemptOrdinal: number) => ProviderPreparedRequest);
  maxAttempts: number;
  cancellationSignal?: AbortSignal;
  dispatch(context: {
    attemptOrdinal: number;
    attemptId: string;
    requestOptions: ProviderDispatchRequestOptions;
  }): Promise<TResponse>;
  validate(response: TResponse): ProviderCandidateValidation<TValue>;
  onRetry?(record: ProviderAttemptRecord): Promise<void> | void;
}

export interface ProviderExecutionCoordinatorOptions {
  hooks?: ProviderExecutionHooks;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type ProviderEvidenceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface MutableTransportCapture {
  credentialValues: readonly string[];
  request?: SanitizedProviderRequestEvidence;
  response?: SanitizedProviderResponseEvidence;
}

const activeTransportCaptures = new Map<string, MutableTransportCapture>();

export class ProviderAttemptError extends Error {
  readonly record: ProviderAttemptRecord;
  readonly outcome: ProviderAttemptFailureOutcome;

  constructor(record: ProviderAttemptRecord) {
    super(
      record.outcome.kind === "usable"
        ? "Provider attempt unexpectedly failed"
        : record.outcome.message,
    );
    this.name = "ProviderAttemptError";
    this.record = record;
    if (record.outcome.kind === "usable") {
      throw new Error("ProviderAttemptError requires a failed outcome");
    }
    this.outcome = record.outcome;
  }
}

export class ProviderExecutionCoordinator {
  private readonly hooks?: ProviderExecutionHooks;
  private readonly wait: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly now: () => number;

  constructor(options: ProviderExecutionCoordinatorOptions = {}) {
    this.hooks = options.hooks;
    this.wait = options.wait ?? abortableDelay;
    this.now = options.now ?? Date.now;
  }

  startCall(
    coordinate: ProviderLogicalCallCoordinate,
  ): ProviderLogicalCallExecution {
    return new ProviderLogicalCallExecution(
      coordinate,
      this.hooks,
      this.wait,
      this.now,
    );
  }
}

export class ProviderLogicalCallExecution {
  private nextAttemptOrdinal = 1;

  constructor(
    readonly coordinate: ProviderLogicalCallCoordinate,
    private readonly hooks: ProviderExecutionHooks | undefined,
    private readonly wait: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>,
    private readonly now: () => number,
  ) {}

  async execute<TResponse, TValue>(
    options: ExecuteProviderCallOptions<TResponse, TValue>,
  ): Promise<TValue> {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
    let lastError: ProviderAttemptError | null = null;

    for (let localAttempt = 1; localAttempt <= maxAttempts; localAttempt++) {
      const attemptOrdinal = this.nextAttemptOrdinal++;
      const attemptId = randomUUID();
      const startedAtMs = this.now();
      const preparedRequest =
        typeof options.preparedRequest === "function"
          ? options.preparedRequest(attemptOrdinal)
          : options.preparedRequest;
      const transportCapture: MutableTransportCapture = {
        credentialValues: preparedRequest.credentialValues ?? [],
      };
      const intent: ProviderAttemptIntent = {
        coordinate: this.coordinate,
        attemptOrdinal,
        attemptId,
        preparedRequest: sanitizePreparedRequest(preparedRequest),
        startedAt: new Date(startedAtMs).toISOString(),
      };
      transportCapture.request = intent.preparedRequest;

      await this.hooks?.onReserve?.(intent);
      activeTransportCaptures.set(attemptId, transportCapture);

      let record: ProviderAttemptRecord;
      let usableResult: { value: TValue } | undefined;
      try {
        const response = await options.dispatch({
          attemptOrdinal,
          attemptId,
          requestOptions: {
            maxRetries: 0,
            ...(options.cancellationSignal && {
              signal: options.cancellationSignal,
            }),
            headers: {
              [PROVIDER_ATTEMPT_HEADER]: attemptId,
              "x-influence-no-flex-transport-retry": "1",
            },
          },
        });
        const validation = options.validate(response);
        const completedAtMs = this.now();
        if (validation.status === "usable") {
          record = {
            ...intent,
            ...(transportCapture.request && {
              preparedRequest: transportCapture.request,
            }),
            completedAt: new Date(completedAtMs).toISOString(),
            latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
            outcome: { kind: "usable" },
            ...(requestIdFromResponse(response, transportCapture.response) && {
              requestId: requestIdFromResponse(
                response,
                transportCapture.response,
              ),
            }),
          };
          usableResult = { value: validation.value };
        } else {
          const outcome: ProviderAttemptFailureOutcome = {
            kind: validation.kind,
            message: validation.message,
            retryable:
              validation.retryable ?? defaultRetryable(validation.kind),
          };
          record = {
            ...intent,
            ...(transportCapture.request && {
              preparedRequest: transportCapture.request,
            }),
            completedAt: new Date(completedAtMs).toISOString(),
            latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
            outcome,
            ...(requestIdFromResponse(response, transportCapture.response) && {
              requestId: requestIdFromResponse(
                response,
                transportCapture.response,
              ),
            }),
            rawResponse: transportCapture.response ?? {
              body: sanitizeProviderEvidence(
                response,
                preparedRequest.credentialValues,
              ),
            },
          };
        }
      } catch (error) {
        if (error instanceof ProviderAttemptError) throw error;
        const completedAtMs = this.now();
        const outcome = classifyProviderError(
          error,
          options.cancellationSignal,
        );
        record = {
          ...intent,
          ...(transportCapture.request && {
            preparedRequest: transportCapture.request,
          }),
          completedAt: new Date(completedAtMs).toISOString(),
          latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
          outcome,
          ...(requestIdFromError(error, transportCapture.response) && {
            requestId: requestIdFromError(error, transportCapture.response),
          }),
          rawResponse:
            transportCapture.response ??
            rawResponseFromError(error, preparedRequest.credentialValues),
        };
      } finally {
        activeTransportCaptures.delete(attemptId);
      }

      await this.hooks?.onTerminal?.(record);
      if (usableResult) return usableResult.value;
      lastError = new ProviderAttemptError(record);
      if (record.outcome.kind === "usable") {
        throw new Error(
          "Failed provider attempt produced a usable terminal record",
        );
      }
      if (!record.outcome.retryable || localAttempt >= maxAttempts) {
        throw lastError;
      }
      await options.onRetry?.(record);
      await this.wait(localAttempt * 1_000, options.cancellationSignal);
    }

    throw (
      lastError ??
      new Error("Provider call exhausted without a terminal outcome")
    );
  }
}

export function sanitizeProviderEvidence(
  value: unknown,
  credentialValues: readonly string[] = [],
): unknown {
  const seen = new WeakSet<object>();
  const secrets = credentialValues.filter((secret) => secret.length > 0);

  const sanitize = (input: unknown): unknown => {
    if (typeof input === "string") {
      return secrets.reduce(
        (text, secret) => text.split(secret).join("[REDACTED]"),
        input,
      );
    }
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(sanitize);

    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !isCredentialField(key))
        .map(([key, nested]) => [key, sanitize(nested)]),
    );
  };

  return sanitize(value);
}

export function createProviderEvidenceFetch(
  baseFetch: ProviderEvidenceFetch = fetch,
  credentialValues: readonly string[] = [],
): typeof fetch {
  return (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const incoming =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input.toString(), init);
    const attemptId = incoming.headers.get(PROVIDER_ATTEMPT_HEADER);
    const capture = attemptId
      ? activeTransportCaptures.get(attemptId)
      : undefined;
    const outgoingHeaders = new Headers(incoming.headers);
    for (const header of INTERNAL_TRANSPORT_HEADERS)
      outgoingHeaders.delete(header);
    const outgoing = new Request(incoming, { headers: outgoingHeaders });

    if (capture) {
      const actualCredentialValues = [
        ...credentialValues,
        ...capture.credentialValues,
      ];
      capture.request = {
        requestShape: new URL(outgoing.url).pathname.endsWith("/responses")
          ? "responses"
          : "chat_completions",
        providerProfileId:
          capture.request?.providerProfileId ?? "custom-openai-compatible",
        model: capture.request?.model ?? "unknown",
        url: sanitizeUrl(outgoing.url, actualCredentialValues),
        headers: sanitizeHeaders(outgoing.headers, actualCredentialValues),
        body: await sanitizeBodyText(
          await outgoing.clone().text(),
          actualCredentialValues,
        ),
      };
    }

    const response = await baseFetch(outgoing);
    if (capture) {
      const actualCredentialValues = [
        ...credentialValues,
        ...capture.credentialValues,
      ];
      capture.response = {
        status: response.status,
        headers: sanitizeHeaders(response.headers, actualCredentialValues),
        body: await sanitizeBodyText(
          await response.clone().text(),
          actualCredentialValues,
        ),
      };
    }
    return response;
  }) as typeof fetch;
}

/**
 * Responses may encode a terminal provider failure inside an HTTP-200 body.
 * Classify that envelope before action-specific output decoding so every
 * Responses caller observes the same refusal/retry semantics.
 */
export function classifyResponsesTerminalOutcome(
  response: unknown,
): ProviderAttemptFailureOutcome | undefined {
  const record = asRecord(response);
  const status = readString(record.status).toLowerCase();
  const error = asRecord(record.error);
  const incompleteDetails = asRecord(record.incomplete_details);
  const code = (
    readString(error.code) ||
    readString(record.code) ||
    readString(incompleteDetails.reason)
  ).toLowerCase();
  const message =
    readString(error.message) ||
    readString(record.message) ||
    readString(incompleteDetails.reason) ||
    `Responses request ended with status ${status || "unknown"}`;

  if (status === "completed" || (!status && Object.keys(error).length === 0)) {
    return undefined;
  }
  if (status === "incomplete") {
    if (
      /invalid_prompt|content_filter|policy|refusal|rate_limit|too_many_requests|server_error|service_unavailable|internal_error|timeout|timed_out/.test(
        code,
      )
    ) {
      return classifyProviderFailureDetails({ code, message });
    }
    return {
      kind: "undecodable_structured_output",
      message,
      retryable: true,
    };
  }
  if (status === "failed" || Object.keys(error).length > 0) {
    return classifyProviderFailureDetails({ code, message });
  }
  if (status === "cancelled" || status === "queued" || status === "in_progress") {
    return { kind: "service_error", message, retryable: true };
  }
  return undefined;
}

function sanitizePreparedRequest(
  request: ProviderPreparedRequest,
): SanitizedProviderRequestEvidence {
  const sanitizedHeaders = request.headers
    ? sanitizeHeaders(
        new Headers(request.headers),
        request.credentialValues ?? [],
      )
    : undefined;
  return {
    requestShape: request.requestShape,
    providerProfileId: request.providerProfileId,
    ...(request.catalogId && { catalogId: request.catalogId }),
    model: request.model,
    ...(sanitizedHeaders &&
      Object.keys(sanitizedHeaders).length > 0 && {
        headers: sanitizedHeaders,
      }),
    body: sanitizeProviderEvidence(request.body, request.credentialValues),
  };
}

function sanitizeHeaders(
  headers: Headers,
  credentialValues: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()]
      .filter(
        ([key]) =>
          !isCredentialField(key) &&
          !INTERNAL_TRANSPORT_HEADERS.has(key.toLowerCase()),
      )
      .map(([key, value]): [string, string] => [
        key.toLowerCase(),
        sanitizeProviderEvidence(value, credentialValues) as string,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function sanitizeBodyText(
  body: string,
  credentialValues: readonly string[],
): Promise<unknown> {
  if (!body) return "";
  try {
    return sanitizeProviderEvidence(JSON.parse(body), credentialValues);
  } catch {
    return sanitizeProviderEvidence(body, credentialValues);
  }
}

function sanitizeUrl(
  value: string,
  credentialValues: readonly string[],
): string {
  const url = new URL(value);
  for (const [key, parameterValue] of [...url.searchParams.entries()]) {
    if (
      CREDENTIAL_QUERY_PARAM.test(key) ||
      credentialValues.some(
        (credential) => credential.length > 0 && parameterValue.includes(credential),
      )
    )
      url.searchParams.set(key, "[REDACTED]");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

function classifyProviderError(
  error: unknown,
  cancellationSignal?: AbortSignal,
): ProviderAttemptFailureOutcome {
  const record = asRecord(error);
  const name = readString(record.name);
  const constructorName =
    error instanceof Error ? error.constructor.name : "";
  const message = readString(record.message) || String(error);
  const status =
    readNumber(record.status) ?? readNumber(asRecord(record.response).status);
  const errorBody = asRecord(record.error);
  const code = (
    readString(record.code) ||
    readString(errorBody.code) ||
    readString(asRecord(errorBody.error).code)
  ).toLowerCase();
  const lowerMessage = message.toLowerCase();

  if (cancellationSignal?.aborted) {
    return { kind: "cancellation", message, retryable: false };
  }
  if (
    name === "APIUserAbortError" ||
    constructorName === "APIUserAbortError" ||
    name === "AbortError"
  ) {
    return { kind: "transport_timeout", message, retryable: true };
  }
  if (
    name === "APITimeoutError" ||
    status === 408 ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return { kind: "transport_timeout", message, retryable: true };
  }
  if (name === "APIConnectionError" || name === "TypeError") {
    return { kind: "transport_error", message, retryable: true };
  }
  return classifyProviderFailureDetails({ status, code, message });
}

function classifyProviderFailureDetails(input: {
  status?: number;
  code?: string;
  message: string;
}): ProviderAttemptFailureOutcome {
  const code = input.code?.toLowerCase() ?? "";
  const lowerMessage = input.message.toLowerCase();
  if (
    code.includes("invalid_prompt") ||
    code.includes("content_filter") ||
    code.includes("policy") ||
    code.includes("refusal") ||
    lowerMessage.includes("invalid prompt") ||
    lowerMessage.includes("content filter") ||
    lowerMessage.includes("model refused") ||
    lowerMessage.includes("refusal")
  ) {
    return { kind: "refusal", message: input.message, retryable: false };
  }
  if (
    input.status === 401 ||
    input.status === 403 ||
    code.includes("invalid_api_key") ||
    code.includes("authentication") ||
    code.includes("unauthorized")
  ) {
    return { kind: "authentication", message: input.message, retryable: false };
  }
  if (
    input.status === 429 ||
    code.includes("rate_limit") ||
    code.includes("too_many_requests")
  ) {
    return { kind: "rate_limit", message: input.message, retryable: true };
  }
  if (
    input.status === 408 ||
    code.includes("timeout") ||
    code.includes("timed_out") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return { kind: "transport_timeout", message: input.message, retryable: true };
  }
  if (
    (input.status !== undefined && input.status >= 500) ||
    code.includes("server_error") ||
    code.includes("service_unavailable") ||
    code.includes("internal_error")
  ) {
    return { kind: "service_error", message: input.message, retryable: true };
  }
  if (
    code.includes("model_not_found") ||
    code.includes("unsupported") ||
    code.includes("invalid_parameter") ||
    input.status === 400 ||
    input.status === 404 ||
    input.status === 422
  ) {
    return { kind: "configuration", message: input.message, retryable: false };
  }
  return { kind: "service_error", message: input.message, retryable: true };
}

function defaultRetryable(kind: ProviderAttemptFailureKind): boolean {
  return (
    kind === "rate_limit" ||
    kind === "service_error" ||
    kind === "transport_timeout" ||
    kind === "transport_error" ||
    kind === "empty_output" ||
    kind === "malformed_output" ||
    kind === "wrong_tool" ||
    kind === "undecodable_structured_output"
  );
}

function rawResponseFromError(
  error: unknown,
  credentialValues: readonly string[] = [],
): SanitizedProviderResponseEvidence {
  const record = asRecord(error);
  const response = asRecord(record.response);
  const status = readNumber(record.status) ?? readNumber(response.status);
  const headers = headersFromUnknown(
    record.headers ?? response.headers,
    credentialValues,
  );
  const rawBody = record.body ??
    record.error ??
    response.body ?? {
      name: readString(record.name),
      message: readString(record.message) || String(error),
      ...(readString(record.code) && { code: readString(record.code) }),
    };
  return {
    ...(status !== undefined && { status }),
    ...(headers && Object.keys(headers).length > 0 && { headers }),
    body: sanitizeProviderEvidence(rawBody, credentialValues),
  };
}

function headersFromUnknown(
  value: unknown,
  credentialValues: readonly string[],
): Record<string, string> | undefined {
  if (value instanceof Headers) return sanitizeHeaders(value, credentialValues);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return sanitizeHeaders(
    new Headers(value as Record<string, string>),
    credentialValues,
  );
}

function requestIdFromResponse(
  response: unknown,
  rawResponse?: SanitizedProviderResponseEvidence,
): string | undefined {
  const record = asRecord(response);
  return (
    readString(record._request_id) ||
    readString(record.request_id) ||
    rawResponse?.headers?.["x-request-id"] ||
    rawResponse?.headers?.["request-id"]
  );
}

function requestIdFromError(
  error: unknown,
  rawResponse?: SanitizedProviderResponseEvidence,
): string | undefined {
  const record = asRecord(error);
  return (
    readString(record.request_id) ||
    readString(record.requestId) ||
    rawResponse?.headers?.["x-request-id"] ||
    rawResponse?.headers?.["request-id"]
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isCredentialField(key: string): boolean {
  return CREDENTIAL_FIELD.test(key) || CREDENTIAL_FIELD_SUFFIX.test(key);
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
