import { schema, type DrizzleDB } from "../db/index.js";
import { eq } from "drizzle-orm";
import { ChampionshipError } from "./championships.js";
import { isLocalGameRuntime } from "./local-game-runtime.js";
import { launchExactGameLocally } from "./game-launch.js";
/** Separate from generic failed-game retry credentials/configuration. */
export function assertChampionshipLaunchConfigured() {
  const endpoint = process.env.CHAMPIONSHIP_GAME_LAUNCH_URL, token = process.env.CHAMPIONSHIP_GAME_LAUNCH_TOKEN;
  if (!endpoint && !token && isLocalGameRuntime()) return;
  if (!endpoint || !token) throw new ChampionshipError("Configure championship launcher URL and token", 503);
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/internal/championships/games/launch") throw new ChampionshipError("Championship launcher must use the exact authenticated HTTPS route", 503);
}
export async function launchChampionshipGame(db: DrizzleDB, gameId: string) {
  assertChampionshipLaunchConfigured();
  const endpoint = process.env.CHAMPIONSHIP_GAME_LAUNCH_URL;
  if (!endpoint) return launchExactGameLocally(db, gameId);
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${process.env.CHAMPIONSHIP_GAME_LAUNCH_TOKEN}`, "Idempotency-Key": `game:${gameId}`,
  }, body: JSON.stringify({ gameId }) });
  if (!response.ok) throw new ChampionshipError("Championship launch pending; retry the same game", 503);
  const receipt = await response.json() as { accepted?: boolean; gameId?: string };
  if (receipt.accepted !== true || receipt.gameId !== gameId) throw new ChampionshipError("Championship launcher did not acknowledge the exact game", 503);
}

export async function isChampionshipGame(db: DrizzleDB, gameId: string) {
  const [current] = await db.select({ id: schema.championshipMatches.id }).from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, gameId));
  if (current) return true;
  const [historical] = await db.select({ id: schema.championshipMatchAttempts.gameId }).from(schema.championshipMatchAttempts).where(eq(schema.championshipMatchAttempts.gameId, gameId));
  return !!historical;
}
