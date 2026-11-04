import type { DrizzleDB } from "../db/index.js";
import { and, eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { ChampionshipError } from "./championships.js";
import { adoptInProgressDurableGamesOnStartup } from "./startup-durable-games.js";

/** Local explicit launch; no discovery loop, unrelated game adoption, or server startup. */
export async function launchExactGameLocally(db: DrizzleDB, gameId: string, options: { start?: typeof import("./game-lifecycle.js").startGame } = {}) {
  const { startGame, isGameRunning } = await import("./game-lifecycle.js");
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (!game) throw new ChampionshipError("Game not found", 404);
  if (game.status === "completed") return;
  if (game.status !== "in_progress") throw new ChampionshipError("Game is not ready for execution", 409);
  const result = await adoptInProgressDurableGamesOnStartup(db, { gameId, isAlreadyRunning: isGameRunning,
    start: async ({ gameId, ownerEpoch, upgradeFrom }) => {
      try {
        const started = await (options.start ?? startGame)(db, gameId, ownerEpoch, upgradeFrom ? { durableUpgradeFrom: upgradeFrom } : {});
        if (started.error) throw new Error(started.error);
      } catch (error) {
        if (!isGameRunning(gameId)) {
          await db.transaction(async tx => {
            await tx.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.id, gameId)).for("update");
            await tx.update(schema.gameRunOwners).set({ status: "expired", closedAt: new Date().toISOString(), failureReason: "explicit_launch_failed" })
              .where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch), eq(schema.gameRunOwners.status, "active")));
          });
        }
        throw error;
      }
    } });
  if (result.adopted.includes(gameId) || result.skipped.some(row => row.reason === "already_running")) return;
  // Another worker can claim between acceptance and this request. Verify actual ownership.
  const [owner] = await db.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.status, "active")));
  if (result.skipped.some(row => row.reason === "adoption_conflict") && owner?.expiresAt && Date.parse(owner.expiresAt) > Date.now()) return;
  throw new ChampionshipError(result.skipped[0]?.detail ?? "Exact game launch was not accepted; retry this request", 503);
}

export function assertGameLaunchConfigured() {
  if (process.env.INFLUENCE_GAME_LAUNCH_URL || process.env.INFLUENCE_GAME_LAUNCH_TOKEN) {
    if (!process.env.INFLUENCE_GAME_LAUNCH_URL || !process.env.INFLUENCE_GAME_LAUNCH_TOKEN) throw new ChampionshipError("Configure both game launcher URL and token", 503);
    const url = new URL(process.env.INFLUENCE_GAME_LAUNCH_URL);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new ChampionshipError("Game launcher must use HTTPS or localhost", 503);
    return;
  }
  if (process.env.NODE_ENV !== "production") return;
  throw new ChampionshipError("An explicit game launcher must be configured before retrying games", 503);
}

/** The external receiver must durably accept this game ID before acknowledging it. */
export async function launchExactGame(db: DrizzleDB, gameId: string) {
  assertGameLaunchConfigured();
  const endpoint = process.env.INFLUENCE_GAME_LAUNCH_URL;
  if (!endpoint) return launchExactGameLocally(db, gameId);
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new ChampionshipError("Game launcher must use HTTPS or localhost", 503);
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INFLUENCE_GAME_LAUNCH_TOKEN}`, "Idempotency-Key": `game:${gameId}` },
    body: JSON.stringify({ gameId }) });
  if (!response.ok) throw new ChampionshipError("Game launch is pending; retry delivery to the same game", 503);
  const receipt = await response.json() as { accepted?: boolean; gameId?: string };
  if (receipt.accepted !== true || receipt.gameId !== gameId) throw new ChampionshipError("Game launcher did not acknowledge this exact game", 503);
}
