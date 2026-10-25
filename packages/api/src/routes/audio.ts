import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { audioRange, readAudioPublication, readPublishedAudioBytes } from "../services/audio-publication.js";
import type { ProductionAudience } from "@influence/engine/production-moments";

export function createAudioRoutes(db: DrizzleDB) {
  const app = new Hono();
  app.get("/api/games/:id/audio/:version?", async c => {
    c.header("Cache-Control", "private, no-store");
    const audience = c.req.query("audience"), thinking = c.req.query("thinking");
    if (!["public", "mystery", "omniscient"].includes(audience ?? "") || thinking !== "on" && thinking !== "off") return c.json({ error: "Invalid audio audience" }, 400);
    const version = c.req.param("version");
    if (!version) return c.json(await readAudioPublication(db, c.req.param("id"), audience as ProductionAudience, thinking === "on"));
    if (!/^[a-f0-9-]{36}$/.test(version)) return c.json({ error: "Audio not found" }, 404);
    const bytes = await readPublishedAudioBytes(db, c.req.param("id"), version, audience as ProductionAudience, thinking === "on");
    return audioBytesResponse(c, bytes);
  });
  return app;
}

/** Shared transport only; each route must authorize its exact stored version first. */
export function audioBytesResponse(c: Context, bytes: Uint8Array | null) {
  if (!bytes) return c.json({ error: "Audio not found" }, 404);
  const requested = c.req.header("Range"), range = audioRange(requested, bytes.length);
  c.header("Accept-Ranges", "bytes");
  if (!range) { c.header("Content-Range", `bytes */${bytes.length}`); return c.body(null, 416); }
  c.header("Content-Type", "audio/mpeg"); c.header("Content-Length", String(range.end - range.start + 1));
  if (requested) c.header("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
  return c.body(new Uint8Array(bytes.subarray(range.start, range.end + 1)), requested ? 206 : 200);
}
