import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";

/** Called inside completion's transaction; no historical paid backfill on startup. */
export async function queueHouseCuts(db: Pick<DrizzleDB, "select" | "insert">, gameId: string) {
  const [game] = await db.select().from(schema.games).where(and(eq(schema.games.id, gameId), eq(schema.games.status, "completed")));
  if (!game || !isViewerGame(game)) return;
  const audiences = game.gameKind === "werewolf" ? ["mystery", "omniscient"] as const : ["public"] as const;
  await db.insert(schema.houseCutJobs).values(audiences.map(audience => ({ gameId, audience }))).onConflictDoNothing();
}
