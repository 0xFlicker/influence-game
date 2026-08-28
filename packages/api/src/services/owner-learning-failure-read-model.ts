import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createPrivateTraceStorageAdapter,
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import { sanitizeOwnerLearningFailureMessage } from "./owner-learning-failure-evidence.js";

export const DEFAULT_OWNER_LEARNING_FAILURE_READ_BYTES = 256 * 1024;
export const MAX_OWNER_LEARNING_FAILURE_READ_BYTES = 1024 * 1024;
const DEFAULT_OWNER_LEARNING_FAILURE_READ_TIMEOUT_MS = 15_000;

export interface OwnerLearningFailureEvidenceAccessor {
  userId?: string;
  roles: readonly string[];
}

export interface ReadOwnerLearningFailureEvidenceInput {
  reviewId: string;
  diagnosticId: string;
  accessor: OwnerLearningFailureEvidenceAccessor;
  purpose: string;
  offsetBytes?: number;
  maxBytes?: number;
}

export interface OwnerLearningFailureEvidenceContent {
  diagnostic: {
    id: string;
    reviewId: string;
    phase: string | null;
    safeFailureCode: string;
    errorClass: string;
    errorCode: string | null;
    sanitizedMessage: string;
    firstApplicationStackFrame: string | null;
    fingerprint: string;
    providerRequestId: string | null;
    providerResponseId: string | null;
    occurredAt: string;
  };
  manifest: {
    id: string;
    state: "stored";
    contentType: string;
    byteLength: number;
    sha256: string;
    metadata: Record<string, unknown>;
  };
  content: string;
  /** Canonical range bytes. Use this for complete chunked downloads. */
  contentBase64: string;
  offsetBytes: number;
  returnedByteLength: number;
  totalByteLength: number;
  nextOffsetBytes?: number;
  truncated: boolean;
  sha256: string;
  hashScope: "complete_object" | "chunk";
}

export type ReadOwnerLearningFailureEvidenceResult =
  | { ok: true; response: OwnerLearningFailureEvidenceContent }
  | {
      ok: false;
      status:
        | "not_found"
        | "denied"
        | "pending"
        | "degraded"
        | "legacy_unavailable"
        | "integrity_mismatch"
        | "storage_error";
      error: string;
    };

export interface OwnerLearningFailureReadOptions {
  storage?: PrivateTraceStorageAdapter;
  readTimeoutMs?: number;
}

async function readObjectWithTimeout(
  storage: PrivateTraceStorageAdapter,
  input: {
    bucket: string;
    key: string;
    offsetBytes: number;
    maxBytes: number;
    timeoutMs: number;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Owner learning failure evidence read deadline exceeded"));
  }, input.timeoutMs);
  timeout.unref();
  try {
    return await Promise.race([
      storage.getObject({
        bucket: input.bucket,
        key: input.key,
        offsetBytes: input.offsetBytes,
        maxBytes: input.maxBytes,
        abortSignal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(controller.signal.reason ?? new Error("Owner learning failure evidence read deadline exceeded"));
        }, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeMaxBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_OWNER_LEARNING_FAILURE_READ_BYTES;
  return Math.max(1, Math.min(MAX_OWNER_LEARNING_FAILURE_READ_BYTES, Math.floor(value)));
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function storageBytes(value: { body?: string; bodyBytes?: Uint8Array }): Uint8Array {
  if (value.bodyBytes) return value.bodyBytes;
  if (value.body !== undefined) return Buffer.from(value.body, "utf8");
  throw new Error("Owner learning failure evidence object body missing");
}

async function auditRead(
  db: DrizzleDB,
  input: {
    manifestId: string;
    reviewId: string;
    accessor: OwnerLearningFailureEvidenceAccessor;
    purpose: string;
    outcome: "allowed" | "denied" | "unavailable" | "integrity_mismatch" | "storage_error";
    detail?: string;
    offsetBytes: number;
    maxBytes: number;
  },
): Promise<void> {
  await db.insert(schema.agentLearningReviewFailureManifestReads).values({
    manifestId: input.manifestId,
    reviewId: input.reviewId,
    accessorUserId: input.accessor.userId,
    accessorRole: input.accessor.roles.slice().sort().join(",") || "none",
    purpose: input.purpose,
    outcome: input.outcome,
    detail: input.detail?.slice(0, 2_000),
    offsetBytes: input.offsetBytes,
    maxBytes: input.maxBytes,
  });
}

export async function readOwnerLearningFailureEvidence(
  db: DrizzleDB,
  input: ReadOwnerLearningFailureEvidenceInput,
  options: OwnerLearningFailureReadOptions = {},
): Promise<ReadOwnerLearningFailureEvidenceResult> {
  const offsetBytes = normalizeOffset(input.offsetBytes);
  const maxBytes = normalizeMaxBytes(input.maxBytes);
  const row = (await db.select({
    diagnosticId: schema.agentLearningReviewFailureDiagnostics.id,
    reviewId: schema.agentLearningReviewFailureDiagnostics.reviewId,
    phase: schema.agentLearningReviewFailureDiagnostics.phase,
    safeFailureCode: schema.agentLearningReviewFailureDiagnostics.safeFailureCode,
    errorClass: schema.agentLearningReviewFailureDiagnostics.errorClass,
    errorCode: schema.agentLearningReviewFailureDiagnostics.errorCode,
    sanitizedMessage: schema.agentLearningReviewFailureDiagnostics.sanitizedMessage,
    firstApplicationStackFrame: schema.agentLearningReviewFailureDiagnostics.firstApplicationStackFrame,
    fingerprint: schema.agentLearningReviewFailureDiagnostics.fingerprint,
    providerRequestId: schema.agentLearningReviewFailureDiagnostics.providerRequestId,
    providerResponseId: schema.agentLearningReviewFailureDiagnostics.providerResponseId,
    occurredAt: schema.agentLearningReviewFailureDiagnostics.occurredAt,
    manifestId: schema.agentLearningReviewFailureManifests.id,
    manifestState: schema.agentLearningReviewFailureManifests.state,
    contentType: schema.agentLearningReviewFailureManifests.contentType,
    byteLength: schema.agentLearningReviewFailureManifests.byteLength,
    bodySha256: schema.agentLearningReviewFailureManifests.bodySha256,
    storageProvider: schema.agentLearningReviewFailureManifests.storageProvider,
    storageBucket: schema.agentLearningReviewFailureManifests.storageBucket,
    storageKey: schema.agentLearningReviewFailureManifests.storageKey,
    metadata: schema.agentLearningReviewFailureManifests.metadata,
  }).from(schema.agentLearningReviewFailureDiagnostics)
    .innerJoin(
      schema.agentLearningReviewFailureManifests,
      eq(
        schema.agentLearningReviewFailureManifests.diagnosticId,
        schema.agentLearningReviewFailureDiagnostics.id,
      ),
    ).where(and(
      eq(schema.agentLearningReviewFailureDiagnostics.id, input.diagnosticId),
      eq(schema.agentLearningReviewFailureDiagnostics.reviewId, input.reviewId),
    )))[0];
  if (!row) return { ok: false, status: "not_found", error: "Owner learning failure diagnostic not found" };

  const authorized = input.accessor.roles.some((role) => role === "admin" || role === "sysop");
  if (!authorized) {
    await auditRead(db, {
      manifestId: row.manifestId,
      reviewId: row.reviewId,
      accessor: input.accessor,
      purpose: input.purpose,
      outcome: "denied",
      detail: "current_role_not_authorized",
      offsetBytes,
      maxBytes,
    });
    return { ok: false, status: "denied", error: "Owner learning failure evidence access denied" };
  }
  if (row.manifestState !== "stored") {
    await auditRead(db, {
      manifestId: row.manifestId,
      reviewId: row.reviewId,
      accessor: input.accessor,
      purpose: input.purpose,
      outcome: "unavailable",
      detail: row.manifestState,
      offsetBytes,
      maxBytes,
    });
    return {
      ok: false,
      status: row.manifestState,
      error: row.manifestState === "legacy_unavailable"
        ? "Exact evidence was not captured by the legacy worker"
        : `Owner learning failure evidence is ${row.manifestState}`,
    };
  }
  if (
    row.storageProvider !== PRIVATE_TRACE_STORAGE_PROVIDER
    || !row.storageBucket
    || !row.storageKey
    || row.contentType !== PRIVATE_TRACE_CONTENT_TYPE
    || row.byteLength === null
    || !row.bodySha256
  ) {
    await auditRead(db, {
      manifestId: row.manifestId,
      reviewId: row.reviewId,
      accessor: input.accessor,
      purpose: input.purpose,
      outcome: "integrity_mismatch",
      detail: "stored_manifest_pointer_invalid",
      offsetBytes,
      maxBytes,
    });
    return { ok: false, status: "integrity_mismatch", error: "Stored failure manifest is invalid" };
  }

  try {
    const storage = options.storage ?? createPrivateTraceStorageAdapter();
    const object = await readObjectWithTimeout(storage, {
      bucket: row.storageBucket,
      key: row.storageKey,
      offsetBytes,
      maxBytes,
      timeoutMs: Math.max(1, Math.floor(
        options.readTimeoutMs ?? DEFAULT_OWNER_LEARNING_FAILURE_READ_TIMEOUT_MS,
      )),
    });
    const bodyBytes = storageBytes(object);
    const returnedByteLength = bodyBytes.byteLength;
    const nextOffset = offsetBytes + returnedByteLength;
    const truncated = nextOffset < row.byteLength;
    const complete = offsetBytes === 0 && returnedByteLength === row.byteLength;
    const returnedHash = sha256Bytes(bodyBytes);
    if (complete && returnedHash !== row.bodySha256) {
      await auditRead(db, {
        manifestId: row.manifestId,
        reviewId: row.reviewId,
        accessor: input.accessor,
        purpose: input.purpose,
        outcome: "integrity_mismatch",
        detail: "complete_object_sha256_mismatch",
        offsetBytes,
        maxBytes,
      });
      return { ok: false, status: "integrity_mismatch", error: "Failure evidence integrity check failed" };
    }
    if (
      offsetBytes >= row.byteLength
      || returnedByteLength === 0
      || returnedByteLength > maxBytes
      || nextOffset > row.byteLength
      || object.contentLength !== returnedByteLength
      || !validContentRange(object.contentRange, offsetBytes, returnedByteLength, row.byteLength)
      || object.contentType !== row.contentType
    ) {
      await auditRead(db, {
        manifestId: row.manifestId,
        reviewId: row.reviewId,
        accessor: input.accessor,
        purpose: input.purpose,
        outcome: "integrity_mismatch",
        detail: "returned_range_invalid",
        offsetBytes,
        maxBytes,
      });
      return { ok: false, status: "integrity_mismatch", error: "Failure evidence range is invalid" };
    }
    await auditRead(db, {
      manifestId: row.manifestId,
      reviewId: row.reviewId,
      accessor: input.accessor,
      purpose: input.purpose,
      outcome: "allowed",
      offsetBytes,
      maxBytes,
    });
    return {
      ok: true,
      response: {
        diagnostic: {
          id: row.diagnosticId,
          reviewId: row.reviewId,
          phase: row.phase,
          safeFailureCode: row.safeFailureCode,
          errorClass: row.errorClass,
          errorCode: row.errorCode,
          sanitizedMessage: row.sanitizedMessage,
          firstApplicationStackFrame: row.firstApplicationStackFrame,
          fingerprint: row.fingerprint,
          providerRequestId: row.providerRequestId,
          providerResponseId: row.providerResponseId,
          occurredAt: row.occurredAt,
        },
        manifest: {
          id: row.manifestId,
          state: "stored",
          contentType: row.contentType,
          byteLength: row.byteLength,
          sha256: row.bodySha256,
          metadata: row.metadata,
        },
        content: Buffer.from(bodyBytes).toString("utf8"),
        contentBase64: Buffer.from(bodyBytes).toString("base64"),
        offsetBytes,
        returnedByteLength,
        totalByteLength: row.byteLength,
        ...(truncated && { nextOffsetBytes: nextOffset }),
        truncated,
        sha256: complete ? row.bodySha256 : returnedHash,
        hashScope: complete ? "complete_object" : "chunk",
      },
    };
  } catch (error) {
    await auditRead(db, {
      manifestId: row.manifestId,
      reviewId: row.reviewId,
      accessor: input.accessor,
      purpose: input.purpose,
      outcome: "storage_error",
      detail: sanitizeOwnerLearningFailureMessage(error),
      offsetBytes,
      maxBytes,
    });
    return { ok: false, status: "storage_error", error: "Failure evidence storage read failed" };
  }
}

function validContentRange(
  value: string | undefined,
  offsetBytes: number,
  returnedByteLength: number,
  totalByteLength: number,
): boolean {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) return false;
  return Number(match[1]) === offsetBytes
    && Number(match[2]) === offsetBytes + returnedByteLength - 1
    && Number(match[3]) === totalByteLength;
}
