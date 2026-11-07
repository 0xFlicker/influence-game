import { GenerationAdmissionError } from "./generation-admission-error.js";
import { retryOwnedVisualReference } from "./visual-render-journal.js";
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
  await db
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
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job || job.requestHash !== requestHash)
    throw new Error("This image request already has different input");
  return readCharacterReference(db, userId, id);
}
export async function readCharacterReference(
  db: DrizzleDB,
  userId: string,
  id: string,
) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
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
    active = processCharacterReference(db, controller.signal)
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
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job || job.status !== "failed")
    throw new Error("Only a failed image request can be retried");
  if (job.stage !== "background" && job.stage !== "portrait")
    await retryOwnedVisualReference(db, userId, id);
  if (job.stage === "background") {
    const { retryCharacterCutout } = await import(
      "./transparent-character-image.js"
    );
    const { loadPayloads } = await import("./payload-storage.js");
    const [operation] = await db
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
        db
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
      if (completed?.image) await retryCharacterCutout(db, completed.image);
    }
  }
  await db
    .update(jobs)
    .set({ status: "queued", error: null, updatedAt: new Date().toISOString() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")));
  return readCharacterReference(db, userId, id);
}
export async function decideCharacterReference(
  db: DrizzleDB,
  userId: string,
  id: string,
  decision: "selected" | "discarded",
) {
  const [job] = await db
    .update(jobs)
    .set({
      status: decision,
      leaseId: null,
      leaseUntil: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.userId, userId),
        decision === "selected"
          ? eq(jobs.status, "ready")
          : sql`${jobs.status} IN ('queued','processing','failed','ready')`,
      ),
    )
    .returning({ id: jobs.id });
  if (!job) {
    const [existing] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
    if (existing?.status === decision) return;
    throw new Error(
      "This artwork was already reviewed. Reload before continuing.",
    );
  }
}
