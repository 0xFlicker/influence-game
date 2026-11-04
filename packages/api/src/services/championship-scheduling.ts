import { isLocalGameRuntime } from "./local-game-runtime.js";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { ChampionshipError } from "./championships.js";
import { dispatchChampionshipMatch } from "./championship-dispatch.js";
import { launchExactGame } from "./game-launch.js";
import { reconcileChampionshipGameCompletion } from "./championship-runtime.js";

/** The committed event/match ledger IS the durable scheduling intent. No scan consumes it. */
export async function championshipScheduleManifest(db: DrizzleDB, eventId: string) {
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (!event) throw new ChampionshipError("Event not found", 404);
    const matches = await tx.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, eventId)).orderBy(asc(schema.championshipMatches.ordinal));
    // A status transition or correction invalidates obsolete deliveries. Acceptance preserves delivery identity.
    const version = createHash("sha256").update(JSON.stringify([event.status, matches.map(m => [m.id, m.scheduledAt, m.resultRevision])])).digest("hex");
    return { eventId, version, status: event.status, matches: event.status === "running" ? matches.filter(m => !["completed", "void"].includes(m.status)).map(m => ({
      eventId, matchId: m.id, ordinal: m.ordinal, revision: m.resultRevision, scheduledAt: m.scheduledAt, version,
    })) : [] };
  });
}
export type ChampionshipScheduledMatch = Awaited<ReturnType<typeof championshipScheduleManifest>>["matches"][number];

export function assertChampionshipSchedulerConfigured() {
  const endpoint = process.env.CHAMPIONSHIP_SCHEDULER_URL, token = process.env.CHAMPIONSHIP_SCHEDULER_TOKEN;
  if (!endpoint && !token && isLocalGameRuntime()) return;
  if (!endpoint || !token) throw new ChampionshipError("Configure the championship scheduler URL and token before activation", 503);
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new ChampionshipError("Scheduler must use HTTPS or localhost", 503);
}

/** Acknowledgement means durable queue acceptance, not successful AWS registration. Repeating activation repairs interrupted delivery. */
export async function requestChampionshipScheduleSync(eventId: string, db?: DrizzleDB) {
  assertChampionshipSchedulerConfigured();
  if (!process.env.CHAMPIONSHIP_SCHEDULER_URL) {
    if (!db) throw new ChampionshipError("Local scheduler requires its database", 503);
    return synchronizeLocalChampionshipSchedules(db, eventId);
  }
  const response = await fetch(process.env.CHAMPIONSHIP_SCHEDULER_URL!, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CHAMPIONSHIP_SCHEDULER_TOKEN}` }, body: JSON.stringify({ eventId }) });
  if (!response.ok) throw new ChampionshipError("Scheduling delivery is pending; repeat the same action to retry", 503);
  const receipt = await response.json() as { accepted?: boolean; eventId?: string };
  if (receipt.accepted !== true || receipt.eventId !== eventId) throw new ChampionshipError("Scheduler did not acknowledge this event", 503);
  return { accepted: true as const };
}

/** Only this identity can launch; a completed or superseded attempt is never replayed. */
export async function dispatchScheduledChampionshipMatch(db: DrizzleDB, input: ChampionshipScheduledMatch,
  options: { now?: string; launch?: typeof launchExactGame } = {}) {
  const prepared = await dispatchChampionshipMatch(db, input.eventId, input.ordinal, options.now, input);
  if ("obsolete" in prepared) return { accepted: true, ignored: "obsolete" };
  if (!prepared.gameId) throw new ChampionshipError("Match is not due yet", 503);
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, prepared.gameId));
  if (game?.status === "completed") await reconcileChampionshipGameCompletion(db, game.id);
  else if (game?.status === "in_progress") await (options.launch ?? launchExactGame)(db, game.id);
  else return { accepted: true, gameId: prepared.gameId, recoveryRequired: true };
  return { accepted: true, gameId: prepared.gameId };
}

const localTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Development-only one-shot adapter. The API hosts timers, never a game-worker discovery loop. */
export async function synchronizeLocalChampionshipSchedules(db: DrizzleDB, eventId: string) {
  if (!isLocalGameRuntime()) throw new ChampionshipError("Local scheduling is development-only", 503);
  const manifest = await championshipScheduleManifest(db, eventId);
  for (const [key, timer] of localTimers) if (key.startsWith(`${eventId}:`)) { clearTimeout(timer); localTimers.delete(key); }
  const [event] = await db.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId));
  if (!event) throw new ChampionshipError("Event not found", 404);
  await db.insert(schema.competitionAudit).values({ id: crypto.randomUUID(), eventId, actorId: event.createdById,
    requestId: `local-scheduler:${eventId}`, action: "local_scheduler_enabled", reason: "Development one-shot scheduler; restores from the event ledger on API startup" }).onConflictDoNothing();
  for (const match of manifest.matches) {
    const key = `${eventId}:${match.matchId}`;
    const arm = (delay: number) => {
      const timer = setTimeout(async () => {
        localTimers.delete(key);
        if (Date.parse(match.scheduledAt) > Date.now()) { arm(Date.parse(match.scheduledAt) - Date.now()); return; }
        try { await dispatchScheduledChampionshipMatch(db, match); }
        catch (error) {
          console.warn("[championship] Exact local delivery will retry", match.matchId, error instanceof Error ? error.message : "delivery failed");
          // Retry THIS delivery only. No scan, queue selection, or unrelated adoption.
          arm(30_000);
        }
      }, Math.min(Math.max(0, delay), 2_147_483_647));
      timer.unref(); localTimers.set(key, timer);
    };
    arm(Date.parse(match.scheduledAt) - Date.now());
  }
  return { accepted: true as const, mode: "local" as const, registered: manifest.matches.length };
}

/** Once at gateway startup, restore only events explicitly registered with this local adapter. */
export async function restoreLocalChampionshipSchedules(db: DrizzleDB) {
  if (!isLocalGameRuntime() || process.env.CHAMPIONSHIP_SCHEDULER_URL) return;
  const events = await db.selectDistinct({ eventId: schema.competitionAudit.eventId }).from(schema.competitionAudit)
    .innerJoin(schema.championshipEvents, eq(schema.championshipEvents.id, schema.competitionAudit.eventId))
    .where(and(eq(schema.competitionAudit.action, "local_scheduler_enabled"), eq(schema.championshipEvents.status, "running")));
  for (const event of events) if (event.eventId) await synchronizeLocalChampionshipSchedules(db, event.eventId);
}
export function stopLocalChampionshipTimers() { for (const timer of localTimers.values()) clearTimeout(timer); localTimers.clear(); }
