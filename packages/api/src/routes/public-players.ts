import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { getPublicPlayerProfile } from "../services/public-player-profile.js";

export function createPublicPlayerRoutes(db: DrizzleDB) {
  const app = new Hono();

  app.get("/api/players/:identifier", async (c) => {
    c.header("Cache-Control", "no-store");
    const kind = c.req.query("game") ?? "all";
    if (kind !== "all" && kind !== "influence" && kind !== "werewolf") return c.json({ error: "Invalid game type" }, 400);
    const result = await getPublicPlayerProfile(db, c.req.param("identifier"), kind);
    return result.status === "found"
      ? c.json(result)
      : c.json(result, 404);
  });

  return app;
}
