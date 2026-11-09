import { Hono } from "hono";
import { and, eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { optionalAuth, type AuthEnv } from "../middleware/auth.js";
import { isViewerGame, storedGameVisibility } from "../services/game-visibility.js";
import { readEpisodeCast } from "../services/episode-presentation.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { readWerewolfCharacter } from "../services/werewolf-presentation.js";
import { readGameCardCutout } from "../services/game-card-cutout.js";
import sharp from "sharp";
import { PublicArtworkOverloadedError, withPublicArtworkCapacity } from "../services/public-artwork-admission.js";

/** Routing identity only. Detail, watch and media routes still authorize their own reads. */
export function createGameEntryRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.get("/api/game-entries/:idOrSlug", optionalAuth(db), async c => {
    c.header("Cache-Control", "private, no-store");
    const key = c.req.param("idOrSlug");
    const [game] = await db.select({
      id: schema.games.id,
      slug: schema.games.slug,
      gameKind: schema.games.gameKind,
      config: schema.games.config,
      hiddenAt: schema.games.hiddenAt,
      createdById: schema.games.createdById,
    }).from(schema.games).where(or(eq(schema.games.id, key), eq(schema.games.slug, key)));
    if (!game || !isViewerGame(game)) return c.json({ error: "Game not found" }, 404);
    return c.json({ id: game.id, slug: game.slug, gameKind: game.gameKind, visibility: storedGameVisibility(game.config) });
  });
  // Bounded, anonymous social metadata: no replay history, private config or producer state.
  app.get("/api/game-entries/:idOrSlug/card", async c => {
    c.header("Cache-Control", "private, no-store");
    const key = c.req.param("idOrSlug");
    const [game] = await db.select({
      id:schema.games.id, slug:schema.games.slug, gameKind:schema.games.gameKind,
      status:schema.games.status, config:schema.games.config, hiddenAt:schema.games.hiddenAt,
      seasonId:schema.games.seasonId, title:schema.gameEpisodePresentations.title,
      description:schema.gameEpisodePresentations.description, coverUrl:schema.gameEpisodePresentations.coverUrl,
    }).from(schema.games).leftJoin(schema.gameEpisodePresentations, eq(schema.gameEpisodePresentations.gameId, schema.games.id))
      .where(or(eq(schema.games.id,key), eq(schema.games.slug,key)));
    if (!game || !isViewerGame(game)) return c.json({error:"Game not found"},404);
    try {
      return await withPublicArtworkCapacity(async () => {
        const cast = ((await readEpisodeCast(db, [game])).get(game.id) ?? []).slice(0, 4);
        return c.json({id:game.id, slug:game.slug, gameKind:game.gameKind, status:game.status,
          visibility:storedGameVisibility(game.config), title:game.title ?? game.slug,
          description:game.description ?? "Watch AI agents make allies, tell lies, and turn on each other.", coverUrl:game.coverUrl,
          cast:cast.map(({id, name}) => ({id, name}))});
      });
    } catch (error) {
      if (error instanceof PublicArtworkOverloadedError) {
        c.header("Retry-After", "5");
        return c.json({error:"Artwork is busy. Try again shortly."},503);
      }
      throw error;
    }
  });
  // The caller selects only an opening-cast identity, never a URL or later scene.
  // The underlying reader accepts application-owned assets only and disallows redirects.
  app.get("/api/game-entries/:idOrSlug/card/portrait/:player", async c => {
    c.header("Cache-Control", "private, no-store");
    const kind = c.req.query("kind") ?? "portrait";
    if (kind !== "portrait" && kind !== "cutout") return c.json({error:"Invalid artwork kind"},400);
    const key = c.req.param("idOrSlug");
    const [game] = await db.select({id:schema.games.id, slug:schema.games.slug, gameKind:schema.games.gameKind,
      status:schema.games.status, seasonId:schema.games.seasonId, config:schema.games.config, hiddenAt:schema.games.hiddenAt})
      .from(schema.games).where(or(eq(schema.games.id,key), eq(schema.games.slug,key)));
    if (!isViewerGame(game)) return c.json({error:"Game not found"},404);
    try {
      return await withPublicArtworkCapacity(async () => {
      const cast = ((await readEpisodeCast(db, [game!])).get(game!.id) ?? []).slice(0, 4);
      const player = cast.find(p => p.id === c.req.param("player"));
      if (!player) return c.json({error:"Portrait not found"},404);
      if (kind === "portrait" && !player.avatarUrl && (game!.gameKind !== "werewolf" || game!.status === "waiting")) return c.json({error:"Portrait not found"},404);
      const [originalSeat] = kind === "cutout" && game!.gameKind === "influence"
        ? await db.select({persona:schema.gamePlayers.persona}).from(schema.gamePlayers).where(and(eq(schema.gamePlayers.id,player.id),eq(schema.gamePlayers.gameId,game!.id)))
        : [];
      const png = kind === "cutout" ? await readGameCardCutout(db, game!, player.id) : await (async () => {
        const bytes = game!.gameKind === "werewolf" && game!.status !== "waiting"
          ? await readWerewolfCharacter(db, game!.id, player.id)
          : await readVisualProfileImage(player.avatarUrl, {name:player.name, personaKey:player.personaKey ?? ""});
        if (!bytes) return null;
        return sharp(bytes, {limitInputPixels: 40_000_000}).rotate().resize(360, 360, {fit:"cover"}).png().toBuffer();
      })();
      if (!png) return c.json({error:"Portrait not found"},404);
      // Visibility may have changed while waiting for artwork storage or decoding.
      const [current] = await db.select({id:schema.games.id,slug:schema.games.slug,gameKind:schema.games.gameKind,
        status:schema.games.status,seasonId:schema.games.seasonId,config:schema.games.config,hiddenAt:schema.games.hiddenAt})
        .from(schema.games).where(eq(schema.games.id,game!.id));
      if (!isViewerGame(current)) return c.json({error:"Game not found"},404);
      const currentPlayer = ((await readEpisodeCast(db, [current!])).get(current!.id) ?? []).slice(0, 4).find(p => p.id === player.id);
      if (!currentPlayer) return c.json({error:"Portrait not found"},404);
      if (currentPlayer.name !== player.name || currentPlayer.avatarUrl !== player.avatarUrl || currentPlayer.personaKey !== player.personaKey) {
        c.header("Retry-After", "5");
        return c.json({error:"Cast changed. Try again shortly."},503);
      }
      if (kind === "cutout" && game!.gameKind === "influence") {
        const [currentSeat] = await db.select({persona:schema.gamePlayers.persona}).from(schema.gamePlayers).where(and(eq(schema.gamePlayers.id,player.id),eq(schema.gamePlayers.gameId,game!.id)));
        if (!originalSeat || !currentSeat || originalSeat.persona !== currentSeat.persona) {
          c.header("Retry-After", "5");
          return c.json({error:"Cast changed. Try again shortly."},503);
        }
      }
      c.header("Content-Type", "image/png");
      return c.body(new Uint8Array(png));
      });
    } catch (error) {
      if (error instanceof PublicArtworkOverloadedError) {
        c.header("Retry-After", "5");
        return c.json({error:"Artwork is busy. Try again shortly."},503);
      }
      console.error("[game-card] Portrait unavailable", error);
      return c.json({error:"Portrait unavailable. Try again shortly."},503);
    }
  });
  return app;
}
