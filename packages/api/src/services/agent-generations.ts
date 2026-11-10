import { visualUpdateRequestId } from "./agent-visual-update-generation.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  cancelImageExecution,
  imageExecutionCapacity,
  recoverExpiredImageExecutions,
} from "./inference-allowances.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";

type Reader = Pick<DrizzleDB, "select">;
export interface AgentGeneration {
  id: string;
  source: "reference" | "avatar" | "preparation" | "reservation";
  name: string;
  agentId: string | null;
  draftScope: string | null;
  status: "queued" | "running" | "stopped" | "ready";
  stage: string;
  createdAt: string;
  blocksGeneration: boolean;
}

/** Owner-only operational metadata. Never reads prompts, binaries or provider payloads. */
export async function listAgentGenerations(
  db: Reader,
  userId: string,
): Promise<AgentGeneration[]> {
  const [jobs, reservations, avatars, preparations] = await Promise.all([
    db
      .select({
        id: schema.characterReferenceJobs.id,
        agentId: schema.characterReferenceJobs.agentId,
        draftScope: schema.characterReferenceJobs.draftScope,
        status: schema.characterReferenceJobs.status,
        stage: schema.characterReferenceJobs.stage,
        createdAt: schema.characterReferenceJobs.createdAt,
        leaseUntil: schema.characterReferenceJobs.leaseUntil,
        name: sql<string>`COALESCE(${schema.agentProfiles.name},${schema.agentEditorDrafts.name},'Image request')`,
      })
      .from(schema.characterReferenceJobs)
      .leftJoin(
        schema.agentProfiles,
        eq(schema.agentProfiles.id, schema.characterReferenceJobs.agentId),
      )
      .leftJoin(
        schema.agentEditorDrafts,
        and(
          eq(schema.agentEditorDrafts.userId, userId),
          eq(
            schema.agentEditorDrafts.scope,
            schema.characterReferenceJobs.draftScope,
          ),
        ),
      )
      .where(
        and(
          eq(schema.characterReferenceJobs.userId, userId),
          inArray(schema.characterReferenceJobs.status, [
            "queued",
            "processing",
            "failed",
            "ready",
          ]),
        ),
      )
      .orderBy(desc(schema.characterReferenceJobs.createdAt)),
    db
      .select({
        reservation: schema.inferenceReservations,
        operationKey: schema.visualRenderOperations.operationKey,
        generation: schema.visualRenderOperations.generation,
      })
      .from(schema.inferenceReservations)
      .leftJoin(
        schema.visualRenderOperations,
        eq(
          schema.visualRenderOperations.id,
          schema.inferenceReservations.visualOperationId,
        ),
      )
      .where(
        and(
          eq(schema.inferenceReservations.userId, userId),
          eq(schema.inferenceReservations.category, "image"),
          inArray(schema.inferenceReservations.state, [
            "reserved",
            "dispatched",
            "uncertain",
          ]),
          sql`${schema.inferenceReservations.executionReleaseReason} IS DISTINCT FROM 'cancelled'`,
        ),
      )
      .orderBy(
        asc(schema.inferenceReservations.createdAt),
        asc(schema.inferenceReservations.id),
      ),
    db
      .select({
        id: schema.avatarGenerationRequests.id,
        agentId: schema.avatarGenerationRequests.agentProfileId,
        status: schema.avatarGenerationRequests.status,
        createdAt: schema.avatarGenerationRequests.createdAt,
        name: schema.agentProfiles.name,
      })
      .from(schema.avatarGenerationRequests)
      .leftJoin(
        schema.agentProfiles,
        eq(
          schema.agentProfiles.id,
          schema.avatarGenerationRequests.agentProfileId,
        ),
      )
      .where(
        and(
          eq(schema.avatarGenerationRequests.userId, userId),
          inArray(schema.avatarGenerationRequests.status, [
            "queued",
            "processing",
          ]),
        ),
      ),
    db
      .select({
        id: schema.agentVisualUpdates.id,
        agentId: schema.agentVisualUpdates.agentId,
        status: schema.agentVisualUpdates.status,
        stage: schema.agentVisualUpdates.stage,
        attempt: schema.agentVisualUpdates.attempt,
        leaseUntil: schema.agentVisualUpdates.leaseUntil,
        createdAt: schema.agentVisualUpdates.createdAt,
        name: schema.agentProfiles.name,
        fullBodyReferenceUrl: schema.agentProfiles.fullBodyReferenceUrl,
      })
      .from(schema.agentVisualUpdates)
      .innerJoin(
        schema.agentProfiles,
        eq(schema.agentProfiles.id, schema.agentVisualUpdates.agentId),
      )
      .where(
        and(
          eq(schema.agentVisualUpdates.userId, userId),
          inArray(schema.agentVisualUpdates.status, [
            "queued",
            "processing",
            "failed",
          ]),
          sql`${schema.agentVisualUpdates.errorCode} IS DISTINCT FROM 'cancelled'`,
        ),
      ),
  ]);
  const now = Date.now();
  const holds = (r: typeof schema.inferenceReservations.$inferSelect) =>
    !r.executionReleasedAt &&
    !!r.executionLeaseUntil &&
    Date.parse(r.executionLeaseUntil) > now &&
    r.state !== "uncertain";
  const byJob = new Map(
    reservations
      .filter(
        (r) =>
          r.operationKey?.startsWith("full-body:") &&
          (r.reservation.id ===
            `visual:${r.reservation.visualOperationId}:${r.generation}` ||
            (r.generation === 1 &&
              r.reservation.id ===
                `visual:${r.reservation.visualOperationId}`)),
      )
      .map((r) => [r.operationKey!.slice("full-body:".length), r.reservation]),
  );
  const rows: AgentGeneration[] = jobs.map((job) => {
    const reservation = byJob.get(job.id);
    const stopped =
      job.status === "failed" ||
      (!!reservation && !holds(reservation)) ||
      (job.status === "processing" &&
        !!job.leaseUntil &&
        Date.parse(job.leaseUntil) < now);
    const status =
      job.status === "ready"
        ? "ready"
        : stopped
          ? "stopped"
          : job.status === "queued"
            ? "queued"
            : "running";
    return {
      id: job.id,
      source: "reference",
      name: job.name || "Image request",
      agentId: job.agentId,
      draftScope: job.draftScope,
      status,
      stage: job.stage,
      createdAt: job.createdAt,
      blocksGeneration:
        !stopped &&
        status !== "ready" &&
        !["background", "portrait"].includes(job.stage),
    };
  });
  for (const avatar of avatars) {
    const r = reservations.find(
      (r) => r.reservation.avatarRequestId === avatar.id,
    )?.reservation;
    const stopped = !!r && !holds(r);
    rows.push({
      id: avatar.id,
      source: "avatar",
      name: avatar.name ?? "Image request",
      agentId: avatar.agentId,
      draftScope: null,
      status: stopped
        ? "stopped"
        : avatar.status === "queued"
          ? "queued"
          : "running",
      stage: "image",
      createdAt: avatar.createdAt,
      blocksGeneration: !stopped,
    });
  }
  for (const job of preparations) {
    const stopped =
      job.status === "failed" ||
      (job.status === "processing" &&
        !!job.leaseUntil &&
        Date.parse(job.leaseUntil) < now);
    rows.push({
      id: job.id,
      source: "preparation",
      agentId: job.agentId,
      draftScope: null,
      name: job.name,
      status: stopped
        ? "stopped"
        : job.status === "queued"
          ? "queued"
          : "running",
      stage: job.stage,
      createdAt: job.createdAt,
      blocksGeneration:
        !stopped &&
        !job.fullBodyReferenceUrl &&
        ["details", "body"].includes(job.stage),
    });
  }
  for (const { reservation: r, operationKey } of reservations) {
    if (
      (operationKey?.startsWith("full-body:") &&
        jobs.some((j) => operationKey === "full-body:" + j.id)) ||
      (r.avatarRequestId && avatars.some((a) => a.id === r.avatarRequestId))
    )
      continue;
    if (
      preparations.some(
        (job) =>
          operationKey ===
          "full-body:" + visualUpdateRequestId(job.id, "body", job.attempt),
      )
    )
      continue;
    rows.push({
      id: r.id,
      source: "reservation",
      name: "Previous image request",
      agentId: null,
      draftScope: null,
      status: holds(r) ? "running" : "stopped",
      stage: "image",
      createdAt: r.createdAt,
      blocksGeneration: holds(r),
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.blocksGeneration) - Number(a.blocksGeneration) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** Called while holding the owner's queue lock; the provider admission remains authoritative. */
export async function requireImageQueueCapacity(
  tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
  userId: string,
) {
  const capacity = await imageExecutionCapacity(tx, userId);
  const pending = await listAgentGenerations(tx, userId);
  if (pending.filter((row) => row.blocksGeneration).length >= capacity)
    throw new GenerationAdmissionError(
      "generation_pending",
      "An image request is already in progress.",
      409,
    );
}

/** Cancellation is separate from billing settlement and retains all late receipts. */
export async function cancelAgentGeneration(
  db: DrizzleDB,
  userId: string,
  id: string,
  source: AgentGeneration["source"],
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    // Take the same account lock as admission before changing jobs or reservations.
    await recoverExpiredImageExecutions(tx, userId);
    if (source === "reference") {
      const [job] = await tx
        .select()
        .from(schema.characterReferenceJobs)
        .where(
          and(
            eq(schema.characterReferenceJobs.id, id),
            eq(schema.characterReferenceJobs.userId, userId),
          ),
        )
        .for("update");
      if (!job)
        throw new GenerationAdmissionError(
          "artwork_not_found",
          "Image request is unavailable.",
          404,
        );
      if (job.status === "selected")
        throw new GenerationAdmissionError(
          "artwork_changed",
          "Artwork was already selected.",
          409,
        );
      await tx
        .update(schema.characterReferenceJobs)
        .set({
          status: "discarded",
          leaseId: null,
          leaseUntil: null,
          error: null,
          errorCode: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.characterReferenceJobs.id, id));
      const linked = await tx
        .select({ id: schema.inferenceReservations.id })
        .from(schema.inferenceReservations)
        .innerJoin(
          schema.visualRenderOperations,
          eq(
            schema.visualRenderOperations.id,
            schema.inferenceReservations.visualOperationId,
          ),
        )
        .where(
          and(
            eq(schema.inferenceReservations.userId, userId),
            eq(schema.visualRenderOperations.operationKey, "full-body:" + id),
          ),
        );
      for (const r of linked) await cancelImageExecution(tx, userId, r.id);
    } else if (source === "preparation") {
      const [job] = await tx
        .select()
        .from(schema.agentVisualUpdates)
        .where(
          and(
            eq(schema.agentVisualUpdates.id, id),
            eq(schema.agentVisualUpdates.userId, userId),
          ),
        )
        .for("update");
      if (!job)
        throw new GenerationAdmissionError(
          "artwork_not_found",
          "Image request is unavailable.",
          404,
        );
      if (
        ["completed", "held"].includes(job.status) ||
        (job.status === "processing" && job.stage === "saving")
      )
        throw new GenerationAdmissionError(
          "artwork_changed",
          "Agent changes are being saved.",
          409,
        );
      await tx
        .update(schema.agentVisualUpdates)
        .set({
          status: "failed",
          errorCode: "cancelled",
          leaseId: null,
          leaseUntil: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.agentVisualUpdates.id, id));
      const linked = await tx
        .select({ id: schema.inferenceReservations.id })
        .from(schema.inferenceReservations)
        .innerJoin(
          schema.visualRenderOperations,
          eq(
            schema.visualRenderOperations.id,
            schema.inferenceReservations.visualOperationId,
          ),
        )
        .where(
          and(
            eq(schema.inferenceReservations.userId, userId),
            eq(
              schema.visualRenderOperations.operationKey,
              "full-body:" + visualUpdateRequestId(job.id, "body", job.attempt),
            ),
          ),
        );
      for (const r of linked) await cancelImageExecution(tx, userId, r.id);
    } else if (source === "avatar") {
      const [job] = await tx
        .select()
        .from(schema.avatarGenerationRequests)
        .where(
          and(
            eq(schema.avatarGenerationRequests.id, id),
            eq(schema.avatarGenerationRequests.userId, userId),
          ),
        )
        .for("update");
      if (!job)
        throw new GenerationAdmissionError(
          "artwork_not_found",
          "Image request is unavailable.",
          404,
        );
      if (["queued", "processing", "failed"].includes(job.status))
        await tx
          .update(schema.avatarGenerationRequests)
          .set({
            status: "skipped",
            failureCode: "user_cancelled",
            failureMessage: "Image request cancelled.",
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.avatarGenerationRequests.id, id));
      const linked = await tx
        .select()
        .from(schema.inferenceReservations)
        .where(
          and(
            eq(schema.inferenceReservations.userId, userId),
            eq(schema.inferenceReservations.avatarRequestId, id),
          ),
        );
      for (const r of linked) await cancelImageExecution(tx, userId, r.id);
    } else {
      const [r] = await tx
        .select()
        .from(schema.inferenceReservations)
        .where(
          and(
            eq(schema.inferenceReservations.userId, userId),
            eq(schema.inferenceReservations.id, id),
            eq(schema.inferenceReservations.category, "image"),
          ),
        );
      if (!r)
        throw new GenerationAdmissionError(
          "artwork_not_found",
          "Image request is unavailable.",
          404,
        );
      // Linked work must be fenced through its job cancellation, never hidden by its reservation ID.
      if (r.visualOperationId) {
        const [operation] = await tx
          .select()
          .from(schema.visualRenderOperations)
          .where(eq(schema.visualRenderOperations.id, r.visualOperationId));
        const [live] = await tx
          .select({ id: schema.characterReferenceJobs.id })
          .from(schema.characterReferenceJobs)
          .where(
            and(
              eq(schema.characterReferenceJobs.userId, userId),
              sql`${operation?.operationKey ?? ""} = 'full-body:' || ${schema.characterReferenceJobs.id}`,
              inArray(schema.characterReferenceJobs.status, [
                "queued",
                "processing",
                "ready",
              ]),
            ),
          );
        const preparations = await tx
          .select({
            id: schema.agentVisualUpdates.id,
            attempt: schema.agentVisualUpdates.attempt,
          })
          .from(schema.agentVisualUpdates)
          .where(
            and(
              eq(schema.agentVisualUpdates.userId, userId),
              inArray(schema.agentVisualUpdates.status, [
                "queued",
                "processing",
              ]),
            ),
          );
        if (
          preparations.some(
            (job) =>
              operation?.operationKey ===
              "full-body:" + visualUpdateRequestId(job.id, "body", job.attempt),
          )
        )
          throw new GenerationAdmissionError(
            "artwork_changed",
            "Open the image request to cancel it.",
            409,
          );
        if (live)
          throw new GenerationAdmissionError(
            "artwork_changed",
            "Open the image request to cancel it.",
            409,
          );
      }
      if (r.avatarRequestId) {
        const [live] = await tx
          .select({ id: schema.avatarGenerationRequests.id })
          .from(schema.avatarGenerationRequests)
          .where(
            and(
              eq(schema.avatarGenerationRequests.id, r.avatarRequestId),
              inArray(schema.avatarGenerationRequests.status, [
                "queued",
                "processing",
              ]),
            ),
          );
        if (live)
          throw new GenerationAdmissionError(
            "artwork_changed",
            "Open the image request to cancel it.",
            409,
          );
      }
      await cancelImageExecution(tx, userId, id);
    }
  });
}

/** Worker maintenance, including accounts without a remaining agent or draft. */
export async function recoverAgentGenerationSlots(
  db: DrizzleDB,
  userId?: string,
) {
  const owners = await db
    .selectDistinct({ userId: schema.inferenceReservations.userId })
    .from(schema.inferenceReservations)
    .where(
      and(
        eq(schema.inferenceReservations.category, "image"),
        sql`${schema.inferenceReservations.executionReleasedAt} IS NULL AND (${schema.inferenceReservations.executionLeaseUntil} <= now() OR ${schema.inferenceReservations.state} = 'uncertain')`,
        userId ? eq(schema.inferenceReservations.userId, userId) : undefined,
      ),
    );
  for (const owner of owners)
    await db.transaction((tx) =>
      recoverExpiredImageExecutions(tx, owner.userId),
    );
}
