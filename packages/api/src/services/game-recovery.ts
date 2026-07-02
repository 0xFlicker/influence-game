import { and, desc, eq } from "drizzle-orm";
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
  return rows.map((row) => row.id);
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
