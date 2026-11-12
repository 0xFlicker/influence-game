import { recoverExpiredImageExecutions } from "./inference-allowances.js";
import {
  requireImageQueueCapacity,
  recoverAgentGenerationSlots,
  cancelAgentGeneration,
} from "./agent-generations.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";
import {
  retryOwnedVisualReference,
  VisualRenderRecoveryRequired,
} from "./visual-render-journal.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { sha256StableJson } from "./stable-hash.js";
import { generateVisualProfileReference } from "./visual-profile-generation.js";
import { CharacterBackgroundPending } from "./transparent-character-image.js";
const jobs = schema.characterReferenceJobs;
export async function requestCharacterReference(
  db: DrizzleDB,
  userId: string,
  input: Record<string, unknown>,
  publicBaseUrl: string,
) {
  const id = input.requestId;
  if (
    typeof id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(id) ||
    !["create", "edit"].includes(String(input.operation)) ||
    typeof input.name !== "string" ||
    !input.name.trim()
  )
    throw new Error("A request UUID, operation and name are required");
  if ("uploadSource" in input)
    throw new Error("Agent images must be generated");
  const agentId = typeof input.agentId === "string" ? input.agentId : null;
  if (agentId) {
    const [owned] = await db
      .select({ id: schema.agentProfiles.id })
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.id, agentId),
          eq(schema.agentProfiles.userId, userId),
        ),
      );
    if (!owned) throw new Error("Agent not found");
  }
  const requestHash = sha256StableJson(input),
    document = await storeJson({ ...input, publicBaseUrl });
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, id));
    if (existing) return;
    await requireImageQueueCapacity(tx, userId);
    await tx
      .insert(jobs)
      .values({
        id,
        userId,
        agentId,
        draftScope:
          typeof input.draftScope === "string" ? input.draftScope : null,
        requestHash,
        input: document,
      })
      .onConflictDoNothing();
  });
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job || job.requestHash !== requestHash)
    throw new Error("This image request already has different input");
  return readCharacterReference(db, userId, id);
}
export async function readCharacterReference(
  db: Pick<DrizzleDB, "select">,
  userId: string,
  id: string,
) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job) return null;
  // Recovery is derived from the actual dispatch journal, including older jobs.
  // Discarding a draft never erases an uncertain attempt or invents a free retry.
  const entries =
    job.status === "failed"
      ? await db
          .select({
            receipt: schema.visualRenderAttempts.receipt,
            reconciliation: schema.visualRenderAttempts.reconciliation,
            imageHash: schema.visualRenderAttempts.imageHash,
            generation: schema.visualRenderAttempts.generation,
            currentGeneration: schema.visualRenderOperations.generation,
          })
          .from(schema.visualRenderAttempts)
          .innerJoin(
            schema.visualRenderOperations,
            eq(
              schema.visualRenderAttempts.operationId,
              schema.visualRenderOperations.id,
            ),
          )
          .where(
            and(
              eq(schema.visualRenderOperations.userId, userId),
              eq(schema.visualRenderOperations.operationKey, `full-body:${id}`),
            ),
          )
      : [];
  const reusable = entries.some(
    (entry) =>
      entry.generation === entry.currentGeneration &&
      entry.imageHash &&
      entry.receipt &&
      !entry.receipt.failure &&
      !entry.receipt.chargeUncertain,
  );
  const unresolved =
    !reusable &&
    entries.some(
      (entry) =>
        !entry.reconciliation &&
        (!entry.receipt || entry.receipt.chargeUncertain),
    );
  const stageCode =
    job.stage === "background"
      ? "background_failed"
      : job.stage === "portrait"
        ? "portrait_failed"
        : "artwork_failed";
  const errorCode =
    job.status !== "failed"
      ? null
      : unresolved
        ? "artwork_recovery_required"
        : !job.errorCode ||
            ["artwork_recovery_required", "artwork_failed"].includes(
              job.errorCode,
            )
          ? stageCode
          : job.errorCode;
  const retryable =
    job.status === "failed" &&
    ![
      "artwork_recovery_required",
      "generation_recovery_required",
      "generation_paused",
      "generation_exhausted",
    ].includes(errorCode!);
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error:
      errorCode === "artwork_recovery_required"
        ? "Image generation stopped."
        : job.status === "failed"
          ? "Image preparation failed."
          : null,
    errorCode,
    retryable,
    result: job.result ? await readJson(job.result) : null,
  };
}
export async function processCharacterReference(
  db: DrizzleDB,
  signal?: AbortSignal,
) {
  const job = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        or(
          and(
            eq(jobs.status, "queued"),
            sql`(${jobs.stage} != 'background' OR ${jobs.updatedAt}::timestamptz < now() - interval '3 seconds')`,
          ),
          and(
            eq(jobs.status, "processing"),
            sql`${jobs.leaseUntil}::timestamptz < now()`,
          ),
        ),
      )
      .orderBy(asc(jobs.updatedAt), asc(jobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "processing",
        leaseId: randomUUID(),
        leaseUntil: new Date(Date.now() + 120_000).toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(jobs.id, candidate.id))
      .returning();
    return claimed!;
  });
  if (!job) return;
  const fence = and(
    eq(jobs.id, job.id),
    eq(jobs.leaseId, job.leaseId!),
    eq(jobs.status, "processing"),
  );
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void db
      .update(jobs)
      .set({ leaseUntil: new Date(Date.now() + 120_000).toISOString() })
      .where(fence)
      .returning({ id: jobs.id })
      .then((rows) => {
        if (!rows.length) controller.abort();
      })
      .catch(() => controller.abort());
  }, 15_000);
  try {
    const input = await readJson(job.input);
    const activity = {
      beforeDispatch: async (
        tx?: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
      ) => {
        signal?.throwIfAborted();
        controller.signal.throwIfAborted();
        const query = (tx ?? db)
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(fence, sql`${jobs.leaseUntil}::timestamptz > now()`));
        const rows = await (tx ? query.for("update") : query);
        if (!rows.length)
          throw new Error("Image request was cancelled or interrupted");
      },
      signal: signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal,
      onStep: async (stage: string) => {
        signal?.throwIfAborted();
        controller.signal.throwIfAborted();
        const rows = await db
          .update(jobs)
          .set({ stage, updatedAt: new Date().toISOString() })
          .where(fence)
          .returning({ id: jobs.id });
        if (!rows.length) throw new Error("Image job lease changed");
      },
    };
    const result = await generateVisualProfileReference(
      db,
      job.userId,
      input,
      activity,
    );
    await db
      .update(jobs)
      .set({
        result: await storeJson({
          ...result,
          basedOn: {
            name: input.name,
            personaKey: input.personaKey,
            visualDesign: input.visualDesign,
            performanceInstructions: input.performanceInstructions,
          },
        }),
        status: "ready",
        stage: "review",
        leaseId: null,
        leaseUntil: null,
        error: null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      })
      .where(fence);
  } catch (cause) {
    const pending = cause instanceof CharacterBackgroundPending;
    const busy =
      cause instanceof GenerationAdmissionError &&
      cause.code === "generation_busy";
    await db
      .update(jobs)
      .set({
        status: busy || pending ? "queued" : "failed",
        ...(busy ? { stage: "waiting" } : {}),
        errorCode:
          busy || pending
            ? null
            : cause instanceof VisualRenderRecoveryRequired
              ? "artwork_recovery_required"
              : cause instanceof GenerationAdmissionError
                ? cause.code
                : "artwork_failed",
        error:
          busy || pending
            ? null
            : cause instanceof Error
              ? cause.message
              : "Image preparation failed",
        leaseId: null,
        leaseUntil: null,
        updatedAt: new Date().toISOString(),
      })
      .where(fence);
  } finally {
    clearInterval(heartbeat);
  }
}
export function startCharacterReferenceWorker(
  db: DrizzleDB,
  canClaim: () => boolean,
) {
  let active: Promise<void> | null = null,
    stopped = false;
  let controller: AbortController | null = null;
  const tick = () => {
    if (stopped || active || !canClaim()) return;
    controller = new AbortController();
    active = recoverAgentGenerationSlots(db)
      .then(() => processCharacterReference(db, controller!.signal))
      .catch((error) => console.error("[character-reference]", error))
      .finally(() => {
        active = null;
      });
  };
  const timer = setInterval(tick, 1000);
  tick();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      await active;
    },
  };
}

export async function retryCharacterReference(
  db: DrizzleDB,
  userId: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    await recoverExpiredImageExecutions(tx, userId);
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
      .for("update");
    if (!job || job.status !== "failed")
      throw new Error("Only a failed image request can be retried");
    const failure = await readCharacterReference(tx, userId, id);
    if (!failure?.retryable)
      throw new GenerationAdmissionError(
        failure?.errorCode ?? "artwork_failed",
        failure?.error ?? "Image preparation stopped.",
      );
    if (job.stage !== "background" && job.stage !== "portrait") {
      await requireImageQueueCapacity(tx, userId);
      await retryOwnedVisualReference(tx, userId, id);
    }
    if (job.stage === "background") {
      const { retryCharacterCutout } = await import(
        "./transparent-character-image.js"
      );
      const { loadPayloads } = await import("./payload-storage.js");
      const [operation] = await tx
        .select()
        .from(schema.visualRenderOperations)
        .where(
          and(
            eq(schema.visualRenderOperations.userId, userId),
            eq(schema.visualRenderOperations.operationKey, `full-body:${id}`),
          ),
        );
      if (operation) {
        const attempts = await loadPayloads(
          tx
            .select()
            .from(schema.visualRenderAttempts)
            .where(eq(schema.visualRenderAttempts.operationId, operation.id)),
        );
        const completed = attempts.find(
          (attempt) =>
            attempt.image &&
            attempt.receipt &&
            !attempt.receipt.failure &&
            !attempt.receipt.chargeUncertain,
        );
        if (completed?.image) await retryCharacterCutout(tx, completed.image);
      }
    }
    await tx
      .update(jobs)
      .set({
        status: "queued",
        error: null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(jobs.id, id), eq(jobs.status, "failed")));
    return readCharacterReference(tx, userId, id);
  });
}

export async function decideCharacterReference(
  db: DrizzleDB,
  userId: string,
  id: string,
  decision: "selected" | "discarded",
) {
  if (decision === "discarded") {
    const [selected] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.userId, userId),
          eq(jobs.status, "selected"),
        ),
      );
    if (selected) return;
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new GenerationAdmissionError(
        "artwork_not_found",
        "Image request is unavailable.",
        404,
      );
    const [known] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, id));
    if (!known) {
      // A cancel may arrive before the creation POST. An owned tombstone stops
      // that late request from becoming fresh paid work after the draft is gone.
      await db
        .insert(jobs)
        .values({
          id,
          userId,
          status: "discarded",
          requestHash: sha256StableJson({ discarded: id }),
          input: await storeJson({ discarded: true }),
        })
        .onConflictDoNothing();
    }
  }
  if (decision === "discarded") {
    await cancelAgentGeneration(db, userId, id, "reference");
    return;
  }
  const [job] = await db
    .update(jobs)
    .set({
      status: decision,
      leaseId: null,
      leaseUntil: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(eq(jobs.id, id), eq(jobs.userId, userId), eq(jobs.status, "ready")),
    )
    .returning({ id: jobs.id });
  if (!job) {
    const [existing] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
    if (existing?.status === decision) return;
    if (!existing)
      throw new GenerationAdmissionError(
        "artwork_not_found",
        "Image request is unavailable.",
        404,
      );
    throw new Error(
      "This artwork was already reviewed. Reload before continuing.",
    );
  }
}
