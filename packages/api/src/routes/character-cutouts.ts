import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type DrizzleDB } from "../db/index.js";
import { acceptCutout, authorizedCutout, claimCutout, cutoutMode, CUTOUT_MAX_BYTES } from "../services/character-cutouts.js";
import { readPayload } from "../services/payload-storage.js";

export function createCharacterCutoutRoutes(db: DrizzleDB) {
  const app = new Hono();
  app.use("/api/internal/cutouts/*", async (c, next) => {
    if (cutoutMode() === "disabled") return c.notFound();
    if (!/^Bearer [a-f0-9]{64}$/.test(c.req.header("Authorization") ?? "")) return c.json({ error: "Invalid worker capability" }, 401);
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/api/internal/cutouts/:id/claim", bodyLimit({ maxSize: 1024 }), async c => {
    let value: unknown;
    try { value = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!value || typeof value !== "object" || !("recipe" in value) || typeof value.recipe !== "string") return c.json({ error: "Recipe required" }, 400);
    const job = await claimCutout(db, c.req.param("id"), c.req.header("Authorization")!.slice(7), value.recipe);
    return c.json(job ? { claimed: true, sourceHash: job.sourceHash } : { claimed: false });
  });
  app.get("/api/internal/cutouts/:id/source", async c => {
    const job = await authorizedCutout(db, c.req.param("id"), c.req.header("Authorization")!.slice(7));
    if (!job) return c.notFound();
    return c.body(new Uint8Array(await readPayload(job.source)), 200, { "Content-Type": "application/octet-stream" });
  });
  app.put("/api/internal/cutouts/:id/result", bodyLimit({ maxSize: CUTOUT_MAX_BYTES }), async c => {
    const token = c.req.header("Authorization")!.slice(7);
    if (!await authorizedCutout(db, c.req.param("id"), token)) return c.notFound();
    try {
      const accepted = await acceptCutout(db, c.req.param("id"), token, Buffer.from(await c.req.arrayBuffer()));
      return c.json({ accepted }, accepted ? 200 : 409);
    } catch (error) {
      console.error("[character-cutouts] Result rejected", { jobId: c.req.param("id"), error });
      return c.json({ error: "Result validation or durable upload failed" }, 422);
    }
  });
  return app;
}
