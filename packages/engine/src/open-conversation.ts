import { createHash } from "node:crypto";
import Ajv from "ajv";
import { DEFAULT_CONVERSATION_POLICY } from "./conversation-policy";

export interface ConversationPolicy { bytesPerParticipant: number; messageBytes: number; maxHandoffs: number }
/** Private operational state only. Dialogue bodies remain in the accepted transcript. */
export interface ConversationState {
  order: string[];
  remainingBytes: number;
  messageBytes: number;
  maxHandoffs: number;
  offers: number;
  lastOffered: Record<string, number>;
  nextActorId: string;
  previousSpeakerId: string | null;
  /** Consecutive directed handoffs between the current pair; a new recipient starts a new pair. */
  handoffs: number;
  silentIds: string[];
  unavailableIds: string[];
  ended: boolean;
}
/** Actor-safe view: never includes private offers, passes, or foreign-room progress. */
export interface ConversationPrompt {
  participants: Array<{ id: string; name: string }>;
  remainingBytes: number;
  messageBytes: number;
  legalRecipientIds: string[];
  redirect: boolean;
  warnFinalHandoff: boolean;
  messages: Array<{ id: number; from: string; text: string }>;
  movement: "none" | "optional" | "only";
}
export interface ConversationResponse {
  message?: string | null;
  noReply?: boolean;
  recipientId?: string | null;
  replyToContributionId?: number | null;
  providerAbsence?: unknown;
}
export function conversationPolicy(value: ConversationPolicy = DEFAULT_CONVERSATION_POLICY): ConversationPolicy {
  if (Object.keys(value).sort().join() !== "bytesPerParticipant,maxHandoffs,messageBytes"
    || !Object.values(value).every(n => Number.isSafeInteger(n) && n > 0)
    || value.messageBytes > 4096 || value.bytesPerParticipant > 10000 || value.maxHandoffs !== 3) throw new Error("Invalid conversation policy");
  return { ...value };
}
export function beginConversation(ids: readonly string[], seed: string, policy?: ConversationPolicy): ConversationState {
  const p = conversationPolicy(policy);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Conversation requires distinct participants");
  const rank = (id: string) => createHash("sha256").update(JSON.stringify([seed, id])).digest("hex");
  const order = [...ids].sort((a,b) => rank(a).localeCompare(rank(b)));
  return { order, remainingBytes: p.bytesPerParticipant * ids.length, messageBytes: p.messageBytes, maxHandoffs: p.maxHandoffs,
    offers: 0, lastOffered: {}, nextActorId: order[0]!, previousSpeakerId: null, handoffs: 0,
    silentIds: [], unavailableIds: [], ended: ids.length < 2 || p.bytesPerParticipant * ids.length < p.messageBytes };
}
export function conversationPrompt(state: ConversationState, participants: ConversationPrompt["participants"],
  messages: Array<{ from: string; text: string }>, movement: ConversationPrompt["movement"] = "none"): ConversationPrompt {
  const redirect = state.order.length > 2 && state.handoffs === state.maxHandoffs;
  return { participants, remainingBytes: state.remainingBytes, messageBytes: state.messageBytes,
    legalRecipientIds: state.order.filter(id => id !== state.nextActorId && !(redirect && id === state.previousSpeakerId)),
    redirect, warnFinalHandoff: state.order.length > 2 && state.handoffs === state.maxHandoffs - 1,
    messages: messages.map((m,i) => ({ id: i + 1, ...m })), movement };
}
export function advanceConversation(previous: ConversationState, actorId: string, response: ConversationResponse): ConversationState {
  if (previous.ended || actorId !== previous.nextActorId) throw new Error("Conversation actor does not match its accepted cursor");
  const state = structuredClone(previous);
  const text = response.providerAbsence || response.noReply ? null : response.message;
  const bytes = text == null ? 0 : Buffer.byteLength(text, "utf8");
  if (text != null && (!text.trim() || bytes > state.messageBytes)) throw new Error("Invalid conversation speech size");
  const recipient = response.recipientId ?? null;
  if (recipient !== null && (!text || !state.order.includes(recipient) || recipient === actorId
    || state.order.length > 2 && state.handoffs === state.maxHandoffs && recipient === state.previousSpeakerId)) throw new Error("Invalid conversation recipient");
  state.lastOffered[actorId] = ++state.offers;
  if (text) { state.remainingBytes -= bytes; state.silentIds = []; state.unavailableIds = []; }
  else { if (!state.silentIds.includes(actorId)) state.silentIds.push(actorId); if (response.providerAbsence && !state.unavailableIds.includes(actorId)) state.unavailableIds.push(actorId); }
  state.ended = state.remainingBytes < state.messageBytes || state.silentIds.length === state.order.length;
  if (text && recipient) {
    state.nextActorId = recipient;
    state.handoffs = state.order.length === 2 ? 0 : recipient === state.previousSpeakerId ? state.handoffs + 1 : 1;
  } else {
    state.nextActorId = [...state.order].sort((a,b) => (state.lastOffered[a] ?? -1) - (state.lastOffered[b] ?? -1))[0]!;
    state.handoffs = 0;
  }
  state.previousSpeakerId = actorId;
  return state;
}
const natural = { type: "integer", minimum: 0 };
const ids = { type: "array", minItems: 0, maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1 } };
export const conversationStateSchema = {
  type: "object", additionalProperties: false,
  properties: { order: { ...ids, minItems: 1 }, remainingBytes: natural, messageBytes: { type: "integer", minimum: 1, maximum: 4096 },
    maxHandoffs: { const: 3 }, offers: natural, lastOffered: { type: "object", maxProperties: 100, additionalProperties: natural },
    nextActorId: { type: "string" }, previousSpeakerId: { type: ["string", "null"] }, handoffs: { type: "integer", minimum: 0, maximum: 3 },
    silentIds: ids, unavailableIds: ids, ended: { type: "boolean" } },
  required: ["order", "remainingBytes", "messageBytes", "maxHandoffs", "offers", "lastOffered", "nextActorId", "previousSpeakerId", "handoffs", "silentIds", "unavailableIds", "ended"],
};
const validateShape = new Ajv().compile<ConversationState>(conversationStateSchema);
export function validateConversationState(value: unknown): string[] {
  if (!validateShape(value)) return ["Invalid conversation cursor shape"];
  if (!value.order.includes(value.nextActorId) || value.previousSpeakerId !== null && !value.order.includes(value.previousSpeakerId)
    || [...value.silentIds, ...value.unavailableIds, ...Object.keys(value.lastOffered)].some(id => !value.order.includes(id))
    || value.unavailableIds.some(id => !value.silentIds.includes(id))
    || Object.values(value.lastOffered).some(n => n > value.offers)
    || value.ended !== (value.order.length < 2 || value.remainingBytes < value.messageBytes || value.silentIds.length === value.order.length)) return ["Inconsistent conversation cursor"];
  return [];
}

/** Only actual accepted participant speech is eligible for spectator huddle delivery. */
export function isSpectatorHuddleSpeech(entry: { scope: string; text: string; speakerPlayerId?: string | null; dialogueKind?: string | null;
  dialogueContext?: { sessionId?: string; sessionAudiencePlayerIds?: readonly string[] } | null }): boolean {
  return entry.scope === "huddle" && entry.dialogueKind === "huddle_speech" && Boolean(entry.text.trim()
    && entry.speakerPlayerId && entry.dialogueContext?.sessionId && entry.dialogueContext.sessionAudiencePlayerIds?.includes(entry.speakerPlayerId));
}

/** Stable session identity derived from the accepted private selection. */
export function huddleSessionId(scheduleId: string): string {
  const digest = createHash("sha256").update(JSON.stringify(["alliance-huddle-session-v1", scheduleId])).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
