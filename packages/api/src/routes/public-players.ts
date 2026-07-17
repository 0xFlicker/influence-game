import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { getPublicPlayerProfile } from "../services/public-player-profile.js";

export function createPublicPlayerRoutes(db: DrizzleDB) {
  const app = new Hono();

  app.get("/api/players/:identifier", async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await getPublicPlayerProfile(db, c.req.param("identifier"));
    return result.status === "found"
      ? c.json(result)
      : c.json(result, 404);
  });

  return app;
}
