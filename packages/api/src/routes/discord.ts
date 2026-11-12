import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { discordOAuthConfig, discordOpaque, discordSnowflake, DiscordVerificationError, exchangeDiscordIdentity, type DiscordIdentityExchange, type DiscordOAuthConfig } from "../services/discord-oauth.js";
import { changeDiscordConnection, claimDiscordRoleWork, completeDiscordRoleWork, confirmDiscordVerification, discordDeliveryErrors, exchangeDiscordVerification, readDiscordConnection, readDiscordRoleWork, resolveDiscordAuthority, startDiscordVerification, type DiscordDeliveryError } from "../services/discord-verification.js";

function badInput(): never { throw new DiscordVerificationError("invalid_request", 400, "Invalid verification request."); }
async function body(c: Context, keys: string[]): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await c.req.json(); } catch { return badInput(); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) badInput();
  return value as Record<string, unknown>;
}
function str(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.length || value.length > 512 || (pattern && !pattern.test(value))) badInput();
  return value;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function serviceAuthorized(c: Context, key: "DISCORD_WORKER_TOKEN" | "DISCORD_CONTROLLER_TOKEN") {
  const expected = process.env[key] ?? "";
  const supplied = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  const expectedBytes = Buffer.from(expected), suppliedBytes = Buffer.from(supplied);
  return expected.length >= 43 && suppliedBytes.length === expectedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function createDiscordRoutes(db: DrizzleDB, options: { config?: () => DiscordOAuthConfig; exchange?: DiscordIdentityExchange } = {}) {
  const app = new Hono<AuthEnv>();
  const config = options.config ?? discordOAuthConfig;
  app.use("/api/discord/*", bodyLimit({ maxSize: 8192 }));
  app.use("/api/internal/discord/*", bodyLimit({ maxSize: 8192 }));
  for (const path of ["/api/discord/*", "/api/internal/discord/*"]) {
    app.use(path, async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  }
  app.onError((error, c) => {
    if (error instanceof DiscordVerificationError) return c.json({ error: error.message, code: error.code }, error.status);
    console.error("[discord] request failed", error.name);
    return c.json({ error: "Discord verification could not be completed. Please try again." }, 500);
  });
  app.use("/api/discord/*", requireAuth(db));
  app.get("/api/discord/connection", c => readDiscordConnection(db, c.get("user").id).then(result => c.json(result)));
  app.post("/api/discord/start", async c => {
    const input = await body(c, ["nonce"]);
    return c.json(await startDiscordVerification(db, c.get("user").id, str(input.nonce, discordOpaque), config()));
  });
  app.post("/api/discord/exchange", async c => {
    const input = await body(c, ["state", "nonce", "code", "issuer"]);
    if (input.issuer !== "https://discord.com") badInput();
    return c.json(await exchangeDiscordVerification(db, c.get("user").id, {
      state: str(input.state, discordOpaque), nonce: str(input.nonce, discordOpaque), code: str(input.code),
    }, config(), options.exchange ?? exchangeDiscordIdentity));
  });
  app.post("/api/discord/confirm", async c => {
    const input = await body(c, ["state", "nonce"]);
    return c.json(await confirmDiscordVerification(db, c.get("user").id, str(input.state, discordOpaque), str(input.nonce, discordOpaque), config()));
  });
  for (const action of ["refresh", "disconnect"] as const) {
    app.post(`/api/discord/${action}`, async c => {
      await body(c, []);
      return c.json(await changeDiscordConnection(db, c.get("user").id, action));
    });
  }
  app.post("/api/internal/discord/identity", async c => {
    if (!serviceAuthorized(c, "DISCORD_CONTROLLER_TOKEN")) return c.json({ error: "Unauthorized" }, 401);
    const input = await body(c, ["discordId", "guildId"]);
    const guildId = str(input.guildId, discordSnowflake);
    if (guildId !== process.env.DISCORD_HOUSE_GUILD_ID) return c.json({ error: "Unknown guild" }, 403);
    return c.json(await resolveDiscordAuthority(db, str(input.discordId, discordSnowflake), guildId));
  });
  app.use("/api/internal/discord/work/*", async (c, next) => {
    if (!serviceAuthorized(c, "DISCORD_WORKER_TOKEN")) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  app.post("/api/internal/discord/work/claim", async c => {
    await body(c, []);
    const guildId = process.env.DISCORD_HOUSE_GUILD_ID;
    if (!guildId || !discordSnowflake.test(guildId)) throw new DiscordVerificationError("discord_unconfigured", 503, "Discord guild is not configured.");
    return c.json({ work: await claimDiscordRoleWork(db, guildId) });
  });
  app.post("/api/internal/discord/work/current", async c => {
    const input = await body(c, ["id", "lease"]);
    return c.json({ work: await readDiscordRoleWork(db, str(input.id, uuid), str(input.lease, uuid)) });
  });
  app.post("/api/internal/discord/work/complete", async c => {
    const input = await body(c, ["id", "lease", "revision", "roles", "error", "retryAfter"]);
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1 || !Array.isArray(input.roles)
      || input.roles.length > 4 || !input.roles.every(role => ["user", "moderator", "admin", "sysop"].includes(role))) badInput();
    if (input.error !== undefined && !discordDeliveryErrors.includes(input.error as DiscordDeliveryError)) badInput();
    if (input.retryAfter !== undefined && (typeof input.retryAfter !== "number" || !Number.isFinite(input.retryAfter) || input.retryAfter < 0 || input.retryAfter > 86400)) badInput();
    return c.json({ accepted: await completeDiscordRoleWork(db, { id: str(input.id, uuid), lease: str(input.lease, uuid),
      revision: Number(input.revision), roles: input.roles as string[], error: input.error as DiscordDeliveryError | undefined,
      retryAfter: input.retryAfter as number | undefined }) });
  });
  return app;
}
