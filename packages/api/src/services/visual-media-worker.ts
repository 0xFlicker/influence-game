import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { assertVisualAnchors } from "@influence/engine/visual-mode";
import { annotateVisualScene } from "./visual-scene-localization.js";
import { readVisualArtifact, storeVisualArtifact, type StoredVisualScene } from "./visual-scene-store.js";
import { renderVisualCandidate } from "./visual-scene-renderer.js";
import { mediaAttempts, VISUAL_LOCALIZATION_VERSION } from "./visual-media-repair.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
const jobs = schema.visualRepairJobs;
const now = () => new Date().toISOString();
const expiry = () => new Date(Date.now() + 60_000).toISOString();
type Job = typeof jobs.$inferSelect;

export async function claimVisualMediaJob(db: DrizzleDB, owner: string): Promise<Job | null> {
  return db.transaction(async tx => {
    // One media render globally, independent of the game's execution owner.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('visual-media-worker'))`);
    const [live] = await tx.select().from(jobs).where(sql`${jobs.status} IN ('rendering','verifying') AND ${jobs.leaseUntil}::timestamptz > now()`).limit(1);
    if (live) return null;
    const [job] = await tx.select().from(jobs).where(sql`${jobs.status} = 'queued' OR (${jobs.status} IN ('rendering','verifying') AND ${jobs.leaseUntil}::timestamptz <= now())`).orderBy(jobs.createdAt).limit(1).for("update", { skipLocked: true });
    if (!job) return null;
    const [claimed] = await tx.update(jobs).set({ owner, leaseUntil: expiry(), status: "rendering", startedAt: job.startedAt ?? now() }).where(eq(jobs.id, job.id)).returning();
    return claimed!;
  });
}

export async function executeVisualMediaJob(db: DrizzleDB, job: Job, signal: AbortSignal, render = renderVisualCandidate) {
  const guard: VisualBoundaryGuard = async tx => {
    signal.throwIfAborted();
    const query = (tx ?? db).select().from(jobs).where(and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!), sql`${jobs.leaseUntil}::timestamptz > now() AND ${jobs.status} IN ('rendering','verifying')`));
    const [current] = tx ? await query.for("update") : await query;
    if (!current) throw new Error("Media job lease lost");
  };
  try {
    await guard();
    const [original] = await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id, job.sceneId));
    if (!original) throw new Error("Scene missing");
    const scene: StoredVisualScene = { ...original, plan: job.plan, status: "preparing", candidateArtifactId: job.sourceImageId, repairMode: job.sourceImageId ? "verify" : "regenerate" };
    const result = await render(db, scene, signal, guard, { jobId: job.id, renderContext: job.renderContext, operationPrefix: `media:${job.id}`, reusePrefix: job.reusePrefix ?? undefined,
      onStep: async step => { await db.transaction(async tx => { await guard(tx); await tx.update(jobs).set({ step, status: step.startsWith("verifying") ? "verifying" : "rendering" }).where(eq(jobs.id, job.id)); }); },
      onImage: async candidateArtifactId => { await db.transaction(async tx => { await guard(tx); await tx.update(jobs).set({ candidateArtifactId }).where(eq(jobs.id, job.id)); }); },
    });
    const receipts = await mediaAttempts(db, `media:${job.id}`, job.gameId);
    if (receipts.some(({ attempt: a }) => !a.reconciliation && (!a.receipt || a.receipt.chargeUncertain))) throw new Error("Reconcile the uncertain provider attempt before continuing this repair");
    const ids = job.plan.cast.map(m => m.id);
    const verified = result.localization.verifiedParticipantIds;
    if (result.localization.count !== ids.length || !verified || verified.length !== ids.length || new Set(verified).size !== ids.length || ids.some(id => !verified.includes(id))) throw new Error("Candidate identities were not verified");
    if (result.localization.anchors.length) assertVisualAnchors(result.localization.anchors, ids);
    const annotatedArtifactId = await storeVisualArtifact(db, job.gameId, await annotateVisualScene(await readVisualArtifact(db, job.gameId, result.imageArtifactId), result.localization.anchors));
    await db.transaction(async tx => {
      await guard(tx);
      await tx.insert(schema.visualMediaVersions).values({ id: job.id, jobId: job.id, gameId: job.gameId, sceneId: job.sceneId, version: job.version,
        plan: job.plan, imageArtifactId: result.imageArtifactId, annotatedArtifactId, localization: result.localization, verificationVersion: VISUAL_LOCALIZATION_VERSION, createdAt: now() });
      await tx.update(jobs).set({ status: "ready", step: "ready for review", finishedAt: now(), leaseUntil: null, owner: null }).where(eq(jobs.id, job.id));
    });
  } catch (error) {
    const attempts = await mediaAttempts(db, `media:${job.id}`, job.gameId);
    const uncertain = attempts.some(({ attempt: a }) => !a.reconciliation && (!a.receipt || a.receipt.chargeUncertain));
    // Losing ownership never allows an old worker to overwrite its successor.
    await db.update(jobs).set({ status: uncertain ? "needs_reconciliation" : "failed", failure: error instanceof Error ? error.message : "Repair failed", finishedAt: now(), owner: null, leaseUntil: null })
      .where(and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!)));
  }
}

export function startVisualMediaWorker(db: DrizzleDB, canClaim: () => boolean) {
  let stopped = false, running: Promise<void> | null = null, controller: AbortController | null = null;
  const tick = () => {
    if (stopped || running || !canClaim()) return;
    running = (async () => {
      const job = await claimVisualMediaJob(db, randomUUID());
      if (!job) return;
      // Shutdown or drain can arrive while the database claim is in flight.
      if (stopped || !canClaim()) {
        await db.update(jobs).set({ leaseUntil: now() }).where(and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!)));
        return;
      }
      controller = new AbortController();
      const current = controller;
      const heartbeat = setInterval(() => { void db.update(jobs).set({ leaseUntil: expiry() }).where(and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!), sql`${jobs.leaseUntil}::timestamptz > now()`)).returning().then(rows => { if (!rows.length) current.abort(new Error("Media lease expired")); }).catch(error => { console.error("[visual-media] heartbeat failed", error); current.abort(error); }); }, 15_000);
      const timeout = setTimeout(() => current.abort(new Error("Media repair timed out")), 15 * 60_000);
      // A non-cooperating provider cannot hold this lease forever. Late evidence stays in its journal.
      const abort = new Promise<void>(resolve => current.signal.addEventListener("abort", () => resolve(), { once: true }));
      const work = executeVisualMediaJob(db, job, current.signal);
      try { await Promise.race([work, abort]); }
      finally { clearInterval(heartbeat); clearTimeout(timeout); controller = null; }
      if (current.signal.aborted) {
        await db.update(jobs).set({ leaseUntil: now() }).where(and(eq(jobs.id, job.id), eq(jobs.owner, job.owner!)));
      }
    })().catch(error => console.error("[visual-media] worker failed", error)).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 2000); timer.unref(); tick();
  return { async stop() { stopped = true; clearInterval(timer); controller?.abort(new Error("Media worker shutdown")); await running; } };
}
