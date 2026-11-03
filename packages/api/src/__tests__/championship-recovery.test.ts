import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster, readFrozenCompetitionBuild } from "../services/championships.js";
import { activateChampionship, pauseChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "../services/championship-awards.js";
import { reconcileChampionships } from "../services/championship-runtime.js";
import { testPayloadStore } from "./payload-test-store.js";

async function activatedFixture() {
  const fixture = await championshipFixture();
  await configureChampionshipDraft(fixture.db, fixture.event.id, { policies, startDate: "2026-12-01" });
  await lockChampionshipRoster(fixture.db, fixture.event.id, fixture.actorId, randomUUID());
  await activateChampionship(fixture.db, fixture.event.id, fixture.actorId, randomUUID());
  await prepareChampionshipAwards(fixture.db, fixture.event.id);
  return fixture;
}

test("award delivery rolls back an interrupted allocation and retries without duplicate grants", async () => {
  const { db, event } = await activatedFixture();
  let transactions = 0;
  type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
  const faulting = new Proxy(db, { get(target, property) {
    if (property !== "transaction") return Reflect.get(target, property, target);
    return async (callback: (tx: Tx) => Promise<unknown>) => {
      return target.transaction(async tx => callback(new Proxy(tx, { get(transaction, key) {
        if (key !== "transaction") return Reflect.get(transaction, key, transaction);
        return async (grant: (nested: Tx) => Promise<unknown>) => {
          if (++transactions === 2) throw new Error("Simulated delivery process failure");
          return transaction.transaction(grant);
        };
      } })));
    };
  } });
  await expect(deliverChampionshipAwards(faulting, event.id)).rejects.toThrow("Simulated delivery process failure");
  expect(await db.select().from(schema.awardGrants)).toHaveLength(0);
  expect((await db.select().from(schema.championshipAwardAllocations))[0]!.deliveredAt).toBeNull();
  await deliverChampionshipAwards(db, event.id);
  const delivered = await db.select().from(schema.awardGrants);
  expect(delivered).toHaveLength(8);
  await deliverChampionshipAwards(db, event.id);
  expect(await db.select().from(schema.awardGrants)).toEqual(delivered);
});

test("corrupt award evidence defers delivery without preventing a due match from starting", async () => {
  const { db, event } = await activatedFixture();
  const [allocation] = await db.select().from(schema.championshipAwardAllocations);
  const original = testPayloadStore.objects.get(allocation!.grants.key)!;
  testPayloadStore.objects.set(allocation!.grants.key, new Uint8Array([0]));
  try {
    const result = await reconcileChampionships(db, "2026-12-01T00:00:00.000Z");
    expect(result.dispatched).toHaveLength(1);
    expect(result.dispatched[0]).toMatchObject({ eventId: event.id, ordinal: 1, deferred: false });
    expect(result.diagnostics.some(item => item.eventId === event.id && item.phase === "delivery")).toBe(true);
    const [match] = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.ordinal, 1));
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, match!.gameId!));
    expect(game!.status).toBe("in_progress");
    expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("running");
    expect(await db.select().from(schema.awardGrants)).toHaveLength(0);
  } finally { testPayloadStore.objects.set(allocation!.grants.key, original); }
  await deliverChampionshipAwards(db, event.id);
  expect(await db.select().from(schema.awardGrants)).toHaveLength(8);
});


test("old activation and pause retries cannot reverse a later producer decision", async () => {
  const { db, event, actorId } = await activatedFixture();
  const pause = randomUUID(), resume = randomUUID(), alreadyActive = randomUUID(), alreadyPaused = randomUUID();
  await activateChampionship(db, event.id, actorId, alreadyActive);
  await pauseChampionship(db, event.id, actorId, pause);
  await pauseChampionship(db, event.id, actorId, alreadyPaused);
  await activateChampionship(db, event.id, actorId, resume);
  expect((await pauseChampionship(db, event.id, actorId, alreadyPaused)).status).toBe("running");
  expect((await pauseChampionship(db, event.id, actorId, pause)).status).toBe("running");
  await pauseChampionship(db, event.id, actorId, randomUUID());
  expect((await activateChampionship(db, event.id, actorId, resume)).status).toBe("paused");
  expect((await activateChampionship(db, event.id, actorId, alreadyActive)).status).toBe("paused");
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("paused");
  await expect(activateChampionship(db, event.id, actorId, pause)).rejects.toThrow("another operation");
});

test("roster lock repairs a legacy revision pointer before the Influence finale is admitted", async () => {
  const { db, event, actorId, agents } = await championshipFixture();
  const [before] = await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agents[0]!));
  await db.update(schema.agentProfiles).set({ currentRevisionId: null }).where(eq(schema.agentProfiles.id, agents[0]!));
  await configureChampionshipDraft(db, event.id, { policies, startDate: "2026-12-01" });
  await lockChampionshipRoster(db, event.id, actorId, randomUUID());
  const [entry] = await db.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.agentId, agents[0]!));
  expect(entry!.sourceRevisionId).toBe(before!.currentRevisionId);
  await activateChampionship(db, event.id, actorId, randomUUID());
  const finale = await dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z");
  const seats = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, finale.gameId!));
  expect(seats).toHaveLength(8);
  expect(seats.find(seat => seat.agentProfileId === agents[0])!.agentRevisionId).toBe(before!.currentRevisionId);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, finale.gameId!)))[0]!.status).toBe("in_progress");
});


test("roster lock freezes the resolved Werewolf fallback without changing live owner notes", async () => {
  const { db, event, actorId, agents } = await championshipFixture();
  await db.update(schema.agentProfiles).set({ werewolfStrategyStyle: null, personaKey: "diplomat" }).where(eq(schema.agentProfiles.id, agents[0]!));
  await configureChampionshipDraft(db, event.id, { policies, startDate: "2026-12-01" });
  await lockChampionshipRoster(db, event.id, actorId, randomUUID());
  const build = await readFrozenCompetitionBuild(db, event.id, agents[0]!);
  expect(build.character.werewolfStrategyStyle).toContain("Compare competing cases");
  expect((await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agents[0]!)))[0]!.werewolfStrategyStyle).toBeNull();
  await activateChampionship(db, event.id, actorId, randomUUID());
  const first = await dispatchChampionshipMatch(db, event.id, 1, "2026-12-01T00:00:00.000Z");
  const { readWerewolfEvents } = await import("../services/werewolf-games.js");
  const initial = (await readWerewolfEvents(db, first.gameId!))[0]!;
  if (initial.type !== "werewolf.started") throw new Error("Missing start evidence");
  expect(initial.payload.players.find(player => player.agentProfileId === agents[0])!.strategy).toBe(build.character.werewolfStrategyStyle!);
});
