import { validHeadRectangle, type CharacterHeadPosition, type HeadRectangle } from "@influence/engine/character-portrait";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { controlVisualMedia, type MediaControl } from "../services/visual-media-repair.js";
import { prepareVisualRepair, prepareVisualAssetRepair } from "../services/visual-repair.js";
import { setVisualFailurePolicy, resumeVisualGame } from "../services/visual-policy.js";
import { Hono } from "hono";
import { and, asc, eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readVisualProductionExport } from "../services/visual-production-export.js";
import { reconcileVisualAttempt } from "../services/visual-render-journal.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import type { AuthEnv } from "../middleware/auth.js";
import { recordVisualOperationEvent } from "../services/visual-diagnostics.js";

/** Viewer surface intentionally excludes numbered copies, references and private cues. */
export function createVisualRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/games/:id/visual", async (c) => {
    const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, c.req.param("id")), eq(schema.games.slug, c.req.param("id"))));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const enabled = (JSON.parse(game.config) as { visualMode?: boolean }).visualMode === true;

    const [rows, assets, players] = await Promise.all([
      db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, game.id)).orderBy(asc(schema.visualScenes.boundarySequence)),
      db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, game.id)),
      db.select({ id: schema.gamePlayers.id, persona: schema.gamePlayers.persona }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, game.id)),
    ]);
    const url = (id: string) => `/api/games/${game.id}/visual/artifacts/${id}`;
    // Game-start profiles and prepared cast artifacts are frozen; current agent edits
    // must not change the identity shown in a historical solo performance.
    const fullBodies: Record<string, string> = {};
    const fullBodyHeads: Record<string, HeadRectangle> = {};
    for (const player of players) {
      const profile = JSON.parse(player.persona) as { fullBodyReferenceUrl?: unknown; headPosition?: CharacterHeadPosition };
      if (typeof profile.fullBodyReferenceUrl === "string" && profile.fullBodyReferenceUrl) fullBodies[player.id] = profile.fullBodyReferenceUrl;
      const head = profile.headPosition;
      if (head?.confirmation && head.sourceUrl === fullBodies[player.id] && validHeadRectangle(head.rect)) fullBodyHeads[player.id] = head.rect;
    }
    for (const member of assets[0]?.cast ?? []) {
      if (!member.portraitFallback) {
        fullBodies[member.id] = url(member.referenceArtifactId);
        delete fullBodyHeads[member.id];
        if (validHeadRectangle(member.headRectangle)) fullBodyHeads[member.id] = member.headRectangle;
      }
    }
    let snapshot: Record<string, number> | undefined;
    const rawSnapshot = c.req.query("snapshot");
    if (rawSnapshot) {
      try {
        const parsed: unknown = JSON.parse(rawSnapshot);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some(v => !Number.isSafeInteger(v) || Number(v) < 0)) throw new Error("Invalid snapshot");
        snapshot = parsed as Record<string, number>;
      } catch { return c.json({ error: "Invalid publication snapshot" }, 400); }
    }
    const viewerMedia = await readViewerMedia(db, game.id, snapshot);
    return c.json({ enabled: enabled || viewerMedia.scenes.length > 0, status: game.status !== "completed" && rows.some(row => row.status === "preparing") ? "preparing" : null,
      fullBodies, fullBodyHeads,
      portraits: Object.fromEntries(Object.entries(assets[0]?.portraits ?? {}).map(([id, artifact]) => [id, url(artifact)])),
      ...viewerMedia,
    });
  });
  app.get("/api/games/:id/visual/artifacts/:artifact", async (c) => {
    const gameId = c.req.param("id"), artifactId = c.req.param("artifact");
    const [scenes, assets, published] = await Promise.all([
      db.select({ id: schema.visualScenes.id }).from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.status, "ready"), eq(schema.visualScenes.imageArtifactId, artifactId))),
      db.select({ portraits: schema.visualGameAssets.portraits, cast: schema.visualGameAssets.cast }).from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId)),
      db.select({ id: schema.visualMediaVersions.id }).from(schema.visualMediaVersions).innerJoin(schema.visualMediaPublications, eq(schema.visualMediaPublications.versionId, schema.visualMediaVersions.id)).where(and(eq(schema.visualMediaVersions.gameId, gameId), eq(schema.visualMediaVersions.imageArtifactId, artifactId))),
    ]);
    if (!scenes.length && !published.length && !Object.values(assets[0]?.portraits ?? {}).includes(artifactId) && !assets[0]?.cast.some(member => !member.portraitFallback && member.referenceArtifactId === artifactId)) return c.json({ error: "Visual artifact not found" }, 404);
    const [artifact] = await db.select({ image: schema.visualArtifacts.image }).from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.id, artifactId), eq(schema.visualArtifacts.gameId, gameId)));
    if (!artifact) return c.json({ error: "Visual artifact not found" }, 404);
    return c.body(new Uint8Array(artifact.image), 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  });
  app.get("/api/admin/games/:id/visual", requireAuth(db), requirePermission("view_admin"), async (c) => {
    return c.json(await readVisualProductionExport(db, c.req.param("id")));
  });
  app.post("/api/admin/games/:id/visual/media", requireAuth(db), requirePermission("start_game"), async c => {
    const gameId = c.req.param("id"), operatorId = c.get("user").id;
    const [game] = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, gameId));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const invalid = async (message: string) => {
      const code = "invalid_media_request", auditId = crypto.randomUUID();
      await recordVisualOperationEvent(db, gameId, `media-rejected:${auditId}`, { kind: "failure", outcome: "failed", message },
        { kind: "internal", name: code, message: JSON.stringify({ operatorId, reason: message }) });
      return c.json({ accepted: false, code, error: message, auditId }, 400);
    };
    let value: unknown;
    try { value = await c.req.json(); } catch { return invalid("Invalid JSON"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid media request");
    const b = value as Record<string, unknown>;
    if (typeof b.requestId !== "string" || !b.requestId.trim() || b.requestId.length > 200 || typeof b.sceneId !== "string" || !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0
      || !(b.action === "regenerate" || b.action === "verify" && typeof b.sourceVersionId === "string" || b.action === "continue" && (b.sourceJobId === undefined || typeof b.sourceJobId === "string") || b.action === "publish" && typeof b.versionId === "string" && Number.isSafeInteger(b.expectedPublication) && Number(b.expectedPublication) >= 0)) return invalid("Invalid media control fields");
    const receipt = await controlVisualMedia(db, c.req.param("id"), c.get("user").id, b as MediaControl);
    return c.json({ ...receipt, ...(!receipt.accepted && { error: receipt.message }) }, receipt.accepted ? 200 : 409);
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
