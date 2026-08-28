import { asc, eq } from "drizzle-orm";
import type { GameExecutionStateV1 } from "@influence/engine";
import type { SupportedRecoveryResumeInput } from "./game-recovery-support.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  adoptDurableGameRunOwner,
  adoptPreDurableGameRunOwner,
  adoptUninitializedDurableGameRunOwner,
  relinquishDurableGameRunOwner,
} from "./game-ownership.js";
import { getSupportedDurableActiveGameUpgrade } from "./game-recovery.js";

export interface StartAdoptedDurableGameInput {
  gameId: string;
  ownerEpoch: string;
  executionState: GameExecutionStateV1 | null;
  upgradeFrom?: SupportedRecoveryResumeInput;
  signal?: AbortSignal;
}

export type StartAdoptedDurableGame = (
  input: StartAdoptedDurableGameInput,
) => Promise<void> | void;

export type DurableGameStartupSkipReason =
  | "already_running"
  | "missing_execution_state"
  | "repair_required"
  | "adoption_conflict"
  | "start_failed";

export interface DurableGameStartupResult {
  scanned: number;
  adopted: string[];
  skipped: Array<{
    gameId: string;
    reason: DurableGameStartupSkipReason;
    detail?: string;
  }>;
}

/**
 * Restart every current-contract in-progress game from its committed program
 * counter. Ordinary reloads never change the game to suspended and never ask a
 * phase-coordinate allowlist whether the game may continue.
 */
export async function adoptInProgressDurableGamesOnStartup(
  db: DrizzleDB,
  options: {
    start: StartAdoptedDurableGame;
    signal?: AbortSignal;
    processId?: string;
    isAlreadyRunning?: (gameId: string) => boolean;
  },
): Promise<DurableGameStartupResult> {
  const rows = await db.select({
    gameId: schema.games.id,
    executionGameId: schema.gameExecutionStates.gameId,
    executionStatus: schema.gameExecutionStates.status,
  }).from(schema.games)
    .leftJoin(
      schema.gameExecutionStates,
      eq(schema.gameExecutionStates.gameId, schema.games.id),
    )
    .where(eq(schema.games.status, "in_progress"))
    .orderBy(asc(schema.games.id));

  const adopted: string[] = [];
  const skipped: DurableGameStartupResult["skipped"] = [];
  const startClaimedGame = async (
    gameId: string,
    claim: { ownerEpoch: string; executionState: GameExecutionStateV1 | null },
    upgradeFrom?: SupportedRecoveryResumeInput,
  ): Promise<void> => {
    try {
      await options.start({
        gameId,
        ownerEpoch: claim.ownerEpoch,
        executionState: claim.executionState,
        ...(upgradeFrom && { upgradeFrom }),
        ...(options.signal && { signal: options.signal }),
      });
      adopted.push(gameId);
    } catch (error) {
      await relinquishDurableGameRunOwner(
        db,
        gameId,
        claim.ownerEpoch,
        "restart_start_failed",
      );
      skipped.push({
        gameId,
        reason: "start_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  for (const row of rows) {
    options.signal?.throwIfAborted();
    if (options.isAlreadyRunning?.(row.gameId)) {
      skipped.push({ gameId: row.gameId, reason: "already_running" });
      continue;
    }
    if (!row.executionGameId) {
      const claim = await adoptUninitializedDurableGameRunOwner(db, row.gameId, {
        ...(options.processId && { processId: options.processId }),
      });
      if (!claim.ok) {
        if (claim.code === "nonempty_frontier") {
          const upgrade = await getSupportedDurableActiveGameUpgrade(db, row.gameId);
          if (upgrade.ok) {
            const upgradeClaim = await adoptPreDurableGameRunOwner(
              db,
              row.gameId,
              upgrade.resumeFrom.lastEventSequence,
              { ...(options.processId && { processId: options.processId }) },
            );
            if (upgradeClaim.ok) {
              await startClaimedGame(row.gameId, upgradeClaim.claim, upgrade.resumeFrom);
              continue;
            }
            skipped.push({
              gameId: row.gameId,
              reason: "adoption_conflict",
              detail: upgradeClaim.error,
            });
            continue;
          }
        }
        skipped.push({
          gameId: row.gameId,
          reason: "missing_execution_state",
          detail: claim.error,
        });
        continue;
      }
      await startClaimedGame(row.gameId, claim.claim);
      continue;
    }
    if (row.executionStatus === "repair_required") {
      skipped.push({ gameId: row.gameId, reason: "repair_required" });
      continue;
    }
    const claim = await adoptDurableGameRunOwner(db, row.gameId, {
      ...(options.processId && { processId: options.processId }),
    });
    if (!claim.ok) {
      skipped.push({
        gameId: row.gameId,
        reason: claim.code === "missing_execution_state"
          ? "missing_execution_state"
          : claim.code === "invalid_execution_state"
            ? "repair_required"
            : "adoption_conflict",
        detail: claim.error,
      });
      continue;
    }

    await startClaimedGame(row.gameId, claim.claim);
  }

  return { scanned: rows.length, adopted, skipped };
}
