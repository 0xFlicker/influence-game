import { executeModerationRead, executeModerationWrite } from "../services/moderation-commands.js";
import { Hono } from "hono";
import sharp from "sharp";
import { type DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { ModerationError, moderationAuthority, readModerationReceipt, listModerationRecovery, listModerationQueue, readModerationReview, readModerationEvidence } from "../services/moderation-intake.js";

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new ModerationError("invalid_input", "Invalid command fields.", 400);
  return value as Record<string, unknown>;
}
function text(body: Record<string, unknown>, key: string, max = 200) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value;
}
function optionalText(body: Record<string, unknown>, key: string, max = 200) {
  return body[key] === undefined ? undefined : text(body, key, max);
}
function integer(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value;
}
function choice<const T extends string>(body: Record<string, unknown>, key: string, choices: readonly T[]): T {
  const value = text(body, key);
  if (!choices.includes(value as T)) throw new ModerationError("invalid_input", `Invalid ${key}.`, 400);
  return value as T;
}

export function createModerationRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.use("/api/moderation/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.use("/api/moderation/*", requireAuth(db));
  app.onError((error, c) => {
    if (error instanceof ModerationError) return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON", code: "invalid_input" }, 400);
    console.error("[moderation] Request failed", error);
    return c.json({ error: "Moderation request failed. Refresh before retrying.", code: "moderation_failed" }, 500);
  });
  app.get("/api/moderation/capabilities", async c => c.json(await moderationAuthority(db, c.get("user").id)));
  app.get("/api/moderation/receipts/:id", async c => c.json(await readModerationReceipt(db, c.get("user").id, c.req.param("id"))));
  app.get("/api/moderation/recovery", async c => c.json(await listModerationRecovery(db, c.get("user").id, Number(c.req.query("offset") ?? 0))));
  app.get("/api/moderation/queue", async c => {
    const q = object(c.req.query(), ["route", "filter", "offset"]);
    return c.json(await listModerationQueue(db, c.get("user").id, {
      route: q.route === undefined ? undefined : choice(q, "route", ["ordinary", "escalated"]),
      filter: q.filter === undefined ? undefined : choice(q, "filter", ["all", "available", "mine", "flagged"]),
      offset: q.offset === undefined ? undefined : Number(q.offset),
    }));
  });
  app.get("/api/moderation/reviews/:id", async c => c.json(await readModerationReview(db, c.get("user").id, c.req.param("id"))));
  app.get("/api/moderation/reviews/:id/evidence/:hash", async c => {
    const bytes = await readModerationEvidence(db, c.get("user").id, c.req.param("id"), c.req.param("hash"));
    // Normalize retained images to a passive format, never serve submitted active content.
    const png = await sharp(bytes).rotate().png().toBuffer();
    c.header("Content-Type", "image/png");
    return c.body(new Uint8Array(png));
  });
  app.post("/api/moderation/claim", async c => {
    const b = object(await c.req.json(), ["actionId", "reviewId", "route"]);
    return c.json(await executeModerationWrite(db, c.get("user").id, { operation: "claim", actionId: text(b, "actionId"), reviewId: optionalText(b, "reviewId"), route: b.route === undefined ? undefined : choice(b, "route", ["ordinary", "escalated"]) }));
  });
  app.post("/api/moderation/reviews/:id/triage", async c => {
    const b = object(await c.req.json(), ["actionId", "action", "token", "version", "reason"]);
    return c.json(await executeModerationWrite(db, c.get("user").id, { operation: "triage", reviewId: c.req.param("id"), actionId: text(b, "actionId"), action: choice(b, "action", ["extend", "release", "flag", "pass", "return"]), token: text(b, "token"), version: integer(b, "version"), reason: optionalText(b, "reason", 2000) }));
  });
  app.post("/api/moderation/reviews/:id/preview", async c => {
    const b = object(await c.req.json(), ["action"]);
    return c.json(await executeModerationRead(db, c.get("user").id, { operation: "preview", reviewId: c.req.param("id"), action: choice(b, "action", ["accept", "reject"]) }));
  });
  app.post("/api/moderation/reviews/:id/decide", async c => {
    const b = object(await c.req.json(), ["actionId", "action", "token", "version", "reason", "previewFingerprint", "expectedDisposition", "disposition", "undoActionId"]);
    return c.json(await executeModerationWrite(db, c.get("user").id, { operation: "decide", reviewId: c.req.param("id"), actionId: text(b, "actionId"), action: choice(b, "action", ["accept", "reject"]), token: optionalText(b, "token"), version: integer(b, "version"), reason: optionalText(b, "reason", 2000), previewFingerprint: text(b, "previewFingerprint"), expectedDisposition: choice(b, "expectedDisposition", ["allowed", "rejected"]), disposition: choice(b, "disposition", ["allowed", "rejected"]), undoActionId: optionalText(b, "undoActionId") }));
  });
  app.post("/api/moderation/reviews/:id/reopen", async c => {
    const b = object(await c.req.json(), ["actionId", "version", "reason"]);
    return c.json(await executeModerationWrite(db, c.get("user").id, { operation: "reopen", reviewId: c.req.param("id"), actionId: text(b, "actionId"), version: integer(b, "version"), reason: text(b, "reason", 2000) }));
  });
  app.post("/api/moderation/profiles/:id/restore", async c => {
    const b = object(await c.req.json(), ["version", "reason"]);
    return c.json(await executeModerationWrite(db, c.get("user").id, { operation: "restore", profileId: c.req.param("id"), version: integer(b, "version"), reason: text(b, "reason", 2000) }));
  });
  return app;
}
