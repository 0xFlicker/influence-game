import { and, eq, like, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { recordVisualOperationEvent } from "./visual-diagnostics.js";

/** Explicit repair grants one new revision, never edits a historical paid attempt. */
export async function prepareVisualRepair(db: DrizzleDB, input: {
  gameId: string; sceneId: string; expectedRevision: number; mode: "verify" | "regenerate"; operatorId: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${input.gameId}))`);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, input.gameId)).for("update");
    if (!game || game.status !== "suspended" || !JSON.parse(game.config).visualPause) throw new Error("Pause this visual game before repairing it");
    const [scene] = await tx.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.id, input.sceneId), eq(schema.visualScenes.gameId, input.gameId))).for("update");
    if (!scene || scene.renderRevision !== input.expectedRevision || scene.status === "preparing") throw new Error("Scene revision changed or repair is already pending");
    const latest = await tx.select({ id: schema.visualScenes.id }).from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, input.gameId), eq(schema.visualScenes.roomId, scene.roomId))).orderBy(sql`${schema.visualScenes.boundarySequence} DESC`).limit(1);
    if (latest[0]?.id !== scene.id) throw new Error("Only the current room arrangement can be repaired");
    const attempts = await tx.select({ attempt: schema.visualRenderAttempts }).from(schema.visualRenderAttempts)
      .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderOperations.id, schema.visualRenderAttempts.operationId))
      .where(and(eq(schema.visualRenderOperations.gameId, input.gameId), like(schema.visualRenderOperations.operationKey, `${scene.id}:%`)));
    if (attempts.some(({ attempt }) => !attempt.reconciliation && (!attempt.receipt || attempt.receipt.chargeUncertain))) throw new Error("Reconcile uncertain paid attempts before authorizing another request");
    const candidateArtifactId = scene.candidateArtifactId ?? scene.imageArtifactId;
    if (input.mode === "verify" && !candidateArtifactId) throw new Error("No candidate image is available to verify");
    await tx.update(schema.visualScenes).set({ status: "preparing", failure: null, repairMode: input.mode, repairBudgetUsed: true, candidateArtifactId, renderRevision: scene.renderRevision + 1 }).where(eq(schema.visualScenes.id, scene.id));
    await recordVisualOperationEvent(tx, input.gameId, `${scene.id}:manual-repair:${scene.renderRevision + 1}`, { sceneId: scene.id, boundarySequence: scene.boundarySequence, kind: "retry", outcome: "pending", message: `${input.operatorId} authorized ${input.mode}; revision ${scene.renderRevision + 1}` });
  });
}

/** Retain successful assets and receipts; reopen only failed/degraded preparations. */
export async function prepareVisualAssetRepair(db: DrizzleDB, gameId: string, operatorId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${gameId}))`);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (!game || game.status !== "suspended" || !JSON.parse(game.config).visualPause) throw new Error("Game is not paused for visual repair");
    const operations = await tx.select().from(schema.visualRenderOperations).where(and(eq(schema.visualRenderOperations.gameId, gameId), sql`(${schema.visualRenderOperations.operationKey} LIKE 'profile:%' OR ${schema.visualRenderOperations.operationKey} LIKE 'background:%')`)).for("update");
    for (const operation of operations) {
      const attempts = await tx.select().from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.operationId, operation.id));
      if (attempts.some((attempt) => !attempt.reconciliation && (!attempt.receipt || attempt.receipt.chargeUncertain))) throw new Error("Reconcile uncertain asset attempts before repair");
      if (attempts.some((attempt) => attempt.image)) continue;
      await tx.update(schema.visualRenderOperations).set({ generation: operation.generation + 1, budgetStartGeneration: operation.generation + 1 }).where(eq(schema.visualRenderOperations.id, operation.id));
    }
    const [assets] = await tx.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
    if (assets) await tx.update(schema.visualGameAssets).set({ status: "preparing", failure: null, cast: assets.cast.filter((member) => member.portraitFallback !== true) }).where(eq(schema.visualGameAssets.gameId, gameId));
    await recordVisualOperationEvent(tx, gameId, `asset-repair:${crypto.randomUUID()}`, { kind: "retry", outcome: "pending", message: `${operatorId} authorized asset repair` });
  });
}
