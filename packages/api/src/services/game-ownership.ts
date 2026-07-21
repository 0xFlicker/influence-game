import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  OwnedSeatProjectionError,
  projectWaitingOwnedRosterInTransaction,
} from "./owned-seat-projection.js";
import {
  freezeWaitingRosterInTransaction,
  toRosterFreezeError,
  type RosterFreezeErrorCode,
  type RosterFreezeErrorReason,
} from "./roster-freeze.js";
import {
  FORMAL_SPEECH_CAPTURE_VERSION,
  initialGameTranscriptStateValues,
  TRANSCRIPT_CAPTURE_VERSION,
} from "./transcript-capture.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

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

export type OwnerStartupFailureResult =
  | { rosterDisposition: "reconciled" }
  | {
      rosterDisposition: "repair_required";
      reconciliationError: {
        message: string;
        code?: string;
        reason?: string;
      };
    };

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
        .select({
          status: schema.games.status,
          transcriptCaptureVersion: schema.games.transcriptCaptureVersion,
          formalSpeechCaptureVersion: schema.games.formalSpeechCaptureVersion,
        })
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

      const captureUpgrade = await bootstrapTranscriptCaptureAtFirstStart(tx, gameId, game);
      if (!captureUpgrade.ok) {
        return {
          ok: false as const,
          error: captureUpgrade.error,
          statusCode: 400 as const,
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
    const freezeError = toRosterFreezeError(error);
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

type FirstStartCaptureGame = {
  transcriptCaptureVersion: number;
  formalSpeechCaptureVersion: number;
};

/**
 * Locked first-start only: upgrade a pre-deployment waiting game to current
 * transcript/formal-speech capture versions when absence checks prove no
 * gameplay, transcript, checkpoint, run owner, settlement, or result exists.
 * Ambiguous waiting records fail start rather than becoming live version-0 games.
 */
async function bootstrapTranscriptCaptureAtFirstStart(
  tx: DrizzleTransaction,
  gameId: string,
  game: FirstStartCaptureGame,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const currentTranscript = game.transcriptCaptureVersion === TRANSCRIPT_CAPTURE_VERSION;
  const currentFormal = game.formalSpeechCaptureVersion === FORMAL_SPEECH_CAPTURE_VERSION;

  if (currentTranscript && currentFormal) {
    // Ensure state row exists for current-capture games created before state stamping.
    const existingState = (await tx
      .select({ gameId: schema.gameTranscriptStates.gameId })
      .from(schema.gameTranscriptStates)
      .where(eq(schema.gameTranscriptStates.gameId, gameId))
      .limit(1))[0];
    if (!existingState) {
      await tx.insert(schema.gameTranscriptStates).values(
        initialGameTranscriptStateValues(gameId, TRANSCRIPT_CAPTURE_VERSION),
      );
    }
    return { ok: true };
  }

  // Partial / non-zero non-current versions are ambiguous — fail closed.
  if (
    game.transcriptCaptureVersion !== 0
    || game.formalSpeechCaptureVersion !== 0
  ) {
    return {
      ok: false,
      error:
        "Game capture versions are incomplete or unsupported for start; refuse to upgrade ambiguous waiting game",
    };
  }

  const evidence = await loadPreStartCaptureEvidence(tx, gameId);
  if (evidence.hasAny) {
    return {
      ok: false,
      error:
        "Pre-deployment waiting game has prior gameplay, transcript, checkpoint, run, settlement, or result evidence; refuse capture upgrade",
    };
  }

  await tx.update(schema.games)
    .set({
      transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
      formalSpeechCaptureVersion: FORMAL_SPEECH_CAPTURE_VERSION,
    })
    .where(eq(schema.games.id, gameId));

  await tx.insert(schema.gameTranscriptStates).values(
    initialGameTranscriptStateValues(gameId, TRANSCRIPT_CAPTURE_VERSION),
  );

  return { ok: true };
}

async function loadPreStartCaptureEvidence(
  tx: DrizzleTransaction,
  gameId: string,
): Promise<{ hasAny: boolean }> {
  const [eventRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameEvents)
    .where(eq(schema.gameEvents.gameId, gameId));
  const [transcriptRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.transcripts)
    .where(eq(schema.transcripts.gameId, gameId));
  const [checkpointRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameCheckpoints)
    .where(eq(schema.gameCheckpoints.gameId, gameId));
  const [ownerRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameRunOwners)
    .where(eq(schema.gameRunOwners.gameId, gameId));
  const [settlementRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId));
  const [resultRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameResults)
    .where(eq(schema.gameResults.gameId, gameId));
  const [stateRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.gameTranscriptStates)
    .where(eq(schema.gameTranscriptStates.gameId, gameId));

  const counts = [
    eventRow?.n ?? 0,
    transcriptRow?.n ?? 0,
    checkpointRow?.n ?? 0,
    ownerRow?.n ?? 0,
    settlementRow?.n ?? 0,
    resultRow?.n ?? 0,
    stateRow?.n ?? 0,
  ];
  return { hasAny: counts.some((n) => n > 0) };
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
): Promise<OwnerStartupFailureResult> {
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

    const owner = (await tx.select({
      status: schema.gameRunOwners.status,
      lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
    }).from(schema.gameRunOwners).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
    )).for("update"))[0];
    if (owner?.status !== "active" || owner.lastPersistedEventSequence !== 0) {
      throw new GameOwnerTransitionError(
        `Owner epoch ${ownerEpoch} is no longer the active pre-play startup owner.`,
        "stale_owner",
      );
    }

    const firstEvent = (await tx.select({ sequence: schema.gameEvents.sequence })
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId))
      .limit(1))[0];
    const settlement = (await tx.select({ id: schema.gameCompletionSettlements.id })
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId))
      .limit(1))[0];
    if (firstEvent || settlement) {
      throw new GameOwnerTransitionError(
        `Owner epoch ${ownerEpoch} has durable game state and cannot return to waiting.`,
        "stale_owner",
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
  });

  try {
    await db.transaction((tx) => projectWaitingOwnedRosterInTransaction(tx, gameId, {
      allowHouseNameCollisions: true,
    }));
    return { rosterDisposition: "reconciled" };
  } catch (error) {
    return {
      rosterDisposition: "repair_required",
      reconciliationError: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof OwnedSeatProjectionError && {
          code: error.code,
          reason: error.reason,
        }),
      },
    };
  }
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
