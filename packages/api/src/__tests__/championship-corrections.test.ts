import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import { championshipFixture, policies } from "./championship-fixtures.js";
import { configureChampionshipDraft, lockChampionshipRoster } from "../services/championships.js";
import { activateChampionship, dispatchChampionshipMatch, pauseChampionship, replayCancelledChampionshipMatch } from "../services/championship-dispatch.js";
import { championshipGameRoster } from "../services/championship-game-roster.js";
import { settleChampionshipMatch, championshipStandings, reconcileChampionshipResults } from "../services/championship-results.js";
import { correctChampionshipResult } from "../services/championship-corrections.js";
import { prepareChampionshipAwards, deliverChampionshipAwards } from "../services/championship-awards.js";
import { correctAwardRecipient, grantAward, revokeAward, reinstateAward, publicAgentAwards } from "../services/awards.js";
import { readJson } from "../services/payload-storage.js";
import { createChampionshipRoutes } from "../routes/championships.js";
import { createSessionToken } from "../middleware/auth.js";
import { grantTestAuthority } from "./rbac-fixtures.js";

async function fixture() {
  const f = await championshipFixture();
  await configureChampionshipDraft(f.db, f.event.id, { policies, startDate: "2020-01-01" });
  await lockChampionshipRoster(f.db, f.event.id, f.actorId, randomUUID());
  await activateChampionship(f.db, f.event.id, f.actorId, randomUUID());
  const game = await dispatchChampionshipMatch(f.db, f.event.id, 17);
  const roster = (await championshipGameRoster(f.db, game.gameId!))!;
  // Canonical completion receipt fixture: correction tests do not execute models.
  await f.db.insert(schema.gameResults).values({ id: randomUUID(), gameId: game.gameId!, winnerId: roster.cast[0]!.seatId, roundsPlayed: 1, tokenUsage: "{}" });
  await f.db.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, game.gameId!));
  await settleChampionshipMatch(f.db, roster.match.id);
  await prepareChampionshipAwards(f.db, f.event.id); await deliverChampionshipAwards(f.db, f.event.id);
  const correction = { eventId: f.event.id, ordinal: 17, expectedGameId: game.gameId!, expectedRevision: 0, mode: "resettle" as const, actorId: f.actorId, reason: "Recompute canonical result", requestId: randomUUID() };
  return { ...f, gameId: game.gameId!, roster, correction };
}

test("resettlement preserves canonical history and supersedes affected awards including corrected recipients", async () => {
  const { db, event, actorId, agents, gameId, roster, correction } = await fixture();
  const canonical = await db.select().from(schema.gameResults);
  const games = await db.select().from(schema.games);
  const rows = await db.select().from(schema.championshipResults);
  const [champion] = (await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-influence-champion");
  // Legacy grants could predate allocation links; replacements must inherit supersession later.
  await db.update(schema.awardGrants).set({ allocationId: null }).where(eq(schema.awardGrants.id, champion!.id));
  const input = { grantId: champion!.id, recipient: { type: "agent" as const, id: agents[1]! }, evidence: { note: "Fixture attribution" }, actorId, reason: "Correct recipient", requestId: randomUUID() };
  const replacement = await correctAwardRecipient(db, input);
  expect(await correctAwardRecipient(db, input)).toEqual(replacement);
  await expect(reinstateAward(db, { grantId: champion!.id, actorId, reason: "Restore stale", requestId: randomUUID() })).rejects.toThrow("replaced");
  await Promise.all([correctChampionshipResult(db, correction), correctChampionshipResult(db, correction), deliverChampionshipAwards(db, event.id)]);
  expect((await championshipStandings(db, event.id))!.influenceWinners).toEqual([]);
  const [oldAllocation] = (await db.select().from(schema.championshipAwardAllocations)).filter(row => row.phase === "influence");
  expect(oldAllocation!.supersededAt).not.toBeNull();
  expect((await publicAgentAwards(db, agents[1]!)).some(row => row.id === replacement.replacementId)).toBe(false);
  await expect(reinstateAward(db, { grantId: replacement.replacementId, actorId, reason: "Restore stale", requestId: randomUUID() })).rejects.toThrow("superseded");
  const [oldPlan] = await readJson(oldAllocation!.grants);
  await expect(grantAward(db, { ...oldPlan!, actorId, sourceSeasonId: event.sourceSeasonId, sourceEventId: event.id, allocationId: oldAllocation!.id, reason: "Late delivery", requestId: randomUUID() })).rejects.toThrow("superseded");
  await settleChampionshipMatch(db, roster.match.id);
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  const revised = await db.select().from(schema.championshipResults);
  expect(revised.filter(row => row.revision === 0)).toEqual(rows);
  expect(revised.filter(row => row.revision === 1)).toHaveLength(8);
  expect(await db.select().from(schema.games)).toEqual(games);
  expect(await db.select().from(schema.gameResults)).toEqual(canonical);
  expect((await championshipStandings(db, event.id))!.influenceWinners).toEqual([agents[0]!]);
  expect((await publicAgentAwards(db, agents[0]!)).filter(row => row.code === "season-0-influence-champion")).toHaveLength(1);
  expect((await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-top-eight" && !row.revokedAt)).toHaveLength(8);
  await correctChampionshipResult(db, correction);
  expect((await db.select().from(schema.championshipAwardAllocations)).filter(row => row.phase === "influence" && !row.supersededAt)).toHaveLength(1);
  await expect(correctChampionshipResult(db, { ...correction, requestId: randomUUID() })).rejects.toThrow("revision changed");
  expect((await championshipGameRoster(db, gameId))!.cast).toEqual(roster.cast);
});

test("completed replay keeps old evidence, frozen builds and distinct seats while honoring pause", async () => {
  const { db, event, actorId, gameId, roster, correction } = await fixture();
  await pauseChampionship(db, event.id, actorId, randomUUID());
  const input = { ...correction, mode: "replay" as const };
  await correctChampionshipResult(db, input);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("paused");
  expect((await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0]!.status).toBe("completed");
  expect(await db.select().from(schema.championshipResults)).toHaveLength(8);
  expect((await championshipStandings(db, event.id))!.influenceWinners).toEqual([]);
  await activateChampionship(db, event.id, actorId, randomUUID());
  const next = await dispatchChampionshipMatch(db, event.id, 17);
  expect(next.gameId).not.toBe(gameId);
  const nextRoster = (await championshipGameRoster(db, next.gameId!))!;
  expect(nextRoster.cast.map(row => row.build)).toEqual(roster.cast.map(row => row.build));
  expect(nextRoster.cast.every(row => !roster.cast.some(old => old.seatId === row.seatId))).toBe(true);
  await correctChampionshipResult(db, input);
  expect((await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.id, roster.match.id)))[0]!.gameId).toBe(next.gameId);
  expect((await db.select().from(schema.championshipMatches)).filter(row => row.ordinal !== 17).every(row => row.resultRevision === 0 && row.gameId === null)).toBe(true);
  await db.update(schema.games).set({ status: "cancelled" }).where(eq(schema.games.id, next.gameId!));
  const recovered = await replayCancelledChampionshipMatch(db, { eventId: event.id, ordinal: 17, expectedGameId: next.gameId!, actorId, reason: "Cancelled replacement attempt", requestId: randomUUID() });
  const recoveredRoster = (await championshipGameRoster(db, recovered.gameId!))!;
  await db.insert(schema.gameResults).values({ id: randomUUID(), gameId: recovered.gameId!, winnerId: recoveredRoster.cast[2]!.seatId, roundsPlayed: 1, tokenUsage: "{}" });
  await db.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, recovered.gameId!));
  await settleChampionshipMatch(db, roster.match.id);
  expect((await championshipStandings(db, event.id))!.influenceWinners).toEqual([recoveredRoster.cast[2]!.entry.agentId]);
  expect(await db.select().from(schema.championshipResults)).toHaveLength(16);
});

test("recipient correction retains evidence and rejects stale or incompatible changes", async () => {
  const { db, event, actorId, agents } = await fixture();
  const [original] = (await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-top-eight" && row.agentId === agents[0]);
  const input = { grantId: original!.id, recipient: { type: "agent" as const, id: agents[1]! }, evidence: { note: "Fixture evidence" }, actorId, reason: "Correction", requestId: randomUUID() };
  await expect(correctAwardRecipient(db, { ...input, recipient: { type: "account", id: actorId } })).rejects.toThrow("does not match");
  const result = await correctAwardRecipient(db, input);
  const [old] = await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, original!.id));
  expect(old!.evidence).toEqual(original!.evidence); expect(old!.agentId).toBe(agents[0]!);
  expect(old!.replacedById).toBe(result.replacementId); expect(old!.revokedAt).not.toBeNull();
  await expect(correctAwardRecipient(db, { ...input, recipient: { type: "agent", id: agents[2]! } })).rejects.toThrow("another correction");
  await expect(correctAwardRecipient(db, { ...input, requestId: randomUUID() })).rejects.toThrow("revoked or replaced");
  await deliverChampionshipAwards(db, event.id);
  expect((await db.select().from(schema.awardGrants).where(eq(schema.awardGrants.id, original!.id)))[0]!.revokedAt).not.toBeNull();
});

test("result correction requires championship and award authority", async () => {
  const { db, event, actorId, gameId } = await fixture();
  process.env.JWT_SECRET = "correction-fixture";
  await grantTestAuthority(db, actorId, ["manage_championships"]);
  const app = new Hono().route("/", createChampionshipRoutes(db));
  const token = await createSessionToken(actorId);
  const path = `/api/admin/championships/${event.id}/matches/17/correct`;
  const body = { expectedGameId: gameId, expectedRevision: 0, mode: "resettle", reason: "Fixture" };
  const request = () => app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
  expect((await app.request(path, { method: "POST" })).status).toBe(401);
  expect((await request()).status).toBe(403);
  await grantTestAuthority(db, actorId, ["manage_championships", "manage_awards"]);
  expect((await request()).status).toBe(200);
});


test("explicit badge revocations survive derived allocation replacement until deliberately reinstated", async () => {
  const { db, event, actorId, agents, roster, correction } = await fixture();
  const [champion] = (await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-influence-champion");
  await revokeAward(db, { grantId: champion!.id, actorId, reason: "Producer review", requestId: randomUUID() });
  await correctChampionshipResult(db, correction);
  await settleChampionshipMatch(db, roster.match.id);
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  expect((await publicAgentAwards(db, agents[0]!)).filter(row => row.code === "season-0-influence-champion")).toHaveLength(0);
  const [current] = (await db.select().from(schema.awardGrants)).filter(row => row.definitionCode === "season-0-influence-champion" && row.id !== champion!.id);
  expect(current!.revokedAt).not.toBeNull();
  await reinstateAward(db, { grantId: current!.id, actorId, reason: "Review resolved", requestId: randomUUID() });
  await correctChampionshipResult(db, { ...correction, expectedRevision: 1, requestId: randomUUID() });
  await settleChampionshipMatch(db, roster.match.id);
  await prepareChampionshipAwards(db, event.id); await deliverChampionshipAwards(db, event.id);
  expect((await publicAgentAwards(db, agents[0]!)).filter(row => row.code === "season-0-influence-champion")).toHaveLength(1);
});

test("a final event reopens only for correction and finalizes under a new audited revision", async () => {
  const { db, event, roster, correction } = await fixture();
  const entries = await db.select().from(schema.championshipEntries);
  for (const match of (await db.select().from(schema.championshipMatches)).filter(row => row.ordinal < 17)) {
    const id = randomUUID();
    await db.insert(schema.games).values({ id, slug: `final-fixture-${id}`, gameKind: "werewolf", status: "completed", config: "{}" });
    await db.update(schema.championshipMatches).set({ gameId: id, status: "completed" }).where(eq(schema.championshipMatches.id, match.id));
    await db.insert(schema.championshipResults).values(entries.map(entry => ({ matchId: match.id, gameId: id, entryId: entry.id, outcome: "draw" as const, points: 0, policyVersion: "fixture" })));
  }
  await reconcileChampionshipResults(db, event.id);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("final");
  const games = await db.select().from(schema.games);
  await correctChampionshipResult(db, correction);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("running");
  await reconcileChampionshipResults(db, event.id);
  expect((await db.select().from(schema.championshipEvents))[0]!.status).toBe("final");
  expect(await db.select().from(schema.games)).toEqual(games);
  expect((await db.select().from(schema.competitionAudit)).filter(row => row.action === "event_finalized")).toHaveLength(2);
  expect((await db.select().from(schema.championshipResults)).filter(row => row.matchId === roster.match.id)).toHaveLength(16);
});


test("correction migration backfills historical game and allocation identities without changing evidence", async () => {
  const { db } = await championshipFixture();
  const namespace = `correction_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.execute(sql.raw(`CREATE SCHEMA ${namespace}`));
    await db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO ${namespace}`));
      await tx.execute(sql.raw(`CREATE TABLE games(id text PRIMARY KEY);
        CREATE TABLE championship_matches(id text PRIMARY KEY, game_id text REFERENCES games(id));
        CREATE TABLE championship_results(match_id text, entry_id text, points double precision, policy_version text, PRIMARY KEY(match_id,entry_id));
        CREATE TABLE championship_award_allocations(id text PRIMARY KEY,event_id text,phase text,CONSTRAINT championship_awards_phase UNIQUE(event_id,phase));
        CREATE TABLE award_grants(id text PRIMARY KEY,evidence text);
        CREATE TABLE competition_audit(request_id text,action text,grant_id text);
        INSERT INTO games VALUES('game'); INSERT INTO championship_matches VALUES('match','game');
        INSERT INTO championship_results VALUES('match','entry',0.5,'historical');
        INSERT INTO championship_award_allocations VALUES('allocation','event','influence');
        INSERT INTO award_grants VALUES('grant','original evidence');
        INSERT INTO competition_audit VALUES('allocation:0','award_granted','grant');`));
      const migration = readFileSync(new URL("../../drizzle/0148_championship_corrections.sql", import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
      expect([...(await tx.execute(sql.raw("SELECT game_id,revision,points,policy_version FROM championship_results")))]).toEqual([{ game_id: "game", revision: 0, points: 0.5, policy_version: "historical" }]);
      expect([...(await tx.execute(sql.raw("SELECT allocation_id,replaced_by_id,evidence FROM award_grants")))]).toEqual([{ allocation_id: "allocation", replaced_by_id: null, evidence: "original evidence" }]);
      await tx.execute(sql.raw("INSERT INTO championship_results(match_id,entry_id,game_id,revision,points,policy_version) VALUES('match','entry','game',1,0.5,'corrected')"));
      expect((await tx.execute(sql.raw("SELECT * FROM championship_results"))).length).toBe(2);
    });
  } finally { await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`)); }
});
