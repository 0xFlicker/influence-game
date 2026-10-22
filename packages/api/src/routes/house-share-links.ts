import { createHmac, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { parseHouseShareTarget, SHARE_CODE_PATTERN } from "@influence/engine/house-share-target";
import type { DrizzleDB } from "../db/index.js";
import { admitShareCreation, resolveShareLink, saveShareLink, ShareRateLimitError, validateShareTarget } from "../services/house-share-links.js";

export function createHouseShareRoutes(db: DrizzleDB) {
  const app = new Hono<{ Bindings: { clientAddress?: string } }>();
  app.use("/api/share-links", bodyLimit({ maxSize: 4096 }));
  app.post("/api/share-links", async c => {
    c.header("Cache-Control", "private, no-store");
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET must be set");
    const visitor = await getSignedCookie(c, secret, "house_share") || randomUUID();
    const hash = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    try {
      // Peer address is supplied by Bun, never by caller-controlled forwarding headers.
      // Behind ingress this is deliberately a generous aggregate ingress safeguard.
      await admitShareCreation(db, hash(visitor), hash(c.env?.clientAddress ?? "ingress"));
    } catch (error) {
      if (!(error instanceof ShareRateLimitError)) throw error;
      c.header("Retry-After", "60");
      return c.json({ error: error.message }, 429);
    }
    await setSignedCookie(c, "house_share", visitor, secret, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax", path: "/api/share-links", maxAge: 31536000,
    });
    let body: unknown;
    try { body = await c.req.json(); }
    catch (error) {
      // Preserve transport/body-limit errors for Hono's middleware (notably 413).
      if (!(error instanceof SyntaxError)) throw error;
      return c.json({ error: "Invalid JSON share request." }, 400);
    }
    let target;
    try {
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("path" in body)) throw new Error();
      target = parseHouseShareTarget(body.path);
    } catch { return c.json({ error: "Unsupported House share link." }, 400); }
    if (!await validateShareTarget(db, target)) return c.json({ error: "This share destination is unavailable." }, 404);
    const link = await saveShareLink(db, target);
    return c.json({ code: link.code, path: `/s/${link.code}` });
  });
  app.get("/api/share-links/:code", async c => {
    // Resolution never consumes creation allowance; availability remains current.
    c.header("Cache-Control", "no-store");
    const code = c.req.param("code");
    if (!SHARE_CODE_PATTERN.test(code)) return c.json({ error: "Share link not found." }, 404);
    const link = await resolveShareLink(db, code);
    return link ? c.json(link) : c.json({ error: "Share link not found." }, 404);
  });
  return app;
}
