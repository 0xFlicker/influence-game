import { beforeEach, expect, test } from "bun:test";
import { eq, gt } from "drizzle-orm";
import { completedWerewolfResultsFixture, werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { fixtureRetrospectiveCapacity } from "@influence/engine";
import { runWerewolf } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { readHouseGameRetrospective } from "../services/house-game-retrospective.js";
import { createGameResultsRoutes } from "../routes/game-results.js";
import { setupTestDB } from "./test-utils.js";
import { createCompletedCanonicalEventFixture, insertCanonicalEventRows, insertOwner } from "./durable-run-test-utils.js";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function wolf() {
  const events = await completedWerewolfResultsFixture("village", "rt09-wolf");
  await db.insert(schema.games).values({ id: "rt09-wolf", slug: "rt09-wolf-slug", gameKind: "werewolf", status: "completed", config: '{"visibility":"unlisted"}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: event.gameId, sequence: event.sequence, event })));
  return events;
}
function forge(cursor: string, fields: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, "base64url").toString()), ...fields })).toString("base64url");
}
test.each(["influence", "werewolf"] as const)("%s reader exposes exact accepted speeches and canonical parts without private context", async gameKind => {
  const id = gameKind === "werewolf" ? "rt09-wolf" : "rt09-influence";
  if (gameKind === "werewolf") await wolf();
  else {
    await db.insert(schema.games).values({ id, slug: id, status: "completed", config: '{}' });
    await insertCanonicalEventRows(db, id, await insertOwner(db, id), createCompletedCanonicalEventFixture(id));
  }
  const first = await readHouseGameRetrospective(db, { gameIdOrSlug: id, gameKind, limit: 1 });
  expect(first.progress.status).toBe("completed"); expect(first.statements).toHaveLength(1);
  expect(first.speakers.map(speaker => speaker.ordinal)).toEqual(first.speakers.map((_, i) => i));
  const all = [...first.statements]; let cursor = first.nextCursor;
  while (cursor) { const page = await readHouseGameRetrospective(db, { gameIdOrSlug: id, cursor, limit: 1 }); all.push(...page.statements); cursor = page.nextCursor; }
  expect(all.map(statement => statement.actorId)).toEqual(first.speakers.map(speaker => speaker.actorId));
  expect(all.every(statement => gameKind === "werewolf" ? statement.href.includes("cursor=") : statement.href.endsWith(`/replay/${statement.eventSequence}`))).toBeTrue();
  for (const privateValue of ["SECRET_STRATEGY", "SECRET_THINKING", "SECRET_PACK", "SECRET_SEED", "inputHash", "providerLogicalCallId"]) expect(JSON.stringify(first)).not.toContain(privateValue);
  await expect(readHouseGameRetrospective(db, { gameIdOrSlug: id, gameKind: gameKind === "werewolf" ? "influence" : "werewolf" })).rejects.toMatchObject({ code: "unsupported_game_kind" });
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, id));
  await expect(readHouseGameRetrospective(db, { gameIdOrSlug: id, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "not_accessible" });
});
test("pinned pages survive growth, polling adopts only a validated head and forged prefix claims fail", async () => {
  const events = await wolf(), speeches = events.filter(event => event.type === "werewolf.retrospective_statement_recorded"), head = speeches[1]!.sequence;
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, "rt09-wolf"));
  await db.delete(schema.werewolfEvents).where(gt(schema.werewolfEvents.sequence, head));
  const first = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", limit: 1 });
  await db.insert(schema.werewolfEvents).values(events.filter(event => event.sequence > head).map(event => ({ gameId: event.gameId, sequence: event.sequence, event })));
  const pinned = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", cursor: first.nextCursor! });
  expect(pinned.source).toEqual(first.source); expect(pinned.statements.map(statement => statement.ordinal)).toEqual([1]);
  const growth = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", cursor: pinned.pollCursor! });
  expect(growth.statements.map(statement => statement.ordinal)).toEqual([2, 3, 4, 5]);
  for (const fields of [{ statementCount: 1, afterOrdinal: 1 }, { throughHash: `sha256:${"0".repeat(64)}` }, { definitionHash: null }, { gameId: "another" }, { extra: true }])
    await expect(readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", cursor: forge(pinned.pollCursor!, fields) })).rejects.toMatchObject({ code: "invalid_cursor" });
  // Even a pinned old page refuses a corrupted suffix.
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence, speeches[3]!.sequence));
  await expect(readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", cursor: first.nextCursor! })).rejects.toMatchObject({ code: "unavailable" });
});
test("outcome-only reads are pending and completed catalogs require the final proof", async () => {
  const events = await wolf(), outcome = events.find(event => event.type === "werewolf.completed")!;
  await db.delete(schema.werewolfEvents).where(gt(schema.werewolfEvents.sequence, outcome.sequence));
  await expect(readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf" })).rejects.toMatchObject({ code: "unavailable" });
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, "rt09-wolf"));
  const pending = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf" });
  expect(pending).toMatchObject({ initialized: false, speakers: [], statements: [], progress: { status: "pending" } });
  expect(pending.pollCursor).toBeString();
  await db.insert(schema.werewolfEvents).values(events.filter(event => event.sequence > outcome.sequence).map(event => ({ gameId: event.gameId, sequence: event.sequence, event })));
  expect((await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-wolf", cursor: pending.pollCursor! })).statements).toHaveLength(6);
  const app = createGameResultsRoutes(db);
  expect((await app.request('/api/games/rt09-wolf/retrospective?limit=0')).status).toBe(400);
  expect((await app.request('/api/games/rt09-wolf/retrospective?private=true')).status).toBe(400);
});
test("multibyte speeches page as whole entries below the exact wire budget without writing", async () => {
  const events = await werewolfResultsFixture("saved", "rt09-big");
  await runWerewolf({ read: async () => structuredClone(events), append: async event => { events.push(event); } }, {
    prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, async getRetrospectiveStatement() { return { speech: "😀".repeat(2000) }; }, async decide() { throw Error("No gameplay"); },
  });
  await db.insert(schema.games).values({ id: "rt09-big", slug: "rt09-big", gameKind: "werewolf", status: "completed", config: '{}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: event.gameId, sequence: event.sequence, event })));
  const first = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-big", limit: 20 });
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(64 * 1024); expect(first.nextCursor).toBeString();
  expect(first.statements.every(statement => statement.speech === "😀".repeat(2000))).toBeTrue();
  const rest = await readHouseGameRetrospective(db, { gameIdOrSlug: "rt09-big", cursor: first.nextCursor! });
  expect(first.statements.length + rest.statements.length).toBe(8);
  expect(await db.select().from(schema.gameRetrospectiveInputs)).toHaveLength(0);
  expect(await db.select().from(schema.providerLogicalCalls)).toHaveLength(0);
});
