import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import {
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "../__tests__/owner-learning-test-utils.js";
import type {
  PrivateTracePutObjectInput,
  PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import {
  persistOwnerLearningFailureEvidence,
  prepareOwnerLearningFailureEvidence,
  sanitizeOwnerLearningFailureExceptionForLog,
} from "./owner-learning-failure-evidence.js";
import { reconcileOwnerLearningFailureEvidence } from "./owner-learning-failure-reconciliation.js";
import { readOwnerLearningFailureEvidence } from "./owner-learning-failure-read-model.js";

class MemoryFailureEvidenceStorage implements PrivateTraceStorageAdapter {
  readonly objects = new Map<string, PrivateTracePutObjectInput>();

  constructor(
    private readonly putFailure?: Error,
    private readonly readFailure?: Error,
  ) {}

  async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    if (this.putFailure) throw this.putFailure;
    this.objects.set(`${input.bucket}/${input.key}`, input);
    return { etag: "failure-evidence-etag" };
  }

  async getObject(input: {
    bucket: string;
    key: string;
    offsetBytes?: number;
    maxBytes?: number;
  }): Promise<{
    bodyBytes: Uint8Array;
    contentLength?: number;
    contentRange?: string;
    contentType?: string;
  }> {
    if (this.readFailure) throw this.readFailure;
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (!object) throw new Error("object not found");
    const bytes = Buffer.from(object.body, "utf8");
    const offset = input.offsetBytes ?? 0;
    const end = input.maxBytes === undefined ? bytes.byteLength : offset + input.maxBytes;
    const bodyBytes = bytes.subarray(offset, end);
    return {
      bodyBytes,
      contentLength: bodyBytes.byteLength,
      contentRange: `bytes ${offset}-${offset + bodyBytes.byteLength - 1}/${bytes.byteLength}`,
      contentType: object.contentType,
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<{ contentLength?: number; contentType?: string }> {
    if (this.readFailure) throw this.readFailure;
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (!object) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(object.body, "utf8"),
      contentType: object.contentType,
    };
  }
}

class HangingFailureEvidenceStorage extends MemoryFailureEvidenceStorage {
  override async getObject(): Promise<never> {
    return new Promise<never>(() => undefined);
  }
}

class EmptyRangeFailureEvidenceStorage extends MemoryFailureEvidenceStorage {
  override async getObject(): Promise<{
    bodyBytes: Uint8Array;
    contentLength: number;
    contentRange: string;
    contentType: string;
  }> {
    return {
      bodyBytes: new Uint8Array(),
      contentLength: 0,
      contentRange: "bytes 0-0/1",
      contentType: "application/json",
    };
  }
}

class CorruptingFailureEvidenceStorage extends MemoryFailureEvidenceStorage {
  override async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    return super.putObject({ ...input, body: `${input.body.slice(0, -1)}!` });
  }
}

async function insertFailedCall(db: DrizzleDB, reviewId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.agentLearningReviewCalls).values({
    id,
    reviewId,
    ordinal: 4,
    attemptOrdinal: 1,
    state: "failed",
    stage: "drafting_recommendations",
    inputPolicyHash: "sha256:failure-input",
    finalProviderRequestId: "request-owner-learning-failure",
    safeFailureCode: "proposal_contract",
  });
  return id;
}

describe("owner learning failure evidence", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("preserves exact non-secret evidence and reports credential-only redactions", () => {
    const credential = "super-secret-provider-credential";
    const prepared = prepareOwnerLearningFailureEvidence({
      reviewId: "review-redaction",
      phase: "output_validation",
      diagnostic: {
        diagnosticId: "diagnostic-redaction",
        failureCode: "invalid_structured_output",
        errorCode: "proposal_contract",
        providerRequestId: "req-redaction",
        providerResponseId: "resp-redaction",
      },
      error: new Error(`proposal mismatch: ${credential}`),
      requestEvidence: {
        instructions: "Return the reviewed strategy proposal.",
        headers: { authorization: `Bearer ${credential}` },
        url: `https://provider.example/generate?api_key=${credential}&mode=review`,
        signedUrl: "https://storage.example/object?x-amz-security-token=CLOUD_SESSION_SENTINEL#access_token=OAUTH_FRAGMENT_SENTINEL",
      },
      responseEvidence: {
        id: "resp-redaction",
        output: "PROPOSAL_SENTINEL",
        headers: { "set-cookie": `session=${credential}` },
      },
      responseObservedAt: "2026-08-27T22:00:00.000Z",
      decodedOutput: { after: "Use patient coalition building." },
      validation: { code: "proposal_contract", path: "$.proposal.after" },
      redactionCredentialValues: [credential],
      now: new Date("2026-08-27T22:00:01.000Z"),
    });

    expect(prepared.body).toContain("PROPOSAL_SENTINEL");
    expect(prepared.body).toContain("Return the reviewed strategy proposal.");
    expect(prepared.body).not.toContain(credential);
    expect(prepared.body).not.toContain("CLOUD_SESSION_SENTINEL");
    expect(prepared.body).not.toContain("OAUTH_FRAGMENT_SENTINEL");
    expect(prepared.body).toContain("[REDACTED]");
    expect(prepared.redactionReport.length).toBeGreaterThanOrEqual(3);
    expect(prepared.metadata.providerResponseObserved).toBe(true);
    expect(prepared.providerResponseSha256).toMatch(/^sha256:/);
  });

  test("keeps exception correlation in logs without duplicating database-bound private bodies", () => {
    const cause = new Error("root storage failure");
    const error = new Error(
      "Failed query: update review checkpoint\nparams: PRIVATE_CHECKPOINT_BODY,PRIVATE_PROVIDER_RESPONSE",
      { cause },
    );
    Object.assign(error, {
      params: "PRIVATE_CHECKPOINT_BODY",
      constraint: "agent_learning_reviews_checkpoint_check",
    });
    error.stack = `${error.message}\n    at persistCheckpoint (owner-learning-worker.ts:1:1)`;

    const sanitized = sanitizeOwnerLearningFailureExceptionForLog(error);
    expect(JSON.stringify(sanitized)).not.toContain("PRIVATE_CHECKPOINT_BODY");
    expect(JSON.stringify(sanitized)).not.toContain("PRIVATE_PROVIDER_RESPONSE");
    expect(sanitized.message).toContain("params: [OMITTED_FROM_APPLICATION_LOG]");
    expect(sanitized.stack).toContain("persistCheckpoint");
    expect(sanitized.cause?.message).toBe("root storage failure");
    expect(sanitized.value).toMatchObject({
      params: "[OMITTED_FROM_APPLICATION_LOG]",
      constraint: "agent_learning_reviews_checkpoint_check",
    });

    const durable = prepareOwnerLearningFailureEvidence({
      reviewId: "review-log-boundary",
      phase: "checkpoint_persistence",
      diagnostic: { failureCode: "internal_error" },
      error,
    });
    expect(durable.body).toContain("PRIVATE_CHECKPOINT_BODY");
    expect(durable.body).toContain("agent_learning_reviews_checkpoint_check");
  });

  test("refuses to classify invalid structured output without a provider response", () => {
    expect(() => prepareOwnerLearningFailureEvidence({
      reviewId: "review-no-response",
      phase: "output_validation",
      diagnostic: { failureCode: "invalid_structured_output" },
      error: new Error("malformed"),
    })).toThrow("requires an observed provider response");
  });

  test("atomically stages, reconciles, reads, and audits exact evidence", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const callId = await insertFailedCall(db, reviewId);
    await db.update(schema.agentLearningReviewCalls).set({
      providerResponseId: "resp-raw-receipt",
      providerResponseObservedAt: "2026-08-27T21:59:59.000Z",
      providerResponseSha256: "sha256:raw-provider-response",
    }).where(eq(schema.agentLearningReviewCalls.id, callId));
    const prepared = prepareOwnerLearningFailureEvidence({
      reviewId,
      phase: "output_validation",
      diagnostic: {
        diagnosticId: randomUUID(),
        failureCode: "invalid_structured_output",
        errorCode: "proposal_contract",
        providerRequestId: "req-stage",
        providerResponseId: "resp-stage",
      },
      error: new Error("proposal.after did not contain a real change"),
      requestEvidence: { messages: [{ role: "user", content: "REQUEST_SENTINEL 🧪" }] },
      responseEvidence: { id: "resp-stage", output: "RESPONSE_SENTINEL" },
      responseObservedAt: "2026-08-27T22:00:00.000Z",
      decodedOutput: { after: "RESPONSE_SENTINEL" },
      validation: { code: "proposal_contract" },
      now: new Date("2026-08-27T22:00:01.000Z"),
    });

    await persistOwnerLearningFailureEvidence(db, {
      reviewId,
      call: { id: callId, ordinal: 4, attemptOrdinal: 1 },
      prepared,
    });

    expect((await db.select().from(schema.agentLearningReviewFailureDiagnostics))).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0]).toMatchObject({
      id: prepared.manifestId,
      state: "pending",
      storageKey: null,
    });
    expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0]).toMatchObject({
      diagnosticId: prepared.diagnostic.id,
      body: prepared.body,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, callId)))[0]).toMatchObject({
      evidenceState: "pending",
      failureDiagnosticId: prepared.diagnostic.id,
      providerResponseId: "resp-raw-receipt",
      providerResponseObservedAt: "2026-08-27T21:59:59.000Z",
      providerResponseSha256: "sha256:raw-provider-response",
    });

    const storage = new MemoryFailureEvidenceStorage();
    expect(await reconcileOwnerLearningFailureEvidence(db, {
      diagnosticId: prepared.diagnostic.id,
      storage,
      bucket: "owner-learning-private",
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

    expect(await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox)).toHaveLength(0);
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0]).toMatchObject({
      state: "stored",
      storageProvider: "linode_object_storage",
      storageBucket: "owner-learning-private",
      storageKey: prepared.storageKey,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, callId)))[0]?.evidenceState).toBe("stored");

    const denied = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["owner"] },
      purpose: "debug_review_failure",
    }, { storage });
    expect(denied).toMatchObject({ ok: false, status: "denied" });

    const allowed = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["admin"] },
      purpose: "debug_review_failure",
    }, { storage });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.response.content).toContain("REQUEST_SENTINEL");
      expect(allowed.response.content).toContain("RESPONSE_SENTINEL");
      expect(Buffer.from(allowed.response.contentBase64, "base64").toString("utf8"))
        .toBe(allowed.response.content);
      expect(allowed.response.sha256).toBe(prepared.bodySha256);
      expect(allowed.response.hashScope).toBe("complete_object");
    }
    const partial = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["sysop"] },
      purpose: "download_review_failure",
      offsetBytes: 5,
      maxBytes: 17,
    }, { storage });
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.response).toMatchObject({
        offsetBytes: 5,
        returnedByteLength: 17,
        nextOffsetBytes: 22,
        truncated: true,
        hashScope: "chunk",
      });
      expect(partial.response.sha256).toMatch(/^sha256:/);
      expect(partial.response.sha256).not.toBe(prepared.bodySha256);
    }
    const markerOffset = Buffer.byteLength(
      prepared.body.slice(0, prepared.body.indexOf("🧪")),
      "utf8",
    );
    const firstMarkerHalf = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["admin"] },
      purpose: "download_review_failure",
      offsetBytes: markerOffset,
      maxBytes: 2,
    }, { storage });
    const secondMarkerHalf = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["admin"] },
      purpose: "download_review_failure",
      offsetBytes: markerOffset + 2,
      maxBytes: 2,
    }, { storage });
    expect(firstMarkerHalf.ok).toBe(true);
    expect(secondMarkerHalf.ok).toBe(true);
    if (firstMarkerHalf.ok && secondMarkerHalf.ok) {
      expect(Buffer.concat([
        Buffer.from(firstMarkerHalf.response.contentBase64, "base64"),
        Buffer.from(secondMarkerHalf.response.contentBase64, "base64"),
      ]).toString("utf8")).toBe("🧪");
    }
    const emptyRange = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["admin"] },
      purpose: "download_review_failure",
    }, { storage: new EmptyRangeFailureEvidenceStorage() });
    expect(emptyRange).toMatchObject({ ok: false, status: "integrity_mismatch" });
    expect(await db.select().from(schema.agentLearningReviewFailureManifestReads)).toHaveLength(6);
    expect((await db.select().from(schema.agentLearningReviewFailureManifestReads)
      .orderBy(schema.agentLearningReviewFailureManifestReads.id)).map((row) => row.outcome)).toEqual([
      "denied",
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "integrity_mismatch",
    ]);
  });

  test("keeps the complete outbox and marks evidence degraded after storage failure", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const callId = await insertFailedCall(db, reviewId);
    const prepared = prepareOwnerLearningFailureEvidence({
      reviewId,
      phase: "provider_invocation",
      diagnostic: { diagnosticId: randomUUID(), failureCode: "provider_error" },
      error: new Error("object storage unavailable"),
      requestEvidence: { input: "DURABLE_OUTBOX_SENTINEL" },
    });
    await persistOwnerLearningFailureEvidence(db, {
      reviewId,
      call: { id: callId, ordinal: 4, attemptOrdinal: 1 },
      prepared,
    });

    const firstAttemptStartedAt = Date.now();
    expect(await reconcileOwnerLearningFailureEvidence(db, {
      diagnosticId: prepared.diagnostic.id,
      storage: new MemoryFailureEvidenceStorage(new Error(
        "storage offline https://storage.example/object?x-amz-security-token=STORAGE_SECRET_SENTINEL",
      )),
      bucket: "owner-learning-private",
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });

    const outbox = (await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0];
    expect(outbox?.body).toBe(prepared.body);
    expect(outbox?.body).toContain("DURABLE_OUTBOX_SENTINEL");
    expect(outbox?.reconciliationAttemptCount).toBe(1);
    expect(outbox?.nextReconciliationAt).toContain("T");
    expect(Date.parse(outbox!.nextReconciliationAt)).toBeGreaterThan(firstAttemptStartedAt);
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0]).toMatchObject({
      state: "degraded",
      lastStorageError: expect.stringContaining("storage offline"),
    });
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0]?.lastStorageError)
      .not.toContain("STORAGE_SECRET_SENTINEL");
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, callId)))[0]?.evidenceState).toBe("degraded");

    const storageEnvNames = [
      "LINODE_PRIVATE_CONTENT_ENDPOINT",
      "LINODE_PRIVATE_CONTENT_ACCESS_KEY",
      "LINODE_PRIVATE_CONTENT_SECRET_KEY",
      "LINODE_PRIVATE_CONTENT_BUCKET",
    ] as const;
    const priorStorageEnv = Object.fromEntries(
      storageEnvNames.map((name) => [name, process.env[name]]),
    );
    for (const name of storageEnvNames) delete process.env[name];
    try {
      await db.update(schema.agentLearningReviewFailureEvidenceOutbox).set({
        nextReconciliationAt: "2026-08-27T21:00:00.000Z",
      }).where(eq(
        schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
        prepared.diagnostic.id,
      ));
      expect(await reconcileOwnerLearningFailureEvidence(db, {
        diagnosticId: prepared.diagnostic.id,
      })).toEqual({ attempted: 1, stored: 0, failed: 1 });
    } finally {
      for (const name of storageEnvNames) {
        const prior = priorStorageEnv[name];
        if (prior === undefined) delete process.env[name];
        else process.env[name] = prior;
      }
    }

    await db.update(schema.agentLearningReviewFailureEvidenceOutbox).set({
      nextReconciliationAt: "2026-08-27T21:00:00.000Z",
    }).where(eq(
      schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
      prepared.diagnostic.id,
    ));
    const recoveredStorage = new MemoryFailureEvidenceStorage();
    expect(await reconcileOwnerLearningFailureEvidence(db, {
      diagnosticId: prepared.diagnostic.id,
      storage: recoveredStorage,
      bucket: "owner-learning-private",
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

    expect(await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox)).toHaveLength(0);
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0]).toMatchObject({
      state: "stored",
      storageKey: prepared.storageKey,
      bodySha256: prepared.bodySha256,
      byteLength: prepared.byteLength,
    });
    expect((await db.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.id, callId)))[0]?.evidenceState).toBe("stored");
    expect(recoveredStorage.objects.get(`owner-learning-private/${prepared.storageKey}`)?.body)
      .toBe(prepared.body);
  });

  test("retains the outbox when storage acknowledges a corrupt object", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const prepared = prepareOwnerLearningFailureEvidence({
      reviewId,
      phase: "provider_invocation",
      diagnostic: { diagnosticId: randomUUID(), failureCode: "provider_error" },
      error: new Error("provider unavailable"),
      requestEvidence: { input: "CORRUPTION_RECOVERY_SENTINEL" },
    });
    await persistOwnerLearningFailureEvidence(db, { reviewId, prepared });

    expect(await reconcileOwnerLearningFailureEvidence(db, {
      diagnosticId: prepared.diagnostic.id,
      storage: new CorruptingFailureEvidenceStorage(),
      bucket: "owner-learning-private",
    })).toEqual({ attempted: 1, stored: 0, failed: 1 });

    expect((await db.select().from(schema.agentLearningReviewFailureEvidenceOutbox))[0])
      .toMatchObject({ diagnosticId: prepared.diagnostic.id, body: prepared.body });
    expect((await db.select().from(schema.agentLearningReviewFailureManifests))[0])
      .toMatchObject({
        state: "degraded",
        lastStorageError: expect.stringContaining("stored object integrity mismatch"),
      });
  });

  test("scrubs storage credentials from audited read failures", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const prepared = prepareOwnerLearningFailureEvidence({
      reviewId,
      phase: "provider_invocation",
      diagnostic: { diagnosticId: randomUUID(), failureCode: "provider_error" },
      error: new Error("provider unavailable"),
    });
    await persistOwnerLearningFailureEvidence(db, { reviewId, prepared });
    const storage = new MemoryFailureEvidenceStorage();
    expect(await reconcileOwnerLearningFailureEvidence(db, {
      diagnosticId: prepared.diagnostic.id,
      storage,
      bucket: "owner-learning-private",
    })).toEqual({ attempted: 1, stored: 1, failed: 0 });

    const read = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["admin"] },
      purpose: "debug_review_failure",
    }, {
      storage: new MemoryFailureEvidenceStorage(
        undefined,
        new Error("read failed https://storage.example/object#access_token=READ_SECRET_SENTINEL"),
      ),
    });
    expect(read).toMatchObject({ ok: false, status: "storage_error" });
    const audit = (await db.select().from(schema.agentLearningReviewFailureManifestReads))[0]!;
    expect(audit.detail).toContain("read failed");
    expect(audit.detail).not.toContain("READ_SECRET_SENTINEL");

    const timedOutRead = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId: prepared.diagnostic.id,
      accessor: { roles: ["sysop"] },
      purpose: "debug_review_failure_timeout",
    }, {
      storage: new HangingFailureEvidenceStorage(),
      readTimeoutMs: 5,
    });
    expect(timedOutRead).toMatchObject({ ok: false, status: "storage_error" });
    const timeoutAudit = (await db.select().from(schema.agentLearningReviewFailureManifestReads)
      .orderBy(schema.agentLearningReviewFailureManifestReads.id)).at(-1)!;
    expect(timeoutAudit).toMatchObject({
      outcome: "storage_error",
      detail: expect.stringContaining("read deadline exceeded"),
    });
  });

  test("reports legacy failures honestly when exact evidence was never captured", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const diagnosticId = randomUUID();
    const manifestId = `owner-learning-failure:${diagnosticId}`;
    await db.insert(schema.agentLearningReviewFailureDiagnostics).values({
      id: diagnosticId,
      reviewId,
      phase: null,
      safeFailureCode: "internal_error",
      errorClass: "LegacyUncapturedFailure",
      errorCode: "legacy_uncaptured",
      sanitizedMessage: "Exact failure evidence was not captured by the legacy worker.",
      fingerprint: `sha256:${"1".repeat(64)}`,
      evidenceManifestId: manifestId,
      occurredAt: "2026-08-27T22:00:01.000Z",
    });
    await db.insert(schema.agentLearningReviewFailureManifests).values({
      id: manifestId,
      diagnosticId,
      reviewId,
      state: "legacy_unavailable",
      sourcePointers: [{ kind: "legacy_owner_learning_review_failure", reviewId }],
      metadata: { legacyUncaptured: true },
    });

    const result = await readOwnerLearningFailureEvidence(db, {
      reviewId,
      diagnosticId,
      accessor: { roles: ["admin"] },
      purpose: "debug_legacy_review_failure",
    });
    expect(result).toEqual({
      ok: false,
      status: "legacy_unavailable",
      error: "Exact evidence was not captured by the legacy worker",
    });
    expect((await db.select().from(schema.agentLearningReviewFailureManifestReads))[0]).toMatchObject({
      manifestId,
      reviewId,
      outcome: "unavailable",
      detail: "legacy_unavailable",
    });
  });

  test("allows only one succeeded attempt for a logical call", async () => {
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const checkpoint = {
      version: 1 as const,
      logicalCallCount: 4,
      diveCount: 0,
      selectedMomentIds: [],
      nextMomentCursor: 0,
      provisionalThemes: [],
      validatedFindings: [],
      lastCompletedStage: "drafting_recommendations" as const,
      promptHash: "sha256:prompt",
      schemaHash: "sha256:schema",
      completion: null,
    };
    const firstId = randomUUID();
    await db.insert(schema.agentLearningReviewCalls).values({
      id: firstId,
      reviewId,
      ordinal: 4,
      attemptOrdinal: 1,
      state: "succeeded",
      stage: "drafting_recommendations",
      inputPolicyHash: "sha256:first",
      validatedCheckpoint: checkpoint,
    });
    let rejected = false;
    try {
      await db.insert(schema.agentLearningReviewCalls).values({
        id: randomUUID(),
        reviewId,
        ordinal: 4,
        attemptOrdinal: 2,
        retryOfAttemptId: firstId,
        state: "succeeded",
        stage: "drafting_recommendations",
        inputPolicyHash: "sha256:second",
        validatedCheckpoint: checkpoint,
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
