import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { getPublicWatchIntelligence } from "../services/public-watch-intelligence.js";

export function createWatchIntelligenceRoutes(db: DrizzleDB) {
  const app = new Hono();

  app.get("/api/games/:idOrSlug/watch-intelligence", async (c) => {
    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: c.req.param("idOrSlug"),
      actorPlayerId: optionalQuery(c.req.query("actorPlayerId")),
      round: parseNonNegativeInt(c.req.query("round")),
      phase: optionalQuery(c.req.query("phase")),
      limit: parseNonNegativeInt(c.req.query("limit")),
    });

    return c.json(result, result.ok ? 200 : 404);
  });

  return app;
}

function optionalQuery(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
