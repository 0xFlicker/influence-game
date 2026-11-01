import type {CanonicalGameEvent, TranscriptDialogueContext} from "@influence/engine";
import {HOUSE_RESULT_EVENTS,selectHouseResultEvent} from "@influence/engine";
import {and, eq, inArray} from "drizzle-orm";
import {schema, type DrizzleDB} from "../db/index.js";
import {loadPayloads} from "./payload-storage.js";
import {hashCanonicalEvent} from "./game-events.js";
import {getPersistedGameEvents} from "./game-event-read-model.js";

type SummaryRow = {id:number; gameTurnId:string|null; entrySequence:number|null; dialogueKind:string|null; round:number; phase:string};

/** Read-only recovery from the exact committing turn, never text or temporal proximity. */
export async function readHistoricalHouseResults(db: Pick<DrizzleDB,"select">, gameId:string, rows:readonly SummaryRow[], events?:readonly CanonicalGameEvent[]) {
  const summaries = rows.filter(row => row.dialogueKind === "house_summary" && row.gameTurnId && row.entrySequence !== null);
  const result = new Map<number, NonNullable<TranscriptDialogueContext["houseResult"]>>();
  if (!summaries.length) return result;
  const turns = await loadPayloads(db.select({id:schema.gameTurns.id, result:schema.gameTurns.commitResult})
    .from(schema.gameTurns).where(and(eq(schema.gameTurns.gameId,gameId),eq(schema.gameTurns.status,"committed"),inArray(schema.gameTurns.id,[...new Set(summaries.map(row=>row.gameTurnId!))]))));
  const history = events ?? (await getPersistedGameEvents(db,gameId)).events.map(event=>event.envelope);
  const eventBySequence = new Map(history.map(event=>[event.sequence,event]));
  const turnById = new Map(turns.map(turn=>[turn.id,turn.result]));
  for (const row of summaries) {
    const turn = turnById.get(row.gameTurnId!);
    if (!turn || !turn.dialogueSequences.includes(row.entrySequence!)) continue;
    const beats = turn.state.houseNarrativeContinuity?.recentBeats.filter(beat => beat.boundary.gameId === gameId
      && beat.boundary.dialogueHead + 1 === row.entrySequence && beat.boundary.round === row.round && beat.boundary.phase === row.phase) ?? [];
    if (beats.length !== 1) continue;
    const boundary = beats[0]!.boundary;
    const matches = turn.canonicalEvents.flatMap(ref => {
      const event = eventBySequence.get(ref.sequence);
      return event && ref.eventHash === hashCanonicalEvent(event) && event.sequence <= boundary.canonicalHead && event.round === row.round
        && (event.type === HOUSE_RESULT_EVENTS[boundary.actorCoordinate] || boundary.actorCoordinate === "vote" && event.type === "vote.empowered_set") ? [event] : [];
    });
    const resolved = boundary.actorCoordinate === "vote" ? selectHouseResultEvent("vote",matches,row.round) : matches.length === 1 ? matches[0] : null;
    if (resolved) result.set(row.id,{eventSequence:resolved.sequence,authoringRevision:"historical"});
  }
  return result;
}
