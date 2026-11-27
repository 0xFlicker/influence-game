import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { type DrizzleDB } from "../db/index.js";
import { resolveDiscordLinkedAccount } from "../services/discord-verification.js";
import { HouseInspectionError } from "../services/house-game-access.js";

export const discordIdPattern = /^[0-9]{17,20}$/;
export const referencePattern = /^[A-Za-z0-9_-]{1,128}$/;
const grantLifetime = 180_000;

export interface DiscordTurn {
  discordId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  kind: "room" | "dm";
  spoilerGame?: string;
}
export interface DiscordGrant extends DiscordTurn {
  connectionId: string;
  userId: string;
  publicId: string;
  lane: "room" | "owner" | "staff";
  expires: number;
}

export function discordUnavailable(): never {
  throw new HouseInspectionError("not_accessible", "Unavailable in this conversation");
}

function referenceKey(secret: string, purpose: string) {
  return createHmac("sha256", secret).update("house-discord-v1:").update(purpose).digest();
}

type DiscordReferencePurpose = "turn" | "art" | "season-page";

export function signDiscordRef(value: object, secret: string, purpose: DiscordReferencePurpose) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referenceKey(secret, purpose), nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64url");
}

export function verifyDiscordRef(token: string, secret: string, purpose: DiscordReferencePurpose): unknown {
  if (token.length > 2048) return discordUnavailable();
  const data = Buffer.from(token, "base64url");
  if (data.length <= 28 || data.toString("base64url") !== token) return discordUnavailable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", referenceKey(secret, purpose), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()) as unknown;
  } catch {
    return discordUnavailable();
  }
}

export function parseDiscordTurn(input: Record<string, unknown>, guildId: string, roomId: string): DiscordTurn {
  const { discordId, channelId, messageId, kind, spoilerGame } = input;
  if (!discordIdPattern.test(guildId) || !discordIdPattern.test(roomId)
      || typeof discordId !== "string" || !discordIdPattern.test(discordId)
      || typeof channelId !== "string" || !discordIdPattern.test(channelId)
      || typeof messageId !== "string" || !discordIdPattern.test(messageId)
      || (kind !== "dm" && kind !== "room") || (kind === "room") !== (channelId === roomId)
      || (spoilerGame !== undefined && (typeof spoilerGame !== "string" || !referencePattern.test(spoilerGame)))) {
    return discordUnavailable();
  }
  return { discordId, guildId, channelId, messageId, kind, spoilerGame };
}

async function current(db: DrizzleDB, turn: DiscordTurn) {
  const member = await resolveDiscordLinkedAccount(db, turn.discordId, turn.guildId);
  if (!member.connected) return discordUnavailable();
  const staff = member.roles.includes("producer") || member.roles.includes("admin");
  const lane: DiscordGrant["lane"] = turn.kind === "room" ? "room" : staff ? "staff" : "owner";
  return { connectionId: member.connectionId, userId: member.userId, publicId: member.publicId, lane };
}

export async function issueDiscordGrant(db: DrizzleDB, turn: DiscordTurn) {
  return { ...turn, ...await current(db, turn), expires: Date.now() + grantLifetime };
}

export async function assertDiscordGrant(db: DrizzleDB, grant: DiscordGrant) {
  if (grant.expires <= Date.now()) return discordUnavailable();
  const authority = await current(db, grant);
  if (authority.connectionId !== grant.connectionId || authority.userId !== grant.userId
      || authority.publicId !== grant.publicId || authority.lane !== grant.lane) return discordUnavailable();
}
