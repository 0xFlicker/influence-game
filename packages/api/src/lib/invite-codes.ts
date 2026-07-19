/**
 * Invite code utilities.
 */

import { eq, and, isNull } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export type InviteCodeReadExecutor = Pick<DrizzleDB, "select">;
export type InviteCodeExecutor = Pick<DrizzleDB, "select" | "update">;

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
export async function isInviteRequired(db: InviteCodeReadExecutor): Promise<boolean> {
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
  db: InviteCodeExecutor,
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

  const redeemed = await db.update(schema.inviteCodes)
    .set({
      usedById: userId,
      usedAt: new Date().toISOString(),
    })
    .where(and(
      eq(schema.inviteCodes.id, codeRow.id),
      isNull(schema.inviteCodes.usedById),
    ))
    .returning({ id: schema.inviteCodes.id });

  return redeemed.length === 1;
}
