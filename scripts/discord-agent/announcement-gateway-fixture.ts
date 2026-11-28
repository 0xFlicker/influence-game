// Run the production entry point with isolated transport and Codex doubles.
import { mock } from "bun:test";

const scenario = process.argv[2];
const guild = "1521921716224393436";
const channelId = "1521921716224393437";
const botId = "1521921716224393438";
const messageId = "1521921716224393439";
const origin = "https://thehouse.game";
const kind = scenario === "start" ? "start" : "finish";
const url = origin + (kind === "start" ? "/games/copper-fox" : "/games/copper-fox/replay");
const job = { id: "job-1", lease: "lease-1", channelId, kind, facts: { gameKind: "influence", season: "Season 1" }, url };
const nonce = "stable-discord-nonce";
const calls: Array<{ action: string; body?: unknown }> = [];
const { promise: settled, resolve: settle } = Promise.withResolvers<void>();
const { promise: memberTurn, resolve: enterMemberTurn } = Promise.withResolvers<void>();
const memberId = "1521921716224393441";
const roleId = "1521921716224393440";
let drafts = 0;

Object.assign(process.env, {
  DISCORD_HOUSE_GUILD_ID: guild,
  DISCORD_AGENT_ROOM_ID: channelId,
  DISCORD_ANNOUNCEMENT_CHANNEL_ID: channelId,
  DISCORD_ROLE_USER_ID: roleId,
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_CONTROLLER_TOKEN: "test-controller-token",
  HOUSE_API_URL: origin,
  HOUSE_CODEX_IMAGE: "test-codex",
  HOUSE_CODEX_MODEL: "test-model",
  HOUSE_INFERENCE_LOCAL_TOKEN: "test-inference-token",
  HOUSE_DISCORD_STATE_DB: ":memory:",
});

let activeSocket: FixtureGateway;
class FixtureGateway extends EventTarget {
  static OPEN = 1;
  readyState = FixtureGateway.OPEN;
  constructor() {
    super();
    activeSocket = this;
    queueMicrotask(() => this.packet({
      op: 0, t: "READY", d: { user: { id: botId }, session_id: "fixture", resume_gateway_url: "wss://gateway.discord.gg" },
    }));
  }
  packet(data: object) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}
globalThis.WebSocket = FixtureGateway as unknown as typeof WebSocket;

mock.module("../../packages/api/src/discord/conversation/sandbox.ts", () => ({
  async runCodex(_config: unknown, mode: string, input: string, tools: string[], mcp: (input: Record<string, unknown>) => Promise<Response>) {
    if (mode !== "reply" || tools.length || (await (await mcp({ method: "tools/list" })).json()).tools.length
        || (await mcp({ method: "tools/call", name: "read_game" })).status !== 403) throw new Error("Announcement tools must be blocked");
    const prompt = JSON.parse(input) as { gameAnnouncement: { kind: string; facts: object; canonicalLink: string; correction?: string } };
    if (prompt.gameAnnouncement.kind !== kind || prompt.gameAnnouncement.canonicalLink !== url) throw new Error("Missing trusted announcement context");
    calls.push({ action: "codex", body: prompt.gameAnnouncement });
    drafts++;
    if (scenario === "author-unavailable") throw new Error("Codex unavailable");
    const text = scenario === "correction" && drafts === 1 ? "x".repeat(2000)
      : kind === "start" ? "Influence has begun in Season 1." : "Copper Fox won the jury vote.\nThe final elimination broke the tie.";
    return { messages: [text], imageRefs: [], spoiler: { action: "none", game: "" }, subject: { kind: "none", id: "" } };
  },
}));

globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
  const request = new URL(String(input));
  const header = new Headers(init?.headers).get("authorization");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  if (request.origin === origin && header === "Bearer test-controller-token") {
    const action = request.pathname.split("/").at(-1);
    if (action === "announcement-claim") {
      calls.push({ action, body });
      if (scenario === "interactive-race") {
        const snowflake = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
        activeSocket.packet({ op: 0, t: "MESSAGE_CREATE", d: { id: snowflake, guild_id: guild, channel_id: channelId,
          type: 0, content: "What's the score?", author: { id: memberId } } });
        await memberTurn;
      }
      return Response.json({ job });
    }
    if (action === "turn" && scenario === "interactive-race") {
      calls.push({ action: "member-turn", body });
      enterMemberTurn();
      await Bun.sleep(0);
      settle();
      return new Response(null, { status: 403 });
    }
    if (action === "announcement-begin") {
      calls.push({ action, body });
      if (scenario === "restricted") {
        settle();
        return Response.json({ authorized: false });
      }
      if (scenario === "lost-begin") throw new DOMException("Timeout", "TimeoutError");
      return Response.json({ authorized: true, nonce });
    }
    if (action === "announcement-complete") {
      calls.push({ action, body });
      settle();
      return Response.json({ ok: true });
    }
  }
  if (request.origin === "https://discord.com" && header === "Bot test-bot-token") {
    if (request.pathname === `/api/v10/channels/${channelId}`) {
      calls.push({ action: "check-discord-channel" });
      return Response.json({ id: channelId, guild_id: scenario === "wrong-guild" ? botId : guild, type: 0 });
    }
    if (request.pathname === `/api/v10/guilds/${guild}/members/${memberId}` && scenario === "interactive-race") {
      return Response.json({ user: { id: memberId }, pending: false, roles: [roleId] });
    }
    if (request.pathname === `/api/v10/channels/${channelId}/messages`) {
      calls.push({ action: "post-to-discord", body });
      if (scenario === "ambiguous") throw new DOMException("Timeout", "TimeoutError");
      return Response.json({ id: messageId, channel_id: channelId }, { status: 201 });
    }
  }
  throw new Error(`Unexpected fixture request ${request.pathname}`);
}) as typeof fetch;

await import("../../packages/api/src/discord/conversation/gateway.js");
const deadline = setTimeout(() => { throw new Error("Announcement fixture failed to settle"); }, 2000);
await settled;
clearTimeout(deadline);
await Bun.sleep(0);
console.log(JSON.stringify({ calls }));
