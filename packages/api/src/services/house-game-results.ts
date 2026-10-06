import { readEpisodePresentations } from "./episode-presentation.js";
import { asc, eq, or } from "drizzle-orm";
import { buildWerewolfResults } from "@influence/engine/werewolf/results";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getCompletedGameResults } from "./completed-game-results.js";
import { isViewerGame } from "./game-visibility.js";

/** Shared read boundary; game-specific projections own outcome semantics. */
export async function readHouseGameResults(db: DrizzleDB, idOrSlug: string) {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id,idOrSlug),eq(schema.games.slug,idOrSlug))).limit(1);
    if (!game || !isViewerGame(game)) return {ok:false as const,status:"not_found" as const,error:"Game not found"};
    if (game.gameKind === "influence") {
      const result = await getCompletedGameResults(tx,game.id);
      return result.ok ? {...result,gameKind:"influence" as const} : result;
    }
    if (game.gameKind !== "werewolf") return {ok:false as const,status:"unavailable" as const,error:"Unsupported game kind"};
    if (game.status !== "completed") return {ok:false as const,status:"not_completed" as const,gameStatus:game.status,
      error:game.status === "cancelled" ? "This game was stopped. No winner was declared."
        : game.status === "suspended" ? "This game is paused. No winner has been declared." : "Results will be available when this game finishes."};
    const rows = await tx.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId,game.id)).orderBy(asc(schema.werewolfEvents.sequence));
    try {
      if (rows.some(row=>row.event.gameId !== game.id || row.sequence !== row.event.sequence)) throw new Error("Stored Werewolf event identity mismatch");
      const results = buildWerewolfResults(rows.map(row=>row.event));
      // Frozen character URLs use the existing audience/position-guarded image endpoint.
      const players = results.players.map(player=>({...player,avatarUrl:`/api/werewolf/${encodeURIComponent(game.id)}/characters/${encodeURIComponent(player.id)}?audience=omniscient&cursor=${results.source.cursor}`}));
      return {ok:true as const,gameKind:"werewolf" as const,schemaVersion:1 as const,
        game:{id:game.id,slug:game.slug,status:game.status,completedAt:game.endedAt,episode:(await readEpisodePresentations(tx,[game])).get(game.id)!},results:{...results,players}};
    } catch (error) {
      console.error(`[werewolf-results] Invalid completed history for ${game.id}:`,error);
      return {ok:false as const,status:"unavailable" as const,error:"Results are unavailable for this game. Try again later."};
    }
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
