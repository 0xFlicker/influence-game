import { and, eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import type { HouseCutsResponse } from "@influence/engine/house-cuts/publication";
import type { CutSource } from "@influence/engine/house-cuts/source";

/** Read-only. Never starts generation or returns candidate/provider diagnostics. */
export async function readHouseCuts(db: DrizzleDB, idOrSlug: string, audience?: string): Promise<HouseCutsResponse | null> {
  const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)));
  if (!game || !isViewerGame(game)) return null;
  const chosen = audience ?? (game.gameKind === "werewolf" ? "mystery" : "public");
  if (game.gameKind === "werewolf" ? chosen !== "mystery" && chosen !== "omniscient" : chosen !== "public") return null;
  const [job] = await db.select({ status: schema.houseCutJobs.status, publication: schema.houseCutJobs.publication }).from(schema.houseCutJobs)
    .where(and(eq(schema.houseCutJobs.gameId, game.id), eq(schema.houseCutJobs.audience, chosen as CutSource["audience"])));
  return { game: { id: game.id, slug: game.slug, kind: game.gameKind as "werewolf" | "influence" },
    audience: chosen as CutSource["audience"], status: job?.publication ? "ready" : job?.status === "failed" ? "failed" : job ? "pending" : "not_prepared",
    publication: job?.publication ?? null };
}
