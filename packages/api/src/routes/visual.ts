import { prepareVisualRepair, prepareVisualAssetRepair } from "../services/visual-repair.js";
import { setVisualFailurePolicy, resumeVisualGame } from "../services/visual-policy.js";
import { Hono } from "hono";
import { and, asc, eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readVisualProductionExport } from "../services/visual-production-export.js";
import { reconcileVisualAttempt } from "../services/visual-render-journal.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import type { AuthEnv } from "../middleware/auth.js";

/** Viewer surface intentionally excludes numbered copies, references and private cues. */
export function createVisualRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/games/:id/visual", async (c) => {
    const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, c.req.param("id")), eq(schema.games.slug, c.req.param("id"))));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const enabled = (JSON.parse(game.config) as { visualMode?: boolean }).visualMode === true;
    if (!enabled) return c.json({ enabled: false, scenes: [], portraits: {}, status: null });
    const [rows, assets] = await Promise.all([
      db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, game.id)).orderBy(asc(schema.visualScenes.boundarySequence)),
      db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, game.id)),
    ]);
    const url = (id: string) => `/api/games/${game.id}/visual/artifacts/${id}`;
    return c.json({ enabled, status: rows.some((row) => row.status === "preparing") ? "preparing" : null,
      portraits: Object.fromEntries(Object.entries(assets[0]?.portraits ?? {}).map(([id, artifact]) => [id, url(artifact)])),
      scenes: rows.filter((row) => row.status === "ready").map((row) => ({ id: row.id, roomId: row.roomId, version: row.boundarySequence,
        afterDialogueSequence: row.afterDialogueSequence, imageUrl: url(row.imageArtifactId!), participantIds: row.plan.cast.map((member) => member.id), anchors: row.anchors })),
    });
  });
  app.get("/api/games/:id/visual/artifacts/:artifact", async (c) => {
    const gameId = c.req.param("id"), artifactId = c.req.param("artifact");
    const [scenes, assets] = await Promise.all([
      db.select({ id: schema.visualScenes.id }).from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.status, "ready"), eq(schema.visualScenes.imageArtifactId, artifactId))),
      db.select({ portraits: schema.visualGameAssets.portraits }).from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId)),
    ]);
    if (!scenes.length && !Object.values(assets[0]?.portraits ?? {}).includes(artifactId)) return c.json({ error: "Visual artifact not found" }, 404);
    const [artifact] = await db.select({ image: schema.visualArtifacts.image }).from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.id, artifactId), eq(schema.visualArtifacts.gameId, gameId)));
    if (!artifact) return c.json({ error: "Visual artifact not found" }, 404);
    return c.body(new Uint8Array(artifact.image), 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  });
  app.get("/api/admin/games/:id/visual", requireAuth(db), requirePermission("view_admin"), async (c) => {
    return c.json(await readVisualProductionExport(db, c.req.param("id")));
  });
  app.post("/api/admin/games/:id/visual/attempts/:attempt/reconcile", requireAuth(db), requirePermission("start_game"), async (c) => {
    const [attempt] = await db.select({ id: schema.visualRenderAttempts.id }).from(schema.visualRenderAttempts)
      .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
      .where(and(eq(schema.visualRenderAttempts.id, c.req.param("attempt")), eq(schema.visualRenderOperations.gameId, c.req.param("id"))));
    if (!attempt) return c.json({ error: "Attempt not found" }, 404);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || !("note" in body) || typeof body.note !== "string" || !("costMicrousd" in body) || typeof body.costMicrousd !== "number") return c.json({ error: "Evidence note and costMicrousd are required" }, 400);
    try {
      await reconcileVisualAttempt(db, { attemptId: attempt.id, operatorId: c.get("user").id, note: body.note, costMicrousd: body.costMicrousd });
      return c.json({ reconciled: true });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, 409); }
  });
  app.post("/api/admin/games/:id/visual/control", requireAuth(db), requirePermission("start_game"), async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !("action" in body)) return c.json({ error: "Action required" }, 400);
    const gameId = c.req.param("id"), operatorId = c.get("user").id;
    try {
      if (body.action === "policy" && "policy" in body && (body.policy === "best_effort" || body.policy === "require_visuals")) await setVisualFailurePolicy(db, gameId, body.policy, operatorId);
      else if (body.action === "resume") await resumeVisualGame(db, gameId, operatorId);
      else if (body.action === "repair_assets") await prepareVisualAssetRepair(db, gameId, operatorId);
      else if (body.action === "repair_scene" && "sceneId" in body && typeof body.sceneId === "string" && "expectedRevision" in body && typeof body.expectedRevision === "number" && Number.isSafeInteger(body.expectedRevision) && "mode" in body && (body.mode === "verify" || body.mode === "regenerate" || body.mode === "rebuild")) {
        await prepareVisualRepair(db, { gameId, operatorId, sceneId: body.sceneId, expectedRevision: body.expectedRevision, mode: body.mode,
          previewHash: "previewHash" in body && typeof body.previewHash === "string" ? body.previewHash : undefined });
      } else return c.json({ error: "Invalid visual control" }, 400);
      return c.json({ accepted: true });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Visual operation failed" }, 409); }
  });
  app.get("/api/admin/games/:id/visual/evidence/:kind/:artifact", requireAuth(db), requirePermission("view_admin"), async (c) => {
    const gameId = c.req.param("id"), id = c.req.param("artifact");
    let image: Buffer | null = null;
    if (c.req.param("kind") === "attempt") {
      const [row] = await db.select({ image: schema.visualRenderAttempts.image }).from(schema.visualRenderAttempts).innerJoin(schema.visualRenderOperations, eq(schema.visualRenderOperations.id, schema.visualRenderAttempts.operationId)).where(and(eq(schema.visualRenderAttempts.id, id), eq(schema.visualRenderOperations.gameId, gameId)));
      image = row?.image ?? null;
    } else if (c.req.param("kind") === "artifact") {
      const [row] = await db.select({ image: schema.visualArtifacts.image }).from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.id, id), eq(schema.visualArtifacts.gameId, gameId)));
      image = row?.image ?? null;
    }
    if (!image) return c.json({ error: "Evidence image not found" }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json({ imageUrl: `data:image/png;base64,${image.toString("base64")}` });
  });
  return app;
}
