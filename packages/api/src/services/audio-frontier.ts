import {and,eq,or} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
/** Viewer reads may advance only through audio that is durably ready. */
export async function audioReadySequence(db: Pick<DrizzleDB, "select">, gameId: string): Promise<number | null> {
  const [row] = await db.select({ ready: schema.gameAudioTracks.readyEventSequence }).from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId, gameId), eq(schema.gameAudioTracks.active, true), or(eq(schema.gameAudioTracks.mode, "live"), eq(schema.gameAudioTracks.status, "ready"))));
  if (row) return row.ready;
  const [game] = await db.select({ config: schema.games.config }).from(schema.games).where(eq(schema.games.id, gameId));
  return game && JSON.parse(game.config).audioMode === true ? 0 : null;
}

export async function hasLiveAudioTrack(db: Pick<DrizzleDB,"select">,gameId:string) {
  const [track]=await db.select({id:schema.gameAudioTracks.id}).from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId,gameId),eq(schema.gameAudioTracks.mode,"live"),eq(schema.gameAudioTracks.active,true)));
  return Boolean(track);
}
