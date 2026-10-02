import { enabledGameKinds } from "@influence/engine/game-availability";
import { Hono } from "hono";
import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { WerewolfRulesVersionError } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { createWerewolfGame, readWerewolfLiveView, readWerewolfView, WerewolfGameError } from "../services/werewolf-games.js";
import { readWerewolfPresentation, readWerewolfCharacter, readWerewolfWatch } from "../services/werewolf-presentation.js";
import { readWerewolfThinking } from "../services/werewolf-thinking.js";
import { createWerewolfLobby, joinWerewolfLobby, leaveWerewolfLobby, readWerewolfLobby, startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
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
  app.post("/api/werewolf/lobbies", requireAuth(db), requirePermission("create_game"), async c => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["preset", "providerManifest", "maxDays", "setup", "personaPool", "fillStrategy", "visualMode"].includes(key))
      || !["one_wolf", "two_wolves"].includes(input.preset)
      || (input.maxDays !== undefined && (!Number.isInteger(input.maxDays) || input.maxDays < 1 || input.maxDays > 20))) return c.json({ error: "Choose a Werewolf preset and a day limit from 1 to 20." }, 400);
    return c.json(await createWerewolfLobby(db, c.get("user").id, input), 201);
  });
  app.get("/api/werewolf/:id/lobby", async c => c.json(await readWerewolfLobby(db, c.req.param("id"))));
  app.post("/api/werewolf/:id/join", requireAuth(db), async c => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.agentProfileId !== "string" || !input.agentProfileId.trim()) return c.json({ error: "Choose an owned agent." }, 400);
    return c.json(await joinWerewolfLobby(db, c.req.param("id"), c.get("user").id, input.agentProfileId));
  });
  app.delete("/api/werewolf/:id/seats/:playerId", requireAuth(db), async c => {
    await leaveWerewolfLobby(db, c.req.param("id"), c.get("user").id, c.req.param("playerId"));
    return c.json({ removed: true });
  });
  app.post("/api/werewolf/:id/start", requireAuth(db), requirePermission("start_game"), async c => c.json(await startWerewolfLobby(db, c.req.param("id"))));
  app.get("/api/werewolf", async (c) => {
    if (!enabledGameKinds().includes("werewolf")) return c.json([]);
    c.header("Cache-Control", "private, no-store");
    const rows = await db.select({ id: schema.games.id, slug: schema.games.slug, status: schema.games.status,
      playerCount: schema.games.maxPlayers, config: schema.games.config, createdAt: schema.games.createdAt }).from(schema.games)
      .where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt))).orderBy(desc(schema.games.createdAt)).limit(100);
    const seats = rows.length ? await db.select({ gameId: schema.werewolfLobbySeats.gameId, total: count() }).from(schema.werewolfLobbySeats)
      .where(inArray(schema.werewolfLobbySeats.gameId, rows.map(game => game.id))).groupBy(schema.werewolfLobbySeats.gameId) : [];
    const joined = new Map(seats.map(row => [row.gameId, row.total]));
    return c.json(rows.map(({ config, ...game }) => ({ ...game, gameKind: "werewolf", joinedPlayers: game.status === "waiting" ? joined.get(game.id) ?? 0 : game.playerCount, modelLabel: modelLabelFromConfig(JSON.parse(config)) })));
  });
  for (const route of ["/api/werewolf/:id/presentation", "/api/werewolf/:id/media/:asset", "/api/werewolf/:id/characters/:player"]) {
    app.get(route, async c => {
      const audience = c.req.query("audience") ?? "mystery";
      if (audience !== "mystery" && audience !== "omniscient") return c.json({ error: "Choose mystery or omniscient" }, 400);
      const raw = c.req.query("cursor"), cursor = raw === undefined ? undefined : Number(raw);
      if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) return c.json({ error: "Invalid replay position" }, 400);
      const publishedBefore = c.req.query("publishedBefore");
      if (publishedBefore !== undefined && (!Number.isFinite(Date.parse(publishedBefore)) || new Date(publishedBefore).toISOString() !== publishedBefore)) return c.json({ error: "Invalid publication snapshot" }, 400);
      const { presentation, permitted } = await readWerewolfPresentation(db, c.req.param("id")!, audience, cursor, publishedBefore);
      const asset = c.req.param("asset"), player = c.req.param("player");
      if (asset) {
        if (!permitted.has(asset)) return c.json({ error: "Image not available at this replay position" }, 404);
        const [image] = await db.select({ bytes: schema.visualArtifacts.image }).from(schema.visualArtifacts)
          .where(and(eq(schema.visualArtifacts.id, asset), eq(schema.visualArtifacts.gameId, presentation.view.gameId)));
        if (!image) return c.json({ error: "Image not found" }, 404);
        c.header("Content-Type", "image/png"); return c.body(new Uint8Array(image.bytes));
      }
      if (player) {
        if (!presentation.view.players.some(p => p.id === player)) return c.json({ error: "Character not found" }, 404);
        const bytes = await readWerewolfCharacter(db, presentation.view.gameId, player, c.req.query("image") === "body" ? "body" : "portrait");
        if (!bytes) return c.json({ error: "Frozen character reference unavailable" }, 404);
        // Frozen references may be JPEG/WebP as well as PNG. Browsers decode the bytes.
        c.header("Content-Type", bytes[0] === 0xff ? "image/jpeg" : bytes.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : "image/png");
        return c.body(new Uint8Array(bytes));
      }
      return c.json(presentation);
    });
  }
  app.get("/api/werewolf/:id/watch", async c => {
    const audience = c.req.query("audience") ?? "mystery";
    if (audience !== "mystery" && audience !== "omniscient") return c.json({ error: "Choose mystery or omniscient" }, 400);
    const fromCursor = Number(c.req.query("fromCursor") ?? 1), limit = Number(c.req.query("limit") ?? 32);
    if (!Number.isSafeInteger(fromCursor) || fromCursor < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) return c.json({error: "Invalid watch window"}, 400);
    const cutoff = c.req.query("publishedBefore");
    if (cutoff !== undefined && (!Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString() !== cutoff)) return c.json({error: "Invalid publication snapshot"}, 400);
    return c.json(await readWerewolfWatch(db, c.req.param("id"), audience, fromCursor, limit, cutoff));
  });
  app.get("/api/werewolf/:id/thinking", async c => {
    const cursor = Number(c.req.query("cursor"));
    if (!Number.isSafeInteger(cursor) || cursor < 1) return c.json({ error: "Choose a replay position" }, 400);
    return c.json(await readWerewolfThinking(db, c.req.param("id"), c.req.query("audience") ?? "mystery", cursor));
  });
  app.get("/api/werewolf/:id", async (c) => {
    const id = c.req.param("id");
    const [game] = await db.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
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
      if (!game || !["waiting", "in_progress"].includes(game.status)) return false;
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
