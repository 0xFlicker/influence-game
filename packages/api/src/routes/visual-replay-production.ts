import { loadPayloads } from "../services/payload-storage.js";
import { readWerewolfVisualPause, queueWerewolfFormRepair } from "../services/werewolf-visual-policy.js";
import { setVisualFailurePolicy, resumeVisualGame } from "../services/visual-policy.js";
import { requirePermission } from "../middleware/auth.js";
import { readVisualReviewSources } from "../services/visual-shot-review.js";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProductionAuth, type ProductionAuthEnv } from "../middleware/production-auth.js";
import { controlVisualMedia } from "../services/visual-media-repair.js";
import { decodeVisualMediaControl } from "../services/visual-media-control.js";
import { canDiscoverProduction, parseProductionLibraryQuery, ProductionLibraryInputError, readProductionLibrary } from "../services/production-library.js";
import { readReplayVisualProduction, renderMissingReplayScene, ReplayVisualError } from "../services/visual-replay-production.js";
import { reconcileVisualAttempt } from "../services/visual-render-journal.js";

/** Paid replay production requires a current Producer or Sysop role, including on reads. */
export function createVisualReplayProductionRoutes(db: DrizzleDB) {
  const app = new Hono<ProductionAuthEnv>();
  const session = requireAuth(db);
  const producer = requireProductionAuth(db);
  const media = requireProductionAuth(db, "producer:media");
  app.onError((error, c) => {
    if (error instanceof ReplayVisualError) return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof ProductionLibraryInputError) return c.json({ error: error.message }, 400);
    console.error("[replay-production]", error);
    return c.json({ error: "Replay production could not complete this request. Refresh to check its saved state." }, 500);
  });
  const root = "/api/admin/production";
  app.get(`${root}/library`, session, async c => {
    c.header("Cache-Control", "private, no-store");
    const access = { roles: c.get("userRoles"), permissions: c.get("userPermissions") };
    if (!canDiscoverProduction(access)) return c.json({ error: "Admin or production discovery access required" }, 403);
    return c.json(await readProductionLibrary(db, parseProductionLibraryQuery(c.req.query()), access));
  });
  app.get(`${root}/games/:id`, session, async c => {
    c.header("Cache-Control","private, no-store");
    const access = {roles:c.get("userRoles"),permissions:c.get("userPermissions")};
    if (!canDiscoverProduction(access)) return c.json({error:"Admin or production discovery access required"},403);
    const page = await readProductionLibrary(db,parseProductionLibraryQuery({id:c.req.param("id"),limit:"1"}),access);
    return page.items[0] ? c.json(page.items[0]) : c.json({error:"Production game not found"},404);
  });
  // Discovery is deliberately separate; every existing detail or paid command remains producer-only.
  app.get(`${root}/games/:id/visual`, producer, async c => c.json(await readReplayVisualProduction(db, c.req.param("id"))));
  app.post(`${root}/games/:id/visual/control`, producer, requirePermission("start_game"), async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({error:"Invalid JSON"},400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({error:"Invalid visual control"},400);
    const value = body as Record<string, unknown>;
    try {
      if (value.action === "policy" && Object.keys(value).length === 2 && (value.policy === "best_effort" || value.policy === "require_visuals")) await setVisualFailurePolicy(db,c.req.param("id"),value.policy,c.get("productionOperatorId"));
      else if (value.action === "resume" && Object.keys(value).length === 1) await resumeVisualGame(db,c.req.param("id"),c.get("productionOperatorId"));
      else return c.json({error:"Invalid visual control"},400);
      return c.json({accepted:true});
    } catch(error) { return c.json({error:error instanceof Error ? error.message : "Visual control failed"},409); }
  });
  app.post(`${root}/games/:id/visual/forms`, producer, async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({error:"Invalid JSON"},400); }
    const value = body as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.pauseId !== "string" || typeof value.requestId !== "string" || !value.requestId.trim() || value.requestId.length > 200) return c.json({error:"Pause and request IDs required"},400);
    try { return c.json({accepted:true,...await queueWerewolfFormRepair(db,c.req.param("id"),c.get("productionOperatorId"),value.pauseId,value.requestId)}); }
    catch(error) { return c.json({error:error instanceof Error ? error.message : "Wolf form repair failed"},409); }
  });
  app.post(`${root}/games/:id/visual/missing`, media, async c => {
    let value: unknown;
    try { value = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const b = value as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== 3 || !("key" in b) || typeof b.key !== "string" || !("previewHash" in b) || typeof b.previewHash !== "string"
      || !("requestId" in b) || typeof b.requestId !== "string" || !b.requestId.trim() || b.requestId.length > 200) return c.json({ error: "Scene key, preview hash and request ID are required" }, 400);
    const receipt = await renderMissingReplayScene(db, c.req.param("id"), c.get("productionOperatorId"), { key: b.key, previewHash: b.previewHash, requestId: b.requestId });
    return c.json({ ...receipt, ...(!receipt.accepted && { error: receipt.message }) }, receipt.accepted ? 200 : 409);
  });
  app.post(`${root}/games/:id/visual/media`, media, async c => {
    let b: unknown;
    try { b = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const control = decodeVisualMediaControl(b);
    if (!control) return c.json({ error: "Invalid scene media control" }, 400);
    const [game] = await db.select({ status: schema.games.status }).from(schema.games).where(eq(schema.games.id, c.req.param("id")));
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.status !== "completed" && !await readWerewolfVisualPause(db, c.req.param("id"))) return c.json({ error: "Replay image production requires a completed game" }, 409);
    const receipt = await controlVisualMedia(db, c.req.param("id"), c.get("productionOperatorId"), control, { oneAtATime: true });
    return c.json({ ...receipt, ...(!receipt.accepted && { error: receipt.message }) }, receipt.accepted ? 200 : 409);
  });
  app.get(`${root}/games/:id/visual/scenes/:scene/review`, media, async c => {
    const [scene] = await db.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, c.req.param("id")), eq(schema.visualScenes.id, c.req.param("scene"))));
    if (!scene) return c.json({ error: "Scene not found" }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json({ expectedRevision: scene.renderRevision, planHash: scene.planHash, players: scene.plan.cast.map(m => ({ id: m.id, name: m.name })), sources: await readVisualReviewSources(db, scene) });
  });
  app.get(`${root}/games/:id/visual/evidence/attempt/:attempt`, producer, async c => {
    const [attempt] = await loadPayloads(db.select({ image: schema.visualRenderAttempts.image }).from(schema.visualRenderAttempts)
      .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderOperations.id, schema.visualRenderAttempts.operationId))
      .where(and(eq(schema.visualRenderOperations.gameId, c.req.param("id")), eq(schema.visualRenderAttempts.id, c.req.param("attempt")))));
    if (!attempt?.image) return c.json({ error: "Image not found" }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json({ imageUrl: `data:image/png;base64,${attempt.image.toString("base64")}` });
  });
  app.get(`${root}/games/:id/visual/evidence/artifact/:artifact`, producer, async c => {
    const [artifact] = await loadPayloads(db.select({ image: schema.visualArtifacts.image }).from(schema.visualArtifacts)
      .where(and(eq(schema.visualArtifacts.gameId, c.req.param("id")), eq(schema.visualArtifacts.id, c.req.param("artifact")))));
    if (!artifact) return c.json({ error: "Image not found" }, 404);
    return c.json({ imageUrl: `data:image/png;base64,${Buffer.from(artifact.image).toString("base64")}` });
  });
  app.get(`${root}/games/:id/visual/artifacts/:artifact`, media, async c => {
    const [artifact] = await loadPayloads(db.select({image:schema.visualArtifacts.image}).from(schema.visualArtifacts)
      .where(and(eq(schema.visualArtifacts.gameId,c.req.param("id")),eq(schema.visualArtifacts.id,c.req.param("artifact")))));
    if (!artifact) return c.json({error:"Image not found"},404);
    c.header("Cache-Control","private, no-store");
    c.header("Content-Type","image/png");
    return c.body(new Uint8Array(artifact.image));
  });
  app.post(`${root}/games/:id/visual/attempts/:attempt/reconcile`, producer, async c => {
    let value: unknown;
    try { value = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const b = value as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== 2 || typeof b.note !== "string" || !b.note.trim() || b.note.length > 2_000
      || typeof b.costMicrousd !== "number" || !Number.isSafeInteger(b.costMicrousd) || b.costMicrousd < 0) return c.json({ error: "Billing evidence and a nonnegative confirmed cost are required" }, 400);
    const [attempt] = await db.select({ id: schema.visualRenderAttempts.id }).from(schema.visualRenderAttempts)
      .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
      .where(and(eq(schema.visualRenderAttempts.id, c.req.param("attempt")), eq(schema.visualRenderOperations.gameId, c.req.param("id"))));
    if (!attempt) return c.json({ error: "Attempt not found for this game" }, 404);
    try {
      await reconcileVisualAttempt(db, { attemptId: attempt.id, operatorId: c.get("productionOperatorId"), note: b.note, costMicrousd: b.costMicrousd });
      return c.json({ reconciled: true });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, 409); }
  });
  return app;
}
