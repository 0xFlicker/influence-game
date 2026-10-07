import { and, asc, eq, or } from "drizzle-orm";
import { Phase } from "@influence/engine";
import { werewolfCutSource } from "@influence/engine/house-cuts/werewolf-source";
import { influenceCutSource } from "@influence/engine/house-cuts/influence-source";
import type { CutSource } from "@influence/engine/house-cuts/source";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { isViewerSafeDialogueKind } from "./transcript-capture.js";

/** Operator CLI source boundary. No provider execution or writes; no hidden/private evidence. */
export async function loadHouseCutSource(db: DrizzleDB, idOrSlug: string, audience: CutSource["audience"]): Promise<CutSource> {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))).limit(1);
    if (!game || !isViewerGame(game)) throw new Error("Game not found or unavailable to viewers");
    if (game.status !== "completed") throw new Error("House Cuts require a completed game");
    if (game.gameKind === "werewolf") {
      if (audience === "public") throw new Error("Choose mystery or omniscient for Werewolf");
      const rows = await tx.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, game.id)).orderBy(asc(schema.werewolfEvents.sequence));
      if (rows.some(row => row.event.gameId !== game.id || row.sequence !== row.event.sequence)) throw new Error("Stored Werewolf identity mismatch");
      return werewolfCutSource(rows.map(row => row.event), game.slug, audience);
    }
    if (game.gameKind !== "influence" || audience !== "public") throw new Error("Influence discovery currently supports public dialogue only");
    const history = await getPersistedGameEvents(tx, game.id);
    if (history.status !== "complete") throw new Error("Influence canonical history is unavailable or invalid");
    const rows = await tx.select().from(schema.transcripts).where(and(eq(schema.transcripts.gameId, game.id), eq(schema.transcripts.scope, "public"))).orderBy(asc(schema.transcripts.entrySequence));
    const dialogue = rows.filter(row => row.dialogueKind && isViewerSafeDialogueKind(row.dialogueKind));
    return influenceCutSource(history.events.map(row => row.envelope), dialogue.map(row => {
      if (!Object.values(Phase).includes(row.phase as Phase)) throw new Error("Unknown transcript phase");
      if (!row.speakerPlayerId || !row.entrySequence) throw new Error("Public dialogue lacks stable attribution");
      return { round: row.round, phase: row.phase as Phase, timestamp: row.timestamp, from: row.speakerPlayerId,
        scope: "public" as const, text: row.text, speakerPlayerId: row.speakerPlayerId, entrySequence: row.entrySequence };
    }), game.slug);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
