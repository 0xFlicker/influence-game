import { and, eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { dispatchDueChampionshipMatches } from "./championship-dispatch.js";
import { reconcileChampionshipResults } from "./championship-results.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "./championship-awards.js";
/** Reentrant wakeup: each durable boundary is independently idempotent; an award failure never stops dispatch. */
export async function reconcileChampionships(db: DrizzleDB, now = new Date().toISOString(), eventId?: string) {
  const dispatched = await dispatchDueChampionshipMatches(db, now, eventId);
  const events = await db.select({ id: schema.championshipEvents.id }).from(schema.championshipEvents).where(and(inArray(schema.championshipEvents.status, ["running", "paused", "final"]), eventId ? eq(schema.championshipEvents.id, eventId) : undefined));
  const diagnostics: Array<{ eventId: string; phase: string; error: string }> = [];
  for (const event of events) {
    for (const [phase, action] of [["results", reconcileChampionshipResults], ["allocation", prepareChampionshipAwards], ["delivery", deliverChampionshipAwards]] as const) {
      try { await action(db, event.id); }
      catch (error) { diagnostics.push({ eventId: event.id, phase, error: error instanceof Error ? error.message : "Retry pending" }); }
    }
  }
  return { dispatched, diagnostics };
}
