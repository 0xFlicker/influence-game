import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { markGameSuspended } from "./game-ownership.js";

export interface StartupOrphanedGameSuspension {
  gameId: string;
  startedAt: string | null;
  ageMs: number | null;
}

export interface StartupOrphanedGameSuspensionResult {
  scanned: number;
  suspended: StartupOrphanedGameSuspension[];
}

function startedAgeMs(startedAt: string | null, now: Date): number | null {
  if (!startedAt) return null;
  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return null;
  return Math.max(0, now.getTime() - startedAtMs);
}

export async function suspendOrphanedInProgressGamesOnStartup(
  db: DrizzleDB,
  options: { now?: Date } = {},
): Promise<StartupOrphanedGameSuspensionResult> {
  const orphanedGames = await db
    .select({ id: schema.games.id, startedAt: schema.games.startedAt })
    .from(schema.games)
    .where(eq(schema.games.status, "in_progress"));

  const now = options.now ?? new Date();
  const suspended: StartupOrphanedGameSuspension[] = [];

  for (const game of orphanedGames) {
    const ageMs = startedAgeMs(game.startedAt, now);

    await markGameSuspended(db, game.id, "startup_orphaned", {
      startedAt: game.startedAt,
      ageMs,
      reason: "api_startup_has_no_in_memory_runner",
    });

    suspended.push({
      gameId: game.id,
      startedAt: game.startedAt,
      ageMs,
    });
  }

  return { scanned: orphanedGames.length, suspended };
}
