import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { isEmailLike } from "../lib/display-name.js";
import {
  isUuidShapedPublicIdentity,
  normalizePublicPlayerHandle,
  validatePublicPlayerHandle,
} from "../lib/public-player-identity.js";

export const PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH = 36;

export interface PublicPlayerIdentityRef {
  publicId: string;
  handle: string | null;
  displayName: string;
}

export interface ResolvedPublicPlayer {
  internalUserId: string;
  identity: PublicPlayerIdentityRef;
  career: {
    rating: number;
    gamesPlayed: number;
    wins: number;
    peakRating: number;
  };
}

type ParsedPublicPlayerIdentifier =
  | { kind: "public_id"; value: string }
  | { kind: "handle"; value: string };

export function parsePublicPlayerIdentifier(
  identifier: string,
): ParsedPublicPlayerIdentifier | null {
  if (
    identifier.length < 1
    || identifier.length > PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH
  ) {
    return null;
  }
  if (isUuidShapedPublicIdentity(identifier)) {
    return { kind: "public_id", value: identifier };
  }

  const normalized = normalizePublicPlayerHandle(identifier);
  const validation = validatePublicPlayerHandle(normalized);
  return validation.ok
    ? { kind: "handle", value: validation.handle }
    : null;
}

export async function resolvePublicPlayer(
  db: DrizzleDB,
  identifier: string,
): Promise<ResolvedPublicPlayer | null> {
  const parsed = parsePublicPlayerIdentifier(identifier);
  if (!parsed) return null;

  const row = (await db.select({
    id: schema.users.id,
    publicId: schema.users.publicId,
    handle: schema.users.handle,
    walletAddress: schema.users.walletAddress,
    email: schema.users.email,
    displayName: schema.users.displayName,
    rating: schema.users.rating,
    gamesPlayed: schema.users.gamesPlayed,
    gamesWon: schema.users.gamesWon,
    peakRating: schema.users.peakRating,
  }).from(schema.users).where(
    parsed.kind === "public_id"
      ? eq(schema.users.publicId, parsed.value)
      : eq(schema.users.handle, parsed.value),
  ).limit(1))[0];

  if (!row || isImportedSyntheticPlayer(row.walletAddress)) return null;
  return {
    internalUserId: row.id,
    identity: {
      publicId: row.publicId,
      handle: row.handle,
      displayName: publicPlayerDisplayName(row),
    },
    career: {
      rating: row.rating,
      gamesPlayed: row.gamesPlayed,
      wins: row.gamesWon,
      peakRating: row.peakRating,
    },
  };
}

/**
 * Imported simulation users are currently identified by their synthetic
 * `wallet_address` prefix. Keep that private truth source centralized so a
 * future import marker replaces one policy seam instead of many public reads.
 */
export function isImportedSyntheticPlayer(
  walletAddress: string | null | undefined,
): boolean {
  return walletAddress?.toLowerCase().startsWith("imported-") ?? false;
}

export function publicPlayerDisplayName(input: {
  displayName: string | null | undefined;
  email: string | null | undefined;
  walletAddress: string | null | undefined;
}): string {
  const displayName = input.displayName?.trim();
  if (!displayName || isEmailLike(displayName)) return "Anonymous";

  const normalized = displayName.toLowerCase();
  if (
    normalized === "player"
    || normalized === input.email?.trim().toLowerCase()
    || normalized === input.walletAddress?.trim().toLowerCase()
    || normalized === walletPlaceholder(input.walletAddress)?.toLowerCase()
  ) {
    return "Anonymous";
  }
  return displayName;
}

function walletPlaceholder(
  walletAddress: string | null | undefined,
): string | null {
  if (!walletAddress) return null;
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}
