import { getPublicAgentProfile } from "../services/public-agent-profile.js";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { getPublicPlayerProfile } from "../services/public-player-profile.js";
import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { eligibleAgentContent } from "../services/agent-content-eligibility.js";
import { readAgentTransparentBodies } from "../services/agent-transparent-bodies.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import sharp from "sharp";
import { PublicArtworkOverloadedError, withPublicArtworkCapacity } from "../services/public-artwork-admission.js";

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

  app.get("/api/public/agents/:identifier", async c => {
    c.header("Cache-Control", "no-store");
    const kind = c.req.query("game") ?? "all";
    if (kind !== "all" && kind !== "influence" && kind !== "werewolf") return c.json({ error: "Invalid game type" }, 400);
    const result = await getPublicAgentProfile(db, c.req.param("identifier"), kind);
    return c.json(result, result.status === "found" ? 200 : 404);
  });

  // Expose only the artwork of an eligible public agent. Never accept a URL
  // from the caller: the visual reader enforces application-owned storage.
  app.get("/api/public/agents/:identifier/art", async c => {
    c.header("Cache-Control", "private, no-store");
    const id = c.req.param("identifier"), kind = c.req.query("kind");
    if (kind !== "body" && kind !== "portrait") return c.json({ error: "Invalid artwork kind" }, 400);
    try {
      return await withPublicArtworkCapacity(async () => {
        const publicProfile = await getPublicAgentProfile(db, id);
        if (publicProfile.status !== "found") return c.notFound();
        const [profile] = await db.select().from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, id), eligibleAgentContent()));
        if (!profile) return c.notFound();
        const url = kind === "body" ? (await readAgentTransparentBodies(db, [profile])).get(id) : profile.avatarUrl;
        if (!url) return c.notFound();
        const bytes = await readVisualProfileImage(url, { name: profile.name, personaKey: profile.personaKey ?? "" }, { db });
        const image = await sharp(bytes, { limitInputPixels: 32_000_000 }).resize(800, 800, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
        // A profile can be hidden or changed while the image is being fetched.
        // Revalidate before returning the old bytes, never cache visibility.
        if ((await getPublicAgentProfile(db, id)).status !== "found") return c.notFound();
        const [current] = await db.select({ revision: schema.agentProfiles.contentRevisionId, body: schema.agentProfiles.fullBodyReferenceUrl, avatar: schema.agentProfiles.avatarUrl })
          .from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id, id), eligibleAgentContent()));
        if (!current) return c.notFound();
        if (current.revision !== profile.contentRevisionId || current.body !== profile.fullBodyReferenceUrl || current.avatar !== profile.avatarUrl) {
          return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "1" } });
        }
        return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      });
    } catch (error) {
      if (error instanceof PublicArtworkOverloadedError) return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "5" } });
      throw error;
    }
  });
  return app;
}
