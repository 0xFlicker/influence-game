import { createHash } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import type { ProductionAudience } from "@influence/engine/production-moments";
import type { PublishedAudioTrack } from "@influence/engine/audio-track";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, readPayload } from "./payload-storage.js";
import { isViewerGame } from "./game-visibility.js";

export async function readAudioPublication(db: Pick<DrizzleDB,"select">, id: string, audience: ProductionAudience, thinking: boolean, producer = false): Promise<PublishedAudioTrack | null> {
  const [game] = await db.select().from(schema.games).where(or(eq(schema.games.id, id), eq(schema.games.slug, id)));
  if (!game || !isViewerGame(game) || (game.gameKind === "werewolf" ? audience === "public" : audience !== "public") || audience === "mystery" && thinking) return null;
  const [track] = await db.select().from(schema.gameAudioTracks).where(and(eq(schema.gameAudioTracks.gameId, game.id), eq(schema.gameAudioTracks.active, true)));
  if (!track?.manifest || track.mode !== "live" && track.status !== "ready") return null;
  const manifest = await readJson(track.manifest);
  const permitted = new Map(manifest.lines.filter(line => line.eventSequence <= track.readyEventSequence && line.audiences.includes(audience) && (thinking || !line.context.endsWith("thinking"))).map(line => [line.momentId, line]));
  // Resolve live dialogue identity only in the read projection. Changing saved
  // sources or recipes here would invalidate existing tracks.
  const transcriptIds = [...new Set([...permitted.values()].flatMap(line => {
    const watch = line.watch?.[audience];
    if (watch?.kind !== "influence" || !watch.transcriptId || !/^[1-9]\d*$/.test(watch.transcriptId)) return [];
    const id = Number(watch.transcriptId);
    return Number.isSafeInteger(id) && id <= 2_147_483_647 ? [id] : [];
  }))];
  const transcripts = transcriptIds.length ? await db.select({ id: schema.transcripts.id, entrySequence: schema.transcripts.entrySequence })
    .from(schema.transcripts).where(and(eq(schema.transcripts.gameId, game.id), inArray(schema.transcripts.id, transcriptIds))) : [];
  const entrySequences = new Map(transcripts.flatMap(row => row.entrySequence === null ? [] : [[String(row.id), row.entrySequence] as const]));
  const rows = await db.select({ clipId:schema.gameAudioClips.id, momentId: schema.gameAudioClips.momentId, version: schema.gameAudioVersions }).from(schema.gameAudioClips)
    .innerJoin(schema.gameAudioVersions, eq(schema.gameAudioClips.activeVersionId, schema.gameAudioVersions.id)).where(eq(schema.gameAudioClips.trackId, track.id));
  const order = new Map(manifest.lines.map((line,index)=>[line.momentId,index]));
  rows.sort((a,b)=>(order.get(a.momentId) ?? 0)-(order.get(b.momentId) ?? 0));
  return { id: track.id, clips: rows.flatMap(row => {
    const line = permitted.get(row.momentId);
    if (!line) return [];
    const watch = line.watch?.[audience];
    const entrySequence = watch?.kind === "influence" && watch.transcriptId ? entrySequences.get(watch.transcriptId) : undefined;
    return [{ momentId: producer ? line.productionMomentId ?? line.momentId : row.clipId, ...(watch && {watch: entrySequence === undefined ? watch : {...watch, entrySequence}}), speakerId: line.speakerId, textHash: createHash("sha256").update(line.text).digest("hex"), versionId: row.version.id,
      sha256: row.version.audio.sha256, durationMs: row.version.durationMs,
      url: `/api/games/${encodeURIComponent(game.id)}/audio/${row.version.id}?audience=${audience}&thinking=${thinking ? "on" : "off"}` }];
  }) };
}
export async function readPublishedAudioBytes(db: DrizzleDB, gameId: string, versionId: string, audience: ProductionAudience, thinking: boolean) {
  const publication = await readAudioPublication(db, gameId, audience, thinking);
  if (!publication?.clips.some(clip => clip.versionId === versionId)) return null;
  const [version] = await db.select({ audio: schema.gameAudioVersions.audio }).from(schema.gameAudioVersions).where(eq(schema.gameAudioVersions.id, versionId));
  return version ? readPayload(version.audio) : null;
}
/** Single HTTP byte ranges support movie scrubbing. Unsatisfiable ranges are explicit. */
export function audioRange(range: string | undefined, length: number): { start: number; end: number } | null {
  if (range === undefined) return { start: 0, end: length - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < length ? { start, end } : null;
}
