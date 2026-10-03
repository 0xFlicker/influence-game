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
  return app;
}
