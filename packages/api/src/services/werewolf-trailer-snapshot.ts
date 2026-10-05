import { and, asc, eq, or } from "drizzle-orm";
import { buildWerewolfTrailerManifest } from "@influence/engine/postgame-media/werewolf-trailer-manifest";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";

/** Repeatable read for standalone production review. Coordinators already hold the game lock. */
export async function loadWerewolfTrailerSnapshot(db: DrizzleDB, idOrSlug: string) {
  return db.transaction(tx => buildStoredWerewolfTrailerSnapshot(tx, idOrSlug), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function buildStoredWerewolfTrailerSnapshot(tx: Pick<DrizzleDB, "select">, idOrSlug: string) {
  const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))).limit(1);
  if (!game || game.gameKind !== "werewolf" || !isViewerGame(game)) throw new Error("Werewolf game not found or unavailable");
  if (game.status !== "completed") throw new Error("Werewolf trailer requires a completed game");
  const rows = await tx.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, game.id)).orderBy(asc(schema.werewolfEvents.sequence));
  if (rows.some(row => row.event.gameId !== game.id || row.sequence !== row.event.sequence)) throw new Error("Stored Werewolf event identity mismatch");
  const [job] = await tx.select().from(schema.houseCutJobs).where(and(eq(schema.houseCutJobs.gameId, game.id), eq(schema.houseCutJobs.audience, "mystery")));
  return buildWerewolfTrailerManifest({ events: rows.map(row => row.event), slug: game.slug,
    cuts: { game: { id: game.id, slug: game.slug, kind: "werewolf" }, audience: "mystery",
      status: job?.publication ? "ready" : job?.status === "failed" ? "failed" : "pending", publication: job?.publication ?? null } });
}
