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
  return { recent: context.slice(-12), repliedTo: context.find(message => message.id === directReplyId(current)) };
}

export function directReplyId(message: DiscordMessage) {
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

export interface TurnAuthority { link: string; lane: "room" | "owner" | "staff" }
interface ConversationAuthority extends TurnAuthority { channel: string; member: string }

function sameConversation(binding: ConversationAuthority, message: DiscordMessage, authority: TurnAuthority) {
  return binding.channel === message.channel_id && binding.member === message.author.id
    && binding.link === authority.link && binding.lane === authority.lane;
}

const subjectKinds = ["game", "player", "agent", "season"] as const;
export interface Subject { kind: typeof subjectKinds[number]; id: string }
export const subjectKey = ({ kind, id }: Subject) => `${kind}:${id}`;

function subject(kind: Subject["kind"], id: unknown): Subject[] {
  return typeof id === "string" && gameReference.test(id) ? [{ kind, id }] : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function textResult(response: Pick<Response, "ok" | "json">) {
  if (!response.ok) return {};
  try {
    const result = record(await response.json());
    if (result.isError === true || !Array.isArray(result.content) || result.content.length !== 1) return {};
    const item = record(result.content[0]);
    return item.type === "text" && typeof item.text === "string" ? record(JSON.parse(item.text)) : {};
  } catch {
    return {};
  }
}

const subjectTools = new Set(["read_game", "read_results", "list_games", "read_player", "read_agent", "read_season"]);

/** Keep selectors from typed House results, with no excerpts, media, or turn grants. */
export async function subjectsFromRead(name: unknown, args: unknown, response: Response) {
  if (typeof name !== "string" || !subjectTools.has(name)) return [];
  const result = await textResult(response.clone());
  const games = (items: unknown) => Array.isArray(items) ? items.flatMap(game => subject("game", record(game).id)) : [];
  switch (name) {
    case "read_game": return subject("game", record(result.game).id);
    case "read_results": return subject("game", record(record(result.result).game).id);
    case "list_games": return games(result.games);
    case "read_player": return result.status === "found" ? subject("player", record(record(result.profile).identity).publicId) : [];
    case "read_agent": {
      const id = record(args).agent;
      return record(result.publicProfile).status === "found" || record(result.profile).id === id ? subject("agent", id) : [];
    }
    case "read_season": return [...subject("season", record(result.season).id), ...games(result.publicGames)];
    default: return [];
  }
}

type HouseApi = (action: string, body: object) => Promise<Response>;
export async function revalidateDmSubject(reference: Subject, grant: string, api: HouseApi) {
  try {
    if (reference.kind === "game") {
      const response = await api("validate", { grant, games: [reference.id] });
      return response.ok && record(await response.json()).valid === true;
    }
    const name = `read_${reference.kind}`;
    const args = { [reference.kind]: reference.id };
    const response = await api("mcp", { grant, method: "tools/call", name, args });
    return (await subjectsFromRead(name, args, response)).some(found => subjectKey(found) === subjectKey(reference));
  } catch {
    return false;
  }
}

export interface DmEntry {
  messageId: string;
  memberText: string;
  replyId: string;
  subject?: Subject;
  expires: number;
}

export interface DmHistory extends ConversationAuthority { entries: DmEntry[] }

export function availableDmHistory(history: DmHistory | undefined, message: DiscordMessage, authority: TurnAuthority, now = Date.now()) {
  if (!history || !sameConversation(history, message, authority)) return [];
  return history.entries.filter(entry => entry.expires > now);
}

export async function dmContext(entries: DmEntry[], message: DiscordMessage, allows: (reference: Subject) => Promise<boolean>) {
  const earlier = entries.filter(entry => BigInt(entry.replyId) < BigInt(message.id));
  const subjects = new Map(earlier.reverse().flatMap(({ subject }) => subject ? [[subjectKey(subject), subject] as const] : []));
  await Promise.all([...subjects].map(async ([key, reference]) => {
    if (!(await allows(reference))) subjects.delete(key);
  }));
  const available = earlier.reverse().filter(entry => !entry.subject || subjects.has(subjectKey(entry.subject)));
  const parentId = directReplyId(message);
  const direct = parentId && available.find(entry => entry.replyId === parentId || entry.messageId === parentId);
  return {
    memberMessages: available.map(entry => entry.memberText),
    recentSubjects: [...subjects.values()].reverse(),
    repliedTo: direct ? {
      speaker: direct.replyId === parentId ? "house" : "requesting_member",
      memberMessage: direct.memberText,
      subject: direct.subject,
    } : undefined,
  };
}

export interface Reply {
  text: string;
  imageRefs: string[];
  spoiler: { action: "none" | "offer" | "authorize"; game: string };
  subject: Subject | { kind: "none"; id: "" };
}
export const replySchema = {
  type: "object", additionalProperties: false, required: ["text", "imageRefs", "spoiler", "subject"],
  properties: {
    text: { type: "string" },
    imageRefs: { type: "array", items: { type: "string" } },
    spoiler: {
      type: "object", additionalProperties: false, required: ["action", "game"],
      properties: { action: { type: "string", enum: ["none", "offer", "authorize"] }, game: { type: "string" } },
    },
    subject: {
      type: "object", additionalProperties: false, required: ["kind", "id"],
      properties: { kind: { type: "string", enum: ["none", ...subjectKinds] }, id: { type: "string" } },
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
  if (Object.keys(r).length !== 4) throw new Error("Invalid reply");
  if (typeof r.text !== "string" || !Array.isArray(r.imageRefs) || r.imageRefs.length > 2
      || !r.imageRefs.every(x => typeof x === "string" && x.length <= 2048)
      || !r.spoiler || Object.keys(r.spoiler).length !== 2 || typeof r.spoiler.game !== "string" || !["none", "offer", "authorize"].includes(r.spoiler.action)
      || (r.spoiler.action !== "none" && !gameReference.test(r.spoiler.game))
      || !r.subject || Object.keys(r.subject).length !== 2 || typeof r.subject.id !== "string"
      || (r.subject.kind === "none" ? r.subject.id !== "" : !subjectKinds.includes(r.subject.kind) || !gameReference.test(r.subject.id))) {
    throw new Error("Invalid reply");
  }
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

export interface SpoilerOffer extends ConversationAuthority { game: string; reply: string; expires: number }
export function activeOffer(offer: SpoilerOffer | undefined, m: DiscordMessage, authority: TurnAuthority, now = Date.now()) {
  if (!offer || offer.expires <= now || !sameConversation(offer, m, authority)) return undefined;
  return !m.message_reference || directReplyId(m) === offer.reply ? offer : undefined;
}

export async function revalidateSpoilerOffer(offer: SpoilerOffer | undefined, grant: string, api: HouseApi) {
  if (!offer) return undefined;
  try {
    const response = await api("spoiler", { grant, game: offer.game });
    if (!response.ok) return undefined;
    const target = record(await response.json());
    return target.gameId === offer.game && target.settled === false && offer.expires > Date.now() ? offer : undefined;
  } catch {
    return undefined;
  }
}

export function spoilerOfferText(lane: TurnAuthority["lane"], slug: string) {
  if (lane === "owner") return "Shall I reveal saved thinking from your own agents in **" + slug + "**? It may contain live Werewolf spoilers.";
  const question = "Shall I open the Omniscient view for **" + slug + "**?";
  return lane === "room" ? question + " The answer will be visible to this room." : question;
}
