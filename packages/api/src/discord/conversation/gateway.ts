import { Database } from "bun:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  activeOffer, availableDmHistory, decideSpoilerTurn, destination, directReplyId, discordAnnouncementContent, discordAnnouncementPayload,
  discordContentLimit, discordMessageTime,
  discordReplyAttachmentByteLimit, discordReplyAttachmentLimit, discordReplyContent, discordReplyForm, discordReplyMultipartByteLimit,
  dmContext, prepareReply, readAnnouncementJob, readSpoilerTarget, ReplyValidationError, revalidateDmSubject, roomContext, snowflake, spoilerOfferContext,
  subjectKey, subjectsFromRead, validatedConsent, validatedReply, withTurnFeedback,
  type AnnouncementJob, type DiscordMessage, type DmHistory, type ReplyValidationReason, type SpoilerOffer, type Subject, type TurnAuthority,
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
const announcementChannel = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || undefined;
if (![guild, room, memberRole].every(id => snowflake.test(id)) || (announcementChannel && !snowflake.test(announcementChannel))) {
  throw new Error("Invalid Discord configuration");
}
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
let checkingAnnouncements = false;
let closing = false;
let activeSocket: WebSocket | undefined;
let readySocket: WebSocket | undefined;
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
  if (!channel.ok) {
    if (accessDenied(channel.status)) return false;
    throw new Error("Discord could not check the conversation");
  }
  const data = await channel.json() as { id: string; type: number; guild_id?: string; recipients?: Array<{ id: string }> };
  if (data.id !== m.channel_id || (kind === "room" ? data.type !== 0 || data.guild_id !== guild
    : data.type !== 1 || data.recipients?.length !== 1 || data.recipients[0]?.id !== m.author.id)) return false;
  const member = await discord("/guilds/" + guild + "/members/" + m.author.id);
  if (!member.ok) {
    if (accessDenied(member.status)) return false;
    throw new Error("Discord could not check membership");
  }
  const roles = await member.json() as { pending?: boolean; roles?: string[]; user?: { id: string } };
  return roles.user?.id === m.author.id && roles.pending !== true && roles.roles?.includes(memberRole) === true;
}

function accessDenied(status: number) {
  return status === 401 || status === 403 || status === 404;
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
  return roomContext(m, messages, botId, house.origin);
}

class TurnAccessDenied extends Error {}
class DiscordAttachmentLimitError extends Error {}

async function send(m: DiscordMessage, content: string, images: Array<{ mimeType: string; data: string }>, liveRoomSpoiler: boolean, part: number | "error") {
  const form = discordReplyForm(m, content, images, liveRoomSpoiler, part);
  if (!form) return null;
  const request: RequestInit = { method: "POST", body: form };
  if (images.length) {
    for (const id of images.keys()) {
      const file: unknown = form.get(`files[${id}]`);
      if (!(file instanceof Blob) || !file.size || file.size > discordReplyAttachmentByteLimit) {
        throw new DiscordAttachmentLimitError();
      }
    }
    const multipart = new Response(form);
    const contentType = multipart.headers.get("content-type");
    if (!contentType) throw new Error("Discord upload encoding unavailable");
    const body = await multipart.blob();
    if (body.size > discordReplyMultipartByteLimit) throw new DiscordAttachmentLimitError();
    request.body = body;
    request.headers = { "content-type": contentType };
  }
  const response = await discord("/channels/" + m.channel_id + "/messages", request);
  if (!response.ok) {
    const rejection = await response.json().catch(() => null) as { code?: unknown } | null;
    console.log(JSON.stringify({
      event: "discord_delivery_rejected", status: response.status,
      code: typeof rejection?.code === "number" ? rejection.code : null,
    }));
    if (accessDenied(response.status)) throw new TurnAccessDenied();
    throw new Error("Discord rejected the reply");
  }
  const { id } = await response.json() as { id?: unknown };
  if (typeof id !== "string" || !snowflake.test(id)) throw new Error("Discord did not confirm the reply");
  return id;
}

function noReplyTools(body: Record<string, unknown>) {
  return Promise.resolve(body.method === "tools/list" ? Response.json({ tools: [] }) : new Response(null, { status: 403 }));
}

type AnnouncementReceipt = { outcome: "posted"; messageId: string } | { outcome: "retry" | "failed" | "unconfirmed" };

function announcementReady(socket: WebSocket | undefined) {
  return !closing && !!botId && socket !== undefined && socket === readySocket && socket.readyState === WebSocket.OPEN;
}

async function writeAnnouncement(job: AnnouncementJob) {
  const draft = async (correction?: ReplyValidationReason) => {
    const prompt = JSON.stringify({ gameAnnouncement: { kind: job.kind, facts: job.facts, canonicalLink: job.url, correction } });
    const authored = await runCodex(sandbox, "reply", prompt, [], noReplyTools, 40_000);
    return discordAnnouncementContent(authored, job.kind, job.url);
  };
  try {
    return await draft();
  } catch (error) {
    const correction = error instanceof ReplyValidationError ? error.reason : error instanceof SyntaxError ? "shape" : undefined;
    if (!correction) throw error;
    return draft(correction);
  }
}

async function deliverAnnouncement(job: AnnouncementJob, socket: WebSocket) {
  const binding = { id: job.id, lease: job.lease, channelId: job.channelId };
  let receipt: AnnouncementReceipt | undefined = { outcome: "retry" };
  let stage = "author";
  try {
    const content = await writeAnnouncement(job);
    if (!announcementReady(socket)) return;
    stage = "channel";
    const channel = await discord("/channels/" + job.channelId);
    if (!channel.ok) {
      if (accessDenied(channel.status)) receipt = { outcome: "failed" };
      return;
    }
    const destination = await channel.json() as { id?: unknown; type?: unknown; guild_id?: unknown };
    if (destination.id !== job.channelId || destination.guild_id !== guild || (destination.type !== 0 && destination.type !== 5)) {
      receipt = { outcome: "failed" };
      return;
    }
    if (!announcementReady(socket)) return;

    // A lost begin response can leave a durable send intent. Only a positive response permits the Discord write.
    stage = "begin";
    receipt = { outcome: "unconfirmed" };
    const begin = await api("announcement-begin", binding);
    if (!begin.ok) return;
    const approval = await begin.json() as { authorized?: unknown; nonce?: unknown };
    if (approval.authorized === false) {
      receipt = undefined;
      return;
    }
    if (approval.authorized !== true) return;
    const payload = discordAnnouncementPayload(content, approval.nonce);
    if (!payload) {
      receipt = { outcome: "failed" };
      return;
    }
    stage = "delivery";
    const response = await discord("/channels/" + job.channelId + "/messages", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408) receipt = { outcome: "failed" };
      return;
    }
    const posted = await response.json() as { id?: unknown; channel_id?: unknown };
    if (posted.channel_id === job.channelId && typeof posted.id === "string" && snowflake.test(posted.id)) {
      receipt = { outcome: "posted", messageId: posted.id };
    }
  } catch (error) {
    if (stage === "author" && (error instanceof ReplyValidationError || error instanceof SyntaxError)) receipt = { outcome: "failed" };
  } finally {
    let acknowledged = false;
    if (receipt) {
      try {
        const completed = await api("announcement-complete", { ...binding, ...receipt });
        acknowledged = completed.ok && (await completed.json() as { ok?: unknown }).ok === true;
      } catch {
        // The durable send intent still fences a post when the acknowledgement is lost.
      }
    }
    console.log(JSON.stringify({ event: "discord_announcement", id: job.id, kind: job.kind, stage, outcome: receipt?.outcome ?? "suppressed", acknowledged }));
  }
}

async function checkAnnouncements(channelId: string) {
  const socket = readySocket;
  if (!socket || !announcementReady(socket) || draining || queue.length || checkingAnnouncements) return;
  checkingAnnouncements = true;
  try {
    const response = await api("announcement-claim", { channelId });
    if (!response.ok) {
      console.log(JSON.stringify({ event: "discord_announcement_claim_failed", status: response.status }));
      return;
    }
    const { job: value } = await response.json() as { job?: unknown };
    if (value === null) return;
    const job = readAnnouncementJob(value, channelId, house.origin);
    if (!job) throw new Error("Invalid Discord announcement job");
    // An inbound turn can start while the claim request is in flight. Release this unsent claim by lease expiry.
    if (draining || queue.length || !announcementReady(socket)) return;
    await drain({ job, socket });
  } catch {
    console.log(JSON.stringify({ event: "discord_announcement_claim_failed" }));
  } finally {
    checkingAnnouncements = false;
  }
}

interface Turn extends TurnAuthority { grant: string; publicId: string }
interface TurnBinding { discordId: string; channelId: string; messageId: string; kind: "room" | "dm" }
type SpoilerDelivery =
  | { action: "offer" | "settled" | "authorized"; game: string; slug: string }
  | { action: "offer_pending" | "ask_explicitly" };
function proceduralReply(delivery: SpoilerDelivery | undefined) {
  return delivery?.action === "offer" || delivery?.action === "offer_pending" || delivery?.action === "ask_explicitly";
}
interface TurnProgress {
  stage: "eligibility" | "grant" | "catalog" | "codex" | "reply" | "spoiler" | "attachment" | "revalidate" | "delivery";
}
type ReplyOutcome = "replied" | "spoiler_offered" | "spoiler_not_authorized" | "authority_changed"
  | "spoiler_unavailable" | "reply_over_limit" | "reply_repartition_rejected" | "attachment_unavailable" | "empty_reply";

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
  if (!start.ok) return accessDenied(start.status) ? forget("unavailable") : "unavailable";
  const turn = await start.json() as Turn;
  return withTurnFeedback(discord, m, async () => {
    let result: ReplyOutcome | "reply_validation_failed" | "turn_failed";
    try {
      result = await answer(m, progress, params, turn, key);
    } catch (error) {
      if (error instanceof TurnAccessDenied) {
        result = "authority_changed";
      } else if (error instanceof DiscordAttachmentLimitError) {
        result = "attachment_unavailable";
      } else if (error instanceof ReplyValidationError) {
        console.log(JSON.stringify({ event: "discord_reply_validation", reason: error.reason, outcome: "terminal" }));
        result = "reply_validation_failed";
      } else {
        result = "turn_failed";
      }
    }
    if (result === "replied" || result === "spoiler_offered" || result === "spoiler_not_authorized") return result;
    console.log(JSON.stringify({ event: "discord_turn_failure", stage: progress.stage, reason: result }));
    if (result === "authority_changed") return result;
    return await sendFailureNotice(m, progress, params, turn);
  });
}

async function sendFailureNotice(m: DiscordMessage, progress: TurnProgress, params: TurnBinding, previous: Turn) {
  const unavailable = (reason: "eligibility" | "grant" | "transport") => {
    console.log(JSON.stringify({ event: "discord_failure_notice_unavailable", stage: progress.stage, reason }));
    return "failure_notice_unavailable";
  };
  try {
    progress.stage = "revalidate";
    if (!(await allowed(m, params.kind))) return unavailable("eligibility");
    const fresh = await api("turn", params);
    if (!fresh.ok) return unavailable("grant");
    const current = await fresh.json() as Turn;
    const validLane = params.kind === "room" ? current.lane === "room" : current.lane === "owner" || current.lane === "staff";
    if (typeof current.grant !== "string" || !current.grant || !current.link || !current.publicId || !validLane
        || current.link !== previous.link || current.lane !== previous.lane || current.publicId !== previous.publicId) {
      return unavailable("grant");
    }
    const validation = await api("validate", { grant: current.grant, games: [] });
    if (!validation.ok || (await validation.json() as { valid?: boolean }).valid !== true) return unavailable("grant");
    progress.stage = "delivery";
    await send(m, "The House couldn’t complete this reply.", [], false, "error");
    return "failure_notice";
  } catch {
    return unavailable("transport");
  }
}

async function answer(m: DiscordMessage, progress: TurnProgress, params: TurnBinding, turn: Turn, key: string): Promise<ReplyOutcome> {
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
  const current = m.content;
  const games = new Set<string>();
  if (spoilerContext?.settledGame) games.add(spoilerContext.settledGame);
  const observedSubjects = new Map<string, Subject>();
  const inspected = new Set<string>();
  let recoveryUsed = false;
  const finish = async (links: string[] = []) => {
    progress.stage = "revalidate";
    const checks = await Promise.all([
      allowed(m, kind),
      ...(dmHistory?.recentSubjects ?? []).map(reference => revalidateDmSubject(reference, turn.grant, api)),
    ]);
    if (!checks.every(Boolean)) return null;
    const body = { grant: turn.grant, games: [...games], links: [] as string[] };
    const batches = [body];
    let batch = body;
    for (const link of new Set(links)) {
      const next = { ...body, links: [...batch.links, link] };
      if (next.links.length > 12 || Buffer.byteLength(JSON.stringify(next)) > 8192) {
        batch = { ...body, links: [link] };
        if (Buffer.byteLength(JSON.stringify(batch)) > 8192) throw new Error("House validation request too large");
        batches.push(batch);
      } else {
        batch.links.push(link);
      }
    }
    const approved = new Set<string>();
    for (const batch of batches) {
      const validation = await api("validate", batch);
      if (accessDenied(validation.status)) return null;
      if (!validation.ok) throw new Error("House validation unavailable");
      const result = await validation.json() as { valid?: boolean; links?: string[] };
      if (result.valid === false) return null;
      if (result.valid !== true || !Array.isArray(result.links)) throw new Error("Invalid House validation response");
      const matched = new Set(result.links);
      for (const link of batch.links) if (matched.has(link)) approved.add(link);
    }
    return approved;
  };

  const generate = async (spoilerDelivery?: SpoilerDelivery) => {
    const copyOnly = proceduralReply(spoilerDelivery);
    let toolNames: string[] = [];
    if (!copyOnly) {
      progress.stage = "catalog";
      const tools = await api("mcp", { grant: turn.grant, method: "tools/list" });
      if (accessDenied(tools.status)) throw new TurnAccessDenied();
      if (!tools.ok) throw new Error("House catalog unavailable");
      const catalog = await tools.json() as { tools: Array<{ name: string }> };
      toolNames = catalog.tools.map(tool => tool.name);
    }
    const deliveryContext = {
      conversation: kind, access: turn.lane, spoilerDelivery,
      discordDelivery: { contentLimit: discordContentLimit, liveRoomSpoiler: spoilerDelivery?.action === "authorized" && kind === "room" },
    };
    const conversationContext = copyOnly ? deliveryContext : {
      ...deliveryContext, memberPublicId: turn.publicId, houseOrigin: house.origin,
      activeSpoilerOffer: spoilerDelivery ? undefined : spoilerContext?.offer?.game,
      settledSpoilerGame: spoilerDelivery ? undefined : spoilerContext?.settledGame,
      recentMemberMessages: recent,
      recentRoomMessages: roomHistory?.recent, repliedToRoomMessage: roomHistory?.repliedTo,
      recentDmSubjects: dmHistory?.recentSubjects, repliedToDmMessage: dmHistory?.repliedTo,
      hasExplicitDmReply: kind === "dm" ? Boolean(m.message_reference) : undefined,
      currentMemberMessage: current,
    };
    const maxImageAttachments = copyOnly ? 0 : discordReplyAttachmentLimit;
    const draft = async (reason?: ReplyValidationReason) => {
      observedSubjects.clear();
      inspected.clear();
      const replyCorrection = reason ? { reason, maxImageAttachments } : undefined;
      const prompt = JSON.stringify({ ...conversationContext, replyCorrection });
      progress.stage = "codex";
      const result = await runCodex(sandbox, "reply", prompt, toolNames, async body => {
        if (copyOnly) return noReplyTools(body);
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
      if (spoilerDelivery && reply.spoiler.action !== "none") throw new ReplyValidationError("spoiler");
      if (copyOnly && reply.messages.length !== 1) throw new ReplyValidationError("message");
      if (reply.imageRefs.length > maxImageAttachments) throw new ReplyValidationError("attachment_count");
      if (reply.imageRefs.some(reference => !inspected.has(reference))) throw new ReplyValidationError("attachment_ref");
      return reply;
    };
    try {
      return await draft();
    } catch (error) {
      if (!(error instanceof ReplyValidationError) || recoveryUsed) throw error;
      recoveryUsed = true;
      console.log(JSON.stringify({ event: "discord_reply_validation", reason: error.reason, outcome: "retry", maxImageAttachments }));
      try {
        if (await finish()) return await draft(error.reason);
      } catch (retryError) {
        if (retryError instanceof ReplyValidationError) throw retryError;
      }
      throw error;
    }
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
      if (accessDenied(grant.status)) return "authority_changed";
      if (!grant.ok) return "spoiler_unavailable";
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

  const liveRoomSpoiler = spoilerDelivery?.action === "authorized" && kind === "room";
  const approveMessages = async (messages: string[]) => {
    const prepared = messages.map(text => prepareReply(text, house.origin));
    const links = await finish(prepared.flatMap(part => part.links));
    if (!links) return null;
    const lengths = prepared.map(part => discordReplyContent(part.render(links), liveRoomSpoiler).length);
    return { prepared, links, lengths };
  };
  let delivery = await approveMessages(reply.messages);
  if (!delivery) return "authority_changed";
  if (delivery.lengths.some(length => length > discordContentLimit)) {
    if (proceduralReply(spoilerDelivery)) return "reply_over_limit";
    if (recoveryUsed) throw new ReplyValidationError("message");
    recoveryUsed = true;
    const prompt = JSON.stringify({
      discordRepartition: { messages: reply.messages, measuredLengths: delivery.lengths },
      discordDelivery: { contentLimit: discordContentLimit, liveRoomSpoiler },
    });
    progress.stage = "codex";
    const repaired = validatedReply(await runCodex(sandbox, "reply", prompt, [], noReplyTools));
    progress.stage = "reply";
    const words = (messages: string[]) => messages.join(" ").trim().replace(/\s+/g, " ");
    if (repaired.spoiler.action !== "none" || repaired.imageRefs.length || repaired.subject.kind !== "none"
        || words(repaired.messages) !== words(reply.messages)) return "reply_repartition_rejected";
    delivery = await approveMessages(repaired.messages);
    if (!delivery) return "authority_changed";
    if (delivery.lengths.some(length => length > discordContentLimit)) return "reply_over_limit";
  }

  const images: Array<{ mimeType: string; data: string }> = [];
  progress.stage = "attachment";
  const imageRefs = [...new Set(reply.imageRefs)];
  const concurrentMediaReads = 2;
  for (let offset = 0; offset < imageRefs.length; offset += concurrentMediaReads) {
    const media = await Promise.allSettled(imageRefs.slice(offset, offset + concurrentMediaReads).map(async imageRef => {
      const response = await api("mcp", { grant: turn.grant, method: "tools/call", name: "inspect_image", args: { imageRef } });
      const image = response.ok ? (await response.json() as { content: Array<{ mimeType: string; data: string }> }).content[0] : undefined;
      return { status: response.status, image };
    }));
    if (media.some(read => read.status === "fulfilled" && accessDenied(read.value.status))) return "authority_changed";
    for (const read of media) {
      const image = read.status === "fulfilled" ? read.value.image : undefined;
      if (image?.mimeType !== "image/png" || typeof image.data !== "string" || !image.data) return "attachment_unavailable";
      images.push(image);
    }
  }
  const replyLinks = await finish([...delivery.links]);
  if (!replyLinks) return "authority_changed";
  const replyIds: string[] = [];
  try {
    for (const [partIndex, part] of delivery.prepared.entries()) {
      const links = partIndex === 0 ? replyLinks : await finish(part.links.filter(link => replyLinks.has(link)));
      if (!links) return "authority_changed";
      progress.stage = "delivery";
      const sent = await send(m, part.render(links), replyIds.length ? [] : images, liveRoomSpoiler, partIndex);
      if (sent) replyIds.push(sent);
    }
    if (!delivery.prepared.length && images.length) {
      progress.stage = "delivery";
      const sent = await send(m, "", images, liveRoomSpoiler, 0);
      if (sent) replyIds.push(sent);
    }
  } finally {
    if (kind === "dm" && replyIds.length && !proceduralReply(spoilerDelivery)) {
      const subject = reply.subject.kind === "none" ? undefined : observedSubjects.get(subjectKey(reply.subject));
      history.set(key, {
        channel: m.channel_id, member: m.author.id, link: turn.link, lane: turn.lane,
        entries: [...prior, { messageId: m.id, memberText: current, replyIds, subject, expires: Date.now() + 15 * 60_000 }].slice(-4),
      });
    }
  }
  if (!replyIds.length) return "empty_reply";
  if (spoilerDelivery?.action === "offer") {
    offers.set(key, { game: spoilerDelivery.game, member: m.author.id, channel: m.channel_id, link: turn.link, lane: turn.lane,
      reply: replyIds[0]!, expires: Date.now() + 5 * 60_000 });
    return "spoiler_offered";
  }
  if (spoilerDelivery?.action === "ask_explicitly" || spoilerDelivery?.action === "offer_pending") return "spoiler_not_authorized";
  if (spoilerDelivery?.action === "authorized" && offers.get(key)?.game === spoilerDelivery.game) offers.delete(key);
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

async function drain(announcement?: { job: AnnouncementJob; socket: WebSocket }) {
  draining = true;
  if (announcement) await deliverAnnouncement(announcement.job, announcement.socket);
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
        botId = typeof packet.d.user?.id === "string" && snowflake.test(packet.d.user.id) ? packet.d.user.id : undefined;
        readySocket = botId ? socket : undefined;
        session = packet.d.session_id;
        const url = new URL(packet.d.resume_gateway_url);
        if (url.protocol === "wss:" && url.hostname === "gateway.discord.gg") resumeOrigin = url.origin;
        console.log(JSON.stringify({ event: "discord_gateway_ready" }));
        if (announcementChannel) void checkAnnouncements(announcementChannel);
      } else if (packet.op === 0 && packet.t === "RESUMED") {
        readySocket = botId ? socket : undefined;
        if (announcementChannel) void checkAnnouncements(announcementChannel);
      } else if (packet.op === 0 && packet.t === "MESSAGE_CREATE") accept(packet.d);
    } catch {
      socket.close(4000, "Invalid Gateway payload");
    }
  });
  socket.addEventListener("close", e => {
    if (readySocket === socket) readySocket = undefined;
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

if (announcementChannel) setInterval(() => void checkAnnouncements(announcementChannel), 5_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => {
  closing = true;
  activeSocket?.close();
  if (!draining) process.exit(0);
});
connect();
