import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { isViewerGame } from "../services/game-visibility.js";
import { readLocalCharacterArt } from "../services/local-character-art.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";

export function createLocalCharacterArtRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  const publicPath = "/api/games/:game/local-character-art/:player/:revision/:kind";
  const producerPath = "/api/admin/production/games/:game/local-character-art/:player/:revision/:kind";
  app.use(producerPath, requireAuth(db), async (c, next) => {
    let roles: string[];
    try { roles = (await getPermissionsForUser(db, c.get("user").id)).roles; }
    catch { return c.json({ error: "Production authorization is temporarily unavailable" }, 503); }
    if (!roles.some(role => role === "producer" || role === "sysop")) return c.json({ error: "Producer or Sysop role required" }, 403);
    await next();
  });
  for (const path of [publicPath, producerPath]) app.get(path, async c => {
    const gameId = c.req.param("game"), playerId = c.req.param("player"), revision = c.req.param("revision"), kind = c.req.param("kind");
    if (!gameId || !playerId || !revision || !kind) return c.notFound();
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    if (!game || !isViewerGame(path === producerPath ? { ...game, hiddenAt: null } : game)) return c.notFound();
    const ids = game.gameKind === "werewolf"
      ? (await readWerewolfEvents(db, game.id)).find(event => event.type === "werewolf.started")?.payload.players.map(player => player.id) ?? []
      : (await db.select({ id: schema.gamePlayers.id }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, game.id))).map(player => player.id);
    if (!ids.includes(playerId)) return c.notFound();
    const asset = await readLocalCharacterArt(game.id, playerId, revision, kind);
    if (!asset) return c.notFound();
    return c.body(new Uint8Array(asset.bytes), 200, { "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=300", ETag: `"${asset.sha256}"`, "X-Content-Type-Options": "nosniff" });
  });
  return app;
}
