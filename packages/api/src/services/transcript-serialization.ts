import type { TranscriptEntry } from "@influence/engine";
import { schema } from "../db/index.js";

export function serializeTranscriptEntry(
  gameId: string,
  entry: TranscriptEntry,
): typeof schema.transcripts.$inferInsert {
  return {
    gameId,
    round: entry.round,
    phase: entry.phase,
    fromPlayerId: entry.from === "SYSTEM" || entry.from === "House" ? null : entry.from,
    scope: entry.scope,
    toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
    roomId: entry.roomId ?? null,
    roomMetadata: entry.roomMetadata ? JSON.stringify(entry.roomMetadata) : null,
    text: entry.text,
    thinking: entry.thinking ?? null,
    timestamp: entry.timestamp,
  };
}
