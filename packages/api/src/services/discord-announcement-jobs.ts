import { createHash } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { discordIdPattern } from "../game-mcp/discord-turn.js";
import { isViewerGame, storedGameVisibility } from "./game-visibility.js";

const jobs = schema.discordAnnouncementJobs;
const games = schema.games;
const maxRetryFailures = 3;
const leaseDeadline = sql`now() + interval '2 minutes'`;
const activeLease = sql`${jobs.leaseUntil} > now()`;
const expiredLease = lte(jobs.leaseUntil, sql`now()`);

export type DiscordAnnouncementKind = typeof jobs.$inferSelect.kind;
export type DiscordAnnouncementLease = {
  id: string;
  lease: string;
  channelId: string;
};
export type DiscordAnnouncementClaim = DiscordAnnouncementLease & {
  gameId: string;
  kind: DiscordAnnouncementKind;
};
export type DiscordAnnouncementCompletion = DiscordAnnouncementLease & (
  | { outcome: "posted"; messageId: string }
  | { outcome: "retry" | "failed" | "unconfirmed" }
  | { outcome: "rate_limited"; retryAfterSeconds?: number }
);

export function configuredDiscordAnnouncementChannel() {
  const channel = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  return channel && discordIdPattern.test(channel) ? channel : null;
}

function isPublicGame(game: { id: string; config: string; hiddenAt: string | null } | undefined) {
  return !!game && isViewerGame(game) && storedGameVisibility(game.config) === "public";
}

export async function enqueueDiscordAnnouncement(tx: Pick<DrizzleDB, "select" | "insert">, gameId: string, kind: DiscordAnnouncementKind) {
  const channelId = configuredDiscordAnnouncementChannel();
  if (!channelId) return;
  const [game] = await tx.select({ id: games.id, config: games.config, hiddenAt: games.hiddenAt })
    .from(games).where(eq(games.id, gameId));
  if (!isPublicGame(game)) return;
  await tx.insert(jobs).values({ gameId, kind, channelId }).onConflictDoNothing({ target: [jobs.gameId, jobs.kind] });
}

export async function readEligibleDiscordAnnouncementGame(db: Pick<DrizzleDB, "select">, job: { gameId: string; kind: DiscordAnnouncementKind }) {
  const [game] = await db.select({ id: games.id, slug: games.slug, gameKind: games.gameKind, status: games.status,
    config: games.config, hiddenAt: games.hiddenAt, seasonId: games.seasonId }).from(games).where(eq(games.id, job.gameId));
  if (!game || !isPublicGame(game) || game.status !== (job.kind === "start" ? "in_progress" : "completed")) return null;
  return game;
}

function logUnconfirmed(job: Pick<DiscordAnnouncementLease, "id" | "channelId">) {
  console.warn(JSON.stringify({ event: "discord_announcement_unconfirmed", jobId: job.id, channelId: job.channelId }));
}

export async function claimDiscordAnnouncementLease(db: DrizzleDB, channelId: string): Promise<DiscordAnnouncementClaim | null> {
  if (channelId !== configuredDiscordAnnouncementChannel()) return null;
  // A worker may have posted before a connection failure. These rows are never re-leased.
  const expired = await db.update(jobs).set({ state: "unconfirmed", leaseUntil: null })
    .where(and(eq(jobs.channelId, channelId), eq(jobs.state, "sending"), expiredLease)).returning({ id: jobs.id });
  for (const job of expired) logUnconfirmed({ ...job, channelId });
  const [claimed] = await db.execute<DiscordAnnouncementClaim>(sql`
    UPDATE ${jobs} SET lease = gen_random_uuid(), lease_until = ${leaseDeadline}
    WHERE id = (
      SELECT id FROM ${jobs}
      WHERE channel_id = ${channelId} AND state = 'pending'
        AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
      ORDER BY next_attempt_at, created_at, id
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, lease, channel_id AS "channelId", game_id AS "gameId", kind`);
  return claimed ?? null;
}

function matchLease(input: DiscordAnnouncementLease) {
  return and(eq(jobs.id, input.id), eq(jobs.channelId, input.channelId), eq(jobs.lease, input.lease));
}

export async function suppressDiscordAnnouncementClaim(db: DrizzleDB, input: DiscordAnnouncementLease) {
  await db.update(jobs).set({ state: "suppressed", leaseUntil: null })
    .where(and(matchLease(input), eq(jobs.state, "pending"), activeLease));
}

export async function beginDiscordAnnouncement(db: DrizzleDB, input: DiscordAnnouncementLease) {
  if (input.channelId !== configuredDiscordAnnouncementChannel()) return { authorized: false } as const;
  return db.transaction(async tx => {
    const [job] = await tx.select({ id: jobs.id, gameId: jobs.gameId, kind: jobs.kind }).from(jobs)
      .where(and(matchLease(input), eq(jobs.state, "pending"), activeLease)).for("update");
    if (!job) return { authorized: false } as const;
    if (!await readEligibleDiscordAnnouncementGame(tx, job)) {
      await tx.update(jobs).set({ state: "suppressed", leaseUntil: null }).where(eq(jobs.id, input.id));
      return { authorized: false } as const;
    }
    await tx.update(jobs).set({ state: "sending", leaseUntil: leaseDeadline }).where(eq(jobs.id, input.id));
    const nonce = "a-" + createHash("sha256").update(job.id).digest("base64url").slice(0, 23);
    return { authorized: true, nonce } as const;
  });
}

export async function completeDiscordAnnouncement(db: DrizzleDB, input: DiscordAnnouncementCompletion) {
  if (input.channelId !== configuredDiscordAnnouncementChannel()) return false;
  return db.transaction(async tx => {
    const [job] = await tx.select({ state: jobs.state, attempts: jobs.attempts, messageId: jobs.messageId,
      leaseIsActive: sql<boolean>`coalesce(${activeLease}, false)` }).from(jobs).where(matchLease(input)).for("update");
    if (!job) return false;
    if (job.state === "posted" && input.outcome === "posted") return job.messageId === input.messageId;
    if (!job.leaseIsActive || (job.state !== "pending" && job.state !== "sending")) return false;
    if (input.outcome === "retry" || input.outcome === "rate_limited") {
      // A definite Discord 429 can safely release send intent. Other retries are pre-send only.
      if (job.state !== (input.outcome === "rate_limited" ? "sending" : "pending")) return false;
      const attempts = job.attempts + 1;
      const serverDelay = input.outcome === "rate_limited" ? input.retryAfterSeconds ?? 0 : 0;
      const delay = Math.max(serverDelay, 15 * 2 ** job.attempts);
      await tx.update(jobs).set({ state: attempts < maxRetryFailures ? "pending" : "failed", attempts, lease: null, leaseUntil: null,
        nextAttemptAt: sql`now() + ${delay} * interval '1 second'` }).where(eq(jobs.id, input.id));
      return true;
    }
    if (input.outcome !== "failed" && job.state !== "sending") return false;
    await tx.update(jobs).set({ state: input.outcome, leaseUntil: null, messageId: input.outcome === "posted" ? input.messageId : null })
      .where(eq(jobs.id, input.id));
    if (input.outcome === "unconfirmed") logUnconfirmed(input);
    return true;
  });
}
