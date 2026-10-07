import { eq, or } from "drizzle-orm";
import { schema } from "../db/index.js";
import { isViewerGame } from "../services/game-visibility.js";
import { getPublicPostgameMedia } from "../services/postgame-media.js";
import { readHouseCuts } from "../services/house-cut-publication.js";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { readHouseGameResults } from "../services/house-game-results.js";

export function createGameResultsRoutes(db: DrizzleDB) {
  const app = new Hono();
  app.get("/api/games/:id/results", async c => {
    c.header("Cache-Control","private, no-store");
    const result = await readHouseGameResults(db,c.req.param("id"));
    return c.json(result,result.ok ? 200 : result.status === "not_found" ? 404 : 409);
  });
  app.get("/api/games/:id/cuts", async c => {
    c.header("Cache-Control", "private, no-store");
    const result = await readHouseCuts(db, c.req.param("id"), c.req.query("audience"));
    return result ? c.json(result) : c.json({ error: "Game or audience not found" }, 404);
  });
  // GET /api/games/:id/postgame/media — spoiler-safe postgame trailer state
  app.get("/api/games/:id/postgame/media", async (c) => {
    const idOrSlug = c.req.param("id");
    c.header("Cache-Control", "private, no-store");
    const game = (await db.select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .limit(1))[0];
    if (!game || !isViewerGame(game)) return c.json({ error: "Game not found" }, 404);
    return c.json(await getPublicPostgameMedia(db, game.id));
  });

  return app;
}
