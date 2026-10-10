import { canonicalEventIsVisibleTo } from "@influence/engine";
import { getGameCompletionSettlementState } from "./game-completion-settlement.js";
import { asc, eq, sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import { getGameWatchReplayFrames } from "./game-watch-state.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { buildMatchTranscriptEntryDto } from "./transcript-serialization.js";
import {
  isDialogueTranscriptScope,
  isViewerSafeDialogueKind,
} from "./transcript-capture.js";
import {
  HouseInspectionError,
  type HouseReadDB,
  type HouseGame,
} from "./house-game-access.js";

export async function loadHouseInfluenceHistory(
  db: HouseReadDB,
  game: HouseGame,
) {
  try {
    const persisted = await getPersistedGameEvents(db, game.id);
    if (persisted.status === "invalid")
      throw new HouseInspectionError(
        "unavailable",
        "Canonical history is invalid",
      );
    const settlement = await getGameCompletionSettlementState(db, game.id);
    const terminal = persisted.events.find(
      (e) => e.eventType === "jury.winner_determined",
    )?.sequence;
    const held = settlement === "pending" || settlement === "repair_required";
    const publicSequences = new Set(
      persisted.events
        .filter((event) => canonicalEventIsVisibleTo(event.envelope, "public"))
        .map((event) => event.sequence),
    );
    const facts = ((await getGameWatchReplayFrames(db, game.id)) ?? [])
      // Private bookkeeping does not become a spectator entry merely because it
      // leaves the public board unchanged. Retain explicitly sanitized watch decisions.
      .filter(
        (frame) =>
          publicSequences.has(frame.sequence) ||
          frame.viewerDecisionEvent !== undefined,
      )
      .filter(
        (f) =>
          !held ||
          ((terminal === undefined || f.sequence < terminal) &&
            f.eventType !== "jury.vote_cast"),
      )
      .map((frame) => ({
        schemaVersion: frame.schemaVersion,
        gameId: frame.gameId,
        sequence: frame.sequence,
        eventType: frame.eventType,
        timestamp: frame.timestamp,
        round: frame.round,
        phase: frame.phase,
        counts: frame.counts,
        players: frame.players.map((player) => ({
          id: player.id,
          name: player.name,
          status: player.status,
          shielded: player.shielded,
          personaKey: player.personaKey,
          pressureStatus: player.pressureStatus,
          exposeScore: player.exposeScore,
        })),
        ...(frame.viewerDecisionEvent
          ? { viewerDecisionEvent: frame.viewerDecisionEvent }
          : {}),
      }));
    const roster = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id));
    const names = new Map(
      roster.map((p) => {
        const persona = JSON.parse(p.persona) as { name: string };
        return [p.id, persona.name] as const;
      }),
    );
    const rows = await db
      .select()
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, game.id))
      .orderBy(
        asc(
          sql`CASE WHEN ${schema.transcripts.entrySequence} IS NULL THEN 0 ELSE 1 END`,
        ),
        asc(schema.transcripts.entrySequence),
        asc(schema.transcripts.timestamp),
        asc(schema.transcripts.id),
      );
    // Same scope boundary as durable public publications. Thinking is a separate opt-in read.
    // Legacy rows precede sequenced capture so appending current entries cannot shift them.
    // Legacy system prose has no typed public-kind proof and cannot enter this lane.
    const dialogue = rows
      .filter(
        (row) =>
          isDialogueTranscriptScope(row.scope) &&
          row.scope !== "huddle" &&
          (row.scope !== "system" ||
            (row.dialogueKind !== null &&
              isViewerSafeDialogueKind(row.dialogueKind))),
      )
      .map((row) => {
        const dto = buildMatchTranscriptEntryDto({
          ...row,
          visibilityClass: "public",
          legacyOrdering: row.entrySequence === null,
          resolvePlayerName: (id) => names.get(id) ?? null,
        });
        if (row.safeContext?.anonymous) {
          dto.speaker = { playerId: null, name: "Anonymous" };
          dto.audience = null;
        }
        return dto;
      });
    return { facts, dialogue };
  } catch (error) {
    if (error instanceof HouseInspectionError) throw error;
    throw new HouseInspectionError(
      "unavailable",
      "Game history failed validation",
    );
  }
}
