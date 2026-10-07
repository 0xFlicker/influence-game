import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { loadHouseCutSource } from "./house-cut-source.js";
import { isViewerGame } from "./game-visibility.js";
import { createCutTrialRuntimes, newCutTrialJournal, runAutomaticCutTrial, type CutTrialJournal } from "@influence/engine/house-cuts/trial";
import { publishCutSelection } from "@influence/engine/house-cuts/publication";
import { reconcilePostgameMediaForGame } from "./postgame-media-coordinator.js";
const table = schema.houseCutJobs;
type Generate = typeof runAutomaticCutTrial;

/** Serial, fenced jobs. Expired jobs resume accepted calls; unknown dispatches fail closed. */
export async function runHouseCutJob(db: DrizzleDB, generate: Generate = runAutomaticCutTrial, signal?: AbortSignal) {
  const job = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('house-cuts-worker'))`);
    const [active] = await tx.select({ id: table.id }).from(table).where(sql`${table.status} = 'running' AND ${table.leaseUntil} > now()`).limit(1);
    if (active) return null;
    const [next] = await tx.select().from(table).where(sql`${table.status} = 'queued' OR (${table.status} = 'running' AND ${table.leaseUntil} < now())`).orderBy(asc(table.createdAt)).limit(1);
    if (!next) return null;
    const [claimed] = await tx.update(table).set({ status: "running", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 300_000), updatedAt: new Date() }).where(eq(table.id, next.id)).returning();
    return claimed!;
  });
  if (!job) return false;
  const guard = and(eq(table.id, job.id), eq(table.leaseToken, job.leaseToken!), eq(table.status, "running"));
  try {
    const source = await loadHouseCutSource(db, job.gameId, job.audience);
    if (job.source && job.source.hash !== source.hash) throw new Error("Editorial source changed; job requires inspection");
    const journal = job.journal ?? newCutTrialJournal(source, 1);
    if (journal.attempts.some(a => !a.terminal)) throw new Error("Prior paid dispatch has an unknown outcome; inspect before retrying");
    if (journal.budgetUsd > 1) throw new Error("House Cuts audience budget exceeds authorization");
    const save = async (value: CutTrialJournal) => {
      const rows = await db.update(table).set({ source, journal: structuredClone(value), leaseUntil: new Date(Date.now() + 300_000), updatedAt: new Date() }).where(guard).returning({ id: table.id });
      if (!rows.length) throw new Error("House Cuts lease lost");
    };
    await save(journal);
    const result = await generate({ source, journal, runtimes: generate === runAutomaticCutTrial ? createCutTrialRuntimes() : [], save, signal });
    signal?.throwIfAborted();
    if (result.report.source.hash !== source.hash || result.report.source.audience !== job.audience) throw new Error("Publication source mismatch");
    const publication = publishCutSelection(result.report, result.selectedKeys, job.id);
    await db.transaction(async tx => {
      const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, job.gameId)).for("update");
      if (!game || !isViewerGame(game) || game.status !== "completed") throw new Error("Game no longer available for publication");
      const rows = await tx.update(table).set({ publication, status: "ready", failure: null, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(guard).returning({ id: table.id });
      if (!rows.length) throw new Error("House Cuts lease lost before publication");
    });
  } catch (error) {
    // Only persisted terminal attempts are safe to replay. Never redispatch an unknown paid call.
    if (signal?.aborted) {
      const requeued = await db.transaction(async tx => {
        const [current] = await tx.select({ journal: table.journal }).from(table).where(guard).for("update");
        if (!current || current.journal?.attempts.some(attempt => !attempt.terminal)) return false;
        await tx.update(table).set({ status: "queued", failure: null, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(guard);
        return true;
      });
      if (requeued) return true;
    }
    await db.update(table).set({ status: "failed", failure: error instanceof Error ? error.message : "House Cuts failed", leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(guard);
    console.error("[house-cuts] Job failed", { gameId: job.gameId, audience: job.audience });
  }
  if (job.audience === "mystery") {
    try { await reconcilePostgameMediaForGame(db, job.gameId); }
    catch (error) { console.error("[postgame-media] Reconciliation deferred after House Cuts", { gameId: job.gameId, error: error instanceof Error ? error.message : "unknown" }); }
  }
  return true;
}
export function startHouseCutWorker(db: DrizzleDB, canClaim: () => boolean) {
  let pending: Promise<unknown> | null = null;
  const controller = new AbortController();
  const tick = () => {
    if (controller.signal.aborted || pending || !canClaim() || !process.env.OPENAI_API_KEY) return;
    pending = runHouseCutJob(db, runAutomaticCutTrial, controller.signal)
      .catch(error => console.error("[house-cuts] Worker unavailable", error instanceof Error ? error.name : "unknown"))
      .finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 10_000); timer.unref(); tick();
  return { async stop() { clearInterval(timer); controller.abort(); await pending; } };
}
