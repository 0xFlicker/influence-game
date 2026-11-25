import { getPublicAgentProfile, readPublicAgentIdentity } from "../services/public-agent-profile.js";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { getPublicPlayerProfile } from "../services/public-player-profile.js";
import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { publiclyVisibleAgentContent } from "../services/agent-content-eligibility.js";
import { readAgentTransparentBodies } from "../services/agent-transparent-bodies.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import sharp from "sharp";
import { PublicArtworkOverloadedError, withPublicArtworkCapacity } from "../services/public-artwork-admission.js";
import { isImportedSyntheticPlayer, resolvePublicPlayer } from "../services/public-player-identity.js";
import { publicAgentAwards } from "../services/awards.js";
import { AgentDraftImageUnavailable } from "../services/agent-draft-images.js";
import { HistoryPageUnavailable, parseHistoryCursor, readHouseParticipationPage } from "../services/house-participation.js";

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

  app.get("/api/players/:identifier/history", async c => {
    c.header("Cache-Control", "no-store");
    const kind = c.req.query("game") ?? "all";
    if (kind !== "all" && kind !== "influence" && kind !== "werewolf") return c.json({ error: "Invalid game type" }, 400);
    const rawCursor = c.req.query("cursor");
    const cursor = rawCursor === undefined ? null : parseHistoryCursor(rawCursor);
    if (rawCursor !== undefined && cursor?.gameKind !== kind) return c.json({ error: "Invalid history cursor" }, 400);
    const player = await resolvePublicPlayer(db, c.req.param("identifier"));
    if (!player) return c.notFound();
    try {
      const page = await readHouseParticipationPage(db, player.internalUserId, 20, cursor, kind, { publicOnly: true });
      return c.json({ identity: player.identity, ...page });
    } catch (error) {
      if (error instanceof HistoryPageUnavailable) return c.json({ error: error.message }, 503);
      throw error;
    }
  });

  app.get("/api/public/agents/:identifier", async c => {
    c.header("Cache-Control", "no-store");
    const kind = c.req.query("game") ?? "all";
    if (kind !== "all" && kind !== "influence" && kind !== "werewolf") return c.json({ error: "Invalid game type" }, 400);
    const result = await getPublicAgentProfile(db, c.req.param("identifier"), kind);
    return c.json(result, result.status === "found" ? 200 : 404);
  });

  // Cards need only current public identity and awards, not game history.
  app.get("/api/public/agents/:identifier/card", async c => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("identifier");
    const row = await readPublicAgentIdentity(db, id);
    if (!row) return c.notFound();
    return c.json({ schemaVersion: 1, status: "found", profile: {
      name: row.name, avatarUrl: row.avatarUrl, profileHref: `/agents/${encodeURIComponent(id)}`, awards: await publicAgentAwards(db, id),
    } });
  });

  // Expose only the artwork of an eligible public agent. Never accept a URL
  // from the caller: the visual reader enforces application-owned storage.
  app.get("/api/public/agents/:identifier/art", async c => {
    c.header("Cache-Control", "private, no-store");
    const id = c.req.param("identifier"), kind = c.req.query("kind");
    if (kind !== "body" && kind !== "portrait" && kind !== "full-body") return c.json({ error: "Invalid artwork kind" }, 400);
    try {
      return await withPublicArtworkCapacity(async () => {
        const [initial] = await db.select({ profile: schema.agentProfiles, wallet: schema.users.walletAddress }).from(schema.agentProfiles)
          .innerJoin(schema.users, eq(schema.agentProfiles.userId, schema.users.id))
          .where(and(eq(schema.agentProfiles.id, id), publiclyVisibleAgentContent()));
        if (!initial || isImportedSyntheticPlayer(initial.wallet)) return c.notFound();
        const profile = initial.profile;
        const url = kind === "portrait" ? profile.avatarUrl
          : (await readAgentTransparentBodies(db, [profile])).get(id)
            ?? (kind === "full-body" ? profile.fullBodyReferenceUrl : null);
        if (!url) return c.notFound();
        const bytes = await readVisualProfileImage(url, { name: profile.name, personaKey: profile.personaKey ?? "" }, { db });
        const resized = sharp(bytes, { limitInputPixels: 32_000_000 }).resize(800, 800, { fit: "inside", withoutEnlargement: true });
        const image = await (kind === "full-body" ? resized.webp({ quality: 88 }) : resized.png()).toBuffer();
        // A profile can be hidden or changed while the image is being fetched.
        // Revalidate before returning the old bytes, never cache visibility.
        const [current] = await db.select({ revision: schema.agentProfiles.contentRevisionId, body: schema.agentProfiles.fullBodyReferenceUrl, avatar: schema.agentProfiles.avatarUrl, wallet: schema.users.walletAddress })
          .from(schema.agentProfiles).innerJoin(schema.users, eq(schema.agentProfiles.userId, schema.users.id))
          .where(and(eq(schema.agentProfiles.id, id), publiclyVisibleAgentContent()));
        if (!current || isImportedSyntheticPlayer(current.wallet)) return c.notFound();
        if (current.revision !== profile.contentRevisionId || current.body !== profile.fullBodyReferenceUrl || current.avatar !== profile.avatarUrl) {
          return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "1" } });
        }
        return new Response(new Uint8Array(image), { headers: { "Content-Type": kind === "full-body" ? "image/webp" : "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      });
    } catch (error) {
      if (error instanceof AgentDraftImageUnavailable) return c.notFound();
      if (error instanceof PublicArtworkOverloadedError) return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } });
      throw error;
    }
  });
  return app;
}
