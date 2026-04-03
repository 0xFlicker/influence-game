/**
 * Invite code utilities.
 */

import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

const INITIAL_INVITE_COUNT = 5;

/**
 * Generate a random 8-character alphanumeric invite code.
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let code = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}

/**
 * Check if invite codes are required for signup.
 */
export async function isInviteRequired(db: DrizzleDB): Promise<boolean> {
  const setting = (await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "invite_required")))[0];
  return setting?.value === "true";
}

/**
 * Validate and consume an invite code for a new user.
 * Returns the code row if valid, null if invalid/used.
 */
export async function redeemInviteCode(
  db: DrizzleDB,
  code: string,
  userId: string,
): Promise<boolean> {
  const normalizedCode = code.trim().toUpperCase();

  const codeRow = (await db
    .select()
    .from(schema.inviteCodes)
    .where(
      and(
        eq(schema.inviteCodes.code, normalizedCode),
        isNull(schema.inviteCodes.usedById),
      ),
    ))[0];

  if (!codeRow) return false;

  await db.update(schema.inviteCodes)
    .set({
      usedById: userId,
      usedAt: new Date().toISOString(),
    })
    .where(eq(schema.inviteCodes.id, codeRow.id));

  return true;
}

/**
 * Grant initial invite codes to a newly registered user.
 */
export async function grantInitialInviteCodes(
  db: DrizzleDB,
  userId: string,
  count: number = INITIAL_INVITE_COUNT,
): Promise<void> {
  const values = Array.from({ length: count }, () => ({
    id: randomUUID(),
    code: generateInviteCode(),
    ownerId: userId,
  }));
  await db.insert(schema.inviteCodes).values(values);
}
