import { and, eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { dispatchDueChampionshipMatches } from "./championship-dispatch.js";
import { reconcileChampionshipResults } from "./championship-results.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "./championship-awards.js";
/** Reentrant wakeup: each durable boundary is independently idempotent; an award failure never stops dispatch. */
export async function reconcileChampionships(db: DrizzleDB, _now = new Date().toISOString(), eventId?: string) {
  // Producer recovery reconciles results and schedules; it never discovers games to start.
  const dispatched: Awaited<ReturnType<typeof dispatchDueChampionshipMatches>> = [];
  const events = await db.select({ id: schema.championshipEvents.id }).from(schema.championshipEvents).where(and(inArray(schema.championshipEvents.status, ["running", "paused", "final"]), eventId ? eq(schema.championshipEvents.id, eventId) : undefined));
  const diagnostics: Array<{ eventId: string; phase: string; error: string }> = [];
  for (const event of events) {
    for (const [phase, action] of [["results", reconcileChampionshipResults], ["allocation", prepareChampionshipAwards], ["delivery", deliverChampionshipAwards]] as const) {
      try { await action(db, event.id); }
      catch (error) { diagnostics.push({ eventId: event.id, phase, error: error instanceof Error ? error.message : "Retry pending" }); }
    }
  }
  if (eventId) {
    const { requestChampionshipScheduleSync } = await import("./championship-scheduling.js");
    await requestChampionshipScheduleSync(eventId, db);
  }
  return { dispatched, diagnostics };
}

/** Completion callback, also safe to redeliver after a worker/transport failure. Never starts games. */
export async function reconcileChampionshipGameCompletion(db: DrizzleDB, gameId: string) {
  const [match] = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, gameId));
  if (!match) return;
  await reconcileChampionshipResults(db, match.eventId);
  await prepareChampionshipAwards(db, match.eventId);
  await deliverChampionshipAwards(db, match.eventId);
  const [event] = await db.select({ status: schema.championshipEvents.status }).from(schema.championshipEvents).where(eq(schema.championshipEvents.id, match.eventId));
  if (event?.status === "final") {
    const { requestChampionshipScheduleSync } = await import("./championship-scheduling.js");
    await requestChampionshipScheduleSync(match.eventId, db);
  }
}

export async function notifyChampionshipGameCompletion(db: DrizzleDB, gameId: string) {
  const [match] = await db.select({ id: schema.championshipMatches.id }).from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, gameId));
  if (!match) return;
  try { await reconcileChampionshipGameCompletion(db, gameId); }
  catch (error) { console.warn("[championship] Local completion needs retry", gameId, error instanceof Error ? error.message : "Unknown failure"); }
  try {
    if (process.env.CHAMPIONSHIP_SCHEDULER_URL) {
      const response = await fetch(process.env.CHAMPIONSHIP_SCHEDULER_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CHAMPIONSHIP_SCHEDULER_TOKEN}` }, body: JSON.stringify({ kind: "complete", gameId }) });
      if (!response.ok) throw new Error("Completion delivery was not durably accepted");
      const receipt = await response.json() as { accepted?: boolean; gameId?: string };
      if (receipt.accepted !== true || receipt.gameId !== gameId) throw new Error("Completion acknowledgement did not match game");
    }
  }
  catch (error) { console.warn("[championship] Completion delivery needs retry", gameId, error instanceof Error ? error.message : "Unknown failure"); }
}
