import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { OwnerLearningExecutionPhase } from "./owner-learning-contracts.js";
import {
  PRIVATE_TRACE_CONTENT_TYPE,
} from "./private-trace-storage.js";
import { ownerLearningFailureManifestId } from "./owner-learning-failures.js";
import { stableJson } from "./stable-hash.js";

const MAX_DIAGNOSTIC_MESSAGE_BYTES = 2_000;
const MAX_STACK_FRAME_BYTES = 1_000;
const CREDENTIAL_KEY = /^(?:authorization|proxy-authorization|cookie|cookies|set-cookie|x-api-key|x-auth-token|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key|signing[_-]?key|password|passwd|secret|token|signature)$/i;
const URL_SECRET_QUERY_KEY = /^(?:access_token|refresh_token|id_token|session_token|api[_-]?key|key|token|secret|password|code|client_secret|credential|signature|sig|awsaccesskeyid|googleaccessid|x-amz-credential|x-amz-security-token|x-amz-signature|x-goog-credential|x-goog-signature)$/i;
const CONFIGURED_SECRET_ENV_KEY = /(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHORIZATION|COOKIE)/i;
const APPLICATION_LOG_BODY_KEY = /^(?:params|parameters|bindings|query|request|response|input|output|body|checkpoint|prompt|messages|schema|capture)$/i;
const REDACTED = "[REDACTED]";

export interface OwnerLearningFailureErrorRecord {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: OwnerLearningFailureErrorRecord;
  value?: unknown;
}

export interface OwnerLearningFailureRedaction {
  path: string;
  reason:
    | "credential_field"
    | "credential_url_component"
    | "credential_authorization_value"
    | "configured_secret_value";
}

export interface PreparedOwnerLearningDurableValue {
  body: string;
  bodySha256: string;
  byteLength: number;
  redactionReport: OwnerLearningFailureRedaction[];
}

export interface OwnerLearningFailureDiagnosticInput {
  diagnosticId?: string;
  failureCode: string;
  errorCode?: string;
  errorClass?: string;
  message?: string;
  firstApplicationFrame?: string | null;
  providerRequestId?: string | null;
  providerResponseId?: string | null;
  evidenceManifestId?: string;
  occurredAt?: string;
}

export interface PrepareOwnerLearningFailureEvidenceInput {
  reviewId: string;
  phase: OwnerLearningExecutionPhase;
  diagnostic: OwnerLearningFailureDiagnosticInput;
  error: unknown;
  requestEvidence?: unknown;
  responseEvidence?: unknown;
  responseObservedAt?: string;
  decodedOutput?: unknown;
  validation?: unknown;
  tokenReceipt?: unknown;
  costReceipt?: unknown;
  checkpoint?: unknown;
  protocol?: unknown;
  additionalEvidence?: unknown;
  redactionCredentialValues?: readonly string[];
  now?: Date;
}

export interface PreparedOwnerLearningFailureEvidence {
  diagnostic: {
    id: string;
    reviewId: string;
    phase: OwnerLearningExecutionPhase;
    safeFailureCode: string;
    errorClass: string;
    errorCode?: string;
    sanitizedMessage: string;
    firstApplicationStackFrame?: string;
    fingerprint: string;
    providerRequestId?: string;
    providerResponseId?: string;
    evidenceManifestId: string;
    occurredAt: string;
  };
  body: string;
  bodySha256: string;
  byteLength: number;
  storageKey: string;
  manifestId: string;
  responseObservedAt?: string;
  providerResponseSha256?: string;
  metadata: {
    formatVersion: 1;
    contentType: typeof PRIVATE_TRACE_CONTENT_TYPE;
    byteLength: number;
    sha256: string;
    reviewId: string;
    diagnosticId: string;
    phase: OwnerLearningExecutionPhase;
    safeFailureCode: string;
    providerResponseObserved: boolean;
    redactionCount: number;
    createdAt: string;
  };
  redactionReport: OwnerLearningFailureRedaction[];
}

export interface EnqueueOwnerLearningFailureEvidenceInput {
  reviewId: string;
  call?: {
    id: string;
    ordinal: number;
    attemptOrdinal: number;
  };
  /** Supplemental evidence names its call without replacing the call's original failure link. */
  linkCall?: boolean;
  prepared: PreparedOwnerLearningFailureEvidence;
}

type EvidenceTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bounded(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, Math.max(0, maxBytes - 3)).toString("utf8").replace(/\uFFFD+$/u, "") + "...";
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function serializeOwnerLearningFailureError(
  error: unknown,
  seen = new Set<unknown>(),
): OwnerLearningFailureErrorRecord {
  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: typeof error === "string" ? error : "Non-Error failure value",
      value: normalizeEvidenceValue(error),
    };
  }
  if (seen.has(error)) {
    return { name: error.name || "Error", message: "[Circular error cause]" };
  }
  seen.add(error);
  const code = errorCode(error);
  const cause = "cause" in error && error.cause !== undefined
    ? serializeOwnerLearningFailureError(error.cause, seen)
    : undefined;
  const supplementalEntries = Object.entries(error).filter(([key]) =>
    !["name", "message", "stack", "code", "cause"].includes(key)
  );
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    ...(error.stack && { stack: error.stack }),
    ...(code && { code }),
    ...(cause && { cause }),
    ...(supplementalEntries.length > 0 && {
      value: normalizeEvidenceValue(Object.fromEntries(supplementalEntries), new Set([error])),
    }),
  };
}

function normalizeEvidenceValue(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) return value;
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeOwnerLearningFailureError(value);
  if (value instanceof Uint8Array) {
    return { encoding: "base64", value: Buffer.from(value).toString("base64") };
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const normalized = value.map((item) => normalizeEvidenceValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeEvidenceValue(item, seen)]),
  );
  seen.delete(value);
  return normalized;
}

function configuredSecrets(explicit: readonly string[]): string[] {
  return Array.from(new Set([
    ...explicit,
    ...Object.entries(process.env)
      .filter(([name, value]) => CONFIGURED_SECRET_ENV_KEY.test(name) && typeof value === "string")
      .map(([, value]) => value as string),
  ].filter((value) => value.length >= 6))).sort((left, right) => right.length - left.length);
}

function redactString(
  value: string,
  path: string,
  secrets: readonly string[],
  report: OwnerLearningFailureRedaction[],
): string {
  let output = value;
  const authorizationRedacted = output.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`);
  if (authorizationRedacted !== output) {
    report.push({ path, reason: "credential_authorization_value" });
    output = authorizationRedacted;
  }
  for (const secret of secrets) {
    if (!output.includes(secret)) continue;
    report.push({ path, reason: "configured_secret_value" });
    output = output.split(secret).join(REDACTED);
  }
  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      let changed = false;
      if (url.username || url.password) {
        url.username = REDACTED;
        url.password = REDACTED;
        changed = true;
      }
      for (const key of Array.from(url.searchParams.keys())) {
        if (!URL_SECRET_QUERY_KEY.test(key)) continue;
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
      if (url.hash) {
        const redactedHash = url.hash.replace(
          /([#?&])([^=&]+)=([^&]*)/g,
          (match, separator: string, encodedKey: string) => {
            let key = encodedKey;
            try {
              key = decodeURIComponent(encodedKey);
            } catch {
              // Use the encoded key for matching when decoding fails.
            }
            if (!URL_SECRET_QUERY_KEY.test(key)) return match;
            changed = true;
            return `${separator}${encodedKey}=${encodeURIComponent(REDACTED)}`;
          },
        );
        url.hash = redactedHash;
      }
      if (changed) {
        report.push({ path, reason: "credential_url_component" });
        return url.toString();
      }
    } catch {
      // Preserve malformed URLs exactly after configured-secret replacement.
    }
    return candidate;
  });
  return output;
}

function sanitizeEvidence(
  value: unknown,
  path: string,
  secrets: readonly string[],
  report: OwnerLearningFailureRedaction[],
): unknown {
  if (typeof value === "string") return redactString(value, path, secrets, report);
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeEvidence(item, `${path}[${index}]`, secrets, report));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const childPath = `${path}.${key}`;
    if (CREDENTIAL_KEY.test(key)) {
      report.push({ path: childPath, reason: "credential_field" });
      return [key, REDACTED];
    }
    return [key, sanitizeEvidence(item, childPath, secrets, report)];
  }));
}

/**
 * Serialize a review-call artifact exactly after the narrow credential-only
 * redaction policy. This runs before provider dispatch and as soon as a
 * transport response is observed, so later parser or worker failures cannot
 * erase evidence that already existed.
 */
export function prepareOwnerLearningDurableValue(
  value: unknown,
  redactionCredentialValues: readonly string[] = [],
): PreparedOwnerLearningDurableValue {
  const redactionReport: OwnerLearningFailureRedaction[] = [];
  const evidence = sanitizeEvidence(
    normalizeEvidenceValue(value),
    "$.evidence",
    configuredSecrets(redactionCredentialValues),
    redactionReport,
  );
  const body = stableJson({
    schemaVersion: 1,
    evidence,
    redactionReport: {
      version: 1,
      count: redactionReport.length,
      redactions: redactionReport,
    },
  });
  return {
    body,
    bodySha256: sha256(body),
    byteLength: Buffer.byteLength(body, "utf8"),
    redactionReport,
  };
}

export function sanitizeOwnerLearningFailureException(
  error: unknown,
  redactionCredentialValues: readonly string[] = [],
): OwnerLearningFailureErrorRecord {
  const report: OwnerLearningFailureRedaction[] = [];
  return sanitizeEvidence(
    serializeOwnerLearningFailureError(error),
    "$.error",
    configuredSecrets(redactionCredentialValues),
    report,
  ) as OwnerLearningFailureErrorRecord;
}

export function sanitizeOwnerLearningFailureMessage(
  error: unknown,
  redactionCredentialValues: readonly string[] = [],
): string {
  return bounded(
    sanitizeOwnerLearningFailureException(error, redactionCredentialValues).message,
    MAX_DIAGNOSTIC_MESSAGE_BYTES,
  );
}

/**
 * Application logs retain the exception/cause structure and stack frames, but
 * omit SQL parameter values because those can contain checkpoints, prompts, or
 * provider responses. The byte-complete sanitized values remain in the private
 * diagnostic envelope instead.
 */
export function sanitizeOwnerLearningFailureExceptionForLog(
  error: unknown,
  redactionCredentialValues: readonly string[] = [],
): OwnerLearningFailureErrorRecord {
  function omitDatabaseParameters(record: OwnerLearningFailureErrorRecord): OwnerLearningFailureErrorRecord {
    const { value, ...safeRecord } = record;
    return {
      ...safeRecord,
      message: omitDatabaseParameterLines(record.message),
      ...(record.stack && { stack: omitDatabaseParameterLines(record.stack) }),
      ...(record.cause && { cause: omitDatabaseParameters(record.cause) }),
      ...(value !== undefined && { value: sanitizeSupplementalLogValue(value) }),
    };
  }
  return omitDatabaseParameters(
    sanitizeOwnerLearningFailureException(error, redactionCredentialValues),
  );
}

function sanitizeSupplementalLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSupplementalLogValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    APPLICATION_LOG_BODY_KEY.test(key)
      ? "[OMITTED_FROM_APPLICATION_LOG]"
      : sanitizeSupplementalLogValue(item),
  ]));
}

function omitDatabaseParameterLines(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  let omitting = false;
  for (const line of lines) {
    if (/^\s*(?:params|parameters|bindings):/i.test(line)) {
      output.push("params: [OMITTED_FROM_APPLICATION_LOG]");
      omitting = true;
      continue;
    }
    if (omitting && /^\s+at\s/.test(line)) omitting = false;
    if (!omitting) output.push(line);
  }
  return output.join("\n");
}

function firstApplicationStackFrame(error: OwnerLearningFailureErrorRecord): string | undefined {
  const lines = error.stack?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
  return lines.find((line) => (
    line.startsWith("at ")
    && !line.includes("node:internal")
    && !line.includes("/node_modules/")
  ));
}

function storageKey(reviewId: string, diagnosticId: string): string {
  const safeReviewId = reviewId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeDiagnosticId = diagnosticId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `content/owner-learning-reviews/${safeReviewId}/failures/${safeDiagnosticId}.json`;
}

export function prepareOwnerLearningFailureEvidence(
  input: PrepareOwnerLearningFailureEvidenceInput,
): PreparedOwnerLearningFailureEvidence {
  const now = input.now ?? new Date();
  const occurredAt = input.diagnostic.occurredAt ?? now.toISOString();
  const diagnosticId = input.diagnostic.diagnosticId ?? randomUUID();
  const manifestId = input.diagnostic.evidenceManifestId
    ?? ownerLearningFailureManifestId(diagnosticId);
  const safeFailureCode = input.diagnostic.failureCode;
  const normalizedError = serializeOwnerLearningFailureError(input.error);
  const secrets = configuredSecrets(input.redactionCredentialValues ?? []);
  const redactionReport: OwnerLearningFailureRedaction[] = [];
  const normalizedEnvelope = normalizeEvidenceValue({
    schemaVersion: 1,
    reviewId: input.reviewId,
    diagnosticId,
    phase: input.phase,
    safeFailureCode,
    occurredAt,
    error: normalizedError,
    request: input.requestEvidence,
    response: input.responseEvidence,
    responseObservedAt: input.responseObservedAt,
    decodedOutput: input.decodedOutput,
    validation: input.validation,
    tokenReceipt: input.tokenReceipt,
    costReceipt: input.costReceipt,
    checkpoint: input.checkpoint,
    protocol: input.protocol,
    additionalEvidence: input.additionalEvidence,
    providerRequestId: input.diagnostic.providerRequestId,
    providerResponseId: input.diagnostic.providerResponseId,
  });
  const sanitizedEnvelope = sanitizeEvidence(
    normalizedEnvelope,
    "$",
    secrets,
    redactionReport,
  ) as Record<string, unknown>;
  const sanitizedError = sanitizedEnvelope.error as OwnerLearningFailureErrorRecord;
  const rawMessage = input.diagnostic.message ?? sanitizedError.message ?? "Owner review failed";
  const sanitizedMessage = bounded(
    redactString(rawMessage, "$.diagnostic.message", secrets, redactionReport),
    MAX_DIAGNOSTIC_MESSAGE_BYTES,
  );
  const rawFrame = input.diagnostic.firstApplicationFrame
    ?? firstApplicationStackFrame(sanitizedError);
  const frame = rawFrame
    ? bounded(redactString(rawFrame, "$.diagnostic.firstApplicationStackFrame", secrets, redactionReport), MAX_STACK_FRAME_BYTES)
    : undefined;
  const errorClass = bounded(redactString(
    input.diagnostic.errorClass ?? sanitizedError.name,
    "$.diagnostic.errorClass",
    secrets,
    redactionReport,
  ), 200);
  const rawDiagnosticCode = input.diagnostic.errorCode ?? sanitizedError.code;
  const diagnosticCode = rawDiagnosticCode
    ? bounded(redactString(
      rawDiagnosticCode,
      "$.diagnostic.errorCode",
      secrets,
      redactionReport,
    ), 200)
    : undefined;
  const fingerprint = sha256(stableJson({
    phase: input.phase,
    safeFailureCode,
    errorClass,
    errorCode: diagnosticCode ?? null,
    message: sanitizedMessage,
    firstApplicationStackFrame: frame ?? null,
  }));
  if (
    safeFailureCode === "invalid_structured_output"
    && (!input.responseObservedAt || input.responseEvidence === undefined)
  ) {
    throw new Error("invalid_structured_output requires an observed provider response and response evidence");
  }
  const envelope = {
    ...sanitizedEnvelope,
    diagnostic: {
      id: diagnosticId,
      errorClass,
      ...(diagnosticCode && { errorCode: diagnosticCode }),
      message: sanitizedMessage,
      ...(frame && { firstApplicationStackFrame: frame }),
      fingerprint,
    },
    redactionReport: {
      version: 1,
      count: redactionReport.length,
      redactions: redactionReport,
    },
  };
  const body = stableJson(envelope);
  const bodySha256 = sha256(body);
  const byteLength = Buffer.byteLength(body, "utf8");
  const metadata = {
    formatVersion: 1,
    contentType: PRIVATE_TRACE_CONTENT_TYPE,
    byteLength,
    sha256: bodySha256,
    reviewId: input.reviewId,
    diagnosticId,
    phase: input.phase,
    safeFailureCode,
    providerResponseObserved: input.responseObservedAt !== undefined,
    redactionCount: redactionReport.length,
    createdAt: occurredAt,
  } as const;
  return {
    diagnostic: {
      id: diagnosticId,
      reviewId: input.reviewId,
      phase: input.phase,
      safeFailureCode,
      errorClass,
      ...(diagnosticCode && { errorCode: diagnosticCode }),
      sanitizedMessage,
      ...(frame && { firstApplicationStackFrame: frame }),
      fingerprint,
      ...(input.diagnostic.providerRequestId && { providerRequestId: input.diagnostic.providerRequestId }),
      ...(input.diagnostic.providerResponseId && { providerResponseId: input.diagnostic.providerResponseId }),
      evidenceManifestId: manifestId,
      occurredAt,
    },
    body,
    bodySha256,
    byteLength,
    storageKey: storageKey(input.reviewId, diagnosticId),
    manifestId,
    ...(input.responseObservedAt && {
      responseObservedAt: input.responseObservedAt,
      providerResponseSha256: sha256(stableJson(sanitizedEnvelope.response)),
    }),
    metadata,
    redactionReport,
  };
}

/**
 * Enqueue exact evidence inside the caller's review-failure transaction. The
 * parent transaction remains authoritative for the review_failed event/state.
 */
export async function enqueueOwnerLearningFailureEvidence(
  tx: EvidenceTransaction,
  input: EnqueueOwnerLearningFailureEvidenceInput,
): Promise<void> {
  const { prepared, call } = input;
  if (prepared.diagnostic.reviewId !== input.reviewId) {
    throw new Error("Owner learning failure evidence review identity mismatch");
  }
  if (call) {
    const matchingCall = (await tx.select({ id: schema.agentLearningReviewCalls.id })
      .from(schema.agentLearningReviewCalls)
      .where(and(
        eq(schema.agentLearningReviewCalls.id, call.id),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        eq(schema.agentLearningReviewCalls.ordinal, call.ordinal),
        eq(schema.agentLearningReviewCalls.attemptOrdinal, call.attemptOrdinal),
      )))[0];
    if (!matchingCall) throw new Error("Owner learning failure evidence call identity mismatch");
  }
  await tx.insert(schema.agentLearningReviewFailureDiagnostics).values({
    id: prepared.diagnostic.id,
    reviewId: input.reviewId,
    callId: call?.id,
    callOrdinal: call?.ordinal,
    attemptOrdinal: call?.attemptOrdinal,
    phase: prepared.diagnostic.phase,
    safeFailureCode: prepared.diagnostic.safeFailureCode,
    errorClass: prepared.diagnostic.errorClass,
    errorCode: prepared.diagnostic.errorCode,
    sanitizedMessage: prepared.diagnostic.sanitizedMessage,
    firstApplicationStackFrame: prepared.diagnostic.firstApplicationStackFrame,
    fingerprint: prepared.diagnostic.fingerprint,
    providerRequestId: prepared.diagnostic.providerRequestId,
    providerResponseId: prepared.diagnostic.providerResponseId,
    evidenceManifestId: prepared.manifestId,
    occurredAt: prepared.diagnostic.occurredAt,
  });
  await tx.insert(schema.agentLearningReviewFailureManifests).values({
    id: prepared.manifestId,
    diagnosticId: prepared.diagnostic.id,
    reviewId: input.reviewId,
    state: "pending",
    contentType: PRIVATE_TRACE_CONTENT_TYPE,
    byteLength: prepared.byteLength,
    bodySha256: prepared.bodySha256,
    sourcePointers: [{
      kind: "owner_learning_review_failure",
      reviewId: input.reviewId,
      diagnosticId: prepared.diagnostic.id,
      ...(call && {
        callId: call.id,
        callOrdinal: call.ordinal,
        attemptOrdinal: call.attemptOrdinal,
      }),
    }],
    metadata: prepared.metadata,
  });
  await tx.insert(schema.agentLearningReviewFailureEvidenceOutbox).values({
    diagnosticId: prepared.diagnostic.id,
    reviewId: input.reviewId,
    manifestId: prepared.manifestId,
    body: prepared.body,
    bodySha256: prepared.bodySha256,
    byteLength: prepared.byteLength,
    storageKey: prepared.storageKey,
    manifestMetadata: prepared.metadata,
  });
  if (call && input.linkCall !== false) {
    const updated = await tx.update(schema.agentLearningReviewCalls).set({
      failureDiagnosticId: prepared.diagnostic.id,
      evidenceState: "pending",
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, call.id),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
    )).returning({ id: schema.agentLearningReviewCalls.id });
    if (updated.length !== 1) throw new Error("Owner learning failure call linkage could not be persisted");
  }
}

export async function persistOwnerLearningFailureEvidence(
  db: DrizzleDB,
  input: EnqueueOwnerLearningFailureEvidenceInput,
): Promise<void> {
  await db.transaction((tx) => enqueueOwnerLearningFailureEvidence(tx, input));
}
