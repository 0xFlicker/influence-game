import { Hono } from "hono";
import { eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { optionalAuth, type AuthEnv } from "../middleware/auth.js";
import { isViewerGame, storedGameVisibility } from "../services/game-visibility.js";

/** Routing identity only. Detail, watch and media routes still authorize their own reads. */
export function createGameEntryRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/game-entries/:idOrSlug", optionalAuth(db), async c => {
    c.header("Cache-Control", "private, no-store");
    const key = c.req.param("idOrSlug");
    const [game] = await db.select({
      id: schema.games.id,
      slug: schema.games.slug,
      gameKind: schema.games.gameKind,
      config: schema.games.config,
      hiddenAt: schema.games.hiddenAt,
      createdById: schema.games.createdById,
    }).from(schema.games).where(or(eq(schema.games.id, key), eq(schema.games.slug, key)));
    if (!game || !isViewerGame(game)) return c.json({ error: "Game not found" }, 404);
    return c.json({ id: game.id, slug: game.slug, gameKind: game.gameKind, visibility: storedGameVisibility(game.config) });
  });
  return app;
}
