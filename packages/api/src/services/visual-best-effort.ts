import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import { and, eq, like } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import { renderPlannedVisualScene } from "./visual-scene-renderer.js";
import { failVisualScene, type StoredVisualScene } from "./visual-scene-store.js";

export const VISUAL_ATTEMPT_TIMEOUT_MS = 180_000;

/** Each arrangement gets its initial attempt and at most one safe repair, durably. */
export async function renderVisualSceneBestEffort(db: DrizzleDB, initial: StoredVisualScene, guard: VisualBoundaryGuard, timeoutMs = VISUAL_ATTEMPT_TIMEOUT_MS): Promise<StoredVisualScene | null> {
  let scene = initial;
  if (scene.status === "ready") return scene;
  for (;;) {
    if (scene.status === "failed") {
      const records = await db.select({ attempt: schema.visualRenderAttempts }).from(schema.visualRenderAttempts)
        .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
        .where(and(eq(schema.visualRenderOperations.gameId, scene.gameId), like(schema.visualRenderOperations.operationKey, `${scene.id}:%`)));
      // A fallback consumes the repair allowance. Interrupted/uncertain paid calls are never repeated.
      const [current] = await db.select().from(schema.visualScenes).where(eq(schema.visualScenes.id, scene.id));
      if (scene.renderRevision >= 1 || current?.repairBudgetUsed || records.some(({ attempt }) => attempt.provider === "xai" || !attempt.receipt || attempt.receipt.chargeUncertain)) return null;
      const repaired = await db.transaction(async (tx) => {
        await guard(tx);
        return tx.update(schema.visualScenes).set({ status: "preparing", failure: null, renderRevision: 1, repairBudgetUsed: true })
          .where(and(eq(schema.visualScenes.id, scene.id), eq(schema.visualScenes.status, "failed"), eq(schema.visualScenes.renderRevision, 0))).returning();
      });
      if (!repaired[0]) return null;
      await recordVisualOperationEvent(db, scene.gameId, `${scene.id}:repair:${repaired[0].renderRevision}`, { sceneId: scene.id, boundarySequence: scene.boundarySequence, kind: "retry", outcome: "pending", message: "One automatic scene repair authorized" });
      scene = repaired[0];
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Visual attempt timed out")); }, timeoutMs);
      });
      const result = await Promise.race([renderPlannedVisualScene(db, scene, controller.signal, guard), timeout]);
      await recordVisualOperationEvent(db, scene.gameId, `${scene.id}:${scene.renderRevision}:presentation`, { sceneId: scene.id, boundarySequence: scene.boundarySequence, kind: "presentation", outcome: result.anchors?.length ? "scene" : "unanchored", message: "Verified scene accepted" });
      return result;
    } catch (error) {
      await failVisualScene(db, scene.id, error instanceof Error ? error.message : "Visual attempt failed", guard);
      await recordVisualOperationEvent(db, scene.gameId, `${scene.id}:${scene.renderRevision}:failure`, { sceneId: scene.id, boundarySequence: scene.boundarySequence, kind: "failure", outcome: "failed", message: controller.signal.aborted ? "Scene preparation timed out" : "Scene preparation failed" }, visualFailureEvidence(error, controller.signal.aborted ? "timeout" : "internal"));
      scene = { ...scene, status: "failed" };
      // A timed-out request may still finish remotely. Preserve its journal and move on.
      if (controller.signal.aborted) return null;
    } finally { if (timer) clearTimeout(timer); }
  }
}
