import { asc, eq, or } from "drizzle-orm";
import { isSpectatorHuddleSpeech, resolveGameKernel } from "@influence/engine";
import { closedViewerPhases } from "@influence/engine/viewer-phase-prefix";
import { schema, type DrizzleDB } from "../db/index.js";
import { audioReadySequence } from "./audio-frontier.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { publicTranscriptEntry } from "./game-publications.js";
import { buildGameWatchState, getGameWatchReplayFrames } from "./game-watch-state.js";
import { isViewerGame } from "./game-visibility.js";
import { isDialogueTranscriptScope } from "./transcript-capture.js";

/** Live and replay consume the same committed, closed-phase projection. */
export async function readGamePresentation(db: DrizzleDB, idOrSlug: string, afterSequence = 0) {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)));
    if (!game || !isViewerGame(game) || game.gameKind !== "influence") return null;
    const persisted = await getPersistedGameEvents(tx, game.id);
    if (persisted.status === "invalid") throw new Error("Presentation canonical history is invalid");
    const events = persisted.events.map(row => row.envelope);
    if (resolveGameKernel({stored:game.gameKernel,events}).kernel !== "format") return null;
    const publications = await tx.select().from(schema.gamePublications).where(eq(schema.gamePublications.gameId, game.id)).orderBy(asc(schema.gamePublications.publicationSequence));
    const transcript = (await tx.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, game.id)).orderBy(asc(schema.transcripts.id)))
      .filter(row => row.scope === "huddle" ? isSpectatorHuddleSpeech({ ...row, dialogueContext: row.safeContext }) : row.scope === "diary" || isDialogueTranscriptScope(row.scope));
    const audioReady = await audioReadySequence(tx, game.id);
    const now = Date.now();
    let dueHead = 0;
    for (const row of publications) {
      if (row.publicationSequence !== dueHead + 1) throw new Error("Presentation publication history has a gap");
      if (row.availableAt === null) break;
      const availableAt = Date.parse(row.availableAt);
      if (!Number.isFinite(availableAt)) throw new Error("Presentation publication has an invalid availability time");
      if (availableAt > now) break;
      dueHead = row.publicationSequence;
    }
    const transcriptPublications = new Map<string, number>(publications.flatMap(row => row.payload.kind === "transcript_entry" ? [[`${row.payload.turnId}:${row.payload.transcriptOrdinal}`, row.publicationSequence] as const] : []));
    const eventPublications = new Map(publications.flatMap(row => row.payload.kind === "canonical_event" ? [[row.payload.eventSequence, row.publicationSequence] as const] : []));
    // Older completed games committed huddle speech before spectator delivery
    // acquired publication slots. Release those entries only with the entire
    // finished, due prefix; never relax the live publication boundary.
    const unpublishedHuddles = publications.length === 0 ? [] : transcript.filter(row => row.scope === "huddle" && row.firstDurableEventSequence !== null
      && !transcriptPublications.has(`${row.gameTurnId}:${row.gameTurnTranscriptOrdinal}`));
    if (unpublishedHuddles.length && game.status === "completed") {
      const turns = await tx.select({ id: schema.gameTurns.id, status: schema.gameTurns.status }).from(schema.gameTurns).where(eq(schema.gameTurns.gameId, game.id));
      const committed = new Set(turns.filter(turn => turn.status === "committed").map(turn => turn.id));
      if (unpublishedHuddles.some(row => !row.gameTurnId || !committed.has(row.gameTurnId) || row.gameTurnTranscriptOrdinal === null)) {
        throw new Error("Presentation huddle has no committed turn");
      }
    }
    const starts = events.filter(event => event.type === "game.phase_entered");
    const dialogueStarts = new Map(transcript.map(row => [row.id, starts.findLast(event => event.round === row.round && event.phase === row.phase && event.sequence <= (row.firstDurableEventSequence ?? Infinity))?.sequence ?? starts.findLast(event => event.sequence <= (row.firstDurableEventSequence ?? 0))?.sequence ?? 0]));
    const hasUnanchoredDialogue = transcript.some(row => row.firstDurableEventSequence === null);
    let throughSequence = 0, phaseStartSequence = 0;
    for (const phase of closedViewerPhases(events, game.status === "completed")) {
      if (unpublishedHuddles.length && game.status === "completed" && phase.nextPhaseSequence !== null) continue;
      if (hasUnanchoredDialogue && phase.nextPhaseSequence !== null) continue;
      if (audioReady !== null && phase.throughSequence > audioReady) break;
      // A logical turn may span a phase boundary. Do not expose that partial
      // phase: wait for a later closed boundary containing its dialogue too.
      if (transcript.some(row => (dialogueStarts.get(row.id) ?? 0) <= phase.throughSequence && row.firstDurableEventSequence !== null && row.firstDurableEventSequence > phase.throughSequence)) continue;
      // Historical completed recordings predate the durable publication ledger.
      // They can be released whole; a live recording always requires that ledger.
      if (publications.length === 0) {
        if (game.status !== "completed" || phase.nextPhaseSequence !== null) continue;
      } else {
        const next = phase.nextPhaseSequence === null ? null : eventPublications.get(phase.nextPhaseSequence);
        if (phase.nextPhaseSequence !== null && next === undefined) break;
        let requiredHead = next === null ? publications.at(-1)!.publicationSequence : next! - 1;
        for (const [sequence, publication] of eventPublications) {
          if (sequence <= phase.throughSequence) requiredHead = Math.max(requiredHead, publication);
        }
        // A turn emits events before dialogue. Include every transcript dependency,
        // even if its publication follows the next phase's event in the same turn.
        for (const row of transcript) {
          if (row.firstDurableEventSequence === null || row.firstDurableEventSequence > phase.throughSequence) continue;
          const publication = transcriptPublications.get(`${row.gameTurnId}:${row.gameTurnTranscriptOrdinal}`);
          if (publication === undefined && game.status === "completed" && row.scope === "huddle" && phase.nextPhaseSequence === null) continue;
          if (publication === undefined) throw new Error("Presentation dialogue has no durable publication");
          requiredHead = Math.max(requiredHead, publication);
        }
        if (requiredHead > dueHead) break;
      }
      throughSequence = phase.throughSequence;
      phaseStartSequence = phase.startSequence;
    }
    if (afterSequence > throughSequence) throw new Error("Presentation cursor is ahead of the released history");
    const finished = game.status === "completed" && throughSequence === events.at(-1)?.sequence;
    const messages = transcript.filter(row => row.firstDurableEventSequence === null
      ? finished && afterSequence === 0
      : row.firstDurableEventSequence > afterSequence && row.firstDurableEventSequence <= throughSequence)
      .map(row => ({ id: row.id, entry: publicTranscriptEntry(row, events) }));
    const frames = await getGameWatchReplayFrames(tx, game.id, { afterSequence, throughSequence, presentationOnly: true });
    const watchState = await buildGameWatchState(tx, game, throughSequence);
    return { gameId: game.id, throughSequence, phaseStartSequence, status: game.status, finished, watchState, frames: frames ?? [], messages };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
