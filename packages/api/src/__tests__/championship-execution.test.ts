import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { fixtureRetrospectiveCapacity, fixtureWerewolfRetrospective } from "@influence/engine";
import { advanceWerewolf, runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster } from "../services/championships.js";
import { pauseChampionship, activateChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { settleChampionshipMatch, championshipStandings, reconcileChampionshipResults } from "../services/championship-results.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "../services/championship-awards.js";
import { reconcileSeasonAwards } from "../services/season-awards.js";
import { finalizeSeason } from "../services/seasons.js";
import { readSeasonFinalizationSnapshot } from "../services/season-finalization-snapshot.js";
import { readJson } from "../services/payload-storage.js";
import { claimWerewolfGame, createWerewolfStore, readWerewolfEvents, releaseWerewolfOwner } from "../services/werewolf-games.js";
import { adoptInProgressDurableGamesOnStartup } from "../services/startup-durable-games.js";
import { abortAllGames, isGameRunning, startGame } from "../services/game-lifecycle.js";

const scripted: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective,
  async decide({ request, observation }) {
    expect(JSON.stringify(observation)).not.toContain("balanced-roles-v1");
    if ("solo" in request && request.solo) return { kind: "solo_target", targetId: request.legalTargetIds[0]!, text: "Fixture selection", cue: null };
    if (request.action === "speaking_priority") return { kind: "speaking_priority", priority: 50 };
    if (request.action === "conversation") return { kind: "conversation", text: null, cue: null, recipientId: null, replyToContributionId: null };
    if (request.action === "public_vote" || request.action === "pack_propose") return { kind: "spoken_target", targetId: request.legalTargetIds[0]!, text: "Fixture selection", cue: null, thinking: "Fixture" };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: "Fixture", cue: null };
  } };
afterEach(async () => { await abortAllGames(); delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER; });

async function lockedFixture() {
  const fixture = await championshipFixture();
  await fixture.db.update(schema.seasons).set({ status: "closing" }).where(eq(schema.seasons.id, fixture.seasonId));
  await finalizeSeason(fixture.db, fixture.seasonId);
  await reconcileSeasonAwards(fixture.db, fixture.seasonId, fixture.actorId);
  await configureChampionshipDraft(fixture.db, fixture.event.id, { policies, startDate: "2026-12-01" });
  const locked = await lockChampionshipRoster(fixture.db, fixture.event.id, fixture.actorId, randomUUID());
  await activateChampionship(fixture.db, fixture.event.id, fixture.actorId, randomUUID());
  return { ...fixture, locked };
}

test("finalization freezes the full qualification evidence and lock ignores later receipt edits", async () => {
  const { db, seasonId, locked } = await lockedFixture();
  const snapshot = await readSeasonFinalizationSnapshot(db, seasonId);
  expect(snapshot!.qualification).toHaveLength(8);
  expect(snapshot!.receipts).toHaveLength(8);
  await db.update(schema.competitionReceipts).set({ totalPoints: 0, basePoints: 0 }).where(eq(schema.competitionReceipts.seasonId, seasonId));
  expect((await readJson(locked.qualification!))[0]!.seasonPoints).toBe(100);
  expect(await readSeasonFinalizationSnapshot(db, seasonId)).toEqual(snapshot);
});

test("sixteen real canonical Werewolf runs settle once, survive owner replacement, and allocate audited awards", async () => {
  const { db, event, actorId, agents, locked } = await lockedFixture();
  await db.update(schema.agentProfiles).set({ personality: "Changed live personality", werewolfStrategyStyle: "Changed live strategy" }).where(eq(schema.agentProfiles.userId, actorId));
  const schedule = await readJson(locked.roleSchedule!);
  for (let ordinal = 1; ordinal <= 16; ordinal++) {
    const [first, duplicate] = await Promise.all([dispatchChampionshipMatch(db, event.id, ordinal, "2026-12-31T00:00:00.000Z"), dispatchChampionshipMatch(db, event.id, ordinal, "2026-12-31T00:00:00.000Z")]);
    expect(first.gameId).toBe(duplicate.gameId);
    const gameId = first.gameId!;
    const initial = (await readWerewolfEvents(db, gameId))[0]!;
    if (initial.type !== "werewolf.started") throw new Error("Missing initial event");
    for (const player of initial.payload.players) {
      expect(player.personality).toBe("Frozen personality");
      expect(player.strategy).toBe("Werewolf strategy");
      expect(initial.payload.roles[player.id]).toBe(schedule.matches[ordinal - 1]!.roles[player.agentProfileId!]);
    }
    let claim = await claimWerewolfGame(db, gameId);
    if (!claim.ok) throw new Error(claim.error);
    if (ordinal === 1) {
      await advanceWerewolf(createWerewolfStore(db, gameId, claim.claim.ownerEpoch), scripted);
      await releaseWerewolfOwner(db, gameId, claim.claim.ownerEpoch);
      claim = await claimWerewolfGame(db, gameId);
      if (!claim.ok) throw new Error(claim.error);
    }
    await runWerewolf(createWerewolfStore(db, gameId, claim.claim.ownerEpoch), scripted);
    const [match] = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, gameId));
    await Promise.all([settleChampionshipMatch(db, match!.id), settleChampionshipMatch(db, match!.id)]);
  }
  expect(await db.select().from(schema.championshipResults)).toHaveLength(128);
  expect(await db.select().from(schema.competitionReceipts)).toHaveLength(8);
  const standings = await championshipStandings(db, event.id);
  expect(standings!.series.every(row => row.played === 16)).toBe(true);
  expect(standings!.werewolfWinners).toHaveLength(1);
  expect((await db.select().from(schema.games)).filter(game => game.seasonId === null)).toHaveLength(16);
  await prepareChampionshipAwards(db, event.id);
  await Promise.all([deliverChampionshipAwards(db, event.id), deliverChampionshipAwards(db, event.id)]);
  const grants = await db.select().from(schema.awardGrants);
  expect(grants.filter(row => row.definitionCode === "season-0-top-eight")).toHaveLength(8);
  expect(grants.filter(row => row.definitionCode === "season-0-agent-participant")).toHaveLength(8);
  expect(grants.filter(row => row.definitionCode === "season-0-account-participant")).toHaveLength(1);
  expect(grants.filter(row => row.definitionCode === "season-0-werewolf-champion")).toHaveLength(1);
  expect(grants.some(row => row.definitionCode === "season-0-influence-champion")).toBe(false);
  expect(grants.every(row => !row.agentId || agents.includes(row.agentId))).toBe(true);
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  const finale = await dispatchChampionshipMatch(db, event.id, 17, "2026-12-31T00:00:00.000Z");
  await pauseChampionship(db, event.id, actorId, randomUUID());
  const adopted = await adoptInProgressDurableGamesOnStartup(db, { isAlreadyRunning: isGameRunning, start: async input => {
    const result = await startGame(db, input.gameId, input.ownerEpoch);
    if (result.error) throw new Error(result.error);
  } });
  expect(adopted.adopted).toContain(finale.gameId!);
  const deadline = Date.now() + 100000;
  while (isGameRunning(finale.gameId!) && Date.now() < deadline) await Bun.sleep(20);
  await reconcileChampionshipResults(db, event.id);
  expect((await db.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, event.id)))[0]!.status).toBe("final");
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  expect((await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-influence-champion")).toHaveLength(1);

}, 180000);

test("live owner edits leave a waiting championship seat pinned during start recovery", async () => {
  const { db, event, actorId, agents } = await lockedFixture();
  const [dispatched, duplicate] = await Promise.all([dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z"), dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z")]);
  expect(dispatched.gameId).toBe(duplicate.gameId);
  await db.update(schema.games).set({ status: "waiting", startedAt: null }).where(eq(schema.games.id, dispatched.gameId!));
  const before = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, dispatched.gameId!));
  await updateOwnedAgentProfile(db, { userId: actorId }, agents[0]!, { strategyStyle: "Owner can edit the live agent" });
  expect(await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, dispatched.gameId!))).toEqual(before);
  const retried = await dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z");
  expect(retried.gameId).toBe(dispatched.gameId);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, dispatched.gameId!)))[0]!.status).toBe("in_progress");
});

test("Influence finale starts with frozen inputs and the normal durable mock runner completes and settles", async () => {
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  const { db, event, actorId } = await lockedFixture();
  await db.update(schema.agentProfiles).set({ personality: "Live edit", strategyStyle: "Live edit" }).where(eq(schema.agentProfiles.userId, actorId));
  expect((await dispatchChampionshipMatch(db, event.id, 17, "2026-12-16T00:00:00.000Z")).deferred).toBe(true);
  const [dispatched, duplicate] = await Promise.all([dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z"), dispatchChampionshipMatch(db, event.id, 17, "2026-12-17T00:00:00.000Z")]);
  expect(dispatched.gameId).toBe(duplicate.gameId);
  const gameId = dispatched.gameId!;
  const players = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  expect(players).toHaveLength(8);
  expect(players.every(player => JSON.parse(player.persona).personality === "Frozen personality" && JSON.parse(player.persona).strategyHints === "Influence strategy")).toBe(true);
  const adopted = await adoptInProgressDurableGamesOnStartup(db, { isAlreadyRunning: isGameRunning, start: async input => {
    const result = await startGame(db, input.gameId, input.ownerEpoch);
    if (result.error) throw new Error(result.error);
  } });
  expect(adopted.adopted).toContain(gameId);
  const deadline = Date.now() + 100000;
  while (isGameRunning(gameId) && Date.now() < deadline) await Bun.sleep(20);
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  expect(game!.status).toBe("completed");
  await reconcileChampionshipResults(db, event.id);
  const standings = await championshipStandings(db, event.id);
  expect(standings!.influenceComplete).toBe(true);
  expect(standings!.influenceWinners).toHaveLength(1);
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  expect((await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-influence-champion")).toHaveLength(1);
}, 120000);
