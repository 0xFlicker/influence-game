import { createHash, randomUUID } from "node:crypto";
import type {
  OwnerLearningExecutionPhase,
  OwnerLearningFailureManifestState,
  OwnerLearningOutputFailureCode,
  OwnerLearningSafeFailureCode,
  OwnerLearningStage,
} from "./owner-learning-contracts.js";

export const OWNER_LEARNING_DIAGNOSTIC_MESSAGE_MAX_CHARS = 2_000;
export const OWNER_LEARNING_DIAGNOSTIC_FRAME_MAX_CHARS = 500;

export class OwnerLearningOutputValidationError extends Error {
  constructor(
    readonly code: OwnerLearningOutputFailureCode,
    message: string,
    readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OwnerLearningOutputValidationError";
  }
}

export interface OwnerLearningFailureDiagnosticSummary {
  diagnosticId: string;
  phase: OwnerLearningExecutionPhase;
  failureCode: OwnerLearningSafeFailureCode;
  errorClass: string;
  errorCode: string;
  message: string;
  firstApplicationFrame: string | null;
  fingerprint: string;
  callId: string | null;
  callOrdinal: number | null;
  attemptOrdinal: number | null;
  stage: OwnerLearningStage | null;
  providerRequestId: string | null;
  providerResponseId: string | null;
  evidenceManifestId: string;
  evidenceState: OwnerLearningFailureManifestState;
  legacyUncaptured?: boolean;
}

export function createOwnerLearningFailureDiagnostic(input: {
  phase: OwnerLearningExecutionPhase;
  failureCode: OwnerLearningSafeFailureCode;
  error: unknown;
  errorCode?: string;
  callId?: string | null;
  callOrdinal?: number | null;
  attemptOrdinal?: number | null;
  stage?: OwnerLearningStage | null;
  providerRequestId?: string | null;
  providerResponseId?: string | null;
  evidenceState?: OwnerLearningFailureManifestState;
  diagnosticId?: string;
}): OwnerLearningFailureDiagnosticSummary {
  const diagnosticId = input.diagnosticId ?? randomUUID();
  const error = normalizeError(input.error);
  const nativeErrorCode = input.error !== null && typeof input.error === "object"
    && typeof (input.error as { code?: unknown }).code === "string"
    ? (input.error as { code: string }).code
    : undefined;
  const errorCode = input.errorCode
    ?? (input.error instanceof OwnerLearningOutputValidationError
      ? input.error.code
      : nativeErrorCode ?? error.name);
  const firstApplicationFrame = firstOwnerLearningApplicationFrame(error.stack);
  const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify({
    phase: input.phase,
    failureCode: input.failureCode,
    errorClass: error.name,
    errorCode,
    message: error.message,
    firstApplicationFrame,
  })).digest("hex")}`;
  return {
    diagnosticId,
    phase: input.phase,
    failureCode: input.failureCode,
    errorClass: boundedSingleLine(error.name || "UnknownError", 200),
    errorCode: boundedSingleLine(errorCode, 200),
    message: boundedSingleLine(error.message, OWNER_LEARNING_DIAGNOSTIC_MESSAGE_MAX_CHARS),
    firstApplicationFrame,
    fingerprint,
    callId: input.callId ?? null,
    callOrdinal: input.callOrdinal ?? null,
    attemptOrdinal: input.attemptOrdinal ?? null,
    stage: input.stage ?? null,
    providerRequestId: input.providerRequestId ?? null,
    providerResponseId: input.providerResponseId ?? null,
    evidenceManifestId: ownerLearningFailureManifestId(diagnosticId),
    evidenceState: input.evidenceState ?? "pending",
  };
}

export function ownerLearningFailureManifestId(diagnosticId: string): string {
  return `owner-learning-failure:${diagnosticId}`;
}

function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function firstOwnerLearningApplicationFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  const frame = stack.split("\n").map((line) => line.trim()).find((line) =>
    line.includes("packages/") && !line.includes("node_modules")
  );
  return frame ? boundedSingleLine(frame, OWNER_LEARNING_DIAGNOSTIC_FRAME_MAX_CHARS) : null;
}

function boundedSingleLine(value: string, maxChars: number): string {
  const singleLine = value.replaceAll(/\s+/g, " ").trim();
  return singleLine.length <= maxChars ? singleLine : singleLine.slice(0, maxChars);
}
