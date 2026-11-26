import { Database } from "bun:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { activeOffer, destination, discordMessageTime, roomContext, roomReplyId, safeReply, snowflake, validatedConsent, validatedReply, withTurnFeedback, type DiscordMessage, type SpoilerOffer } from "./policy.js";
import { runCodex } from "./sandbox.js";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name);
  return value;
}
const guild = env("DISCORD_HOUSE_GUILD_ID");
const room = env("DISCORD_AGENT_ROOM_ID");
const memberRole = env("DISCORD_ROLE_USER_ID");
if (![guild, room, memberRole].every(id => snowflake.test(id))) throw new Error("Invalid Discord configuration");
const bot = env("DISCORD_BOT_TOKEN");
const controller = env("DISCORD_CONTROLLER_TOKEN");
const house = new URL(env("HOUSE_API_URL"));
if (house.protocol !== "https:" || house.username || house.password || house.pathname !== "/" || house.search || house.hash) {
  throw new Error("Invalid House origin");
}
const sandbox = { image: env("HOUSE_CODEX_IMAGE"), model: env("HOUSE_CODEX_MODEL"), inferenceToken: env("HOUSE_INFERENCE_LOCAL_TOKEN") };
const ids = new Database(env("HOUSE_DISCORD_STATE_DB"), { create: true });
ids.run("PRAGMA journal_mode = WAL");
ids.run("CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, time INTEGER NOT NULL)");
const seen = ids.query("INSERT OR IGNORE INTO seen VALUES (?, ?)");
const offers = new Map<string, SpoilerOffer>();
const history = new Map<string, { link: string; messages: string[]; expires: number }>();
const queue: DiscordMessage[] = [];
let draining = false;
let closing = false;
let activeSocket: WebSocket | undefined;
let botId: string | undefined;

async function discord(path: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bot " + bot);
    const timeout = AbortSignal.timeout(8000);
    const response = await fetch("https://discord.com/api/v10" + path, {
      ...init, headers, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (response.status !== 429 || attempt === 1) return response;
    const seconds = Number(response.headers.get("retry-after"));
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5) return response;
    await response.body?.cancel();
    await delay(seconds * 1000, undefined, { signal: init.signal ?? undefined });
  }
  throw new Error("Discord request failed");
}

async function allowed(m: DiscordMessage, kind: "room" | "dm") {
  const channel = await discord("/channels/" + m.channel_id);
  if (!channel.ok) return false;
  const data = await channel.json() as { id: string; type: number; guild_id?: string; recipients?: Array<{ id: string }> };
  if (data.id !== m.channel_id || (kind === "room" ? data.type !== 0 || data.guild_id !== guild
    : data.type !== 1 || data.recipients?.length !== 1 || data.recipients[0]?.id !== m.author.id)) return false;
  const member = await discord("/guilds/" + guild + "/members/" + m.author.id);
  if (!member.ok) return false;
  const roles = await member.json() as { pending?: boolean; roles?: string[]; user?: { id: string } };
  return roles.user?.id === m.author.id && roles.pending !== true && roles.roles?.includes(memberRole) === true;
}

async function api(action: string, body: object) {
  return fetch(new URL("/api/internal/discord/agent/" + action, house), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(22_000),
    headers: { "content-type": "application/json", authorization: "Bearer " + controller }, body: JSON.stringify(body),
  });
}

async function readRoomContext(m: DiscordMessage) {
  const path = "/channels/" + room + "/messages";
  const read = async (suffix: string) => {
    try {
      const response = await discord(path + suffix, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return await response.json() as unknown;
    } catch {
      console.log(JSON.stringify({ event: "discord_room_context_unavailable" }));
    }
    return null;
  };
  const reference = roomReplyId(m);
  const [page, parent] = await Promise.all([
    read("?limit=20&before=" + m.id),
    reference ? read("/" + reference) : null,
  ]);
  const messages = Array.isArray(page) ? page : [];
  if (parent && typeof parent === "object" && "id" in parent && parent.id === reference) messages.push(parent);
  return roomContext(m, messages, botId);
}

async function send(m: DiscordMessage, content: string, images: Array<{ mimeType: string; data: string }> = []) {
  const payload = {
    content: safeReply(content, house.origin), flags: 4, nonce: m.id, enforce_nonce: true,
    allowed_mentions: { parse: [], replied_user: false },
    message_reference: { message_id: m.id, channel_id: m.channel_id, fail_if_not_exists: true },
    ...(images.length && { attachments: images.map((_, id) => ({ id, filename: "house-" + (id + 1) + ".png" })) }),
  };
  if (!payload.content && !images.length) return null;
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  images.forEach((image, id) => {
    form.set("files[" + id + "]", new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), "house-" + (id + 1) + ".png");
  });
  const response = await discord("/channels/" + m.channel_id + "/messages", { method: "POST", body: form });
  if (!response.ok) {
    const rejection = await response.json().catch(() => null) as { code?: unknown } | null;
    console.log(JSON.stringify({
      event: "discord_delivery_rejected", status: response.status,
      code: typeof rejection?.code === "number" ? rejection.code : null,
    }));
    throw new Error("Discord rejected the reply");
  }
  return (await response.json() as { id: string }).id;
}

interface Turn { grant: string; publicId: string; lane: "room" | "owner" | "staff"; link: string }
interface TurnBinding { discordId: string; channelId: string; messageId: string; kind: "room" | "dm" }
interface TurnProgress {
  stage: "eligibility" | "grant" | "catalog" | "codex" | "reply" | "spoiler" | "attachment" | "revalidate" | "delivery";
}
async function handle(m: DiscordMessage, progress: TurnProgress) {
  const kind = destination(m, guild, room);
  if (!kind || !(await allowed(m, kind))) return "ineligible";
  const params: TurnBinding = { discordId: m.author.id, channelId: m.channel_id, messageId: m.id, kind };
  progress.stage = "grant";
  const start = await api("turn", params);
  if (!start.ok) return "unavailable";
  const turn = await start.json() as Turn;
  return withTurnFeedback(discord, m, () => answer(m, progress, params, turn));
}

async function answer(m: DiscordMessage, progress: TurnProgress, params: TurnBinding, turn: Turn) {
  const { kind } = params;
  const key = m.channel_id + ":" + m.author.id;
  const prior = history.get(key);
  const context = kind === "room" ? await readRoomContext(m) : undefined;
  const recent = context
    ? context.recent.filter(message => message.speaker === "requesting_member").map(message => message.text).slice(-4)
    : prior?.link === turn.link && prior.expires > Date.now() ? prior.messages : [];
  const offer = activeOffer(offers.get(key), m, turn.link);
  const current = m.content.slice(0, 2500);
  const games = new Set<string>();
  const inspected = new Set<string>();
  const finish = async () => {
    progress.stage = "revalidate";
    return (await api("validate", { grant: turn.grant, games: [...games] })).ok && await allowed(m, kind);
  };

  const generate = async (revealed?: string) => {
    progress.stage = "catalog";
    const tools = await api("mcp", { grant: turn.grant, method: "tools/list" });
    if (!tools.ok) throw new Error("House catalog unavailable");
    const catalog = await tools.json() as { tools: Array<{ name: string }> };
    const prompt = JSON.stringify({
      conversation: kind, access: turn.lane, memberPublicId: turn.publicId, houseOrigin: house.origin,
      activeSpoilerOffer: offer?.game, authorizedSpoiler: revealed, recentMemberMessages: recent,
      recentRoomMessages: context?.recent, repliedToRoomMessage: context?.repliedTo,
      currentMemberMessage: current,
    });
    progress.stage = "codex";
    const result = await runCodex(sandbox, "reply", prompt, catalog.tools.map(tool => tool.name), async body => {
      const response = await api("mcp", { ...body, grant: turn.grant });
      if (response.ok && body.method === "tools/call") {
        const args = body.args as Record<string, unknown> | undefined;
        if (typeof args?.game === "string") games.add(args.game);
        if (body.name === "inspect_image" && typeof args?.imageRef === "string") inspected.add(args.imageRef);
      }
      return response;
    });
    progress.stage = "reply";
    return validatedReply(result);
  };

  let reply = await generate();
  if (reply.spoiler.action !== "none") {
    progress.stage = "spoiler";
    const challenge = await api("spoiler", { grant: turn.grant, game: reply.spoiler.game });
    if (!challenge.ok) return "spoiler_unavailable";
    const target = await challenge.json() as { gameId: string; slug: string; settled: boolean };
    if (target.settled) {
      games.add(target.gameId);
      reply = await generate();
      if (reply.spoiler.action !== "none") return "spoiler_unavailable";
    } else {
      const matchingOffer = offer?.game === target.gameId;
      const consentPrompt = JSON.stringify({
        currentMemberMessage: current, recentMemberMessages: recent, game: target, matchingOffer,
      });
      const consent = reply.spoiler.action === "authorize"
        ? await runCodex(sandbox, "consent", consentPrompt, [], async () => new Response(null, { status: 403 })) : null;
      if (consent && validatedConsent(consent)) {
        if (!(await finish())) return "authority_changed";
        progress.stage = "spoiler";
        const grant = await api("turn", { ...params, spoilerGame: target.gameId });
        if (!grant.ok) return "authority_changed";
        const elevated = await grant.json() as Turn;
        if (elevated.link !== turn.link || elevated.lane !== turn.lane) return "authority_changed";
        turn = elevated;
        games.add(target.gameId);
        inspected.clear();
        reply = await generate(target.gameId);
        if (reply.spoiler.action !== "none") return "spoiler_unavailable";
        if (kind === "room") reply.text = "**Live Werewolf spoiler for this room.**\n" + reply.text;
        offers.delete(key);
      } else {
        games.add(target.gameId);
        if (!(await finish())) return "authority_changed";
        progress.stage = "delivery";
        const sent = await send(m, kind === "room"
          ? "Shall I open the Omniscient view for **" + target.slug + "**? The answer will be visible to this room."
          : "Shall I open the Omniscient view for **" + target.slug + "**?");
        if (sent) offers.set(key, { game: target.gameId, member: m.author.id, channel: m.channel_id, link: turn.link,
          reply: sent, expires: Date.now() + 5 * 60_000 });
        return "spoiler_offered";
      }
    }
  }

  const images: Array<{ mimeType: string; data: string }> = [];
  progress.stage = "attachment";
  for (const imageRef of new Set(reply.imageRefs)) {
    if (!inspected.has(imageRef)) continue;
    const response = await api("mcp", { grant: turn.grant, method: "tools/call", name: "inspect_image", args: { imageRef } });
    if (!response.ok) return "authority_changed";
    const image = (await response.json() as { content: Array<{ mimeType: string; data: string }> }).content[0];
    if (image?.mimeType === "image/png" && image.data.length <= 4_000_000) images.push(image);
  }
  if (!(await finish())) return "authority_changed";
  progress.stage = "delivery";
  if (!await send(m, reply.text, images)) return "empty_reply";
  if (kind === "dm") history.set(key, { link: turn.link, messages: [...recent, current].slice(-4), expires: Date.now() + 15 * 60_000 });
  return "replied";
}

function accept(m: DiscordMessage) {
  if (closing || queue.length >= 12 || !destination(m, guild, room)) return;
  const now = Date.now();
  const posted = discordMessageTime(m.id);
  if (now - posted > 120_000 || now < posted - 5000 || !seen.run(m.id, now).changes) return;
  queue.push(m);
  if (!draining) void drain();
}

async function drain() {
  draining = true;
  while (queue.length && !closing) {
    const m = queue.shift()!;
    const started = Date.now();
    const ageMs = started - discordMessageTime(m.id);
    const progress: TurnProgress = { stage: "eligibility" };
    let result: string;
    try { result = ageMs <= 120_000 ? await handle(m, progress) : "expired"; } catch { result = "turn_failed"; }
    console.log(JSON.stringify({
      event: "discord_turn", result, ...(result === "turn_failed" && { stage: progress.stage }),
      latencyMs: Date.now() - started, queueAgeMs: ageMs, queued: queue.length,
    }));
  }
  draining = false;
  if (closing) process.exit(0);
}

let sequence: number | null = null;
let session: string | undefined;
let resumeOrigin: string | undefined;
function connect() {
  if (closing) return;
  const socket = new WebSocket((resumeOrigin ?? "wss://gateway.discord.gg") + "/?v=10&encoding=json");
  activeSocket = socket;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let firstBeat: ReturnType<typeof setTimeout> | undefined;
  let ack = true;
  let reconnectDelay = 2000;
  const send = (op: number, d: unknown) => socket.send(JSON.stringify({ op, d }));
  socket.addEventListener("message", event => {
    try {
      const packet = JSON.parse(String(event.data));
      if (typeof packet.s === "number") sequence = packet.s;
      if (packet.op === 10) {
        const interval = Number(packet.d.heartbeat_interval);
        if (!Number.isFinite(interval) || interval < 1000) return socket.close();
        const beat = () => {
          if (!ack) { socket.close(4000, "Heartbeat timeout"); return; }
          ack = false;
          send(1, sequence);
        };
        firstBeat = setTimeout(() => { beat(); heartbeat = setInterval(beat, interval); }, Math.random() * interval);
        if (session && sequence !== null) send(6, { token: bot, session_id: session, seq: sequence });
        else send(2, { token: bot, intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15),
          properties: { os: "linux", browser: "house", device: "house" } });
      } else if (packet.op === 11) ack = true;
      else if (packet.op === 1) send(1, sequence);
      else if (packet.op === 7) socket.close(4000, "Reconnect");
      else if (packet.op === 9) {
        if (!packet.d) { sequence = null; session = undefined; resumeOrigin = undefined; }
        reconnectDelay = 5000;
        socket.close(4000, "Invalid session");
      } else if (packet.op === 0 && packet.t === "READY") {
        if (typeof packet.d.user?.id === "string" && snowflake.test(packet.d.user.id)) botId = packet.d.user.id;
        session = packet.d.session_id;
        const url = new URL(packet.d.resume_gateway_url);
        if (url.protocol === "wss:" && url.hostname === "gateway.discord.gg") resumeOrigin = url.origin;
        console.log(JSON.stringify({ event: "discord_gateway_ready" }));
      } else if (packet.op === 0 && packet.t === "MESSAGE_CREATE") accept(packet.d);
    } catch {
      socket.close(4000, "Invalid Gateway payload");
    }
  });
  socket.addEventListener("close", e => {
    clearInterval(heartbeat);
    clearTimeout(firstBeat);
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(e.code)) {
      console.error(JSON.stringify({ event: "discord_gateway_configuration_error", code: e.code }));
      reconnectDelay = 60_000;
    }
    if (e.code === 4007 || e.code === 4009) { sequence = null; session = undefined; resumeOrigin = undefined; }
    if (!closing) setTimeout(connect, reconnectDelay);
  });
}
setInterval(() => {
  const now = Date.now();
  ids.run("DELETE FROM seen WHERE time < ?", [now - 86_400_000]);
  for (const [key, value] of offers) if (value.expires <= now) offers.delete(key);
  for (const [key, value] of history) if (value.expires <= now) history.delete(key);
}, 60_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => {
  closing = true;
  activeSocket?.close();
  if (!draining) process.exit(0);
});
connect();
