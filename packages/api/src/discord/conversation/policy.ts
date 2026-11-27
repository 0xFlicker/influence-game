export const snowflake = /^[0-9]{17,20}$/;
export const gameReference = /^[A-Za-z0-9_-]{1,128}$/;
export const discordContentLimit = 2000;
const legacyRoomSpoilerHeading = "**Live Werewolf spoiler for this room.**";
const attachmentSpoilerFlag = 1 << 3;
const newline = /\r\n?|\n/;

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  webhook_id?: string;
  type: number;
  content: string;
  author: { id: string; username?: string; bot?: boolean; system?: boolean };
  attachments?: Array<{ flags?: number }>;
  message_reference?: { message_id?: string; channel_id?: string; type?: number };
}

type RoomMessage = { id: string } & (
  | { speaker: "house" | "requesting_member" | "room_member"; text: string; disclosure?: never }
  | { speaker: "house"; disclosure: "live_werewolf_spoiler"; text?: never }
);

function containsHouseDisclosure(message: DiscordMessage) {
  if (Array.isArray(message.attachments) && message.attachments.some(attachment =>
    typeof attachment?.flags === "number" && Boolean(attachment.flags & attachmentSpoilerFlag))) return true;
  const lines = message.content.split(newline).filter(line => line.trim());
  // The old heading is recognized only when reading historical House messages.
  return lines[0] === legacyRoomSpoilerHeading || lines.length > 0
    && lines.every(line => line.length > 4 && line.startsWith("||") && line.endsWith("||"));
}

export function roomContext(current: DiscordMessage, messages: DiscordMessage[], botId: string | undefined) {
  const cutoff = discordMessageTime(current.id) - 30 * 60_000;
  const seen = new Set<string>();
  const context = messages.flatMap<RoomMessage>(message => {
    if (!message || message.channel_id !== current.channel_id || message.webhook_id
      || (message.type !== 0 && message.type !== 19) || !message.author || message.author.system
      || !snowflake.test(message.id) || BigInt(message.id) >= BigInt(current.id)
      || discordMessageTime(message.id) < cutoff || seen.has(message.id)
      || typeof message.content !== "string") return [];
    const house = message.author.id === botId;
    if (message.author.bot && !house) return [];
    const liveReveal = house && containsHouseDisclosure(message);
    if (!liveReveal && !message.content.trim()) return [];
    seen.add(message.id);
    if (liveReveal) return [{ id: message.id, speaker: "house", disclosure: "live_werewolf_spoiler" }];
    return [{ id: message.id,
      speaker: house ? "house" : message.author.id === current.author.id ? "requesting_member" : "room_member",
      text: message.content }];
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
export interface Subject { kind: typeof subjectKinds[number]; id: string; replayUrl?: string }
export const subjectKey = ({ kind, id }: Subject) => `${kind}:${id}`;
const historySubjectKey = (reference: Subject) => `${subjectKey(reference)}:${reference.replayUrl ?? ""}`;

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

const subjectTools = new Set(["resolve_house_link", "read_game", "read_results", "list_games", "read_player", "read_agent", "read_season"]);

/** Keep selectors from typed House results, with no excerpts, media, or turn grants. */
export async function subjectsFromRead(name: unknown, args: unknown, response: Response) {
  if (typeof name !== "string" || !subjectTools.has(name)) return [];
  const result = await textResult(response.clone());
  const games = (items: unknown) => Array.isArray(items) ? items.flatMap(game => subject("game", record(game).id)) : [];
  switch (name) {
    case "resolve_house_link": {
      if (result.status !== "found") return [];
      if (result.kind === "player" || result.kind === "agent" || result.kind === "game") {
        return subject(result.kind, result.reference);
      }
      const replayUrl = result.url;
      if (result.kind === "replay" && typeof replayUrl === "string" && replayUrl.length <= 2048) {
        return subject("game", result.reference).map(reference => ({ ...reference, replayUrl }));
      }
      return [];
    }
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
      const replayUrl = reference.replayUrl;
      const response = await api("validate", { grant, games: [reference.id], ...(replayUrl && { links: [replayUrl] }) });
      if (!response.ok) return false;
      const result = record(await response.json());
      return result.valid === true && (!replayUrl || Array.isArray(result.links) && result.links.includes(replayUrl));
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
  replyIds: string[];
  subject?: Subject;
  expires: number;
}

export interface DmHistory extends ConversationAuthority { entries: DmEntry[] }

export function availableDmHistory(history: DmHistory | undefined, message: DiscordMessage, authority: TurnAuthority, now = Date.now()) {
  if (!history || !sameConversation(history, message, authority)) return [];
  return history.entries.filter(entry => entry.expires > now);
}

export async function dmContext(entries: DmEntry[], message: DiscordMessage, allows: (reference: Subject) => Promise<boolean>) {
  const currentId = BigInt(message.id);
  const earlier = entries.filter(entry => entry.replyIds.some(id => BigInt(id) < currentId));
  const subjects = new Map<string, Subject>();
  for (const { subject } of earlier) {
    if (!subject) continue;
    subjects.delete(historySubjectKey(subject));
    subjects.set(historySubjectKey(subject), subject);
  }
  await Promise.all([...subjects].map(async ([key, reference]) => {
    if (!(await allows(reference))) subjects.delete(key);
  }));
  const available = earlier.filter(entry => !entry.subject || subjects.has(historySubjectKey(entry.subject)));
  const parentId = directReplyId(message);
  const direct = parentId && available.find(entry => entry.messageId === parentId || entry.replyIds.includes(parentId));
  return {
    memberMessages: available.map(entry => entry.memberText),
    recentSubjects: [...subjects.values()],
    repliedTo: direct ? {
      speaker: direct.messageId === parentId ? "requesting_member" : "house",
      memberMessage: direct.memberText,
      subject: direct.subject,
    } : undefined,
  };
}

export interface Reply {
  messages: string[];
  imageRefs: string[];
  spoiler: { action: "none" | "offer" | "authorize"; game: string };
  subject: Subject | { kind: "none"; id: "" };
}
export const replySchema = {
  type: "object", additionalProperties: false, required: ["messages", "imageRefs", "spoiler", "subject"],
  properties: {
    messages: { type: "array", items: { type: "string" } },
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
const consentIntents = ["none", "direct", "matching_offer"] as const;
type ConsentIntent = typeof consentIntents[number];
export const consentSchema = {
  type: "object", additionalProperties: false, required: ["intent"],
  properties: { intent: { type: "string", enum: consentIntents } },
};

export function validatedReply(value: unknown): Reply {
  if (!value || typeof value !== "object") throw new Error("Invalid reply");
  const r = value as Partial<Reply>;
  if (Object.keys(r).length !== 4) throw new Error("Invalid reply");
  if (!Array.isArray(r.messages) || !r.messages.every(text => typeof text === "string" && text.trim().length > 0)
      || !Array.isArray(r.imageRefs) || r.imageRefs.length > 2
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
  const parsed = record(value);
  const intent = consentIntents.find(intent => intent === parsed.intent);
  if (Object.keys(parsed).length !== 1 || !intent) throw new Error("Invalid spoiler decision");
  return intent;
}

export function discordReplyContent(text: string, liveRoomSpoiler: boolean) {
  if (!liveRoomSpoiler) return text;
  return text.split(newline).map(line => {
    if (!line.trim()) return line;
    // Keep arbitrary model prose from closing a spoiler or opening code formatting.
    const safe = line.replaceAll("|", "¦").replaceAll("`", "′").replaceAll("\\", "＼");
    return `||${safe}||`;
  }).join("\n");
}

export function discordReplyForm(
  message: Pick<DiscordMessage, "id" | "channel_id">,
  text: string,
  images: Array<{ mimeType: string; data: string }>,
  liveRoomSpoiler: boolean,
  part = 0,
) {
  const content = discordReplyContent(text, liveRoomSpoiler);
  if (content.length > discordContentLimit) throw new RangeError("Discord message is too long");
  if (!content.trim() && !images.length) return null;
  if (!Number.isSafeInteger(part) || part < 0) throw new RangeError("Invalid Discord reply part");
  const nonce = part === 0 ? message.id : `${message.id}:${part.toString(36)}`;
  if (nonce.length > 25) throw new RangeError("Discord reply nonce is too long");
  const filename = (id: number) => `house-${id + 1}.png`;
  const attachments = images.map((_, id) => ({ id, filename: filename(id), ...(liveRoomSpoiler && { is_spoiler: true }) }));
  const payload = {
    content, flags: 4, nonce, enforce_nonce: true,
    allowed_mentions: { parse: [], replied_user: false },
    message_reference: { message_id: message.id, channel_id: message.channel_id, fail_if_not_exists: true },
    ...(attachments.length && { attachments }),
  };
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  images.forEach((image, id) => {
    form.set(`files[${id}]`, new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), filename(id));
  });
  return form;
}

const replyLink = /\[([^\[\]\r\n]+)\]\((https?:\/\/[^\s<>\])]+)\)|https?:\/\/[^\s<>\])]+/gi;
const resourcePaths = new Set(["agents", "games", "profile"]);

export function prepareReply(source: string, origin: string) {
  const links = new Set<string>();
  const parts: Array<string | { label?: string; href: string; needsValidation: boolean }> = [];
  let removedLink = false;
  let offset = 0;
  for (const match of source.matchAll(replyLink)) {
    const start = match.index;
    parts.push(source.slice(offset, start));
    offset = start + match[0].length;

    const [, rawLabel, destination] = match;
    const label = rawLabel?.replace(replyLink, "");
    const raw = destination ?? match[0].replace(/[.,!?]+$/, "");
    const trailing = destination === undefined ? match[0].slice(raw.length) : "";
    const href = URL.canParse(raw) ? new URL(raw) : null;
    if (href?.origin === origin && href.href.length <= 2048 && !href.username && !href.password) {
      const [, section, id] = href.pathname.split("/");
      if (id && section && resourcePaths.has(section)) {
        links.add(href.href);
        parts.push({ label, href: href.href, needsValidation: true });
        if (trailing) parts.push(trailing);
        continue;
      } else if (href.pathname === "/seasons" && /^\?season=[A-Za-z0-9_-]+$/.test(href.search) && !href.hash) {
        parts.push({ label, href: href.href, needsValidation: false });
        if (trailing) parts.push(trailing);
        continue;
      }
    }
    parts.push((label ?? "") + trailing);
    removedLink = true;
  }
  parts.push(source.slice(offset));

  return {
    links: [...links],
    render(allowed: ReadonlySet<string>) {
      let removed = removedLink;
      const text = parts.map(part => {
        if (typeof part === "string") return part;
        if (part.needsValidation && !allowed.has(part.href)) {
          removed = true;
          return part.label ?? "";
        }
        return part.label === undefined ? part.href : `[${part.label}](${part.href})`;
      }).join("");
      return removed ? text.trim() : text;
    },
  };
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
  const parentId = directReplyId(m);
  return !m.message_reference || parentId === offer.reply ? offer : undefined;
}

interface SpoilerTarget { gameId: string; slug: string; settled: boolean }
export async function readSpoilerTarget(game: string, grant: string, api: HouseApi): Promise<SpoilerTarget | undefined> {
  try {
    const response = await api("spoiler", { grant, game });
    if (!response.ok) return undefined;
    const { gameId, slug, settled } = record(await response.json());
    if (typeof gameId === "string" && gameReference.test(gameId) && typeof slug === "string"
      && gameReference.test(slug) && typeof settled === "boolean") return { gameId, slug, settled };
    return undefined;
  } catch {
    return undefined;
  }
}

export async function spoilerOfferContext(offer: SpoilerOffer | undefined, grant: string, api: HouseApi) {
  if (!offer) return undefined;
  const target = await readSpoilerTarget(offer.game, grant, api);
  if (target?.gameId !== offer.game || offer.expires <= Date.now()) return undefined;
  return target.settled ? { settledGame: target.gameId } : { offer };
}

interface SpoilerOptions {
  message: DiscordMessage;
  authority: TurnAuthority;
  offer: SpoilerOffer | undefined;
  readTarget: (game: string) => Promise<SpoilerTarget | undefined>;
  interpret: (target: SpoilerTarget, matchingOffer: boolean) => Promise<ConsentIntent>;
  now?: () => number;
}

type SpoilerDecision = { action: "unavailable" | "ask_explicitly" | "offer_pending" }
  | { action: "settled" | "offer" | "reveal"; target: SpoilerTarget };

export async function decideSpoilerTurn(
  command: { action: "offer" | "authorize"; game: string },
  { message, authority, offer, readTarget, interpret, now = Date.now }: SpoilerOptions,
): Promise<SpoilerDecision> {
  const initial = await readTarget(command.game);
  if (!initial) return { action: "unavailable" };
  if (initial.settled) return { action: "settled", target: initial };
  const outstanding = () => offer?.game === initial.gameId && offer.expires > now() && sameConversation(offer, message, authority);
  if (command.action === "offer") return outstanding() ? { action: "offer_pending" } : { action: "offer", target: initial };

  const matching = () => activeOffer(offer, message, authority, now())?.game === initial.gameId;
  const intent = await interpret(initial, matching());
  const current = await readTarget(initial.gameId);
  if (current?.gameId !== initial.gameId) return { action: "unavailable" };
  if (current.settled) return { action: "settled", target: current };
  if (intent === "direct" || (intent === "matching_offer" && matching())) return { action: "reveal", target: current };
  return outstanding() ? { action: "offer_pending" } : { action: "ask_explicitly" };
}
