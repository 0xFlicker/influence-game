import { Hono } from "hono";
import { eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { optionalAuth, type AuthEnv } from "../middleware/auth.js";
import { visibleEpisodeGames } from "./episodes.js";

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
    if (!game || game.hiddenAt) return c.json({ error: "Game not found" }, 404);

    let config: unknown;
    try { config = JSON.parse(game.config); }
    catch { return c.json({ error: "Invalid game configuration" }, 500); }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return c.json({ error: "Invalid game configuration" }, 500);
    }
    const visibility = "visibility" in config ? config.visibility : "public";
    if (typeof visibility !== "string" || !["public", "unlisted", "private"].includes(visibility)) {
      return c.json({ error: "Invalid game visibility" }, 500);
    }
    if (visibility === "private") {
      // Private Werewolf transports are a separate integration task. Never
      // expose a private entry before its direct reads support that policy.
      if (game.gameKind === "werewolf") return c.json({ error: "Game not found" }, 404);
      const visible = await visibleEpisodeGames(db, [game], c.get("user")?.id, c.get("userPermissions"));
      if (!visible.length) return c.json({ error: "Game not found" }, 404);
    }
    return c.json({ id: game.id, slug: game.slug, gameKind: game.gameKind });
  });
  return app;
}
