import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { projectWaitingOwnedRosterInTransaction } from "./owned-seat-projection.js";
import {
  asRosterFreezeError,
  freezeWaitingRosterInTransaction,
  RosterFreezeError,
  type RosterFreezeErrorCode,
  type RosterFreezeErrorReason,
} from "./roster-freeze.js";

export interface GameOwnerClaim {
  ownerEpoch: string;
}

export type GameOwnerClaimResult =
  | { ok: true; claim: GameOwnerClaim }
  | {
    ok: false;
    error: string;
    statusCode: 400 | 404 | 409;
    code?: RosterFreezeErrorCode;
    reason?: RosterFreezeErrorReason;
    retryable?: boolean;
  };

const DEFAULT_OWNER_LEASE_MS = 10 * 60 * 1000;

export class GameOwnerTransitionError extends Error {
  constructor(
    message: string,
    public readonly code: "stale_owner" | "invalid_state",
  ) {
    super(message);
    this.name = "GameOwnerTransitionError";
  }
}

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
      const game = (await tx
        .select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .for("update"))[0];
      if (!game) {
        return { ok: false as const, error: "Game not found", statusCode: 404 as const };
      }
      if (game.status !== "waiting") {
        return {
          ok: false as const,
          error: game.status === "in_progress"
            ? "Game is already running"
            : "Game can only be started from waiting status",
          statusCode: game.status === "in_progress" ? 409 as const : 400 as const,
        };
      }

      await freezeWaitingRosterInTransaction(tx, {
        gameId,
        frozenAt: now.toISOString(),
      });
      const updated = await tx.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: now.toISOString(),
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "waiting")))
        .returning({ id: schema.games.id });

      if (updated.length === 0) throw new GameOwnerTransitionError(
        "Game start state changed while the roster was freezing.",
        "invalid_state",
      );

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
    let freezeError: RosterFreezeError | null = null;
    try {
      freezeError = asRosterFreezeError(error);
    } catch {
      // Non-freeze owner and persistence failures retain the legacy result.
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to acquire game owner",
      statusCode: freezeError?.code === "rated_roster_invalid"
        ? 400
        : 409,
      ...(freezeError && {
        code: freezeError.code,
        reason: freezeError.reason,
        retryable: false,
      }),
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
        .where(eq(schema.games.id, gameId))
        .for("update"))[0];

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

      const updated = await tx.update(schema.games)
        .set({
          status: "in_progress",
          startedAt: now.toISOString(),
          endedAt: null,
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "suspended")))
        .returning({ id: schema.games.id });

      if (updated.length === 0) {
        return { ok: false as const, error: "Game recovery state changed", statusCode: 409 as const };
      }

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
    const game = (await tx.select({ status: schema.games.status }).from(schema.games)
      .where(eq(schema.games.id, gameId)).for("update"))[0];
    if (!game || game.status !== "in_progress") {
      throw new GameOwnerTransitionError(
        "The game is no longer in an owned startup state.",
        "invalid_state",
      );
    }
    const closed = await tx.update(schema.gameRunOwners)
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
        eq(schema.gameRunOwners.lastPersistedEventSequence, 0),
      ))
      .returning({ ownerEpoch: schema.gameRunOwners.ownerEpoch });
    if (closed.length !== 1) {
      throw new GameOwnerTransitionError(
        `Owner epoch ${ownerEpoch} is no longer the active pre-play startup owner.`,
        "stale_owner",
      );
    }

    const returned = await tx.update(schema.games)
      .set({ status: "waiting", startedAt: null })
      .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "in_progress")))
      .returning({ id: schema.games.id });
    if (returned.length !== 1) {
      throw new GameOwnerTransitionError(
        "The game is no longer in the startup state owned by this epoch.",
        "invalid_state",
      );
    }
    await tx.delete(schema.competitionRatingSnapshots)
      .where(eq(schema.competitionRatingSnapshots.gameId, gameId));
    await projectWaitingOwnedRosterInTransaction(tx, gameId, {
      allowHouseNameCollisions: true,
    });
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
