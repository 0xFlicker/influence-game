import { werewolfVisualPause } from "../services/werewolf-visual-policy.js";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { replayWerewolf, projectWerewolfView, WerewolfRulesVersionError } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";
import { getAdminGameCostDetail } from "../services/admin-game-cost-detail.js";
import { getGameCostSummaryMap } from "../services/provider-cost-accounting.js";
import { readVisualRenderAccounting } from "../services/visual-render-journal.js";

export function createWerewolfAdminRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  const root = "/api/admin/werewolf";
  const access = createMiddleware<AuthEnv>(async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const current = await getPermissionsForUser(db, c.get("user").id);
    c.set("userRoles", current.roles); c.set("userPermissions", current.permissions);
    if (!current.permissions.includes("view_admin") && !current.roles.some(role => role === "producer" || role === "sysop")) return c.json({ error: "Admin or production access required" }, 403);
    await next();
  });
  app.use(root, requireAuth(db), access);
  app.use(`${root}/*`, requireAuth(db), access);
  app.onError((error, c) => {
    if (error instanceof WerewolfRulesVersionError) return c.json({ error: error.message }, 409);
    console.error("[werewolf-admin]", error);
    return c.json({ error: "Werewolf administration could not complete this request. Refresh to check saved state." }, 500);
  });
  app.get(root, async c => {
    const games = await db.select().from(schema.games).where(eq(schema.games.gameKind, "werewolf")).orderBy(desc(schema.games.createdAt)).limit(100);
    const ids = games.map(g => g.id);
    const [costs, jobs] = await Promise.all([getGameCostSummaryMap(db, ids), ids.length ? db.select().from(schema.visualRepairJobs).where(inArray(schema.visualRepairJobs.gameId, ids)) : []]);
    const rows = await Promise.all(games.map(async game => {
      let progress: { day: number; phase: string } | null = null;
      let error: string | null = null;
      try { if (!game.startedAt) progress = { day: 0, phase: game.status }; else { const state = replayWerewolf(await readWerewolfEvents(db, game.id)); progress = { day: state.day, phase: state.phase }; } }
      catch (cause) { error = cause instanceof Error ? cause.message : "Game state unavailable"; }
      return { id: game.id, slug: game.slug, status: game.status, createdAt: game.createdAt, playerCount: game.maxPlayers, hidden: Boolean(game.hiddenAt), progress, error,
        cost: costs.get(game.id) ?? null, production: { active: jobs.filter(j => j.gameId === game.id && ["queued", "rendering", "verifying"].includes(j.status)).length,
          failed: jobs.filter(j => j.gameId === game.id && j.status === "failed").length } };
    }));
    return c.json(rows);
  });
  app.get(`${root}/:id`, async c => {
    const id = c.req.param("id");
    const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
    if (!game) return c.json({ error: "Werewolf game not found" }, 404);
    if (!game.startedAt) return c.json({ error: "This game has not started. Open its Werewolf casting lobby.", href: `/games/${encodeURIComponent(game.slug)}` }, 409);
    const state = replayWerewolf(await readWerewolfEvents(db, game.id));
    const roles = c.get("userRoles") ?? [], permissions = c.get("userPermissions") ?? [];
    return c.json({ id: game.id, slug: game.slug, status: game.status, visualPaused: Boolean(werewolfVisualPause(JSON.parse(game.config))), hidden: Boolean(game.hiddenAt), createdAt: game.createdAt, endedAt: game.endedAt,
      snapshot: (() => { const view = projectWerewolfView(state, "omniscient"); return { rulesVersion: view.rulesVersion, day: view.day, phase: view.phase, cursor: view.cursor, players: view.players, outcome: view.outcome }; })(),
      capabilities: { stop: game.status === "in_progress" && permissions.includes("stop_game"), visibility: permissions.includes("hide_game"), production: roles.some(role => role === "producer" || role === "sysop") } });
  });
  app.get(`${root}/:id/activity`, async c => {
    const [game] = await db.select({ id: schema.games.id }).from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), eq(schema.games.id, c.req.param("id"))));
    if (!game) return c.json({ error: "Werewolf game not found" }, 404);
    return c.json(projectWerewolfView(replayWerewolf(await readWerewolfEvents(db, game.id)), "omniscient"));
  });
  app.get(`${root}/:id/costs`, async c => {
    const [game] = await db.select().from(schema.games).where(and(eq(schema.games.id, c.req.param("id")), eq(schema.games.gameKind, "werewolf")));
    if (!game) return c.json({ error: "Werewolf game not found" }, 404);
    const [gameplay, production] = await Promise.all([getAdminGameCostDetail(db, game.id), readVisualRenderAccounting(db, game.id)]);
    if (!gameplay.ok) return c.json({ error: gameplay.error }, gameplay.statusCode);
    return c.json({ gameplay: gameplay.detail, production: { knownCostMicrousd: production.knownCostMicrousd,
      unpricedAttempts: production.unpricedAttempts, uncertainAttempts: production.uncertainAttempts,
      attempts: production.attempts.map(a => ({ id: a.id, provider: a.provider, model: a.model, status: a.status, costMicrousd: a.costMicrousd })) } });
  });
  app.patch(`${root}/:id/visibility`, requirePermission("hide_game"), async c => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("hidden" in body) || typeof body.hidden !== "boolean") return c.json({ error: "A boolean hidden value is required" }, 400);
    const rows = await db.update(schema.games).set({ hiddenAt: body.hidden ? new Date().toISOString() : null })
      .where(and(eq(schema.games.id, c.req.param("id")), eq(schema.games.gameKind, "werewolf"))).returning({ id: schema.games.id });
    return rows.length ? c.json({ hidden: body.hidden }) : c.json({ error: "Werewolf game not found" }, 404);
  });
  return app;
}
