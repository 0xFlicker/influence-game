export const snowflake = /^[0-9]{17,20}$/;
export const gameReference = /^[A-Za-z0-9_-]{1,128}$/;

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  webhook_id?: string;
  type: number;
  content: string;
  author: { id: string; username?: string; bot?: boolean; system?: boolean };
  message_reference?: { message_id?: string; channel_id?: string; type?: number };
}

export function roomContext(current: DiscordMessage, messages: DiscordMessage[], botId: string | undefined) {
  const cutoff = discordMessageTime(current.id) - 30 * 60_000;
  const seen = new Set<string>();
  const context = messages.flatMap(message => {
    if (!message || message.channel_id !== current.channel_id || message.webhook_id
      || (message.type !== 0 && message.type !== 19) || !message.author || message.author.system
      || !snowflake.test(message.id) || BigInt(message.id) >= BigInt(current.id)
      || discordMessageTime(message.id) < cutoff || seen.has(message.id)
      || typeof message.content !== "string" || !message.content.trim()) return [];
    const house = message.author.id === botId;
    if (message.author.bot && !house) return [];
    seen.add(message.id);
    return [{ id: message.id,
      speaker: house ? "house" : message.author.id === current.author.id ? "requesting_member" : "room_member",
      text: message.content.slice(0, 1200) }];
  }).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  return { recent: context.slice(-12), repliedTo: context.find(message => message.id === roomReplyId(current)) };
}

export function roomReplyId(message: DiscordMessage) {
  const ref = message.message_reference;
  if (!ref || ref.channel_id !== message.channel_id || (ref.type !== undefined && ref.type !== 0)
    || !ref.message_id || !snowflake.test(ref.message_id) || BigInt(ref.message_id) >= BigInt(message.id)) return undefined;
  return ref.message_id;
}

export function discordMessageTime(id: string) {
  return Number((BigInt(id) >> 22n) + 1420070400000n);
}

export function destination(m: DiscordMessage, guild: string, room: string) {
  if (!m || (m.type !== 0 && m.type !== 19) || m.webhook_id || !m.author || m.author.bot || m.author.system
      || !snowflake.test(m.id) || !snowflake.test(m.channel_id) || !snowflake.test(m.author.id) || !m.content?.trim()) return null;
  if (m.guild_id === guild && m.channel_id === room) return "room" as const;
  if (!m.guild_id) return "dm" as const;
  return null;
}

export interface Reply {
  text: string;
  imageRefs: string[];
  spoiler: { action: "none" | "offer" | "authorize"; game: string };
}
export const replySchema = {
  type: "object", additionalProperties: false, required: ["text", "imageRefs", "spoiler"],
  properties: {
    text: { type: "string" },
    imageRefs: { type: "array", items: { type: "string" } },
    spoiler: {
      type: "object", additionalProperties: false, required: ["action", "game"],
      properties: { action: { type: "string", enum: ["none", "offer", "authorize"] }, game: { type: "string" } },
    },
  },
};
export const consentSchema = {
  type: "object", additionalProperties: false, required: ["allowed"],
  properties: { allowed: { type: "boolean" } },
};

export function validatedReply(value: unknown): Reply {
  if (!value || typeof value !== "object") throw new Error("Invalid reply");
  const r = value as Partial<Reply>;
  if (Object.keys(r).length !== 3) throw new Error("Invalid reply");
  if (typeof r.text !== "string" || !Array.isArray(r.imageRefs) || r.imageRefs.length > 2
      || !r.imageRefs.every(x => typeof x === "string" && x.length <= 2048)
      || !r.spoiler || Object.keys(r.spoiler).length !== 2 || typeof r.spoiler.game !== "string" || !["none", "offer", "authorize"].includes(r.spoiler.action)
      || (r.spoiler.action !== "none" && !gameReference.test(r.spoiler.game))) throw new Error("Invalid reply");
  return r as Reply;
}

export function validatedConsent(value: unknown) {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 1
      || !("allowed" in value) || typeof value.allowed !== "boolean") throw new Error("Invalid spoiler decision");
  return value.allowed;
}

export function safeReply(content: string, origin: string) {
  return content.replace(/\[([^\[\]\r\n]+)\]\((https?:\/\/[^\s<>\])]+)\)|https?:\/\/[^\s<>\])]+/gi, (link, label?: string, destination?: string) => {
    try {
      const u = new URL(destination ?? link);
      const path = /^\/games\/[A-Za-z0-9_-]+(?:\/(?:replay|results))?$/.test(u.pathname)
        || /^\/(agents|profile)\/[A-Za-z0-9_-]+$/.test(u.pathname);
      const season = u.pathname === "/seasons" && /^\?season=[A-Za-z0-9_-]+$/.test(u.search);
      if (u.origin === origin && ((path && !u.search) || season) && !u.hash && !u.username && !u.password) {
        return label === undefined ? u.href : "[" + label + "](" + u.href + ")";
      }
    } catch { /* Malformed URLs are removed below. */ }
    return label?.replace(/https?:\/\/[^\s<>\])]+/gi, "") || "[link removed]";
  }).trim().slice(0, 1900);
}

export async function withTurnFeedback<T>(
  discord: (path: string, init: RequestInit) => Promise<Response>,
  message: Pick<DiscordMessage, "id" | "channel_id">,
  reply: () => Promise<T>,
) {
  const channel = "/channels/" + message.channel_id;
  const reaction = channel + "/messages/" + message.id + "/reactions/" + encodeURIComponent("👀") + "/@me";
  const typing = new AbortController();
  async function signal(path: string, method: "POST" | "PUT" | "DELETE", cancel?: AbortSignal) {
    const deadline = AbortSignal.timeout(2500);
    try {
      const response = await discord(path, { method, signal: cancel ? AbortSignal.any([cancel, deadline]) : deadline });
      if (!response.ok && response.status !== 404) {
        console.log(JSON.stringify({ event: "discord_feedback_failed", method, status: response.status }));
      }
      return response.ok;
    } catch {
      if (!cancel?.aborted) console.log(JSON.stringify({ event: "discord_feedback_failed", method }));
      return undefined;
    }
  }
  let pending: Promise<void> | undefined;
  const refresh = () => {
    if (pending) return;
    pending = signal(channel + "/typing", "POST", typing.signal).then(() => { pending = undefined; });
  };
  refresh();
  const timer = setInterval(refresh, 7000);
  const acknowledged = signal(reaction, "PUT");
  try {
    return await reply();
  } finally {
    clearInterval(timer);
    typing.abort();
    if (await acknowledged !== false) await signal(reaction, "DELETE");
  }
}

export interface SpoilerOffer { game: string; channel: string; member: string; link: string; reply: string; expires: number }
export function activeOffer(offer: SpoilerOffer | undefined, m: DiscordMessage, link: string, now = Date.now()) {
  if (!offer || offer.expires <= now || offer.channel !== m.channel_id || offer.member !== m.author.id || offer.link !== link) return undefined;
  const repliedTo = m.message_reference?.message_id;
  return !repliedTo || repliedTo === offer.reply ? offer : undefined;
}
