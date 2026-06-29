import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export interface GameOwnerClaim {
  ownerEpoch: string;
}

export type GameOwnerClaimResult =
  | { ok: true; claim: GameOwnerClaim }
  | { ok: false; error: string; statusCode: 400 | 404 | 409 };

const DEFAULT_OWNER_LEASE_MS = 10 * 60 * 1000;

function ownerExpiresAt(now: Date, leaseMs = DEFAULT_OWNER_LEASE_MS): string {
  return new Date(now.getTime() + leaseMs).toISOString();
}

export async function acquireGameRunOwner(
  db: DrizzleDB,
  gameId: string,
  options: { processId?: string; leaseMs?: number } = {},
): Promise<GameOwnerClaimResult> {
  const now = new Date();
  const ownerEpoch = randomUUID();
  const ownerId = randomUUID();

  try {
    const claim = await db.transaction(async (tx) => {
      const updated = await tx.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: now.toISOString(),
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "waiting")))
        .returning({ id: schema.games.id });

      if (updated.length === 0) {
        const existing = (await tx
          .select({ status: schema.games.status })
          .from(schema.games)
          .where(eq(schema.games.id, gameId)))[0];
        if (!existing) {
          return { ok: false as const, error: "Game not found", statusCode: 404 as const };
        }
        return {
          ok: false as const,
          error: existing.status === "in_progress"
            ? "Game is already running"
            : "Game can only be started from waiting status",
          statusCode: existing.status === "in_progress" ? 409 as const : 400 as const,
        };
      }

      await tx.insert(schema.gameRunOwners)
        .values({
          id: ownerId,
          gameId,
          ownerEpoch,
          processId: options.processId ?? process.pid.toString(),
          expiresAt: ownerExpiresAt(now, options.leaseMs),
        });

      return { ok: true as const, claim: { ownerEpoch } };
    });
    return claim;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to acquire game owner",
      statusCode: 409,
    };
  }
}

export async function acquireRecoveryGameRunOwner(
  db: DrizzleDB,
  gameId: string,
  checkpointEventSequence: number,
  options: { processId?: string; leaseMs?: number } = {},
): Promise<GameOwnerClaimResult> {
  const now = new Date();
  const ownerEpoch = randomUUID();
  const ownerId = randomUUID();

  try {
    const claim = await db.transaction(async (tx) => {
      const game = (await tx
        .select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];

      if (!game) {
        return { ok: false as const, error: "Game not found", statusCode: 404 as const };
      }
      if (game.status !== "suspended") {
        return {
          ok: false as const,
          error: "Game can only be recovered from suspended status",
          statusCode: game.status === "in_progress" ? 409 as const : 400 as const,
        };
      }

      const activeOwner = (await tx
        .select({ ownerEpoch: schema.gameRunOwners.ownerEpoch })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, gameId),
          eq(schema.gameRunOwners.status, "active"),
        ))
        .limit(1))[0];
      if (activeOwner) {
        return { ok: false as const, error: "Game already has an active owner", statusCode: 409 as const };
      }

      await tx.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: now.toISOString(),
          endedAt: null,
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "suspended")));

      await tx.insert(schema.gameRunOwners)
        .values({
          id: ownerId,
          gameId,
          ownerEpoch,
          processId: options.processId ?? process.pid.toString(),
          expiresAt: ownerExpiresAt(now, options.leaseMs),
          lastPersistedEventSequence: checkpointEventSequence,
        });

      return { ok: true as const, claim: { ownerEpoch } };
    });
    return claim;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to acquire recovery owner",
      statusCode: 409,
    };
  }
}

export async function markOwnerStartupFailed(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.update(schema.gameRunOwners)
      .set({
        status: "closed",
        closedAt: now,
        kernelHealth: "degraded",
        failureReason: errorMessage,
      })
      .where(and(
        eq(schema.gameRunOwners.gameId, gameId),
        eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
        eq(schema.gameRunOwners.status, "active"),
      ));

    await tx.update(schema.games)
      .set({ status: "waiting", startedAt: null })
      .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "in_progress")));
  });
}

export async function assertOwnerActive(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
): Promise<void> {
  const owner = (await db
    .select({
      status: schema.gameRunOwners.status,
      expiresAt: schema.gameRunOwners.expiresAt,
    })
    .from(schema.gameRunOwners)
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
    )))[0];

  if (!owner) {
    throw new Error(`No durable owner for game ${gameId}`);
  }
  if (owner.status !== "active") {
    throw new Error(`Owner epoch ${ownerEpoch} is ${owner.status}`);
  }
  if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
    throw new Error(`Owner epoch ${ownerEpoch} expired`);
  }
}

export async function renewGameRunOwner(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  options: { leaseMs?: number } = {},
): Promise<void> {
  await assertOwnerActive(db, gameId, ownerEpoch);
  const now = new Date();
  const updated = await db.update(schema.gameRunOwners)
    .set({
      heartbeatAt: now.toISOString(),
      expiresAt: ownerExpiresAt(now, options.leaseMs),
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    ))
    .returning({ ownerEpoch: schema.gameRunOwners.ownerEpoch });
  if (updated.length === 0) {
    throw new Error(`Owner epoch ${ownerEpoch} could not be renewed`);
  }
}

export async function revokeActiveGameRunOwner(
  db: DrizzleDB,
  gameId: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.update(schema.gameRunOwners)
    .set({
      status: "revoked",
      revokedAt: now,
      kernelHealth: "suspended",
      failureReason: reason,
    })
    .where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.status, "active")));
}

export async function closeGameRunOwner(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
): Promise<void> {
  const now = new Date().toISOString();
  const updated = await db.update(schema.gameRunOwners)
    .set({
      status: "closed",
      closedAt: now,
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    ))
    .returning({ ownerEpoch: schema.gameRunOwners.ownerEpoch });
  if (updated.length === 0) {
    throw new Error(`Owner epoch ${ownerEpoch} could not be closed`);
  }
}

export async function markGameSuspended(
  db: DrizzleDB,
  gameId: string,
  reason: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.update(schema.gameRunOwners)
      .set({
        status: "expired",
        closedAt: now,
        kernelHealth: "suspended",
        failureReason: reason,
        failureDetails: details,
      })
      .where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.status, "active")));

    await tx.update(schema.games)
      .set({
        status: "suspended",
        endedAt: now,
      })
      .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "in_progress")));
  });
}
