import { timingSafeEqual } from "node:crypto";
import Ajv from "ajv";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DrizzleDB } from "../db/index.js";
import { HouseInspectionError } from "../services/house-game-access.js";
import { discordGame, discordImage, discordRead, discordReadTools } from "../game-mcp/discord-reads.js";
import {
  assertDiscordGrant, discordUnavailable, issueDiscordGrant, parseDiscordTurn, referencePattern,
  signDiscordRef, verifyDiscordRef, type DiscordGrant,
} from "../game-mcp/discord-turn.js";

const prefix = "/api/internal/discord/agent";
const ajv = new Ajv();
const tools = new Map(discordReadTools.map(tool => [tool.name, { tool, validate: ajv.compile(tool.inputSchema) }]));
const staffOnly = new Set(["list_game_reasoning", "read_game_reasoning", "read_account"]);

export function createDiscordAgentRoutes(db: DrizzleDB) {
  const app = new Hono();
  app.use(prefix + "/*", bodyLimit({ maxSize: 8192 }));
  app.use(prefix + "/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof HouseInspectionError) {
      return c.json({ error: error.code === "not_accessible" ? "Unavailable in this conversation" : "Invalid or unavailable House read" }, 403);
    }
    console.error("[discord-agent] read failed", error.name);
    return c.json({ error: "House read unavailable" }, 503);
  });
  app.post(prefix + "/:action", async c => {
    const secret = process.env.DISCORD_CONTROLLER_TOKEN ?? "";
    if (secret.length < 43) return c.json({ error: "Unavailable" }, 503);
    const auth = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from("Bearer " + secret);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return c.json({ error: "Unauthorized" }, 401);
    const body: unknown = await c.req.json().catch(() => null);
    if (!plainObject(body)) return c.json({ error: "Invalid request" }, 400);
    const action = c.req.param("action");
    if (action === "turn") {
      const turn = parseDiscordTurn(body, process.env.DISCORD_HOUSE_GUILD_ID ?? "", process.env.DISCORD_AGENT_ROOM_ID ?? "");
      const grant = await issueDiscordGrant(db, turn);
      return c.json({ grant: signDiscordRef(grant, secret, "turn"), publicId: grant.publicId, link: grant.connectionId, lane: grant.lane });
    }

    if (typeof body.grant !== "string") return discordUnavailable();
    const grant = verifyDiscordRef(body.grant, secret, "turn") as DiscordGrant;
    await assertDiscordGrant(db, grant);
    if (action === "spoiler") {
      if (typeof body.game !== "string" || !referencePattern.test(body.game)) return discordUnavailable();
      const match = await discordGame(db, grant, body.game);
      await assertDiscordGrant(db, grant);
      if (match.row.gameKind !== "werewolf" || !match.row.startedAt) return discordUnavailable();
      return c.json({ gameId: match.row.id, slug: match.row.slug, settled: match.audience === "omniscient" });
    }
    if (action === "validate") {
      if (!Array.isArray(body.games) || body.games.length > 12) return discordUnavailable();
      for (const selector of body.games) {
        if (typeof selector !== "string" || !referencePattern.test(selector)) return discordUnavailable();
        await discordGame(db, grant, selector);
      }
      await assertDiscordGrant(db, grant);
      return c.json({ valid: true });
    }
    if (action !== "mcp") return c.notFound();

    if (body.method === "tools/list") {
      return c.json({ tools: discordReadTools.filter(t => available(t.name, grant)) });
    }
    const name = body.name;
    const args = body.args ?? {};
    const tool = typeof name === "string" ? tools.get(name) : undefined;
    if (body.method !== "tools/call" || typeof name !== "string" || !tool || !available(name, grant)
        || !plainObject(args) || !tool.validate(args)) return discordUnavailable();

    if (name === "inspect_image") {
      const image = await discordImage(db, grant, secret, String(args.imageRef));
      await assertDiscordGrant(db, grant);
      return c.json({ content: [{ type: "image", ...image }] });
    }
    const value = await discordRead(db, grant, secret, name, args);
    if (typeof args.game === "string") await discordGame(db, grant, args.game);
    await assertDiscordGrant(db, grant);
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 96 * 1024) throw new HouseInspectionError("entry_too_large", "Response too large");
    return c.json({ content: [{ type: "text", text: data }] });
  });
  return app;
}

function available(name: string, grant: DiscordGrant) {
  return (!staffOnly.has(name) || grant.lane === "staff") && (name !== "list_agents" || grant.lane !== "room");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
