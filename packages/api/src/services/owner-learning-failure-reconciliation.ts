import { createHash, randomUUID } from "crypto";
import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createPrivateTraceStorageAdapter,
  getPrivateTraceBucket,
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import {
  sanitizeOwnerLearningFailureExceptionForLog,
  sanitizeOwnerLearningFailureMessage,
} from "./owner-learning-failure-evidence.js";

const DEFAULT_WRITE_TIMEOUT_MS = 15_000;
const CLAIM_LEASE_MS = 30_000;

type OutboxRow = typeof schema.agentLearningReviewFailureEvidenceOutbox.$inferSelect;

export interface OwnerLearningFailureReconciliationResult {
  attempted: number;
  stored: number;
  failed: number;
}

export interface ReconcileOwnerLearningFailureEvidenceOptions {
  diagnosticId?: string;
  limit?: number;
  writeTimeoutMs?: number;
  storage?: PrivateTraceStorageAdapter;
  bucket?: string;
}

function claimedRow(row: OutboxRow) {
  return and(
    eq(schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId, row.diagnosticId),
    row.claimToken
      ? eq(schema.agentLearningReviewFailureEvidenceOutbox.claimToken, row.claimToken)
      : undefined,
  );
}

async function claimRows(
  db: DrizzleDB,
  input: { diagnosticId?: string; limit: number },
): Promise<OutboxRow[]> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const claimToken = randomUUID();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
    const eligible = await tx.select({
      diagnosticId: schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
    }).from(schema.agentLearningReviewFailureEvidenceOutbox).where(and(
      input.diagnosticId
        ? eq(schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId, input.diagnosticId)
        : undefined,
      lte(schema.agentLearningReviewFailureEvidenceOutbox.nextReconciliationAt, now.toISOString()),
      or(
        isNull(schema.agentLearningReviewFailureEvidenceOutbox.claimExpiresAt),
        lte(schema.agentLearningReviewFailureEvidenceOutbox.claimExpiresAt, now.toISOString()),
      ),
    )).orderBy(
      schema.agentLearningReviewFailureEvidenceOutbox.nextReconciliationAt,
      schema.agentLearningReviewFailureEvidenceOutbox.createdAt,
    ).limit(input.limit).for("update", { skipLocked: true });
    if (eligible.length === 0) return [];
    return tx.update(schema.agentLearningReviewFailureEvidenceOutbox).set({
      claimToken,
      claimExpiresAt,
      updatedAt: now.toISOString(),
    }).where(and(
      inArray(
        schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
        eligible.map((row) => row.diagnosticId),
      ),
      or(
        isNull(schema.agentLearningReviewFailureEvidenceOutbox.claimExpiresAt),
        lte(schema.agentLearningReviewFailureEvidenceOutbox.claimExpiresAt, now.toISOString()),
      ),
    )).returning();
  });
}

function assertOutboxIntegrity(row: OutboxRow): void {
  const actualLength = Buffer.byteLength(row.body, "utf8");
  const actualHash = `sha256:${createHash("sha256").update(row.body).digest("hex")}`;
  if (actualLength !== row.byteLength || actualHash !== row.bodySha256) {
    throw new Error("Owner learning failure evidence outbox body integrity mismatch");
  }
  const metadata = row.manifestMetadata;
  if (
    metadata.reviewId !== row.reviewId
    || metadata.diagnosticId !== row.diagnosticId
    || metadata.byteLength !== row.byteLength
    || metadata.sha256 !== row.bodySha256
    || metadata.contentType !== PRIVATE_TRACE_CONTENT_TYPE
  ) {
    throw new Error("Owner learning failure evidence outbox metadata identity mismatch");
  }
  const parsed = JSON.parse(row.body) as Record<string, unknown>;
  if (parsed.reviewId !== row.reviewId || parsed.diagnosticId !== row.diagnosticId) {
    throw new Error("Owner learning failure evidence body identity mismatch");
  }
}

async function finalizeStored(
  db: DrizzleDB,
  row: OutboxRow,
  bucket: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const authority = (await tx.select({
      diagnosticId: schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
    }).from(schema.agentLearningReviewFailureEvidenceOutbox)
      .where(claimedRow(row))
      .for("update"))[0];
    if (!authority) {
      const manifest = (await tx.select({
        state: schema.agentLearningReviewFailureManifests.state,
        storageKey: schema.agentLearningReviewFailureManifests.storageKey,
      }).from(schema.agentLearningReviewFailureManifests)
        .where(eq(schema.agentLearningReviewFailureManifests.id, row.manifestId)))[0];
      if (manifest?.state === "stored" && manifest.storageKey === row.storageKey) return;
      throw new Error("Owner learning failure evidence claim expired before finalization");
    }
    const now = new Date().toISOString();
    const updatedManifest = await tx.update(schema.agentLearningReviewFailureManifests).set({
      state: "stored",
      storageProvider: PRIVATE_TRACE_STORAGE_PROVIDER,
      storageBucket: bucket,
      storageKey: row.storageKey,
      lastStorageError: null,
      storedAt: now,
      updatedAt: now,
    }).where(and(
      eq(schema.agentLearningReviewFailureManifests.id, row.manifestId),
      eq(schema.agentLearningReviewFailureManifests.diagnosticId, row.diagnosticId),
      inArray(schema.agentLearningReviewFailureManifests.state, ["pending", "degraded"]),
    )).returning({ id: schema.agentLearningReviewFailureManifests.id });
    if (updatedManifest.length !== 1) {
      throw new Error("Owner learning failure evidence manifest could not be finalized");
    }
    await tx.update(schema.agentLearningReviewCalls).set({
      evidenceState: "stored",
    }).where(eq(schema.agentLearningReviewCalls.failureDiagnosticId, row.diagnosticId));
    await tx.delete(schema.agentLearningReviewFailureEvidenceOutbox)
      .where(claimedRow(row));
  });
}

async function markDegraded(
  db: DrizzleDB,
  row: OutboxRow,
  error: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const nextAttemptAt = sql<string>`to_char(
      (now() AT TIME ZONE 'UTC') + make_interval(secs => LEAST(
        900,
        (5 * power(2, LEAST(${schema.agentLearningReviewFailureEvidenceOutbox.reconciliationAttemptCount}, 7)))::int
          + (abs(hashtext(${schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId})) % 5)
      )),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )`;
    const released = await tx.update(schema.agentLearningReviewFailureEvidenceOutbox).set({
      reconciliationAttemptCount: sql`${schema.agentLearningReviewFailureEvidenceOutbox.reconciliationAttemptCount} + 1`,
      nextReconciliationAt: nextAttemptAt,
      claimToken: null,
      claimExpiresAt: null,
      updatedAt: new Date().toISOString(),
    }).where(claimedRow(row)).returning({
      diagnosticId: schema.agentLearningReviewFailureEvidenceOutbox.diagnosticId,
    });
    if (released.length === 0) return;
    const now = new Date().toISOString();
    await tx.update(schema.agentLearningReviewFailureManifests).set({
      state: "degraded",
      lastStorageError: error.slice(0, 2_000),
      updatedAt: now,
    }).where(and(
      eq(schema.agentLearningReviewFailureManifests.id, row.manifestId),
      inArray(schema.agentLearningReviewFailureManifests.state, ["pending", "degraded"]),
    ));
    await tx.update(schema.agentLearningReviewCalls).set({
      evidenceState: "degraded",
    }).where(eq(schema.agentLearningReviewCalls.failureDiagnosticId, row.diagnosticId));
  });
}

async function putAndVerifyWithTimeout(
  storage: PrivateTraceStorageAdapter,
  input: { bucket: string; row: OutboxRow; timeoutMs: number },
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Owner learning failure evidence storage deadline exceeded"));
  }, input.timeoutMs);
  timeout.unref();
  try {
    await Promise.race([
      (async () => {
        await storage.putObject({
          bucket: input.bucket,
          key: input.row.storageKey,
          body: input.row.body,
          contentType: PRIVATE_TRACE_CONTENT_TYPE,
          abortSignal: controller.signal,
        });
        const stored = await storage.getObject({
          bucket: input.bucket,
          key: input.row.storageKey,
          abortSignal: controller.signal,
        });
        const bodyBytes = stored.bodyBytes
          ?? (stored.body === undefined ? undefined : Buffer.from(stored.body, "utf8"));
        if (!bodyBytes) {
          throw new Error("Owner learning failure evidence stored object body is unavailable");
        }
        const storedHash = `sha256:${createHash("sha256").update(bodyBytes).digest("hex")}`;
        if (
          bodyBytes.byteLength !== input.row.byteLength
          || storedHash !== input.row.bodySha256
          || stored.contentType !== PRIVATE_TRACE_CONTENT_TYPE
        ) {
          throw new Error("Owner learning failure evidence stored object integrity mismatch");
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(controller.signal.reason ?? new Error("Owner learning failure evidence storage deadline exceeded"));
        }, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function reconcileOwnerLearningFailureEvidence(
  db: DrizzleDB,
  options: ReconcileOwnerLearningFailureEvidenceOptions = {},
): Promise<OwnerLearningFailureReconciliationResult> {
  const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 100)));
  const timeoutMs = Math.max(1, Math.floor(options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS));
  let rows: OutboxRow[];
  try {
    rows = await claimRows(db, { diagnosticId: options.diagnosticId, limit });
  } catch (error) {
    console.error(
      "[owner-learning] Failure evidence outbox claim failed",
      sanitizeOwnerLearningFailureExceptionForLog(error),
    );
    return { attempted: 0, stored: 0, failed: 1 };
  }
  if (rows.length === 0) return { attempted: 0, stored: 0, failed: 0 };
  let storage: PrivateTraceStorageAdapter;
  let bucket: string;
  try {
    storage = options.storage ?? createPrivateTraceStorageAdapter();
    bucket = options.bucket ?? getPrivateTraceBucket();
  } catch (error) {
    const safeError = sanitizeOwnerLearningFailureMessage(error);
    console.error(
      "[owner-learning] Failure evidence storage initialization failed",
      sanitizeOwnerLearningFailureExceptionForLog(error),
    );
    for (const row of rows) {
      try {
        await markDegraded(db, row, safeError);
      } catch (persistenceError) {
        console.error(
          "[owner-learning] Failure evidence initialization state could not be persisted",
          JSON.stringify({ diagnosticId: row.diagnosticId, manifestId: row.manifestId }),
          sanitizeOwnerLearningFailureExceptionForLog(persistenceError),
        );
      }
    }
    return { attempted: rows.length, stored: 0, failed: rows.length };
  }
  let stored = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      assertOutboxIntegrity(row);
      await putAndVerifyWithTimeout(storage, { bucket, row, timeoutMs });
      await finalizeStored(db, row, bucket);
      stored += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[owner-learning] Failure evidence reconciliation failed",
        JSON.stringify({ diagnosticId: row.diagnosticId, manifestId: row.manifestId }),
        sanitizeOwnerLearningFailureExceptionForLog(error),
      );
      try {
        await markDegraded(
          db,
          row,
          sanitizeOwnerLearningFailureMessage(error),
        );
      } catch (persistenceError) {
        // The complete durable outbox remains pending for a later reconciliation.
        console.error(
          "[owner-learning] Failure evidence reconciliation state could not be persisted",
          JSON.stringify({ diagnosticId: row.diagnosticId, manifestId: row.manifestId }),
          sanitizeOwnerLearningFailureExceptionForLog(persistenceError),
        );
      }
    }
  }
  return { attempted: rows.length, stored, failed };
}
