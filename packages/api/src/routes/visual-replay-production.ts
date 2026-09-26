import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { controlVisualMedia, type MediaControl } from "../services/visual-media-repair.js";
import { listReplayVisualGames, readReplayVisualProduction, renderMissingReplayScene, ReplayVisualError } from "../services/visual-replay-production.js";
import { reconcileVisualAttempt } from "../services/visual-render-journal.js";

/** Paid replay production requires a current Producer or Sysop role, including on reads. */
export function createVisualReplayProductionRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  const producer = createMiddleware<AuthEnv>(async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const address = c.get("user").walletAddress;
    if (!address) return c.json({ error: "Producer or Sysop role required" }, 403);
    let roles: string[];
    try { roles = (await getPermissionsForAddress(db, address)).roles; }
    catch { return c.json({ error: "Production authorization is temporarily unavailable" }, 503); }
    if (!roles.some(role => role === "producer" || role === "sysop")) return c.json({ error: "Producer or Sysop role required" }, 403);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ReplayVisualError) return c.json({ error: error.message, code: error.code }, error.status);
    console.error("[replay-production]", error);
    return c.json({ error: "Replay production could not complete this request. Refresh to check its saved state." }, 500);
  });
  const root = "/api/admin/production";
  app.use(`${root}/*`, requireAuth(db), producer);
  app.get(`${root}/games`, async c => c.json(await listReplayVisualGames(db)));
  app.get(`${root}/games/:id/visual`, async c => c.json(await readReplayVisualProduction(db, c.req.param("id"))));
  app.post(`${root}/games/:id/visual/missing`, async c => {
    let value: unknown;
    try { value = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const b = value as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== 3 || !("key" in b) || typeof b.key !== "string" || !("previewHash" in b) || typeof b.previewHash !== "string"
      || !("requestId" in b) || typeof b.requestId !== "string" || !b.requestId.trim() || b.requestId.length > 200) return c.json({ error: "Scene key, preview hash and request ID are required" }, 400);
    const receipt = await renderMissingReplayScene(db, c.req.param("id"), c.get("user").id, { key: b.key, previewHash: b.previewHash, requestId: b.requestId });
    return c.json({ ...receipt, ...(!receipt.accepted && { error: receipt.message }) }, receipt.accepted ? 200 : 409);
  });
  app.post(`${root}/games/:id/visual/media`, async c => {
    let b: unknown;
    try { b = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const control = decodeReplayMediaControl(b);
    if (!control) return c.json({ error: "Invalid scene media control" }, 400);
    const [game] = await db.select({ status: schema.games.status }).from(schema.games).where(eq(schema.games.id, c.req.param("id")));
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.status !== "completed") return c.json({ error: "Replay image production requires a completed game" }, 409);
    const receipt = await controlVisualMedia(db, c.req.param("id"), c.get("user").id, control, { oneAtATime: true });
    return c.json({ ...receipt, ...(!receipt.accepted && { error: receipt.message }) }, receipt.accepted ? 200 : 409);
  });
  app.get(`${root}/games/:id/visual/evidence/artifact/:artifact`, async c => {
    const [artifact] = await db.select({ image: schema.visualArtifacts.image }).from(schema.visualArtifacts)
      .where(and(eq(schema.visualArtifacts.gameId, c.req.param("id")), eq(schema.visualArtifacts.id, c.req.param("artifact"))));
    if (!artifact) return c.json({ error: "Image not found" }, 404);
    return c.json({ imageUrl: `data:image/png;base64,${Buffer.from(artifact.image).toString("base64")}` });
  });
  app.post(`${root}/games/:id/visual/attempts/:attempt/reconcile`, async c => {
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
      await reconcileVisualAttempt(db, { attemptId: attempt.id, operatorId: c.get("user").id, note: b.note, costMicrousd: b.costMicrousd });
      return c.json({ reconciled: true });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Reconciliation failed" }, 409); }
  });
  return app;
}

function decodeReplayMediaControl(value: unknown): MediaControl | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  const string = (key: string) => typeof b[key] === "string" && Boolean(b[key].trim()) && b[key].length <= 200;
  if (!string("requestId") || !string("sceneId") || !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0) return null;
  const fields = ["requestId", "sceneId", "expectedVersion", "action"];
  if (b.action === "verify") { if (!string("sourceVersionId")) return null; fields.push("sourceVersionId"); }
  else if (b.action === "continue") { if (b.sourceJobId !== undefined && !string("sourceJobId")) return null; fields.push("sourceJobId"); }
  else if (b.action === "publish") {
    if (!string("versionId") || !Number.isSafeInteger(b.expectedPublication) || Number(b.expectedPublication) < 0) return null;
    fields.push("versionId", "expectedPublication");
  } else if (b.action !== "regenerate") return null;
  if (Object.keys(b).some(key => !fields.includes(key))) return null;
  return b as MediaControl;
}
