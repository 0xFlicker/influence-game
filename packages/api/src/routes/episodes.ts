import { Hono } from "hono";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { optionalAuth, requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { decodeEpisodeCopy, queueEpisodeCopy, readEpisodePreview } from "../services/episode-presentation.js";

export async function visibleEpisodeGames<T extends { id: string; config: string; createdById: string | null }>(db: DrizzleDB, games: T[], userId?: string, permissions: string[] = []): Promise<T[]> {
  if (permissions.includes("view_admin")) return games;
  const seats = userId ? await db.select({ gameId: schema.gamePlayers.gameId }).from(schema.gamePlayers).where(eq(schema.gamePlayers.userId, userId)) : [];
  const joined = new Set(seats.map(p => p.gameId));
  return games.filter(g => (JSON.parse(g.config) as { visibility?: string }).visibility !== "private" || (userId && (g.createdById === userId || joined.has(g.id))));
}
export function createEpisodeRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/games/:id/episode", optionalAuth(db), async c => {
    const games = await db.select().from(schema.games).where(or(eq(schema.games.id, c.req.param("id")), eq(schema.games.slug, c.req.param("id"))));
    const [game] = await visibleEpisodeGames(db, games.filter(g => !g.hiddenAt), c.get("user")?.id, c.get("userPermissions"));
    if (!game) return c.json({ error: "Game not found" }, 404);
    c.header("Cache-Control", "private, no-store");
    return c.json(await readEpisodePreview(db, game));
  });
  app.get("/api/admin/games/:id/episode", requireAuth(db), requirePermission("view_admin", "manage_roles"), async c => {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, c.req.param("id")));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const [job] = await db.select().from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, game.id));
    return c.json({ ...await readEpisodePreview(db, game), failure: job?.failure ?? null });
  });
  app.patch("/api/admin/games/:id/episode", requireAuth(db), requirePermission("manage_postgame_media", "manage_roles"), async c => {
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["title", "description", "locked", "coverUrl", "revision", "frameOrder"].includes(k)) || !Array.isArray(body.frameOrder) || body.frameOrder.length > 20 || new Set(body.frameOrder).size !== body.frameOrder.length || body.frameOrder.some(id => typeof id !== "string") || typeof body.locked !== "boolean" || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || !(body.coverUrl === null || typeof body.coverUrl === "string")) return c.json({ error: "Invalid episode edit" }, 400);
    let copy;
    try { copy = decodeEpisodeCopy(JSON.stringify({ title: body.title, description: body.description })); } catch (error) { return c.json({ error: String(error) }, 400); }
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, c.req.param("id")));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const preview = await readEpisodePreview(db, game);
    if ((body.frameOrder as string[]).some(id => !preview.frames.some(f => f.id === id))) return c.json({ error: "Preview frames changed. Reload before saving." }, 409);
    if (body.coverUrl) {
      const covers = preview.frames.flatMap(f => f.imageUrl ? [f.imageUrl] : []);
      if (preview.media.status === "ready") covers.push(preview.media.poster.url);
      if (!covers.includes(String(body.coverUrl))) return c.json({ error: "Choose a published image from this game's preview" }, 400);
    }
    const t = schema.gameEpisodePresentations;
    await db.insert(t).values({ gameId: game.id }).onConflictDoNothing();
    const updated = await db.update(t).set({ ...copy, locked: body.locked, frameOrder: body.frameOrder as string[], coverUrl: body.coverUrl as string | null, revision: sql`${t.revision} + 1`, status: "ready", failure: null, leaseToken: null, leaseUntil: null, updatedAt: new Date().toISOString() }).where(and(eq(t.gameId, game.id), eq(t.revision, Number(body.revision)))).returning({ id: t.gameId });
    if (!updated.length) return c.json({ error: "Episode changed while editing. Reload before saving." }, 409);
    return c.json({ saved: true });
  });
  app.post("/api/admin/episodes/backfill", requireAuth(db), requirePermission("manage_postgame_media", "manage_roles"), async c => {
    let body: { gameIds?: unknown; regenerate?: unknown; preview?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body || !Array.isArray(body.gameIds) || body.gameIds.length < 1 || body.gameIds.length > 50 || body.gameIds.some(id => typeof id !== "string") || typeof body.regenerate !== "boolean" || typeof body.preview !== "boolean") return c.json({ error: "Select 1–50 games and specify regenerate and preview" }, 400);
    const games = await db.select({ id: schema.games.id, title: schema.gameEpisodePresentations.title, locked: schema.gameEpisodePresentations.locked, status: schema.gameEpisodePresentations.status }).from(schema.games).leftJoin(schema.gameEpisodePresentations, eq(schema.gameEpisodePresentations.gameId, schema.games.id)).where(inArray(schema.games.id, body.gameIds as string[]));
    const selected = games.filter(g => !g.locked && (body.regenerate || (!g.title && g.status !== "queued" && g.status !== "generating")));
    if (!body.preview) for (const g of selected) await queueEpisodeCopy(db, g.id, true);
    return c.json({ gameIds: selected.map(g => g.id), calls: selected.length, skipped: games.length - selected.length, queued: !body.preview });
  });
  return app;
}
