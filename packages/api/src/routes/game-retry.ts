import { launchChampionshipGame, assertChampionshipLaunchConfigured, isChampionshipGame } from "../services/championship-launch.js";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { ChampionshipError } from "../services/championships.js";
import { retryFailedGame } from "../services/game-retry.js";
import { assertGameLaunchConfigured, launchExactGame } from "../services/game-launch.js";
import { tryRefreshGameWatchStateSummary } from "../services/game-watch-state-summary.js";

export function createGameRetryRoutes(db: DrizzleDB, launch?: typeof launchExactGame) {
  const app = new Hono<AuthEnv>();
  app.onError((error, c) => {
    if (error instanceof ChampionshipError) return c.json({ error: error.message }, error.status);
    throw error;
  });
  app.post("/api/admin/games/:id/retry", requireAuth(db), requirePermission("start_game"), requirePermission("stop_game"), requirePermission("hide_game"), async c => {
    const championship = await isChampionshipGame(db, c.req.param("id"));
    if (championship) assertChampionshipLaunchConfigured(); else assertGameLaunchConfigured();
    const launchReplacement = launch ?? (championship ? launchChampionshipGame : launchExactGame);
    const result = await retryFailedGame(db, c.req.param("id"), c.get("user")!.id);
    await tryRefreshGameWatchStateSummary(db, result.originalGameId, "game_retried");
    await tryRefreshGameWatchStateSummary(db, result.gameId, "replacement_accepted");
    try { await launchReplacement(db, result.gameId); }
    catch { return c.json({ ...result, error: "Replacement saved; launch is pending. Retry this operation to launch the same game.", launchPending: true }, 503); }
    return c.json({ ...result, launchPending: false });
  });
  return app;
}
