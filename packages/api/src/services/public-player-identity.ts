import { eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { isEmailLike } from "../lib/display-name.js";
import {
  isUuidShapedPublicIdentity,
  normalizePublicPlayerHandle,
  validatePublicPlayerHandle,
} from "../lib/public-player-identity.js";

export const PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH = 36;
export const PUBLIC_PLAYER_IDENTITY_BATCH_MAX_SIZE = 500;

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

type PublicPlayerIdentityRow = {
  id: string;
  publicId: string;
  handle: string | null;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
};

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
 * Resolves internal user IDs to safe public identities in one bounded query.
 *
 * Internal IDs remain Map keys for caller-side joins and never become part of
 * a serialized response. Imported users and accounts without a safe public
 * display name are deliberately omitted so callers render their snapshot copy
 * as plain text.
 */
export async function getPublicPlayerIdentityMap(
  db: DrizzleDB,
  internalUserIds: readonly string[],
): Promise<Map<string, PublicPlayerIdentityRef>> {
  const uniqueIds = [...new Set(internalUserIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  if (uniqueIds.length > PUBLIC_PLAYER_IDENTITY_BATCH_MAX_SIZE) {
    throw new RangeError(
      `Public player identity batches are limited to ${PUBLIC_PLAYER_IDENTITY_BATCH_MAX_SIZE} users`,
    );
  }

  const rows = await db.select({
    id: schema.users.id,
    publicId: schema.users.publicId,
    handle: schema.users.handle,
    walletAddress: schema.users.walletAddress,
    email: schema.users.email,
    displayName: schema.users.displayName,
  }).from(schema.users).where(inArray(schema.users.id, uniqueIds));

  const identities = new Map<string, PublicPlayerIdentityRef>();
  for (const row of rows) {
    const identity = publicPlayerLinkIdentity(row);
    if (identity) identities.set(row.id, identity);
  }
  return identities;
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
  if (
    !displayName
    || isEmailLike(displayName)
    || isWalletAddress(displayName)
    || isWalletPlaceholder(displayName)
  ) {
    return "Anonymous";
  }

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

export function publicPlayerLinkIdentity(
  input: PublicPlayerIdentityRow,
): PublicPlayerIdentityRef | null {
  if (isImportedSyntheticPlayer(input.walletAddress)) return null;
  const displayName = publicPlayerDisplayName(input);
  if (displayName === "Anonymous") return null;
  return {
    publicId: input.publicId,
    handle: input.handle,
    displayName,
  };
}

function walletPlaceholder(
  walletAddress: string | null | undefined,
): string | null {
  if (!walletAddress) return null;
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function isWalletAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(value);
}

function isWalletPlaceholder(value: string): boolean {
  return /^0x[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/i.test(value);
}
