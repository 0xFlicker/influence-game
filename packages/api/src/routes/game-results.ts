import { eq, or } from "drizzle-orm";
import { schema } from "../db/index.js";
import { isViewerGame } from "../services/game-visibility.js";
import { getPublicPostgameMedia } from "../services/postgame-media.js";
import { readHouseCuts } from "../services/house-cut-publication.js";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { readHouseGameResults } from "../services/house-game-results.js";
import { readHouseGameRetrospective } from "../services/house-game-retrospective.js";
import { HouseInspectionError } from "../services/house-game-access.js";
import { assertRetrospectiveResumeInput, resumeHouseGameRetrospective } from "../services/house-retrospective-recovery.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export function createGameResultsRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/games/:id/retrospective", async c => {
    c.header("Cache-Control", "private, no-store");
    try {
      const query = c.req.query();
      if (Object.keys(query).some(key => !["gameKind", "cursor", "limit"].includes(key)) || query.gameKind !== undefined && !["influence", "werewolf"].includes(query.gameKind)) throw new HouseInspectionError("invalid_input", "Invalid retrospective query");
      return c.json(await readHouseGameRetrospective(db, { gameIdOrSlug: c.req.param("id"), gameKind: query.gameKind as "influence" | "werewolf" | undefined,
        cursor: query.cursor, limit: query.limit === undefined ? undefined : Number(query.limit) }));
    } catch (error) {
      if (error instanceof HouseInspectionError) return c.json({ schemaVersion: 1, status: error.code, message: error.message }, error.code === "not_accessible" ? 404 : error.code === "invalid_input" ? 400 : 409);
      throw error;
    }
  });
  app.post("/api/games/:id/retrospective/resume", requireAuth(db), async c => {
    c.header("Cache-Control", "private, no-store");
    try {
      let body: unknown;
      try { body = await c.req.json(); } catch { throw new HouseInspectionError("invalid_input", "A JSON recovery body is required"); }
      assertRetrospectiveResumeInput(body);
      if (body.gameIdOrSlug !== c.req.param("id")) throw new HouseInspectionError("invalid_input", "Recovery game identity must match the route");
      return c.json(await resumeHouseGameRetrospective(db, body, c.get("user").id));
    } catch (error) {
      if (error instanceof HouseInspectionError) return c.json({ schemaVersion: 1, status: error.code, message: error.message }, error.code === "not_accessible" ? 403 : error.code === "invalid_input" ? 400 : 409);
      throw error;
    }
  });
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
