import { asc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  markGameSuspended,
  markOwnerStartupFailed,
  type OwnerStartupFailureResult,
} from "./game-ownership.js";

interface StartupOrphanedGameBase {
  gameId: string;
  startedAt: string | null;
  ageMs: number | null;
}

export interface StartupOrphanedGameReturnedToWaiting extends StartupOrphanedGameBase {
  ownerEpoch: string;
  rosterDisposition: "reconciled";
}

export interface StartupOrphanedGameRepairRequired extends StartupOrphanedGameBase {
  ownerEpoch: string;
  rosterDisposition: "repair_required";
  reconciliationError: Extract<OwnerStartupFailureResult, {
    rosterDisposition: "repair_required";
  }>["reconciliationError"];
}

export type StartupOrphanDiagnosticReason =
  | "sealed_completion_present"
  | "active_owner_missing"
  | "active_owner_ambiguous"
  | "owner_event_epoch_disagreement"
  | "owner_event_head_disagreement"
  | "durable_event_present"
  | "startup_cleanup_conflict";

export interface StartupOrphanedGameSuspension extends StartupOrphanedGameBase {
  reason: StartupOrphanDiagnosticReason;
  details: Record<string, unknown>;
}

export interface StartupOrphanedGameSuspensionResult {
  scanned: number;
  returnedToWaiting: StartupOrphanedGameReturnedToWaiting[];
  repairRequired: StartupOrphanedGameRepairRequired[];
  suspended: StartupOrphanedGameSuspension[];
}

function startedAgeMs(startedAt: string | null, now: Date): number | null {
  if (!startedAt) return null;
  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return null;
  return Math.max(0, now.getTime() - startedAtMs);
}

function cleanupFailureDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    message: error.message,
    ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
  };
}

export async function suspendOrphanedInProgressGamesOnStartup(
  db: DrizzleDB,
  options: { now?: Date } = {},
): Promise<StartupOrphanedGameSuspensionResult> {
  const orphanedGames = await db
    .select({ id: schema.games.id, startedAt: schema.games.startedAt })
    .from(schema.games)
    .where(eq(schema.games.status, "in_progress"))
    .orderBy(asc(schema.games.id));

  const now = options.now ?? new Date();
  const returnedToWaiting: StartupOrphanedGameReturnedToWaiting[] = [];
  const repairRequired: StartupOrphanedGameRepairRequired[] = [];
  const suspended: StartupOrphanedGameSuspension[] = [];

  for (const game of orphanedGames) {
    const ageMs = startedAgeMs(game.startedAt, now);
    const owners = await db.select({
      ownerEpoch: schema.gameRunOwners.ownerEpoch,
      lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
      status: schema.gameRunOwners.status,
    }).from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, game.id));
    const authoritativeOwners = owners.filter((owner) => owner.status === "active");

    const events = await db.select({
      sequence: schema.gameEvents.sequence,
      ownerEpoch: schema.gameEvents.ownerEpoch,
    }).from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, game.id))
      .orderBy(asc(schema.gameEvents.sequence));
    const settlement = (await db.select({
      state: schema.gameCompletionSettlements.state,
    }).from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, game.id))
      .limit(1))[0];

    const owner = authoritativeOwners.length === 1 ? authoritativeOwners[0] : undefined;
    const eventHead = events.at(-1)?.sequence ?? 0;
    const eventOwnerEpochs = [...new Set(events.map((event) => event.ownerEpoch))].sort();
    const evidence = {
      startedAt: game.startedAt,
      ageMs,
      activeOwnerCount: authoritativeOwners.length,
      activeOwnerEpochs: authoritativeOwners.map((candidate) => candidate.ownerEpoch).sort(),
      ownerHead: owner?.lastPersistedEventSequence ?? null,
      eventCount: events.length,
      eventHead,
      eventOwnerEpochs,
      settlementState: settlement?.state ?? null,
    };

    let reason: StartupOrphanDiagnosticReason | undefined;
    if (settlement) {
      reason = "sealed_completion_present";
    } else if (authoritativeOwners.length === 0) {
      reason = "active_owner_missing";
    } else if (authoritativeOwners.length !== 1) {
      reason = "active_owner_ambiguous";
    } else if (eventOwnerEpochs.some((ownerEpoch) => ownerEpoch !== owner?.ownerEpoch)) {
      reason = "owner_event_epoch_disagreement";
    } else if (owner?.lastPersistedEventSequence !== eventHead) {
      reason = "owner_event_head_disagreement";
    } else if (events.length > 0) {
      reason = "durable_event_present";
    }

    if (!reason && owner) {
      try {
        const cleanup = await markOwnerStartupFailed(
          db,
          game.id,
          owner.ownerEpoch,
          "API process restarted before gameplay began",
        );
        const base = {
          gameId: game.id,
          startedAt: game.startedAt,
          ageMs,
          ownerEpoch: owner.ownerEpoch,
        };
        if (cleanup.rosterDisposition === "reconciled") {
          returnedToWaiting.push({ ...base, rosterDisposition: "reconciled" });
        } else {
          repairRequired.push({
            ...base,
            rosterDisposition: "repair_required",
            reconciliationError: cleanup.reconciliationError,
          });
        }
        continue;
      } catch (error) {
        reason = "startup_cleanup_conflict";
        Object.assign(evidence, { cleanupError: cleanupFailureDetails(error) });
      }
    }

    const finalReason = reason ?? "startup_cleanup_conflict";
    const details = { reason: finalReason, ...evidence };
    await markGameSuspended(db, game.id, "startup_orphaned", details);
    suspended.push({
      gameId: game.id,
      startedAt: game.startedAt,
      ageMs,
      reason: finalReason,
      details,
    });
  }

  return {
    scanned: orphanedGames.length,
    returnedToWaiting,
    repairRequired,
    suspended,
  };
}
