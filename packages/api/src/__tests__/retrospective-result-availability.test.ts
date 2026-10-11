import { afterAll, expect, test } from "bun:test";
import { eq, gt } from "drizzle-orm";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createCompletedCanonicalEventFixture, insertCanonicalEventRows, insertGame, insertOwner } from "./durable-run-test-utils.js";
import { readHouseGameResults } from "../services/house-game-results.js";
import { readHouseGame } from "../services/house-game-inspection.js";
import { getGameWatchState } from "../services/game-watch-state.js";
import { createGameRoutes } from "../routes/games.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createSessionToken } from "../middleware/auth.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { encodeHouseCursor } from "../services/house-read-cursor.js";

const previousJwt = process.env.JWT_SECRET;
afterAll(() => { if (previousJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwt; });

test("Influence retrospective dialogue cannot run ahead of its accepted canonical statement", async () => {
  const db = await setupTestDB(), id = await insertGame(db, { status: "in_progress", config: { visibility: "public" } });
  const events = createCompletedCanonicalEventFixture(id).map(event => event.type === "retrospective.statement_recorded"
    ? { ...event, sourcePointers: [{ kind: "transcript_entry" as const, sequence: event.payload.ordinal + 1 }] } : event);
  const owner = await insertOwner(db, id);
  await insertCanonicalEventRows(db, id, owner, events);
  for (const event of events) if (event.type === "retrospective.statement_recorded") await db.insert(schema.transcripts).values({
    gameId: id, round: event.round, phase: "RETROSPECTIVE", scope: "public", timestamp: Date.parse(event.timestamp),
    fromPlayerId: event.payload.actorId, speakerPlayerId: event.payload.actorId, text: event.payload.speech,
    entrySequence: event.payload.ordinal + 1, audiencePlayerIds: [], captureVersion: 1, safeContext: { version: 1 },
  });
  let page = await readHouseGame(db, { gameIdOrSlug: id, view: "replay", limit: 2 }), speeches = 0;
  for (;;) {
    if (page.gameKind !== "influence") throw Error("wrong game");
    for (const speech of page.dialogue) {
      expect(speech.retrospectiveSource!.eventSequence).toBeLessThanOrEqual(page.position.eventSequence);
      speeches++;
    }
    if (!page.nextCursor) break;
    page = await readHouseGame(db, { gameIdOrSlug: id, cursor: page.nextCursor, limit: 2 });
  }
  expect(speeches).toBe(4);
  const forged = encodeHouseCursor({ version: 1, gameId: id, gameKind: "influence", audience: "public", lane: "history", actorId: null,
    after: [1, 1], through: [events.length, 4], cutoff: [], poll: false });
  await expect(readHouseGame(db, { gameIdOrSlug: id, cursor: forged })).rejects.toMatchObject({ code: "invalid_cursor" });
});

test("Influence publishes canonical results during the epilogue without claiming execution is final", async () => {
  const db = await setupTestDB(), id = await insertGame(db, { status: "in_progress", config: { visibility: "public" } });
  const events = createCompletedCanonicalEventFixture(id), outcome = events.find(event => event.type === "jury.winner_determined")!;
  const owner = await insertOwner(db, id);
  await insertCanonicalEventRows(db, id, owner, events.filter(event => event.sequence <= outcome.sequence));
  const pending = await readHouseGameResults(db, id);
  expect(pending).toMatchObject({ ok: true, gameKind: "influence", game: { status: "in_progress" }, results: { summary: { winner: { id: "atlas" } } },
    retrospective: { status: "pending", statementCount: 0, requiredStatements: 4, outcome: { eventSequence: outcome.sequence } } });
  const watch = await getGameWatchState(db, id);
  expect(watch).toMatchObject({ winner: { id: "atlas" }, final: { status: "not_final" }, retrospective: { status: "pending" } });
  const earlier = await readHouseGame(db, { gameIdOrSlug: id, view: "replay", limit: 1 });
  expect(earlier.capabilities.results).toBe(false);
  expect(earlier.links.results).toBeNull();
  expect(JSON.stringify(earlier)).not.toContain("jury.winner_determined");
  const current = await readHouseGame(db, { gameIdOrSlug: id, view: "current", limit: 1 });
  expect(current.capabilities.results).toBe(true);
  expect(current.pollCursor).not.toBeNull();
  const first = events.find(event => event.type === "retrospective.statement_recorded")!;
  await insertCanonicalEventRows(db, id, owner, events.filter(event => event.sequence > outcome.sequence && event.sequence <= first.sequence));
  await db.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, id));
  const paused = await readHouseGameResults(db, id);
  expect(paused).toMatchObject({ ok: true, game: { status: "suspended" }, retrospective: { status: "in_progress", statementCount: 1 }, results: { summary: { winner: { id: "atlas" } } } });
  expect(await db.select().from(schema.gameResults)).toHaveLength(0);
  expect(await db.select().from(schema.gameCompletionSettlements)).toHaveLength(0);
  expect(await db.select().from(schema.gamePublications)).toHaveLength(0);
  await db.update(schema.gameEvents).set({ eventHash: `sha256:${"0".repeat(64)}` }).where(eq(schema.gameEvents.sequence, first.sequence));
  expect(await readHouseGameResults(db, id)).toMatchObject({ ok: false, status: "unavailable" });
  expect((await getGameWatchState(db, id))?.winner).toBeUndefined();
});

test("Werewolf outcome and accepted statements remain readable while paused; an earlier Mystery prefix has no ending", async () => {
  const db = await setupTestDB(), id = "retrospective-wolf", events = await completedWerewolfResultsFixture("village", id);
  const outcome = events.find(event => event.type === "werewolf.completed")!, first = events.find(event => event.type === "werewolf.retrospective_statement_recorded")!;
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "in_progress", startedAt: new Date().toISOString(), config: '{"visibility":"public"}' });
  await db.insert(schema.werewolfEvents).values(events.filter(event => event.sequence <= first.sequence).map(event => ({ gameId: id, sequence: event.sequence, event })));
  const result = await readHouseGameResults(db, id);
  expect(result).toMatchObject({ ok: true, gameKind: "werewolf", game: { status: "in_progress" }, retrospective: { status: "in_progress", statementCount: 1, requiredStatements: 6, outcome: { eventSequence: outcome.sequence } } });
  const earlier = await readHouseGame(db, { gameIdOrSlug: id, audience: "mystery", view: "replay", limit: 1 });
  expect(earlier.capabilities.results).toBe(false);
  expect(earlier.links.results).toBeNull();
  expect(JSON.stringify(earlier)).not.toContain('"role"');
  const current = await readHouseGame(db, { gameIdOrSlug: id, audience: "mystery", view: "current", limit: 1 });
  expect(current.capabilities.results).toBe(true);
  expect(current.pollCursor).not.toBeNull();
  await db.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, id));
  expect(await readHouseGameResults(db, id)).toMatchObject({ ok: true, game: { status: "suspended" }, retrospective: { statementCount: 1 } });
  await db.delete(schema.werewolfEvents).where(gt(schema.werewolfEvents.sequence, outcome.sequence - 1));
  expect(await readHouseGameResults(db, id)).toMatchObject({ ok: false, status: "not_completed" });
});

test("post-outcome stop pauses both games and preserves the result and committed frontier", async () => {
  const db = await setupTestDB();
  process.env.JWT_SECRET = "retrospective-pause-fixture";
  await db.insert(schema.users).values({ id: "pause-admin" });
  await grantTestAuthority(db, "pause-admin", ["stop_game"]);
  const token = await createSessionToken("pause-admin", { roles: ["admin"], permissions: ["stop_game"] });
  const request = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
  const influence = await insertGame(db, { status: "in_progress", config: { visibility: "public" } }), owner = await insertOwner(db, influence);
  const influenceEvents = createCompletedCanonicalEventFixture(influence), winner = influenceEvents.find(event => event.type === "jury.winner_determined")!;
  await insertCanonicalEventRows(db, influence, owner, influenceEvents.filter(event => event.sequence <= winner.sequence));
  const response = await createGameRoutes(db).request(`/api/games/${influence}/stop`, request);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "suspended", reasonCode: "retrospective_paused" });
  expect(await readHouseGameResults(db, influence)).toMatchObject({ ok: true, results: { summary: { winner: { id: "atlas" } } } });
  expect((await db.select().from(schema.gameEvents)).at(-1)?.sequence).toBe(winner.sequence);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, influence)))[0]?.endedAt).toBeNull();
  const wolf = "pause-wolf", events = await completedWerewolfResultsFixture("village", wolf), outcome = events.find(event => event.type === "werewolf.completed")!;
  await db.insert(schema.games).values({ id: wolf, slug: wolf, gameKind: "werewolf", status: "in_progress", config: '{"visibility":"public"}' });
  await db.insert(schema.werewolfEvents).values(events.filter(event => event.sequence <= outcome.sequence).map(event => ({ gameId: wolf, sequence: event.sequence, event })));
  const stopped = await createWerewolfRoutes(db).request(`/api/werewolf/${wolf}/stop`, request);
  expect(stopped.status).toBe(200);
  expect(await stopped.json()).toMatchObject({ status: "suspended" });
  expect(await readHouseGameResults(db, wolf)).toMatchObject({ ok: true, game: { status: "suspended" } });
  expect((await db.select().from(schema.werewolfEvents)).at(-1)?.sequence).toBe(outcome.sequence);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, wolf)))[0]?.endedAt).toBeNull();
});
