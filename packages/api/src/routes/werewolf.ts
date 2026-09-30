import { Hono } from "hono";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { WerewolfRulesVersionError } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { createWerewolfGame, readWerewolfLiveView, readWerewolfView, WerewolfGameError } from "../services/werewolf-games.js";
import { abortWerewolf } from "../services/werewolf-runtime.js";

export function createWerewolfRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.use("/api/werewolf/*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
  app.onError((error, c) => {
    if (error instanceof WerewolfRulesVersionError) return c.json({ error: error.message }, 409);
    if (error instanceof WerewolfGameError) return c.json({ error: error.message }, error.status);
    console.error("[werewolf] Request failed", error);
    return c.json({ error: "Werewolf request failed. Try again." }, 500);
  });
  app.post("/api/werewolf", requireAuth(db), requirePermission("create_game"), requirePermission("start_game"), async (c) => {
    let input: Record<string, unknown>;
    try { input = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["preset", "agentProfileIds", "providerManifest", "maxDays"].includes(key))
      || (input.preset !== "one_wolf" && input.preset !== "two_wolves")
      || !Array.isArray(input.agentProfileIds) || input.agentProfileIds.some((id) => typeof id !== "string")
      || (input.maxDays !== undefined && (!Number.isInteger(input.maxDays) || Number(input.maxDays) < 1 || Number(input.maxDays) > 20))) {
      return c.json({ error: "Choose a valid Werewolf preset, character list, day limit (1–20)." }, 400);
    }
    try {
      const game = await createWerewolfGame(db, c.get("user")!.id, { preset: input.preset,
        agentProfileIds: input.agentProfileIds as string[], providerManifest: input.providerManifest,
        ...(input.maxDays !== undefined ? { maxDays: Number(input.maxDays) } : {}) });
      return c.json(game, 201);
    } catch (error) {
      if (error instanceof WerewolfGameError) throw error;
      // Input validation errors are raised before any game is created.
      if (error instanceof Error && /provider manifest|model selection|catalog|Werewolf roster|distinct player names/i.test(error.message)) return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  app.get("/api/werewolf", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const rows = await db.select({ id: schema.games.id, slug: schema.games.slug, status: schema.games.status,
      playerCount: schema.games.maxPlayers, createdAt: schema.games.createdAt }).from(schema.games)
      .where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt))).orderBy(desc(schema.games.createdAt)).limit(100);
    return c.json(rows);
  });
  app.get("/api/werewolf/:id", async (c) => {
    const id = c.req.param("id");
    const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
    if (!game) return c.json({ error: "Game not found" }, 404);
    const audience = c.req.query("audience") ?? "mystery";
    if (audience !== "mystery" && audience !== "omniscient") return c.json({ error: "Choose mystery or omniscient" }, 400);
    const cursor = c.req.query("cursor");
    if (cursor === undefined) {
      const { view, voteProgress } = await readWerewolfLiveView(db, game.id, audience, game.status === "in_progress");
      return c.json({ slug: game.slug, status: game.status, latestCursor: view.cursor, view, voteProgress });
    }
    const view = await readWerewolfView(db, game.id, audience, Number(cursor));
    const latestCursor = (await readWerewolfView(db, game.id, audience)).cursor;
    return c.json({ slug: game.slug, status: game.status, latestCursor, view, voteProgress: null });
  });
  app.post("/api/werewolf/:id/stop", requireAuth(db), requirePermission("stop_game"), async (c) => {
    const id = c.req.param("id");
    const stopped = await db.transaction(async (tx) => {
      const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.id, id), eq(schema.games.gameKind, "werewolf"))).for("update");
      if (!game || game.status !== "in_progress") return false;
      await tx.update(schema.games).set({ status: "cancelled", endedAt: new Date().toISOString() }).where(eq(schema.games.id, id));
      await tx.update(schema.gameRunOwners).set({ status: "revoked", revokedAt: new Date().toISOString(), failureReason: "operator_stop" })
        .where(and(eq(schema.gameRunOwners.gameId, id), eq(schema.gameRunOwners.status, "active")));
      return true;
    });
    if (!stopped) return c.json({ error: "Game is not running" }, 409);
    abortWerewolf(id);
    return c.json({ stopped: true });
  });
  return app;
}
