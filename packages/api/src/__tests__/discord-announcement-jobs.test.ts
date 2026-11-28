import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { createDiscordAgentRoutes } from "../routes/discord-agent.js";
import {
  enqueueDiscordAnnouncement, type DiscordAnnouncementKind, type DiscordAnnouncementLease,
} from "../services/discord-announcement-jobs.js";
import { createCompletedCanonicalEventFixture, insertCanonicalEventRows, insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const channelId = "1521921716224393437";
const otherChannelId = "1521921716224393439";
const messageId = "1521921716224393441";
const controller = "discord-announcement-jobs-fixture".repeat(3);
const jobs = schema.discordAnnouncementJobs;
const configuration = { DISCORD_ANNOUNCEMENT_CHANNEL_ID: channelId, DISCORD_CONTROLLER_TOKEN: controller };
const original = Object.fromEntries(Object.keys(configuration).map(key => [key, process.env[key]]));
let db: DrizzleDB;
let app: ReturnType<typeof createDiscordAgentRoutes>;

beforeEach(async () => {
  Object.assign(process.env, configuration);
  db = await setupTestDB();
  app = createDiscordAgentRoutes(db);
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function request(action: string, body: object, token = controller) {
  return app.request("/api/internal/discord/agent/announcement-" + action, {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function claim() {
  const response = await request("claim", { channelId });
  expect(response.status).toBe(200);
  const { job } = await response.json() as { job: (DiscordAnnouncementLease & {
    facts: { gameKind: "influence" | "werewolf"; season: string | null; turningPoints?: unknown[] };
    kind: DiscordAnnouncementKind; url: string;
  }) | null };
  if (!job) return null;
  const { id, lease, kind, facts, url } = job;
  expect(job.channelId).toBe(channelId);
  return { binding: { id, lease, channelId }, kind, facts, url };
}

async function liveGame(id = "live") {
  await db.insert(schema.games).values({ id, slug: id, status: "in_progress", config: '{"visibility":"public"}' });
  await db.transaction(tx => enqueueDiscordAnnouncement(tx, id, "start"));
  return id;
}

test("only new configured Public transitions record a job in the caller's transaction", async () => {
  delete process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  await liveGame("before-activation");
  expect(await db.select().from(jobs)).toEqual([]);
  expect((await request("claim", { channelId })).status).toBe(403);
  process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = channelId;
  const publicId = await liveGame("public");
  await db.transaction(tx => enqueueDiscordAnnouncement(tx, publicId, "start"));
  await db.insert(schema.games).values([
    { id: "hidden", slug: "hidden", status: "in_progress", config: "{}", hiddenAt: "2026-11-27" },
    { id: "unlisted", slug: "unlisted", status: "in_progress", config: '{"visibility":"unlisted"}' },
  ]);
  await db.transaction(async tx => {
    await enqueueDiscordAnnouncement(tx, "hidden", "start");
    await enqueueDiscordAnnouncement(tx, "unlisted", "start");
  });
  await expect(db.transaction(async tx => {
    await tx.insert(schema.games).values({ id: "rolled-back", slug: "rolled-back", status: "in_progress", config: "{}" });
    await enqueueDiscordAnnouncement(tx, "rolled-back", "start");
    throw new Error("abort game commit");
  })).rejects.toThrow("abort game commit");
  expect(await db.select({ gameId: jobs.gameId, kind: jobs.kind, channel: jobs.channelId }).from(jobs))
    .toEqual([{ gameId: publicId, kind: "start", channel: channelId }]);
});

test("controller and destination binding fence concurrent claims and exact posting receipts", async () => {
  const game = await liveGame();
  await db.insert(schema.seasons).values({ id: "season", name: "Current Season", slug: "current" });
  await db.update(schema.games).set({ seasonId: "season" }).where(eq(schema.games.id, game));
  expect((await request("claim", { channelId }, "untrusted")).status).toBe(401);
  expect((await request("claim", { channelId: otherChannelId })).status).toBe(403);
  expect((await request("claim", { channelId, grant: "fake-user-turn" })).status).toBe(400);
  const claimed = (await Promise.all([claim(), claim()])).filter(value => value !== null);
  expect(claimed).toHaveLength(1);
  const { binding, ...job } = claimed[0]!;
  expect(job).toEqual({
    kind: "start", url: "https://thehouse.game/games/live",
    facts: { gameKind: "influence", season: "Current Season" },
  });
  expect(await (await request("begin", { ...binding, lease: randomUUID() })).json()).toEqual({ authorized: false });
  expect(await (await request("complete", { ...binding, outcome: "posted", messageId })).json()).toEqual({ ok: false });
  const begun = await (await request("begin", binding)).json();
  expect(begun).toMatchObject({ authorized: true, nonce: expect.stringMatching(/^a-[A-Za-z0-9_-]{23}$/) });
  expect(await (await request("begin", binding)).json()).toEqual({ authorized: false });
  expect(await (await request("complete", { ...binding, outcome: "retry" })).json()).toEqual({ ok: false });
  expect((await request("complete", { ...binding, outcome: "posted", messageId: "invalid" })).status).toBe(400);
  const receipt = { ...binding, outcome: "posted", messageId };
  expect(await (await request("complete", receipt)).json()).toEqual({ ok: true });
  expect(await (await request("complete", receipt)).json()).toEqual({ ok: true });
  expect(await (await request("complete", { ...receipt, messageId: "1521921716224393442" })).json()).toEqual({ ok: false });
  expect(await claim()).toBeNull();
});

test("an expired authoring lease can be reissued but uncertain Discord sends cannot", async () => {
  await liveGame();
  let adopted = (await claim())!;
  for (let abandoned = 0; abandoned < 4; abandoned++) {
    const prior = adopted.binding;
    await db.update(jobs).set({ leaseUntil: new Date(0) }).where(eq(jobs.id, prior.id));
    adopted = (await claim())!;
    expect(adopted.binding.id).toBe(prior.id);
    expect(adopted.binding.lease).not.toBe(prior.lease);
    expect(await (await request("begin", prior)).json()).toEqual({ authorized: false });
  }
  expect((await db.select().from(jobs))[0]?.attempts).toBe(0);
  expect(await (await request("begin", adopted.binding)).json()).toMatchObject({ authorized: true });
  await db.update(jobs).set({ leaseUntil: new Date(0) }).where(eq(jobs.id, adopted.binding.id));
  expect(await claim()).toBeNull();
  expect((await db.select().from(jobs))[0]).toMatchObject({ state: "unconfirmed", messageId: null });
  expect(await (await request("complete", { ...adopted.binding, outcome: "rate_limited" })).json()).toEqual({ ok: false });
});

test("pre-send retries apply backoff and stop after the third failure", async () => {
  await liveGame();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { binding } = (await claim())!;
    expect(await (await request("complete", { ...binding, outcome: "retry" })).json()).toEqual({ ok: true });
    expect(await claim()).toBeNull();
    const [job] = await db.select().from(jobs);
    expect(job).toMatchObject({ state: attempt < 3 ? "pending" : "failed", attempts: attempt, lease: null });
    expect(job!.nextAttemptAt.valueOf()).toBeGreaterThan(Date.now());
    await db.update(jobs).set({ nextAttemptAt: new Date(0) }).where(eq(jobs.id, binding.id));
  }
  expect(await claim()).toBeNull();
});

test("only a rate-limited send can be re-leased after the requested delay with the same nonce", async () => {
  await liveGame();
  const { binding } = (await claim())!;
  const rateLimited = { ...binding, outcome: "rate_limited", retryAfterSeconds: 90.5 };
  expect(await (await request("complete", rateLimited)).json()).toEqual({ ok: false });
  const firstApproval = await (await request("begin", binding)).json() as { authorized: boolean; nonce: string };
  expect(firstApproval.authorized).toBe(true);
  expect(firstApproval.nonce).toMatch(/^a-[A-Za-z0-9_-]{23}$/);
  for (const retryAfterSeconds of [-1, 86_401, "90", null]) {
    expect((await request("complete", { ...rateLimited, retryAfterSeconds })).status).toBe(400);
  }

  const completionStartedAt = Date.now();
  expect(await (await request("complete", rateLimited)).json()).toEqual({ ok: true });
  const [delayed] = await db.select().from(jobs);
  expect(delayed).toMatchObject({ state: "pending", attempts: 1, lease: null, leaseUntil: null, messageId: null });
  expect(delayed!.nextAttemptAt.valueOf()).toBeGreaterThan(completionStartedAt + 90_000);
  expect(await claim()).toBeNull();

  await db.update(jobs).set({ nextAttemptAt: new Date(0) }).where(eq(jobs.id, binding.id));
  const retry = (await claim())!.binding;
  expect(retry.id).toBe(binding.id);
  expect(retry.lease).not.toBe(binding.lease);
  expect(await (await request("complete", rateLimited)).json()).toEqual({ ok: false });
  expect(await (await request("begin", retry)).json()).toEqual(firstApproval);
  const fallbackStartedAt = Date.now();
  expect(await (await request("complete", { ...retry, outcome: "rate_limited" })).json()).toEqual({ ok: true });
  const [fallback] = await db.select().from(jobs);
  expect(fallback!.nextAttemptAt.valueOf()).toBeGreaterThan(fallbackStartedAt + 29_500);
  await db.update(jobs).set({ nextAttemptAt: new Date(0) }).where(eq(jobs.id, binding.id));
  const finalClaim = (await claim())!.binding;
  expect(await (await request("begin", finalClaim)).json()).toEqual(firstApproval);
  expect(await (await request("complete", { ...finalClaim, outcome: "posted", messageId })).json()).toEqual({ ok: true });
  expect(await (await request("complete", rateLimited)).json()).toEqual({ ok: false });
  expect(await claim()).toBeNull();
  expect(await db.select({ state: jobs.state, messageId: jobs.messageId }).from(jobs)).toEqual([{ state: "posted", messageId }]);
});

test("claim suppresses stale starts and begin rechecks Public visibility", async () => {
  await liveGame("ended");
  await db.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, "ended"));
  expect(await claim()).toBeNull();
  const id = await liveGame("restricted");
  const { binding } = (await claim())!;
  await db.update(schema.games).set({ config: '{"visibility":"unlisted"}' }).where(eq(schema.games.id, id));
  expect(await (await request("begin", binding)).json()).toEqual({ authorized: false });
  expect(await db.select({ state: jobs.state }).from(jobs)).toEqual([{ state: "suppressed" }, { state: "suppressed" }]);
});

test("recap claims expose only canonical bounded results and a safe replay URL for each game", async () => {
  const influence = await insertGame(db, { slug: "influence-finish", status: "completed", config: { visibility: "public" } });
  const owner = await insertOwner(db, influence);
  await insertCanonicalEventRows(db, influence, owner, createCompletedCanonicalEventFixture(influence));
  await db.transaction(tx => enqueueDiscordAnnouncement(tx, influence, "finish"));
  const recap = (await claim())!;
  expect(Array.isArray(recap.facts.turningPoints)).toBe(true);
  expect(recap.facts.turningPoints!.length).toBeLessThanOrEqual(3);
  expect(recap).toMatchObject({ kind: "finish", url: "https://thehouse.game/games/influence-finish/replay",
    facts: { gameKind: "influence", outcome: { winner: expect.any(String) } } });

  const wolf = "werewolf-finish";
  const events = await completedWerewolfResultsFixture("village", wolf);
  await db.insert(schema.games).values({ id: wolf, slug: wolf, gameKind: "werewolf", status: "in_progress", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: wolf, sequence: event.sequence, event })));
  await db.transaction(tx => enqueueDiscordAnnouncement(tx, wolf, "start"));
  const opening = (await claim())!;
  expect(opening).toMatchObject({ kind: "start", url: "https://thehouse.game/games/werewolf-finish/replay?audience=mystery",
    facts: { gameKind: "werewolf", season: null } });
  await db.transaction(async tx => {
    await tx.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, wolf));
    await enqueueDiscordAnnouncement(tx, wolf, "finish");
  });
  expect(await (await request("begin", opening.binding)).json()).toEqual({ authorized: false });
  const ending = (await claim())!;
  expect(Array.isArray(ending.facts.turningPoints)).toBe(true);
  expect(ending.facts.turningPoints!.length).toBeLessThanOrEqual(3);
  expect(ending).toMatchObject({ kind: "finish", url: "https://thehouse.game/games/werewolf-finish/replay?audience=mystery",
    facts: { gameKind: "werewolf", outcome: { faction: "village" } } });
  expect(JSON.stringify(ending)).not.toMatch(/SECRET_|investigation|protectedId|roles|thinking/);
});
