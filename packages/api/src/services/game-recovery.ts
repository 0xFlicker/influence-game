import { and, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import {
  evaluateSupportedRecovery,
  type SupportedRecoveryResumeInput,
} from "./game-recovery-support.js";

export type SupportedRecoveryResult =
  | {
      ok: true;
      gameId: string;
      checkpointOwnerEpoch: string;
      resumeFrom: SupportedRecoveryResumeInput;
    }
  | {
      ok: false;
      gameId: string;
      reason: string;
    };

export async function findStartupRecoverableGameIds(db: DrizzleDB): Promise<string[]> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.status, "suspended"))
    .orderBy(desc(schema.games.startedAt), desc(schema.games.createdAt));
  const gameIds = rows.map((row) => row.id);
  if (gameIds.length === 0) return [];
  const sealedSettlements = await db
    .select({ gameId: schema.gameCompletionSettlements.gameId })
    .from(schema.gameCompletionSettlements)
    .where(inArray(schema.gameCompletionSettlements.gameId, gameIds));
  const sealedGameIds = new Set(sealedSettlements.map((row) => row.gameId));
  const owners = await db
    .select({
      gameId: schema.gameRunOwners.gameId,
      failureReason: schema.gameRunOwners.failureReason,
    })
    .from(schema.gameRunOwners)
    .where(inArray(schema.gameRunOwners.gameId, gameIds))
    .orderBy(desc(schema.gameRunOwners.createdAt));
  const latestFailureByGame = new Map<string, string | null>();
  for (const owner of owners) {
    if (!latestFailureByGame.has(owner.gameId)) {
      latestFailureByGame.set(owner.gameId, owner.failureReason);
    }
  }
  return gameIds.filter((gameId) => (
    !sealedGameIds.has(gameId)
    &&
    latestFailureByGame.get(gameId) !== "competition_settlement_repair_required"
  ));
}

export async function getSupportedRecovery(
  db: DrizzleDB,
  gameId: string,
): Promise<SupportedRecoveryResult> {
  const game = (await db
    .select({ status: schema.games.status })
    .from(schema.games)
    .where(eq(schema.games.id, gameId)))[0];

  if (!game) {
    return { ok: false, gameId, reason: "game_not_found" };
  }
  if (game.status !== "suspended") {
    return { ok: false, gameId, reason: `unsupported_game_status:${game.status}` };
  }

  const sealedSettlement = (await db
    .select({ state: schema.gameCompletionSettlements.state })
    .from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId))
    .limit(1))[0];
  if (sealedSettlement) {
    return {
      ok: false,
      gameId,
      reason: `completion_settlement_${sealedSettlement.state}`,
    };
  }

  const latestOwner = (await db
    .select({ failureReason: schema.gameRunOwners.failureReason })
    .from(schema.gameRunOwners)
    .where(eq(schema.gameRunOwners.gameId, gameId))
    .orderBy(desc(schema.gameRunOwners.createdAt))
    .limit(1))[0];
  if (latestOwner?.failureReason === "competition_settlement_repair_required") {
    return { ok: false, gameId, reason: latestOwner.failureReason };
  }

  const checkpoints = await db
    .select({
      ownerEpoch: schema.gameCheckpoints.ownerEpoch,
      lastEventSequence: schema.gameCheckpoints.lastEventSequence,
      checkpointKind: schema.gameCheckpoints.checkpointKind,
      actorCoordinate: schema.gameCheckpoints.actorCoordinate,
      snapshot: schema.gameCheckpoints.snapshot,
      tokenCostCursor: schema.gameCheckpoints.tokenCostCursor,
    })
    .from(schema.gameCheckpoints)
    .where(and(
      eq(schema.gameCheckpoints.gameId, gameId),
      eq(schema.gameCheckpoints.checkpointKind, "phase_boundary"),
    ))
    .orderBy(desc(schema.gameCheckpoints.lastEventSequence), desc(schema.gameCheckpoints.createdAt));

  if (checkpoints.length === 0) {
    return { ok: false, gameId, reason: "missing_checkpoint" };
  }

  const persisted = await getPersistedGameEvents(db, gameId);
  let firstFailureReason: string | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.checkpointKind !== "phase_boundary") {
      firstFailureReason ??= `unsupported_checkpoint_kind:${checkpoint.checkpointKind}`;
      continue;
    }
    const evaluated = evaluateSupportedRecovery({
      gameStatus: game.status,
      checkpoint,
      persistedEvents: persisted,
    });
    if (!evaluated.ok) {
      firstFailureReason ??= evaluated.reason;
      continue;
    }

    return {
      ok: true,
      gameId,
      checkpointOwnerEpoch: checkpoint.ownerEpoch,
      resumeFrom: evaluated.resumeFrom,
    };
  }

  return { ok: false, gameId, reason: firstFailureReason ?? "missing_supported_checkpoint" };
}
