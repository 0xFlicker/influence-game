import {eq} from "drizzle-orm";
import {closeDB, createDB, schema} from "../db/index.js";
import {previewHouseAudioRefresh, queueHouseAudioRefresh} from "../services/audio-house-refresh.js";
import {runAudioTrack} from "../services/audio-tracks.js";

const [mode, gameId, previewHash, ...extra] = process.argv.slice(2);
if (!gameId || extra.length || !["preview", "queue", "run"].includes(mode ?? "") || (mode === "queue") !== Boolean(previewHash))
  throw new Error("Usage: bun src/scripts/refresh-werewolf-house-audio.ts preview GAME_ID | queue GAME_ID PREVIEW_HASH | run TRACK_ID");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = createDB();
try {
  if (mode === "run") {
    const [track] = await db.select().from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id, gameId));
    if (!track?.predecessorId || track.mode !== "backfill") throw new Error("Expected a queued House refresh track");
    await runAudioTrack(db, undefined, undefined, track.id);
    const [result] = await db.select({id: schema.gameAudioTracks.id, status: schema.gameAudioTracks.status, error: schema.gameAudioTracks.error}).from(schema.gameAudioTracks).where(eq(schema.gameAudioTracks.id, track.id));
    console.log(JSON.stringify(result, null, 2));
    if (result?.status !== "ready") process.exitCode = 1;
  } else console.log(JSON.stringify(mode === "preview" ? await previewHouseAudioRefresh(db, gameId) : {trackId: await queueHouseAudioRefresh(db, gameId, previewHash!)}, null, 2));
}
finally { await closeDB(); }
