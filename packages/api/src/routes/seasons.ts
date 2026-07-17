import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { isPostgresUniqueViolation } from "../lib/postgres-errors.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import {
  exportOwnedSeasonReceipts,
  getOwnedAgentSeasonAnalysis,
  getProducerSeasonDiagnostics,
  getPublicGameCompetitionReceipts,
  getPublicSeasonDashboard,
  listPublicSeasons,
} from "../services/season-read-model.js";
import {
  SeasonStateError,
  closeSeason,
  createSeason,
  finalizeSeason,
} from "../services/seasons.js";

export function createSeasonRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.get("/api/seasons", async (c) => c.json({
    schemaVersion: 1,
    seasons: await listPublicSeasons(db),
  }));

  app.get("/api/seasons/:seasonIdOrSlug", async (c) => {
    const dashboard = await getPublicSeasonDashboard(db, c.req.param("seasonIdOrSlug"));
    return dashboard ? c.json(dashboard) : c.json({ error: "Season not found" }, 404);
  });

  app.get("/api/seasons/:seasonIdOrSlug/games/:gameIdOrSlug/receipts", async (c) => {
    const result = await getPublicGameCompetitionReceipts(
      db,
      c.req.param("seasonIdOrSlug"),
      c.req.param("gameIdOrSlug"),
    );
    return result ? c.json({ schemaVersion: 2, ...result }) : c.json({ error: "Season or game not found" }, 404);
  });

  app.get("/api/seasons/:seasonIdOrSlug/agents/:agentId", requireAuth(db), async (c) => {
    const user = c.get("user")!;
    const result = await getOwnedAgentSeasonAnalysis(db, {
      seasonIdOrSlug: c.req.param("seasonIdOrSlug"),
      agentId: c.req.param("agentId"),
      ownerId: user.id,
    });
    return result ? c.json(result) : c.json({ error: "Owned agent or season not found" }, 404);
  });

  app.get("/api/seasons/:seasonIdOrSlug/export", requireAuth(db), async (c) => {
    const format = c.req.query("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      return c.json({ error: "format must be json or csv" }, 400);
    }
    const requestedLimit = Number(c.req.query("limit"));
    const result = await exportOwnedSeasonReceipts(db, {
      seasonIdOrSlug: c.req.param("seasonIdOrSlug"),
      ownerId: c.get("user")!.id,
      ...(c.req.query("agentId") ? { agentId: c.req.query("agentId") } : {}),
      format,
      ...(Number.isFinite(requestedLimit) && requestedLimit > 0 ? { limit: requestedLimit } : {}),
    });
    if (!result) return c.json({ error: "Season not found" }, 404);
    c.header("Content-Type", result.contentType);
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    c.header("X-Export-Row-Count", String(result.rowCount));
    c.header("X-Export-Truncated", String(result.truncated));
    return c.body(result.body);
  });

  app.get(
    "/api/admin/seasons/:seasonIdOrSlug/diagnostics",
    requireAuth(db),
    requirePermission("view_admin"),
    async (c) => {
      const diagnostics = await getProducerSeasonDiagnostics(db, c.req.param("seasonIdOrSlug"));
      return diagnostics ? c.json(diagnostics) : c.json({ error: "Season not found" }, 404);
    },
  );

  app.post(
    "/api/admin/seasons",
    requireAuth(db),
    requirePermission("manage_seasons"),
    async (c) => {
      const body = await parseJsonBody(c, "POST /api/admin/seasons");
      if (!body) return c.json({ error: "Invalid JSON body" }, 400);
      try {
        const season = await createSeason(db, {
          slug: String(body.slug ?? ""),
          name: String(body.name ?? ""),
          createdById: c.get("user")!.id,
          admissionStartsAt: nullableText(body.admissionStartsAt),
          admissionClosesAt: nullableText(body.admissionClosesAt),
        });
        return c.json({ schemaVersion: 1, season }, 201);
      } catch (error) {
        return seasonError(c, error);
      }
    },
  );

  app.post(
    "/api/admin/seasons/:seasonId/close",
    requireAuth(db),
    requirePermission("manage_seasons"),
    async (c) => {
      try {
        return c.json({ schemaVersion: 1, season: await closeSeason(db, c.req.param("seasonId")) });
      } catch (error) {
        return seasonError(c, error);
      }
    },
  );

  app.post(
    "/api/admin/seasons/:seasonId/finalize",
    requireAuth(db),
    requirePermission("manage_seasons"),
    async (c) => {
      try {
        return c.json({ schemaVersion: 1, honors: await finalizeSeason(db, c.req.param("seasonId")) });
      } catch (error) {
        return seasonError(c, error);
      }
    },
  );

  return app;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function seasonError(c: Context, error: unknown): Response {
  if (error instanceof SeasonStateError) {
    const status = error.code === "season_not_found" ? 404 : error.code === "invalid_state" ? 409 : 400;
    return c.json({ error: error.message, code: error.code }, status);
  }
  if (isPostgresUniqueViolation(error, "seasons_slug_unique")) {
    return c.json({
      error: "A season already uses that slug.",
      code: "season_slug_conflict",
    }, 409);
  }
  throw error;
}
