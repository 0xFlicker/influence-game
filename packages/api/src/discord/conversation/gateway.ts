import { Database } from "bun:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  activeOffer, availableDmHistory, decideSpoilerTurn, destination, directReplyId, discordMessageTime, discordReplyForm,
  dmContext, prepareReply, readSpoilerTarget, revalidateDmSubject, roomContext, snowflake, spoilerOfferContext,
  subjectKey, subjectsFromRead, validatedConsent, validatedReply, withTurnFeedback,
  type DiscordMessage, type DmHistory, type SpoilerOffer, type Subject, type TurnAuthority,
} from "./policy.js";
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
const history = new Map<string, DmHistory>();
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
  const reference = directReplyId(m);
  const [page, parent] = await Promise.all([
    read("?limit=20&before=" + m.id),
    reference ? read("/" + reference) : null,
  ]);
  const messages = Array.isArray(page) ? page : [];
  if (parent && typeof parent === "object" && "id" in parent && parent.id === reference) messages.push(parent);
  return roomContext(m, messages, botId);
}

async function send(m: DiscordMessage, content: string, images: Array<{ mimeType: string; data: string }> = [], liveRoomSpoiler = false) {
  const form = discordReplyForm(m, content, images, liveRoomSpoiler);
  if (!form) return null;
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

interface Turn extends TurnAuthority { grant: string; publicId: string }
interface TurnBinding { discordId: string; channelId: string; messageId: string; kind: "room" | "dm" }
type SpoilerDelivery =
  | { action: "offer" | "settled" | "authorized"; game: string; slug: string }
  | { action: "offer_pending" | "ask_explicitly" };
interface TurnProgress {
  stage: "eligibility" | "grant" | "catalog" | "codex" | "reply" | "spoiler" | "attachment" | "revalidate" | "delivery";
}
async function handle(m: DiscordMessage, progress: TurnProgress) {
  const kind = destination(m, guild, room);
  if (!kind) return "ineligible";
  const key = m.channel_id + ":" + m.author.id;
  const forget = (reason: string) => {
    history.delete(key);
    offers.delete(key);
    return reason;
  };
  if (!(await allowed(m, kind))) return forget("ineligible");
  const params: TurnBinding = { discordId: m.author.id, channelId: m.channel_id, messageId: m.id, kind };
  progress.stage = "grant";
  const start = await api("turn", params);
  if (!start.ok) return start.status === 403 ? forget("unavailable") : "unavailable";
  const turn = await start.json() as Turn;
  return withTurnFeedback(discord, m, () => answer(m, progress, params, turn, key));
}

async function answer(m: DiscordMessage, progress: TurnProgress, params: TurnBinding, turn: Turn, key: string) {
  const { kind } = params;
  const prior = availableDmHistory(history.get(key), m, turn);
  if (!prior.length) history.delete(key);
  const lastOffer = offers.get(key);
  if (lastOffer && (lastOffer.link !== turn.link || lastOffer.lane !== turn.lane)) offers.delete(key);
  const [roomHistory, dmHistory, spoilerContext] = await Promise.all([
    kind === "room" ? readRoomContext(m) : undefined,
    kind === "dm" ? dmContext(prior, m, reference => revalidateDmSubject(reference, turn.grant, api)) : undefined,
    spoilerOfferContext(activeOffer(offers.get(key), m, turn), turn.grant, api),
  ]);
  const recent = roomHistory
    ? roomHistory.recent.filter(message => message.speaker === "requesting_member").map(message => message.text).slice(-4)
    : dmHistory?.memberMessages ?? [];
  const current = m.content.slice(0, 2500);
  const games = new Set<string>();
  if (spoilerContext?.settledGame) games.add(spoilerContext.settledGame);
  const observedSubjects = new Map<string, Subject>();
  const inspected = new Set<string>();
  const finish = async (links: string[] = []) => {
    progress.stage = "revalidate";
    const checks = await Promise.all([
      allowed(m, kind),
      ...(dmHistory?.recentSubjects ?? []).map(reference => revalidateDmSubject(reference, turn.grant, api)),
    ]);
    if (!checks.every(Boolean)) return null;
    const validation = await api("validate", { grant: turn.grant, games: [...games], links });
    if (!validation.ok) return null;
    const result = await validation.json() as { valid?: boolean; links?: string[] };
    if (result.valid !== true || !Array.isArray(result.links)) return null;
    const allowedLinks = new Set(result.links);
    return new Set(links.filter(link => allowedLinks.has(link)));
  };

  const generate = async (spoilerDelivery?: SpoilerDelivery) => {
    observedSubjects.clear();
    inspected.clear();
    const copyOnly = spoilerDelivery?.action === "offer" || spoilerDelivery?.action === "offer_pending" || spoilerDelivery?.action === "ask_explicitly";
    let toolNames: string[] = [];
    if (!copyOnly) {
      progress.stage = "catalog";
      const tools = await api("mcp", { grant: turn.grant, method: "tools/list" });
      if (!tools.ok) throw new Error("House catalog unavailable");
      const catalog = await tools.json() as { tools: Array<{ name: string }> };
      toolNames = catalog.tools.map(tool => tool.name);
    }
    const deliveryContext = { conversation: kind, access: turn.lane, spoilerDelivery };
    const prompt = JSON.stringify(copyOnly ? deliveryContext : {
      ...deliveryContext, memberPublicId: turn.publicId, houseOrigin: house.origin,
      activeSpoilerOffer: spoilerDelivery ? undefined : spoilerContext?.offer?.game,
      settledSpoilerGame: spoilerDelivery ? undefined : spoilerContext?.settledGame,
      recentMemberMessages: recent,
      recentRoomMessages: roomHistory?.recent, repliedToRoomMessage: roomHistory?.repliedTo,
      recentDmSubjects: dmHistory?.recentSubjects, repliedToDmMessage: dmHistory?.repliedTo,
      hasExplicitDmReply: kind === "dm" ? Boolean(m.message_reference) : undefined,
      currentMemberMessage: current,
    });
    progress.stage = "codex";
    const result = await runCodex(sandbox, "reply", prompt, toolNames, async body => {
      if (copyOnly) return body.method === "tools/list" ? Response.json({ tools: [] }) : new Response(null, { status: 403 });
      const response = await api("mcp", { ...body, grant: turn.grant });
      if (response.ok && body.method === "tools/call") {
        const args = body.args as Record<string, unknown> | undefined;
        if (typeof args?.game === "string") games.add(args.game);
        if (body.name === "inspect_image" && typeof args?.imageRef === "string") inspected.add(args.imageRef);
        if (kind === "dm" || body.name === "resolve_house_link") {
          for (const reference of await subjectsFromRead(body.name, args, response)) {
            if (body.name === "resolve_house_link" && reference.kind === "game") games.add(reference.id);
            if (kind === "dm") {
              const key = subjectKey(reference);
              if (reference.replayUrl || !observedSubjects.has(key)) observedSubjects.set(key, reference);
            }
          }
        }
      }
      return response;
    });
    progress.stage = "reply";
    const reply = validatedReply(result);
    if (spoilerDelivery && reply.spoiler.action !== "none") throw new Error("Unexpected spoiler command for delivery");
    if (copyOnly && (!reply.text.trim() || reply.imageRefs.length)) throw new Error("Expected spoiler response text");
    return reply;
  };

  let reply = await generate();
  let spoilerDelivery: SpoilerDelivery | undefined;
  if (reply.spoiler.action !== "none") {
    progress.stage = "spoiler";
    const decision = await decideSpoilerTurn({ action: reply.spoiler.action, game: reply.spoiler.game }, {
      message: m, authority: turn, offer: offers.get(key),
      readTarget: game => readSpoilerTarget(game, turn.grant, api),
      async interpret(game, matchingOffer) {
        const prompt = JSON.stringify({
          currentMemberMessage: current, recentMemberMessages: recent, access: turn.lane, game, matchingOffer,
        });
        return validatedConsent(await runCodex(sandbox, "consent", prompt, [], async () => new Response(null, { status: 403 })));
      },
    });
    if (decision.action === "unavailable") return "spoiler_unavailable";
    if ("target" in decision) games.add(decision.target.gameId);
    if (decision.action === "settled") {
      spoilerDelivery = { action: "settled", game: decision.target.gameId, slug: decision.target.slug };
    } else if (decision.action === "reveal") {
      if (!(await finish())) return "authority_changed";
      progress.stage = "spoiler";
      const grant = await api("turn", { ...params, spoilerGame: decision.target.gameId });
      if (!grant.ok) return "authority_changed";
      const elevated = await grant.json() as Turn;
      if (elevated.link !== turn.link || elevated.lane !== turn.lane) return "authority_changed";
      turn = elevated;
      spoilerDelivery = { action: "authorized", game: decision.target.gameId, slug: decision.target.slug };
    } else if (decision.action === "offer") {
      spoilerDelivery = { action: "offer", game: decision.target.gameId, slug: decision.target.slug };
    } else {
      spoilerDelivery = { action: decision.action };
    }
    reply = await generate(spoilerDelivery);
    if (spoilerDelivery.action === "offer") {
      progress.stage = "spoiler";
      const currentTarget = await readSpoilerTarget(spoilerDelivery.game, turn.grant, api);
      if (currentTarget?.gameId !== spoilerDelivery.game) return "spoiler_unavailable";
      if (currentTarget.settled) {
        spoilerDelivery = { action: "settled", game: currentTarget.gameId, slug: currentTarget.slug };
        reply = await generate(spoilerDelivery);
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
  const prepared = prepareReply(reply.text, house.origin);
  const replyLinks = await finish(prepared.links);
  if (!replyLinks) return "authority_changed";
  progress.stage = "delivery";
  const liveRoomSpoiler = spoilerDelivery?.action === "authorized" && kind === "room";
  const sent = await send(m, prepared.render(replyLinks), images, liveRoomSpoiler);
  if (!sent) return "empty_reply";
  if (spoilerDelivery?.action === "offer") {
    if (!snowflake.test(sent)) return "spoiler_unavailable";
    offers.set(key, { game: spoilerDelivery.game, member: m.author.id, channel: m.channel_id, link: turn.link, lane: turn.lane,
      reply: sent, expires: Date.now() + 5 * 60_000 });
    return "spoiler_offered";
  }
  if (spoilerDelivery?.action === "ask_explicitly" || spoilerDelivery?.action === "offer_pending") return "spoiler_not_authorized";
  if (spoilerDelivery?.action === "authorized" && offers.get(key)?.game === spoilerDelivery.game) offers.delete(key);
  if (kind === "dm" && snowflake.test(sent)) {
    const subject = reply.subject.kind === "none" ? undefined : observedSubjects.get(subjectKey(reply.subject));
    history.set(key, {
      channel: m.channel_id, member: m.author.id, link: turn.link, lane: turn.lane,
      entries: [...prior, { messageId: m.id, memberText: current, replyId: sent, subject, expires: Date.now() + 15 * 60_000 }].slice(-4),
    });
  }
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
  for (const [key, value] of history) if (value.entries.every(entry => entry.expires <= now)) history.delete(key);
}, 60_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => {
  closing = true;
  activeSocket?.close();
  if (!draining) process.exit(0);
});
connect();
